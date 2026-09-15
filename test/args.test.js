import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildYtDlpArgs, escapeFfmpegMetadata, parseOptions, sanitizeMediaUrl, sanitizePathSegment, sanitizeSearchQuery } from '../src/args.js';

test('usa una carpeta de descargas predecible por defecto', () => {
  const { options, positional } = parseOptions(['https://example.com/audio']);
  assert.deepEqual(positional, ['https://example.com/audio']);
  assert.equal(options.output, path.join(process.cwd(), 'trackcli-downloads'));
  assert.equal(options.format, 'mp3');
});

test('interpreta opciones con valor separado o unido', () => {
  const { options, positional } = parseOptions([
    'https://a.example', '--format=m4a', '-o', 'mi-musica', '-m', '-c', '5', '--overwrite',
  ]);
  assert.deepEqual(positional, ['https://a.example']);
  assert.equal(options.format, 'm4a');
  assert.equal(options.output, 'mi-musica');
  assert.equal(options.cover, false);
  assert.equal(options.concurrency, 5);
  assert.equal(options.overwrite, true);
});

test('soporta alias -o y -o= para la carpeta de destino', () => {
  assert.equal(parseOptions(['-o', 'carpeta1']).options.output, 'carpeta1');
  assert.equal(parseOptions(['-o=carpeta2']).options.output, 'carpeta2');
  assert.equal(parseOptions(['--output', 'carpeta3']).options.output, 'carpeta3');
  assert.throws(() => parseOptions(['-o']), /Missing value for -o/);
});

test('detecta playlists dedicadas automáticamente y permite forzar con --playlist', () => {
  // Video normal: incluye --no-playlist por defecto
  const normalArgs = buildYtDlpArgs('https://www.youtube.com/watch?v=abc', parseOptions([]).options);
  assert.ok(normalArgs.includes('--no-playlist'));

  // Playlist dedicada: NO incluye --no-playlist (descarga automática sin flag)
  const playlistArgs = buildYtDlpArgs('https://www.youtube.com/playlist?list=PL123', parseOptions([]).options);
  assert.equal(playlistArgs.includes('--no-playlist'), false);

  // Video con flag --playlist: NO incluye --no-playlist
  const forcedArgs = buildYtDlpArgs('https://www.youtube.com/watch?v=abc&list=RD123', parseOptions(['--playlist']).options);
  assert.equal(forcedArgs.includes('--no-playlist'), false);
});

test('valida y asigna valores de concurrencia y sobreescritura', () => {
  assert.equal(parseOptions(['--concurrency=4']).options.concurrency, 4);
  assert.equal(parseOptions(['-c', '6']).options.concurrency, 6);
  assert.equal(parseOptions(['-f']).options.overwrite, true);
  assert.equal(parseOptions(['--force']).options.overwrite, true);
  assert.throws(() => parseOptions(['--concurrency', '0']), /Concurrency must be/);
  assert.throws(() => parseOptions(['--concurrency', '7']), /Concurrency must be/);
  assert.throws(() => parseOptions(['--concurrency', '20']), /Concurrency must be/);
});

test('rechaza formatos inválidos y opciones eliminadas', () => {
  assert.throws(() => parseOptions(['--format', 'aac']), /Invalid format/);
  assert.throws(() => parseOptions(['--format', 'flac']), /Invalid format/);
  assert.throws(() => parseOptions(['--format', 'wav']), /Invalid format/);
  assert.throws(() => parseOptions(['--quality', '0']), /Unknown option --quality/);
  assert.throws(() => parseOptions(['--single']), /Unknown option --single/);
});

test('genera argumentos seguros para yt-dlp con calidad óptima', () => {
  const args = buildYtDlpArgs('https://example.com/watch?v=1', {
    format: 'mp3', output: '/tmp/musica',
  });
  assert.ok(args.includes('--extract-audio'));
  assert.ok(args.includes('--embed-thumbnail'));
  assert.ok(args.includes('--no-playlist'));
  assert.ok(args.includes('--audio-quality'));
  assert.equal(args[args.indexOf('--audio-quality') + 1], '0');
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/watch?v=1']);
});

