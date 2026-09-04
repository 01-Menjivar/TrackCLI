import path from 'node:path';

const formats = new Set(['mp3', 'm4a', 'opus']);

export function isDedicatedPlaylistUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com') && parsed.pathname === '/playlist' && parsed.searchParams.has('list')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parseOptions(tokens, userConfig = {}) {
  const coverDefault = userConfig.cover !== false && userConfig.noCover !== true && userConfig.minimal !== true;
  const options = {
    format: userConfig.format ?? 'mp3',
    output: userConfig.output ?? path.join(process.cwd(), 'trackcli-downloads'),
    cover: coverDefault,
    concurrency: userConfig.concurrency ?? 3,
    overwrite: false,
    playlist: false,
  };
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-m' || token === '--no-cover' || token === '--no-thumbnail' || token === '--minimal') {
      options.cover = false;
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
    if (token === '-o' || token.startsWith('-o=')) {
      const value = token.startsWith('-o=') ? token.slice(3) : tokens[++index];
      if (!value || value.startsWith('-')) throw new Error('Falta un valor para -o / --output.');
      options.output = value;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const [flag, attached] = token.slice(2).split('=', 2);
    if (flag === 'playlist') {
      options.playlist = true;
      continue;
    }
    if (flag === 'concurrency') {
      const value = attached ?? tokens[++index];
      const parsed = parseInt(value, 10);
      if (!parsed || parsed < 1 || parsed > 16) throw new Error('La concurrencia debe ser un número entre 1 y 16.');
      options.concurrency = parsed;
      continue;
    }
    if (flag === 'format' || flag === 'output') {
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

  // Propiedades de retrocompatibilidad
  options.thumbnail = options.cover;
  options.minimal = !options.cover;
  options.single = !options.playlist;

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

export function buildYtDlpArgs(url, options = {}) {
  const output = path.join(options.output || 'trackcli-downloads', '%(title)s.%(ext)s');
  const format = options.format || 'mp3';
  const args = [
    '--no-warnings',
    '--newline',
    '--progress',
    '--format', 'bestaudio/best',
    '--extractor-args', 'youtube:player_client=web,mweb',
    '--extract-audio',
    '--audio-format', format,
    '--output', output,
    '--add-metadata',
    '--parse-metadata', '%(title)s:%(artist)s - %(track)s',
    '--no-continue',
  ];
  if (options.overwrite) {
    args.push('--force-overwrites');
  } else {
    args.push('--no-overwrites');
  }
  if (format === 'mp3') {
    args.push('--audio-quality', '0');
  }
  const shouldEmbedCover = options.cover !== false && options.thumbnail !== false && ['mp3', 'm4a'].includes(format);
  if (shouldEmbedCover) {
    args.push('--embed-thumbnail');
  }

  const isDedicatedPlaylist = isDedicatedPlaylistUrl(url);
  const shouldDownloadPlaylist = options.playlist === true || isDedicatedPlaylist || options.single === false;
  if (!shouldDownloadPlaylist) {
    args.push('--no-playlist');
  }

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
