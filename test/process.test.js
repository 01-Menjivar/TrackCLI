import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { escapeShellArgForWindows, getActiveChildCount, killActiveChildProcesses, registerChildProcess, unregisterChildProcess } from '../src/process.js';
import { hideCursor, showCursor } from '../src/ui.js';

test('registerChildProcess y unregisterChildProcess gestionan subprocesos activos', () => {
  const fakeChild = new EventEmitter();
  fakeChild.killed = false;
  fakeChild.kill = () => { fakeChild.killed = true; };

  registerChildProcess(fakeChild);
  assert.ok(getActiveChildCount() >= 1);

  fakeChild.emit('close');
  assert.equal(getActiveChildCount(), 0);
});

test('killActiveChildProcesses termina todos los procesos registrados', () => {
  const child1 = new EventEmitter();
  child1.killed = false;
  child1.kill = (sig) => { child1.killed = true; child1.signal = sig; };

  const child2 = new EventEmitter();
  child2.killed = false;
  child2.kill = (sig) => { child2.killed = true; child2.signal = sig; };

  registerChildProcess(child1);
  registerChildProcess(child2);
  assert.equal(getActiveChildCount(), 2);

  killActiveChildProcesses();
  assert.equal(child1.killed, true);
  assert.equal(child2.killed, true);
  assert.equal(child1.signal, 'SIGTERM');
  assert.equal(getActiveChildCount(), 0);
});

test('showCursor y hideCursor emiten secuencias ANSI apropiadas en TTY', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalWrite = process.stdout.write;
  let written = '';

  process.stdout.isTTY = true;
  process.stdout.write = (chunk) => { written += chunk; return true; };

  try {
    hideCursor();
    assert.equal(written, '\x1b[?25l');
    written = '';
    showCursor();
    assert.equal(written, '\x1b[?25h');
  } finally {
    process.stdout.isTTY = originalIsTTY;
    process.stdout.write = originalWrite;
  }
});

test('escapeShellArgForWindows entrecomilla y protege argumentos con metacaracteres de cmd.exe', () => {
  // Metacaracteres que cmd.exe interpreta como operadores (&, |, <, >, ^, %)
  assert.equal(
    escapeShellArgForWindows('https://example.com/watch?v=abc&list=RD123&start_radio=1'),
    '"https://example.com/watch?v=abc&list=RD123&start_radio=1"'
  );
  assert.equal(escapeShellArgForWindows('ytsearch5:AC&DC'), '"ytsearch5:AC&DC"');
  assert.equal(escapeShellArgForWindows('foo | bar'), '"foo | bar"');
  assert.equal(escapeShellArgForWindows('^test%'), '"^test%"');

  // Argumentos ya entrecomillados se respetan
  assert.equal(escapeShellArgForWindows('"ya entrecomillado"'), '"ya entrecomillado"');

  // Argumentos sin espacios ni metacaracteres se mantienen intactos
  assert.equal(escapeShellArgForWindows('--format'), '--format');
  assert.equal(escapeShellArgForWindows('mp3'), 'mp3');
  assert.equal(escapeShellArgForWindows(''), '""');
});

test('killActiveChildProcesses escala a SIGKILL si el proceso sigue vivo tras SIGTERM', async () => {
  const stubborn = new EventEmitter();
  stubborn.exitCode = null;
  stubborn.signalCode = null;
  stubborn.killed = false;
  stubborn.signals = [];
  stubborn.kill = (sig) => {
    stubborn.killed = true; // Node marca killed al enviar la señal, aunque el proceso siga vivo
    stubborn.signals.push(sig);
  };

  registerChildProcess(stubborn);
  killActiveChildProcesses();
  assert.deepEqual(stubborn.signals, ['SIGTERM']);

  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.deepEqual(stubborn.signals, ['SIGTERM', 'SIGKILL']);
});
