import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { buildYtDlpArgs } from './args.js';
import { spawnTracked } from './process.js';
import { ytDlpCommand } from './requirements.js';
import { color, createSpinner, endProgress, mark, progress } from './ui.js';

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isStreamingUrl(value) {
  if (!isWebUrl(value)) return false;
  try {
    const url = new URL(value);
    const spotify = url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z-]+\/)?(?:track|album)\/[^/]+\/?$/i.test(url.pathname);
    const apple = /(^|\.)music\.apple\.com$/i.test(url.hostname)
      && /^\/[a-z]{2}(?:-[a-z]{2})?\/(?:song\/[^/]+\/\d+|album\/(?:[^/]+\/)?\d+)\/?$/i.test(url.pathname);
    return Boolean(spotify || apple);
  } catch {
    return false;
  }
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function metadataContent(html, property) {
  const tagPattern = /<meta\b[^>]*>/gi;
  const namePattern = new RegExp(`\\b(?:property|name)\\s*=\\s*(["'])${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'i');
  const contentPattern = /\bcontent\s*=\s*(["'])(.*?)\1/i;
  for (const tag of html.match(tagPattern) || []) {
    if (!namePattern.test(tag)) continue;
    const match = tag.match(contentPattern);
    if (match) return decodeHtml(match[2]).trim();
  }
  return '';
}

function splitArtistAndAlbum(description = '') {
  const parts = description.split(/[·•]/).map((part) => part.trim()).filter(Boolean);
  const year = parts.find((part) => /^\d{4}$/.test(part)) || '';
  const artist = parts.find((part) => !/^(song|single|album|\d{4})$/i.test(part)) || '';
  const album = parts.find((part) => part !== artist && !/^(song|single|album|\d{4})$/i.test(part)) || '';
  return { artist, album, year };
}

export function parseDurationToSeconds(duration) {
  if (!duration) return 0;
  if (typeof duration === 'number') return Math.max(0, Math.round(duration));
  const str = String(duration).trim();

  const isoMatch = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (isoMatch) {
    const hours = Number(isoMatch[1] || 0);
    const minutes = Number(isoMatch[2] || 0);
    const seconds = Number(isoMatch[3] || 0);
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  const parts = str.split(':').map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (/^\d+$/.test(str)) {
    const num = Number(str);
    return num > 10000 ? Math.round(num / 1000) : num;
  }

  return 0;
}

function structuredMusicMetadata(html) {
  const scriptPattern = /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const match = visit(item);
        if (match) return match;
      }
      return null;
    }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.includes('MusicRecording')) {
      const artist = value.byArtist?.name || (Array.isArray(value.byArtist) ? value.byArtist[0]?.name : '') || value.author?.name || value.creator?.name || '';
      return {
        title: value.name || '',
        artist,
        album: value.inAlbum?.name || '',
        year: String(value.datePublished || '').match(/^\d{4}/)?.[0] || '',
        duration: value.duration || '',
        durationSeconds: parseDurationToSeconds(value.duration),
        track: value.position ? String(value.position) : '',
        genre: Array.isArray(value.genre) ? value.genre.join(', ') : (value.genre || ''),
      };
    }
    if (types.includes('MusicAlbum') || types.includes('MusicPlaylist')) {
      const albumTitle = value.name || '';
      const albumArtist = value.byArtist?.name || (Array.isArray(value.byArtist) ? value.byArtist[0]?.name : '') || value.author?.name || '';
      const albumYear = String(value.datePublished || '').match(/^\d{4}/)?.[0] || '';
      const albumGenre = Array.isArray(value.genre) ? value.genre.join(', ') : (value.genre || '');
      const rawTracks = Array.isArray(value.track) ? value.track : (Array.isArray(value.itemListElement) ? value.itemListElement : []);
      const tracks = [];

      for (let i = 0; i < rawTracks.length; i++) {
        const tr = rawTracks[i];
        const trName = tr.name || tr.item?.name || '';
        if (!trName) continue;
        const trArtist = tr.byArtist?.name || (Array.isArray(tr.byArtist) ? tr.byArtist[0]?.name : '') || tr.author?.name || albumArtist;
        const trDuration = tr.duration || tr.item?.duration || '';
        const trPosition = tr.position || tr.item?.position || (i + 1);
        tracks.push({
          service: 'Spotify',
          title: trName,
          artist: trArtist,
          album: albumTitle,
          albumArtist,
          year: albumYear,
          track: `${trPosition}/${rawTracks.length}`,
          genre: albumGenre,
          durationSeconds: parseDurationToSeconds(trDuration),
          query: `${trArtist} ${trName}`,
        });
      }

      if (albumTitle && tracks.length > 0) {
        return {
          isAlbum: true,
          service: 'Spotify',
          title: albumTitle,
          artist: albumArtist,
          year: albumYear,
          genre: albumGenre,
          tracks,
        };
      }
    }
    for (const child of Object.values(value)) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const metadata = visit(JSON.parse(match[2]));
      if (metadata) return metadata;
    } catch {
      // A malformed JSON-LD block should not prevent the Open Graph fallback.
    }
  }
  return null;
}

function spotifyMetadata(title, description) {
  const cleanedDesc = description.replace(/^(?:Listen to|Escucha|Écoutez|Hören Sie)\s+.+?\s+(?:on Spotify|en Spotify|sur Spotify)\.\s*/i, '');
  const parts = cleanedDesc.split(/[·•]/).map((part) => part.trim()).filter(Boolean);
  const remaining = parts.filter((part) => part.localeCompare(title, undefined, { sensitivity: 'accent' }) !== 0);
  const year = remaining.find((part) => /^\d{4}$/.test(part)) || '';
  const musicParts = remaining.filter((part) => !/^(song|single|canción|sencillo|pista|track|\d{4})$/i.test(part));
  return { artist: musicParts[0] || '', album: musicParts[1] || '', year };
}

function appleMetadata(title, description) {
  const generic = splitArtistAndAlbum(description);
  const byArtist = description.match(/\bby\s+(.+?)(?:\s+on\s+Apple\s+Music|$)/i)?.[1]?.trim();
  return { ...generic, artist: byArtist || generic.artist };
}

const metadataCache = new Map();
const searchCache = new Map();

export function resetMetadataCache() {
  metadataCache.clear();
}

export function resetSearchCache() {
  searchCache.clear();
}

async function fetchStreamingPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrackCLI/0.1 (+https://github.com/01-Menjivar/TrackCLI)' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`El servicio respondió ${response.status}.`);
  return response.text();
}

export async function resolveStreamingMetadata(url) {
  let urlObject;
  try {
    urlObject = new URL(url);
  } catch {
    return null;
  }
  const cleanUrl = url.split('?')[0] + (urlObject.searchParams.get('i') ? `?i=${urlObject.searchParams.get('i')}` : '');
  if (metadataCache.has(cleanUrl)) {
    return metadataCache.get(cleanUrl);
  }

  const promise = (async () => {
    if (urlObject.hostname === 'open.spotify.com') {
      try {
        const html = await fetchStreamingPage(url);
        const structured = structuredMusicMetadata(html);
        if (structured?.isAlbum) {
          return structured;
        }

        let title = structured?.title || metadataContent(html, 'og:title') || metadataContent(html, 'twitter:title');
        const description = metadataContent(html, 'og:description') || metadataContent(html, 'twitter:description');
        const parsed = spotifyMetadata(title, description);

        let artist = structured?.artist || parsed.artist;
        let album = structured?.album || parsed.album;
        let year = structured?.year || parsed.year;
        const durationSeconds = structured?.durationSeconds || 0;
        const track = structured?.track || '';
        const genre = structured?.genre || '';

        if (!title || !artist) {
          try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
              signal: AbortSignal.timeout(5_000),
            });
            if (oembedRes.ok) {
              const oembedData = await oembedRes.json();
              if (!title) title = oembedData.title || '';
              if (!artist && oembedData.author_name) artist = oembedData.author_name;
            }
          } catch {
            // Ignore oEmbed failure
          }
        }

        const query = artist && title ? `${artist} ${title}` : (title || url);
        return {
          service: 'Spotify',
          title: title || 'Canción de Spotify',
          artist: artist || '',
          album: album || '',
          albumArtist: artist || '',
          year: year || '',
          track,
          genre,
          durationSeconds,
          query,
        };
      } catch {
        return null;
      }
    }

  if (/(^|\.)music\.apple\.com$/i.test(urlObject.hostname)) {
    const hasTrackParam = Boolean(urlObject.searchParams.get('i') || urlObject.pathname.includes('/song/'));
    const trackId = urlObject.searchParams.get('i') || urlObject.pathname.match(/\/(?:song|album)(?:\/[^/]+)?\/(\d+)/i)?.[1];
    const albumId = urlObject.pathname.match(/\/album\/(?:[^/]+\/)?(\d+)/i)?.[1];
    const country = urlObject.pathname.match(/^\/([a-z]{2})(?:-[a-z]{2})?\//i)?.[1] || 'us';

    // Álbum completo de Apple Music
    if (!hasTrackParam && albumId) {
      try {
        const itunesAlbumRes = await fetch(`https://itunes.apple.com/lookup?id=${albumId}&entity=song&country=${country}`, {
          headers: { 'User-Agent': 'TrackCLI/0.1 (+https://github.com/01-Menjivar/TrackCLI)' },
          signal: AbortSignal.timeout(8_000),
        });
        if (itunesAlbumRes.ok) {
          const data = await itunesAlbumRes.json();
          if (data.results && data.results.length > 0) {
            const collection = data.results.find((r) => r.wrapperType === 'collection') || data.results[0];
            const tracks = data.results.filter((r) => r.wrapperType === 'track');
            const albumTitle = collection.collectionName || '';
            const albumArtist = collection.artistName || '';
            const albumYear = collection.releaseDate ? String(collection.releaseDate).slice(0, 4) : '';
            const albumGenre = collection.primaryGenreName || '';

            if (tracks.length > 0) {
              return {
                isAlbum: true,
                service: 'Apple Music',
                title: albumTitle,
                artist: albumArtist,
                year: albumYear,
                genre: albumGenre,
                tracks: tracks.map((tr) => ({
                  service: 'Apple Music',
                  title: tr.trackName,
                  artist: tr.artistName || albumArtist,
                  album: tr.collectionName || albumTitle,
                  albumArtist: tr.collectionArtistName || albumArtist,
                  year: tr.releaseDate ? String(tr.releaseDate).slice(0, 4) : albumYear,
                  track: tr.trackNumber ? `${tr.trackNumber}/${tr.trackCount || tracks.length}` : '',
                  disc: tr.discNumber ? `${tr.discNumber}/${tr.discCount || 1}` : '',
                  genre: tr.primaryGenreName || albumGenre,
                  durationSeconds: tr.trackTimeMillis ? Math.round(tr.trackTimeMillis / 1000) : 0,
                  query: `${tr.artistName || albumArtist} ${tr.trackName}`,
                })),
              };
            }
          }
        }
      } catch {
        // Fallback to web scraping
      }
    }

    if (trackId) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${trackId}&country=${country}`, {
          headers: { 'User-Agent': 'TrackCLI/0.1 (+https://github.com/01-Menjivar/TrackCLI)' },
          signal: AbortSignal.timeout(6_000),
        });
        if (itunesRes.ok) {
          const data = await itunesRes.json();
          if (data.results && data.results.length > 0) {
            const item = data.results.find((r) => r.wrapperType === 'track') || data.results[0];
            const title = item.trackName || item.collectionName || '';
            const artist = item.artistName || '';
            const album = item.collectionName || '';
            const albumArtist = item.collectionArtistName || item.artistName || '';
            const year = item.releaseDate ? String(item.releaseDate).slice(0, 4) : '';
            const track = item.trackNumber ? `${item.trackNumber}/${item.trackCount || ''}` : '';
            const disc = item.discNumber ? `${item.discNumber}/${item.discCount || ''}` : '';
            const genre = item.primaryGenreName || '';
            const durationSeconds = item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0;
            if (title) {
              return {
                service: 'Apple Music',
                title,
                artist,
                album,
                albumArtist,
                year,
                track,
                disc,
                genre,
                durationSeconds,
                query: artist ? `${artist} ${title}` : title,
              };
            }
          }
        }
      } catch {
        // Fallback to web scraping if API is unreachable
      }
    }

    try {
      const html = await fetchStreamingPage(url);
      const structured = structuredMusicMetadata(html);
      if (structured?.isAlbum) {
        return structured;
      }

      const title = structured?.title || metadataContent(html, 'og:title') || metadataContent(html, 'twitter:title');
      const description = metadataContent(html, 'og:description') || metadataContent(html, 'twitter:description');
      const parsed = appleMetadata(title, description);
      const artist = structured?.artist || parsed.artist;
      const album = structured?.album || parsed.album;
      const year = structured?.year || parsed.year;
      const durationSeconds = structured?.durationSeconds || 0;
      const track = structured?.track || '';
      const genre = structured?.genre || '';

      if (title) {
        return {
          service: 'Apple Music',
          title,
          artist: artist || '',
          album: album || '',
          albumArtist: artist || '',
          year: year || '',
          track,
          genre,
          durationSeconds,
          query: artist ? `${artist} ${title}` : title,
        };
      }
    } catch {
      // Fallback to URL slug
    }

    const slug = urlObject.pathname.match(/\/(?:album|song)\/([a-z0-9-]+)\/\d+/i)?.[1];
    if (slug) {
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        service: 'Apple Music',
        title,
        artist: '',
        album: '',
        albumArtist: '',
        year: '',
        track: '',
        genre: '',
        durationSeconds: 0,
        query: title,
      };
    }
  }

  return null;
  })();

  metadataCache.set(cleanUrl, promise);
  try {
    const result = await promise;
    return result;
  } catch (err) {
    metadataCache.delete(cleanUrl);
    return null;
  }
}

export function scoreAudioCandidate(song, query = '', targetDurationSeconds = 0) {
  let score = 100;
  const title = (song.title || '').toLowerCase();
  const uploader = (song.uploader || '').toLowerCase();
  const channel = (song.channel || '').toLowerCase();
  const q = query.toLowerCase();

  const qHas = (word) => q.includes(word);

  // 1. Penalizaciones MUY severas para videoclips y contenido audiovisual con ruidos/diálogos externos
  // (Incluso si están en el canal oficial del artista, los videoclips suelen contener diálogos, efectos sonoros o pausas)
  if (/\b(official\s+video|official\s+music\s+video|video\s+oficial|v[ií]deo\s+oficial|music\s+video|videoclip|video\s+clip|v[ií]deo\s+musical|video\s+musical)\b/i.test(title)) {
    score -= 350;
  }
  if (/\b(m\/?v|official\s+mv)\b/i.test(title)) {
    score -= 300;
  }
  if (/\b(behind\s+the\s+scenes|making\s+of|trailer|teaser|entrevista|interview|reaction|reacci[oó]n|parodia|parody|review)\b/i.test(title)) {
    score -= 400;
  }
  if (/\b(short|shorts|#shorts|tiktok)\b/i.test(title)) {
    score -= 400;
  }
  if (!qHas('slow') && !qHas('reverb') && !qHas('loop') && !qHas('sped') && !qHas('nightcore')) {
    if (/\b(slowed|reverb|sped\s+up|nightcore|pitch|\d+d\s+audio|bass\s+boost(ed)?|10\s*hours?|1\s*hour|10\s*min\s*loop|hour\s+loop)\b/i.test(title)) {
      score -= 300;
    }
  }
  if (!qHas('cover') && !qHas('karaoke') && !qHas('instrumental')) {
    if (/\b(karaoke|instrumental|playback|backing\s+track|tutorial|piano\s+cover|guitar\s+cover|drum\s+cover|\bcover\b)\b/i.test(title)) {
      score -= 250;
    }
  }
  if (!qHas('live') && !qHas('en vivo') && !qHas('concierto') && !qHas('unplugged') && !qHas('acustico') && !qHas('acústico')) {
    if (/\b(live|en\s+vivo|en\s+directo|concierto|concert|tour|unplugged|ac[uú]stico|acoustic|festival)\b/i.test(title)) {
      score -= 180;
    }
  }

  // Penalización estricta de Remixes y Ediciones no solicitadas
  const qHasRemix = /\b(remix|mix|club|edit|vip|mashup|bootleg|flip|rework|acoustic|acustico|acústico|unplugged)\b/i.test(q);
  if (!qHasRemix) {
    if (/\b(remix|club\s+mix|extended\s+mix|vip\s+mix|dance\s+mix|bootleg|flip|rework|mashup)\b/i.test(title)) {
      score -= 220;
    }
  }

  // Preferencia de versiones explícitas vs. Clean / Radio Edit no solicitados
  const qHasClean = /\b(clean|radio\s+edit|censored|censurado)\b/i.test(q);
  if (!qHasClean) {
    if (/\b(clean\s+version|clean\s+edit|\bclean\b|radio\s+edit|censored|edited\s+version)\b/i.test(title)) {
      score -= 150;
    }
  }

  // 2. PRIORIDAD MÁXIMA Y AGRESIVA A FUENTES OFICIALES (YouTube Music Art Tracks y Canales del Artista)
  const isTopicChannel = uploader.endsWith(' - topic') || channel.endsWith(' - topic') || uploader.includes('topic') || channel.includes('topic');
  if (isTopicChannel) {
    score += 250; // Fuente oficial de YouTube Music (audio directo provisto por discográfica / sello)
  }

  const queryParts = q.split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
  const potentialArtist = queryParts.length >= 2 ? queryParts[0] : '';
  const isOfficialArtistChannel = (potentialArtist && (uploader.includes(potentialArtist) || channel.includes(potentialArtist))) ||
    uploader.includes('vevo') || channel.includes('vevo') ||
    uploader.includes('official') || channel.includes('official');

  if (isOfficialArtistChannel && !isTopicChannel) {
    score += 120; // Canal oficial del artista / VEVO
  }

  // 3. Verificación cruzada de duración (clave para confirmar la pista de estudio idéntica a Spotify/Apple)
  const candidateSeconds = parseDurationToSeconds(song.duration);
  if (targetDurationSeconds > 0 && candidateSeconds > 0) {
    const diff = Math.abs(candidateSeconds - targetDurationSeconds);
    if (diff <= 2) {
      score += 250; // Coincidencia exacta (±2s) con la duración oficial de estudio
    } else if (diff <= 5) {
      score += 140; // Coincidencia muy cercana (±5s)
    } else if (diff <= 10) {
      score += 40; // Coincidencia aceptable
    } else if (diff >= 30) {
      score -= 300; // Versión con intro/diálogo de videoclip, escenas o extendida
    } else if (diff >= 15) {
      score -= 150; // Discrepancia notable de duración
    }
  } else if (candidateSeconds > 0) {
    if (candidateSeconds < 45 || candidateSeconds > 720) score -= 150;
    else if (candidateSeconds >= 90 && candidateSeconds <= 360) score += 15;
  }

  // 4. Calidad del título (bonificación a títulos limpios oficiales de Art Tracks)
  const isCleanTitle = !/\b(lyrics?|letra|vietsub|subtitulado|sub\s+esp|full\s+song|descargar|video|visualizer|audio)\b/i.test(title);
  if (isCleanTitle && isTopicChannel) {
    score += 50; // Título limpio oficial (solo el nombre de la pista)
  }

  // Bonificaciones secundarias para versiones de audio etiquetadas
  if (/\b(official\s+audio|audio\s+oficial|official\s+audio\s+track|official\s+track)\b/i.test(title)) {
    score += 40;
  } else if (/\b(audio|audio\s+original)\b/i.test(title)) {
    score += 25;
  }
  if (/\b(visualizer|official\s+visualizer|visualiser)\b/i.test(title)) {
    score += 20;
  }
  if (/\b(lyric\s+video|official\s+lyric\s+video|lyrics?\s+video|letra|lyrics?)\b/i.test(title)) {
    score += 10;
  }
  if (/\b(remaster(ed)?|original\s+mix|studio\s+version|album\s+version)\b/i.test(title)) {
    score += 30;
  }
  if (/\b(hq|hd\s+audio|flac|lossless)\b/i.test(title)) {
    score += 15;
  }

  // 5. Relevancia léxica con términos de búsqueda
  const qTokens = q.split(/\s+/).filter((t) => t.length > 2 && !['audio', 'official', 'video', 'lyrics'].includes(t));
  for (const token of qTokens) {
    if (title.includes(token)) score += 15;
    if (uploader.includes(token) || channel.includes(token)) score += 10;
  }

  return score;
}

async function fetchCandidates(searchQuery) {
  const args = [
    '--flat-playlist', '--no-warnings',
    '--print', '%(id)s\t%(title)s\t%(uploader)s\t%(duration_string)s\t%(channel)s',
    '--', searchQuery,
  ];
  const child = spawnTracked(ytDlpCommand, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  let output = '';
  let failure = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { failure += chunk; });

  await new Promise((resolveSearch, rejectSearch) => {
    child.on('error', rejectSearch);
    child.on('close', (status) => status === 0 ? resolveSearch() : rejectSearch(new Error(failure.trim() || 'No pude buscar esa canción.')));
  });

  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, title, uploader, duration, channel] = line.split('\t');
    return {
      id,
      title: title || 'Sin título',
      uploader: uploader || 'Canal desconocido',
      duration: duration || '?',
      channel: channel || uploader || '',
    };
  }).filter((song) => song.id && song.id !== 'NA').map((song) => ({
    ...song,
    url: `https://www.youtube.com/watch?v=${song.id}`,
  }));
}

