import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export function parseGitStatus(text) {
  const [first = '', ...changes] = text.trimEnd().split(/\r?\n/);
  const header = first.startsWith('## ') ? first.slice(3) : '';
  const branch = header.replace(/\.\.\..*$/, '').replace(/ \[.*$/, '') || 'unknown';
  const a = header.match(/ahead (\d+)/), b = header.match(/behind (\d+)/);
  return { branch, dirty: changes.some(Boolean), ahead: a ? Number(a[1]) : 0, behind: b ? Number(b[1]) : 0 };
}
export async function gitStatus(root) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'status', '--short', '--branch', '--untracked-files=normal'], { timeout: 3500, maxBuffer: 1024 * 1024, windowsHide: true });
    return parseGitStatus(stdout);
  } catch (error) {
    return { error: error.killed ? 'Git status timed out' : 'Git status unavailable (not a repository or Git missing)' };
  }
}
