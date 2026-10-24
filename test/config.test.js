import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, commandForPlatform, getServiceCwd } from '../server/config.js';

async function withConfig(value, callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'devdeck-test-'));
  const file = path.join(root, 'config.json');
  await writeFile(file, JSON.stringify(value));
  try { return await callback(file); } finally { await rm(root, { recursive: true, force: true }); }
}

const basic = { baseDirs: { linux: '/repos' }, projects: [{ id: 'one', name: 'One', path: 'one', services: [{ id: 'web', name: 'Web', command: 'npm run dev', port: 4000 }] }] };

test('valid configuration is loaded', async () => {
  await withConfig(basic, async (file) => {
    const config = await loadConfig(file);
    assert.equal(config.projects[0].services[0].command, 'npm run dev');
  });
});

test('duplicate projects and invalid port are rejected', async () => {
  await withConfig({ ...basic, projects: [basic.projects[0], basic.projects[0]] }, async (file) => {
    await assert.rejects(loadConfig(file), /Duplicate project id/);
  });
  await withConfig({ ...basic, projects: [{ ...basic.projects[0], services: [{ id: 'x', name: 'X', command: 'x', port: 100000 }] }] }, async (file) => {
    await assert.rejects(loadConfig(file), /1-65535/);
  });
});

test('health URL must stay local', async () => {
  const bad = structuredClone(basic);
  bad.projects[0].services[0].health = { type: 'http', url: 'http://example.com/test' };
  await withConfig(bad, async (file) => assert.rejects(loadConfig(file), /local machine/));
});

test('OS-specific commands and safe working directories', () => {
  assert.equal(commandForPlatform({ win32: 'npm run dev', darwin: 'pnpm dev' }, 'darwin'), 'pnpm dev');
  assert.equal(commandForPlatform({ win32: 'npm run dev' }, 'linux'), null);
  assert.equal(getServiceCwd('/repos/one', { cwd: 'src' }), '/repos/one/src');
  assert.throws(() => getServiceCwd('/repos/one', { cwd: '../other' }), /stay inside/);
});
