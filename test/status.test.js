import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { portIsOpen, probeService, isActive } from '../server/status.js';

async function withServer(server, fn) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try { await fn(port); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('TCP check reports a listening local port', async () => {
  await withServer(net.createServer(), async (port) => {
    assert.equal(await portIsOpen(port), true);
    const state = await probeService({ port });
    assert.equal(state.status, 'listening');
  });
});

test('HTTP check confirms healthy endpoints', async () => {
  await withServer(http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }), async (port) => {
    const state = await probeService({ port, health: { type: 'http', url: `http://127.0.0.1:${port}/health` } });
    assert.equal(state.status, 'running');
  });
});

test('HTTP check flags listening port with failed health check', async () => {
  await withServer(http.createServer((req, res) => { res.writeHead(503); res.end('nope'); }), async (port) => {
    const state = await probeService({ port, health: { type: 'http', url: `http://127.0.0.1:${port}/health` } });
    assert.equal(state.status, 'occupied');
  });
});

test('process health matches a distinctive command line', async () => {
  const service = { health: { type: 'process', match: 'unique_worker_1234' } };
  assert.equal((await probeService(service, [{ pid: 42, command: 'node unique_worker_1234' }])).status, 'detected');
  assert.equal((await probeService(service, [])).status, 'stopped');
  assert.equal(isActive('detected'), true);
  assert.equal(isActive('occupied'), false);
});

test('HTTP identity string prevents mistaking another project for the target', async () => {
  await withServer(http.createServer((req, res) => { res.writeHead(200); res.end('<title>Chess Repertoire Trainer</title>'); }), async port => {
    const own = await probeService({ port, health: { type: 'http', url: `http://127.0.0.1:${port}`, contains: '<title>Chess Repertoire Trainer</title>' } });
    const other = await probeService({ port, health: { type: 'http', url: `http://127.0.0.1:${port}`, contains: '<title>Why I Suck at Chess</title>' } });
    assert.equal(own.status, 'running');
    assert.equal(other.status, 'occupied');
  });
});

test('sharing a responsive port produces an ambiguous identity warning', async () => {
  const { applyPortConflicts } = await import('../server/status.js');
  const base = [{ id: 'frontend', status: 'running', port: 4200 }];
  const projects = [{ id: 'a', name: 'A', exists: true, services: structuredClone(base), launchers: [] }, { id: 'b', name: 'B', exists: true, services: structuredClone(base), launchers: [] }];
  applyPortConflicts(projects);
  assert.equal(projects[0].status, 'attention');
  assert.equal(projects[1].services[0].status, 'conflict');
  assert.match(projects[0].services[0].detail, /Ownership cannot be determined/);
});

test('process cwd check does not claim workers started from another repository', async () => {
  const dir = await import('node:fs/promises');
  const os = await import('node:os');
  const p = await import('node:path');
  const root = await dir.mkdtemp(p.join(os.tmpdir(), 'devdeck-worker-'));
  try {
    const result = await probeService({ health: { type: 'process', match: 'worker-sample.js', cwd: true } }, [{ pid: 999999999, command: 'node worker-sample.js' }], { cwd: root, root, platform: 'linux' });
    assert.equal(result.status, 'unknown');
  } finally { await dir.rm(root, { recursive: true, force: true }); }
});

test('Windows ancestry identifies a worker started in a DevDeck terminal', async () => {
  const root = 'C:\\repos\\WhyISuckAtChess';
  const snapshot = [
    { pid: 22, parentPid: 21, command: 'node src/worker.ts' },
    { pid: 21, parentPid: 20, command: 'cmd.exe /d /s /c ts-node-dev' },
    { pid: 20, parentPid: 0, command: `powershell.exe -Command Set-Location -LiteralPath '${root}'; npm run dev:worker` }
  ];
  const healthy = await probeService({ health: { type:'process', match:'src/worker.ts', cwd:true } }, snapshot, { root, cwd: root, platform:'win32' });
  assert.equal(healthy.status, 'detected');
  const ambiguous = await probeService({ health: { type:'process', match:'src/worker.ts', cwd:true } }, snapshot.slice(0,2), { root, cwd: root, platform:'win32' });
  assert.equal(ambiguous.status, 'unknown');
});
