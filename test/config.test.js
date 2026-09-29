import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    await assert.rejects(() => setConfigValue('invalidKey', 'foo'), /Invalid configuration key/);
    await assert.rejects(() => setConfigValue('format', 'mp4'), /Invalid format/);
    await assert.rejects(() => setConfigValue('concurrency', '0'), /Concurrency must be a number/);
    await assert.rejects(() => setConfigValue('concurrency', '7'), /Concurrency must be a number/);

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

async function withTempConfigDir(fn) {
  const tempDir = await mkdtemp(join(tmpdir(), 'trackcli-config-test-'));
  const originalEnv = process.env.TRACKCLI_CONFIG_DIR;
  process.env.TRACKCLI_CONFIG_DIR = tempDir;
  try {
    await fn(tempDir);
  } finally {
    if (originalEnv === undefined) delete process.env.TRACKCLI_CONFIG_DIR;
    else process.env.TRACKCLI_CONFIG_DIR = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('loadConfig y setConfigValue fallan con un mensaje claro si el JSON está corrupto, y reset lo repara', async () => {
  await withTempConfigDir(async () => {
    await mkdir(dirname(getConfigPath()), { recursive: true });
    await writeFile(getConfigPath(), '{ not json', 'utf8');

    await assert.rejects(() => loadConfig(), /Invalid configuration file/);
    await assert.rejects(() => setConfigValue('format', 'opus'), /Invalid configuration file/);
    assert.equal(await readFile(getConfigPath(), 'utf8'), '{ not json');

    await resetConfig();
    assert.deepEqual(await loadConfig(), DEFAULT_CONFIG);
  });
});

test('setConfigValue y resetConfig no fijan en disco el output por defecto dependiente del cwd', async () => {
  await withTempConfigDir(async () => {
    await setConfigValue('format', 'm4a');
    assert.deepEqual(JSON.parse(await readFile(getConfigPath(), 'utf8')), { format: 'm4a' });

    await resetConfig();
    assert.deepEqual(JSON.parse(await readFile(getConfigPath(), 'utf8')), {});
  });
});

test('setConfigValue acepta variantes booleanas y rechaza valores ambiguos', async () => {
  await withTempConfigDir(async () => {
    await setConfigValue('overwrite', 'yes');
    assert.equal((await loadConfig()).overwrite, true);
    await setConfigValue('overwrite', 'off');
    assert.equal((await loadConfig()).overwrite, false);
    await setConfigValue('minimal', 'on');
    assert.equal((await loadConfig()).cover, false);

    await assert.rejects(() => setConfigValue('playlist', 'maybe'), /Invalid value for playlist/);
    await assert.rejects(() => setConfigValue('cover', ''), /Invalid value for cover/);
    assert.equal((await loadConfig()).playlist, false);
  });
});
