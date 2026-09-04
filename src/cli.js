import { existsSync, statSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseOptions } from './args.js';
import { getConfigPath, loadConfig, resetConfig, setConfigValue } from './config.js';
import { findBestAudioSong, isStreamingUrl, isWebUrl, mapConcurrent, readQueue, resolveBatchEntries, resolveStreamingMetadata, runBatchPipeline, runQueue, searchSongs } from './download.js';
import { setupSignalHandlers, spawnTracked } from './process.js';
import { ensureRequirements, inspectRequirements } from './requirements.js';
import { card, color, createSpinner, header, mark, selectItemInteractive, VERSION } from './ui.js';

const HELP = `
${color.bold('Uso')}
  trackcli                                menú interactivo (búsqueda, descargas, config)
  trackcli <canción>                      busca y descarga una pista
  trackcli <URL...>                       descarga desde enlaces (Spotify, Apple Music, YouTube)
  trackcli <archivo.txt>                  descarga por lotes desde un listado
  trackcli search <canción>               búsqueda explícita
  trackcli download <URL...>              descarga explícita desde enlaces
  trackcli batch <archivo.txt>            descarga explícita desde archivo
  trackcli config [set|reset]             gestiona la configuración global de TrackCLI
  trackcli doctor                         verifica dependencias del sistema
  trackcli update                         actualiza TrackCLI a la versión más reciente

${color.bold('Opciones')}
  --format <mp3|m4a|opus>                 Formato de audio (por defecto: mp3)
  -o, --output <carpeta>                  Directorio de destino (por defecto: ./trackcli-downloads)
  -c, --concurrency <1-6>                 Descargas simultáneas en cola/lotes (por defecto: 3)
  -m, --no-cover                          Descarga rápida sin incrustar carátula
  -f, --overwrite                         Sobrescribir archivos si ya existen en destino
  -b, --cookies-from-browser <navegador>  Extrae cookies del navegador (chrome, firefox, brave, etc.)
  --cookies <archivo>                     Ruta a un archivo cookies.txt de YouTube

${color.bold('Configuración Global')}
  trackcli config                         Muestra las preferencias activas
  trackcli config set format opus         Establece el formato por defecto
  trackcli config set output ~/Music      Establece la carpeta de destino por defecto
  trackcli config set concurrency 4       Establece descargas simultáneas por defecto
  trackcli config set cover false         Desactiva carátulas e imágenes por defecto
  trackcli config set overwrite true      Sobrescribe archivos existentes por defecto
  trackcli config set playlist true       Descarga playlists completas por defecto
  trackcli config set cookies-browser chrome  Guarda el navegador para cookies
  trackcli config reset                   Restaura los valores por defecto

${color.bold('Ejemplos')}
  trackcli "Artista - Canción"
  trackcli "https://open.spotify.com/album/..." -o ~/Music
  trackcli lista.txt -c 4
  trackcli search "Artista - Canción" -m
  trackcli download "https://www.youtube.com/watch?v=..."
`;

function showHelp() {
  header();
  console.log(HELP);
}

export async function ask(question, defaultValue = '') {
  const suffix = defaultValue ? color.dim(` (${defaultValue})`) : '';
  const promptText = `${color.cyan('›')} ${question}${suffix}: `;

  if (!process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question(promptText);
    terminal.close();
    return answer.trim() || defaultValue;
  }

  const ac = new AbortController();
  const terminal = createInterface({ input: process.stdin, output: process.stdout });

  const onData = (chunk) => {
    if (chunk.length === 1 && chunk[0] === 0x1b) {
      ac.abort();
    }
  };
  process.stdin.on('data', onData);

  try {
    const answer = await terminal.question(promptText, { signal: ac.signal });
    return answer.trim() || defaultValue;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (process.stdout.isTTY) {
        process.stdout.write('\r\x1b[2K');
      }
      return null;
    }
    throw err;
  } finally {
    process.stdin.removeListener('data', onData);
    terminal.close();
  }
}

