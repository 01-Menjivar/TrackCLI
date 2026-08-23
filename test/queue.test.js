import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { downloadOne, fileExistsAndNotEmpty, findBestAudioSong, isStreamingUrl, isWebUrl, mapConcurrent, parseDurationToSeconds, readQueue, resetMetadataCache, resetSearchCache, resolveBatchEntries, resolveStreamingMetadata, runBatchPipeline, runQueue, scoreAudioCandidate, searchSongs } from '../src/download.js';
import { inspectRequirements, resetRequirementsCache } from '../src/requirements.js';

async function createFakeYtDlp(directory, outputLines) {
  const scriptPath = join(directory, 'fake-yt-dlp.mjs');
  const code = `import { appendFile } from 'node:fs/promises';\nconst lines = ${JSON.stringify(outputLines)};\nif (process.env.TRACKCLI_CAPTURE_ARGS) await appendFile(process.env.TRACKCLI_CAPTURE_ARGS, JSON.stringify(process.argv.slice(2)) + '\\n');\nfor (const line of lines) console.log(line);\n`;
  await writeFile(scriptPath, code);

  // Unix executable
  const binPath = join(directory, 'yt-dlp');
  await writeFile(binPath, `#!/bin/sh\n"${process.execPath}" "${scriptPath}" "$@"\n`);
  await chmod(binPath, 0o755).catch(() => {});

  // Windows executables (.cmd and .bat)
  const cmdPath = join(directory, 'yt-dlp.cmd');
  await writeFile(cmdPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
  const batPath = join(directory, 'yt-dlp.bat');
  await writeFile(batPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
}

test('lee enlaces y omite comentarios y líneas vacías', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const filename = join(directory, 'lista.txt');
  await writeFile(filename, '# favoritos\n\nhttps://one.example\n  https://two.example  \n');
  assert.deepEqual(await readQueue(filename), ['https://one.example', 'https://two.example']);
});

test('rechaza listas sin enlaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const filename = join(directory, 'vacia.txt');
  await writeFile(filename, '# nada\n\n');
  await assert.rejects(readQueue(filename), /no tiene enlaces/);
});

