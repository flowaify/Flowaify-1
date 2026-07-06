// reports.js — Report list management (localStorage persistence)

var _rptList = [];
var _rptCurrentId = null;
var _rptSub = '';

// ─── init ─────────────────────────────────────────────────────────────────────

function reportsInit() {
  _rptSub = window.__userSub || 'anon';
  reportsLoadAll();
  renderReportKPIs(_rptList);
  renderReportList(_rptList);
  var dp = document.getElementById('rpt-detail-panel');
  if (dp) { dp.innerHTML = rptDetailEmpty(); if (typeof lucide !== 'undefined') lucide.createIcons(); }
}
window.reportsInit = reportsInit;

// ─── storage ──────────────────────────────────────────────────────────────────

function reportsLoadAll() {
  if (!_rptSub) _rptSub = window.__userSub || 'anon';
  try { _rptList = JSON.parse(localStorage.getItem('flw_reports_' + _rptSub) || '[]'); }
  catch(e) { _rptList = []; }
}

function _rptPersist() {
  try { localStorage.setItem('flw_reports_' + _rptSub, JSON.stringify(_rptList.slice(0, 50))); }
  catch(e) {}
}

function reportsSave(rpt) {
  if (!_rptSub) _rptSub = window.__userSub || 'anon';
  reportsLoadAll();
  var idx = _rptList.findIndex(function(r) { return r.id === rpt.id; });
  if (idx !== -1) _rptList[idx] = rpt;
  else _rptList.unshift(rpt);
  _rptList = _rptList.slice(0, 50);
  _rptPersist();
  renderReportKPIs(_rptList);
  renderReportList(_rptList);
  setTimeout(function() { reportsSelect(rpt.id); }, 60);
}
window.reportsSave = reportsSave;

// ─── KPIs ─────────────────────────────────────────────────────────────────────

