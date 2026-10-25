import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePowerShellCommand, makeShellCommand, windowsTerminalArgs } from '../server/terminal.js';

test('PowerShell quotes repository paths with apostrophes safely', () => {
  assert.equal(makeShellCommand("C:\\repos\\it's", 'npm run dev', 'win32'), "Set-Location -LiteralPath 'C:\\repos\\it''s'; npm run dev");
});

test('POSIX shell quotes repo paths safely', () => {
  assert.equal(makeShellCommand("/Users/a's/projects", 'npm run dev', 'darwin'), "cd -- '/Users/a'\\''s/projects' && npm run dev");
});

test('Windows terminal launch requests a fresh visible PowerShell console', () => {
  const script = "Set-Location -LiteralPath 'C:\\repos\\it's'; npm run dev";
  const cwd = "C:\\repos\\it's";
  const args = windowsTerminalArgs(script, cwd);
  assert.deepEqual(args.slice(0, 5), ['/d', '/c', 'start', '', 'powershell.exe']);
  assert.equal(args[args.length - 2], '-Command');
  assert.match(args.at(-1), /Set-Location -LiteralPath 'C:\\repos\\it''s'; powershell\.exe/);
  const encoded = args.at(-1).match(/-EncodedCommand (\S+)$/)?.[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), script);
  assert.equal(encodePowerShellCommand(script), encoded);
});
