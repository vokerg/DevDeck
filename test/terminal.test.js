import test from 'node:test';
import assert from 'node:assert/strict';
import { makeShellCommand } from '../server/terminal.js';

test('PowerShell quotes repository paths with apostrophes safely', () => {
  assert.equal(makeShellCommand("C:\\repos\\it's", 'npm run dev', 'win32'), "Set-Location -LiteralPath 'C:\\repos\\it''s'; npm run dev");
});

test('POSIX shell quotes repo paths safely', () => {
  assert.equal(makeShellCommand("/Users/a's/projects", 'npm run dev', 'darwin'), "cd -- '/Users/a'\\''s/projects' && npm run dev");
});
