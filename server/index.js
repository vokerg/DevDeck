import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getProjectRoot, getServiceCwd, commandForPlatform } from './config.js';
import { getProjectStatuses, probeService, isActive, getProcessList } from './status.js';
import { openTerminal } from './terminal.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || '4400');
const HOST = '127.0.0.1';
const ASSETS = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function isSafeRequest(req) {
  const host = req.headers.host || '';
  if (![`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin && ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(origin)) return false;
  return req.headers['sec-fetch-site'] !== 'cross-site';
}

async function launchAction(config, projectId, serviceId, action) {
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) return { code: 404, message: 'Project not found' };
  const root = getProjectRoot(config, project);
  if (!(await access(root).then(() => true).catch(() => false))) return { code: 409, message: `Repository not found: ${root}` };

  if (action === 'start' && serviceId) {
    const service = project.services.find((s) => s.id === serviceId);
    if (!service) return { code: 404, message: 'Service not found' };
    const command = commandForPlatform(service.command);
    if (!command) return { code: 422, message: 'No command configured for this OS' };
    const cwd = getServiceCwd(root, service);
    if (!(await access(cwd).then(() => true).catch(() => false))) return { code: 409, message: `Service directory not found: ${cwd}` };
    const processSnapshot = service.health?.type === 'process' ? await getProcessList().catch(() => null) : null;
    const probe = await probeService(service, processSnapshot);
    if (isActive(probe.status) || probe.status === 'occupied') return { code: 409, message: `${service.name} is already active or its port is occupied` };
    await openTerminal(cwd, command);
    return { message: `Opened terminal for ${service.name}`, launched: 1 };
  }

  if (action === 'start-stopped' && !serviceId) {
    let launched = 0;
    let skipped = 0;
    const processSnapshot = project.services.some((s) => s.health?.type === 'process')
      ? await getProcessList().catch(() => null) : null;
    for (const service of project.services) {
      const command = commandForPlatform(service.command);
      const cwd = getServiceCwd(root, service);
      if (!command || !(await access(cwd).then(() => true).catch(() => false))) { skipped++; continue; }
      const state = await probeService(service, processSnapshot);
      if (isActive(state.status) || state.status === 'occupied') { skipped++; continue; }
      await openTerminal(cwd, command);
      launched++;
    }
    return { message: `Opened ${launched} terminal${launched === 1 ? '' : 's'}; skipped ${skipped}`, launched, skipped };
  }

  if (!serviceId && ['pull', 'codex', 'shell'].includes(action)) {
    const command = action === 'pull' ? 'git pull --ff-only' : action === 'codex' ? 'codex' : '';
    await openTerminal(root, command);
    return { message: `Opened ${action} terminal`, launched: 1 };
  }
  return { code: 404, message: 'Unknown action' };
}

async function handle(req, res) {
  if (!isSafeRequest(req)) return json(res, 403, { error: 'Requests must originate from the local DevDeck dashboard' });
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    const config = await loadConfig();
    return json(res, 200, { projects: await getProjectStatuses(config), platform: process.platform, refreshMs: 5000 });
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/projects/')) {
    if (req.headers['x-devdeck-action'] !== '1') return json(res, 403, { error: 'Missing DevDeck action header' });
    const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(?:services\/([a-z0-9-]+)\/)?(start|start-stopped|pull|codex|shell)$/);
    if (!match) return json(res, 404, { error: 'Unknown action endpoint' });
    const config = await loadConfig();
    const result = await launchAction(config, match[1], match[2], match[3]);
    return json(res, result.code || 200, result.code ? { error: result.message } : result);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(ASSETS, `.${pathname}`);
  if (!target.startsWith(`${ASSETS}${path.sep}`)) return json(res, 404, { error: 'Not found' });
  try {
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'Not found' });
    throw error;
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected error' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => console.log(`DevDeck ready → http://localhost:${PORT}`));
