const state = { projects: [], search: '', filter: 'all', pending: null, lastUpdated: null };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name, className = 'icon') {
  return `<svg aria-hidden="true" class="${className}"><use href="#i-${name}"/></svg>`;
}

function isActive(status) { return ['running', 'listening', 'detected'].includes(status); }
function needsAttention(status) { return ['missing', 'attention', 'occupied', 'unknown'].includes(status); }
const LABELS = {
  running: 'Running', listening: 'Listening', detected: 'Detected', stopped: 'Stopped',
  partial: 'Partial', occupied: 'Port in use', missing: 'Missing', attention: 'Attention',
  unconfigured: 'Unconfigured', unknown: 'Unknown'
};

function statusClass(status) {
  if (status === 'running' || status === 'listening' || status === 'detected') return 'good';
  if (['partial', 'attention', 'occupied'].includes(status)) return 'warn';
  if (status === 'missing') return 'bad';
  return 'idle';
}

function badge(status) {
  return `<span class="status-badge ${statusClass(status)}"><i></i>${escapeHtml(LABELS[status] || status)}</span>`;
}

function validHttpUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function serviceRow(project, service) {
  const p = escapeHtml(project.id);
  const s = escapeHtml(service.id);
  const active = isActive(service.status);
  const disabled = !project.exists || !service.command || active || service.status === 'occupied' || service.status === 'missing';
  const url = validHttpUrl(service.url);
  const meta = [service.port ? `:${service.port}` : null, service.cwd !== '.' ? service.cwd : null].filter(Boolean).join(' · ');
  return `<div class="service-row">
    <div class="service-identity"><div class="service-indicator ${statusClass(service.status)}"></div><div class="service-title"><strong>${escapeHtml(service.name)}</strong><small title="${escapeHtml(service.detail)}">${escapeHtml(meta || service.detail)}</small></div></div>
    <div class="service-tools">${badge(service.status)}
      ${url ? `<a class="service-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(service.name)} in browser">${icon('arrow')}<span>Open</span></a>` : ''}
      <button class="service-start" type="button" data-action="start" data-project="${p}" data-service="${s}" title="Open configured start command in terminal" ${disabled || state.pending ? 'disabled' : ''}>${icon('play')}<span>Start</span></button>
    </div>
  </div>`;
}

function projectCard(p) {
  const serviceCount = p.services.length;
  const running = p.services.filter((s) => isActive(s.status)).length;
  const missing = !p.exists;
  return `<article class="project-card">
    <div class="project-card-head"><div class="project-icon">${icon('folder')}</div><div class="project-head-copy"><h3>${escapeHtml(p.name)}</h3><div class="project-path" title="${escapeHtml(p.root)}">${escapeHtml(p.root)}</div></div>${badge(p.status)}</div>
    ${p.description ? `<p class="project-description">${escapeHtml(p.description)}</p>` : ''}
    <div class="services-top"><span>SERVICES</span><span>${running} / ${serviceCount} ACTIVE</span></div>
    <div class="services-list">${serviceCount ? p.services.map((s) => serviceRow(p, s)).join('') : `<div class="empty-services">${icon('gear')}<span>No services configured yet. Add them in <code>config/projects.json</code>.</span></div>`}</div>
    <div class="project-actions"><button class="primary-action" type="button" data-project="${escapeHtml(p.id)}" data-action="start-stopped" title="Launch configured services that are not detected as running" ${missing || !serviceCount || state.pending ? 'disabled' : ''}>${icon('play')} Start stopped</button><div class="secondary-actions">
      <button type="button" class="secondary-action" data-project="${escapeHtml(p.id)}" data-action="shell" title="Open native terminal in repository" ${missing || state.pending ? 'disabled' : ''}>${icon('terminal')}<span>Shell</span></button>
      <button type="button" class="secondary-action" data-project="${escapeHtml(p.id)}" data-action="pull" title="Run git pull --ff-only in native terminal" ${missing || state.pending ? 'disabled' : ''}>${icon('pull')}<span>Pull</span></button>
      <button type="button" class="secondary-action" data-project="${escapeHtml(p.id)}" data-action="codex" title="Run codex in native terminal" ${missing || state.pending ? 'disabled' : ''}>${icon('code')}<span>Codex</span></button>
    </div></div>
  </article>`;
}

function matchesFilter(project) {
  if (state.search && ![project.name, project.root, project.description].some((x) => String(x || '').toLowerCase().includes(state.search))) return false;
  if (state.filter === 'active') return ['running', 'partial'].includes(project.status);
  if (state.filter === 'inactive') return ['stopped', 'unconfigured'].includes(project.status);
  if (state.filter === 'attention') return needsAttention(project.status);
  return true;
}

function render() {
  const all = state.projects;
  const filtered = all.filter(matchesFilter);
  $('metric-projects').textContent = all.length;
  $('metric-active').textContent = all.filter((p) => ['running', 'partial'].includes(p.status)).length;
  const total = all.reduce((n, p) => n + p.services.length, 0);
  const active = all.reduce((n, p) => n + p.activeCount, 0);
  $('metric-services').textContent = active;
  $('metric-service-sub').textContent = `${total} services registered`;
  $('project-count').textContent = `${filtered.length}`;
  $('project-grid').innerHTML = filtered.length
    ? filtered.map(projectCard).join('')
    : `<div class="loading-panel">No projects match this filter.</div>`;
  if (state.lastUpdated) $('updated-at').textContent = `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

let requestInFlight = false;
async function refresh() {
  if (requestInFlight) return;
  requestInFlight = true;
  $('refresh').classList.add('spinning');
  try {
    const response = await fetch('/api/projects', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.projects = payload.projects;
    state.lastUpdated = new Date();
    $('platform').textContent = ({ win32: 'Windows · PowerShell', darwin: 'macOS · Terminal', linux: 'Linux · status only' })[payload.platform] || payload.platform;
    render();
  } catch (error) {
    $('updated-at').textContent = 'Connection error';
    if (!state.lastUpdated) $('project-grid').innerHTML = `<div class="error-panel">Could not read projects: ${escapeHtml(error.message)}<br><small>Check the server output and config/projects.json.</small></div>`;
  } finally {
    requestInFlight = false;
    $('refresh').classList.remove('spinning');
  }
}

let toastTimeout;
function toast(message, error = false) {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { element.className = 'toast'; }, 4400);
}

async function runAction(button) {
  if (state.pending) return;
  const project = button.dataset.project;
  const action = button.dataset.action;
  const service = button.dataset.service;
  const url = `/api/projects/${encodeURIComponent(project)}/${service ? `services/${encodeURIComponent(service)}/` : ''}${action}`;
  state.pending = `${project}/${action}`;
  render();
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'X-DevDeck-Action': '1' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Action failed');
    toast(payload.message);
    setTimeout(refresh, 1200);
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.pending = null;
    render();
  }
}

$('project-grid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) runAction(button);
});
$('search').addEventListener('input', (event) => { state.search = event.target.value.trim().toLowerCase(); render(); });
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button));
  render();
}));
$('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
