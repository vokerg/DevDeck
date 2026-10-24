import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_PATH = process.env.DEVDECK_CONFIG || path.resolve('config/projects.json');
const OS_KEYS = ['win32', 'darwin', 'linux', 'default'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

function nonEmpty(value, where) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where} must be a non-empty string`);
}
function osValue(value, where) {
  if (typeof value === 'string') return nonEmpty(value, where);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
    throw new Error(`${where} must be a string or OS-keyed object`);
  }
  for (const [os, entry] of Object.entries(value)) {
    if (!OS_KEYS.includes(os)) throw new Error(`${where}: unsupported OS ${os}`);
    nonEmpty(entry, `${where}.${os}`);
  }
}
function checkCwd(value, where) {
  nonEmpty(value, where);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error(`${where} must be relative and stay inside the repository`);
  }
}
function localHttpUrl(value, where) {
  nonEmpty(value, where);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${where} is not a valid URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !HOSTNAMES.includes(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error(`${where} must be a local http(s) URL without credentials`);
  }
}
function port(value, where) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${where} must be 1-65535`);
}
function checkId(value, existing, where) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || existing.has(value)) throw new Error(`Invalid or duplicate ${where}: ${value}`);
  existing.add(value);
}
function checkService(s, projectId, ids) {
  checkId(s.id, ids, `${projectId}.service.id`);
  nonEmpty(s.name, `${projectId}.${s.id}.name`);
  osValue(s.command ?? 'npm run dev', `${projectId}.${s.id}.command`);
  if (s.cwd != null) checkCwd(s.cwd, `${projectId}.${s.id}.cwd`);
  if (s.autostart != null && typeof s.autostart !== 'boolean') throw new Error(`${projectId}.${s.id}.autostart must be boolean`);
  if (s.port != null) port(s.port, `${projectId}.${s.id}.port`);
  if (s.url != null) localHttpUrl(s.url, `${projectId}.${s.id}.url`);
  const h = s.health;
  if (h != null) {
    if (!h || !['http', 'tcp', 'process'].includes(h.type)) throw new Error(`Invalid health type for ${projectId}/${s.id}`);
    if (h.type === 'http') {
      localHttpUrl(h.url, `${projectId}.${s.id}.health.url`);
      if (h.contains != null) nonEmpty(h.contains, `${projectId}.${s.id}.health.contains`);
    }
    if (h.type === 'tcp') {
      port(h.port ?? s.port, `${projectId}.${s.id}.health.port`);
      if (h.host != null && !['localhost', '127.0.0.1', '::1'].includes(h.host)) throw new Error('TCP health must target the local machine');
    }
    if (h.type === 'process') {
      nonEmpty(h.match, `${projectId}.${s.id}.health.match`);
      if (h.match.length < 5) throw new Error('Process match must be distinctive (at least five characters)');
      if (h.cwd != null && typeof h.cwd !== 'boolean') throw new Error('process health.cwd must be a boolean');
    }
  }
}
export function validateConfig(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) throw new Error('config requires a projects array');
  if (!data.baseDirs || typeof data.baseDirs !== 'object') throw new Error('config requires baseDirs');
  for (const [key, value] of Object.entries(data.baseDirs)) {
    if (!OS_KEYS.includes(key)) throw new Error(`Unsupported baseDirs OS: ${key}`);
    nonEmpty(value, `baseDirs.${key}`);
  }
  const ids = new Set();
  for (const p of data.projects) {
    checkId(p.id, ids, 'project.id');
    nonEmpty(p.name, `${p.id}.name`);
    osValue(p.path, `${p.id}.path`);
    if (!Array.isArray(p.services)) throw new Error(`${p.id}.services must be an array`);
    const serviceIds = new Set();
    for (const s of p.services) checkService(s, p.id, serviceIds);
    if (p.launchers != null && !Array.isArray(p.launchers)) throw new Error(`${p.id}.launchers must be an array`);
    const launcherIds = new Set();
    let preferred = 0;
    for (const l of p.launchers || []) {
      checkId(l.id, launcherIds, `${p.id}.launcher.id`);
      nonEmpty(l.name, `${p.id}.${l.id}.name`);
      osValue(l.command, `${p.id}.${l.id}.command`);
      if (l.cwd != null) checkCwd(l.cwd, `${p.id}.${l.id}.cwd`);
      if (!Array.isArray(l.services) || !l.services.length || new Set(l.services).size !== l.services.length || l.services.some((id) => !serviceIds.has(id))) {
        throw new Error(`${p.id}.${l.id}.services must reference distinct configured services`);
      }
      if (l.preferred != null && typeof l.preferred !== 'boolean') throw new Error(`${p.id}.${l.id}.preferred must be boolean`);
      if (l.preferred) preferred++;
    }
    if (preferred > 1) throw new Error(`${p.id} can have only one preferred launcher`);
  }
  return data;
}
export function expandHome(value) {
  return value === '~' ? os.homedir() : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value;
}
export function commandForPlatform(value, platform = process.platform) {
  if (value == null) return null;
  return typeof value === 'string' ? value : (value[platform] || value.default || null);
}
export function getProjectRoot(config, project, platform = process.platform) {
  const selected = commandForPlatform(project.path, platform);
  if (!selected) throw new Error(`${project.id}: no path configured for ${platform}`);
  const base = config.baseDirs[platform] || config.baseDirs.default;
  const chosen = expandHome(selected);
  if (!path.isAbsolute(chosen) && !base) throw new Error(`baseDirs.${platform} is required for relative project paths`);
  return path.resolve(path.isAbsolute(chosen) ? chosen : path.join(expandHome(base), chosen));
}
export function getServiceCwd(root, service) {
  const dir = path.resolve(root, service.cwd || '.');
  const relative = path.relative(root, dir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Working directory must stay inside the repository');
  return dir;
}
export async function loadConfig(configPath = CONFIG_PATH) {
  try { return validateConfig(JSON.parse(await readFile(configPath, 'utf8'))); }
  catch (error) { throw new Error(`Cannot load ${configPath}: ${error.message}`); }
}
