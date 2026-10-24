import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, realpath, readlink } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { getProjectRoot, getServiceCwd, commandForPlatform } from './config.js';
import { gitStatus } from './git.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 1000;
export async function portIsOpen(port, host = '127.0.0.1', timeout = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (open) => { if (settled) return; settled = true; socket.destroy(); resolve(open); };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
export async function httpIsHealthy(url, contains = null) {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    // Redirects often mean an authenticated frontend; a response still indicates a server is responding.
    if (response.status < 200 || response.status >= 400) return false;
    if (contains) return (await response.text()).includes(contains);
    await response.body?.cancel();
    return true;
  } catch { return false; }
}
export async function getProcessList(platform = process.platform) {
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const rows = JSON.parse(stdout || '[]');
    return (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map((p) => ({ pid: p.ProcessId, parentPid: p.ParentProcessId, command: p.CommandLine || '' }));
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  }).filter(Boolean);
}
async function workingDirectory(pid, platform = process.platform) {
  if (platform === 'linux') return readlink(`/proc/${pid}/cwd`).catch(() => null);
  if (platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000, maxBuffer: 100000 });
      return stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1) || null;
    } catch { return null; }
  }
  return null;
}
const canon = async p => realpath(p).catch(() => path.resolve(p));
export async function probeService(service, processSnapshot = null, context = {}) {
  const health = service.health || (service.port ? { type: 'tcp', port: service.port } : null);
  if (!health) return { status: 'unknown', detail: 'No health check configured' };
  if (health.type === 'tcp') {
    const port = health.port ?? service.port;
    const listening = await portIsOpen(port, health.host || '127.0.0.1');
    return listening ? { status: 'listening', detail: `Port ${port} responds (process identity not verified)` } : { status: 'stopped', detail: `Port ${port} is closed` };
  }
  if (health.type === 'http') {
    const good = await httpIsHealthy(health.url, health.contains);
    if (good) return { status: 'running', detail: `HTTP responds at ${health.url} (identity not verified)` };
    const u = new URL(health.url);
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    if (await portIsOpen(port, u.hostname.replace(/^\[|\]$/g, ''))) return { status: 'occupied', detail: `Port ${port} is open but the expected health response was not found${health.contains ? ` (needs: ${health.contains})` : ''}` };
    return { status: 'stopped', detail: 'Health endpoint is not responding' };
  }
  if (health.type === 'process') {
    if (!processSnapshot) return { status: 'unknown', detail: 'Process listing is unavailable' };
    let matches = processSnapshot.filter((p) => p.command.includes(health.match) && p.pid !== process.pid);
    if (health.cwd) {
      const expected = await canon(context.cwd || context.root || '.');
      const withDirs = await Promise.all(matches.map(async p => ({ ...p, cwd: await workingDirectory(p.pid, context.platform) })));
      // Windows cannot reliably query another process' cwd, but an ancestor
      // PowerShell launched by DevDeck exposes Set-Location -LiteralPath in its args.
      if (context.platform === 'win32' || (!context.platform && process.platform === 'win32')) {
        const byPid = new Map(processSnapshot.map(p => [p.pid, p]));
        const normalized = text => String(text).replaceAll('/', '\\').toLowerCase();
        const expectedRoot = normalized(context.root || context.cwd || '');
        matches = matches.filter(p => {
          let current = p;
          const visited = new Set();
          while (current && !visited.has(current.pid)) {
            visited.add(current.pid);
            if (normalized(current.command).includes(expectedRoot)) return true;
            current = byPid.get(current.parentPid);
          }
          return false;
        });
        if (matches.length) return { status: 'detected', detail: `Matching process PID ${matches[0].pid} (DevDeck terminal ancestry verified)`, pid: matches[0].pid };
        if (withDirs.length) return { status: 'unknown', detail: 'Matching worker exists but its repository cannot be verified on Windows' };
        return { status: 'stopped', detail: 'No matching process found' };
      }
      const verifiable = withDirs.filter(p => p.cwd);
      matches = await Promise.all(verifiable.map(async p => ({ ...p, resolved: await canon(p.cwd) })));
      matches = matches.filter(p => p.resolved === expected || p.resolved.startsWith(`${expected}${path.sep}`));
      if (!matches.length && withDirs.length && !verifiable.length) return { status: 'unknown', detail: 'Process found, but working directory cannot be verified on this OS' };
    }
    return matches.length ? { status: 'detected', detail: `Matching process PID ${matches[0].pid}${health.cwd ? ' (repository verified)' : ' (signature only)'}`, pid: matches[0].pid } : { status: 'stopped', detail: 'No matching process found' };
  }
  return { status: 'unknown', detail: 'Unsupported health check' };
}
export function isActive(status) { return ['running', 'listening', 'detected'].includes(status); }
export function projectStatus(services, exists = true) {
  if (!exists) return 'missing';
  if (!services.length) return 'unconfigured';
  if (services.some(s => ['occupied', 'conflict'].includes(s.status))) return 'attention';
  const running = services.filter(s => isActive(s.status)).length;
  if (running === services.length) return 'running';
  if (running) return 'partial';
  if (services.every(s => s.status === 'missing')) return 'missing';
  if (services.some(s => s.status === 'unknown' || s.status === 'missing')) return 'attention';
  return 'stopped';
}
export function applyPortConflicts(projects) {
  const byPort = new Map();
  for (const p of projects) for (const s of p.services) {
    if (!s.port || !isActive(s.status)) continue;
    const peers = byPort.get(s.port) || [];
    peers.push({ project: p, service: s });
    byPort.set(s.port, peers);
  }
  for (const [port, peers] of byPort) {
    if (new Set(peers.map(x => x.project.id)).size < 2) continue;
    for (const peer of peers) {
      peer.service.status = 'conflict';
      peer.service.detail = `Port ${port} responds for multiple configured projects: ${peers.map(x => x.project.name).join(', ')}. Ownership cannot be determined.`;
    }
  }
  for (const p of projects) {
    p.activeCount = p.services.filter(s => isActive(s.status)).length;
    p.status = projectStatus(p.services, p.exists);
    p.launchers = p.launchers.map(l => ({ ...l, availability: getLauncherAvailability(p, l) }));
  }
  return projects;
}
export function getLauncherAvailability(project, launcher) {
  if (!project.exists || !launcher.command || launcher.cwdExists === false) return { enabled: false, reason: 'Repository, launcher directory, or OS-specific command unavailable' };
  const included = project.services.filter(s => launcher.services.includes(s.id));
  if (included.some(s => s.status !== 'stopped')) return { enabled: false, reason: 'All included services must be confirmed stopped to avoid duplicate launches' };
  return { enabled: true, reason: '' };
}
export async function getProjectStatuses(config, options = {}) {
  const snapshot = config.projects.some(p => p.services.some(s => s.health?.type === 'process')) ? await getProcessList().catch(() => null) : null;
  const projects = await Promise.all(config.projects.map(async (p) => {
    let root;
    try { root = getProjectRoot(config, p); } catch { root = null; }
    const exists = root ? await access(root).then(() => true).catch(() => false) : false;
    const services = await Promise.all(p.services.map(async (s) => {
      const command = commandForPlatform(s.command ?? 'npm run dev');
      const cwd = root ? getServiceCwd(root, s) : null;
      const cwdExists = exists && await access(cwd).then(() => true).catch(() => false);
      const probe = !cwdExists ? { status: 'missing', detail: exists ? 'Service directory missing' : 'Repository missing on this machine' } : await probeService(s, snapshot, { cwd, root });
      return { id: s.id, name: s.name, role: s.role || '', unmonitored: !s.health && !s.port, autostart: s.autostart !== false, command, cwd: s.cwd || '.', port: s.port ?? s.health?.port ?? null, url: s.url || null, ...probe };
    }));
    const launchers = await Promise.all((p.launchers || []).map(async l => ({
      id: l.id, name: l.name, command: commandForPlatform(l.command), cwd: l.cwd || '.', services: l.services, preferred: !!l.preferred,
      cwdExists: exists && await access(getServiceCwd(root, l)).then(() => true).catch(() => false)
    })));
    return { id: p.id, name: p.name, description: p.description || '', root, exists, services, launchers, git: exists && options.git !== false ? await gitStatus(root) : null, status: 'stopped', activeCount: 0 };
  }));
  return applyPortConflicts(projects);
}
