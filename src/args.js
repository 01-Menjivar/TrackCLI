import path from 'node:path';

const formats = new Set(['mp3', 'm4a', 'opus']);

export function parseOptions(tokens, userConfig = {}) {
  const options = {
    format: userConfig.format ?? 'mp3',
    quality: userConfig.quality ?? '0',
    output: userConfig.output ?? path.join(process.cwd(), 'trackcli-downloads'),
    single: true,
    minimal: userConfig.minimal ?? false,
    thumbnail: userConfig.minimal ? false : true,
    concurrency: userConfig.concurrency ?? 3,
    overwrite: false,
  };
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-m' || token === '--minimal' || token === '--fast') {
      options.thumbnail = false;
      options.minimal = true;
      continue;
    }
    if (token === '--no-thumbnail' || token === '--no-cover') {
      options.thumbnail = false;
      continue;
    }
    if (token === '-f' || token === '--force' || token === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (token === '-c' || token.startsWith('-c=')) {
      const value = token.startsWith('-c=') ? token.slice(3) : tokens[++index];
      const parsed = parseInt(value, 10);
      if (!parsed || parsed < 1 || parsed > 16) throw new Error('La concurrencia debe ser un número entre 1 y 16.');
      options.concurrency = parsed;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const [flag, attached] = token.slice(2).split('=', 2);
    if (flag === 'single') {
      options.single = true;
      continue;
    }
    if (flag === 'playlist') {
      options.single = false;
      continue;
    }
    if (flag === 'concurrency') {
      const value = attached ?? tokens[++index];
      const parsed = parseInt(value, 10);
      if (!parsed || parsed < 1 || parsed > 16) throw new Error('La concurrencia debe ser un número entre 1 y 16.');
      options.concurrency = parsed;
      continue;
    }
    if (flag === 'format' || flag === 'quality' || flag === 'output') {
      const value = attached ?? tokens[++index];
      if (!value || value.startsWith('--')) throw new Error(`Falta un valor para --${flag}.`);
      options[flag] = value;
      continue;
    }
    throw new Error(`No conozco la opción --${flag}. Ejecuta trackcli help.`);
  }

  if (!formats.has(options.format)) {
    throw new Error(`Formato no válido: ${options.format}. Usa: ${[...formats].join(', ')}.`);
  }
  if (!/^(10|[0-9])$/.test(options.quality)) {
    throw new Error('La calidad debe ser un valor entre 0 y 10 (0 es la mayor calidad VBR).');
  }
  return { options, positional };
}

export function escapeFfmpegMetadata(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim();
}

export function buildYtDlpArgs(url, options) {
  const output = path.join(options.output, '%(title)s.%(ext)s');
  const args = [
    '--no-warnings',
    '--newline',
    '--progress',
    '--extractor-args', 'youtube:player_client=web,android,mweb,ios',
    '--extract-audio',
    '--audio-format', options.format,
    '--output', output,
    '--add-metadata',
    '--parse-metadata', '%(title)s:%(artist)s - %(track)s',
    '--continue',
  ];
  if (options.overwrite) {
    args.push('--force-overwrites');
  } else {
    args.push('--no-overwrites');
  }
  if (options.format === 'mp3') args.push('--audio-quality', options.quality);
  if (options.thumbnail !== false && ['mp3', 'm4a'].includes(options.format)) {
    args.push('--embed-thumbnail');
  }
  if (options.single) args.push('--no-playlist');
  if (options.metadata) {
    const meta = options.metadata;
    const ffmpegArgs = [];
    if (meta.title) ffmpegArgs.push(`-metadata title="${escapeFfmpegMetadata(meta.title)}"`);
    if (meta.artist) ffmpegArgs.push(`-metadata artist="${escapeFfmpegMetadata(meta.artist)}"`);
    if (meta.album) ffmpegArgs.push(`-metadata album="${escapeFfmpegMetadata(meta.album)}"`);
    if (meta.year) ffmpegArgs.push(`-metadata date="${escapeFfmpegMetadata(meta.year)}"`);
    if (meta.track) ffmpegArgs.push(`-metadata track="${escapeFfmpegMetadata(meta.track)}"`);
    if (meta.disc) ffmpegArgs.push(`-metadata disc="${escapeFfmpegMetadata(meta.disc)}"`);
    if (meta.genre) ffmpegArgs.push(`-metadata genre="${escapeFfmpegMetadata(meta.genre)}"`);
    if (meta.albumArtist || meta.album_artist) {
      ffmpegArgs.push(`-metadata album_artist="${escapeFfmpegMetadata(meta.albumArtist || meta.album_artist)}"`);
    }
    if (ffmpegArgs.length) {
      args.push('--postprocessor-args', `ffmpeg:${ffmpegArgs.join(' ')}`);
    }
  }
  args.push('--', url);
  return args;
}
