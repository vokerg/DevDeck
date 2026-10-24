import { access } from 'node:fs/promises';
import { getProjectRoot, getServiceCwd, commandForPlatform } from './config.js';
import { getProjectStatuses } from './status.js';
import { openTerminal } from './terminal.js';

const present = path => access(path).then(() => true, () => false);
const LAUNCH_COOLDOWN_MS = 12000;

/** A status snapshot and short launch cooldown guard against accidental double-starts. */
export function createActions({ terminal = openTerminal, statuses = getProjectStatuses, platform = process.platform, now = Date.now } = {}) {
  const launchedAt = new Map();
  const hasCooldown = key => (now() - (launchedAt.get(key) || -Infinity)) < LAUNCH_COOLDOWN_MS;
  function reserve(projectId, ids) { for (const id of ids) launchedAt.set(`${projectId}/${id}`, now()); }
  function clear(projectId, ids) { for (const id of ids) launchedAt.delete(`${projectId}/${id}`); }

  return async function perform(config, projectId, action, targetId = null) {
    const project = config.projects.find(p => p.id === projectId);
    if (!project) return { code: 404, message: 'Project not found' };
    let root;
    try { root = getProjectRoot(config, project, platform); }
    catch (error) { return { code: 422, message: error.message }; }
    if (!(await present(root))) return { code: 409, message: `Repository directory not found: ${root}` };
    if (!['win32', 'darwin'].includes(platform)) return { code: 422, message: 'Native terminal launch is supported on Windows and macOS' };

    if (['shell', 'pull', 'codex'].includes(action) && !targetId) {
      const command = action === 'pull' ? 'git pull --ff-only' : action === 'codex' ? 'codex' : '';
      await terminal(root, command, platform);
      return { message: `${action} opened in native terminal`, launched: 1 };
    }

    const state = (await statuses(config, { git: false })).find(p => p.id === projectId);
    if (!state) return { code: 404, message: 'Project not found' };
    const start = async (entry, ids) => {
      const command = commandForPlatform(entry.command ?? 'npm run dev', platform);
      if (!command) return { code: 422, message: 'No command configured for this operating system' };
      const cwd = getServiceCwd(root, entry);
      if (!(await present(cwd))) return { code: 409, message: `Working directory missing: ${cwd}` };
      const included = ids.map(id => state.services.find(s => s.id === id));
      if (included.some(s => !s || (s.status !== 'stopped' && !(ids.length === 1 && entry.id === ids[0] && s.status === 'unknown' && s.unmonitored)))) return { code: 409, message: `Cannot start: required services are not confirmed stopped (${included.map(s => `${s?.name || 'unknown'}: ${s?.status || 'unknown'}`).join(', ')})` };
      if (ids.some(id => hasCooldown(`${projectId}/${id}`))) return { code: 409, message: 'Launch already requested recently; check the terminal or refresh status' };
      reserve(projectId, ids);
      try { await terminal(cwd, command, platform); }
      catch (error) { clear(projectId, ids); throw error; }
      return { message: `Opened terminal: ${command}`, launched: 1 };
    };

    if (action === 'start' && targetId) {
      const svc = project.services.find(s => s.id === targetId);
      if (!svc) return { code: 404, message: 'Service not found' };
      return start(svc, [svc.id]);
    }
    if (action === 'launch' && targetId) {
      const launcher = (project.launchers || []).find(l => l.id === targetId);
      if (!launcher) return { code: 404, message: 'Launch profile not found' };
      return start(launcher, launcher.services);
    }
    if (action === 'start-stopped' && !targetId) {
      const results = [], covered = new Set();
      const blocked = project.services.filter(s => s.autostart !== false).filter(s => {
        const current = state.services.find(p => p.id === s.id);
        return !current || !['stopped', 'running', 'listening', 'detected'].includes(current.status);
      });
      if (blocked.length) return { code: 409, message: `Cannot start safely: ${blocked.map(s => `${s.name} is ${state.services.find(x => x.id === s.id)?.status || 'unknown'}`).join(', ')}. Resolve the health or port issue first.` };
      const groups = [...(project.launchers || [])].filter(l => commandForPlatform(l.command, platform)).sort((a, b) => Number(b.preferred) - Number(a.preferred));
      for (const group of groups) {
        if (group.services.some(id => covered.has(id))) continue;
        if (group.services.some(id => project.services.find(s => s.id === id)?.autostart === false)) continue;
        if (!group.services.every(id => state.services.some(s => s.id === id && s.status === 'stopped'))) continue;
        const result = await start(group, group.services);
        if (result.code) return result;
        results.push(group.name); group.services.forEach(id => covered.add(id));
      }
      for (const service of project.services) {
        if (covered.has(service.id) || service.autostart === false) continue;
        const status = state.services.find(s => s.id === service.id);
        if (!status || status.status !== 'stopped' || hasCooldown(`${projectId}/${service.id}`)) continue;
        const result = await start(service, [service.id]);
        if (result.code) return result;
        results.push(service.name);
      }
      return { message: results.length ? `Opened ${results.length} terminal(s): ${results.join(', ')}` : 'No confirmed stopped services to launch', launched: results.length };
    }
    return { code: 404, message: 'Unknown action' };
  };
}
