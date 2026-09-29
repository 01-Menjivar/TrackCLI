import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_CONFIG = {
  format: 'mp3',
  output: join(process.cwd(), 'trackcli-downloads'),
  concurrency: 3,
  cover: true,
  overwrite: false,
  playlist: false,
};

export function getConfigDir() {
  if (process.env.TRACKCLI_CONFIG_DIR) {
    return process.env.TRACKCLI_CONFIG_DIR;
  }
  return join(homedir(), '.config', 'trackcli');
}

export function getConfigPath() {
  return join(getConfigDir(), 'config.json');
}

async function readStoredConfig() {
  const filePath = getConfigPath();
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(`Invalid configuration file: ${filePath}. Fix it or run "trackcli config reset".`);
  }
}

export async function loadConfig() {
  const stored = await readStoredConfig();
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    output: stored.output || DEFAULT_CONFIG.output,
  };
}

export async function saveConfig(config) {
  const filePath = getConfigPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function parseBooleanValue(key, value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid value for ${key}: "${value}". Use true or false.`);
}

export async function setConfigValue(key, value) {
  const validKeys = new Set([
    'format', 'output', 'concurrency',
    'cover', 'minimal', 'thumbnail',
    'overwrite', 'force',
    'playlist',
  ]);
  if (!validKeys.has(key)) {
    throw new Error(`Invalid configuration key: "${key}". Allowed keys: ${[...validKeys].join(', ')}.`);
  }

  // Work on what is stored on disk so defaults (e.g. the cwd-based output) are not pinned by an unrelated change.
  const config = await readStoredConfig();

  if (key === 'format') {
    const validFormats = new Set(['mp3', 'm4a', 'opus']);
    if (!validFormats.has(value)) {
      throw new Error(`Invalid format: ${value}. Use: ${[...validFormats].join(', ')}.`);
    }
    config.format = value;
  } else if (key === 'concurrency') {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed < 1 || parsed > 6) {
      throw new Error('Concurrency must be a number between 1 and 6 (recommended: 3).');
    }
    config.concurrency = parsed;
  } else if (key === 'cover' || key === 'thumbnail') {
    config.cover = parseBooleanValue(key, value);
  } else if (key === 'minimal') {
    config.cover = !parseBooleanValue(key, value);
  } else if (key === 'overwrite' || key === 'force') {
    config.overwrite = parseBooleanValue(key, value);
  } else if (key === 'playlist') {
    config.playlist = parseBooleanValue(key, value);
  } else if (key === 'output') {
    config.output = String(value);
  }

  await saveConfig(config);
  return { ...DEFAULT_CONFIG, ...config };
}

export async function resetConfig() {
  // Persist an empty config: DEFAULT_CONFIG.output depends on the cwd of the current run.
  await saveConfig({});
  return { ...DEFAULT_CONFIG };
}
