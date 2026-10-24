import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import net from 'node:net';
import { getProjectRoot, getServiceCwd, commandForPlatform } from './config.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 900;

export async function portIsOpen(port, host = '127.0.0.1', timeout = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    function finish(isOpen) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(isOpen);
    }
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function httpIsHealthy(url) {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

export async function getProcessList(platform = process.platform) {
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'
    ], { timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const rows = JSON.parse(stdout || '[]');
    return (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map((p) => ({ pid: p.ProcessId, command: p.CommandLine || '' }));
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').map((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  }).filter(Boolean);
}

export async function probeService(service, processSnapshot = null) {
  const health = service.health || (service.port ? { type: 'tcp', port: service.port } : null);
  if (!health) return { status: 'unknown', detail: 'No health check configured' };

  if (health.type === 'tcp') {
    const port = health.port ?? service.port;
    const listening = await portIsOpen(port, health.host || '127.0.0.1');
    return listening
      ? { status: 'listening', detail: `TCP port ${port} is listening (identity not verified)` }
      : { status: 'stopped', detail: `TCP port ${port} is closed` };
  }

  if (health.type === 'http') {
    if (await httpIsHealthy(health.url)) return { status: 'running', detail: 'Health endpoint responds successfully' };
    const port = service.port || Number(new URL(health.url).port) || (health.url.startsWith('https:') ? 443 : 80);
    if (await portIsOpen(port)) return { status: 'occupied', detail: `Port ${port} is open, but the health check failed` };
    return { status: 'stopped', detail: 'Health endpoint is not responding' };
  }

  if (health.type === 'process') {
    if (!processSnapshot) return { status: 'unknown', detail: 'Process listing is unavailable' };
    const matches = processSnapshot.filter((p) => p.command.includes(health.match) && p.pid !== process.pid);
    return matches.length
      ? { status: 'detected', detail: `Matching process detected (PID ${matches[0].pid})` }
      : { status: 'stopped', detail: 'No matching process found' };
  }

  return { status: 'unknown', detail: 'Unsupported health check' };
}

export function isActive(status) {
  return ['running', 'listening', 'detected'].includes(status);
}

export async function getProjectStatuses(config) {
  const needsProcesses = config.projects.some((p) => p.services.some((s) => s.health?.type === 'process'));
  const processSnapshot = needsProcesses ? await getProcessList().catch(() => null) : null;
  return Promise.all(config.projects.map(async (project) => {
    const root = getProjectRoot(config, project);
    const exists = await access(root).then(() => true).catch(() => false);
    const services = await Promise.all(project.services.map(async (s) => {
      const command = commandForPlatform(s.command);
      const cwd = getServiceCwd(root, s);
      const cwdExists = exists && await access(cwd).then(() => true).catch(() => false);
      const probe = !exists || !cwdExists
        ? { status: 'missing', detail: !exists ? 'Repository directory not found' : 'Service directory not found' }
        : await probeService(s, processSnapshot);
      return {
        id: s.id, name: s.name, command, cwd: s.cwd || '.', port: s.port ?? s.health?.port ?? null,
        url: s.url || null, ...probe
      };
    }));
    const activeCount = services.filter((s) => isActive(s.status)).length;
    const problemCount = services.filter((s) => s.status === 'occupied').length;
    const status = !exists ? 'missing' : !services.length ? 'unconfigured' :
      problemCount ? 'attention' : activeCount === services.length ? 'running' :
      activeCount ? 'partial' : services.every((s) => s.status === 'missing') ? 'missing' : 'stopped';
    return {
      id: project.id, name: project.name, description: project.description || '',
      root, exists, status, activeCount, services
    };
  }));
}
