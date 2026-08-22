import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { getActiveChildCount, killActiveChildProcesses, registerChildProcess, unregisterChildProcess } from '../src/process.js';
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