async function interactiveConfig(activeConfig) {
  while (true) {
    const cfg = await loadConfig();
    const configPath = getConfigPath();
    const lines = [
      `  ${color.dim('Formato         ')} ${color.bold(cfg.format)}`,
      `  ${color.dim('Destino         ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrencia    ')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Carátula        ')} ${color.bold(cfg.cover !== false ? 'habilitada' : 'deshabilitada')}`,
      `  ${color.dim('Sobrescritura   ')} ${color.bold(cfg.overwrite ? 'habilitada' : 'deshabilitada')}`,
      `  ${color.dim('Descarga playlist')} ${color.bold(cfg.playlist ? 'completa' : 'solo pista individual')}`,
    ];
    if (cfg.cookiesBrowser) {
      lines.push(`  ${color.dim('Cookies nav     ')} ${color.bold(cfg.cookiesBrowser)}`);
    }
    if (cfg.cookies) {
      lines.push(`  ${color.dim('Cookies doc     ')} ${color.dim(cfg.cookies)}`);
    }
    lines.push(`  ${color.dim('Archivo         ')} ${color.dim(configPath)}`);
    card('⚙ Configuración actual', lines);

    const CONFIG_ACTIONS = [
      { id: 'format', label: `Formato de audio (actual: ${cfg.format})` },
      { id: 'output', label: `Carpeta de destino (actual: ${cfg.output})` },
      { id: 'concurrency', label: `Concurrencia de descargas (actual: ${cfg.concurrency})` },
      { id: 'cover', label: `Carátula e imágenes ID3 (actual: ${cfg.cover !== false ? 'habilitada' : 'deshabilitada'})` },
      { id: 'overwrite', label: `Sobrescritura de archivos (actual: ${cfg.overwrite ? 'habilitada' : 'deshabilitada'})` },
      { id: 'playlist', label: `Descarga de playlists (actual: ${cfg.playlist ? 'completa' : 'solo pista individual'})` },
      { id: 'cookiesBrowser', label: `Cookies desde navegador (actual: ${cfg.cookiesBrowser || 'ninguno'})` },
      { id: 'cookies', label: `Archivo de cookies .txt (actual: ${cfg.cookies || 'ninguno'})` },
      { id: 'reset', label: 'Restablecer valores por defecto' },
      { id: 'back', label: '← Volver al menú principal' },
    ];

    const action = await selectItemInteractive(
      CONFIG_ACTIONS,
      (item) => item.label,
      ask,
      { title: color.bold('Selecciona una opción para configurar:'), clearOnSelect: true }
    );

    if (!action || action.id === 'back') {
      return cfg;
    }

    if (action.id === 'format') {
      const FORMAT_OPTIONS = [
        { id: 'mp3', label: 'mp3  · Máxima compatibilidad con cualquier reproductor' },
        { id: 'm4a', label: 'm4a  · AAC de alta calidad (ideal iPhone / Apple)' },
        { id: 'opus', label: 'opus · Original de YouTube sin recodificar (máxima fidelidad)' },
      ];
      const selectedFormat = await selectItemInteractive(
        FORMAT_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Selecciona el formato:'), clearOnSelect: true }
      );
      if (selectedFormat) {
        await setConfigValue('format', selectedFormat.id);
        console.log(mark('success', `Formato actualizado a: ${color.bold(selectedFormat.id)}\n`));
      }
    } else if (action.id === 'output') {
      const newOutput = await ask('Nueva carpeta de destino', cfg.output);
      if (newOutput === null) continue;
      if (newOutput && newOutput !== cfg.output) {
        await setConfigValue('output', newOutput);
        console.log(mark('success', `Carpeta actualizada a: ${color.bold(newOutput)}\n`));
      }
    } else if (action.id === 'concurrency') {
      const newConcurrency = await ask('Concurrencia (1 a 6 descargas simultáneas)', String(cfg.concurrency));
      if (newConcurrency === null) continue;
      if (newConcurrency) {
        try {
          await setConfigValue('concurrency', newConcurrency);
          console.log(mark('success', `Concurrencia actualizada a: ${color.bold(newConcurrency)}\n`));
        } catch (err) {
          console.log(mark('error', err.message + '\n'));
        }
      }
    } else if (action.id === 'cover') {
      const COVER_OPTIONS = [
        { id: 'true', label: 'Habilitada · Incrustar portada y metadatos ID3 completos (por defecto)' },
        { id: 'false', label: 'Deshabilitada · Descarga más rápida y ligera sin carátula (-m / --no-cover)' },
      ];
      const choice = await selectItemInteractive(
        COVER_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Carátula en archivos de audio:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('cover', choice.id);
        console.log(mark('success', `Carátula ${choice.id === 'true' ? 'habilitada' : 'deshabilitada'}\n`));
      }
    } else if (action.id === 'overwrite') {
      const OVERWRITE_OPTIONS = [
        { id: 'false', label: 'Deshabilitada · Omitir descarga si el archivo ya existe (seguro, por defecto)' },
        { id: 'true', label: 'Habilitada · Sobrescribir siempre archivos existentes (-f / --overwrite)' },
      ];
      const choice = await selectItemInteractive(
        OVERWRITE_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Sobrescritura de archivos:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('overwrite', choice.id);
        console.log(mark('success', `Sobrescritura ${choice.id === 'true' ? 'habilitada' : 'deshabilitada'}\n`));
      }
    } else if (action.id === 'playlist') {
      const PLAYLIST_OPTIONS = [
        { id: 'false', label: 'Solo pista individual · Ignorar list= en videos individuales (por defecto)' },
        { id: 'true', label: 'Descargar playlist completa · Descargar todos los videos de la lista (--playlist)' },
      ];
      const choice = await selectItemInteractive(
        PLAYLIST_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Comportamiento con playlists:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('playlist', choice.id);
        console.log(mark('success', `Comportamiento de playlist: ${choice.id === 'true' ? 'descargar completa' : 'solo pista individual'}\n`));
      }
    } else if (action.id === 'cookiesBrowser') {
      const BROWSER_OPTIONS = [
        { id: 'none', label: '(Ninguno) Desactivar cookies de navegador' },
        { id: 'chrome', label: 'Google Chrome' },
        { id: 'brave', label: 'Brave Browser' },
        { id: 'firefox', label: 'Mozilla Firefox' },
        { id: 'safari', label: 'Apple Safari' },
        { id: 'edge', label: 'Microsoft Edge' },
        { id: 'opera', label: 'Opera' },
        { id: 'vivaldi', label: 'Vivaldi' },
      ];
      const choice = await selectItemInteractive(
        BROWSER_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Navegador para extracción de cookies:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('cookies-browser', choice.id);
        console.log(mark('success', choice.id === 'none' ? 'Extracción de cookies desactivada.\n' : `Navegador configurado: ${color.bold(choice.id)}\n`));
      }
    } else if (action.id === 'cookies') {
      const currentVal = cfg.cookies || '';
      console.log(color.dim('Indica la ruta a un archivo cookies.txt de YouTube (escribe "none" para quitarlo).'));
      const newFile = await ask('Ruta del archivo cookies.txt', currentVal);
      if (newFile === null) continue;
      if (newFile !== undefined && newFile !== '') {
        await setConfigValue('cookies', newFile);
        console.log(mark('success', newFile === 'none' ? 'Archivo de cookies desvinculado.\n' : `Archivo de cookies guardado: ${color.bold(newFile)}\n`));
      }
    } else if (action.id === 'reset') {
      await resetConfig();
      console.log(mark('success', 'Configuración restablecida a los valores por defecto.\n'));
    }
  }
}

