import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { getProjectRoot } from './config.js';

const exec = promisify(execFile);
const within = (root, cwd) => cwd === root || cwd.startsWith(`${root}${path.sep}`);
const identity = p => JSON.stringify([p.pid, p.parentPid, p.uid, p.started, p.command, p.cwd]);

export async function macProcessSnapshot() {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,uid=,lstart=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  const rows = stdout.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    return m ? [{ pid: +m[1], parentPid: +m[2], uid: +m[3], started: m[4], command: m[5] }] : [];
  });
  // A single lsof call avoids one subprocess per process. Missing cwd stays unverifiable.
  const dirs = new Map();
  const result = await exec('lsof', ['-a', '-u', String(process.getuid()), '-d', 'cwd', '-Fn'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }).catch(error => {
    if (error.code === 1 && error.stdout) return { stdout: error.stdout };
    throw error;
  });
  let pid;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n')) dirs.set(pid, await realpath(line.slice(1)).catch(() => null));
  }
  return rows.map(p => ({ ...p, cwd: dirs.get(p.pid) || null }));
}

export function planStop(rows, root, matches, { uid = process.getuid?.(), self = process.pid } = {}) {
  const byPid = new Map(rows.map(p => [p.pid, p]));
  const protectedPids = new Set([1, self]);
  let ancestor = byPid.get(self);
  while (ancestor && !protectedPids.has(ancestor.parentPid)) {
    protectedPids.add(ancestor.parentPid);
    ancestor = byPid.get(ancestor.parentPid);
  }
  const verified = p => p.uid === uid && p.cwd && within(root, p.cwd) && !protectedPids.has(p.pid);
  const selected = new Set(rows.filter(p => verified(p) && matches.some(m => p.command.includes(m))).map(p => p.pid));
  // Include descendants, never ancestors: terminals, editors and their other tasks stay untouched.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of rows) if (selected.has(p.parentPid) && !selected.has(p.pid)) {
      if (!verified(p)) throw new Error('A launcher has an unverifiable or external descendant; stop it in its original terminal');
      selected.add(p.pid); changed = true;
    }
  }
  const ordered = [], remaining = rows.filter(p => selected.has(p.pid));
  while (remaining.length) {
    const index = remaining.findIndex(p => !remaining.some(other => other.pid === p.parentPid));
    if (index < 0) throw new Error('Process ancestry cannot be verified');
    ordered.push(...remaining.splice(index, 1));
  }
  return ordered;
}

export function createStopActions({ platform = process.platform, snapshot = macProcessSnapshot, signal = (pid) => process.kill(pid, 'SIGTERM'), pause = delay, now = Date.now } = {}) {
  const previews = new Map();
  return async (config, projectId, action, token) => {
    if (platform !== 'darwin') return { code: 422, message: 'Graceful Stop is currently supported on macOS only; use Ctrl+C in the original terminal' };
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { code: 404, message: 'Project not found' };
    if (!project.stop) return { code: 409, message: 'No trusted Stop signatures configured for this project' };
    const root = await realpath(getProjectRoot(config, project, platform));
    const signature = JSON.stringify([root, project.stop]);
    for (const [key, value] of previews) if (now() - value.time > 60000) previews.delete(key);
    if (action === 'stop-preview') {
      const processes = planStop(await snapshot(), root, project.stop.matches);
      if (!processes.length) return { code: 409, message: 'No verified launcher found. Separately started services must be stopped in their original terminals.' };
      const token = randomUUID();
      // Keep only one outstanding preview per project.
      for (const [key, value] of previews) if (value.projectId === projectId) previews.delete(key);
      previews.set(token, { projectId, signature, processes, time: now() });
      return { token, processes: processes.map(({pid, command, cwd}) => ({pid, command, cwd})), message: 'Review processes before stopping' };
    }
    const preview = previews.get(token);
    previews.delete(token); // Single use, including failed or stale confirmations.
    if (!preview || preview.projectId !== projectId || preview.signature !== signature || now() - preview.time > 60000) return { code: 409, message: 'Stop preview expired or configuration changed; review a new preview' };
    const current = planStop(await snapshot(), root, project.stop.matches);
    if (JSON.stringify(current.map(identity)) !== JSON.stringify(preview.processes.map(identity))) return { code: 409, message: 'Processes changed; review a new Stop preview' };
    let requested = 0;
    const errors = [];
    for (const p of preview.processes) {
      // Re-read identity immediately before each signal, including after the launcher's grace period.
      const liveRows = await snapshot();
      const live = liveRows.find(row => row.pid === p.pid);
      if (!live) continue;
      let launcher = p;
      while (preview.processes.some(other => other.pid === launcher.parentPid)) {
        launcher = preview.processes.find(other => other.pid === launcher.parentPid);
      }
      if (launcher.pid !== p.pid && liveRows.some(other => other.pid === launcher.pid && identity(other) === identity(launcher))) {
        errors.push(`PID ${p.pid}: launcher still running; left to its shutdown handler`);
        continue;
      }
      // Reparenting after launcher exit is normal; all other identity fields must match.
      if (identity({...live, parentPid:p.parentPid}) !== identity(p)) { errors.push(`PID ${p.pid} changed; skipped`); continue; }
      try { await signal(p.pid); requested++; }
      catch (error) { if (error.code !== 'ESRCH') errors.push(`PID ${p.pid}: ${error.code || 'signal failed'}`); }
      if (!preview.processes.some(other => other.pid === p.parentPid)) await pause(700);
    }
    await pause(300);
    const finalRows = await snapshot();
    const remainingPids = new Set(finalRows.filter(live => preview.processes.some(p =>
      identity({...live, parentPid:p.parentPid}) === identity(p))).map(p => p.pid));
    for (const p of planStop(finalRows, root, project.stop.matches)) remainingPids.add(p.pid);
    const remaining = remainingPids.size;
    return { message: `SIGTERM requested for ${requested} process(es). ${remaining ? `${remaining} verified process(es) remain; no force-kill was sent.` : 'Verified launcher processes exited; service health is refreshing.'}${errors.length ? ` ${errors.join('; ')}` : ''}`, requested, remaining, errors };
  };
}
