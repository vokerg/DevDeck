import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** PowerShell's -EncodedCommand expects UTF-16LE base64. */
export function encodePowerShellCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/** Use cmd's start builtin so PowerShell receives a fresh visible console. */
export function windowsTerminalArgs(script, cwd) {
  const encoded = encodePowerShellCommand(script);
  // Keep the root literal in the visible parent command line. Windows worker
  // probes use that ancestry as their best available repository verification.
  const visibleScript = `Set-Location -LiteralPath ${psQuote(cwd)}; powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand ${encoded}`;
  return ['/d', '/c', 'start', '', 'powershell.exe', '-NoLogo', '-NoProfile', '-NoExit', '-Command', visibleScript];
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
      // A detached child can still inherit the server's console on Windows.
      // `start` explicitly creates a new visible console window instead.
      const child = spawn('cmd.exe', windowsTerminalArgs(script, cwd), {
        detached: true, stdio: 'ignore', windowsHide: false
      });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return;
  }
  throw new Error(`Terminal launching is supported on Windows and macOS (detected ${platform})`);
}