async function interactiveMenu(userConfig = {}) {
  if (!process.stdin.isTTY) {
    showHelp();
    return;
  }
  header();

  let activeConfig = { ...userConfig };

  const MENU_OPTIONS = [
    { id: 'search', label: 'Buscar y descargar canción' },
    { id: 'download', label: 'Descargar enlace o álbum (URL)' },
    { id: 'batch', label: 'Descargar desde un listado (.txt)' },
    { id: 'config', label: 'Configuración' },
    { id: 'doctor', label: 'Diagnóstico del sistema' },
    { id: 'exit', label: 'Salir' },
  ];

  while (true) {
    const selected = await selectItemInteractive(
      MENU_OPTIONS,
      (item) => item.label,
      ask,
      { title: color.bold('¿Qué deseas hacer?'), clearOnSelect: true }
    );

    if (!selected || selected.id === 'exit') {
      console.log(color.dim('\n✦ ¡Hasta luego!\n'));
      break;
    }

    if (selected.id === 'search') {
      const query = await ask('Canción o artista');
      if (query === null) continue;
      if (query) {
        console.log('');
        try {
          const tokens = ['--format', activeConfig.format || 'mp3', '--output', activeConfig.output || './trackcli-downloads'];
          await executeSearchInteractive(query, tokens, activeConfig);
        } catch (err) {
          console.log(mark('error', err.message));
        }
      }
      console.log('');
    } else if (selected.id === 'download') {
      const url = await ask('Enlace de YouTube, Spotify o Apple Music');
      if (url === null) continue;
      if (url) {
        console.log('');
        try {
          const tokens = [url, '--format', activeConfig.format || 'mp3', '--output', activeConfig.output || './trackcli-downloads'];
          await executeDownload(tokens, activeConfig);
        } catch (err) {
          console.log(mark('error', err.message));
        }
      }
      console.log('');
    } else if (selected.id === 'batch') {
      const filePath = await ask('Ruta del listado (.txt)');
      if (filePath === null) continue;
      if (filePath) {
        console.log('');
        try {
          const tokens = ['--format', activeConfig.format || 'mp3', '--output', activeConfig.output || './trackcli-downloads'];
          await executeBatch(filePath, tokens, activeConfig);
        } catch (err) {
          console.log(mark('error', err.message));
        }
      }
      console.log('');
    } else if (selected.id === 'config') {
      activeConfig = await interactiveConfig(activeConfig);
    } else if (selected.id === 'doctor') {
      await doctor();
      console.log('');
    }
  }
}