function renderReportKPIs(list) {
  var el;
  el = document.getElementById('rpt-kpi-total');
  if (el) el.textContent = list.length || '0';
  el = document.getElementById('rpt-kpi-last');
  if (el) {
    if (list.length) {
      el.textContent = new Date(list[0].createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else { el.textContent = '—'; }
  }
  var types = {};
  list.forEach(function(r) { var t = r.type || 'full'; types[t] = (types[t] || 0) + 1; });
  var best = Object.keys(types).sort(function(a, b) { return types[b] - types[a]; })[0];
  var typeLabels = { full: 'Full', leads: 'Lead', pipeline: 'Pipeline', automations: 'Automation' };
  el = document.getElementById('rpt-kpi-type');
  if (el) el.textContent = best ? (typeLabels[best] || best) : '—';
}

// ─── list ─────────────────────────────────────────────────────────────────────

function renderReportList(list) {
  var q = ((document.getElementById('rpt-search') || {}).value || '').toLowerCase().trim();
  var shown = q ? list.filter(function(r) {
    return (r.title || '').toLowerCase().indexOf(q) !== -1 || (r.reportFor || '').toLowerCase().indexOf(q) !== -1;
  }) : list;
  var tbody = document.getElementById('rpt-tbody');
  if (!tbody) return;
  if (!shown.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="table-empty-overlay"><i data-lucide="bar-chart-2"></i>' +
      '<div class="empty-state-title">No reports yet</div>' +
      '<div class="empty-state-sub">Click <strong>New Report</strong> to generate your first report.</div>' +
      '</div></td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var typeLabels = { full: 'Full Report', leads: 'Lead Summary', pipeline: 'Pipeline', automations: 'Automation' };
  tbody.innerHTML = shown.map(function(r) {
    var sel = r.id === _rptCurrentId ? ' row-selected' : '';
    var date = r.createdAt ? new Date(r.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : (r.dateStr || '—');
    return '<tr class="' + sel + '" onclick="reportsSelect(\'' + rptEsc(r.id) + '\')" style="cursor:pointer;">' +
      '<td style="font-size:12.5px;font-weight:600;color:var(--text);">' + rptEsc(r.title || 'Report') +
        (r.reportFor ? '<div style="font-size:10.5px;color:var(--text-m);font-weight:400;margin-top:1px;">' + rptEsc(r.reportFor) + '</div>' : '') + '</td>' +
      '<td style="font-size:12px;color:var(--text-s);">' + rptEsc(typeLabels[r.type] || r.type || 'Full Report') + '</td>' +
      '<td style="font-size:12px;color:var(--text-m);white-space:nowrap;">Last ' + (r.days || 30) + 'd</td>' +
      '<td style="font-size:11.5px;color:var(--text-m);white-space:nowrap;">' + date + '</td>' +
    '</tr>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderReportList = renderReportList;

function rptFilterList() { renderReportList(_rptList); }
window.rptFilterList = rptFilterList;

// ─── detail panel ─────────────────────────────────────────────────────────────

function reportsSelect(id) {
  _rptCurrentId = id;
  renderReportList(_rptList);
  var rpt = _rptList.find(function(r) { return r.id === id; });
  var dp = document.getElementById('rpt-detail-panel');
  if (!dp || !rpt) return;
  var date = rpt.createdAt ? new Date(rpt.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : (rpt.dateStr || '—');
  dp.innerHTML =
    '<div class="rpt-det-head">' +
      '<div class="rpt-det-info">' +
        '<div class="rpt-det-title">' + rptEsc(rpt.title || 'Report') + '</div>' +
        '<div class="rpt-det-meta">' +
          (rpt.reportFor ? rptEsc(rpt.reportFor) + ' &nbsp;·&nbsp; ' : '') +
          'Last ' + (rpt.days || 30) + ' days &nbsp;·&nbsp; ' + date +
        '</div>' +
      '</div>' +
      '<div class="rpt-det-acts">' +
        '<button class="btn-mini btn-mini-ghost" onclick="reportsShareTeam(\'' + rptEsc(id) + '\')"><i data-lucide="message-square"></i>Team</button>' +
        '<button class="btn-mini btn-mini-ghost" onclick="reportsDoPrint(\'' + rptEsc(id) + '\')"><i data-lucide="printer"></i>Print</button>' +
        '<button class="btn-mini btn-mini-ghost inv-del-btn" onclick="reportsDelete(\'' + rptEsc(id) + '\')" title="Delete"><i data-lucide="trash-2"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="rpt-det-body">' +
      '<div class="rpt-det-preview">' + (rpt.html || '') + '</div>' +
    '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.reportsSelect = reportsSelect;

function rptDetailEmpty() {
  return '<div class="empty-state" style="padding:60px 20px;">' +
    '<i data-lucide="bar-chart-2"></i>' +
    '<div class="empty-state-title">Select a report</div>' +
    '<div class="empty-state-sub">Choose a report from the list to preview it here.</div>' +
  '</div>';
}

// ─── delete ───────────────────────────────────────────────────────────────────

function reportsDelete(id) {
  if (!confirm('Delete this report? This cannot be undone.')) return;
  _rptList = _rptList.filter(function(r) { return r.id !== id; });
  _rptPersist();
  renderReportKPIs(_rptList);
  renderReportList(_rptList);
  if (_rptCurrentId === id) {
    _rptCurrentId = null;
    var dp = document.getElementById('rpt-detail-panel');
    if (dp) { dp.innerHTML = rptDetailEmpty(); if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}
window.reportsDelete = reportsDelete;

// ─── print ────────────────────────────────────────────────────────────────────

function reportsDoPrint(id) {
  var rpt = _rptList.find(function(r) { return r.id === (id || _rptCurrentId); });
  if (!rpt || !rpt.html) return;
  var pv = document.getElementById('rpt-print-view');
  if (pv) {
    var content = document.getElementById('rpt-pv-content');
    if (content) content.innerHTML = rpt.html;
    pv.classList.add('open');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
window.reportsDoPrint = reportsDoPrint;

function reportsClosePrint() {
  var pv = document.getElementById('rpt-print-view');
  if (pv) pv.classList.remove('open');
}
window.reportsClosePrint = reportsClosePrint;

function reportsPrintNow() {
  document.body.classList.add('printing-report');
  window.print();
  window.addEventListener('afterprint', function() {
    document.body.classList.remove('printing-report');
    reportsClosePrint();
  }, { once: true });
}
window.reportsPrintNow = reportsPrintNow;

// ─── share to team ────────────────────────────────────────────────────────────

function reportsShareTeam(id) {
  var rpt = _rptList.find(function(r) { return r.id === (id || _rptCurrentId); });
  if (!rpt) return;
  if (typeof teamsShareReport === 'function') {
    teamsShareReport(rpt);
  } else {
    if (typeof showToast === 'function') showToast('Open the Team page first to share to chat.');
  }
}
window.reportsShareTeam = reportsShareTeam;

// ─── utils ────────────────────────────────────────────────────────────────────

function rptEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
