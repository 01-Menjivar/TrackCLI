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

function isRunning(child) {
  // child.killed only says a signal was sent, not that the process exited.
  return child.exitCode == null && child.signalCode == null;
}

function forceKill(child) {
  try {
    if (isRunning(child)) child.kill('SIGKILL');
  } catch {}
}

export function killActiveChildProcesses() {
  const children = [...activeChildren];
  for (const child of children) {
    try {
      if (isRunning(child)) {
        if (process.platform === 'win32' && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } catch {}
        }
        child.kill('SIGTERM');
        setTimeout(() => forceKill(child), 250).unref();
      }
    } catch {}
  }
  activeChildren.clear();
  return children;
}

export function setupSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  let isTerminating = false;
  const handleSignal = () => {
    if (isTerminating) process.exit(130);
    isTerminating = true;
    const children = killActiveChildProcesses();
    showCursor();
    process.stdout.write('\n\x1b[90m✦ Operation cancelled.\x1b[0m\n');
    if (!children.some(isRunning)) process.exit(130);
    // Give children a moment to exit on SIGTERM, then force-kill survivors before exiting.
    setTimeout(() => {
      children.forEach(forceKill);
      process.exit(130);
    }, 300);
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  process.once('exit', () => {
    killActiveChildProcesses();
    showCursor();
  });
}

export function escapeShellArgForWindows(arg) {
  if (typeof arg !== 'string') return arg;
  if (!arg) return '""';
  // If argument contains cmd.exe metacharacters (&, |, <, >, ^, %) or whitespace,
  // ensure it is properly enclosed in double quotes for cmd.exe
  if (/[ &|<>()^%"]/.test(arg)) {
    if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2) {
      return arg;
    }
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

export function spawnTracked(command, args, options = {}) {
  setupSignalHandlers();
  let finalArgs = args;
  if (options.shell && process.platform === 'win32' && Array.isArray(args)) {
    finalArgs = args.map(escapeShellArgForWindows);
  }
  const child = spawn(command, finalArgs, options);
  return registerChildProcess(child);
}
