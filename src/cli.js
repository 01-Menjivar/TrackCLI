import { existsSync, statSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseOptions } from './args.js';
import { getConfigPath, loadConfig, resetConfig, setConfigValue } from './config.js';
import { findBestAudioSong, isStreamingUrl, isWebUrl, mapConcurrent, readQueue, resolveBatchEntries, resolveStreamingMetadata, runBatchPipeline, runQueue, searchSongs } from './download.js';
import { setupSignalHandlers, spawnTracked } from './process.js';
import { ensureRequirements, inspectRequirements } from './requirements.js';
import { card, color, createSpinner, header, mark, selectItemInteractive } from './ui.js';

const HELP = `
${color.bold('Uso')}
  trackcli                                modo interactivo guiado
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

async function ask(question, defaultValue = '') {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? color.dim(` (${defaultValue})`) : '';
  const answer = await terminal.question(`${color.cyan('›')} ${question}${suffix}: `);
  terminal.close();
  return answer.trim() || defaultValue;
}

async function guidedMode(userConfig = {}) {
  if (!process.stdin.isTTY) {
    showHelp();
    return;
  }
  header();

  card('Modo interactivo', [
    color.dim('Escribe una canción o enlace. Escribe /help para ver opciones.'),
  ]);
  console.log('');

  let defaultFormat = userConfig.format || 'mp3';
  let defaultOutput = userConfig.output || './trackcli-downloads';
  let askPreferences = true;

  while (true) {
    const source = await ask('Canción o enlace');
    if (!source || source === '/exit' || source === 'exit' || source === ':q') {
      console.log(color.dim('\n✦ Sesión finalizada.\n'));
      break;
    }

    if (source === '/help') {
      card('Comandos', [
        `  ${color.cyan('/config')}  ${color.dim('Cambiar formato y carpeta de destino')}`,
        `  ${color.cyan('/exit')}    ${color.dim('Finalizar la sesión interactiva')}`,
      ]);
      console.log('');
      continue;
    }

    if (source === '/config') {
      const format = (await ask('Formato [mp3/m4a/opus]', defaultFormat)).toLowerCase();
      defaultFormat = format;
      const output = await ask('Carpeta de destino', defaultOutput);
      defaultOutput = output;
      askPreferences = false;
      console.log('');
      continue;
    }

    if (askPreferences) {
      const format = (await ask('Formato [mp3/m4a/opus]', defaultFormat)).toLowerCase();
      defaultFormat = format;

      const output = await ask('Carpeta de destino', defaultOutput);
      defaultOutput = output;
      askPreferences = false;
    }

    console.log('');
    const tokens = ['--format', defaultFormat, '--output', defaultOutput];

    if (source.endsWith('.txt')) {
      await executeBatch(source, tokens, userConfig);
    } else if (isStreamingUrl(source)) {
      await executeDownload([source, ...tokens], userConfig);
    } else if (isWebUrl(source)) {
      await executeDownload([source, ...tokens], userConfig);
    } else {
      await executeSearchInteractive(source, tokens, userConfig);
    }

    console.log('');
    const continueChoice = (await ask('¿Descargar otra canción? [Y/n]', 'y')).toLowerCase();
    if (continueChoice === 'c' || continueChoice === 'config') {
      askPreferences = true;
      console.log('\n' + color.dim('─'.repeat(44)) + '\n');
      continue;
    }
    if (continueChoice === 'n' || continueChoice === 'no') {
      console.log(color.dim(`\n✦ ¡Listo! Tus canciones están en ${color.cyan(defaultOutput)}\n`));
      break;
    }
    console.log('\n' + color.dim('─'.repeat(44)) + '\n');
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
        card(`✦ Enlace de ${meta.service} detectado`, [
          `  ${color.dim('Título  ')} ${color.bold(meta.title)}`,
          `  ${color.dim('Artista ')} ${meta.artist || color.dim('(desconocido)')}`,
          `  ${color.dim('Álbum   ')} ${meta.album || color.dim('(desconocido)')}`,
        ]);
        console.log('');
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

    card('✦ Canción encontrada', [
      `  ${color.dim('Título  ')} ${color.bold(best.title)}`,
      `  ${color.dim('Artista ')} ${best.uploader}`,
      `  ${color.dim('Duración')} ${best.duration}`,
      `  ${color.dim('Formato ')} ${formatTag}`,
    ]);
    console.log('');

    const confirm = (await ask('¿Es esta canción? [Y/n]', 'y')).toLowerCase();

    if (confirm === 'y' || confirm === 'yes' || confirm === 's' || confirm === 'si' || confirm === '') {
      await executeQueue([best.url], options, true);
      return;
    }

    console.log(`\n${color.bold('Selecciona una opción:')}`);
    const selected = await selectItemInteractive(candidates, (c) => `${c.title} ${color.dim(`[${c.duration}] · ${c.uploader}`)}`, ask);

    if (selected) {
      card('✦ Opción seleccionada', [
        `  ${color.dim('Título  ')} ${color.bold(selected.title)}`,
        `  ${color.dim('Artista ')} ${selected.uploader}`,
        `  ${color.dim('Duración')} ${selected.duration}`,
        `  ${color.dim('Formato ')} ${formatTag}`,
      ]);
      console.log('');
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

  card('✦ Canción encontrada', [
    `  ${color.dim('Título  ')} ${color.bold(song.title)}`,
    `  ${color.dim('Artista ')} ${song.uploader}`,
    `  ${color.dim('Duración')} ${song.duration}`,
    `  ${color.dim('Formato ')} ${formatTag}`,
  ]);
  console.log('');
  await executeQueue([song.url], options, true);
}

async function executeConfig(tokens) {
  header();
  const [subcommand, key, value] = tokens;

  if (!subcommand) {
    const cfg = await loadConfig();
    const configPath = getConfigPath();
    card('⚙ Configuración de TrackCLI', [
      `  ${color.dim('Formato     ')} ${color.bold(cfg.format)}`,
      `  ${color.dim('Destino     ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrencia')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Carátula    ')} ${color.bold(cfg.cover !== false ? 'habilitada' : 'deshabilitada')}`,
      `  ${color.dim('Archivo     ')} ${color.dim(configPath)}`,
    ]);
    console.log(`\n${color.bold('Comandos disponibles:')}`);
    console.log(`  ${color.cyan('trackcli config set <clave> <valor>')}  ${color.dim('Ej: format m4a, output ~/Music, concurrency 4')}`);
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
    card(color.green('✔ Configuración restablecida a valores por defecto'), [
      `  ${color.dim('Formato     ')} mp3`,
      `  ${color.dim('Destino     ')} ./trackcli-downloads`,
      `  ${color.dim('Concurrencia')} 3`,
    ]);
    return;
  }

  if (subcommand === 'set') {
    if (!key || value === undefined) {
      throw new Error('Uso: trackcli config set <clave> <valor>. Ejemplo: trackcli config set format m4a');
    }
    const updated = await setConfigValue(key, value);
    card(color.green('✔ Opción actualizada correctamente'), [
      `  ${color.dim('Clave ')} ${color.bold(key)}`,
      `  ${color.dim('Valor ')} ${color.bold(String(updated[key]))}`,
      `  ${color.dim('Ruta  ')} ${color.dim(getConfigPath())}`,
    ]);
    return;
  }

  throw new Error(`Subcomando desconocido: "${subcommand}". Usa "trackcli config".`);
}

async function executeQueue(urls, options, requirementsAlreadyChecked = false) {
  if (!requirementsAlreadyChecked) await ensureRequirements();
  if (!urls.length) throw new Error('No hay pistas para descargar.');
  console.log(mark('info', `Destino: ${color.dim(options.output)}\n`));
  const startTime = Date.now();
  const results = await runQueue(urls, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  console.log('');
  if (successful === results.length) {
    card(color.green('✔ Descarga completada'), [
      `  ${color.dim('Pistas  ')} ${color.green(`${successful} descargada${successful === 1 ? '' : 's'}`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Destino ')} ${options.output}`,
    ]);
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
  if (!command) return guidedMode(userConfig);
  if (['help', '--help', '-h'].includes(command)) return showHelp();
  if (['version', '--version', '-v'].includes(command)) return console.log('TrackCLI 0.1.1');
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
