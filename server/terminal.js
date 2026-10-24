import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function makeShellCommand(cwd, command, platform = process.platform) {
  if (platform === 'win32') {
    return `Set-Location -LiteralPath ${psQuote(cwd)}${command ? `; ${command}` : ''}`;
  }
  return `cd -- ${shQuote(cwd)}${command ? ` && ${command}` : ''}`;
}

export async function openTerminal(cwd, command = '', platform = process.platform) {
  const script = makeShellCommand(cwd, command, platform);
  if (platform === 'darwin') {
    // AppleScript strings escape both backslashes and double quotes.
    const quotedScript = `"${script.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    await execFileAsync('osascript', ['-e', `tell application "Terminal" to do script ${quotedScript}`, '-e', 'tell application "Terminal" to activate'], { timeout: 8000 });
    return;
  }
  if (platform === 'win32') {
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', script], {
        detached: true, stdio: 'ignore', windowsHide: false
      });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return;
  }
  throw new Error(`Terminal launching is supported on Windows and macOS (detected ${platform})`);
}
