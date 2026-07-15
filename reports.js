// reports.js — workspace report system v2
// Reports are server-computed snapshots (Worker /report/*). Everything here
// renders from saved snapshots — no live numbers enter a completed report.

var _rptWorker = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';
var _rptList = [];          // index entries
var _rptFull = {};          // id → full record cache
var _rptSel = null;
var _rptPage = 1;
var RPT_PAGE_SIZE = 25;
var _rptFilters = { q: '', type: 'all', status: 'all', owner: 'all', sort: 'newest' };
var _rptFlow = null;        // stepped New Report state

// ── auth fetch ────────────────────────────────────────────────────────────────

async function rptFetch(method, path, body) {
  var client = window.__auth0Client;
  if (!client) return { status: 0 };
  var claims;
  try { claims = await client.getIdTokenClaims(); } catch (e) { return { status: 0 }; }
  if (!claims || !claims.__raw) return { status: 0 };
  try {
    var res = await fetch(_rptWorker + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data };
  } catch (e) { return { status: 0 }; }
}

// ── formatting ────────────────────────────────────────────────────────────────

function rptEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rptFmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function rptFmtRange(a, b) {
  if (!a || !b) return '—';
  var da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  var sameYear = da.getFullYear() === db.getFullYear();
  var f1 = da.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  var f2 = db.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return f1 + ' – ' + f2;
}
function rptFmtTs(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function rptFmtDur(secs) {
  if (secs == null) return '—';
  if (secs < 60) return Math.round(secs) + 's';
  var m = Math.floor(secs / 60), s = Math.round(secs % 60);
  if (m < 60) return m + 'm ' + (s ? s + 's' : '').trim();
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function rptMoney(v) { return '$' + Number(v || 0).toLocaleString(); }

var RPT_TYPE_META = {
  full:      { label: 'Full Report', cls: 'rtc-blue',   desc: 'Complete performance overview' },
  executive: { label: 'Executive',   cls: 'rtc-purple', desc: 'Leadership summary report' },
  leads:     { label: 'Leads',       cls: 'rtc-green',  desc: 'Lead volume and conversion' },
  pipeline:  { label: 'Pipeline',    cls: 'rtc-teal',   desc: 'Pipeline stages and movement' },
  custom:    { label: 'Custom',      cls: 'rtc-gray',   desc: 'Custom section selection' },
};
var RPT_STATUS_META = {
  ready:      { label: 'Ready',      cls: 'rsb-ready' },
  generating: { label: 'Generating', cls: 'rsb-gen' },
  failed:     { label: 'Failed',     cls: 'rsb-failed' },
  archived:   { label: 'Archived',   cls: 'rsb-arch' },
};
var RPT_SECTION_LABELS = {
  summary: 'Executive summary', kpis: 'Key performance indicators', volume: 'Lead volume',
  sources: 'Lead sources', response: 'Response-time analysis', status: 'Lead qualification',
  pipeline: 'Pipeline movement', followups: 'Follow-up activity', financial: 'Financial activity',
  recommendations: 'Recommendations', appendix: 'Appendix',
};

function rptStatusOf(r) {
  if (r.archivedAt) return 'archived';
  if (r.status === 'generating' && Date.now() - r.createdAt > 600000) return 'failed';
  return r.status;
}
function rptBadge(r) {
  var st = rptStatusOf(r);
  var m = RPT_STATUS_META[st] || RPT_STATUS_META.ready;
  return '<span class="rpt-badge ' + m.cls + '"><span class="rpt-badge-dot"></span>' + m.label + '</span>';
}
function rptTypeChip(t) {
  var m = RPT_TYPE_META[t] || RPT_TYPE_META.custom;
  return '<span class="rpt-type-chip ' + m.cls + '">' + m.label + '</span>';
}
function rptCanEdit() { return !window.__myRole || ['member', 'admin', 'owner'].indexOf(window.__myRole) !== -1; }
function rptCanAdmin() { return !window.__myRole || ['admin', 'owner'].indexOf(window.__myRole) !== -1; }

// ── init + migration ──────────────────────────────────────────────────────────

async function reportsInit() {
  rptReadHash();
  rptKpiSkeleton();
  var tbody = document.getElementById('rpt-tbody');
  if (tbody) tbody.innerHTML = rptTableSkeleton();

  await rptMigrateLegacy();

  var r = await rptFetch('GET', '/report/list');
  _rptList = (r.status === 200 && r.data && r.data.reports) ? r.data.reports : [];
  if (r.status !== 200 && r.status !== 0 && tbody) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:40px;"><i data-lucide="alert-circle"></i><div class="empty-state-title">Could not load reports</div><div class="empty-state-sub">Check your connection and try again.</div></div></td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  rptRenderAll();
  // deep link #reports/{id}
  var m = (location.hash || '').match(/^#reports\/([\w-]+)/);
  if (m) rptOpenViewer(m[1]);
}
window.reportsInit = reportsInit;

async function rptMigrateLegacy() {
  var sub = window.__userSub || '';
  if (!sub) return;
  if (localStorage.getItem('flw_rpt_migrated_' + sub)) return;
  var legacy = [];
  try { legacy = JSON.parse(localStorage.getItem('flw_reports_' + sub) || '[]'); } catch (e) {}
  if (!legacy.length) {
    try { localStorage.setItem('flw_rpt_migrated_' + sub, '1'); } catch (e) {}
    return;
  }
  var r = await rptFetch('POST', '/report/migrate', { reports: legacy });
  if (r.status === 200) {
    try {
      localStorage.setItem('flw_rpt_migrated_' + sub, '1');
      localStorage.removeItem('flw_reports_' + sub);
    } catch (e) {}
    if (r.data.migrated && typeof showToast === 'function') {
      showToast(r.data.migrated + ' report' + (r.data.migrated === 1 ? '' : 's') + ' moved to your workspace.');
    }
  }
}

function rptRenderAll() {
  renderReportKPIs(_rptList);
  rptRenderOwnerFilter();
  renderReportTable();
  rptRenderPanel();
}

function rptById(id) { return _rptList.find(function(x) { return x.id === id; }); }

async function rptLoadFull(id) {
  if (_rptFull[id]) return _rptFull[id];
  var r = await rptFetch('GET', '/report/get?id=' + encodeURIComponent(id));
  if (r.status === 200 && r.data && r.data.report) {
    _rptFull[id] = r.data.report;
    return r.data.report;
  }
  return null;
}

// ── summary cards ─────────────────────────────────────────────────────────────

function rptKpiSkeleton() {
  ['rpt-kpi-generated', 'rpt-kpi-latest', 'rpt-kpi-issues', 'rpt-kpi-stored'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="skel" style="display:inline-block;width:64px;height:20px;"></span>';
    var s = document.getElementById(id + '-sub');
    if (s) s.textContent = '';
  });
}

function renderReportKPIs(list) {
  var days = window.__rangeDays || 30;
  var cutoff = Date.now() - days * 86400000;
  var active = list.filter(function(r) { return !r.archivedAt; });
  var generated = active.filter(function(r) { return r.status === 'ready' && (r.generatedAt || 0) >= cutoff; }).length;
  var failed = active.filter(function(r) { return rptStatusOf(r) === 'failed'; }).length;
  var latest = active.filter(function(r) { return r.status === 'ready'; })
    .sort(function(a, b) { return (b.generatedAt || 0) - (a.generatedAt || 0); })[0];
  var archived = list.length - active.length;

  function set(id, val, sub) {
    var el = document.getElementById(id); if (el) el.textContent = val;
    var s = document.getElementById(id + '-sub'); if (s) s.innerHTML = sub;
  }
  set('rpt-kpi-generated', String(generated), 'Last ' + days + ' days');
  set('rpt-kpi-latest', latest ? new Date(latest.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
    latest ? rptEsc(latest.name) : 'No reports yet');
  set('rpt-kpi-issues', String(failed), failed ? '<span style="color:var(--red);">Failed or incomplete</span>' : 'No failures');
  set('rpt-kpi-stored', String(active.length), archived ? archived + ' archived' : 'In this workspace');
}

function rptCardFilter(status) {
  _rptFilters.status = (_rptFilters.status === status) ? 'all' : status;
  var sel = document.getElementById('rpt-f-status');
  if (sel) sel.value = _rptFilters.status;
  _rptPage = 1;
  renderReportTable();
  rptSyncHash();
}
window.rptCardFilter = rptCardFilter;

// ── filters ───────────────────────────────────────────────────────────────────

function rptRenderOwnerFilter() {
  var sel = document.getElementById('rpt-f-owner');
  if (!sel) return;
  var cur = _rptFilters.owner;
  var owners = {};
  _rptList.forEach(function(r) { if (r.generatedByName) owners[r.generatedByName] = 1; });
  sel.innerHTML = '<option value="all">All owners</option>' + Object.keys(owners).sort().map(function(n) {
    return '<option value="' + rptEsc(n) + '">' + rptEsc(n) + '</option>';
  }).join('');
  sel.value = owners[cur] ? cur : 'all';
}

function rptFilterChange() {
  _rptFilters.q      = ((document.getElementById('rpt-search') || {}).value || '').toLowerCase();
  _rptFilters.type   = (document.getElementById('rpt-f-type') || {}).value || 'all';
  _rptFilters.status = (document.getElementById('rpt-f-status') || {}).value || 'all';
  _rptFilters.owner  = (document.getElementById('rpt-f-owner') || {}).value || 'all';
  _rptFilters.sort   = (document.getElementById('rpt-f-sort') || {}).value || 'newest';
  _rptPage = 1;
  renderReportTable();
  rptSyncHash();
}
window.rptFilterChange = rptFilterChange;

function rptClearFilters() {
  _rptFilters = { q: '', type: 'all', status: 'all', owner: 'all', sort: 'newest' };
  var s = document.getElementById('rpt-search'); if (s) s.value = '';
  ['rpt-f-type', 'rpt-f-status', 'rpt-f-owner'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = 'all';
  });
  var so = document.getElementById('rpt-f-sort'); if (so) so.value = 'newest';
  _rptPage = 1;
  renderReportTable();
  rptSyncHash();
}
window.rptClearFilters = rptClearFilters;

function rptApplyFilters() {
  var f = _rptFilters;
  var rows = _rptList.filter(function(r) {
    var st = rptStatusOf(r);
    if (f.status === 'all' && st === 'archived') return false; // archived hidden by default
    if (f.status !== 'all' && st !== f.status) return false;
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.owner !== 'all' && r.generatedByName !== f.owner) return false;
    if (f.q && (r.name || '').toLowerCase().indexOf(f.q) === -1) return false;
    return true;
  });
  var sorts = {
    newest:  function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); },
    oldest:  function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); },
    nameaz:  function(a, b) { return (a.name || '').localeCompare(b.name || ''); },
    nameza:  function(a, b) { return (b.name || '').localeCompare(a.name || ''); },
    range:   function(a, b) { return (b.rangeEnd || '') < (a.rangeEnd || '') ? -1 : 1; },
    viewed:  function(a, b) { return (b.lastViewedAt || 0) - (a.lastViewedAt || 0); },
  };
  rows.sort(sorts[f.sort] || sorts.newest);
  return rows;
}

