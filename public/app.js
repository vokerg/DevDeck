const state = { projects: [], platform: '', search: '', filter: 'all', pending: false, lastUpdated: null };
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, klass = 'icon') => `<svg aria-hidden="true" class="${klass}"><use href="#i-${name}"/></svg>`;
const active = s => ['running', 'listening', 'detected'].includes(s);
const trouble = s => ['missing', 'attention', 'occupied', 'conflict', 'unknown'].includes(s);
const labels = { running:'Running', listening:'Listening', detected:'Detected', stopped:'Stopped', partial:'Partial', occupied:'Port occupied', conflict:'Ambiguous port', missing:'Missing', attention:'Attention', unconfigured:'Unconfigured', unknown:'Unknown' };
function color(s) { return active(s) ? 'good' : ['partial','attention','occupied','conflict'].includes(s) ? 'warn' : s === 'missing' ? 'bad' : 'idle'; }
function badge(status) { return `<span class="status-badge ${color(status)}"><i></i>${esc(labels[status] || status)}</span>`; }
function validUrl(input) { try {const u = new URL(input);return ['http:','https:'].includes(u.protocol) && ['localhost','127.0.0.1','[::1]'].includes(u.hostname) ? u.href : null;}catch{return null;} }
const canLaunch = () => ['win32','darwin'].includes(state.platform);
const eligible = s => (s.status === 'stopped' || (s.status === 'unknown' && s.unmonitored)) && !!s.command;
function actionButton(p, action, label, title, { klass='secondary-action', target='', kind='', disabled=false, glyph='play' } = {}) {
  return `<button type="button" class="${klass}" data-project="${esc(p.id)}" data-action="${esc(action)}" ${target ? `data-target="${esc(target)}" data-kind="${esc(kind)}"` : ''} title="${esc(title)}" ${disabled || !canLaunch() || state.pending ? 'disabled' : ''}>${icon(glyph)}<span>${esc(label)}</span></button>`;
}
function serviceRow(p, s) {
  const url = validUrl(s.url);
  const details = [s.port ? `:${s.port}` : null, s.cwd !== '.' ? s.cwd : null].filter(Boolean).join(' · ');
  return `<div class="service-row">
    <div class="service-identity"><div class="service-indicator ${color(s.status)}"></div><div class="service-title"><strong>${esc(s.name)}</strong><small title="${esc(s.detail)}">${esc(details || s.detail)}</small><span class="service-command" title="${esc(s.command || 'No command for this OS')}">${esc(s.command || 'Unavailable on this OS')}</span></div></div>
    <div class="service-tools">${badge(s.status)}
      ${url ? `<a class="service-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(url)}">${icon('arrow')}<span>Open</span></a>` : ''}
      ${url ? `<button type="button" class="service-copy" data-copy="${esc(url)}" title="Copy URL">${icon('copy')}</button>` : ''}
      ${actionButton(p,'start','Start',eligible(s) ? `Launch ${s.command} in a native terminal${s.unmonitored ? ' (service has no health check)' : ''}` : `Cannot start: ${s.detail}`,{klass:'service-start',target:s.id,kind:'services',disabled:!eligible(s) || !p.exists,glyph:'play'})}
    </div>
  </div>`;
}
function gitInfo(git) {
  if (!git || git.error) return `<span class="git-meta muted" title="${esc(git?.error || 'Repository not found')}">${icon('code')} Git unavailable</span>`;
  return `<span class="git-meta" title="Current local Git state; no network fetch is performed">${icon('code')} ${esc(git.branch)}${git.dirty ? ' <span class="dirty">● Dirty</span>' : ''}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}</span>`;
}
function launcherRow(p, l) {
  return `<div class="launcher-row"><span class="launcher-desc" title="${esc(l.command || 'No command for this platform')}"><strong>${esc(l.name)}</strong><small>${esc(l.command || 'Unavailable on this OS')} · ${l.services.map(id => esc(p.services.find(s => s.id === id)?.name || id)).join(' + ')}</small></span>
    ${actionButton(p,'launch', 'Launch',l.availability.reason || `Open ${l.command} in terminal`,{klass:'launcher-start',kind:'launchers',target:l.id,disabled:!l.availability.enabled,glyph:'play'})}</div>`;
}
function card(p) {
  const stopped = p.services.some(s => s.autostart && eligible(s));
  const launchers = p.launchers.length ? `<div class="launchers"><div class="services-top"><span>LAUNCH PROFILES</span><span>ONE TERMINAL EACH</span></div>${p.launchers.map(l => launcherRow(p,l)).join('')}</div>` : '';
  return `<article class="project-card">
    <div class="project-card-head"><div class="project-icon">${icon('folder')}</div><div class="project-head-copy"><h3>${esc(p.name)}</h3><div class="project-path" title="${esc(p.root || 'No path for this OS')}">${esc(p.root || 'No path for this OS')}</div></div>${badge(p.status)}</div>
    ${p.description ? `<p class="project-description">${esc(p.description)}</p>` : ''}
    <div class="git-line">${gitInfo(p.git)}${p.services.some(s => s.status === 'conflict') ? `<span class="conflict-notice" title="Two configured projects use the same listening port. Close the other project or change ports to resolve it.">${icon('alert')} Shared port detected</span>` : ''}</div>
    <div class="services-top"><span>SERVICES</span><span>${p.activeCount} / ${p.services.length} ACTIVE</span></div>
    <div class="services-list">${p.services.length ? p.services.map(s => serviceRow(p,s)).join('') : `<div class="empty-services">${icon('gear')}<span>No services configured. Add them in <code>config/projects.json</code>.</span></div>`}</div>
    ${launchers}
    <div class="project-actions">${actionButton(p,'start-stopped','Start stopped','Start a preferred group when all included services are stopped, then other stopped services individually',{klass:'primary-action',disabled:!p.exists || !stopped,glyph:'play'})}<div class="secondary-actions">
      ${actionButton(p,'shell','Shell','Open repository terminal',{disabled:!p.exists,glyph:'terminal'})}
      ${actionButton(p,'pull','Pull','Open git pull --ff-only in native terminal',{disabled:!p.exists,glyph:'pull'})}
      ${actionButton(p,'codex','Codex','Open Codex CLI in repository terminal',{disabled:!p.exists,glyph:'code'})}
    </div></div>
  </article>`;
}
function matches(p) {
  if (state.search && ![p.name,p.root,p.description,p.git?.branch,...p.services.map(s => s.name)].some(v => String(v || '').toLowerCase().includes(state.search))) return false;
  if (state.filter === 'active') return ['running','partial'].includes(p.status);
  if (state.filter === 'inactive') return ['stopped','unconfigured'].includes(p.status);
  if (state.filter === 'attention') return trouble(p.status);
  return true;
}
function render() {
  const all = state.projects, filtered = all.filter(matches);
  $('metric-projects').textContent = all.length;
  $('metric-active').textContent = all.filter(p => ['running','partial'].includes(p.status)).length;
  $('metric-services').textContent = all.reduce((n,p) => n+p.activeCount,0);
  $('metric-service-sub').textContent = `${all.reduce((n,p)=>n+p.services.length,0)} services registered`;
  $('project-count').textContent = filtered.length;
  $('project-grid').innerHTML = filtered.length ? filtered.map(card).join('') : '<div class="loading-panel">No projects match this filter.</div>';
  if (state.lastUpdated) $('updated-at').textContent = `Updated ${state.lastUpdated.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
}
let requestInFlight = false;
async function refresh() {
  if (requestInFlight) return;
  requestInFlight = true;
  $('refresh').classList.add('spinning');
  try {
    const r = await fetch('/api/projects',{cache:'no-store'}), data = await r.json();
    if (!r.ok) throw Error(data.error || `HTTP ${r.status}`);
    state.projects = data.projects; state.platform = data.platform; state.lastUpdated = new Date();
    $('platform').textContent = ({win32:'Windows · PowerShell',darwin:'macOS · Terminal',linux:'Linux · observation only'})[data.platform] || data.platform;
    render();
  } catch (e) {
    $('updated-at').textContent = 'Connection error';
    if (!state.lastUpdated) $('project-grid').innerHTML = `<div class="error-panel">${esc(e.message)}<p>Check the server output and config/projects.json.</p></div>`;
    else toast(`Refresh failed: ${e.message}`,true);
  } finally { requestInFlight = false; $('refresh').classList.remove('spinning'); }
}
let toastTimeout;
function toast(message,error=false) {
  const el = $('toast'); el.textContent = message; el.className = `toast visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{el.className='toast';},5000);
}
async function runAction(button) {
  if (state.pending) return;
  const {project,action,kind,target} = button.dataset;
  const endpoint = `/api/projects/${encodeURIComponent(project)}/${kind ? `${kind}/${encodeURIComponent(target)}/` : ''}${action}`;
  state.pending = true;render();
  try {
    const r = await fetch(endpoint,{method:'POST',headers:{'X-DevDeck-Action':'1'}}), payload = await r.json();
    if (!r.ok) throw Error(payload.error || 'Launch failed');
    toast(payload.message);
    setTimeout(refresh,1300);
  } catch(e) { toast(e.message,true); }
  finally {state.pending=false;render();}
}
$('project-grid').addEventListener('click', event => {
  const copy = event.target.closest('button[data-copy]');
  if (copy) { navigator.clipboard.writeText(copy.dataset.copy).then(()=>toast('URL copied'),()=>toast('Could not copy URL',true));return; }
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) runAction(button);
});
$('search').addEventListener('input', e => {state.search=e.target.value.trim().toLowerCase();render();});
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click',()=>{
  state.filter=button.dataset.filter;
  document.querySelectorAll('.filter').forEach(el=>el.classList.toggle('active',el===button));
  render();
}));
$('refresh').addEventListener('click',refresh);
refresh();setInterval(refresh,5000);
