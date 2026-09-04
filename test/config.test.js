import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, getConfigPath, loadConfig, resetConfig, saveConfig, setConfigValue } from '../src/config.js';
import { parseOptions } from '../src/args.js';

test('loadConfig devuelve la configuración por defecto si el archivo no existe', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'trackcli-config-test-'));
  const originalEnv = process.env.TRACKCLI_CONFIG_DIR;
  process.env.TRACKCLI_CONFIG_DIR = tempDir;

  try {
    const config = await loadConfig();
    assert.deepEqual(config, DEFAULT_CONFIG);
  } finally {
    process.env.TRACKCLI_CONFIG_DIR = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('saveConfig y setConfigValue persisten cambios correctamente (5A)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'trackcli-config-test-'));
  const originalEnv = process.env.TRACKCLI_CONFIG_DIR;
  process.env.TRACKCLI_CONFIG_DIR = tempDir;

  try {
    await setConfigValue('format', 'opus');
    await setConfigValue('concurrency', '6');
    await setConfigValue('cover', 'false');
    await setConfigValue('output', '/custom/music');
    await setConfigValue('thumbnail', 'true');
    await setConfigValue('overwrite', 'true');
    await setConfigValue('playlist', 'true');

    const config = await loadConfig();
    assert.equal(config.format, 'opus');
    assert.equal(config.concurrency, 6);
    assert.equal(config.cover, true);
    assert.equal(config.output, '/custom/music');
    assert.equal(config.overwrite, true);
    assert.equal(config.playlist, true);

    // Valida errores en claves inválidas o valores incorrectos
    await assert.rejects(() => setConfigValue('invalidKey', 'foo'), /Clave de configuración inválida/);
    await assert.rejects(() => setConfigValue('format', 'mp4'), /Formato no válido/);
    await assert.rejects(() => setConfigValue('concurrency', '0'), /concurrencia debe ser un número/);
    await assert.rejects(() => setConfigValue('concurrency', '7'), /concurrencia debe ser un número/);

    // Reset restaura valores iniciales
    const reset = await resetConfig();
    assert.deepEqual(reset, DEFAULT_CONFIG);
  } finally {
    process.env.TRACKCLI_CONFIG_DIR = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('parseOptions adopta valores por defecto de la configuración global y permite sobrescribirlos con flags', () => {
  const userConfig = {
    format: 'm4a',
    output: '/var/music',
    concurrency: 5,
    cover: false,
    overwrite: true,
    playlist: true,
  };

  // Sin flags: adopta la configuración del usuario
  const { options: optsDefault } = parseOptions(['https://example.com/audio'], userConfig);
  assert.equal(optsDefault.format, 'm4a');
  assert.equal(optsDefault.output, '/var/music');
  assert.equal(optsDefault.concurrency, 5);
  assert.equal(optsDefault.cover, false);
  assert.equal(optsDefault.thumbnail, false);
  assert.equal(optsDefault.overwrite, true);
  assert.equal(optsDefault.playlist, true);

  // Con flags: los argumentos de línea de comandos tienen precedencia
  const { options: optsOverride } = parseOptions([
    'https://example.com/audio',
    '--format', 'opus',
    '-c', '6',
    '-o', './local',
    '--cover',
    '--no-overwrite',
    '--no-playlist',
  ], userConfig);
  assert.equal(optsOverride.format, 'opus');
  assert.equal(optsOverride.concurrency, 6);
  assert.equal(optsOverride.output, './local');
  assert.equal(optsOverride.cover, true);
  assert.equal(optsOverride.overwrite, false);
  assert.equal(optsOverride.playlist, false);
});
