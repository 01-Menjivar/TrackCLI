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

export async function loadConfig() {
  const filePath = getConfigPath();
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      output: parsed.output || DEFAULT_CONFIG.output,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config) {
  const filePath = getConfigPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

export async function setConfigValue(key, value) {
  const validKeys = new Set([
    'format', 'output', 'concurrency',
    'cover', 'minimal', 'thumbnail',
    'overwrite', 'force',
    'playlist',
  ]);
  if (!validKeys.has(key)) {
    throw new Error(`Clave de configuración inválida: "${key}". Claves permitidas: ${[...validKeys].join(', ')}.`);
  }

  const config = await loadConfig();

  if (key === 'format') {
    const validFormats = new Set(['mp3', 'm4a', 'opus']);
    if (!validFormats.has(value)) {
      throw new Error(`Formato no válido: ${value}. Usa: ${[...validFormats].join(', ')}.`);
    }
    config.format = value;
  } else if (key === 'concurrency') {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed < 1 || parsed > 6) {
      throw new Error('La concurrencia debe ser un número entre 1 y 6 (recomendado: 3).');
    }
    config.concurrency = parsed;
  } else if (key === 'cover' || key === 'thumbnail') {
    config.cover = value === 'true' || value === '1' || value === true;
  } else if (key === 'minimal') {
    config.cover = !(value === 'true' || value === '1' || value === true);
  } else if (key === 'overwrite' || key === 'force') {
    config.overwrite = value === 'true' || value === '1' || value === true;
  } else if (key === 'playlist') {
    config.playlist = value === 'true' || value === '1' || value === true;
  } else if (key === 'output') {
    config.output = String(value);
  }

  await saveConfig(config);
  return config;
}

export async function resetConfig() {
  await saveConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}