test('modo -m y --no-cover desactiva la descarga de portada', () => {
  const parsed1 = parseOptions(['https://example.com/audio', '--no-cover']);
  assert.equal(parsed1.options.cover, false);
  const args1 = buildYtDlpArgs('https://example.com/audio', parsed1.options);
  assert.equal(args1.includes('--embed-thumbnail'), false);

  const parsed2 = parseOptions(['https://example.com/audio', '-m']);
  assert.equal(parsed2.options.cover, false);
  const args2 = buildYtDlpArgs('https://example.com/audio', parsed2.options);
  assert.equal(args2.includes('--embed-thumbnail'), false);
});

test('no descarga componentes remotos de yt-dlp', () => {
  const args = buildYtDlpArgs('https://example.com/watch?v=1', {
    format: 'mp3', output: '/tmp/musica',
  });
  assert.equal(args.includes('--remote-components'), false);
});

test('escapeFfmpegMetadata sanitiza comillas, saltos de línea y backslashes', () => {
  assert.equal(escapeFfmpegMetadata('Canción "Especial"\nEn Vivo\\Remix'), 'Canción \\"Especial\\" En Vivo\\\\Remix');
  assert.equal(escapeFfmpegMetadata('  Sin saltos\r\n\tde línea  '), 'Sin saltos de línea');
  assert.equal(escapeFfmpegMetadata(null), '');
  assert.equal(escapeFfmpegMetadata(undefined), '');
});

test('buildYtDlpArgs incluye tags ID3 enriquecidos con escape seguro', () => {
  const args = buildYtDlpArgs('https://example.com/audio', {
    format: 'mp3',
    quality: '0',
    output: '/tmp/music',
    single: true,
    metadata: {
      title: 'Don\'t Stop "Till You Get Enough"',
      artist: 'Michael Jackson',
      album: 'Off the Wall',
      year: '1979',
      track: '1/10',
      genre: 'Disco / Funk',
      albumArtist: 'Michael Jackson',
    },
  });

  const postArgIdx = args.indexOf('--postprocessor-args');
  assert.ok(postArgIdx !== -1);
  const ffmpegArg = args[postArgIdx + 1];
  assert.ok(ffmpegArg.includes('title="Don\'t Stop \\"Till You Get Enough\\""'));
  assert.ok(ffmpegArg.includes('track="1/10"'));
  assert.ok(ffmpegArg.includes('genre="Disco / Funk"'));
  assert.ok(ffmpegArg.includes('album_artist="Michael Jackson"'));
});

test('sanitizePathSegment limpia caracteres no válidos para el sistema de archivos', () => {
  assert.equal(sanitizePathSegment('AC/DC: Back *in* "Black"?'), 'AC_DC_ Back _in_ _Black__');
  assert.equal(sanitizePathSegment('...Canción Secreta...'), 'Canción Secreta...');
  assert.equal(sanitizePathSegment(''), '');
  assert.equal(sanitizePathSegment(null), '');
});

test('buildYtDlpArgs organiza pistas de álbum en subcarpeta y antepone numeración con ceros', () => {
  const args = buildYtDlpArgs('https://example.com/track', {
    format: 'opus',
    output: '/Music',
    metadata: {
      isAlbumTrack: true,
      title: 'Come Together',
      artist: 'The Beatles',
      album: 'Abbey Road',
      track: '1/17',
    },
  });

  const outIdx = args.indexOf('--output');
  assert.ok(outIdx !== -1);
  assert.ok(args[outIdx + 1].includes('The Beatles - Abbey Road'));
  assert.ok(args[outIdx + 1].includes('01 - Come Together.%(ext)s'));
});

test('buildYtDlpArgs previene colisiones en pistas individuales usando [Artista] - [Título]', () => {
  const args = buildYtDlpArgs('https://example.com/single', {
    format: 'mp3',
    output: '/Music',
    metadata: {
      title: 'Intro',
      artist: 'The xx',
    },
  });

  const outIdx = args.indexOf('--output');
  assert.ok(outIdx !== -1);
  assert.ok(args[outIdx + 1].includes('The xx - Intro.%(ext)s'));
});