async function executeSongSearch(query, limit = 5, targetDurationSeconds = 0) {
  const cleanQuery = query.trim();
  let candidates = await fetchCandidates(`ytsearch${limit}:${cleanQuery}`);

  if (!candidates.length && !cleanQuery.toLowerCase().includes('audio')) {
    candidates = await fetchCandidates(`ytsearch${limit}:${cleanQuery} audio`);
  }

  const scored = candidates.map((song) => ({
    ...song,
    score: scoreAudioCandidate(song, query, targetDurationSeconds),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export async function searchSongs(query, limit = 5, targetDurationSeconds = 0) {
  const cacheKey = `${String(query).trim().toLowerCase()}:::${limit}:::${targetDurationSeconds}`;
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }
  const promise = executeSongSearch(query, limit, targetDurationSeconds);
  searchCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (err) {
    searchCache.delete(cacheKey);
    throw err;
  }
}

export async function findBestAudioSong(query, targetDurationSeconds = 0) {
  const results = await searchSongs(query, 5, targetDurationSeconds);
  if (!results.length) {
    throw new Error('No encontré resultados de audio para esa búsqueda. Prueba con título y artista.');
  }
  return results[0];
}

export async function readQueue(filename) {
  let content;
  try {
    content = await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No encuentro el archivo: ${filename}`);
    throw error;
  }
  const urls = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!urls.length) throw new Error('La lista no tiene enlaces. Añade uno por línea.');
  return urls;
}

export async function fileExistsAndNotEmpty(filePath) {
  try {
    const s = await stat(filePath);
    return s.size > 0;
  } catch {
    return false;
  }
}

export async function mapConcurrent(items, limit, fn) {
  if (!items.length) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 6;

export function normalizeConcurrency(val, fallback = DEFAULT_CONCURRENCY) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_CONCURRENCY);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatYtDlpError(rawFailure, status, signal) {
  const failure = (rawFailure || '').trim();
  if (/HTTP Error 429|Too Many Requests/i.test(failure)) {
    return 'YouTube ha limitado temporalmente las peticiones (HTTP 429). Reduce la concurrencia con -c 2 o espera unos minutos.';
  }
  if (/Sign in to confirm you(?:'re| are) not a bot/i.test(failure)) {
    return 'YouTube requiere verificación de bot. Reduce la concurrencia con -c 2 o intenta más tarde.';
  }
  if (/HTTP Error 403: Forbidden/i.test(failure)) {
    return 'Acceso denegado por YouTube (HTTP 403). La conexión o dirección IP fue restringida temporalmente.';
  }
  return failure || `yt-dlp terminó con código ${status ?? signal}.`;
}

export async function resolveBatchEntries(entries, options = {}, onProgress = null) {
  const concurrency = Math.max(1, Math.min(normalizeConcurrency(options.concurrency), 3));
  let resolvedCount = 0;

  const rawResults = await mapConcurrent(entries, concurrency, async (entry) => {
    let job = null;
    if (isStreamingUrl(entry)) {
      const meta = await resolveStreamingMetadata(entry);
      if (meta?.isAlbum && meta.tracks?.length) {
        const albumConcurrency = concurrency;
        const albumJobs = await mapConcurrent(meta.tracks, albumConcurrency, async (tr) => {
          try {
            const song = await findBestAudioSong(tr.query, tr.durationSeconds || 0);
            return {
              url: song.url,
              metadata: tr,
              display: `${tr.title} · ${tr.artist || song.uploader} [${meta.service} - ${meta.title}]`,
            };
          } catch {
            return {
              url: `ytsearch1:${tr.query} audio`,
              metadata: tr,
              display: `${tr.title} (búsqueda directa) [${meta.title}]`,
            };
          }
        });
        resolvedCount++;
        if (onProgress) onProgress(resolvedCount, entries.length, { display: `Álbum: ${meta.title} (${meta.tracks.length} pistas)` }, entry);
        return albumJobs;
      }

      if (meta && meta.query) {
        try {
          const song = await findBestAudioSong(meta.query, meta.durationSeconds || 0);
          job = {
            url: song.url,
            metadata: meta,
            display: `${meta.title} · ${meta.artist || song.uploader} [${meta.service}]`,
          };
        } catch {
          job = {
            url: `ytsearch1:${meta.query} audio`,
            metadata: meta,
            display: `${meta.title} (búsqueda directa)`,
          };
        }
      }
    } else if (isWebUrl(entry)) {
      job = { url: entry, display: entry };
    } else {
      try {
        const song = await findBestAudioSong(entry);
        job = {
          url: song.url,
          display: `${song.title} · ${song.uploader}`,
        };
      } catch {
        job = {
          url: `ytsearch1:${entry} audio`,
          display: `${entry} (búsqueda directa)`,
        };
      }
    }

    resolvedCount++;
    if (onProgress) {
      onProgress(resolvedCount, entries.length, job, entry);
    }
    return job;
  });

  return rawResults.flat().filter(Boolean);
}

function cleanTitle(raw) {
  const cleaned = raw.replace(/^\[download\]\s+(Destination|Deleting original file)\s*:?\s*/i, '').trim();
  return basename(cleaned);
}

export async function downloadOne(url, options = {}, position) {
  await mkdir(options.output, { recursive: true });

  const args = buildYtDlpArgs(url, options);
  const child = spawnTracked(ytDlpCommand, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  let title = url;
  let failure = '';
  let sawProgress = false;
  let skipped = false;
  const isConcurrent = Boolean(options.isConcurrent);

  const processLine = (line, isError = false) => {
    if (!line) return;
    if (/has already been downloaded/i.test(line)) {
      skipped = true;
    }
    const progressMatch = line.match(/\[download\]\s+([\d.]+)%(?:\s+of\s+~?([^\s]+))?(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/i);
    if (progressMatch) {
      if (!isConcurrent) {
        sawProgress = true;
        const percent = progressMatch[1];
        const size = progressMatch[2];
        const speed = progressMatch[3];
        const eta = progressMatch[4];
        progress(percent, {
          label: `${position} ${title}`,
          speed,
          eta,
          size,
        });
      }
      return;
    }
    if (/\[download\]\s+Destination:/i.test(line)) title = cleanTitle(line);
    if (/\[ExtractAudio\]|\[Metadata\]|\[ThumbnailsConvertor\]/.test(line)) title = title || url;
    if (isError || /^ERROR:/i.test(line)) failure = line.replace(/^ERROR:\s*/i, '');
  };
  const attachLines = (stream, isError) => {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      lines.forEach((line) => processLine(line, isError));
    });
    stream.on('end', () => processLine(buffered, isError));
  };
  attachLines(child.stdout, false);
  attachLines(child.stderr, true);

  return new Promise((resolveDownload, rejectDownload) => {
    child.on('error', rejectDownload);
    child.on('close', (status, signal) => {
      if (sawProgress) endProgress();
      if (status === 0) resolveDownload({ title, url, skipped });
      else rejectDownload(new Error(formatYtDlpError(failure, status, signal)));
    });
  });
}

export async function runQueue(jobs, options = {}) {
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  const concurrency = normalizeConcurrency(options.concurrency);
  const isConcurrent = jobs.length > 1;
  const results = new Array(jobs.length);
  let currentIndex = 0;

  const runJob = async (entry, index) => {
    const job = typeof entry === 'string' ? { url: entry } : entry;
    const label = `[${index + 1}/${jobs.length}]`;
    const jobOptions = { ...options, output, metadata: job.metadata, isConcurrent };
    try {
      const result = await downloadOne(job.url, jobOptions, label);
      results[index] = { ...result, ok: true };
      const skipNotice = result.skipped ? ` ${color.dim('(ya existe)')}` : '';
      console.log(mark('success', `${color.bold(label)} ${result.title || job.url}${skipNotice}`));
    } catch (error) {
      results[index] = { url: job.url, ok: false, error: error.message };
      console.error(mark('error', `${color.bold(label)} ${error.message}`));
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async (_, workerIndex) => {
    if (workerIndex > 0 && isConcurrent) {
      await sleep(workerIndex * 300);
    }
    while (currentIndex < jobs.length) {
      const index = currentIndex++;
      await runJob(jobs[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function runBatchPipeline(entries, options = {}) {
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });

  const searchConcurrency = Math.max(1, Math.min(normalizeConcurrency(options.concurrency), 3));
  const downloadConcurrency = normalizeConcurrency(options.concurrency);
  const isConcurrent = entries.length > 1;

  const readyJobs = [];
  const results = [];
  let resolutionDone = false;
  let resolutionError = null;

  const waiters = [];
  const waitForJobOrDone = () => new Promise((res) => waiters.push(res));
  const signalUpdate = () => {
    while (waiters.length > 0) {
      const fn = waiters.shift();
      fn();
    }
  };

  let downloadIndex = 0;

  let entryIndex = 0;
  const resolveWorker = async () => {
    while (entryIndex < entries.length) {
      const idx = entryIndex++;
      const entry = entries[idx];
      try {
        let jobList = [];
        if (isStreamingUrl(entry)) {
          const meta = await resolveStreamingMetadata(entry);
          if (meta?.isAlbum && meta.tracks?.length) {
            const albumTracks = await mapConcurrent(meta.tracks, searchConcurrency, async (tr) => {
              try {
                const song = await findBestAudioSong(tr.query, tr.durationSeconds || 0);
                return {
                  url: song.url,
                  metadata: tr,
                  display: `${tr.title} · ${tr.artist || song.uploader} [${meta.service} - ${meta.title}]`,
                };
              } catch {
                return {
                  url: `ytsearch1:${tr.query} audio`,
                  metadata: tr,
                  display: `${tr.title} (búsqueda directa) [${meta.title}]`,
                };
              }
            });
            jobList = albumTracks;
          } else if (meta && meta.query) {
            try {
              const song = await findBestAudioSong(meta.query, meta.durationSeconds || 0);
              jobList = [{
                url: song.url,
                metadata: meta,
                display: `${meta.title} · ${meta.artist || song.uploader} [${meta.service}]`,
              }];
            } catch {
              jobList = [{
                url: `ytsearch1:${meta.query} audio`,
                metadata: meta,
                display: `${meta.title} (búsqueda directa)`,
              }];
            }
          }
        } else if (isWebUrl(entry)) {
          jobList = [{ url: entry, display: entry }];
        } else {
          try {
            const song = await findBestAudioSong(entry);
            jobList = [{
              url: song.url,
              display: `${song.title} · ${song.uploader}`,
            }];
          } catch {
            jobList = [{
              url: `ytsearch1:${entry} audio`,
              display: `${entry} (búsqueda directa)`,
            }];
          }
        }

        for (const j of jobList) {
          readyJobs.push(j);
        }
        signalUpdate();
      } catch {
        // Ignore single resolution failure and continue with other batch entries
      }
    }
  };

  const resolveWorkers = Array.from(
    { length: Math.min(searchConcurrency, entries.length) },
    () => resolveWorker()
  );

  Promise.all(resolveWorkers).then(() => {
    resolutionDone = true;
    signalUpdate();
  }).catch((err) => {
    resolutionError = err;
    resolutionDone = true;
    signalUpdate();
  });

  const downloadWorker = async (workerIndex) => {
    if (workerIndex > 0 && isConcurrent) {
      await sleep(workerIndex * 300);
    }
    while (true) {
      let job = null;
      let jobPos = 0;
      if (readyJobs.length > 0) {
        job = readyJobs.shift();
        downloadIndex++;
        jobPos = downloadIndex;
      } else if (resolutionDone) {
        break;
      } else {
        await waitForJobOrDone();
        continue;
      }

      if (!job) continue;

      const label = `[#${jobPos}]`;
      const jobOptions = { ...options, output, metadata: job.metadata, isConcurrent };
      try {
        const result = await downloadOne(job.url, jobOptions, label);
        results.push({ ...result, ok: true, jobIndex: jobPos - 1 });
        const skipNotice = result.skipped ? ` ${color.dim('(ya existe)')}` : '';
        console.log(mark('success', `${color.bold(label)} ${result.title || job.url}${skipNotice}`));
      } catch (error) {
        results.push({ url: job.url, ok: false, error: error.message, jobIndex: jobPos - 1 });
        console.error(mark('error', `${color.bold(label)} ${error.message}`));
      }
    }
  };

  const downloadWorkers = Array.from(
    { length: downloadConcurrency },
    (_, idx) => downloadWorker(idx)
  );

  await Promise.all([...resolveWorkers, ...downloadWorkers]);
  if (resolutionError) throw resolutionError;

  return results;
}
