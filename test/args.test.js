import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildYtDlpArgs, escapeFfmpegMetadata, parseOptions, sanitizePathSegment } from '../src/args.js';

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
  assert.throws(() => parseOptions(['-o']), /Falta un valor para -o/);
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
  assert.throws(() => parseOptions(['--concurrency', '0']), /La concurrencia debe ser/);
  assert.throws(() => parseOptions(['--concurrency', '7']), /La concurrencia debe ser/);
  assert.throws(() => parseOptions(['--concurrency', '20']), /La concurrencia debe ser/);
});

test('rechaza formatos inválidos y opciones eliminadas', () => {
  assert.throws(() => parseOptions(['--format', 'aac']), /Formato no válido/);
  assert.throws(() => parseOptions(['--format', 'flac']), /Formato no válido/);
  assert.throws(() => parseOptions(['--format', 'wav']), /Formato no válido/);
  assert.throws(() => parseOptions(['--quality', '0']), /No conozco la opción --quality/);
  assert.throws(() => parseOptions(['--single']), /No conozco la opción --single/);
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

test('parseOptions y buildYtDlpArgs soportan cookies y cookies-from-browser', () => {
  const parsedBrowser = parseOptions(['https://example.com', '-b', 'brave']);
  assert.equal(parsedBrowser.options.cookiesBrowser, 'brave');
  const argsBrowser = buildYtDlpArgs('https://example.com', parsedBrowser.options);
  assert.ok(argsBrowser.includes('--cookies-from-browser'));
  assert.ok(argsBrowser.includes('brave'));

  const parsedFile = parseOptions(['https://example.com', '--cookies', '/path/cookies.txt']);
  assert.equal(parsedFile.options.cookies, '/path/cookies.txt');
  const argsFile = buildYtDlpArgs('https://example.com', parsedFile.options);
  assert.ok(argsFile.includes('--cookies'));
  assert.ok(argsFile.includes('/path/cookies.txt'));
});

test('parseOptions respeta thumbnail: false para retrocompatibilidad', () => {
  const parsed = parseOptions(['https://example.com'], { thumbnail: false });
  assert.equal(parsed.options.cover, false);
  assert.equal(parsed.options.thumbnail, false);
});
