import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { getProjectStatuses } from './status.js';
import { createActions } from './actions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
export function isSafeRequest(req, port) {
  const host = req.headers.host || '';
  const localHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!localHosts.includes(host)) return false;
  const origin = req.headers.origin;
  if (origin && !localHosts.some(h => origin === `http://${h}`)) return false;
  return !['cross-site'].includes(req.headers['sec-fetch-site']);
}
export function createHandler({ port = 4400, config = loadConfig, statuses = getProjectStatuses, actions = createActions() } = {}) {
  return async (req, res) => {
    try {
      if (!isSafeRequest(req, port)) return json(res, 403, { error: 'Requests must originate from this local DevDeck dashboard' });
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        const data = await config();
        return json(res, 200, { projects: await statuses(data), platform: process.platform, refreshMs: 5000 });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/projects/')) {
        if (req.headers['x-devdeck-action'] !== '1') return json(res, 403, { error: 'Missing DevDeck action header' });
        // The browser can request only named actions and IDs; commands come exclusively from disk config.
        const route = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(services|launchers)\/([a-z0-9-]+)\/(start|launch)$/);
        const projectRoute = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(start-stopped|pull|codex|shell)$/);
        if (!route && !projectRoute) return json(res, 404, { error: 'Unknown action endpoint' });
        if (route && !((route[2] === 'services' && route[4] === 'start') || (route[2] === 'launchers' && route[4] === 'launch'))) return json(res, 404, { error: 'Unknown action endpoint' });
        const result = route ? await actions(await config(), route[1], route[4], route[3]) : await actions(await config(), projectRoute[1], projectRoute[2]);
        return json(res, result.code || 200, result.code ? { error: result.message } : result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = path.resolve(ASSETS, `.${pathname}`);
      if (!target.startsWith(`${ASSETS}${path.sep}`)) return json(res, 404, { error: 'Not found' });
      try {
        const content = await readFile(target);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" });
        return res.end(req.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (['ENOENT', 'EISDIR'].includes(error.code)) return json(res, 404, { error: 'Not found' });
        throw error;
      }
    } catch (error) {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected error' });
      else res.end();
    }
  };
}
export function startServer(port = Number(process.env.PORT || '4400')) {
  const server = http.createServer(createHandler({ port }));
  server.listen(port, '127.0.0.1', () => console.log(`DevDeck ready → http://localhost:${port}`));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