async function executeDownload(tokens, userConfig = {}) {
  const { options, positional } = parseOptions(tokens, userConfig);
  if (!positional.length) throw new Error('Indica al menos un enlace. Ejemplo: trackcli download <URL>');
  await ensureRequirements();

  if (positional.length === 1) {
    const url = positional[0];
    const jobs = [];
    if (isStreamingUrl(url)) {
      const spinner = createSpinner(`Extrayendo información de ${color.bold(url)}…`);
      const meta = await resolveStreamingMetadata(url);
      spinner.stop();
      if (!meta) {
        throw new Error(`No pude leer los metadatos de ${url}. Comprueba que sea un enlace público.`);
      }

      if (meta.isAlbum && meta.tracks?.length) {
        card(`✦ Álbum de ${meta.service} detectado (${meta.tracks.length} pistas)`, [
          `  ${color.dim('Álbum   ')} ${color.bold(meta.title)}`,
          `  ${color.dim('Artista ')} ${meta.artist || color.dim('(desconocido)')}`,
          `  ${color.dim('Año     ')} ${meta.year || color.dim('(desconocido)')}`,
          `  ${color.dim('Pistas  ')} ${meta.tracks.length} canciones`,
        ]);
        console.log('');

        const albumSpinner = createSpinner(`Localizando audio para ${meta.tracks.length} canciones en paralelo…`);
        const resolved = await resolveBatchEntries(meta.tracks.map((t) => t.query), options, (done, total, job) => {
          if (job?.display) {
            albumSpinner.update(`Analizando (${done}/${total}): ${job.display}`);
          }
        });
        albumSpinner.stop();

        for (let i = 0; i < meta.tracks.length; i++) {
          const trackMeta = meta.tracks[i];
          const matched = resolved[i];
          jobs.push({
            url: matched?.url || `ytsearch1:${trackMeta.query} audio`,
            metadata: {
              ...trackMeta,
              isAlbumTrack: true,
              album: meta.title || trackMeta.album,
              albumArtist: meta.artist || trackMeta.albumArtist || trackMeta.artist,
            },
          });
        }
      } else {
        if (!meta.query) {
          throw new Error(`No pude leer los metadatos de ${url}. Comprueba que sea un enlace público de una pista.`);
        }
        console.log(mark('info', `${meta.service}: ${color.bold(meta.title)} · ${meta.artist || color.dim('(desconocido)')}${meta.album ? color.dim(` [${meta.album}]`) : ''}\n`));
        const songSpinner = createSpinner(`Localizando audio oficial de ${color.bold(meta.title)}…`);
        try {
          const song = await findBestAudioSong(meta.query, meta.durationSeconds || 0);
          jobs.push({ url: song.url, metadata: meta });
        } finally {
          songSpinner.stop();
        }
      }
    } else {
      jobs.push({ url });
    }

    await executeQueue(jobs, options, true);
    return;
  }

  // Multiple URLs in download command: resolve in parallel
  const spinner = createSpinner(`Analizando ${positional.length} enlaces en paralelo…`);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const rawJobs = await mapConcurrent(positional, concurrency, async (url) => {
    if (isStreamingUrl(url)) {
      const meta = await resolveStreamingMetadata(url);
      if (!meta) return [{ url }];
      if (meta.isAlbum && meta.tracks?.length) {
        const resolved = await resolveBatchEntries(meta.tracks.map((t) => t.query), options);
        return meta.tracks.map((trackMeta, i) => ({
          url: resolved[i]?.url || `ytsearch1:${trackMeta.query} audio`,
          metadata: trackMeta,
        }));
      }
      if (meta.query) {
        try {
          const song = await findBestAudioSong(meta.query, meta.durationSeconds || 0);
          return [{ url: song.url, metadata: meta }];
        } catch {
          return [{ url: `ytsearch1:${meta.query} audio`, metadata: meta }];
        }
      }
    }
    return [{ url }];
  });
  spinner.stop();

  const jobs = rawJobs.flat().filter(Boolean);
  await executeQueue(jobs, options, true);
}

