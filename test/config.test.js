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
    await assert.rejects(loadConfig(file), /duplicate project.id/);
  });
  await withConfig({ ...basic, projects: [{ ...basic.projects[0], services: [{ id: 'x', name: 'X', command: 'x', port: 100000 }] }] }, async (file) => {
    await assert.rejects(loadConfig(file), /1-65535/);
  });
});

test('health URL must stay local', async () => {
  const bad = structuredClone(basic);
  bad.projects[0].services[0].health = { type: 'http', url: 'http://example.com/test' };
  await withConfig(bad, async (file) => assert.rejects(loadConfig(file), /local http/));
});

test('OS-specific commands and safe working directories', () => {
  assert.equal(commandForPlatform({ win32: 'npm run dev', darwin: 'pnpm dev' }, 'darwin'), 'pnpm dev');
  assert.equal(commandForPlatform({ win32: 'npm run dev' }, 'linux'), null);
  assert.equal(getServiceCwd('/repos/one', { cwd: 'src' }), '/repos/one/src');
  assert.throws(() => getServiceCwd('/repos/one', { cwd: '../other' }), /stay inside/);
});


test('launch profile references real services and only one preferred group', async () => {
  const sample = structuredClone(basic);
  sample.projects[0].launchers = [{ id: 'all', name: 'All', command: 'npm run dev', services: ['web'], preferred: true }];
  await withConfig(sample, async (file) => assert.equal((await loadConfig(file)).projects[0].launchers[0].services[0], 'web'));
  sample.projects[0].launchers[0].services = ['nonexistent'];
  await withConfig(sample, async (file) => assert.rejects(loadConfig(file), /reference distinct configured services/));
  sample.projects[0].launchers[0].services = ['web'];
  sample.projects[0].launchers.push({ id: 'other', name: 'Other', command: 'echo yes', services: ['web'], preferred: true });
  await withConfig(sample, async (file) => assert.rejects(loadConfig(file), /only one preferred launcher/));
});

test('missing service command defaults to npm run dev; HTTP signature must be local', async () => {
  const sample = structuredClone(basic);
  delete sample.projects[0].services[0].command;
  sample.projects[0].services[0].health = { type: 'http', url: 'http://localhost:4000/', contains: 'My app' };
  await withConfig(sample, async file => assert.equal((await loadConfig(file)).projects[0].services[0].health.contains, 'My app'));
  sample.projects[0].services[0].health.url = 'http://localhost.evil.com/';
  await withConfig(sample, async file => assert.rejects(loadConfig(file), /local http/));
});

test('configuration rejects escaping repo root and autostart invalid values', async () => {
  const sample = structuredClone(basic);
  sample.projects[0].services[0].autostart = 'false';
  await withConfig(sample, async file => assert.rejects(loadConfig(file), /autostart must be boolean/));
});

test('rejects working directories outside the repo on either operating system', async () => {
  for (const cwd of ['../escape', '..\\escape', '/tmp/private', 'C:\\Windows']) {
    const sample = structuredClone(basic);
    sample.projects[0].services[0].cwd = cwd;
    await withConfig(sample, async file => assert.rejects(loadConfig(file), /stay inside the repository/));
  }
});
