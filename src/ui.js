const enabled = process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
const isTrueColor = enabled && (
  Boolean(process.env.COLORTERM) ||
  process.platform === 'darwin' ||
  process.env.TERM_PROGRAM === 'vscode' ||
  process.env.TERM_PROGRAM === 'Apple_Terminal' ||
  process.env.TERM_PROGRAM === 'iTerm.app' ||
  (process.env.TERM && process.env.TERM.includes('256color'))
);

const rgb = (r, g, b, fallback) => (text) => {
  if (!enabled) return text;
  if (isTrueColor) return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  return `\x1b[${fallback}m${text}\x1b[0m`;
};

const code = (value) => (text) => enabled ? `\x1b[${value}m${text}\x1b[0m` : text;

export const color = {
  brand: rgb(56, 189, 248, '36'),
  cyan: rgb(56, 189, 248, '36'),
  blue: rgb(96, 165, 250, '34'),
  green: rgb(52, 211, 153, '32'),
  emerald: rgb(16, 185, 129, '32'),
  yellow: rgb(251, 191, 36, '33'),
  red: rgb(248, 113, 113, '31'),
  dim: rgb(148, 163, 184, '90'),
  white: rgb(248, 250, 252, '37'),
  bold: code('1'),
  italic: code('3'),
  badge: (text) => `${color.dim('[')}${color.cyan(text)}${color.dim(']')}`,
};

export function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25h');
  }
}

export function hideCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?25l');
  }
}

export function mark(kind, text) {
  const icons = {
    success: color.green('✔'),
    error: color.red('✖'),
    info: color.cyan('›'),
    warn: color.yellow('▲'),
    download: color.blue('↓'),
    step: color.dim('↳'),
  };
  return `${icons[kind] ?? icons.info} ${text}`;
}

export function header() {
  console.log(`\n${color.brand(color.bold('◆ TrackCLI'))} ${color.dim('v0.1.1 · audio extractor')}\n`);
}

export function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function truncateAnsi(str, maxLen) {
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;
  if (maxLen <= 1) return '…';

  const targetLen = maxLen - 1;
  let visible = 0;
  let out = '';
  const regex = /(\x1B\[[0-?]*[ -/]*[@-~])|([\s\S])/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    if (match[1]) {
      out += match[1];
    } else {
      if (visible < targetLen) {
        out += match[2];
        visible++;
      } else {
        break;
      }
    }
  }
  return out + '…\x1b[0m';
}

export function card(title, lines) {
  const content = [color.bold(title), ...lines];
  const maxLineLength = Math.max(...content.map(stripAnsi).map((line) => line.length));
  const termColumns = process.stdout.columns || 80;
  const maxWidth = Math.max(30, Math.min(termColumns - 2, 78));
  const width = Math.min(maxWidth, Math.max(24, maxLineLength + 4));
  const innerWidth = width - 4;

  console.log(color.dim(`╭${'─'.repeat(width - 2)}╮`));
  for (const rawLine of content) {
    const line = truncateAnsi(rawLine, innerWidth);
    const visibleLength = stripAnsi(line).length;
    const padding = Math.max(0, innerWidth - visibleLength);
    console.log(color.dim('│') + ` ${line}${' '.repeat(padding)} ` + color.dim('│'));
  }
  console.log(color.dim(`╰${'─'.repeat(width - 2)}╯`));
}

export function createSpinner(initialText = '') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let currentText = initialText;
  let interval = null;
  const isTTY = Boolean(process.stdout.isTTY && !process.env.CI);

  const render = () => {
    if (!isTTY) return;
    const frame = color.cyan(frames[frameIndex % frames.length]);
    process.stdout.write(`\r\x1b[2K${frame} ${currentText}`);
    frameIndex++;
  };

  const start = (text) => {
    if (text) currentText = text;
    if (interval) clearInterval(interval);
    if (isTTY) {
      hideCursor();
      render();
      interval = setInterval(render, 80);
    }
    return spinner;
  };

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (isTTY) {
      process.stdout.write('\r\x1b[2K');
      showCursor();
    }
    return spinner;
  };

  const succeed = (msg) => {
    stop();
    if (msg || currentText) console.log(mark('success', msg || currentText));
    return spinner;
  };

  const fail = (msg) => {
    stop();
    if (msg || currentText) console.log(mark('error', msg || currentText));
    return spinner;
  };

  const update = (text) => {
    currentText = text;
    if (isTTY && interval) render();
    return spinner;
  };

  const spinner = {
    start,
    stop,
    succeed,
    fail,
    update,
    get text() { return currentText; },
    set text(val) { update(val); },
  };

  if (initialText) start();
  return spinner;
}