// ── hash state ────────────────────────────────────────────────────────────────

function rptSyncHash() {
  var page = document.getElementById('page-reports');
  if (!page || !page.classList.contains('active')) return;
  var f = _rptFilters, parts = [];
  if (f.q) parts.push('q=' + encodeURIComponent(f.q));
  if (f.type !== 'all') parts.push('type=' + f.type);
  if (f.status !== 'all') parts.push('status=' + f.status);
  if (f.owner !== 'all') parts.push('owner=' + encodeURIComponent(f.owner));
  if (f.sort !== 'newest') parts.push('sort=' + f.sort);
  try { history.replaceState(null, '', location.pathname + location.search + '#reports' + (parts.length ? '?' + parts.join('&') : '')); } catch (e) {}
}

function rptReadHash() {
  var h = location.hash || '';
  if (h.indexOf('#reports?') !== 0) return;
  var p = new URLSearchParams(h.slice('#reports?'.length));
  _rptFilters.q = p.get('q') || '';
  _rptFilters.type = p.get('type') || 'all';
  _rptFilters.status = p.get('status') || 'all';
  _rptFilters.owner = p.get('owner') || 'all';
  _rptFilters.sort = p.get('sort') || 'newest';
  var s = document.getElementById('rpt-search'); if (s) s.value = _rptFilters.q;
  ['type', 'status', 'owner', 'sort'].forEach(function(k) {
    var el = document.getElementById('rpt-f-' + k);
    if (el) el.value = _rptFilters[k === 'sort' ? 'sort' : k];
  });
}

// ── table ─────────────────────────────────────────────────────────────────────

function rptTableSkeleton() {
  var rows = '';
  for (var i = 0; i < 5; i++) {
    rows += '<tr><td colspan="8" style="padding:14px 16px;"><div class="skel" style="height:14px;width:' + (50 + i * 9) + '%;"></div></td></tr>';
  }
  return rows;
}

