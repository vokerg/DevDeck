import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_PATH = process.env.DEVDECK_CONFIG || path.resolve('config/projects.json');

function nonEmpty(value, description) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${description} must be a non-empty string`);
  }
}

function checkCommand(command, where) {
  if (typeof command === 'string') return nonEmpty(command, where);
  if (command && typeof command === 'object' && !Array.isArray(command)) {
    if (!Object.entries(command).length) throw new Error(`${where} must not be empty`);
    for (const [platform, value] of Object.entries(command)) {
      if (!['win32', 'darwin', 'linux', 'default'].includes(platform)) throw new Error(`${where}: unsupported OS ${platform}`);
      nonEmpty(value, `${where}.${platform}`);
    }
    return;
  }
  throw new Error(`${where} must be a string or OS-keyed object`);
}

function checkPort(port, where) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${where} must be 1-65535`);
}

function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) throw new Error('config requires a projects array');
  if (!data.baseDirs || typeof data.baseDirs !== 'object') throw new Error('config requires baseDirs');
  const projectIds = new Set();
  for (const p of data.projects) {
    nonEmpty(p.id, 'project.id');
    nonEmpty(p.name, `${p.id}.name`);
    nonEmpty(p.path, `${p.id}.path`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) throw new Error(`Invalid project id: ${p.id}`);
    if (projectIds.has(p.id)) throw new Error(`Duplicate project id: ${p.id}`);
    projectIds.add(p.id);
    if (!Array.isArray(p.services)) throw new Error(`${p.id}.services must be an array`);
    const serviceIds = new Set();
    for (const s of p.services) {
      nonEmpty(s.id, `${p.id}.service.id`);
      nonEmpty(s.name, `${p.id}.${s.id}.name`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id) || serviceIds.has(s.id)) throw new Error(`Invalid or duplicate service id ${p.id}/${s.id}`);
      serviceIds.add(s.id);
      checkCommand(s.command, `${p.id}.${s.id}.command`);
      if (s.cwd != null) nonEmpty(s.cwd, `${p.id}.${s.id}.cwd`);
      if (s.port != null) checkPort(s.port, `${p.id}.${s.id}.port`);
      if (s.url != null) {
        const u = new URL(s.url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${p.id}.${s.id}.url must be http(s)`);
      }
      if (s.health) {
        if (!['http', 'tcp', 'process'].includes(s.health.type)) throw new Error(`Invalid health type for ${p.id}/${s.id}`);
        if (s.health.type === 'http') {
          nonEmpty(s.health.url, `${p.id}.${s.id}.health.url`);
          const url = new URL(s.health.url);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('health.url must be http(s)');
          if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('health.url must use the local machine');
        }
        if (s.health.type === 'tcp') {
          checkPort(s.health.port ?? s.port, `${p.id}.${s.id}.health.port`);
          if (s.health.host != null && !['localhost', '127.0.0.1', '::1'].includes(s.health.host)) throw new Error('TCP health must target the local machine');
        }
        if (s.health.type === 'process') nonEmpty(s.health.match, `${p.id}.${s.id}.health.match`);
      }
    }
  }
  return data;
}

export function expandHome(value) {
  return value === '~' ? os.homedir() : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value;
}

export function getProjectRoot(config, project, platform = process.platform) {
  const base = config.baseDirs[platform];
  if (!path.isAbsolute(expandHome(project.path))) nonEmpty(base, `baseDirs.${platform}`);
  return path.resolve(expandHome(path.isAbsolute(expandHome(project.path)) ? project.path : path.join(expandHome(base), project.path)));
}

export function getServiceCwd(root, service) {
  const dir = path.resolve(root, service.cwd || '.');
  const relative = path.relative(root, dir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Service cwd must stay inside the repository');
  }
  return dir;
}

export function commandForPlatform(command, platform = process.platform) {
  return typeof command === 'string' ? command : (command[platform] || command.default || null);
}

export async function loadConfig(configPath = CONFIG_PATH) {
  let data;
  try {
    data = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot load ${configPath}: ${error.message}`);
  }
  return validate(data);
}
