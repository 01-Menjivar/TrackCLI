import path from 'node:path';

const formats = new Set(['mp3', 'm4a', 'opus']);

export function sanitizePathSegment(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
}

export function sanitizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\r\n\t\0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeMediaUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().replace(/^['"]+|['"]+$/g, '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return trimmed;
  }

  const hostname = parsed.hostname.toLowerCase();

  // YouTube
  const isYouTube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
  if (isYouTube) {
    // Dedicated playlist: https://www.youtube.com/playlist?list=PL...
    if (parsed.pathname === '/playlist') {
      const listId = parsed.searchParams.get('list');
      if (listId) {
        return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
      }
      return trimmed;
    }

    // Video ID extraction
    let videoId = '';
    if (hostname === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.slice('/shorts/'.length).split('/')[0];
    } else if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    }

    if (videoId) {
      const listId = parsed.searchParams.get('list');
      const isRadioOrMix = Boolean(listId && /^RD/i.test(listId));
      const shouldKeepPlaylist = options.playlist === true && listId && !isRadioOrMix;

      if (shouldKeepPlaylist) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(listId)}`;
      }
      return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }
  }

  // Spotify
  if (hostname === 'open.spotify.com') {
    return `https://open.spotify.com${parsed.pathname}`;
  }

  // Apple Music
  if (hostname === 'music.apple.com' || hostname.endsWith('.music.apple.com')) {
    const trackParam = parsed.searchParams.get('i');
    if (trackParam) {
      return `https://music.apple.com${parsed.pathname}?i=${encodeURIComponent(trackParam)}`;
    }
    return `https://music.apple.com${parsed.pathname}`;
  }

  // Generic Web URLs: strip common tracking/analytics parameters
  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'si', 'feature', 'ref', 'source',
  ];
  let modified = false;
  for (const p of TRACKING_PARAMS) {
    if (parsed.searchParams.has(p)) {
      parsed.searchParams.delete(p);
      modified = true;
    }
  }

  return modified ? parsed.toString() : trimmed;
}

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
  const coverDefault = userConfig.cover !== false && userConfig.thumbnail !== false && userConfig.noCover !== true && userConfig.minimal !== true;
  const options = {
    format: userConfig.format ?? 'mp3',
    output: userConfig.output ?? path.join(process.cwd(), 'trackcli-downloads'),
    cover: coverDefault,
    concurrency: userConfig.concurrency ?? 3,
    overwrite: userConfig.overwrite === true || userConfig.force === true,
    playlist: userConfig.playlist === true,
  };
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-m' || token === '--no-cover' || token === '--no-thumbnail' || token === '--minimal') {
      options.cover = false;
      continue;
    }
    if (token === '--cover' || token === '--thumbnail') {
      options.cover = true;
      continue;
    }
    if (token === '-f' || token === '--force' || token === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (token === '--no-overwrite' || token === '--no-force') {
      options.overwrite = false;
      continue;
    }
    if (token === '-c' || token.startsWith('-c=')) {
      const value = token.startsWith('-c=') ? token.slice(3) : tokens[++index];
      const parsed = parseInt(value, 10);
      if (!parsed || parsed < 1 || parsed > 6) throw new Error('Concurrency must be a number between 1 and 6 (recommended: 3).');
      options.concurrency = parsed;
      continue;
    }
    if (token === '-o' || token.startsWith('-o=')) {
      const value = token.startsWith('-o=') ? token.slice(3) : tokens[++index];
      if (!value || value.startsWith('-')) throw new Error('Missing value for -o / --output.');
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
    if (flag === 'no-playlist') {
      options.playlist = false;
      continue;
    }
    if (flag === 'cover' || flag === 'thumbnail') {
      options.cover = true;
      continue;
    }
    if (flag === 'no-cover' || flag === 'no-thumbnail' || flag === 'minimal') {
      options.cover = false;
      continue;
    }
    if (flag === 'overwrite' || flag === 'force') {
      options.overwrite = true;
      continue;
    }
    if (flag === 'no-overwrite' || flag === 'no-force') {
      options.overwrite = false;
      continue;
    }
    if (flag === 'concurrency') {
      const value = attached ?? tokens[++index];
      const parsed = parseInt(value, 10);
      if (!parsed || parsed < 1 || parsed > 6) throw new Error('Concurrency must be a number between 1 and 6 (recommended: 3).');
      options.concurrency = parsed;
      continue;
    }
    if (flag === 'format' || flag === 'output') {
      const value = attached ?? tokens[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${flag}.`);
      options[flag] = value;
      continue;
    }
    throw new Error(`Unknown option --${flag}. Run trackcli help.`);
  }

  if (!formats.has(options.format)) {
    throw new Error(`Invalid format: ${options.format}. Use: ${[...formats].join(', ')}.`);
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
  const targetUrl = sanitizeMediaUrl(url, options);
  const baseOutput = options.output || 'trackcli-downloads';
  let output;

  if (options.metadata) {
    const meta = options.metadata;
    const isAlbum = Boolean(meta.isAlbumTrack || (meta.album && meta.track));
    const artist = sanitizePathSegment(meta.artist || meta.albumArtist || '');
    const title = sanitizePathSegment(meta.title || '');
    const album = sanitizePathSegment(meta.album || '');

    if (isAlbum && (album || artist)) {
      const folderName = artist && album ? `${artist} - ${album}` : (album || artist);
      const trackRaw = String(meta.track || '').split('/')[0].trim();
      const trackNum = parseInt(trackRaw, 10);
      const trackPrefix = !isNaN(trackNum) && trackNum > 0 ? `${String(trackNum).padStart(2, '0')} - ` : '';
      const filename = title ? `${trackPrefix}${title}.%(ext)s` : `${trackPrefix}%(title)s.%(ext)s`;
      output = path.join(baseOutput, folderName, filename);
    } else if (artist && title) {
      output = path.join(baseOutput, `${artist} - ${title}.%(ext)s`);
    } else {
      output = path.join(baseOutput, '%(title)s.%(ext)s');
    }
  } else {
    output = path.join(baseOutput, '%(title)s.%(ext)s');
  }

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

  const isDedicatedPlaylist = isDedicatedPlaylistUrl(targetUrl);
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
  args.push('--', targetUrl);
  return args;
}