let lastProgressTime = 0;

export function progress(percent, stats = {}) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const termColumns = process.stdout.columns || 80;
  const blocks = 18;
  const filled = Math.round((safePercent / 100) * blocks);
  const empty = Math.max(0, blocks - filled);
  const bar = `${color.cyan('█'.repeat(filled))}${color.dim('░'.repeat(empty))}`;

  const details = typeof stats === 'string' ? { label: stats } : stats;
  const percentStr = `${safePercent.toFixed(1).padStart(5, ' ')}%`;
  const speed = details.speed ? ` ${color.dim('·')} ${color.dim(details.speed)}` : '';
  const eta = details.eta ? ` ${color.dim('·')} ${color.dim(`ETA ${details.eta}`)}` : '';
  const label = details.label ? ` ${color.dim('·')} ${details.label}` : '';

  const line = `  ${bar} ${color.bold(color.cyan(percentStr))}${speed}${eta}${label}`;
  const truncated = truncateAnsi(line, termColumns - 2);

  if (process.stdout.isTTY) {
    const now = Date.now();
    if (safePercent >= 100 || now - lastProgressTime >= 40) {
      lastProgressTime = now;
      hideCursor();
      process.stdout.write(`\r\x1b[2K${truncated}`);
    }
  } else {
    // Only print in intervals of ~25% in non-interactive terminals
  }
}

export function endProgress() {
  if (process.stdout.isTTY) {
    process.stdout.write('\r\x1b[2K\n');
    showCursor();
  }
}

export async function selectItemInteractive(items, formatLabel = (item) => item.title || String(item), askFallback = null) {
  if (!items.length) return null;

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    items.forEach((item, idx) => {
      console.log(`  ${color.cyan(`${idx + 1}.`)} ${formatLabel(item)}`);
    });
    console.log(`  ${color.cyan('0.')} ${color.dim('Cancelar')}\n`);
    if (askFallback) {
      const answer = await askFallback(`Selecciona una opción [1-${items.length}/0]`, '1');
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < items.length) return items[idx];
    }
    return null;
  }

  let selectedIndex = 0;
  hideCursor();

  const render = () => {
    let text = '';
    items.forEach((item, idx) => {
      const isSelected = idx === selectedIndex;
      const pointer = isSelected ? color.cyan('❯ ') : '  ';
      const label = isSelected ? color.bold(color.cyan(formatLabel(item))) : color.dim(formatLabel(item));
      text += `${pointer}${label}\n`;
    });
    text += `\n  ${color.dim('Navega con')} ${color.bold('↑ / ↓')} ${color.dim('·')} ${color.bold('Enter')} ${color.dim('confirmar ·')} ${color.bold('Esc')} ${color.dim('cancelar')}\n`;
    return text;
  };

  process.stdout.write(render());
  const linesToClear = items.length + 2;

  const clearLines = () => {
    for (let i = 0; i < linesToClear; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }
  };

  return new Promise((resolve) => {
    const onData = (data) => {
      const key = data.toString();

      if (key === '\u0003') {
        cleanup();
        process.exit(130);
      }
      if (key === '\u001b' || key === 'q' || key === 'Q') {
        cleanup();
        resolve(null);
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(items[selectedIndex]);
        return;
      }
      if (key === '\u001b[A' || key === 'k') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        clearLines();
        process.stdout.write(render());
        return;
      }
      if (key === '\u001b[B' || key === 'j') {
        selectedIndex = (selectedIndex + 1) % items.length;
        clearLines();
        process.stdout.write(render());
        return;
      }
      const num = parseInt(key, 10);
      if (!isNaN(num) && num >= 1 && num <= items.length) {
        selectedIndex = num - 1;
        cleanup();
        resolve(items[selectedIndex]);
        return;
      }
      if (key === '0') {
        cleanup();
        resolve(null);
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
      showCursor();
    };

    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } catch {
      showCursor();
      resolve(items[0]);
    }
  });
}

process.once('exit', () => {
  showCursor();
});
