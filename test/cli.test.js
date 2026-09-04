import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.js';

test('Smart CLI Routing: detecta y procesa ayuda y versión', async () => {
  let logOut = '';
  const originalLog = console.log;
  console.log = (...args) => { logOut += args.join(' ') + '\n'; };

  try {
    await run(['--version']);
    assert.ok(logOut.includes('TrackCLI'));

    logOut = '';
    await run(['--help']);
    assert.ok(logOut.includes('Uso'));
    assert.ok(logOut.includes('trackcli <canción>'));
  } finally {
    console.log = originalLog;
  }
});

test('Smart CLI Routing: rechaza comandos y banderas inválidas', async () => {
  await assert.rejects(
    () => run(['--opcion-invalida']),
    /Comando no reconocido/
  );

  await assert.rejects(
    () => run(['Artista - Canción', '--opcion-invalida']),
    /No conozco la opción --opcion-invalida/
  );
});

test('Smart CLI Routing: sin argumentos en entorno no-TTY muestra ayuda', async () => {
  let logOut = '';
  const originalLog = console.log;
  console.log = (...args) => { logOut += args.join(' ') + '\n'; };

  try {
    await run([]);
    assert.ok(logOut.includes('TrackCLI'));
    assert.ok(logOut.includes('menú interactivo'));
  } finally {
    console.log = originalLog;
  }
});
