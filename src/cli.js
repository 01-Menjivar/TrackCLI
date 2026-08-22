import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseOptions } from './args.js';
import { getConfigPath, loadConfig, resetConfig, setConfigValue } from './config.js';
import { findBestAudioSong, isStreamingUrl, isWebUrl, readQueue, resolveBatchEntries, resolveStreamingMetadata, runQueue, searchSongs } from './download.js';
import { setupSignalHandlers, spawnTracked } from './process.js';
import { ensureRequirements, inspectRequirements } from './requirements.js';
import { card, color, createSpinner, header, mark, selectItemInteractive } from './ui.js';

const HELP = `
${color.bold('Uso')}
  trackcli                       modo interactivo
  trackcli search <canción>      busca y descarga una canción
  trackcli download <URL...>     descarga desde enlaces directos (YouTube, Spotify, Apple Music)
  trackcli batch <archivo.txt>   descarga desde un archivo de lista
  trackcli config [set|reset]    gestiona la configuración global de TrackCLI
  trackcli doctor                verifica dependencias del sistema
  trackcli update                actualiza TrackCLI a la versión más reciente

${color.bold('Opciones')}
  --format <mp3|m4a|opus>           Formato de audio (por defecto: mp3)
  --quality <0-10>                  Calidad VBR de MP3 (0 = máxima)
  --output <carpeta>                Directorio de destino (por defecto: ./trackcli-downloads)
  --concurrency, -c <1-16>          Descargas simultáneas en cola/lotes (por defecto: 3)
  --minimal, -m                     Modo minimal (solo audio, sin portada)
  --playlist                        Descargar playlist completa
  --no-thumbnail                    No incrustar portada
  --overwrite, -f                   Sobrescribir archivos si ya existen en destino

${color.bold('Configuración Global')}
  trackcli config                   Muestra las preferencias activas
  trackcli config set format m4a    Establece el formato por defecto
  trackcli config set output ~/Songs  Establece la carpeta de destino por defecto
  trackcli config reset             Restaura los valores por defecto

${color.bold('Ejemplos')}
  trackcli search "Artista - Cancion"
  trackcli search "Artista - Cancion" --minimal
  trackcli download "https://open.spotify.com/track/..."
  trackcli download "https://open.spotify.com/album/..."
  trackcli download <URL> -m
  trackcli batch lista.txt --format m4a -c 4
  trackcli update
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
    color.dim('Escribe el nombre de una canción, pega un enlace o indica un .txt.'),
    `${color.dim('Estructura recomendada:')} ${color.bold('Canción - Artista')} ${color.dim('(ej. Artista - Canción)')}`,
  ]);
  console.log('');

  let defaultFormat = userConfig.format || 'mp3';
  let defaultOutput = userConfig.output || './trackcli-downloads';

  while (true) {
    const source = await ask('Canción (Canción - Artista), enlace o .txt');
    if (!source) {
      console.log(color.dim('\n✦ Sesión finalizada.\n'));
      break;
    }

    const format = (await ask('Formato [mp3/m4a/opus]', defaultFormat)).toLowerCase();
    defaultFormat = format;

    const output = await ask('Carpeta de destino', defaultOutput);
    defaultOutput = output;

    console.log('');
    const tokens = ['--format', format, '--output', output];

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

  const jobs = [];
  for (const url of positional) {
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
            metadata: trackMeta,
          });
        }
        continue;
      }

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
      continue;
    }
    jobs.push({ url });
  }

  await executeQueue(jobs, options, true);
}

async function executeBatch(filename, tokens, userConfig = {}) {
  if (!filename || filename.startsWith('--')) throw new Error('Indica el archivo .txt. Ejemplo: trackcli batch lista.txt');
  const { options, positional } = parseOptions(tokens, userConfig);
  if (positional.length) throw new Error('El nombre del archivo debe ir inmediatamente después de batch.');
  const entries = await readQueue(filename);
  console.log(mark('info', `${color.bold(entries.length)} elemento${entries.length === 1 ? '' : 's'} en ${color.dim(filename)} (concurrencia: ${options.concurrency})\n`));
  await ensureRequirements();

  const spinner = createSpinner(`Analizando lista (${entries.length} entradas en paralelo)…`);
  const resolved = await resolveBatchEntries(entries, options, (done, total, job) => {
    if (job?.display) {
      spinner.update(`Analizando (${done}/${total}): ${job.display}`);
    } else {
      spinner.update(`Analizando lista (${done}/${total})…`);
    }
  });
  spinner.stop();

  const jobs = resolved.filter(Boolean);
  if (!jobs.length) {
    throw new Error('No encontré entradas descargables en la lista. Comprueba los enlaces públicos de Spotify o Apple Music.');
  }

  for (const job of jobs) {
    if (job.display) {
      console.log(mark('step', `${color.dim(job.display)}`));
    }
  }

  console.log('');
  await executeQueue(jobs, options, true);
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
    const formatTag = `${options.format.toUpperCase()} ${color.dim(`(calidad ${options.quality})`)}${options.minimal ? color.dim(' · minimal (sin portada)') : ''}`;

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
  if (!query) throw new Error('Indica el nombre de la canción. Ejemplo: trackcli search "Sway - Tove Styrke"');
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

  const formatTag = `${options.format.toUpperCase()} ${color.dim(`(calidad ${options.quality})`)}${options.minimal ? color.dim(' · minimal (sin portada)') : ''}`;

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
      `  ${color.dim('Calidad     ')} ${color.bold(cfg.quality)}`,
      `  ${color.dim('Destino     ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrencia')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Minimal     ')} ${color.bold(String(cfg.minimal))}`,
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
      `  ${color.dim('Formato     ')} mp3 (calidad 0)`,
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
    card(color.yellow('▲ Descarga con advertencias'), [
      `  ${color.dim('Pistas  ')} ${color.green(`${successful} completada${successful === 1 ? '' : 's'}`)} · ${color.red(`${failed} con error`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Destino ')} ${options.output}`,
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
  throw new Error(`Comando no reconocido: "${command}". Usa "trackcli help".`);
}
