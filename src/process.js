import { spawn } from 'node:child_process';
import process from 'node:process';
import { showCursor } from './ui.js';

const activeChildren = new Set();
let signalHandlersRegistered = false;

export function registerChildProcess(child) {
  activeChildren.add(child);
  const clean = () => activeChildren.delete(child);
  child.once('exit', clean);
  child.once('error', clean);
  child.once('close', clean);
  return child;
}

export function unregisterChildProcess(child) {
  activeChildren.delete(child);
}

export function getActiveChildCount() {
  return activeChildren.size;
}

export function killActiveChildProcesses() {
  for (const child of activeChildren) {
    try {
      if (!child.killed) {
        if (process.platform === 'win32' && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } catch {}
        }
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch {}
        }, 250).unref();
      }
    } catch {}
  }
  activeChildren.clear();
}

export function setupSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  let isTerminating = false;
  const handleSignal = () => {
    if (isTerminating) process.exit(130);
    isTerminating = true;
    killActiveChildProcesses();
    showCursor();
    process.stdout.write('\n\x1b[90m✦ Operación cancelada.\x1b[0m\n');
    process.exit(130);
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  process.once('exit', () => {
    killActiveChildProcesses();
    showCursor();
  });
}

export function spawnTracked(command, args, options = {}) {
  setupSignalHandlers();
  const child = spawn(command, args, options);
  return registerChildProcess(child);
}