test('parseOptions respeta thumbnail: false para retrocompatibilidad', () => {
  const parsed = parseOptions(['https://example.com'], { thumbnail: false });
  assert.equal(parsed.options.cover, false);
  assert.equal(parsed.options.thumbnail, false);
});

test('sanitizeMediaUrl limpia enlaces de YouTube con parámetros de radio/mix y tracking', () => {
  // Caso de la imagen: radio mix de YouTube con &list=RD... y &start_radio=1
  const mixUrl = 'https://www.youtube.com/watch?v=bgm4N4OnHsQ&list=RDbgm4N4OnHsQ&start_radio=1';
  assert.equal(sanitizeMediaUrl(mixUrl), 'https://www.youtube.com/watch?v=bgm4N4OnHsQ');

  // URL envuelta en comillas simples o dobles
  assert.equal(sanitizeMediaUrl('"https://www.youtube.com/watch?v=bgm4N4OnHsQ"'), 'https://www.youtube.com/watch?v=bgm4N4OnHsQ');
  assert.equal(sanitizeMediaUrl("'https://www.youtube.com/watch?v=bgm4N4OnHsQ'"), 'https://www.youtube.com/watch?v=bgm4N4OnHsQ');

  // Enlace corto youtu.be con tracking ?si=...
  assert.equal(sanitizeMediaUrl('https://youtu.be/bgm4N4OnHsQ?si=abcdef12345'), 'https://www.youtube.com/watch?v=bgm4N4OnHsQ');

  // YouTube Shorts
  assert.equal(sanitizeMediaUrl('https://www.youtube.com/shorts/bgm4N4OnHsQ?feature=share'), 'https://www.youtube.com/watch?v=bgm4N4OnHsQ');

  // Playlist dedicada se mantiene limpia
  assert.equal(sanitizeMediaUrl('https://www.youtube.com/playlist?list=PL12345&si=abc'), 'https://www.youtube.com/playlist?list=PL12345');

  // Si playlist: true y es playlist legítima (no mix RD), se preserva list
  assert.equal(
    sanitizeMediaUrl('https://www.youtube.com/watch?v=abc&list=PL12345&index=2', { playlist: true }),
    'https://www.youtube.com/watch?v=abc&list=PL12345'
  );

  // Si playlist: false (default), se descarta list de videos individuales
  assert.equal(
    sanitizeMediaUrl('https://www.youtube.com/watch?v=abc&list=PL12345&index=2', { playlist: false }),
    'https://www.youtube.com/watch?v=abc'
  );
});

test('sanitizeMediaUrl limpia enlaces de Spotify y Apple Music', () => {
  // Spotify track y album con tracking ?si=...
  assert.equal(
    sanitizeMediaUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc12345'),
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
  );
  assert.equal(
    sanitizeMediaUrl('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc?si=xyz987'),
    'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc'
  );

  // Apple Music preserva parámetro ?i= pero elimina parámetros de tracking/marketing
  assert.equal(
    sanitizeMediaUrl('https://music.apple.com/us/album/song-name/12345?i=67890&uo=4&l=en'),
    'https://music.apple.com/us/album/song-name/12345?i=67890'
  );
});

test('sanitizeSearchQuery normaliza espacios, elimina comillas y caracteres de control', () => {
  assert.equal(sanitizeSearchQuery('  "Queen - Bohemian Rhapsody"  '), 'Queen - Bohemian Rhapsody');
  assert.equal(sanitizeSearchQuery("'AC/DC - Back in Black'"), 'AC/DC - Back in Black');
  assert.equal(sanitizeSearchQuery('Daft\tPunk\n\rGet   Lucky'), 'Daft Punk Get Lucky');
  assert.equal(sanitizeSearchQuery(''), '');
  assert.equal(sanitizeSearchQuery(null), '');
});
