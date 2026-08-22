import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildYtDlpArgs, escapeFfmpegMetadata, parseOptions } from '../src/args.js';

test('usa una carpeta de descargas predecible por defecto', () => {
  const { options, positional } = parseOptions(['https://example.com/audio']);
  assert.deepEqual(positional, ['https://example.com/audio']);
  assert.equal(options.output, path.join(process.cwd(), 'trackcli-downloads'));
  assert.equal(options.format, 'mp3');
});

test('interpreta opciones con valor separado o unido', () => {
  const { options, positional } = parseOptions([
    'https://a.example', '--format=m4a', '--output', 'mi-musica', '--single', '--no-thumbnail', '-c', '5', '--overwrite',
  ]);
  assert.deepEqual(positional, ['https://a.example']);
  assert.deepEqual(options, {
    format: 'm4a', quality: '0', output: 'mi-musica', single: true, thumbnail: false, minimal: false, concurrency: 5, overwrite: true,
  });
});

test('descarga una sola pista por defecto y solo expande con --playlist', () => {
  assert.equal(parseOptions([]).options.single, true);
  assert.equal(parseOptions(['--playlist']).options.single, false);
});

test('valida y asigna valores de concurrencia y sobreescritura', () => {
  assert.equal(parseOptions(['--concurrency=4']).options.concurrency, 4);
  assert.equal(parseOptions(['-c', '6']).options.concurrency, 6);
  assert.equal(parseOptions(['-f']).options.overwrite, true);
  assert.equal(parseOptions(['--force']).options.overwrite, true);
  assert.throws(() => parseOptions(['--concurrency', '0']), /La concurrencia debe ser/);
  assert.throws(() => parseOptions(['--concurrency', '20']), /La concurrencia debe ser/);
});

test('rechaza formatos y calidades inválidas', () => {
  assert.throws(() => parseOptions(['--format', 'aac']), /Formato no válido/);
  assert.throws(() => parseOptions(['--format', 'flac']), /Formato no válido/);
  assert.throws(() => parseOptions(['--format', 'wav']), /Formato no válido/);
  assert.throws(() => parseOptions(['--quality', '12']), /calidad debe ser/);
});

test('genera argumentos seguros para yt-dlp', () => {
  const args = buildYtDlpArgs('https://example.com/watch?v=1', {
    format: 'mp3', quality: '2', output: '/tmp/musica', single: true,
  });
  assert.ok(args.includes('--extract-audio'));
  assert.ok(args.includes('--embed-thumbnail'));
  assert.ok(args.includes('--no-playlist'));
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/watch?v=1']);
});

test('modo minimal (-m y --minimal) desactiva la descarga de portada', () => {
  const parsed1 = parseOptions(['https://example.com/audio', '--minimal']);
  assert.equal(parsed1.options.minimal, true);
  assert.equal(parsed1.options.thumbnail, false);
  const args1 = buildYtDlpArgs('https://example.com/audio', parsed1.options);
  assert.equal(args1.includes('--embed-thumbnail'), false);

  const parsed2 = parseOptions(['https://example.com/audio', '-m']);
  assert.equal(parsed2.options.minimal, true);
  assert.equal(parsed2.options.thumbnail, false);
  const args2 = buildYtDlpArgs('https://example.com/audio', parsed2.options);
  assert.equal(args2.includes('--embed-thumbnail'), false);
});

test('--no-thumbnail omite solo la portada y no activa el modo minimal', () => {
  const parsed = parseOptions(['https://example.com/audio', '--no-thumbnail']);
  assert.equal(parsed.options.minimal, false);
  assert.equal(parsed.options.thumbnail, false);
  assert.equal(buildYtDlpArgs('https://example.com/audio', parsed.options).includes('--embed-thumbnail'), false);
});

test('no descarga componentes remotos de yt-dlp', () => {
  const args = buildYtDlpArgs('https://example.com/watch?v=1', {
    format: 'mp3', quality: '2', output: '/tmp/musica', single: true,
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
