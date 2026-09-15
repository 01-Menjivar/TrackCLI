import { existsSync, statSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseOptions, sanitizeMediaUrl, sanitizeSearchQuery } from './args.js';
import { getConfigPath, loadConfig, resetConfig, setConfigValue } from './config.js';
import { findBestAudioSong, isStreamingUrl, isWebUrl, mapConcurrent, readQueue, resolveBatchEntries, resolveStreamingMetadata, runBatchPipeline, runQueue, searchSongs } from './download.js';
import { setupSignalHandlers, spawnTracked } from './process.js';
import { ensureRequirements, inspectRequirements } from './requirements.js';
import { card, color, createSpinner, header, mark, selectItemInteractive, VERSION } from './ui.js';

const HELP = `
${color.bold('Usage')}
  trackcli                                interactive menu (search, downloads, config)
  trackcli <song>                         search and download a track
  trackcli <URL...>                       download from links (Spotify, Apple Music, YouTube)
  trackcli <file.txt>                     batch download from a list file
  trackcli search <song>                  explicit search
  trackcli download <URL...>              explicit download from links
  trackcli batch <file.txt>               explicit batch download from file
  trackcli config [set|reset]             manage TrackCLI global configuration
  trackcli doctor                         verify system dependencies
  trackcli update                         update TrackCLI to the latest version

${color.bold('Options')}
  --format <mp3|m4a|opus>                 Audio format (default: mp3)
  -o, --output <directory>                Destination folder (default: ./trackcli-downloads)
  -c, --concurrency <1-6>                 Simultaneous downloads in queues/batches (default: 3)
  -m, --no-cover                          Fast download without embedding cover art
  -f, --overwrite                         Overwrite files if they already exist in destination

${color.bold('Global Configuration')}
  trackcli config                         Display active preferences
  trackcli config set format opus         Set default audio format
  trackcli config set output ~/Music      Set default output directory
  trackcli config set concurrency 4       Set default download concurrency
  trackcli config set cover false         Disable cover art embedding by default
  trackcli config set overwrite true      Overwrite existing files by default
  trackcli config set playlist true       Download entire playlists by default
  trackcli config reset                   Reset configuration to default values

${color.bold('Examples')}
  trackcli "Artist - Song"
  trackcli "https://open.spotify.com/album/..." -o ~/Music
  trackcli list.txt -c 4
  trackcli search "Artist - Song" -m
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
      `  ${color.dim('Format          ')} ${color.bold(cfg.format)}`,
      `  ${color.dim('Output          ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrency     ')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Cover art       ')} ${color.bold(cfg.cover !== false ? 'enabled' : 'disabled')}`,
      `  ${color.dim('Overwrite       ')} ${color.bold(cfg.overwrite ? 'enabled' : 'disabled')}`,
      `  ${color.dim('Playlist mode   ')} ${color.bold(cfg.playlist ? 'full playlist' : 'single track only')}`,
    ];
    lines.push(`  ${color.dim('Config file     ')} ${color.dim(configPath)}`);
    card('⚙ Current Configuration', lines);

    const CONFIG_ACTIONS = [
      { id: 'format', label: `Audio format (current: ${cfg.format})` },
      { id: 'output', label: `Output directory (current: ${cfg.output})` },
      { id: 'concurrency', label: `Download concurrency (current: ${cfg.concurrency})` },
      { id: 'cover', label: `Cover art & ID3 tags (current: ${cfg.cover !== false ? 'enabled' : 'disabled'})` },
      { id: 'overwrite', label: `File overwrite (current: ${cfg.overwrite ? 'enabled' : 'disabled'})` },
      { id: 'playlist', label: `Playlist behavior (current: ${cfg.playlist ? 'full playlist' : 'single track only'})` },
      { id: 'reset', label: 'Reset to default values' },
      { id: 'back', label: '← Back to main menu' },
    ];

    const action = await selectItemInteractive(
      CONFIG_ACTIONS,
      (item) => item.label,
      ask,
      { title: color.bold('Select an option to configure:'), clearOnSelect: true }
    );

    if (!action || action.id === 'back') {
      return cfg;
    }

    if (action.id === 'format') {
      const FORMAT_OPTIONS = [
        { id: 'mp3', label: 'mp3  · Maximum compatibility with any player' },
        { id: 'm4a', label: 'm4a  · High quality AAC (ideal for iPhone / Apple devices)' },
        { id: 'opus', label: 'opus · Original YouTube stream without re-encoding (highest fidelity)' },
      ];
      const selectedFormat = await selectItemInteractive(
        FORMAT_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Select audio format:'), clearOnSelect: true }
      );
      if (selectedFormat) {
        await setConfigValue('format', selectedFormat.id);
        console.log(mark('success', `Format updated to: ${color.bold(selectedFormat.id)}\n`));
      }
    } else if (action.id === 'output') {
      const newOutput = await ask('New destination directory', cfg.output);
      if (newOutput === null) continue;
      if (newOutput && newOutput !== cfg.output) {
        await setConfigValue('output', newOutput);
        console.log(mark('success', `Output directory updated to: ${color.bold(newOutput)}\n`));
      }
    } else if (action.id === 'concurrency') {
      const newConcurrency = await ask('Concurrency (1 to 6 simultaneous downloads)', String(cfg.concurrency));
      if (newConcurrency === null) continue;
      if (newConcurrency) {
        try {
          await setConfigValue('concurrency', newConcurrency);
          console.log(mark('success', `Concurrency updated to: ${color.bold(newConcurrency)}\n`));
        } catch (err) {
          console.log(mark('error', err.message + '\n'));
        }
      }
    } else if (action.id === 'cover') {
      const COVER_OPTIONS = [
        { id: 'true', label: 'Enabled · Embed cover art and full ID3 metadata (default)' },
        { id: 'false', label: 'Disabled · Faster and lightweight download without cover (-m / --no-cover)' },
      ];
      const choice = await selectItemInteractive(
        COVER_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Cover art in audio files:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('cover', choice.id);
        console.log(mark('success', `Cover art ${choice.id === 'true' ? 'enabled' : 'disabled'}\n`));
      }
    } else if (action.id === 'overwrite') {
      const OVERWRITE_OPTIONS = [
        { id: 'false', label: 'Disabled · Skip download if file already exists (safe, default)' },
        { id: 'true', label: 'Enabled · Always overwrite existing files (-f / --overwrite)' },
      ];
      const choice = await selectItemInteractive(
        OVERWRITE_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('File overwrite:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('overwrite', choice.id);
        console.log(mark('success', `File overwrite ${choice.id === 'true' ? 'enabled' : 'disabled'}\n`));
      }
    } else if (action.id === 'playlist') {
      const PLAYLIST_OPTIONS = [
        { id: 'false', label: 'Single track only · Ignore list= on individual videos (default)' },
        { id: 'true', label: 'Download entire playlist · Download all videos in the playlist (--playlist)' },
      ];
      const choice = await selectItemInteractive(
        PLAYLIST_OPTIONS,
        (item) => item.label,
        ask,
        { title: color.bold('Playlist behavior:'), clearOnSelect: true }
      );
      if (choice) {
        await setConfigValue('playlist', choice.id);
        console.log(mark('success', `Playlist behavior: ${choice.id === 'true' ? 'download entire playlist' : 'single track only'}\n`));
      }
    } else if (action.id === 'reset') {
      await resetConfig();
      console.log(mark('success', 'Configuration reset to default values.\n'));
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
    { id: 'search', label: 'Search and download track' },
    { id: 'download', label: 'Download link or album (URL)' },
    { id: 'batch', label: 'Download from list file (.txt)' },
    { id: 'config', label: 'Settings & Configuration' },
    { id: 'doctor', label: 'System Diagnostics' },
    { id: 'exit', label: 'Exit' },
  ];

  while (true) {
    const selected = await selectItemInteractive(
      MENU_OPTIONS,
      (item) => item.label,
      ask,
      { title: color.bold('What would you like to do?'), clearOnSelect: true }
    );

    if (!selected || selected.id === 'exit') {
      console.log(color.dim('\n✦ Goodbye!\n'));
      break;
    }

    if (selected.id === 'search') {
      const rawQuery = await ask('Artist - Song');
      if (rawQuery === null) continue;
      const query = sanitizeSearchQuery(rawQuery);
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
      const rawUrl = await ask('YouTube, Spotify, or Apple Music link');
      if (rawUrl === null) continue;
      const url = isWebUrl(rawUrl) ? sanitizeMediaUrl(rawUrl, activeConfig) : sanitizeSearchQuery(rawUrl);
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
      const rawFilePath = await ask('Path to list file (.txt)');
      if (rawFilePath === null) continue;
      const filePath = rawFilePath.trim().replace(/^['"]+|['"]+$/g, '');
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
  if (!positional.length) throw new Error('Specify at least one link. Example: trackcli download <URL>');
  await ensureRequirements();

  const sanitizedPositional = positional.map((url) => isWebUrl(url) ? sanitizeMediaUrl(url, options) : sanitizeSearchQuery(url));

  if (sanitizedPositional.length === 1) {
    const url = sanitizedPositional[0];
    const jobs = [];
    if (isStreamingUrl(url)) {
      const spinner = createSpinner(`Extracting information from ${color.bold(url)}…`);
      const meta = await resolveStreamingMetadata(url);
      spinner.stop();
      if (!meta) {
        throw new Error(`Could not read metadata from ${url}. Make sure it is a public link.`);
      }

      if (meta.isAlbum && meta.tracks?.length) {
        card(`✦ ${meta.service} album detected (${meta.tracks.length} tracks)`, [
          `  ${color.dim('Album   ')} ${color.bold(meta.title)}`,
          `  ${color.dim('Artist  ')} ${meta.artist || color.dim('(unknown)')}`,
          `  ${color.dim('Year    ')} ${meta.year || color.dim('(unknown)')}`,
          `  ${color.dim('Tracks  ')} ${meta.tracks.length} songs`,
        ]);
        console.log('');

        const albumSpinner = createSpinner(`Locating audio for ${meta.tracks.length} songs in parallel…`);
        const resolved = await resolveBatchEntries(meta.tracks.map((t) => t.query), options, (done, total, job) => {
          if (job?.display) {
            albumSpinner.update(`Analyzing (${done}/${total}): ${job.display}`);
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
          throw new Error(`Could not read metadata from ${url}. Make sure it is a public track link.`);
        }
        console.log(mark('info', `${meta.service}: ${color.bold(meta.title)} · ${meta.artist || color.dim('(unknown)')}${meta.album ? color.dim(` [${meta.album}]`) : ''}\n`));
        const songSpinner = createSpinner(`Locating official audio for ${color.bold(meta.title)}…`);
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
  const spinner = createSpinner(`Analyzing ${sanitizedPositional.length} links in parallel…`);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const rawJobs = await mapConcurrent(sanitizedPositional, concurrency, async (url) => {
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
  if (!filename || filename.startsWith('--')) throw new Error('Specify the .txt file. Example: trackcli batch list.txt');
  const { options, positional } = parseOptions(tokens, userConfig);
  if (positional.length) throw new Error('The file name must immediately follow batch.');
  const entries = await readQueue(filename);
  console.log(mark('info', `${color.bold(entries.length)} item${entries.length === 1 ? '' : 's'} in ${color.dim(filename)} (concurrency: ${options.concurrency})\n`));
  await ensureRequirements();

  console.log(mark('info', `Destination: ${color.dim(options.output)}\n`));
  const startTime = Date.now();
  const results = await runBatchPipeline(entries, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  if (!results.length) {
    throw new Error('No downloadable entries found in the list. Check your Spotify or Apple Music links.');
  }

  console.log('');
  if (successful === results.length) {
    card(color.green('✔ Download completed'), [
      `  ${color.dim('Tracks  ')} ${color.green(`${successful} downloaded`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Output  ')} ${options.output}`,
    ]);
  } else {
    const failedLines = results
      .filter((item) => !item.ok)
      .map((item) => `  ${color.red('✖')} ${color.bold(item.display || item.title || item.url || 'Track')}: ${color.dim(item.error || 'Download failed')}`);
    card(color.yellow('▲ Download with warnings'), [
      `  ${color.dim('Tracks  ')} ${color.green(`${successful} completed`)} · ${color.red(`${failed} failed`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Output  ')} ${options.output}`,
      '',
      color.bold('Skipped or failed tracks:'),
      ...failedLines.slice(0, 10),
      ...(failedLines.length > 10 ? [`  ${color.dim(`... and ${failedLines.length - 10} more`)}`] : []),
    ]);
  }
  if (failed) process.exitCode = 1;
}

async function executeSearchInteractive(initialQuery, tokens, userConfig = {}) {
  const { options } = parseOptions(tokens, userConfig);
  await ensureRequirements();

  let query = sanitizeSearchQuery(initialQuery);

  while (query) {
    const spinner = createSpinner(`Searching for ${color.bold(query)}…`);
    let candidates = [];
    try {
      candidates = await searchSongs(query, 5);
      spinner.stop();
    } catch {
      spinner.fail(`No results found for: ${query}`);
      const retryQuery = await ask('Enter another search query (or Enter to cancel)');
      if (!retryQuery) return;
      query = sanitizeSearchQuery(retryQuery);
      continue;
    }

    if (!candidates.length) {
      console.log(mark('warning', 'No audio results found.'));
      const retryQuery = await ask('Enter another search query (or Enter to cancel)');
      if (!retryQuery) return;
      query = sanitizeSearchQuery(retryQuery);
      continue;
    }

    const best = candidates[0];
    const coverNotice = (options.cover === false || options.thumbnail === false) ? color.dim(' · no cover') : '';
    const formatTag = `${options.format.toUpperCase()}${coverNotice}`;

    console.log(mark('info', `Found: ${color.bold(best.title)} ${color.dim(`[${best.duration}] · ${best.uploader}`)} ${color.dim(`(${formatTag})`)}`));

    const confirmRaw = await ask('Is this the track? [Y/n]', 'y');
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
      { title: color.bold('Select an option:'), clearOnSelect: true }
    );

    if (selected) {
      console.log(mark('info', `Selected: ${color.bold(selected.title)} ${color.dim(`[${selected.duration}] · ${selected.uploader}`)} ${color.dim(`(${formatTag})`)}\n`));
      await executeQueue([selected.url], options, true);
      return;
    }

    const retryQuery = await ask('Enter another search query (or Enter to cancel)');
    if (!retryQuery) {
      console.log(color.dim('Download cancelled.'));
      return;
    }
    query = sanitizeSearchQuery(retryQuery);
  }
}

async function executeSearch(tokens, userConfig = {}) {
  const { options, positional } = parseOptions(tokens, userConfig);
  const query = sanitizeSearchQuery(positional.join(' '));
  if (!query) throw new Error('Specify the track name. Example: trackcli search "Artist - Song"');
  await ensureRequirements();

  const spinner = createSpinner(`Searching for ${color.bold(query)}…`);
  let song;
  try {
    song = await findBestAudioSong(query);
    spinner.stop();
  } catch (err) {
    spinner.fail(`No results found for: ${query}`);
    throw err;
  }

  const coverNotice = (options.cover === false || options.thumbnail === false) ? color.dim(' · no cover') : '';
  const formatTag = `${options.format.toUpperCase()}${coverNotice}`;

  console.log(mark('info', `Found: ${color.bold(song.title)} ${color.dim(`[${song.duration}] · ${song.uploader}`)} ${color.dim(`(${formatTag})`)}\n`));
  await executeQueue([song.url], options, true);
}

async function executeConfig(tokens) {
  header();
  const [subcommand, key, value] = tokens;

  if (!subcommand) {
    const cfg = await loadConfig();
    const configPath = getConfigPath();
    const lines = [
      `  ${color.dim('Format          ')} ${color.bold(cfg.format)}`,
      `  ${color.dim('Output          ')} ${color.bold(cfg.output)}`,
      `  ${color.dim('Concurrency     ')} ${color.bold(String(cfg.concurrency))}`,
      `  ${color.dim('Cover art       ')} ${color.bold(cfg.cover !== false ? 'enabled' : 'disabled')}`,
      `  ${color.dim('Overwrite       ')} ${color.bold(cfg.overwrite ? 'enabled' : 'disabled')}`,
      `  ${color.dim('Playlist mode   ')} ${color.bold(cfg.playlist ? 'full playlist' : 'single track only')}`,
    ];
    lines.push(`  ${color.dim('Config file     ')} ${color.dim(configPath)}`);
    card('⚙ TrackCLI Configuration', lines);
    console.log(`\n${color.bold('Available commands:')}`);
    console.log(`  ${color.cyan('trackcli config set <key> <value>')}`);
    console.log(`    ${color.dim('format          ')} mp3 | m4a | opus`);
    console.log(`    ${color.dim('output          ')} ~/Music`);
    console.log(`    ${color.dim('concurrency     ')} 1 to 6`);
    console.log(`    ${color.dim('cover           ')} true | false`);
    console.log(`    ${color.dim('overwrite       ')} true | false`);
    console.log(`    ${color.dim('playlist        ')} true | false`);
    console.log(`  ${color.cyan('trackcli config reset')}               ${color.dim('Reset configuration to default values')}`);
    console.log(`  ${color.cyan('trackcli config path')}                ${color.dim('Display path to config.json file')}\n`);
    return;
  }

  if (subcommand === 'path') {
    console.log(getConfigPath());
    return;
  }

  if (subcommand === 'reset') {
    await resetConfig();
    console.log(mark('success', 'Configuration reset to default values.\n'));
    return;
  }

  if (subcommand === 'set') {
    if (!key || value === undefined) {
      throw new Error('Usage: trackcli config set <key> <value>. Example: trackcli config set format m4a');
    }
    const updated = await setConfigValue(key, value);
    console.log(mark('success', `Configuration updated: ${color.bold(key)} = ${color.bold(String(updated[key]))}\n`));
    return;
  }

  throw new Error(`Unknown subcommand: "${subcommand}". Run "trackcli config".`);
}

async function executeQueue(urls, options, requirementsAlreadyChecked = false) {
  if (!requirementsAlreadyChecked) await ensureRequirements();
  if (!urls.length) throw new Error('No tracks to download.');
  if (urls.length > 1) {
    console.log(mark('info', `Destination: ${color.dim(options.output)}\n`));
  }
  const startTime = Date.now();
  const results = await runQueue(urls, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  console.log('');
  if (successful === results.length) {
    if (urls.length === 1) {
      console.log(mark('success', `${color.green('Download completed')} ${color.dim(`(${elapsed}s) →`)} ${color.dim(options.output)}\n`));
    } else {
      card(color.green('✔ Download completed'), [
        `  ${color.dim('Tracks  ')} ${color.green(`${successful} downloaded`)} ${color.dim(`(${elapsed}s)`)}`,
        `  ${color.dim('Output  ')} ${options.output}`,
      ]);
    }
  } else {
    const failedLines = results
      .filter((item) => !item.ok)
      .map((item) => `  ${color.red('✖')} ${color.bold(item.title || item.url || 'Track')}: ${color.dim(item.error || 'Download failed')}`);
    card(color.yellow('▲ Download with warnings'), [
      `  ${color.dim('Tracks  ')} ${color.green(`${successful} completed`)} · ${color.red(`${failed} failed`)} ${color.dim(`(${elapsed}s)`)}`,
      `  ${color.dim('Output  ')} ${options.output}`,
      '',
      color.bold('Skipped or failed tracks:'),
      ...failedLines.slice(0, 10),
      ...(failedLines.length > 10 ? [`  ${color.dim(`... and ${failedLines.length - 10} more`)}`] : []),
    ]);
  }
  if (failed) process.exitCode = 1;
}

async function doctor() {
  header();
  const spinner = createSpinner('Checking dependencies…');
  const status = await inspectRequirements();
  spinner.stop();

  card('◆ System Diagnostics', [
    `  ${color.dim('yt-dlp  ')} ${status.ytDlp ? mark('success', status.ytDlp) : mark('error', 'not found')}`,
    `  ${color.dim('ffmpeg  ')} ${status.ffmpeg ? mark('success', status.ffmpeg) : mark('error', 'not found')}`,
    `  ${color.dim('node    ')} ${mark('success', process.version)}`,
  ]);

  if (!status.ytDlp || !status.ffmpeg) {
    console.log(`\n${color.bold('Installation:')}`);
    if (process.platform === 'darwin') console.log(`  ${color.cyan('brew install yt-dlp ffmpeg')}`);
    else if (process.platform === 'win32') console.log(`  ${color.cyan('winget install yt-dlp.yt-dlp Gyan.FFmpeg')}`);
    else console.log(`  ${color.cyan('sudo apt install yt-dlp ffmpeg')}`);
  }
}

async function update() {
  header();
  const spinner = createSpinner('Updating TrackCLI directly from GitHub…');

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
    card(color.green('✔ TrackCLI updated successfully'), [
      `  ${color.dim('Status ')} ${color.green('Latest version installed')}`,
      `  ${color.dim('Source ')} GitHub (01-Menjivar/TrackCLI)`,
    ]);
  } else {
    card(color.yellow('▲ Could not complete automatic update'), [
      `  ${color.dim('Detail ')} ${errorOut.trim() || 'Permission or network error'}`,
      `  ${color.dim('Action ')}`,
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

  throw new Error(`Unrecognized command: "${command}". Run "trackcli help".`);
}
