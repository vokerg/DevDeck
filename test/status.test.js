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