test('ejecuta yt-dlp, interpreta el progreso y crea el destino', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  await createFakeYtDlp(directory, [
    '[download] Destination: Canción de prueba.webm',
    '[download]  50.0% of 1.00MiB at 1.00MiB/s',
    '[download] 100.0% of 1.00MiB at 1.00MiB/s',
  ]);
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}${delimiter}${originalPath}`;
  const output = join(directory, 'audio');
  try {
    const result = await downloadOne('https://example.com/permitted', {
      format: 'mp3', quality: '0', output, single: true,
    }, '1/1');
    assert.equal(result.title, 'Canción de prueba.webm');
    assert.ok((await stat(output)).isDirectory());
  } finally {
    process.env.PATH = originalPath;
  }
});

test('evalúa y penaliza videoclips frente a versiones oficiales de audio', () => {
  const videoClip = { title: 'Daft Punk - Get Lucky (Official Video)', uploader: 'Daft Punk', duration: '4:08' };
  const officialAudio = { title: 'Daft Punk - Get Lucky (Official Audio)', uploader: 'Daft Punk', duration: '4:09' };
  const topicTrack = { title: 'Get Lucky', uploader: 'Daft Punk - Topic', duration: '4:09' };
  const slowedReverb = { title: 'Get Lucky (Slowed + Reverb)', uploader: 'Music Fan', duration: '6:30' };

  const scoreVideo = scoreAudioCandidate(videoClip, 'Daft Punk Get Lucky');
  const scoreAudio = scoreAudioCandidate(officialAudio, 'Daft Punk Get Lucky');
  const scoreTopic = scoreAudioCandidate(topicTrack, 'Daft Punk Get Lucky');
  const scoreSlowed = scoreAudioCandidate(slowedReverb, 'Daft Punk Get Lucky');

  assert.ok(scoreAudio > scoreVideo, 'Official Audio debe tener mayor puntuación que Official Video');
  assert.ok(scoreTopic > scoreVideo, 'Topic/Art track debe tener mayor puntuación que Official Video');
  assert.ok(scoreAudio > scoreSlowed, 'Official Audio debe tener mayor puntuación que Slowed+Reverb');
});

test('parseDurationToSeconds interpreta formatos ISO 8601, marcas de tiempo y segundos', () => {
  assert.equal(parseDurationToSeconds('PT3M33S'), 213);
  assert.equal(parseDurationToSeconds('PT4M'), 240);
  assert.equal(parseDurationToSeconds('PT1H2M30S'), 3750);
  assert.equal(parseDurationToSeconds('3:33'), 213);
  assert.equal(parseDurationToSeconds('1:02:30'), 3750);
  assert.equal(parseDurationToSeconds(213), 213);
  assert.equal(parseDurationToSeconds('213000'), 213);
  assert.equal(parseDurationToSeconds(null), 0);
});

test('scoreAudioCandidate aplica verificación cruzada de duración con Spotify/Apple (3A)', () => {
  const exactDurationSong = { title: 'Never Gonna Give You Up', uploader: 'Rick Astley - Topic', duration: '3:33' }; // 213s
  const slightlyDifferentSong = { title: 'Never Gonna Give You Up', uploader: 'Rick Astley', duration: '3:37' }; // 217s (diff = 4s)
  const longVideoDialogueSong = { title: 'Never Gonna Give You Up', uploader: 'Rick Astley', duration: '4:20' }; // 260s (diff = 47s)

  const targetSeconds = 213; // Duración de Spotify/Apple
  const scoreExact = scoreAudioCandidate(exactDurationSong, 'Never Gonna Give You Up', targetSeconds);
  const scoreSlight = scoreAudioCandidate(slightlyDifferentSong, 'Never Gonna Give You Up', targetSeconds);
  const scoreLong = scoreAudioCandidate(longVideoDialogueSong, 'Never Gonna Give You Up', targetSeconds);

  assert.ok(scoreExact > scoreSlight, 'Coincidencia exacta (±3s) debe superar a diferencias moderadas');
  assert.ok(scoreSlight > scoreLong, 'Diferencias moderadas deben superar a discrepancias largas (>30s)');
});

test('scoreAudioCandidate penaliza remixes y clean edits no solicitados (3B y 3C)', () => {
  const originalSong = { title: 'Blinding Lights', uploader: 'The Weeknd - Topic', duration: '3:20' };
  const remixSong = { title: 'Blinding Lights (Major Lazer Remix)', uploader: 'The Weeknd', duration: '3:20' };
  const cleanSong = { title: 'Blinding Lights (Clean Version)', uploader: 'The Weeknd', duration: '3:20' };

  // Consulta estándar sin pedir remix ni clean
  const scoreOriginal = scoreAudioCandidate(originalSong, 'The Weeknd Blinding Lights');
  const scoreRemix = scoreAudioCandidate(remixSong, 'The Weeknd Blinding Lights');
  const scoreClean = scoreAudioCandidate(cleanSong, 'The Weeknd Blinding Lights');

  assert.ok(scoreOriginal > scoreRemix, 'La versión original debe ganar a remixes no solicitados');
  assert.ok(scoreOriginal > scoreClean, 'La versión original debe ganar a versiones censuradas/clean');

  // Si el usuario pide explícitamente el remix
  const scoreRequestedRemix = scoreAudioCandidate(remixSong, 'The Weeknd Blinding Lights Remix');
  assert.ok(scoreRequestedRemix > scoreRemix, 'Si el remix es solicitado no debe recibir penalización');
});

test('busca canciones y prioriza automáticamente la versión puramente de audio sobre videoclips', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  await createFakeYtDlp(directory, [
    'vid001\tCanción (Official Video)\tArtista\t4:15\tArtista',
    'vid002\tCanción (Official Audio)\tArtista\t3:30\tArtista',
  ]);
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}${delimiter}${originalPath}`;
  try {
    const best = await findBestAudioSong('Canción Artista');
    assert.equal(best.id, 'vid002');
    assert.equal(best.title, 'Canción (Official Audio)');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('distingue URLs de consultas de texto y detecta servicios de streaming (tracks y álbumes)', () => {
  assert.equal(isWebUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isWebUrl('Somebody That I Used to Know'), false);
  assert.equal(isStreamingUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), true);
  assert.equal(isStreamingUrl('https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT'), true);
  assert.equal(isStreamingUrl('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc'), true);
  assert.equal(isStreamingUrl('https://music.apple.com/us/album/never-gonna-give-you-up/1558533900?i=1558534271'), true);
  assert.equal(isStreamingUrl('https://music.apple.com/us/album/never-gonna-give-you-up/1558533900'), true);
  assert.equal(isStreamingUrl('https://www.youtube.com/watch?v=abc'), false);
});

