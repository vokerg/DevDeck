import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatus } from '../server/git.js';
test('git status parses branch dirty and ahead/behind', () => {
  assert.deepEqual(parseGitStatus('## feature/foo...origin/feature/foo [ahead 2, behind 1]\n M public/app.js\n'), { branch: 'feature/foo', dirty: true, ahead: 2, behind: 1 });
  assert.deepEqual(parseGitStatus('## main...origin/main\n'), { branch: 'main', dirty: false, ahead: 0, behind: 0 });
});
