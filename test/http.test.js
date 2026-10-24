import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHandler, isSafeRequest } from '../server/index.js';

async function withApi(fn) {
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const calls = [];
  handler = createHandler({
    port,
    config: async () => ({ projects: [], baseDirs: {} }),
    statuses: async () => [],
    actions: async (...args) => { calls.push(args); return { message: 'launched', launched: 1 }; }
  });
  const request = async (method, url, headers = {}) => {
    const result = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: { Host: `localhost:${port}`, ...headers }
    });
    return { status: result.status, json: await result.json() };
  };
  try { await fn(request, calls); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('health response works and project status returns registered config', async () => {
  await withApi(async request => {
    assert.equal((await request('GET', '/api/health')).json.ok, true);
    assert.deepEqual((await request('GET', '/api/projects')).json.projects, []);
  });
});
test('API requires local Host/Origin and action header', async () => {
  await withApi(async request => {
    assert.equal(isSafeRequest({ headers: { host: 'attacker.com' } }, 4400), false);
    assert.equal((await request('GET', '/api/health', { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await request('POST', '/api/projects/demo/pull')).status, 403);
  });
});
test('API dispatches only registered action shapes and not arbitrary browser commands', async () => {
  await withApi(async (request, calls) => {
    const actionHeaders = { 'X-DevDeck-Action': '1' };
    assert.equal((await request('POST', '/api/projects/demo/launchers/full/launch', actionHeaders)).status, 200);
    assert.equal((await request('POST', '/api/projects/demo/services/api/start', actionHeaders)).status, 200);
    assert.equal((await request('POST', '/api/projects/demo/codex', actionHeaders)).status, 200);
    assert.equal((await request('POST', '/api/projects/demo/services/api/codex', actionHeaders)).status, 404);
    assert.equal((await request('POST', '/api/projects/demo/exec?command=rm%20-rf%20.', actionHeaders)).status, 404);
    assert.deepEqual(calls.map(x => x.slice(1)), [['demo','launch','full'],['demo','start','api'],['demo','codex']]);
  });
});
