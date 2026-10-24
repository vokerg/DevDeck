import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createActions } from '../server/actions.js';

async function setup(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'devdeck-actions-'));
  try {
    await mkdir(path.join(root, 'repo'));
    const config = { baseDirs: { darwin: root }, projects: [{ id: 'repo', name: 'Test', path: 'repo', services: [
      { id: 'frontend', name: 'Frontend', command: 'npm run dev:web' },
      { id: 'backend', name: 'Backend', command: 'npm run dev:api' },
      { id: 'worker', name: 'Worker', command: 'npm run dev:worker' },
      { id: 'mobile', name: 'Mobile', command: 'npm run dev:mobile', autostart: false }
    ], launchers: [{ id: 'all', name: 'Web + API', command: 'npm run dev', services: ['frontend', 'backend'], preferred: true }] }] };
    const states = [{ id: 'repo', exists: true, services: config.projects[0].services.map(s => ({ id: s.id, name: s.name, status: 'stopped' })) }];
    await fn(config, states);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('start stopped prefers combined launcher, starts worker, but not optional mobile', async () => {
  await setup(async (config, statuses) => {
    const commands = [];
    const action = createActions({ platform:'darwin', statuses: async () => statuses, terminal: async (cwd, cmd) => commands.push(cmd) });
    const result = await action(config, 'repo', 'start-stopped');
    assert.equal(result.launched, 2);
    assert.deepEqual(commands, ['npm run dev', 'npm run dev:worker']);
  });
});

test('group cannot start when member is already active', async () => {
  await setup(async (config, statuses) => {
    statuses[0].services[0].status = 'running';
    const action = createActions({ platform:'darwin', statuses: async () => statuses, terminal: async () => assert.fail('must not launch') });
    assert.equal((await action(config, 'repo', 'launch', 'all')).code, 409);
  });
});

test('launch cooldown blocks duplicate requests even while checks are stale', async () => {
  await setup(async (config, statuses) => {
    let launches = 0;
    let now = 5000;
    const action = createActions({ platform:'darwin', now: () => now, statuses: async () => statuses, terminal: async () => {launches++;} });
    assert.equal((await action(config, 'repo', 'start', 'backend')).launched, 1);
    assert.equal((await action(config, 'repo', 'start', 'backend')).code, 409);
    now += 13000;
    assert.equal((await action(config, 'repo', 'start', 'backend')).launched, 1);
    assert.equal(launches, 2);
  });
});

test('pull and codex are explicit native terminal commands, never server-side git writes', async () => {
  await setup(async config => {
    const calls = [];
    const action = createActions({ platform:'darwin', terminal: async (...args) => calls.push(args) });
    await action(config, 'repo', 'pull');
    await action(config, 'repo', 'codex');
    await action(config, 'repo', 'shell');
    assert.deepEqual(calls.map(x => x[1]), ['git pull --ff-only', 'codex', '']);
  });
});

test('start stopped falls back to smaller group when worker is already running', async () => {
  await setup(async (config, statuses) => {
    config.projects[0].launchers.unshift({ id: 'full', name: 'Full', command: 'npm run dev:all', services: ['frontend','backend','worker'], preferred: true });
    config.projects[0].launchers[1].preferred = false;
    statuses[0].services.find(s => s.id === 'worker').status = 'detected';
    const cmds = [];
    const action = createActions({ platform: 'darwin', statuses: async () => statuses, terminal: async (cwd, cmd) => cmds.push(cmd) });
    assert.equal((await action(config, 'repo', 'start-stopped')).launched, 1);
    assert.deepEqual(cmds, ['npm run dev']);
  });
});

test('start stopped refuses partial launches when a required port is ambiguous', async () => {
  await setup(async (config, statuses) => {
    statuses[0].services[0].status = 'occupied';
    const action = createActions({ platform:'darwin', statuses: async()=>statuses, terminal:async()=>assert.fail('no launch') });
    assert.equal((await action(config, 'repo', 'start-stopped')).code, 409);
  });
});