async function executeBatch(filename, tokens, userConfig = {}) {
  if (!filename || filename.startsWith('--')) throw new Error('Indica el archivo .txt. Ejemplo: trackcli batch lista.txt');
  const { options, positional } = parseOptions(tokens, userConfig);
  if (positional.length) throw new Error('El nombre del archivo debe ir inmediatamente después de batch.');
  const entries = await readQueue(filename);
  console.log(mark('info', `${color.bold(entries.length)} elemento${entries.length === 1 ? '' : 's'} en ${color.dim(filename)} (concurrencia: ${options.concurrency})\n`));
  await ensureRequirements();

  console.log(mark('info', `Destino: ${color.dim(options.output)}\n`));
  const startTime = Date.now();
  const results = await runBatchPipeline(entries, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  if (!results.length) {
    throw new Error('No encontré entradas descargables en la lista. Comprueba los enlaces públicos de Spotify o Apple Music.');
  }

  console.log('');
  if (successful === results.length) {
    card(color.green('✔ Descarga completada'), [
      `  ${color.dim('Pistas  ')} ${color.green(`${successful} descargada${successful === 1 ? '' : 's'}`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Destino ')} ${options.output}`,
    ]);
  } else {
    const failedLines = results
      .filter((item) => !item.ok)
      .map((item) => `  ${color.red('✖')} ${color.bold(item.display || item.title || item.url || 'Pista')}: ${color.dim(item.error || 'Fallo en descarga')}`);
    card(color.yellow('▲ Descarga con advertencias'), [
      `  ${color.dim('Pistas  ')} ${color.green(`${successful} completada${successful === 1 ? '' : 's'}`)} · ${color.red(`${failed} con error`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Destino ')} ${options.output}`,
      '',
      color.bold('Pistas omitidas o con error:'),
      ...failedLines.slice(0, 10),
      ...(failedLines.length > 10 ? [`  ${color.dim(`... y ${failedLines.length - 10} más`)}`] : []),
    ]);
  }
  if (failed) process.exitCode = 1;
}

async function executeSearchInteractive(initialQuery, tokens, userConfig = {}) {
  const { options } = parseOptions(tokens, userConfig);
  await ensureRequirements();

  let query = initialQuery;

  while (query) {
    const spinner = createSpinner(`Buscando ${color.bold(query)}…`);
    let candidates = [];
    try {
      candidates = await searchSongs(query, 5);
      spinner.stop();
    } catch {
      spinner.fail(`No se encontraron resultados para: ${query}`);
      const retryQuery = await ask('Ingresa otro término de búsqueda (o Enter para cancelar)');
      if (!retryQuery) return;
      query = retryQuery;
      continue;
    }

    if (!candidates.length) {
      console.log(mark('warning', 'No se encontraron resultados de audio.'));
      const retryQuery = await ask('Ingresa otro término de búsqueda (o Enter para cancelar)');
      if (!retryQuery) return;
      query = retryQuery;
      continue;
    }

    const best = candidates[0];
    const coverNotice = (options.cover === false || options.thumbnail === false) ? color.dim(' · sin portada') : '';
    const formatTag = `${options.format.toUpperCase()}${coverNotice}`;

    console.log(mark('info', `Encontrada: ${color.bold(best.title)} ${color.dim(`[${best.duration}] · ${best.uploader}`)} ${color.dim(`(${formatTag})`)}`));

    const confirmRaw = await ask('¿Es esta canción? [Y/n]', 'y');
    if (confirmRaw === null) return;
    const confirm = confirmRaw.toLowerCase();

    if (confirm === 'y' || confirm === 'yes' || confirm === 's' || confirm === 'si' || confirm === '') {
      await executeQueue([best.url], options, true);
      return;
    }

    const selected = await selectItemInteractive(
      candidates,
      (c) => `${c.title} ${color.dim(`[${c.duration}] · ${c.uploader}`)}`,
      ask,
      { title: color.bold('Selecciona una opción:'), clearOnSelect: true }
    );

    if (selected) {
      console.log(mark('info', `Seleccionada: ${color.bold(selected.title)} ${color.dim(`[${selected.duration}] · ${selected.uploader}`)} ${color.dim(`(${formatTag})`)}\n`));
      await executeQueue([selected.url], options, true);
      return;
    }

    const retryQuery = await ask('Ingresa otro término de búsqueda (o Enter para cancelar)');
    if (!retryQuery) {
      console.log(color.dim('Descarga cancelada.'));
      return;
    }
    query = retryQuery;
  }
}

async function executeSearch(tokens, userConfig = {}) {
  const { options, positional } = parseOptions(tokens, userConfig);
  const query = positional.join(' ').trim();
  if (!query) throw new Error('Indica el nombre de la canción. Ejemplo: trackcli search "Artista - Canción"');
  await ensureRequirements();

  const spinner = createSpinner(`Buscando ${color.bold(query)}…`);
  let song;
  try {
    song = await findBestAudioSong(query);
    spinner.stop();
  } catch (err) {
    spinner.fail(`No se encontraron resultados para: ${query}`);
    throw err;
  }

  const coverNotice = (options.cover === false || options.thumbnail === false) ? color.dim(' · sin portada') : '';
  const formatTag = `${options.format.toUpperCase()}${coverNotice}`;

  console.log(mark('info', `Encontrada: ${color.bold(song.title)} ${color.dim(`[${song.duration}] · ${song.uploader}`)} ${color.dim(`(${formatTag})`)}\n`));
  await executeQueue([song.url], options, true);
}

async function executeConfig(tokens) {
  header();
  const [subcommand, key, value] = tokens;

  if (!subcommand) {
    const cfg = await loadConfig();
    const configPath = getConfigPath();
    const lines = [
      `  ${color.dim('Formato         ')} ${color.bold(cfg.format)}`,
      `  ${color.dim('Destino         ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrencia    ')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Carátula        ')} ${color.bold(cfg.cover !== false ? 'habilitada' : 'deshabilitada')}`,
      `  ${color.dim('Sobrescritura   ')} ${color.bold(cfg.overwrite ? 'habilitada' : 'deshabilitada')}`,
      `  ${color.dim('Descarga playlist')} ${color.bold(cfg.playlist ? 'completa' : 'solo pista individual')}`,
    ];
    if (cfg.cookiesBrowser) {
      lines.push(`  ${color.dim('Cookies nav     ')} ${color.bold(cfg.cookiesBrowser)}`);
    }
    if (cfg.cookies) {
      lines.push(`  ${color.dim('Cookies doc     ')} ${color.dim(cfg.cookies)}`);
    }
    lines.push(`  ${color.dim('Archivo         ')} ${color.dim(configPath)}`);
    card('⚙ Configuración de TrackCLI', lines);
    console.log(`\n${color.bold('Comandos disponibles:')}`);
    console.log(`  ${color.cyan('trackcli config set <clave> <valor>')}`);
    console.log(`    ${color.dim('format          ')} mp3 | m4a | opus`);
    console.log(`    ${color.dim('output          ')} ~/Music`);
    console.log(`    ${color.dim('concurrency     ')} 1 a 6`);
    console.log(`    ${color.dim('cover           ')} true | false`);
    console.log(`    ${color.dim('overwrite       ')} true | false`);
    console.log(`    ${color.dim('playlist        ')} true | false`);
    console.log(`    ${color.dim('cookies-browser ')} chrome | brave | firefox | safari | edge | none`);
    console.log(`    ${color.dim('cookies         ')} /ruta/a/cookies.txt | none`);
    console.log(`  ${color.cyan('trackcli config reset')}               ${color.dim('Restaura los valores por defecto')}`);
    console.log(`  ${color.cyan('trackcli config path')}                ${color.dim('Muestra la ruta del archivo config.json')}\n`);
    return;
  }

  if (subcommand === 'path') {
    console.log(getConfigPath());
    return;
  }

  if (subcommand === 'reset') {
    await resetConfig();
    console.log(mark('success', 'Configuración restablecida a los valores por defecto.\n'));
    return;
  }

  if (subcommand === 'set') {
    if (!key || value === undefined) {
      throw new Error('Uso: trackcli config set <clave> <valor>. Ejemplo: trackcli config set format m4a');
    }
    const updated = await setConfigValue(key, value);
    console.log(mark('success', `Configuración actualizada: ${color.bold(key)} = ${color.bold(String(updated[key]))}\n`));
    return;
  }

  throw new Error(`Subcomando desconocido: "${subcommand}". Usa "trackcli config".`);
}

async function executeQueue(urls, options, requirementsAlreadyChecked = false) {
  if (!requirementsAlreadyChecked) await ensureRequirements();
  if (!urls.length) throw new Error('No hay pistas para descargar.');
  if (urls.length > 1) {
    console.log(mark('info', `Destino: ${color.dim(options.output)}\n`));
  }
  const startTime = Date.now();
  const results = await runQueue(urls, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  console.log('');
  if (successful === results.length) {
    if (urls.length === 1) {
      console.log(mark('success', `${color.green('Descarga completada')} ${color.dim(`(${elapsed}s) →`)} ${color.dim(options.output)}\n`));
    } else {
      card(color.green('✔ Descarga completada'), [
        `  ${color.dim('Pistas  ')} ${color.green(`${successful} descargada${successful === 1 ? '' : 's'}`)} ${color.dim(`(${elapsed}s)`)}`,
        `  ${color.dim('Destino ')} ${options.output}`,
      ]);
    }
  } else {
    const failedLines = results
      .filter((item) => !item.ok)
      .map((item) => `  ${color.red('✖')} ${color.bold(item.title || item.url || 'Pista')}: ${color.dim(item.error || 'Fallo en descarga')}`);
    card(color.yellow('▲ Descarga con advertencias'), [
      `  ${color.dim('Pistas  ')} ${color.green(`${successful} completada${successful === 1 ? '' : 's'}`)} · ${color.red(`${failed} con error`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Destino ')} ${options.output}`,
      '',
      color.bold('Pistas omitidas o con error:'),
      ...failedLines.slice(0, 10),
      ...(failedLines.length > 10 ? [`  ${color.dim(`... y ${failedLines.length - 10} más`)}`] : []),
    ]);
  }
  if (failed) process.exitCode = 1;
}

async function doctor() {
  header();
  const spinner = createSpinner('Verificando dependencias…');
  const status = await inspectRequirements();
  spinner.stop();

  card('◆ Diagnóstico del sistema', [
    `  ${color.dim('yt-dlp  ')} ${status.ytDlp ? mark('success', status.ytDlp) : mark('error', 'no encontrado')}`,
    `  ${color.dim('ffmpeg  ')} ${status.ffmpeg ? mark('success', status.ffmpeg) : mark('error', 'no encontrado')}`,
    `  ${color.dim('node    ')} ${mark('success', process.version)}`,
  ]);

  if (!status.ytDlp || !status.ffmpeg) {
    console.log(`\n${color.bold('Instalación:')}`);
    if (process.platform === 'darwin') console.log(`  ${color.cyan('brew install yt-dlp ffmpeg')}`);
    else if (process.platform === 'win32') console.log(`  ${color.cyan('winget install yt-dlp.yt-dlp Gyan.FFmpeg')}`);
    else console.log(`  ${color.cyan('sudo apt install yt-dlp ffmpeg')}`);
  }
}

async function update() {
  header();
  const spinner = createSpinner('Actualizando TrackCLI directamente desde GitHub…');

  const child = spawnTracked('npm', ['install', '--global', 'https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm is a .cmd shim on Windows. Its arguments are fixed constants here.
    shell: process.platform === 'win32',
  });

  let errorOut = '';
  child.stderr?.on('data', (d) => { errorOut += d; });

  const exitCode = await new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', resolve);
  });

  spinner.stop();

  if (exitCode === 0) {
    card(color.green('✔ TrackCLI actualizado con éxito'), [
      `  ${color.dim('Estado ')} ${color.green('Última versión instalada')}`,
      `  ${color.dim('Origen ')} GitHub (01-Menjivar/TrackCLI)`,
    ]);
  } else {
    card(color.yellow('▲ No se pudo completar la actualización automática'), [
      `  ${color.dim('Detalle')} ${errorOut.trim() || 'Error de permisos o conexión'}`,
      `  ${color.dim('Solución')}`,
      `  ${color.cyan('npm install -g https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz')}`,
    ]);
    process.exitCode = 1;
  }
}

