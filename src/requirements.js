import { spawnTracked } from './process.js';

export const ytDlpCommand = 'yt-dlp';

function commandVersion(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawnTracked(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.on('error', () => resolve(null));
    child.on('close', (status) => resolve(status === 0 ? output.trim().split(/\r?\n/)[0] : null));
  });
}

let cachedRequirements = null;

export function resetRequirementsCache() {
  cachedRequirements = null;
}

export async function inspectRequirements(forceRefresh = false) {
  if (cachedRequirements && !forceRefresh) return cachedRequirements;
  const [ytDlp, rawFfmpeg] = await Promise.all([
    commandVersion(ytDlpCommand),
    commandVersion('ffmpeg', ['-version']),
  ]);
  const ffmpegMatch = rawFfmpeg?.match(/version\s+([^\s]+)/i);
  const ffmpeg = ffmpegMatch ? ffmpegMatch[1] : rawFfmpeg;
  cachedRequirements = { ytDlp, ffmpeg };
  return cachedRequirements;
}

export async function ensureRequirements(forceRefresh = false) {
  const status = await inspectRequirements(forceRefresh);
  const missing = [];
  if (!status.ytDlp) missing.push('yt-dlp');
  if (!status.ffmpeg) missing.push('ffmpeg');
  if (missing.length) {
    throw new Error(`Falta ${missing.join(' y ')}. Consulta "trackcli doctor" para instalarlo.`);
  }
  return status;
}