function renderReportTable() {
  var tbody = document.getElementById('rpt-tbody');
  if (!tbody) return;
  var rows = rptApplyFilters();
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / RPT_PAGE_SIZE));
  if (_rptPage > pages) _rptPage = pages;
  var start = (_rptPage - 1) * RPT_PAGE_SIZE;
  var page = rows.slice(start, start + RPT_PAGE_SIZE);

  if (!_rptList.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:48px 20px;">' +
      '<i data-lucide="bar-chart-2"></i><div class="empty-state-title">No reports have been generated yet</div>' +
      '<div class="empty-state-sub">Reports turn your CRM activity into shareable performance documents.</div>' +
      '<button class="cmd-primary" style="margin-top:14px;" onclick="openReportEditor()"><i data-lucide="plus"></i>Generate First Report</button></div></td></tr>';
  } else if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:40px 20px;">' +
      '<i data-lucide="search-x"></i><div class="empty-state-title">No reports match the selected filters</div>' +
      '<div class="empty-state-sub"><span class="sec-link" onclick="rptClearFilters()">Clear filters</span></div></div></td></tr>';
  } else {
    tbody.innerHTML = page.map(function(r) {
      var meta = RPT_TYPE_META[r.type] || RPT_TYPE_META.custom;
      var sel = _rptSel === r.id ? ' inv-row-sel' : '';
      return '<tr class="inv-row' + sel + '" onclick="reportsSelect(\'' + r.id + '\')">' +
        '<td><div class="rpt-name-cell"><div class="rpt-doc-ic ' + meta.cls + '"><i data-lucide="file-bar-chart"></i></div>' +
          '<div class="inv-client-cell"><div class="inv-client-name">' + rptEsc(r.name) + '</div>' +
          '<div class="inv-client-email">' + (r.legacy ? 'Migrated report' : rptEsc(meta.desc)) + '</div></div></div></td>' +
        '<td>' + rptTypeChip(r.type) + '</td>' +
        '<td class="inv-date">' + rptFmtRange(r.rangeStart, r.rangeEnd) + '</td>' +
        '<td class="inv-date">' + (r.generatedAt ? rptFmtTs(r.generatedAt) : '—') + '</td>' +
        '<td><div class="rpt-owner">' + (typeof avatarHtml === 'function' ? avatarHtml(r.generatedByName || '?') : '') +
          '<span>' + rptEsc(r.generatedByName || '—') + '</span></div></td>' +
        '<td>' + rptBadge(r) + '</td>' +
        '<td class="inv-date">' + (rptStatusOf(r) === 'ready' ? 'Web · PDF' : '—') + '</td>' +
        '<td class="inv-actions-cell"><button class="inv-dots" onclick="rptRowMenu(event,\'' + r.id + '\')" title="Actions" aria-label="Report actions">···</button></td>' +
      '</tr>';
    }).join('');
  }

  var foot = document.getElementById('rpt-table-foot');
  if (foot) {
    if (!total) foot.innerHTML = '';
    else foot.innerHTML = '<span>Showing ' + (start + 1) + '–' + Math.min(start + RPT_PAGE_SIZE, total) + ' of ' + total + ' ' + (total === 1 ? 'report' : 'reports') + '</span>' +
      '<span class="inv-pager">' +
      '<button class="inv-page-btn" ' + (_rptPage <= 1 ? 'disabled' : '') + ' onclick="rptGoPage(' + (_rptPage - 1) + ')" aria-label="Previous page">‹</button>' +
      '<span class="inv-page-num">' + _rptPage + '</span>' +
      '<button class="inv-page-btn" ' + (_rptPage >= pages ? 'disabled' : '') + ' onclick="rptGoPage(' + (_rptPage + 1) + ')" aria-label="Next page">›</button></span>';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderReportTable = renderReportTable;

function rptGoPage(p) { _rptPage = Math.max(1, p); renderReportTable(); }
window.rptGoPage = rptGoPage;

// ── row menu ──────────────────────────────────────────────────────────────────

function rptRowMenu(e, id) {
  e.stopPropagation();
  var menu = document.getElementById('rpt-row-menu');
  var r = rptById(id);
  if (!menu || !r) return;
  var st = rptStatusOf(r);
  var member = rptCanEdit(), admin = rptCanAdmin();
  var items = [];
  function it(icon, label, fn, danger) {
    items.push('<div class="card-ctx-item' + (danger ? ' ctx-danger' : '') + '" onclick="' + fn + '"><i data-lucide="' + icon + '"></i>' + label + '</div>');
  }
  if (st === 'ready') {
    it('external-link', 'Open report', 'rptOpenViewer(\'' + id + '\')');
    it('download', 'Download PDF', 'rptDownloadPdf(\'' + id + '\')');
    if (!r.legacy) it('table', 'Download CSV', 'rptDownloadCsv(\'' + id + '\')');
    it('message-square', 'Share to team chat', 'reportsShareTeam(\'' + id + '\')');
    if (member && !r.legacy) it('copy', 'Duplicate', 'rptDuplicate(\'' + id + '\')');
    if (member) it('pencil', 'Rename', 'rptRename(\'' + id + '\')');
    if (member) it('archive', 'Archive', 'rptArchive(\'' + id + '\', true)');
    if (admin) it('trash-2', 'Delete', 'rptDelete(\'' + id + '\')', true);
  } else if (st === 'failed') {
    it('alert-circle', 'View error', 'reportsSelect(\'' + id + '\')');
    if (member && r.cfgHash !== undefined) it('rotate-ccw', 'Retry', 'rptRetry(\'' + id + '\')');
    if (member) it('trash-2', 'Delete', 'rptDelete(\'' + id + '\')', true);
  } else if (st === 'archived') {
    it('external-link', 'Open report', 'rptOpenViewer(\'' + id + '\')');
    if (member) it('archive-restore', 'Restore', 'rptArchive(\'' + id + '\', false)');
    if (admin) it('trash-2', 'Delete', 'rptDelete(\'' + id + '\')', true);
  } else {
    it('eye', 'View progress', 'reportsSelect(\'' + id + '\')');
  }
  menu.innerHTML = items.join('');
  var rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - items.length * 34 - 16) + 'px';
  menu.style.left = Math.max(8, rect.right - 190) + 'px';
  menu.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.rptRowMenu = rptRowMenu;

document.addEventListener('click', function() {
  var m = document.getElementById('rpt-row-menu');
  if (m) m.classList.remove('open');
});

// ── detail panel ──────────────────────────────────────────────────────────────

function reportsSelect(id) {
  _rptSel = id;
  renderReportTable();
  rptRenderPanel();
  rptLoadFull(id).then(function() { if (_rptSel === id) rptRenderPanel(); });
  var panel = document.getElementById('rpt-detail-panel');
  if (panel && window.innerWidth <= 900) panel.classList.add('inv-mobile-open');
}
window.reportsSelect = reportsSelect;

function rptClosePanel() {
  _rptSel = null;
  var panel = document.getElementById('rpt-detail-panel');
  if (panel) panel.classList.remove('inv-mobile-open');
  renderReportTable();
  rptRenderPanel();
}
window.rptClosePanel = rptClosePanel;

var RPT_EVENT_LABELS = {
  created: 'Report configured', generated: 'Generation completed', failed: 'Generation failed',
  retried: 'Generation retried', viewed: 'Viewed', downloaded: 'Downloaded',
  renamed: 'Renamed', archived: 'Archived', restored: 'Restored',
};

function rptRenderPanel() {
  var panel = document.getElementById('rpt-detail-panel');
  if (!panel) return;
  var r = _rptSel ? rptById(_rptSel) : null;
  if (!r) {
    panel.innerHTML = '<div class="empty-state" style="padding:60px 20px;">' +
      '<i data-lucide="file-bar-chart"></i><div class="empty-state-title">Select a report</div>' +
      '<div class="empty-state-sub">Preview its contents, date range, status, and available actions.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var st = rptStatusOf(r);
  var full = _rptFull[r.id];
  var meta = RPT_TYPE_META[r.type] || RPT_TYPE_META.custom;
  var member = rptCanEdit();

  var actions = '';
  if (st === 'ready' || st === 'archived') {
    actions += '<button class="inv-act-primary" onclick="rptOpenViewer(\'' + r.id + '\')"><i data-lucide="external-link"></i>View Report</button>';
    actions += '<button class="inv-act-ghost" onclick="rptDownloadPdf(\'' + r.id + '\')"><i data-lucide="download"></i>Download PDF</button>';
  } else if (st === 'failed') {
    if (member) actions += '<button class="inv-act-primary" onclick="rptRetry(\'' + r.id + '\')"><i data-lucide="rotate-ccw"></i>Retry Generation</button>';
  }

  var details = [
    ['Date range', rptFmtRange(r.rangeStart, r.rangeEnd)],
    r.comparisonType === 'previous' ? ['Comparison', 'Previous equivalent period'] : null,
    ['Generated by', rptEsc(r.generatedByName || '—')],
    ['Generated', r.generatedAt ? rptFmtTs(r.generatedAt) : '—'],
    ['Detail level', r.detailLevel ? r.detailLevel.charAt(0).toUpperCase() + r.detailLevel.slice(1) : 'Standard'],
    ['Format', st === 'ready' || st === 'archived' ? 'Web · PDF' + (r.legacy ? ' (legacy)' : ' · CSV') : '—'],
    r.lastViewedAt ? ['Last opened', rptFmtTs(r.lastViewedAt)] : null,
  ].filter(Boolean).map(function(row) {
    return '<div class="inv-p-krow"><span>' + row[0] + '</span><span>' + row[1] + '</span></div>';
  }).join('');

  var sectionsHtml = '';
  if ((r.sections || []).length) {
    sectionsHtml = '<div class="inv-p-sec">Included sections</div>' +
      (r.sections || []).map(function(s) {
        return '<div class="rpt-sec-row"><i data-lucide="check" style="width:11px;height:11px;color:var(--green);"></i>' + (RPT_SECTION_LABELS[s] || s) + '</div>';
      }).join('');
  }

  var km = r.keyMetrics;
  var kmHtml = '';
  if (km && st !== 'failed') {
    var prev = full && full.snapshot && full.snapshot.previous;
    function cell(label, val, prevVal) {
      var delta = '';
      if (prev && prevVal != null && typeof val === 'number' && prevVal > 0) {
        var pct = Math.round(((val - prevVal) / prevVal) * 100);
        if (pct !== 0) delta = '<span class="rpt-delta ' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '+' : '') + pct + '%</span>';
      }
      return '<div class="rpt-km-cell"><div class="rpt-km-val">' + val + delta + '</div><div class="rpt-km-label">' + label + '</div></div>';
    }
    kmHtml = '<div class="inv-p-sec">Key results</div><div class="rpt-km-grid">' +
      cell('New leads', km.newLeads != null ? km.newLeads : '—', prev ? prev.newLeads : null) +
      cell('Median response', km.respMedianS != null ? rptFmtDur(km.respMedianS) : '—', null) +
      cell('Qualified leads', km.qualified != null ? km.qualified : '—', prev ? prev.qualified : null) +
      cell('Booked', km.booked != null ? km.booked : '—', prev ? prev.booked : null) +
    '</div>';
  }

  var errHtml = '';
  if (st === 'failed') {
    errHtml = '<div class="rpt-error-box"><i data-lucide="alert-circle"></i><div>' +
      '<div style="font-weight:600;">Generation failed</div>' +
      '<div style="margin-top:2px;">' + rptEsc(r.errorMsg || 'Something went wrong while gathering data.') + '</div></div></div>';
  }

  var timeline = '';
  if (full && (full.events || []).length) {
    timeline = '<div class="inv-p-sec">Activity</div><div class="inv-tl">' +
      full.events.slice(-6).reverse().map(function(ev) {
        var by = ev.by && ev.by !== 'migration' ? ' · ' + rptEsc(ev.by) : '';
        return '<div class="inv-tl-item"><span class="inv-tl-dot"></span><div>' +
          '<div class="inv-tl-label">' + (RPT_EVENT_LABELS[ev.t] || ev.t) + '</div>' +
          '<div class="inv-tl-ts">' + rptFmtTs(ev.ts) + by + '</div></div></div>';
      }).join('') + '</div>';
  }

  panel.innerHTML =
    '<div class="inv-p-head">' +
      '<div style="display:flex;align-items:center;gap:9px;min-width:0;">' +
        '<div class="rpt-doc-ic ' + meta.cls + '"><i data-lucide="file-bar-chart"></i></div>' +
        '<div style="min-width:0;"><div class="inv-p-num" style="font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + rptEsc(r.name) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">' + rptBadge(r) +
        (r.generatedAt ? '<span style="font-size:10.5px;color:var(--text-m);">' + rptFmtTs(r.generatedAt) + '</span>' : '') + '</div></div>' +
      '</div>' +
      '<button class="inv-p-close" onclick="rptClosePanel()" aria-label="Close details"><i data-lucide="x"></i></button>' +
    '</div>' +
    errHtml +
    '<div class="inv-p-actions">' + actions + '</div>' +
    '<div class="inv-p-sec">Details</div>' + details +
    kmHtml + sectionsHtml +
    (full && full.summary ? '<div class="inv-p-sec">Summary preview</div><div class="rpt-sum-preview">' + rptEsc(full.summary).slice(0, 320) + (full.summary.length > 320 ? '…' : '') + '</div>' : '') +
    timeline;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── actions ───────────────────────────────────────────────────────────────────

function rptRename(id) {
  var r = rptById(id);
  if (!r) return;
  if (typeof invModal !== 'function') return;
  invModal('Rename report',
    '<div class="inv-dr-field"><label>Report name</label><input id="rpt-rename-input" type="text" maxlength="120" value="' + rptEsc(r.name) + '" /></div>',
    'Rename',
    async function() {
      var name = ((document.getElementById('rpt-rename-input') || {}).value || '').trim();
      if (!name) { showToast('Enter a name.'); return false; }
      var res = await rptFetch('POST', '/report/update', { id: id, action: 'rename', name: name });
      if (res.status === 200) { rptMergeIdx(res.data.report); showToast('Renamed.'); return true; }
      showToast('Could not rename.');
      return false;
    });
}
window.rptRename = rptRename;

async function rptArchive(id, on) {
  var res = await rptFetch('POST', '/report/update', { id: id, action: on ? 'archive' : 'restore' });
  if (res.status === 200) { rptMergeIdx(res.data.report); showToast(on ? 'Report archived.' : 'Report restored.'); }
  else showToast('Could not update.');
}
window.rptArchive = rptArchive;

function rptDelete(id) {
  var r = rptById(id);
  if (!r || typeof invConfirm !== 'function') return;
  invConfirm('Delete "' + (r.name || 'report') + '"?',
    'The report and its saved snapshot are removed permanently. This cannot be undone.',
    'Delete report', true,
    async function() {
      var res = await rptFetch('DELETE', '/report/' + id);
      if (res.status === 200) {
        _rptList = _rptList.filter(function(x) { return x.id !== id; });
        delete _rptFull[id];
        if (_rptSel === id) _rptSel = null;
        rptRenderAll();
        showToast('Report deleted.');
      } else showToast((res.data && res.data.error) || 'Could not delete.');
    });
}
window.rptDelete = rptDelete;

async function rptRetry(id) {
  var full = await rptLoadFull(id);
  if (!full || !full.config) { showToast('This report has no saved configuration.'); return; }
  showToast('Retrying generation…');
  var res = await rptFetch('POST', '/report/generate', full.config);
  if (res.status === 200 && res.data.report) {
    await rptFetch('DELETE', '/report/' + id);
    _rptList = _rptList.filter(function(x) { return x.id !== id; });
    delete _rptFull[id];
    rptMergeIdx(res.data.report);
    _rptFull[res.data.report.id] = res.data.report;
    _rptSel = res.data.report.id;
    rptRenderAll();
    showToast('Report generated.');
  } else {
    if (res.data && res.data.report) rptMergeIdx(res.data.report);
    showToast('Generation failed again — see the error in the panel.');
  }
}
window.rptRetry = rptRetry;

async function rptDuplicate(id) {
  var full = await rptLoadFull(id);
  if (!full || !full.config) { showToast('This report has no saved configuration.'); return; }
  openReportEditor(full.config);
}
window.rptDuplicate = rptDuplicate;

function rptMergeIdx(rec) {
  var entry = {
    id: rec.id, name: rec.name, type: rec.type, status: rec.status, cfgHash: rec.cfgHash || null,
    rangeStart: rec.rangeStart, rangeEnd: rec.rangeEnd, comparisonType: rec.comparisonType,
    detailLevel: rec.detailLevel, sections: rec.sections, generatedBy: rec.generatedBy,
    generatedByName: rec.generatedByName, createdAt: rec.createdAt, generatedAt: rec.generatedAt,
    lastViewedAt: rec.lastViewedAt, archivedAt: rec.archivedAt, errorMsg: rec.errorMsg,
    legacy: !!rec.legacyHtml, keyMetrics: rec.snapshot ? rec.snapshot.keyMetrics : null,
  };
  var i = _rptList.findIndex(function(x) { return x.id === rec.id; });
  if (i !== -1) _rptList[i] = entry; else _rptList.unshift(entry);
  _rptFull[rec.id] = rec;
  rptRenderAll();
}

// share to team chat (compatibility with teams.js payload shape)
function reportsShareTeam(id) {
  var r = rptById(id || _rptSel);
  if (!r) return;
  if (typeof teamsShareReport === 'function') {
    teamsShareReport({
      id: r.id, title: r.name, type: r.type,
      days: Math.max(1, Math.round((new Date(r.rangeEnd) - new Date(r.rangeStart)) / 86400000) + 1),
      dateStr: rptFmtRange(r.rangeStart, r.rangeEnd),
      createdAt: r.createdAt,
    });
  } else showToast('Open the Team page first to share to chat.');
}
window.reportsShareTeam = reportsShareTeam;

// ── CSV export from snapshot ──────────────────────────────────────────────────

async function rptDownloadCsv(id) {
  var full = await rptLoadFull(id);
  if (!full || !full.snapshot) { showToast('No snapshot data for this report.'); return; }
  var c = full.snapshot.current;
  function esc(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var lines = ['Metric,Value'];
  lines.push('New leads,' + c.newLeads);
  lines.push('Qualified leads,' + c.qualified);
  lines.push('Booked,' + c.booked);
  lines.push('Median response (s),' + (c.respMedianS != null ? c.respMedianS : ''));
  lines.push('Deal value,' + c.dealValue);
  lines.push('');
  lines.push('Source,Leads');
  c.sources.forEach(function(s) { lines.push(esc(s.name) + ',' + s.count); });
  lines.push('');
  lines.push('Date,New leads');
  c.volume.forEach(function(v) { lines.push(v.d + ',' + v.n); });
  lines.push('');
  lines.push('Stage,Deals,Value');
  c.stages.forEach(function(s) { lines.push(esc(s.stage) + ',' + s.count + ',' + s.value); });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (full.name || 'report').replace(/[^\w-]+/g, '-').toLowerCase() + '.csv';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
  rptFetch('POST', '/report/update', { id: id, action: 'downloaded', format: 'csv' });
  showToast('CSV downloaded.');
}
window.rptDownloadCsv = rptDownloadCsv;

// ── report viewer + document renderer ─────────────────────────────────────────
// One renderer serves web viewer, print PDF, and (later) the public page.
// It consumes ONLY the saved snapshot — never live dashboard data.

var _rptViewing = null;

async function rptOpenViewer(id) {
  var host = document.getElementById('rpt-print-view');
  if (!host) return;
  _rptViewing = id;
  document.getElementById('rpt-pv-content').innerHTML =
    '<div class="empty-state" style="padding:80px 20px;"><div class="skel" style="width:120px;height:16px;margin:0 auto 10px;"></div><div class="empty-state-sub">Loading report…</div></div>';
  host.classList.add('open');
  try { history.replaceState(null, '', location.pathname + location.search + '#reports/' + id); } catch (e) {}
  var full = await rptLoadFull(id);
  if (_rptViewing !== id) return;
  var content = document.getElementById('rpt-pv-content');
  var bar = document.getElementById('rpt-pv-title');
  if (!full) {
    content.innerHTML = '<div class="empty-state" style="padding:80px 20px;"><i data-lucide="file-x"></i><div class="empty-state-title">Report not found</div><div class="empty-state-sub">It may have been deleted, or you may not have access.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  if (bar) bar.textContent = full.name || 'Report';
  content.innerHTML = rptRenderDoc(full);
  rptRenderViewerNav(full);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.rptOpenViewer = rptOpenViewer;

function reportsClosePrint() {
  var host = document.getElementById('rpt-print-view');
  if (host) host.classList.remove('open');
  _rptViewing = null;
  document.body.classList.remove('printing-report');
  try { history.replaceState(null, '', location.pathname + location.search + '#reports'); } catch (e) {}
}
window.reportsClosePrint = reportsClosePrint;

function reportsPrintNow() {
  document.body.classList.add('printing-report');
  window.print();
  setTimeout(function() { document.body.classList.remove('printing-report'); }, 400);
  if (_rptViewing) rptFetch('POST', '/report/update', { id: _rptViewing, action: 'downloaded', format: 'pdf' });
}
window.reportsPrintNow = reportsPrintNow;

async function rptDownloadPdf(id) {
  await rptOpenViewer(id);
  setTimeout(reportsPrintNow, 350);
}
window.rptDownloadPdf = rptDownloadPdf;

function rptViewerNavGo(key) {
  var el = document.getElementById('rpd-sec-' + key);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.rptViewerNavGo = rptViewerNavGo;

function rptRenderViewerNav(full) {
  var nav = document.getElementById('rpt-pv-nav');
  if (!nav) return;
  if (full.legacyHtml || !(full.sections || []).length) { nav.innerHTML = ''; nav.style.display = 'none'; return; }
  nav.style.display = '';
  var navLabels = {
    summary: 'Summary', kpis: 'Key Metrics', volume: 'Lead Volume', sources: 'Sources',
    response: 'Response', status: 'Qualification', pipeline: 'Pipeline', followups: 'Follow-Ups',
    financial: 'Financial', recommendations: 'Recommendations', appendix: 'Appendix',
  };
  nav.innerHTML = '<div class="rpt-nav-h">Sections</div>' + full.sections.map(function(s) {
    return '<div class="rpt-nav-item" onclick="rptViewerNavGo(\'' + s + '\')">' + (navLabels[s] || s) + '</div>';
  }).join('');
}

function rptRenderDoc(full) {
  if (full.legacyHtml) return '<div class="rpd">' + full.legacyHtml + '</div>';
  var snap = full.snapshot;
  if (!snap) return '<div class="empty-state" style="padding:60px;"><div class="empty-state-title">No snapshot available</div></div>';
  var c = snap.current, p = snap.previous;
  var cfg = full.config || {};
  var has = function(sec) { return (full.sections || []).indexOf(sec) !== -1; };
  var exec = full.detailLevel === 'executive';
  var detailed = full.detailLevel === 'detailed';
  var secN = 0;
  function secHead(title) {
    secN++;
    return '<h2><span class="rpd-secno">' + String(secN).padStart(2, '0') + '</span>' + title + '</h2>';
  }
  var h = '<div class="rpd">';

  // ── cover ──
  h += '<div class="rpd-cover" id="rpd-sec-cover">' +
    '<div class="rpd-brand-row"><span class="rpd-brand-mark">F</span><span class="rpd-brand-word">Flowaify</span></div>' +
    '<div class="rpd-cover-kicker">Performance Report</div>' +
    '<h1>' + rptEsc(full.name) + '</h1>' +
    (cfg.preparedFor ? '<div class="rpd-cover-for">Prepared for ' + rptEsc(cfg.preparedFor) + '</div>' : '') +
    '<div class="rpd-cover-grid">' +
      '<div><span>Reporting period</span><strong>' + rptFmtRange(full.rangeStart, full.rangeEnd) + '</strong></div>' +
      (p ? '<div><span>Compared with</span><strong>' + rptFmtRange(p.rangeStart, p.rangeEnd) + '</strong></div>' : '') +
      '<div><span>Generated</span><strong>' + rptFmtTs(full.generatedAt) + '</strong></div>' +
      (cfg.preparedBy ? '<div><span>Prepared by</span><strong>' + rptEsc(cfg.preparedBy) + '</strong></div>' : '') +
    '</div>' +
    (cfg.note ? '<div class="rpd-cover-note">' + rptEsc(cfg.note) + '</div>' : '') +
    (cfg.confidential ? '<div class="rpd-conf">Confidential — prepared for the recipient\'s internal business use only.</div>' : '') +
  '</div>';

  // ── executive summary ──
  if (has('summary') && full.summary) {
    h += '<div class="rpd-sec" id="rpd-sec-summary">' + secHead('Executive Summary') +
      '<p class="rpd-lead">' + rptEsc(full.summary) + '</p>' +
      (full.narrativeSource === 'ai' ? '<div class="rpd-ai-note">Summary written by Flowy AI from the saved report data.</div>' : '') +
    '</div>';
  }

  function delta(cur, prev) {
    if (!p || prev == null || cur == null) return '';
    if (prev === 0) return '<span class="rpd-delta-na">previous period: 0</span>';
    var pct = Math.round(((cur - prev) / prev) * 100);
    return '<span class="rpd-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '▲ +' : '▼ ') + pct + '% vs ' + prev + '</span>';
  }

  // ── KPIs ──
  if (has('kpis')) {
    h += '<div class="rpd-sec" id="rpd-sec-kpis">' + secHead('Key Performance Indicators') + '<div class="rpd-kpis">';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + c.newLeads + '</div><div class="rpd-kpi-l">New leads</div>' + (delta(c.newLeads, p && p.newLeads) ? '<div class="rpd-kpi-d">' + delta(c.newLeads, p && p.newLeads) + '</div>' : '') + '</div>';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + c.qualified + '</div><div class="rpd-kpi-l">Qualified leads</div>' + (delta(c.qualified, p && p.qualified) ? '<div class="rpd-kpi-d">' + delta(c.qualified, p && p.qualified) + '</div>' : '') + '</div>';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + (c.respMedianS != null ? rptFmtDur(c.respMedianS) : '—') + '</div><div class="rpd-kpi-l">Median response time</div>' + (p && p.respMedianS != null && c.respMedianS != null ? '<div class="rpd-kpi-d"><span class="rpd-delta-na">prev. ' + rptFmtDur(p.respMedianS) + '</span></div>' : '') + '</div>';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + c.booked + '</div><div class="rpd-kpi-l">Booked / engaged</div>' + (delta(c.booked, p && p.booked) ? '<div class="rpd-kpi-d">' + delta(c.booked, p && p.booked) + '</div>' : '') + '</div>';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + c.touched + '</div><div class="rpd-kpi-l">Leads contacted</div></div>';
    h += '<div class="rpd-kpi"><div class="rpd-kpi-v">' + rptMoney(c.dealValue) + '</div><div class="rpd-kpi-l">New deal value</div></div>';
    h += '</div>';
    if (snap.lowSample) h += '<div class="rpd-note">Small sample: fewer than 5 leads in this period — treat percentage comparisons with caution.</div>';
    h += '</div>';
  }

  // ── lead volume ──
  if (has('volume') && c.volume && c.volume.length) {
    var max = Math.max.apply(null, c.volume.map(function(v) { return v.n; }).concat([1]));
    var bars = c.volume.map(function(v) {
      var hpx = Math.round((v.n / max) * 88);
      return '<div class="rpd-vbar-w" title="' + v.d + ': ' + v.n + '"><div class="rpd-vbar" style="height:' + Math.max(hpx, v.n ? 3 : 1) + 'px;"></div></div>';
    }).join('');
    h += '<div class="rpd-sec" id="rpd-sec-volume">' + secHead('Lead Volume') +
      '<div class="rpd-body">' + c.newLeads + ' new lead' + (c.newLeads === 1 ? '' : 's') + ' were received across ' + c.volume.length + ' days. Peak day: ' +
        (function() { var pk = c.volume.reduce(function(a, b) { return b.n > a.n ? b : a; }); return rptFmtDate(pk.d) + ' (' + pk.n + ')'; })() + '.</div>' +
      '<div class="rpd-vchart-wrap"><div class="rpd-vaxis">' + max + '</div>' +
      '<div class="rpd-vchart" role="img" aria-label="Daily new leads bar chart">' + bars + '</div></div>' +
      '<div class="rpd-vchart-lbl"><span>' + rptFmtDate(c.volume[0].d) + '</span><span>' + rptFmtDate(c.volume[c.volume.length - 1].d) + '</span></div></div>';
  }

  // ── sources ──
  if (has('sources') && c.sources && c.sources.length) {
    var smax = c.sources[0].count || 1;
    h += '<div class="rpd-sec" id="rpd-sec-sources">' + secHead('Lead Sources') + c.sources.slice(0, 8).map(function(src) {
      var pct = c.newLeads ? Math.round(src.count / c.newLeads * 100) : 0;
      return '<div class="rpd-src-row"><span class="rpd-src-name">' + rptEsc(src.name) + '</span>' +
        '<span class="rpd-src-bar"><span style="width:' + Math.round(src.count / smax * 100) + '%;"></span></span>' +
        '<span class="rpd-src-n">' + src.count + '<em>' + pct + '%</em></span></div>';
    }).join('') + '</div>';
  }

  // ── response ──
  if (has('response')) {
    h += '<div class="rpd-sec" id="rpd-sec-response">' + secHead('Response Performance');
    if (c.respSample > 0) {
      h += '<table class="rpd-table"><thead><tr><th>Metric</th><th class="rpd-num">Value</th></tr></thead><tbody>' +
        '<tr><td>Median first response</td><td class="rpd-num">' + rptFmtDur(c.respMedianS) + '</td></tr>' +
        '<tr><td>Average first response</td><td class="rpd-num">' + rptFmtDur(c.respAvgS) + '</td></tr>' +
        '<tr><td>Responded within 5 minutes</td><td class="rpd-num">' + c.respUnder5mPct + '%</td></tr>' +
        '<tr><td>Leads with a first response</td><td class="rpd-num">' + c.respSample + ' of ' + c.newLeads + '</td></tr>' +
        '</tbody></table>' +
        (detailed ? '<div class="rpd-note">Median is reported alongside average because a few unusually delayed responses can distort the average.</div>' : '');
    } else {
      h += '<div class="rpd-body">No first-response data was recorded for leads in this period.</div>';
    }
    h += '</div>';
  }

  // ── qualification ──
  if (has('status') && !exec) {
    var stKeys = Object.keys(c.statuses || {});
    if (stKeys.length) {
      h += '<div class="rpd-sec" id="rpd-sec-status">' + secHead('Lead Qualification') +
        '<table class="rpd-table"><thead><tr><th>Classification</th><th class="rpd-num">Leads</th><th class="rpd-num">Share</th></tr></thead><tbody>' +
        stKeys.sort(function(a, b) { return c.statuses[b] - c.statuses[a]; }).map(function(k) {
          var pct = c.newLeads ? Math.round(c.statuses[k] / c.newLeads * 100) : 0;
          return '<tr><td>' + rptEsc(k) + '</td><td class="rpd-num">' + c.statuses[k] + '</td><td class="rpd-num">' + pct + '%</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  }

  // ── pipeline ──
  if (has('pipeline') && c.stages && c.stages.length) {
    h += '<div class="rpd-sec" id="rpd-sec-pipeline">' + secHead('Pipeline') +
      '<table class="rpd-table"><thead><tr><th>Stage</th><th class="rpd-num">Deals</th><th class="rpd-num">Value</th></tr></thead><tbody>' +
      c.stages.map(function(sg) {
        return '<tr><td>' + rptEsc(sg.stage) + '</td><td class="rpd-num">' + sg.count + '</td><td class="rpd-num">' + rptMoney(sg.value) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="rpd-body" style="margin-top:10px;">' + c.dealsCreated + ' deal' + (c.dealsCreated === 1 ? '' : 's') + ' created in this period' +
      (c.won ? ', ' + c.won + ' marked won' : '') + '.</div></div>';
  }

  // ── follow-ups ──
  if (has('followups')) {
    var untouched = Math.max(0, c.newLeads - c.touched);
    h += '<div class="rpd-sec" id="rpd-sec-followups">' + secHead('Follow-Up Activity') +
      '<table class="rpd-table"><thead><tr><th>Metric</th><th class="rpd-num">Value</th></tr></thead><tbody>' +
      '<tr><td>Leads contacted at least once</td><td class="rpd-num">' + c.touched + '</td></tr>' +
      '<tr><td>Leads not yet contacted</td><td class="rpd-num">' + untouched + '</td></tr>' +
      '<tr><td>Booked or engaged</td><td class="rpd-num">' + c.booked + '</td></tr>' +
      '</tbody></table></div>';
  }

  // ── financial ──
  if (has('financial') && snap.financial) {
    var f = snap.financial;
    function m(cents) { return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }); }
    h += '<div class="rpd-sec" id="rpd-sec-financial">' + secHead('Financial Activity') +
      '<table class="rpd-table"><thead><tr><th>Metric</th><th class="rpd-num">Value</th></tr></thead><tbody>' +
      '<tr><td>Invoiced this period</td><td class="rpd-num">' + m(f.invoicedC) + ' (' + f.invoicedN + ' invoice' + (f.invoicedN === 1 ? '' : 's') + ')</td></tr>' +
      '<tr><td>Collected this period</td><td class="rpd-num">' + m(f.collectedC) + '</td></tr>' +
      '<tr><td>Outstanding balance</td><td class="rpd-num">' + m(f.outstandingC) + '</td></tr>' +
      '<tr><td>Of which overdue</td><td class="rpd-num">' + m(f.overdueC) + '</td></tr>' +
      '</tbody></table></div>';
  }

  // ── recommendations ──
  if (has('recommendations') && (full.recommendations || []).length) {
    h += '<div class="rpd-sec" id="rpd-sec-recommendations">' + secHead('Recommendations') +
      full.recommendations.map(function(r, i) {
        return '<div class="rpd-rec"><span class="rpd-rec-n">' + (i + 1) + '</span><span>' + rptEsc(r) + '</span></div>';
      }).join('') +
      '<div class="rpd-ai-note">Recommendations are analysis based on the report data — not measured facts or guaranteed outcomes.</div></div>';
  }

  // ── appendix ──
  if (has('appendix')) {
    h += '<div class="rpd-sec" id="rpd-sec-appendix">' + secHead('Appendix') +
      '<table class="rpd-table rpd-appendix"><tbody>' +
      '<tr><td>Reporting period</td><td>' + full.rangeStart + ' to ' + full.rangeEnd + ' (inclusive)</td></tr>' +
      (p ? '<tr><td>Comparison period</td><td>' + p.rangeStart + ' to ' + p.rangeEnd + '</td></tr>' : '') +
      '<tr><td>Timezone</td><td>' + rptEsc(full.timezone || '—') + '</td></tr>' +
      '<tr><td>Data source</td><td>CRM contacts and deals' + (has('financial') ? ', Flowaify invoices' : '') + '</td></tr>' +
      '<tr><td>Generated</td><td>' + rptFmtTs(full.generatedAt) + '</td></tr>' +
      '<tr><td>Report reference</td><td>' + rptEsc(full.id) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="rpd-note">Metrics reflect data available at generation time. "Qualified" counts leads classified high or medium priority; "booked / engaged" counts leads whose status reached booked or engaged during the period. Response times measure lead creation to first recorded touch.</div>' +
    '</div>';
  }

  h += '<div class="rpd-footer"><span>' + rptEsc(full.name) + (cfg.confidential ? ' · Confidential' : '') + '</span><span class="rpd-footer-brand">Flowaify · ' + rptFmtDate(full.rangeEnd) + '</span></div>';
  h += '</div>';
  return h;
}

// ── New Report stepped flow ───────────────────────────────────────────────────

var RPT_TYPE_DEFAULTS = {
  full:      ['summary', 'kpis', 'volume', 'sources', 'response', 'status', 'pipeline', 'followups', 'recommendations', 'appendix'],
  executive: ['summary', 'kpis', 'sources', 'recommendations', 'appendix'],
  leads:     ['summary', 'kpis', 'volume', 'sources', 'response', 'status', 'recommendations', 'appendix'],
  pipeline:  ['summary', 'kpis', 'pipeline', 'followups', 'recommendations', 'appendix'],
  custom:    ['summary', 'kpis', 'appendix'],
};
var RPT_TYPE_CARDS = [
  { t: 'full', icon: 'file-bar-chart', name: 'Full Performance Report', desc: 'Leads, response, sources, pipeline, follow-ups, and recommendations.' },
  { t: 'executive', icon: 'briefcase', name: 'Executive Summary', desc: 'A short leadership report: main results, changes, and next actions.' },
  { t: 'leads', icon: 'users', name: 'Lead Performance', desc: 'Volume, sources, qualification, response time, and conversion.' },
  { t: 'pipeline', icon: 'layers', name: 'Pipeline Report', desc: 'Deals by stage, movement, and booked or won outcomes.' },
  { t: 'custom', icon: 'sliders-horizontal', name: 'Custom Report', desc: 'Choose exactly which sections to include.' },
];

function openReportEditor(prefill) {
  if (!rptCanEdit()) { showToast('Only members can generate reports.'); return; }
  var today = new Date();
  function iso(d) { return d.toISOString().slice(0, 10); }
  if (!prefill && _rptFlowDraft) {
    _rptFlow = _rptFlowDraft;
    _rptFlowDraft = null;
    rptFlowRender();
    var hostR = document.getElementById('rpt-flow');
    if (hostR) hostR.classList.add('open');
    return;
  }
  _rptFlow = prefill && prefill.type ? {
    step: 1, type: prefill.type, rangeKey: 'custom',
    rangeStart: prefill.rangeStart, rangeEnd: prefill.rangeEnd,
    comparison: prefill.comparisonType || 'none',
    sections: (prefill.sections || RPT_TYPE_DEFAULTS[prefill.type]).slice(),
    detailLevel: prefill.detailLevel || 'standard',
    name: '', preparedFor: prefill.preparedFor || '', preparedBy: prefill.preparedBy || '',
    note: prefill.note || '', confidential: !!prefill.confidential, includeAI: prefill.includeAI !== false,
  } : {
    step: 1, type: 'full', rangeKey: '30',
    rangeStart: iso(new Date(Date.now() - 29 * 86400000)), rangeEnd: iso(today),
    comparison: 'previous',
    sections: RPT_TYPE_DEFAULTS.full.slice(),
    detailLevel: 'standard',
    name: '', preparedFor: '', preparedBy: '', note: '', confidential: false, includeAI: true,
  };
  rptFlowRender();
  var host = document.getElementById('rpt-flow');
  if (host) host.classList.add('open');
}
window.openReportEditor = openReportEditor;

var _rptFlowDraft = null;

function rptFlowHarvest() {
  if (!_rptFlow) return;
  ['rangeStart', 'rangeEnd'].forEach(function(k) {
    var el = document.getElementById('rf-' + k);
    if (el && el.value) _rptFlow[k] = el.value;
  });
  ['name', 'preparedFor', 'preparedBy', 'note'].forEach(function(k) {
    var el = document.getElementById('rf-' + k);
    if (el) _rptFlow[k] = el.value;
  });
}

/* Closing keeps the draft — reopening New Report resumes where you left off. */
function rptFlowClose() {
  rptFlowHarvest();
  if (_rptFlow) _rptFlowDraft = _rptFlow;
  var host = document.getElementById('rpt-flow');
  if (host) host.classList.remove('open');
  _rptFlow = null;
  if (_rptFlowDraft && typeof showToast === 'function') showToast('Draft kept — reopen New Report to continue.');
}
window.rptFlowClose = rptFlowClose;

function rptFlowReset() {
  _rptFlowDraft = null;
  _rptFlow = null;
  openReportEditor();
  if (typeof showToast === 'function') showToast('Started a fresh report.');
}
window.rptFlowReset = rptFlowReset;

function rptFlowSet(k, v) {
  if (!_rptFlow) return;
  _rptFlow[k] = v;
  if (k === 'type') _rptFlow.sections = RPT_TYPE_DEFAULTS[v].slice();
  rptFlowRender();
}
window.rptFlowSet = rptFlowSet;

function rptFlowRange(key) {
  if (!_rptFlow) return;
  var now = new Date();
  function iso(d) { return d.toISOString().slice(0, 10); }
  _rptFlow.rangeKey = key;
  if (key === 'custom') { rptFlowRender(); return; }
  if (key === 'tm') {
    _rptFlow.rangeStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
    _rptFlow.rangeEnd = iso(now);
  } else if (key === 'pm') {
    _rptFlow.rangeStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12));
    _rptFlow.rangeEnd = iso(new Date(now.getFullYear(), now.getMonth(), 0, 12));
  } else if (key === 'tq') {
    var q = Math.floor(now.getMonth() / 3) * 3;
    _rptFlow.rangeStart = iso(new Date(now.getFullYear(), q, 1, 12));
    _rptFlow.rangeEnd = iso(now);
  } else if (key === 'pq') {
    var q2 = Math.floor(now.getMonth() / 3) * 3;
    _rptFlow.rangeStart = iso(new Date(now.getFullYear(), q2 - 3, 1, 12));
    _rptFlow.rangeEnd = iso(new Date(now.getFullYear(), q2, 0, 12));
  } else {
    var days = parseInt(key, 10) || 30;
    _rptFlow.rangeStart = iso(new Date(Date.now() - (days - 1) * 86400000));
    _rptFlow.rangeEnd = iso(now);
  }
  rptFlowRender();
}
window.rptFlowRange = rptFlowRange;

function rptFlowToggleSection(s) {
  if (!_rptFlow) return;
  var i = _rptFlow.sections.indexOf(s);
  if (i === -1) _rptFlow.sections.push(s); else _rptFlow.sections.splice(i, 1);
  rptFlowRender();
}
window.rptFlowToggleSection = rptFlowToggleSection;

function rptFlowStep(dir) {
  if (!_rptFlow) return;
  rptFlowHarvest();
  var next = _rptFlow.step + dir;
  if (next === 3 && _rptFlow.rangeEnd < _rptFlow.rangeStart) { showToast('End date must be after the start date.'); return; }
  if (next === 4 && !_rptFlow.sections.length) { showToast('Select at least one section.'); return; }
  _rptFlow.step = Math.max(1, Math.min(5, next));
  rptFlowRender();
}
window.rptFlowStep = rptFlowStep;

function rptFlowRender() {
  var host = document.getElementById('rpt-flow-body');
  if (!host || !_rptFlow) return;
  var f = _rptFlow;
  var stepsBar = '<div class="rf-steps">' + ['Type', 'Dates', 'Sections', 'Options', 'Review'].map(function(l, i) {
    var n = i + 1;
    return '<div class="rf-step' + (n === f.step ? ' cur' : n < f.step ? ' done' : '') + '"><span>' + n + '</span>' + l + '</div>';
  }).join('') + '</div>';
  var body = '';

  if (f.step === 1) {
    body = '<div class="rf-cards">' + RPT_TYPE_CARDS.map(function(c) {
      return '<div class="rf-card' + (f.type === c.t ? ' sel' : '') + '" onclick="rptFlowSet(\'type\',\'' + c.t + '\')" role="button" tabindex="0">' +
        '<i data-lucide="' + c.icon + '"></i><div><div class="rf-card-name">' + c.name + '</div>' +
        '<div class="rf-card-desc">' + c.desc + '</div></div></div>';
    }).join('') + '</div>';
  } else if (f.step === 2) {
    var ranges = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['tm', 'This month'], ['pm', 'Previous month'], ['tq', 'This quarter'], ['pq', 'Previous quarter'], ['custom', 'Custom']];
    body = '<div class="rf-label">Data date range</div><div class="rf-chips">' + ranges.map(function(r) {
      return '<button class="rf-chip' + (f.rangeKey === r[0] ? ' sel' : '') + '" onclick="rptFlowRange(\'' + r[0] + '\')">' + r[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="inv-dr-row" style="margin-top:12px;">' +
      '<div class="inv-dr-field"><label>Start date</label><input id="rf-rangeStart" type="date" value="' + f.rangeStart + '" ' + (f.rangeKey !== 'custom' ? 'disabled' : '') + ' /></div>' +
      '<div class="inv-dr-field"><label>End date</label><input id="rf-rangeEnd" type="date" value="' + f.rangeEnd + '" ' + (f.rangeKey !== 'custom' ? 'disabled' : '') + ' /></div>' +
    '</div>' +
    '<div class="rf-label" style="margin-top:16px;">Comparison</div><div class="rf-chips">' +
      '<button class="rf-chip' + (f.comparison === 'previous' ? ' sel' : '') + '" onclick="rptFlowSet(\'comparison\',\'previous\')">Previous equivalent period</button>' +
      '<button class="rf-chip' + (f.comparison === 'none' ? ' sel' : '') + '" onclick="rptFlowSet(\'comparison\',\'none\')">No comparison</button>' +
    '</div>';
  } else if (f.step === 3) {
    var all = ['summary', 'kpis', 'volume', 'sources', 'response', 'status', 'pipeline', 'followups', 'financial', 'recommendations', 'appendix'];
    body = '<div class="rf-label">Sections to include</div>' + all.map(function(s) {
      var on = f.sections.indexOf(s) !== -1;
      var note = s === 'financial' ? ' <span style="color:var(--text-m);font-weight:400;">— from your Flowaify invoices</span>' : '';
      return '<label class="rf-check"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="rptFlowToggleSection(\'' + s + '\')" />' +
        '<span>' + (RPT_SECTION_LABELS[s] || s) + note + '</span></label>';
    }).join('');
  } else if (f.step === 4) {
    body = '<div class="rf-label">Detail level</div><div class="rf-chips">' +
      ['executive', 'standard', 'detailed'].map(function(d) {
        var names = { executive: 'Executive', standard: 'Standard', detailed: 'Detailed' };
        return '<button class="rf-chip' + (f.detailLevel === d ? ' sel' : '') + '" onclick="rptFlowSet(\'detailLevel\',\'' + d + '\')">' + names[d] + '</button>';
      }).join('') + '</div>' +
    '<div class="inv-dr-field" style="margin-top:14px;"><label>Report name (optional)</label><input id="rf-name" type="text" maxlength="120" placeholder="e.g. July Monthly Performance Report" value="' + rptEsc(f.name) + '" /></div>' +
    '<div class="inv-dr-row" style="margin-top:10px;">' +
      '<div class="inv-dr-field"><label>Prepared for (optional)</label><input id="rf-preparedFor" type="text" maxlength="120" placeholder="Client or business name" value="' + rptEsc(f.preparedFor) + '" /></div>' +
      '<div class="inv-dr-field"><label>Prepared by (optional)</label><input id="rf-preparedBy" type="text" maxlength="120" value="' + rptEsc(f.preparedBy) + '" /></div>' +
    '</div>' +
    '<div class="inv-dr-field" style="margin-top:10px;"><label>Introductory note (optional)</label><textarea id="rf-note" maxlength="600" placeholder="Shown on the report cover…">' + rptEsc(f.note) + '</textarea></div>' +
    '<label class="rf-check" style="margin-top:12px;"><input type="checkbox" ' + (f.includeAI ? 'checked' : '') + ' onchange="rptFlowSet(\'includeAI\',this.checked)" /><span>Flowy AI writes the executive summary and recommendations</span></label>' +
    '<label class="rf-check"><input type="checkbox" ' + (f.confidential ? 'checked' : '') + ' onchange="rptFlowSet(\'confidential\',this.checked)" /><span>Include confidentiality statement</span></label>';
  } else {
    var typeName = (RPT_TYPE_CARDS.find(function(c) { return c.t === f.type; }) || {}).name || f.type;
    body = '<div class="rf-label">Review configuration</div>' +
      '<div class="rf-review">' +
      '<div><span>Report type</span><span>' + typeName + '</span></div>' +
      '<div><span>Date range</span><span>' + rptFmtRange(f.rangeStart, f.rangeEnd) + '</span></div>' +
      '<div><span>Comparison</span><span>' + (f.comparison === 'previous' ? 'Previous equivalent period' : 'None') + '</span></div>' +
      '<div><span>Sections</span><span>' + f.sections.length + ' selected</span></div>' +
      '<div><span>Detail level</span><span>' + f.detailLevel.charAt(0).toUpperCase() + f.detailLevel.slice(1) + '</span></div>' +
      '<div><span>AI narrative</span><span>' + (f.includeAI ? 'Flowy AI' : 'Rule-based') + '</span></div>' +
      (f.preparedFor ? '<div><span>Prepared for</span><span>' + rptEsc(f.preparedFor) + '</span></div>' : '') +
      '</div>' +
      '<div class="rpd-note" style="margin-top:12px;">Generation takes a few seconds — the report saves to your workspace and opens when ready.</div>';
  }

  var foot = '<div class="rf-foot">' +
    (f.step > 1 ? '<button class="btn-mini btn-mini-ghost" onclick="rptFlowStep(-1)">Back</button>' : '<span></span>') +
    (f.step < 5
      ? '<button class="btn-mini btn-mini-primary" onclick="rptFlowStep(1)">Continue</button>'
      : '<button class="btn-mini btn-mini-primary" id="rf-generate" onclick="rptFlowGenerate()"><i data-lucide="sparkles" style="width:12px;height:12px;"></i>Generate Report</button>') +
  '</div>';

  host.innerHTML = stepsBar + '<div class="rf-body">' + body + '</div>' + foot;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function rptFlowGenerate() {
  if (!_rptFlow) return;
  var f = _rptFlow;
  var btn = document.getElementById('rf-generate');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  var res = await rptFetch('POST', '/report/generate', {
    type: f.type, name: f.name, rangeStart: f.rangeStart, rangeEnd: f.rangeEnd,
    comparisonType: f.comparison, sections: f.sections, detailLevel: f.detailLevel,
    preparedFor: f.preparedFor, preparedBy: f.preparedBy, note: f.note,
    confidential: f.confidential, includeAI: f.includeAI,
  });
  if (res.status === 200 && res.data && res.data.report) {
    _rptFlow = null; _rptFlowDraft = null;
    var hostG = document.getElementById('rpt-flow');
    if (hostG) hostG.classList.remove('open');
    rptMergeIdx(res.data.report);
    _rptSel = res.data.report.id;
    rptRenderAll();
    showToast(res.data.duplicate ? 'An identical report was just generated — opening it.' : 'Report generated.');
    rptOpenViewer(res.data.report.id);
  } else if (res.data && res.data.report) {
    rptFlowClose();
    rptMergeIdx(res.data.report);
    _rptSel = res.data.report.id;
    rptRenderAll();
    showToast('Generation failed — see the error in the details panel.');
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Report'; }
    showToast((res.data && (res.data.message || res.data.error)) || 'Could not generate the report.');
  }
}
window.rptFlowGenerate = rptFlowGenerate;