export async function run(argv) {
  setupSignalHandlers();
  const userConfig = await loadConfig();
  const [command, ...rest] = argv;
  if (!command || command === 'interactive' || command === 'menu') return interactiveMenu(userConfig);
  if (['help', '--help', '-h'].includes(command)) return showHelp();
  if (['version', '--version', '-v'].includes(command)) return console.log(`TrackCLI ${VERSION}`);
  if (command === 'doctor') return doctor();
  if (command === 'update' || command === 'upgrade') return update();
  if (command === 'config') return executeConfig(rest);
  if (command === 'search' || command === 'find') {
    header();
    return executeSearch(rest, userConfig);
  }
  if (command === 'download' || command === 'get') {
    header();
    return executeDownload(rest, userConfig);
  }
  if (command === 'batch') {
    header();
    const [filename, ...tokens] = rest;
    return executeBatch(filename, tokens, userConfig);
  }

  // --- Despacho inteligente (Smart CLI Routing) ---
  if (isWebUrl(command) || isStreamingUrl(command)) {
    header();
    return executeDownload(argv, userConfig);
  }

  if (command.endsWith('.txt') || (existsSync(command) && statSync(command).isFile())) {
    header();
    return executeBatch(command, rest, userConfig);
  }

  if (!command.startsWith('-') || argv.some((arg) => !arg.startsWith('-'))) {
    header();
    if (process.stdin.isTTY && !argv.some((arg) => arg.startsWith('-'))) {
      const { positional } = parseOptions(argv, userConfig);
      const query = positional.join(' ').trim();
      if (query) {
        return executeSearchInteractive(query, argv.filter((a) => a.startsWith('-')), userConfig);
      }
    }
    return executeSearch(argv, userConfig);
  }

  throw new Error(`Comando no reconocido: "${command}". Usa "trackcli help".`);
}