test('lee metadatos de Spotify combinando JSON-LD y og:description para artista y álbum', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    '<script type="application/ld+json">{"@type":["CreativeWork","MusicRecording"],"name":"Never Gonna Give You Up","duration":"PT3M33S","datePublished":"1987-11-12"}</script>',
    '<meta content="Never Gonna Give You Up" property="og:title">',
    '<meta property="og:description" content="Listen to Never Gonna Give You Up on Spotify. Rick Astley · Whenever You Need Somebody · Song · 1987">',
  ].join(''), { status: 200 });
  try {
    const meta = await resolveStreamingMetadata('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    assert.deepEqual(meta, {
      service: 'Spotify', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', albumArtist: 'Rick Astley', year: '1987', track: '', genre: '', durationSeconds: 213, query: 'Rick Astley Never Gonna Give You Up',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expande un álbum completo de Spotify desde JSON-LD (4A)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    '<script type="application/ld+json">',
    JSON.stringify({
      '@type': 'MusicAlbum',
      name: 'Discovery',
      byArtist: [{ name: 'Daft Punk' }],
      datePublished: '2001-03-12',
      genre: ['Electronic'],
      track: [
        { '@type': 'MusicRecording', name: 'One More Time', duration: 'PT5M20S', position: 1 },
        { '@type': 'MusicRecording', name: 'Aerodynamic', duration: 'PT3M27S', position: 2 },
      ],
    }),
    '</script>',
  ].join(''), { status: 200 });
  try {
    const meta = await resolveStreamingMetadata('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc');
    assert.equal(meta.isAlbum, true);
    assert.equal(meta.title, 'Discovery');
    assert.equal(meta.artist, 'Daft Punk');
    assert.equal(meta.tracks.length, 2);
    assert.equal(meta.tracks[0].title, 'One More Time');
    assert.equal(meta.tracks[0].track, '1/2');
    assert.equal(meta.tracks[0].durationSeconds, 320);
    assert.equal(meta.tracks[1].title, 'Aerodynamic');
    assert.equal(meta.tracks[1].track, '2/2');
    assert.equal(meta.tracks[1].durationSeconds, 207);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('usa la API de iTunes para obtener metadatos y tags ID3 completos de Apple Music (4B)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('itunes.apple.com/lookup')) {
      return new Response(JSON.stringify({
        resultCount: 1,
        results: [{
          wrapperType: 'track', trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours', releaseDate: '2019-11-29T08:00:00Z', trackTimeMillis: 200040, trackNumber: 9, trackCount: 14, primaryGenreName: 'R&B/Soul',
        }],
      }), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  try {
    const meta = await resolveStreamingMetadata('https://music.apple.com/us/album/after-hours/1499378108?i=1499378607');
    assert.deepEqual(meta, {
      service: 'Apple Music', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', albumArtist: 'The Weeknd', year: '2019', track: '9/14', disc: '', genre: 'R&B/Soul', durationSeconds: 200, query: 'The Weeknd Blinding Lights',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expande un álbum completo de Apple Music mediante la API de iTunes (4A)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('itunes.apple.com/lookup') && String(url).includes('entity=song')) {
      return new Response(JSON.stringify({
        resultCount: 3,
        results: [
          { wrapperType: 'collection', collectionName: 'After Hours', artistName: 'The Weeknd', releaseDate: '2020-03-20T07:00:00Z', primaryGenreName: 'R&B/Soul' },
          { wrapperType: 'track', trackName: 'Alone Again', artistName: 'The Weeknd', collectionName: 'After Hours', trackNumber: 1, trackCount: 2, trackTimeMillis: 250000 },
          { wrapperType: 'track', trackName: 'Too Late', artistName: 'The Weeknd', collectionName: 'After Hours', trackNumber: 2, trackCount: 2, trackTimeMillis: 239000 },
        ],
      }), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  try {
    const meta = await resolveStreamingMetadata('https://music.apple.com/us/album/after-hours/1499378108');
    assert.equal(meta.isAlbum, true);
    assert.equal(meta.title, 'After Hours');
    assert.equal(meta.artist, 'The Weeknd');
    assert.equal(meta.tracks.length, 2);
    assert.equal(meta.tracks[0].title, 'Alone Again');
    assert.equal(meta.tracks[0].track, '1/2');
    assert.equal(meta.tracks[1].title, 'Too Late');
    assert.equal(meta.tracks[1].track, '2/2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recurre al slug de URL para Apple Music si la API y la web no están disponibles', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    const meta = await resolveStreamingMetadata('https://music.apple.com/us/album/monaco/1711256529?i=1711256747');
    assert.deepEqual(meta, {
      service: 'Apple Music', title: 'Monaco', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', durationSeconds: 0, query: 'Monaco',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mantiene metadatos independientes para cada trabajo de una cola', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const captureFile = join(directory, 'args.jsonl');
  await createFakeYtDlp(directory, ['[download] Destination: pista.webm']);
  const originalPath = process.env.PATH;
  const originalCaptureFile = process.env.TRACKCLI_CAPTURE_ARGS;
  process.env.PATH = `${directory}${delimiter}${originalPath}`;
  process.env.TRACKCLI_CAPTURE_ARGS = captureFile;
  const options = { format: 'mp3', quality: '0', output: join(directory, 'audio'), single: true };
  try {
    const results = await runQueue([
      { url: 'https://example.com/one', metadata: { title: 'Primera', artist: 'A' } },
      { url: 'https://example.com/two', metadata: { title: 'Segunda', artist: 'B' } },
    ], options);
    const invocations = (await readFile(captureFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(results.every((result) => result.ok), true);
    const invOne = invocations.find((inv) => inv.includes('https://example.com/one'));
    const invTwo = invocations.find((inv) => inv.includes('https://example.com/two'));
    assert.ok(invOne, 'Se esperaba la invocación para https://example.com/one');
    assert.ok(invTwo, 'Se esperaba la invocación para https://example.com/two');
    assert.match(invOne.join(' '), /title="?Primera"?/);
    assert.doesNotMatch(invOne.join(' '), /title="?Segunda"?/);
    assert.match(invTwo.join(' '), /title="?Segunda"?/);
    assert.doesNotMatch(invTwo.join(' '), /title="?Primera"?/);
    assert.equal(options.metadata, undefined);
  } finally {
    process.env.PATH = originalPath;
    if (originalCaptureFile === undefined) delete process.env.TRACKCLI_CAPTURE_ARGS;
    else process.env.TRACKCLI_CAPTURE_ARGS = originalCaptureFile;
  }
});

test('mapConcurrent procesa elementos en paralelo respetando el límite y orden de salida', async () => {
  const items = [10, 20, 30, 40, 50];
  let active = 0;
  let maxActive = 0;

  const results = await mapConcurrent(items, 2, async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active--;
    return item * 2;
  });

  assert.deepEqual(results, [20, 40, 60, 80, 100]);
  assert.ok(maxActive <= 2, `Se esperaba máximo 2 tareas concurrentes, pero hubo ${maxActive}`);
});

test('fileExistsAndNotEmpty detecta archivos existentes y vacíos correctamente', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const validFile = join(directory, 'cancion.mp3');
  const emptyFile = join(directory, 'vacio.mp3');
  const missingFile = join(directory, 'inexistente.mp3');

  await writeFile(validFile, 'audio content');
  await writeFile(emptyFile, '');

  assert.equal(await fileExistsAndNotEmpty(validFile), true);
  assert.equal(await fileExistsAndNotEmpty(emptyFile), false);
  assert.equal(await fileExistsAndNotEmpty(missingFile), false);
});

test('inspectRequirements memoiza el chequeo de binarios evitando ejecuciones redundantes', async () => {
  resetRequirementsCache();
  const first = await inspectRequirements();
  const second = await inspectRequirements();
  assert.strictEqual(first, second);
});

test('resolveStreamingMetadata memoiza peticiones para evitar trabajo repetido', async () => {
  resetMetadataCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response([
      '<script type="application/ld+json">{"@type":"MusicRecording","name":"Memo Song","duration":"PT3M"}</script>',
      '<meta content="Memo Song" property="og:title">',
      '<meta property="og:description" content="Listen to Memo Song on Spotify. Artist · Album · Song · 2024">',
    ].join(''), { status: 200 });
  };
  try {
    const url = 'https://open.spotify.com/track/memo123456';
    const [res1, res2] = await Promise.all([
      resolveStreamingMetadata(url),
      resolveStreamingMetadata(url),
    ]);
    assert.deepEqual(res1, res2);
    assert.equal(fetchCount, 1, 'Solo debe haber 1 petición fetch para llamadas concurrentes con la misma URL');
  } finally {
    globalThis.fetch = originalFetch;
    resetMetadataCache();
  }
});

test('searchSongs memoiza búsquedas idénticas evitando spawn duplicado de yt-dlp', async () => {
  resetSearchCache();
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const captureFile = join(directory, 'search-invocations.txt');
  await createFakeYtDlp(directory, [
    'vid001\tMemo Search Song\tArtist\t3:00\tArtist',
  ]);
  const originalPath = process.env.PATH;
  const originalCapture = process.env.TRACKCLI_CAPTURE_ARGS;
  process.env.PATH = `${directory}${delimiter}${originalPath}`;
  process.env.TRACKCLI_CAPTURE_ARGS = captureFile;

  try {
    const [results1, results2] = await Promise.all([
      searchSongs('Artist Memo Search Song', 5),
      searchSongs('Artist Memo Search Song', 5),
    ]);
    assert.deepEqual(results1, results2);
    const invocations = (await readFile(captureFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    assert.equal(invocations.length, 1, 'Solo debe haber 1 invocación a yt-dlp para búsquedas concurrentes idénticas');
  } finally {
    process.env.PATH = originalPath;
    if (originalCapture === undefined) delete process.env.TRACKCLI_CAPTURE_ARGS;
    else process.env.TRACKCLI_CAPTURE_ARGS = originalCapture;
    resetSearchCache();
  }
});

test('downloadOne detecta archivo existente antes de spawn y lo omite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  const existingFile = join(directory, 'Cancion Existente.mp3');
  await writeFile(existingFile, 'dummy audio data');

  const result = await downloadOne('https://example.com/stream', {
    format: 'mp3',
    quality: '0',
    output: directory,
    overwrite: false,
    metadata: { title: 'Cancion Existente' },
  }, '[1/1]');

  assert.equal(result.skipped, true);
  assert.equal(result.title, 'Cancion Existente.mp3');
});

test('runBatchPipeline procesa entradas en flujo continuo (pipeline productor-consumidor)', async () => {
  resetSearchCache();
  resetMetadataCache();
  const directory = await mkdtemp(join(tmpdir(), 'trackcli-test-'));
  await createFakeYtDlp(directory, [
    '[download] Destination: track.webm',
    'vid100\tTrack One\tArtist One\t3:00\tArtist One',
    'vid200\tTrack Two\tArtist Two\t3:00\tArtist Two',
  ]);
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}${delimiter}${originalPath}`;
  const output = join(directory, 'output-pipeline');

  try {
    const entries = ['https://example.com/one.mp3', 'https://example.com/two.mp3'];
    const results = await runBatchPipeline(entries, {
      format: 'mp3',
      quality: '0',
      output,
      concurrency: 2,
      overwrite: true,
    });

    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok));
    assert.ok((await stat(output)).isDirectory());
  } finally {
    process.env.PATH = originalPath;
  }
});
