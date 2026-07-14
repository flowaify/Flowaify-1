// Invoice module — Flowaify dashboard v2
// Money is integer cents end-to-end; the Worker recomputes all totals and
// status — everything rendered here is display-only.

var _invWorker = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';
var _invList   = [];
var _invSel    = null;   // selected invoice id (side panel)
var _invLines  = [{ desc: '', qty: 1, unit: '' }];  // drawer editor state (unit in dollars text)
var _invEditing = null;  // draft id being edited, null = new
var _invPage   = 1;
var INV_PAGE_SIZE = 25;
var _invFilters = { q: '', status: 'all', client: 'all', due: 'all', sort: 'newest' };

// ── Auth fetch ────────────────────────────────────────────────────────────────

async function invFetch(method, path, body) {
  var client = window.__auth0Client;
  if (!client) return { status: 0 };
  var claims;
  try { claims = await client.getIdTokenClaims(); } catch (e) { return { status: 0 }; }
  if (!claims || !claims.__raw) return { status: 0 };
  try {
    var res = await fetch(_invWorker + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data };
  } catch (e) { return { status: 0 }; }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function invFmtC(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' })
      .format((cents || 0) / 100);
  } catch (e) { return '$' + ((cents || 0) / 100).toFixed(2); }
}

function invFmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function invEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function invToday() { return new Date().toISOString().slice(0, 10); }

/* Display status: overdue is derived, never stored */
function invStatusOf(inv) {
  if ((inv.status === 'open' || inv.status === 'partially_paid') && inv.dueDate && inv.dueDate < invToday()) {
    return 'overdue';
  }
  return inv.status;
}

var INV_BADGES = {
  draft:          { label: 'Draft',          cls: 'ivb-draft' },
  open:           { label: 'Open',           cls: 'ivb-open' },
  overdue:        { label: 'Overdue',        cls: 'ivb-overdue' },
  partially_paid: { label: 'Partially paid', cls: 'ivb-partial' },
  paid:           { label: 'Paid',           cls: 'ivb-paid' },
  void:           { label: 'Void',           cls: 'ivb-void' },
};

function invBadge(inv) {
  var st = invStatusOf(inv);
  var b = INV_BADGES[st] || INV_BADGES.draft;
  return '<span class="inv-badge ' + b.cls + '">' + b.label + '</span>';
}

function invDueLabel(inv) {
  var st = invStatusOf(inv);
  if (st === 'paid')  return 'Paid ' + (inv.paidAt ? new Date(inv.paidAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '');
  if (st === 'void')  return 'Voided';
  if (st === 'draft') return inv.dueDate ? 'Due ' + invFmtDate(inv.dueDate) : 'No due date';
  if (!inv.dueDate)   return 'No due date';
  var days = Math.round((new Date(inv.dueDate + 'T00:00:00') - new Date(invToday() + 'T00:00:00')) / 86400000);
  var pretty = new Date(inv.dueDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  if (days < 0)   return 'Due ' + pretty + ' · <span style="color:var(--red);font-weight:600;">' + (-days) + (days === -1 ? ' day' : ' days') + ' overdue</span>';
  if (days === 0) return 'Due ' + pretty + ' · <span style="color:var(--amber);font-weight:600;">due today</span>';
  return 'Due ' + pretty + ' <span style="color:var(--blue);">(in ' + days + (days === 1 ? ' day' : ' days') + ')</span>';
}

function invLastActivity(inv) {
  var ev = (inv.events || [])[inv.events ? inv.events.length - 1 : 0];
  if (!ev) return '—';
  var labels = {
    created: 'Created', edited: 'Edited', finalized: 'Finalized', sent: 'Sent', resent: 'Resent',
    viewed: 'Viewed', payment_recorded: 'Paid', payment_refunded: 'Refunded',
    voided: 'Voided', link_regenerated: 'Link reset', reminder_sent: 'Reminded',
  };
  var st = invStatusOf(inv);
  if (st === 'overdue') {
    var od = Math.round((new Date(invToday()) - new Date(inv.dueDate)) / 86400000);
    return '<span style="color:var(--red);">Overdue ' + od + 'd</span>';
  }
  var rel = (typeof relTime === 'function') ? relTime(ev.ts) : '';
  return (labels[ev.t] || ev.t) + ' ' + rel;
}

function invCanAdmin() {
  return !window.__myRole || window.__myRole === 'admin' || window.__myRole === 'owner';
}
function invCanEdit() {
  return invCanAdmin() || window.__myRole === 'member';
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function invoicesInit() {
  invReadHash();
  invKpiSkeleton();
  var tbody = document.getElementById('inv-tbody');
  if (tbody) tbody.innerHTML = invTableSkeleton();
  var r = await invFetch('GET', '/invoice/list');
  _invList = (r.status === 200 && r.data && r.data.invoices) ? r.data.invoices : [];
  if (r.status !== 200 && r.status !== 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:40px;"><i data-lucide="alert-circle"></i><div class="empty-state-title">Could not load invoices</div><div class="empty-state-sub">Check your connection and try again.</div></div></td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  invRenderAll();
}
window.invoicesInit = invoicesInit;

function invRenderAll() {
  renderInvoiceKPIs(_invList);
  invRenderClientFilter();
  renderInvoiceTable();
  invRenderPanel();
}

function invRefresh() {
  return invFetch('GET', '/invoice/list').then(function(r) {
    if (r.status === 200 && r.data && r.data.invoices) { _invList = r.data.invoices; invRenderAll(); }
  });
}

function invById(id) { return _invList.find(function(x) { return x.id === id; }); }

/* replace one invoice in the local list from a Worker response */
function invMerge(inv) {
  var i = _invList.findIndex(function(x) { return x.id === inv.id; });
  if (i !== -1) _invList[i] = inv; else _invList.unshift(inv);
  invRenderAll();
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function invKpiSkeleton() {
  ['inv-kpi-outstanding', 'inv-kpi-overdue', 'inv-kpi-paid', 'inv-kpi-drafts'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="skel" style="display:inline-block;width:80px;height:20px;"></span>';
    var sub = document.getElementById(id + '-sub');
    if (sub) sub.textContent = '';
  });
}

function renderInvoiceKPIs(list) {
  var today = invToday();
  var rangeDays = window.__rangeDays || 30;
  var cutoff = new Date(Date.now() - rangeDays * 86400000).toISOString().slice(0, 10);

  var outstanding = 0, outstandingN = 0, overdue = 0, overdueN = 0, drafts = 0;
  var paidAmt = 0, paidN = 0;

  list.forEach(function(inv) {
    if (inv.status === 'draft') { drafts++; return; }
    if (inv.status === 'void') return;
    if (inv.status === 'open' || inv.status === 'partially_paid') {
      outstanding += inv.remainingC || 0; outstandingN++;
      if (inv.dueDate && inv.dueDate < today) { overdue += inv.remainingC || 0; overdueN++; }
    }
    (inv.payments || []).forEach(function(p) {
      if (p.date >= cutoff) paidAmt += p.amountC || 0;
      (p.refunds || []).forEach(function(rf) { if (rf.date >= cutoff) paidAmt -= rf.amountC || 0; });
    });
    if (inv.status === 'paid' && inv.paidAt && new Date(inv.paidAt).toISOString().slice(0, 10) >= cutoff) paidN++;
  });

  function set(id, val, sub) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
    var s = document.getElementById(id + '-sub');
    if (s) s.innerHTML = sub;
  }
  set('inv-kpi-outstanding', invFmtC(outstanding), outstandingN + ' open ' + (outstandingN === 1 ? 'invoice' : 'invoices'));
  set('inv-kpi-overdue', invFmtC(overdue), overdueN ? '<span style="color:var(--red);">' + overdueN + ' overdue ' + (overdueN === 1 ? 'invoice' : 'invoices') + '</span>' : 'Nothing overdue');
  set('inv-kpi-paid', invFmtC(Math.max(0, paidAmt)), paidN + ' paid · last ' + rangeDays + ' days');
  set('inv-kpi-drafts', String(drafts), 'Not yet sent');
}

/* summary card click → filter table */
function invCardFilter(status) {
  _invFilters.status = (_invFilters.status === status) ? 'all' : status;
  var sel = document.getElementById('inv-f-status');
  if (sel) sel.value = _invFilters.status;
  _invPage = 1;
  renderInvoiceTable();
  invSyncHash();
}
window.invCardFilter = invCardFilter;

// ── Filters + sort ────────────────────────────────────────────────────────────

function invRenderClientFilter() {
  var sel = document.getElementById('inv-f-client');
  if (!sel) return;
  var cur = _invFilters.client;
  var names = {};
  _invList.forEach(function(inv) { var n = (inv.client || {}).name; if (n) names[n] = 1; });
  var opts = '<option value="all">All clients</option>' + Object.keys(names).sort().map(function(n) {
    return '<option value="' + invEsc(n) + '">' + invEsc(n) + '</option>';
  }).join('');
  sel.innerHTML = opts;
  sel.value = names[cur] ? cur : 'all';
}

function invFilterChange() {
  _invFilters.q      = ((document.getElementById('inv-search') || {}).value || '').toLowerCase();
  _invFilters.status = (document.getElementById('inv-f-status') || {}).value || 'all';
  _invFilters.client = (document.getElementById('inv-f-client') || {}).value || 'all';
  _invFilters.due    = (document.getElementById('inv-f-due') || {}).value || 'all';
  _invFilters.sort   = (document.getElementById('inv-f-sort') || {}).value || 'newest';
  _invPage = 1;
  renderInvoiceTable();
  invSyncHash();
}
window.invFilterChange = invFilterChange;

function invClearFilters() {
  _invFilters = { q: '', status: 'all', client: 'all', due: 'all', sort: 'newest' };
  _invPage = 1;
  var s = document.getElementById('inv-search'); if (s) s.value = '';
  ['inv-f-status', 'inv-f-client', 'inv-f-due'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = 'all';
  });
  var so = document.getElementById('inv-f-sort'); if (so) so.value = 'newest';
  renderInvoiceTable();
  invSyncHash();
}
window.invClearFilters = invClearFilters;

function invOverdueOnly() {
  invCardFilter('overdue');
}
window.invOverdueOnly = invOverdueOnly;

function invApplyFilters() {
  var f = _invFilters, today = invToday();
  var week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  var monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);

  var rows = _invList.filter(function(inv) {
    var st = invStatusOf(inv);
    if (f.status !== 'all' && st !== f.status) return false;
    if (f.client !== 'all' && (inv.client || {}).name !== f.client) return false;
    if (f.due === 'next7'  && !(inv.dueDate && inv.dueDate >= today && inv.dueDate <= week && st !== 'paid' && st !== 'void')) return false;
    if (f.due === 'month'  && !(inv.dueDate && inv.dueDate >= today && inv.dueDate <= monthEnd)) return false;
    if (f.due === 'past'   && !(inv.dueDate && inv.dueDate < today)) return false;
    if (f.q) {
      var hay = ((inv.number || '') + ' ' + ((inv.client || {}).name || '') + ' ' +
                 ((inv.client || {}).company || '') + ' ' + ((inv.client || {}).email || '')).toLowerCase();
      if (hay.indexOf(f.q) === -1) return false;
    }
    return true;
  });

  var sorts = {
    newest:  function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); },
    oldest:  function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); },
    duesoon: function(a, b) { return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1; },
    overdue: function(a, b) { return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1; },
    amtdesc: function(a, b) { return (b.totalC || 0) - (a.totalC || 0); },
    amtasc:  function(a, b) { return (a.totalC || 0) - (b.totalC || 0); },
    updated: function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); },
  };
  rows.sort(sorts[f.sort] || sorts.newest);
  return rows;
}

// ── URL hash state ────────────────────────────────────────────────────────────

function invSyncHash() {
  if (!document.getElementById('page-invoices') ||
      !document.getElementById('page-invoices').classList.contains('active')) return;
  var f = _invFilters, parts = [];
  if (f.q) parts.push('q=' + encodeURIComponent(f.q));
  if (f.status !== 'all') parts.push('status=' + f.status);
  if (f.client !== 'all') parts.push('client=' + encodeURIComponent(f.client));
  if (f.due !== 'all') parts.push('due=' + f.due);
  if (f.sort !== 'newest') parts.push('sort=' + f.sort);
  try {
    history.replaceState(null, '', location.pathname + location.search + '#invoices' + (parts.length ? '?' + parts.join('&') : ''));
  } catch (e) {}
}

function invReadHash() {
  var h = location.hash || '';
  if (h.indexOf('#invoices?') !== 0) return;
  var params = new URLSearchParams(h.slice('#invoices?'.length));
  _invFilters.q      = params.get('q') || '';
  _invFilters.status = params.get('status') || 'all';
  _invFilters.client = params.get('client') || 'all';
  _invFilters.due    = params.get('due') || 'all';
  _invFilters.sort   = params.get('sort') || 'newest';
  var s = document.getElementById('inv-search'); if (s) s.value = _invFilters.q;
  var st = document.getElementById('inv-f-status'); if (st) st.value = _invFilters.status;
  var du = document.getElementById('inv-f-due'); if (du) du.value = _invFilters.due;
  var so = document.getElementById('inv-f-sort'); if (so) so.value = _invFilters.sort;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function invTableSkeleton() {
  var rows = '';
  for (var i = 0; i < 5; i++) {
    rows += '<tr><td colspan="8" style="padding:13px 16px;"><div class="skel" style="height:14px;width:' + (55 + i * 8) + '%;"></div></td></tr>';
  }
  return rows;
}

function renderInvoiceTable() {
  var tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  var rows = invApplyFilters();
  var total = rows.length;
  var pages = Math.max(1, Math.ceil(total / INV_PAGE_SIZE));
  if (_invPage > pages) _invPage = pages;
  var start = (_invPage - 1) * INV_PAGE_SIZE;
  var page = rows.slice(start, start + INV_PAGE_SIZE);

  if (!_invList.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:48px 20px;">' +
      '<i data-lucide="file-text"></i><div class="empty-state-title">No invoices yet</div>' +
      '<div class="empty-state-sub">Create your first invoice to start billing clients.</div>' +
      '<button class="cmd-primary" style="margin-top:14px;" onclick="openNewInvoice()"><i data-lucide="plus"></i>Create your first invoice</button></div></td></tr>';
  } else if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:40px 20px;">' +
      '<i data-lucide="search-x"></i><div class="empty-state-title">No matching invoices</div>' +
      '<div class="empty-state-sub">Try different search terms or <span class="sec-link" onclick="invClearFilters()">clear the filters</span>.</div></div></td></tr>';
  } else {
    tbody.innerHTML = page.map(function(inv) {
      var c = inv.client || {};
      var sel = _invSel === inv.id ? ' inv-row-sel' : '';
      var overdueDue = invStatusOf(inv) === 'overdue';
      return '<tr class="inv-row' + sel + '" onclick="selectInvoice(\'' + inv.id + '\')">' +
        '<td><span class="inv-num">' + invEsc(inv.number || 'Draft') + '</span></td>' +
        '<td><div class="inv-client-cell"><div class="inv-client-name">' + invEsc(c.name || '—') + '</div>' +
          (c.email ? '<div class="inv-client-email">' + invEsc(c.email) + '</div>' : '') + '</div></td>' +
        '<td class="inv-amt">' + invFmtC(inv.totalC, inv.currency) + '</td>' +
        '<td>' + invBadge(inv) + '</td>' +
        '<td class="inv-date">' + invFmtDate(inv.issueDate) + '</td>' +
        '<td class="inv-date' + (overdueDue ? ' inv-date-red' : '') + '">' + invFmtDate(inv.dueDate) + '</td>' +
        '<td class="inv-date">' + invLastActivity(inv) + '</td>' +
        '<td class="inv-actions-cell"><button class="inv-dots" onclick="invRowMenu(event,\'' + inv.id + '\')" title="Actions" aria-label="Invoice actions">···</button></td>' +
      '</tr>';
    }).join('');
  }

  var foot = document.getElementById('inv-table-foot');
  if (foot) {
    if (!total) { foot.innerHTML = ''; }
    else {
      foot.innerHTML = '<span>Showing ' + (start + 1) + '–' + Math.min(start + INV_PAGE_SIZE, total) + ' of ' + total + ' ' + (total === 1 ? 'invoice' : 'invoices') + '</span>' +
        '<span class="inv-pager">' +
        '<button class="inv-page-btn" ' + (_invPage <= 1 ? 'disabled' : '') + ' onclick="invGoPage(' + (_invPage - 1) + ')" aria-label="Previous page">‹</button>' +
        '<span class="inv-page-num">' + _invPage + '</span>' +
        '<button class="inv-page-btn" ' + (_invPage >= pages ? 'disabled' : '') + ' onclick="invGoPage(' + (_invPage + 1) + ')" aria-label="Next page">›</button></span>';
    }
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderInvoiceTable = renderInvoiceTable;

function invGoPage(p) { _invPage = Math.max(1, p); renderInvoiceTable(); }
window.invGoPage = invGoPage;

// ── Row action menu (shared floating menu) ────────────────────────────────────

function invRowMenu(e, id) {
  e.stopPropagation();
  var menu = document.getElementById('inv-row-menu');
  var inv = invById(id);
  if (!menu || !inv) return;
  var st = invStatusOf(inv);
  var admin = invCanAdmin(), member = invCanEdit();
  var items = [];
  function it(icon, label, fn, danger) {
    items.push('<div class="card-ctx-item' + (danger ? ' ctx-danger' : '') + '" onclick="' + fn + '"><i data-lucide="' + icon + '"></i>' + label + '</div>');
  }
  it('eye', 'View details', 'selectInvoice(\'' + id + '\')');
  if (st === 'draft') {
    if (member) it('pencil', 'Edit draft', 'openEditInvoice(\'' + id + '\')');
    it('file-search', 'Preview', 'invDoPrint(\'' + id + '\', true)');
    if (member) it('check-circle', 'Finalize', 'invFinalize(\'' + id + '\')');
    if (member) it('copy', 'Duplicate', 'invDuplicate(\'' + id + '\')');
    if (admin) it('trash-2', 'Delete draft', 'invDeleteDraft(\'' + id + '\')', true);
  } else if (st === 'open' || st === 'overdue' || st === 'partially_paid') {
    it('link', 'Copy payment link', 'invCopyLink(\'' + id + '\')');
    it('external-link', 'Open client page', 'invOpenPublic(\'' + id + '\')');
    it('download', 'Download invoice', 'invDoPrint(\'' + id + '\')');
    if (admin) it('banknote', 'Record payment', 'invPaymentDialog(\'' + id + '\')');
    if (member) it('copy', 'Duplicate', 'invDuplicate(\'' + id + '\')');
    if (admin) it('rotate-ccw', 'Regenerate link', 'invRegenLink(\'' + id + '\')');
    if (admin) it('ban', 'Void invoice', 'invVoidDialog(\'' + id + '\')', true);
  } else if (st === 'paid') {
    it('external-link', 'Open client page', 'invOpenPublic(\'' + id + '\')');
    it('download', 'Download invoice', 'invDoPrint(\'' + id + '\')');
    if (admin) it('undo-2', 'Record refund', 'invRefundDialog(\'' + id + '\')');
    if (member) it('copy', 'Duplicate', 'invDuplicate(\'' + id + '\')');
  } else if (st === 'void') {
    it('download', 'Download invoice', 'invDoPrint(\'' + id + '\')');
    if (member) it('copy', 'Duplicate', 'invDuplicate(\'' + id + '\')');
  }
  menu.innerHTML = items.join('');
  var r = e.currentTarget.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - items.length * 34 - 16) + 'px';
  menu.style.left = Math.max(8, r.right - 190) + 'px';
  menu.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.invRowMenu = invRowMenu;

document.addEventListener('click', function() {
  var m = document.getElementById('inv-row-menu');
  if (m) m.classList.remove('open');
});

// ── Side detail panel ─────────────────────────────────────────────────────────

function selectInvoice(id) {
  _invSel = id;
  renderInvoiceTable();
  invRenderPanel();
  var panel = document.getElementById('inv-detail-panel');
  if (panel && window.innerWidth <= 900) panel.classList.add('inv-mobile-open');
}
window.selectInvoice = selectInvoice;

function invClosePanel() {
  _invSel = null;
  var panel = document.getElementById('inv-detail-panel');
  if (panel) panel.classList.remove('inv-mobile-open');
  renderInvoiceTable();
  invRenderPanel();
}
window.invClosePanel = invClosePanel;

var INV_EVENT_LABELS = {
  created: 'Invoice created', edited: 'Invoice edited', finalized: 'Invoice finalized',
  sent: 'Invoice sent to client', resent: 'Invoice resent', viewed: 'Client viewed invoice',
  payment_recorded: 'Payment recorded', payment_refunded: 'Refund issued',
  voided: 'Invoice voided', link_regenerated: 'Payment link regenerated', reminder_sent: 'Reminder sent',
};

function invRenderPanel() {
  var panel = document.getElementById('inv-detail-panel');
  if (!panel) return;
  var inv = _invSel ? invById(_invSel) : null;
  if (!inv) {
    panel.innerHTML = '<div class="empty-state" style="padding:60px 20px;">' +
      '<i data-lucide="file-text"></i><div class="empty-state-title">Select an invoice</div>' +
      '<div class="empty-state-sub">View details, payment status, activity, and available actions.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var st = invStatusOf(inv);
  var c = inv.client || {};
  var admin = invCanAdmin(), member = invCanEdit();

  // status-dependent primary + secondary actions
  var actions = '';
  function primary(icon, label, fn) { return '<button class="inv-act-primary" onclick="' + fn + '"><i data-lucide="' + icon + '"></i>' + label + '</button>'; }
  function ghost(icon, label, fn) { return '<button class="inv-act-ghost" onclick="' + fn + '"><i data-lucide="' + icon + '"></i>' + label + '</button>'; }
  if (st === 'draft') {
    if (member) actions += primary('pencil', 'Edit Invoice', 'openEditInvoice(\'' + inv.id + '\')');
    actions += ghost('file-search', 'Preview', 'invDoPrint(\'' + inv.id + '\', true)');
    if (member) actions += ghost('check-circle', 'Finalize & Assign Number', 'invFinalize(\'' + inv.id + '\')');
  } else if (st === 'open' || st === 'overdue' || st === 'partially_paid') {
    actions += primary('link', 'Copy Payment Link', 'invCopyLink(\'' + inv.id + '\')');
    actions += ghost('external-link', 'View Client Page', 'invOpenPublic(\'' + inv.id + '\')');
    actions += ghost('download', 'Download Invoice', 'invDoPrint(\'' + inv.id + '\')');
    if (admin) actions += ghost('banknote', 'Record Payment', 'invPaymentDialog(\'' + inv.id + '\')');
  } else if (st === 'paid') {
    actions += primary('download', 'Download Invoice', 'invDoPrint(\'' + inv.id + '\')');
    actions += ghost('external-link', 'View Client Page', 'invOpenPublic(\'' + inv.id + '\')');
    if (admin) actions += ghost('undo-2', 'Record Refund', 'invRefundDialog(\'' + inv.id + '\')');
  } else if (st === 'void') {
    actions += ghost('download', 'Download Invoice', 'invDoPrint(\'' + inv.id + '\')');
  }

  var itemsHtml = (inv.items || []).map(function(it) {
    return '<div class="inv-p-item"><span class="inv-p-item-desc">' + invEsc(it.desc || '—') +
      (it.qty !== 1 ? ' <span class="inv-p-item-qty">× ' + it.qty + '</span>' : '') + '</span>' +
      '<span class="inv-p-item-amt">' + invFmtC(it.totalC, inv.currency) + '</span></div>';
  }).join('') || '<div class="inv-p-item"><span class="inv-p-item-desc" style="color:var(--text-m);">No line items</span></div>';

  var evs = (inv.events || []).slice(-8).reverse();
  var timeline = evs.map(function(ev) {
    var when = new Date(ev.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) +
      ' at ' + new Date(ev.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    var extra = (ev.meta && ev.meta.amountC != null) ? ' · ' + invFmtC(ev.meta.amountC, inv.currency) : '';
    var by = ev.by && ev.by !== 'migration' && ev.by !== 'client' ? ' · ' + invEsc(ev.by) : (ev.by === 'client' ? ' · client' : '');
    return '<div class="inv-tl-item"><span class="inv-tl-dot"></span><div>' +
      '<div class="inv-tl-label">' + (INV_EVENT_LABELS[ev.t] || ev.t) + extra + '</div>' +
      '<div class="inv-tl-ts">' + when + by + '</div></div></div>';
  }).join('') || '<div class="inv-tl-ts" style="padding:4px 0;">No activity yet</div>';

  var summary = [
    ['Client', invEsc(c.name || '—')],
    c.company ? ['Company', invEsc(c.company)] : null,
    c.email ? ['Email', invEsc(c.email)] : null,
    ['Issue Date', invFmtDate(inv.issueDate)],
    ['Due Date', invFmtDate(inv.dueDate)],
    inv.terms ? ['Terms', invEsc(inv.terms)] : null,
    ['Currency', inv.currency || 'USD'],
    ['Amount Due', invFmtC(inv.remainingC, inv.currency)],
    (inv.paidC > 0) ? ['Amount Paid', invFmtC(inv.paidC, inv.currency)] : null,
  ].filter(Boolean).map(function(row) {
    return '<div class="inv-p-krow"><span>' + row[0] + '</span><span>' + row[1] + '</span></div>';
  }).join('');

  panel.innerHTML =
    '<div class="inv-p-head">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span class="inv-p-num">' + invEsc(inv.number || 'Draft') + '</span>' + invBadge(inv) +
      '</div>' +
      '<button class="inv-p-close" onclick="invClosePanel()" aria-label="Close details"><i data-lucide="x"></i></button>' +
    '</div>' +
    '<div class="inv-p-amount">' + invFmtC(inv.totalC, inv.currency) + '</div>' +
    '<div class="inv-p-due">' + invDueLabel(inv) + '</div>' +
    '<div class="inv-p-actions">' + actions + '</div>' +
    '<div class="inv-p-sec">Summary</div>' + summary +
    '<div class="inv-p-sec">Items (' + (inv.items || []).length + ')</div>' + itemsHtml +
    '<div class="inv-p-krow inv-p-total"><span>Total</span><span>' + invFmtC(inv.totalC, inv.currency) + '</span></div>' +
    '<div class="inv-p-sec">Activity</div><div class="inv-tl">' + timeline + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Actions ───────────────────────────────────────────────────────────────────

function invPublicUrl(inv) {
  return 'https://flowaify.app/invoice.html?i=' + inv.token;
}

function invOpenPublic(id) {
  var inv = invById(id);
  if (!inv || !inv.token) { showToast('Finalize the invoice to get a client page.'); return; }
  // pv=1 keeps the owner's own visit from stamping "Client viewed invoice"
  window.open(invPublicUrl(inv) + '&pv=1', '_blank', 'noopener');
}
window.invOpenPublic = invOpenPublic;

async function invCopyLink(id) {
  var inv = invById(id);
  if (!inv || !inv.token) { showToast('Finalize the invoice to get a payment link.'); return; }
  try { await navigator.clipboard.writeText(invPublicUrl(inv)); } catch (e) {
    window.prompt('Copy this payment link:', invPublicUrl(inv));
  }
  showToast('Payment link copied.');
  if (!inv.sentAt) {
    var r = await invFetch('POST', '/invoice/sent', { id: id, via: 'link' });
    if (r.status === 200 && r.data.invoice) invMerge(r.data.invoice);
  }
}
window.invCopyLink = invCopyLink;

async function invFinalize(id) {
  var inv = invById(id);
  if (!inv) return;
  invConfirm(
    'Finalize this invoice?',
    'A permanent invoice number will be assigned and the document locks. Totals: ' + invFmtC(inv.totalC, inv.currency) + '.',
    'Finalize', false,
    async function() {
      var r = await invFetch('POST', '/invoice/finalize', { id: id });
      if (r.status === 200 && r.data.invoice) {
        invMerge(r.data.invoice);
        showToast('Finalized as ' + r.data.invoice.number + '.');
      } else showToast((r.data && r.data.message) || 'Could not finalize.');
    }
  );
}
window.invFinalize = invFinalize;

async function invDuplicate(id) {
  var src = invById(id);
  if (!src) return;
  var copy = {
    id: 'inv' + Date.now().toString(36),
    client: src.client, currency: src.currency,
    issueDate: invToday(), dueDate: '',
    terms: src.terms, poNumber: '',
    items: (src.items || []).map(function(it) { return { desc: it.desc, desc2: it.desc2, qty: it.qty, unitC: it.unitC }; }),
    discountC: src.discountC, taxRateBps: src.taxRateBps, memo: src.memo,
  };
  var r = await invFetch('POST', '/invoice/save', copy);
  if (r.status === 200 && r.data.invoice) {
    invMerge(r.data.invoice);
    _invSel = r.data.invoice.id;
    invRenderPanel(); renderInvoiceTable();
    showToast('Draft duplicated.');
  } else showToast('Could not duplicate.');
}
window.invDuplicate = invDuplicate;

function invDeleteDraft(id) {
  invConfirm('Delete this draft?', 'The draft is removed permanently. Finalized invoices are never deleted.', 'Delete', true, async function() {
    var r = await invFetch('DELETE', '/invoice/' + id);
    if (r.status === 200) {
      _invList = _invList.filter(function(x) { return x.id !== id; });
      if (_invSel === id) _invSel = null;
      invRenderAll();
      showToast('Draft deleted.');
    } else showToast((r.data && r.data.error) || 'Could not delete.');
  });
}
window.invDeleteDraft = invDeleteDraft;

function invVoidDialog(id) {
  var inv = invById(id);
  if (!inv) return;
  invConfirm('Void ' + (inv.number || 'this invoice') + '?',
    'The invoice becomes non-payable, its public link stops working, and the number stays on record. This cannot be undone.',
    'Void invoice', true,
    async function() {
      var r = await invFetch('POST', '/invoice/void', { id: id });
      if (r.status === 200 && r.data.invoice) { invMerge(r.data.invoice); showToast('Invoice voided.'); }
      else showToast((r.data && r.data.error) || 'Could not void.');
    });
}
window.invVoidDialog = invVoidDialog;

function invRegenLink(id) {
  invConfirm('Regenerate payment link?', 'The current link stops working immediately. Anyone holding the old link loses access.', 'Regenerate', true, async function() {
    var r = await invFetch('POST', '/invoice/token', { id: id });
    if (r.status === 200 && r.data.invoice) {
      invMerge(r.data.invoice);
      try { await navigator.clipboard.writeText(invPublicUrl(r.data.invoice)); showToast('New link copied.'); }
      catch (e) { showToast('New link generated.'); }
    } else showToast('Could not regenerate.');
  });
}
window.invRegenLink = invRegenLink;

// ── Record payment / refund dialogs ───────────────────────────────────────────

function invPaymentDialog(id) {
  var inv = invById(id);
  if (!inv) return;
  invModal('Record payment — ' + invEsc(inv.number || ''),
    '<div class="inv-dr-field"><label>Amount (' + inv.currency + ')</label><input id="inv-pay-amt" type="number" min="0.01" step="0.01" value="' + (inv.remainingC / 100).toFixed(2) + '" /></div>' +
    '<div class="inv-dr-row">' +
      '<div class="inv-dr-field"><label>Date</label><input id="inv-pay-date" type="date" value="' + invToday() + '" /></div>' +
      '<div class="inv-dr-field"><label>Method</label><select id="inv-pay-method">' +
        '<option>Bank transfer</option><option>Card</option><option>Cash</option><option>Check</option><option>Other</option></select></div>' +
    '</div>' +
    '<div class="inv-dr-field"><label>Reference (optional)</label><input id="inv-pay-ref" type="text" placeholder="Transaction ID, check number…" /></div>',
    'Record payment',
    async function() {
      var amt = Math.round(parseFloat((document.getElementById('inv-pay-amt') || {}).value || '0') * 100);
      if (!(amt > 0)) { showToast('Enter a payment amount.'); return false; }
      var r = await invFetch('POST', '/invoice/payment', {
        id: id, amountC: amt,
        date: (document.getElementById('inv-pay-date') || {}).value,
        method: ((document.getElementById('inv-pay-method') || {}).value || 'other').toLowerCase(),
        reference: (document.getElementById('inv-pay-ref') || {}).value || '',
      });
      if (r.status === 200 && r.data.invoice) {
        invMerge(r.data.invoice);
        showToast(r.data.invoice.status === 'paid' ? 'Payment recorded — invoice paid in full.' : 'Partial payment recorded.');
        return true;
      }
      showToast((r.data && r.data.error) || 'Could not record payment.');
      return false;
    });
}
window.invPaymentDialog = invPaymentDialog;

function invRefundDialog(id) {
  var inv = invById(id);
  if (!inv || !(inv.payments || []).length) { showToast('No payments to refund.'); return; }
  var opts = inv.payments.map(function(p) {
    var refunded = (p.refunds || []).reduce(function(s, r) { return s + r.amountC; }, 0);
    var left = p.amountC - refunded;
    return left > 0 ? '<option value="' + p.pid + '" data-left="' + left + '">' + invFmtC(p.amountC, inv.currency) + ' · ' + invEsc(p.method) + ' · ' + invEsc(p.date) + (refunded ? ' (partly refunded)' : '') + '</option>' : '';
  }).join('');
  if (!opts) { showToast('All payments fully refunded already.'); return; }
  invModal('Record refund — ' + invEsc(inv.number || ''),
    '<div class="inv-dr-field"><label>Payment</label><select id="inv-rf-pid" onchange="var o=this.options[this.selectedIndex];document.getElementById(\'inv-rf-amt\').value=(o.getAttribute(\'data-left\')/100).toFixed(2);">' + opts + '</select></div>' +
    '<div class="inv-dr-field"><label>Refund amount (' + inv.currency + ')</label><input id="inv-rf-amt" type="number" min="0.01" step="0.01" /></div>' +
    '<div class="inv-dr-field"><label>Reason (optional)</label><input id="inv-rf-reason" type="text" placeholder="Why is this being refunded?" /></div>',
    'Record refund',
    async function() {
      var amt = Math.round(parseFloat((document.getElementById('inv-rf-amt') || {}).value || '0') * 100);
      if (!(amt > 0)) { showToast('Enter a refund amount.'); return false; }
      var r = await invFetch('POST', '/invoice/refund', {
        id: id, pid: (document.getElementById('inv-rf-pid') || {}).value,
        amountC: amt, reason: (document.getElementById('inv-rf-reason') || {}).value || '',
      });
      if (r.status === 200 && r.data.invoice) { invMerge(r.data.invoice); showToast('Refund recorded.'); return true; }
      showToast((r.data && r.data.error) || 'Could not record refund.');
      return false;
    });
  // preset the amount from the first selectable payment
  setTimeout(function() {
    var sel = document.getElementById('inv-rf-pid');
    if (sel && sel.options.length) {
      var left = sel.options[sel.selectedIndex].getAttribute('data-left');
      var amtEl = document.getElementById('inv-rf-amt');
      if (amtEl && left) amtEl.value = (left / 100).toFixed(2);
    }
  }, 30);
}
window.invRefundDialog = invRefundDialog;

// ── Generic modal + confirm (no native alerts) ────────────────────────────────

function invModal(title, bodyHtml, confirmLabel, onConfirm, danger) {
  var host = document.getElementById('inv-modal');
  if (!host) return;
  host.innerHTML = '<div class="inv-modal-box" role="dialog" aria-modal="true" aria-label="' + invEsc(title) + '">' +
    '<div class="inv-modal-title">' + title + '</div>' +
    '<div class="inv-modal-body">' + bodyHtml + '</div>' +
    '<div class="inv-modal-foot">' +
      '<button class="btn-mini btn-mini-ghost" onclick="invModalClose()">Cancel</button>' +
      '<button class="btn-mini ' + (danger ? 'inv-btn-danger' : 'btn-mini-primary') + '" id="inv-modal-go">' + invEsc(confirmLabel) + '</button>' +
    '</div></div>';
  host.classList.add('open');
  var go = document.getElementById('inv-modal-go');
  if (go) go.onclick = async function() {
    go.disabled = true;
    var ok = await onConfirm();
    go.disabled = false;
    if (ok !== false) invModalClose();
  };
  var first = host.querySelector('input, select, button');
  if (first) first.focus();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invConfirm(title, text, confirmLabel, danger, onConfirm) {
  invModal(invEsc(title), '<div style="font-size:12.5px;color:var(--text-s);line-height:1.6;">' + invEsc(text) + '</div>',
    confirmLabel, async function() { await onConfirm(); return true; }, danger);
}

function invModalClose() {
  var host = document.getElementById('inv-modal');
  if (host) { host.classList.remove('open'); host.innerHTML = ''; }
}
window.invModalClose = invModalClose;

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var host = document.getElementById('inv-modal');
    if (host && host.classList.contains('open')) invModalClose();
  }
});

// ── Export CSV ────────────────────────────────────────────────────────────────

function invExportCsv() {
  var rows = invApplyFilters();
  var head = ['Invoice', 'Client', 'Company', 'Email', 'Amount', 'Currency', 'Status', 'Issued', 'Due', 'Paid', 'Remaining'];
  function cell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var lines = [head.join(',')].concat(rows.map(function(inv) {
    var c = inv.client || {};
    return [inv.number || 'Draft', c.name, c.company, c.email,
      ((inv.totalC || 0) / 100).toFixed(2), inv.currency || 'USD', invStatusOf(inv),
      inv.issueDate, inv.dueDate, ((inv.paidC || 0) / 100).toFixed(2), ((inv.remainingC || 0) / 100).toFixed(2)
    ].map(cell).join(',');
  }));
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flowaify-invoices-' + invToday() + '.csv';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
  showToast('Exported ' + rows.length + ' ' + (rows.length === 1 ? 'invoice' : 'invoices') + '.');
}
window.invExportCsv = invExportCsv;

// ── Creation drawer ───────────────────────────────────────────────────────────

var _invSettings = null;
async function invLoadSettings() {
  if (_invSettings) return _invSettings;
  var r = await invFetch('GET', '/settings');
  _invSettings = (r.status === 200 && r.data && r.data.config) ? r.data.config : {};
  return _invSettings;
}

function openNewInvoice(lead) {
  if (!invCanEdit()) { showToast('Only members can create invoices.'); return; }
  _invEditing = null;
  _invLines = [{ desc: '', qty: 1, unit: '' }];
  invDrSet('inv-dr-title', 'New Invoice');
  ['inv-dr-bill-name', 'inv-dr-bill-email', 'inv-dr-bill-company', 'inv-dr-bill-address', 'inv-dr-po', 'inv-dr-memo', 'inv-dr-payurl'].forEach(function(id) { invDrField(id, ''); });
  invDrField('inv-dr-issue', invToday());
  invDrField('inv-dr-due', new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10));
  invDrField('inv-dr-terms', 'Net 15');
  invDrField('inv-dr-tax', ''); invDrField('inv-dr-discount', '');
  if (lead) {
    invDrField('inv-dr-bill-name', lead.name || '');
    invDrField('inv-dr-bill-email', lead.email || '');
  }
  invLoadSettings().then(function(cfg) {
    invDrField('inv-dr-currency', (cfg.billing && cfg.billing.defaultCurrency) || 'USD');
    invDrSet('inv-biz-name', (cfg.billing && cfg.billing.legalName) || (cfg.profile && cfg.profile.businessName) || 'Set your business info in Settings');
    invDrSet('inv-biz-email', (cfg.billing && cfg.billing.supportEmail) || (cfg.profile && cfg.profile.contactEmail) || '');
  });
  invRenderLines();
  invDrTotals();
  invOpenDrawer();
}
window.openNewInvoice = openNewInvoice;

function openEditInvoice(id) {
  var inv = invById(id);
  if (!inv) return;
  if (inv.status !== 'draft') { showToast('Finalized invoices can no longer be edited.'); return; }
  _invEditing = id;
  var c = inv.client || {};
  invDrSet('inv-dr-title', 'Edit Draft');
  invDrField('inv-dr-bill-name', c.name || '');
  invDrField('inv-dr-bill-email', c.email || '');
  invDrField('inv-dr-bill-company', c.company || '');
  invDrField('inv-dr-bill-address', c.address || '');
  invDrField('inv-dr-issue', inv.issueDate || invToday());
  invDrField('inv-dr-due', inv.dueDate || '');
  invDrField('inv-dr-terms', inv.terms || 'Net 15');
  invDrField('inv-dr-currency', inv.currency || 'USD');
  invDrField('inv-dr-po', inv.poNumber || '');
  invDrField('inv-dr-memo', inv.memo || '');
  invDrField('inv-dr-payurl', inv.payUrl || '');
  invDrField('inv-dr-tax', inv.taxRateBps ? (inv.taxRateBps / 100) : '');
  invDrField('inv-dr-discount', inv.discountC ? (inv.discountC / 100) : '');
  _invLines = (inv.items || []).map(function(it) { return { desc: it.desc, qty: it.qty, unit: (it.unitC / 100) }; });
  if (!_invLines.length) _invLines = [{ desc: '', qty: 1, unit: '' }];
  invLoadSettings().then(function(cfg) {
    invDrSet('inv-biz-name', (cfg.billing && cfg.billing.legalName) || (cfg.profile && cfg.profile.businessName) || '—');
    invDrSet('inv-biz-email', (cfg.billing && cfg.billing.supportEmail) || (cfg.profile && cfg.profile.contactEmail) || '');
  });
  invRenderLines();
  invDrTotals();
  invOpenDrawer();
}
window.openEditInvoice = openEditInvoice;

function invOpenDrawer() {
  var d = document.getElementById('inv-drawer'), o = document.getElementById('inv-drawer-overlay');
  if (d) d.classList.add('open');
  if (o) o.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeInvoiceDrawer() {
  var d = document.getElementById('inv-drawer'), o = document.getElementById('inv-drawer-overlay');
  if (d) d.classList.remove('open');
  if (o) o.classList.remove('open');
}
window.closeInvoiceDrawer = closeInvoiceDrawer;

function invTermsChange() {
  var terms = (document.getElementById('inv-dr-terms') || {}).value || '';
  var m = terms.match(/Net (\d+)/);
  var issue = (document.getElementById('inv-dr-issue') || {}).value || invToday();
  if (m) invDrField('inv-dr-due', new Date(new Date(issue + 'T00:00:00').getTime() + (+m[1]) * 86400000).toISOString().slice(0, 10));
  if (terms === 'Due on receipt') invDrField('inv-dr-due', issue);
}
window.invTermsChange = invTermsChange;

// ── Line items ────────────────────────────────────────────────────────────────

function invRenderLines() {
  var host = document.getElementById('inv-dr-lines');
  if (!host) return;
  host.innerHTML = _invLines.map(function(l, i) {
    return '<div class="inv-line-row">' +
      '<input class="inv-line-desc" type="text" placeholder="Description" value="' + invEsc(l.desc || '') + '" oninput="invLineChange(' + i + ',\'desc\',this.value)" aria-label="Line item description" />' +
      '<input class="inv-line-qty" type="number" min="0" step="1" value="' + (l.qty != null ? l.qty : 1) + '" oninput="invLineChange(' + i + ',\'qty\',this.value)" aria-label="Quantity" />' +
      '<input class="inv-line-price" type="number" min="0" step="0.01" placeholder="0.00" value="' + (l.unit !== '' && l.unit != null ? l.unit : '') + '" oninput="invLineChange(' + i + ',\'unit\',this.value)" aria-label="Unit price" />' +
      '<span class="inv-line-total">' + invFmtC(Math.round((+l.qty || 0) * (+l.unit || 0) * 100), (document.getElementById('inv-dr-currency') || {}).value) + '</span>' +
      '<button class="inv-line-x" onclick="invoiceRemoveLine(' + i + ')" title="Remove line" aria-label="Remove line">×</button>' +
    '</div>';
  }).join('');
}

function invLineChange(idx, field, val) {
  if (!_invLines[idx]) return;
  if (field === 'qty') _invLines[idx].qty = Math.max(0, parseFloat(val) || 0);
  else if (field === 'unit') _invLines[idx].unit = val;
  else _invLines[idx][field] = val;
  if (field !== 'desc') {
    var row = document.querySelectorAll('#inv-dr-lines .inv-line-total')[idx];
    if (row) row.textContent = invFmtC(Math.round((+_invLines[idx].qty || 0) * (+_invLines[idx].unit || 0) * 100), (document.getElementById('inv-dr-currency') || {}).value);
  }
  invDrTotals();
}
window.invLineChange = invLineChange;

function invoiceAddLine() {
  _invLines.push({ desc: '', qty: 1, unit: '' });
  invRenderLines();
  var rows = document.querySelectorAll('#inv-dr-lines .inv-line-desc');
  if (rows.length) rows[rows.length - 1].focus();
}
window.invoiceAddLine = invoiceAddLine;

function invoiceRemoveLine(idx) {
  _invLines.splice(idx, 1);
  if (!_invLines.length) _invLines = [{ desc: '', qty: 1, unit: '' }];
  invRenderLines();
  invDrTotals();
}
window.invoiceRemoveLine = invoiceRemoveLine;

/* client-side mirror of the Worker's recalc — display only */
function invDrTotals() {
  var cur = (document.getElementById('inv-dr-currency') || {}).value || 'USD';
  var subtotal = 0;
  _invLines.forEach(function(l) { subtotal += Math.round((+l.qty || 0) * (+l.unit || 0) * 100); });
  var taxPct = parseFloat((document.getElementById('inv-dr-tax') || {}).value) || 0;
  var discount = Math.min(Math.round((parseFloat((document.getElementById('inv-dr-discount') || {}).value) || 0) * 100), subtotal);
  var tax = Math.round((subtotal - discount) * taxPct / 100);
  invDrSet('inv-dr-subtotal', invFmtC(subtotal, cur));
  invDrSet('inv-dr-tax-amt', taxPct ? invFmtC(tax, cur) : '—');
  invDrSet('inv-dr-disc-amt', discount ? '−' + invFmtC(discount, cur) : '—');
  invDrSet('inv-dr-total', invFmtC(subtotal - discount + tax, cur));
}
window.invDrTotals = invDrTotals;

function invDrPayload() {
  return {
    id: _invEditing || ('inv' + Date.now().toString(36)),
    updatedAt: _invEditing && invById(_invEditing) ? invById(_invEditing).updatedAt : undefined,
    client: {
      name: invDrVal('inv-dr-bill-name'),
      email: invDrVal('inv-dr-bill-email'),
      company: invDrVal('inv-dr-bill-company'),
      address: invDrVal('inv-dr-bill-address'),
    },
    currency: invDrVal('inv-dr-currency') || 'USD',
    issueDate: invDrVal('inv-dr-issue'),
    dueDate: invDrVal('inv-dr-due'),
    terms: invDrVal('inv-dr-terms'),
    poNumber: invDrVal('inv-dr-po'),
    memo: invDrVal('inv-dr-memo'),
    payUrl: invDrVal('inv-dr-payurl'),
    items: _invLines.filter(function(l) { return (l.desc || '').trim() || (+l.unit || 0) > 0; })
      .map(function(l) { return { desc: l.desc, qty: +l.qty || 0, unitC: Math.round((+l.unit || 0) * 100) }; }),
    taxRateBps: Math.round((parseFloat(invDrVal('inv-dr-tax')) || 0) * 100),
    discountC: Math.round((parseFloat(invDrVal('inv-dr-discount')) || 0) * 100),
  };
}

async function invoiceSaveDraft(thenFinalize) {
  var payload = invDrPayload();
  if (!payload.client.name) { showToast('Add a client name.'); return; }
  var btn = document.getElementById(thenFinalize ? 'inv-dr-finalize' : 'inv-dr-save');
  if (btn) btn.disabled = true;
  var r = await invFetch('POST', '/invoice/save', payload);
  if (btn) btn.disabled = false;
  if (r.status === 409) { showToast(r.data.message || 'This draft changed elsewhere — reload.'); return; }
  if (r.status !== 200 || !r.data.invoice) { showToast('Could not save draft.'); return; }
  invMerge(r.data.invoice);
  _invEditing = r.data.invoice.id;
  if (thenFinalize) {
    var f = await invFetch('POST', '/invoice/finalize', { id: r.data.invoice.id });
    if (f.status === 200 && f.data.invoice) {
      invMerge(f.data.invoice);
      _invSel = f.data.invoice.id;
      closeInvoiceDrawer();
      invRenderPanel(); renderInvoiceTable();
      showToast('Invoice ' + f.data.invoice.number + ' finalized — copy the payment link to send it.');
    } else {
      showToast((f.data && f.data.message) || 'Saved as draft — could not finalize.');
    }
  } else {
    _invSel = r.data.invoice.id;
    closeInvoiceDrawer();
    invRenderPanel(); renderInvoiceTable();
    showToast('Draft saved.');
  }
}
window.invoiceSaveDraft = invoiceSaveDraft;

// ── Lead picker (reuses CRM data) ─────────────────────────────────────────────

function invPickLead() {
  var host = document.getElementById('inv-lead-picker');
  if (!host) return;
  host.classList.add('open');
  invFilterLeads('');
  var s = document.getElementById('inv-lead-search');
  if (s) { s.value = ''; s.focus(); }
}
window.invPickLead = invPickLead;

function invCloseLeadPicker() {
  var host = document.getElementById('inv-lead-picker');
  if (host) host.classList.remove('open');
}
window.invCloseLeadPicker = invCloseLeadPicker;

function invFilterLeads(q) {
  var host = document.getElementById('inv-lead-pick-list');
  if (!host) return;
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  q = (q || '').toLowerCase();
  var rows = contacts.filter(function(c) {
    return !q || (c.name || '').toLowerCase().indexOf(q) !== -1 || (c.email || '').toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
  host.innerHTML = rows.map(function(c) {
    return '<div class="inv-lead-row" onclick="invSelectLead(\'' + c.id + '\')">' +
      '<div style="font-weight:600;font-size:12.5px;">' + invEsc(c.name || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--text-m);">' + invEsc(c.email || '') + '</div></div>';
  }).join('') || '<div style="padding:14px;font-size:12px;color:var(--text-m);">No matching leads.</div>';
}
window.invFilterLeads = invFilterLeads;

function invSelectLead(id) {
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var c = contacts.find(function(x) { return x.id === id; });
  if (c) {
    invDrField('inv-dr-bill-name', c.name || '');
    invDrField('inv-dr-bill-email', c.email || '');
  }
  invCloseLeadPicker();
}
window.invSelectLead = invSelectLead;

// ── Document view (interim print — full redesign lands with the PDF phase) ────

async function invDoPrint(id, isPreview) {
  var inv = invById(id);
  if (!inv) return;
  var cfg = await invLoadSettings();
  var b = cfg.billing || {}, p = cfg.profile || {};
  var host = document.getElementById('inv-print-view');
  if (!host) return;
  var c = inv.client || {};
  var st = invStatusOf(inv);
  var sellerLines = [
    b.legalName || p.businessName || '',
    b.address1 || '', b.address2 || '',
    [b.city, b.region, b.postal].filter(Boolean).join(', '),
    b.country || '', b.supportEmail || p.contactEmail || '',
    b.taxId ? 'Tax ID: ' + b.taxId : '',
  ].filter(Boolean);
  var amountLine = st === 'paid'
    ? invFmtC(inv.totalC, inv.currency) + ' ' + (inv.currency || 'USD') + ' paid ' + (inv.paidAt ? new Date(inv.paidAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '')
    : invFmtC(inv.remainingC, inv.currency) + ' ' + (inv.currency || 'USD') + ' due ' + (inv.dueDate ? invFmtDate(inv.dueDate) : '');
  var doc =
    '<div class="ivd">' +
      '<div class="ivd-top"><div><div class="ivd-h1">Invoice' + (isPreview && st === 'draft' ? ' <span class="ivd-draft">DRAFT</span>' : '') + '</div>' +
        '<table class="ivd-meta"><tr><td>Invoice number</td><td>' + invEsc(inv.number || '—') + '</td></tr>' +
        '<tr><td>Date of issue</td><td>' + invFmtDate(inv.issueDate) + '</td></tr>' +
        '<tr><td>Date due</td><td>' + invFmtDate(inv.dueDate) + '</td></tr>' +
        (inv.poNumber ? '<tr><td>PO number</td><td>' + invEsc(inv.poNumber) + '</td></tr>' : '') + '</table></div>' +
        '<div class="ivd-brand">Flowaify</div></div>' +
      '<div class="ivd-cols"><div><div class="ivd-col-h">' + invEsc(sellerLines[0] || 'Your business') + '</div>' +
        sellerLines.slice(1).map(function(l) { return '<div>' + invEsc(l) + '</div>'; }).join('') + '</div>' +
        '<div><div class="ivd-col-h">Bill to</div><div>' + invEsc(c.name || '') + '</div>' +
        (c.company ? '<div>' + invEsc(c.company) + '</div>' : '') +
        (c.address ? '<div>' + invEsc(c.address) + '</div>' : '') +
        (c.email ? '<div>' + invEsc(c.email) + '</div>' : '') + '</div></div>' +
      '<div class="ivd-amount">' + amountLine + '</div>' +
      (inv.payUrl && st !== 'paid' && st !== 'void' ? '<div class="ivd-pay"><a href="' + invEsc(inv.payUrl) + '">Pay online</a></div>' : '') +
      (inv.memo ? '<div class="ivd-memo">' + invEsc(inv.memo) + '</div>' : '') +
      '<table class="ivd-items"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>' +
      (inv.items || []).map(function(it) {
        return '<tr><td>' + invEsc(it.desc) + (it.desc2 ? '<div class="ivd-desc2">' + invEsc(it.desc2) + '</div>' : '') + '</td>' +
          '<td>' + it.qty + '</td><td>' + invFmtC(it.unitC, inv.currency) + '</td><td>' + invFmtC(it.totalC, inv.currency) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ivd-totals">' +
        '<div><span>Subtotal</span><span>' + invFmtC(inv.subtotalC, inv.currency) + '</span></div>' +
        (inv.discountC ? '<div><span>Discount</span><span>−' + invFmtC(inv.discountC, inv.currency) + '</span></div>' : '') +
        (inv.taxC ? '<div><span>Tax (' + (inv.taxRateBps / 100) + '%)</span><span>' + invFmtC(inv.taxC, inv.currency) + '</span></div>' : '') +
        '<div><span>Total</span><span>' + invFmtC(inv.totalC, inv.currency) + '</span></div>' +
        (inv.paidC ? '<div><span>Amount paid</span><span>−' + invFmtC(inv.paidC, inv.currency) + '</span></div>' : '') +
        '<div class="ivd-due"><span>Amount due</span><span>' + invFmtC(inv.remainingC, inv.currency) + ' ' + (inv.currency || 'USD') + '</span></div>' +
      '</div>' +
      '<div class="ivd-foot">' + (inv.terms ? invEsc(inv.terms) + ' · ' : '') +
        (b.supportEmail || p.contactEmail ? 'Questions? ' + invEsc(b.supportEmail || p.contactEmail) : '') + '</div>' +
    '</div>';
  host.innerHTML =
    '<div class="inv-print-bar"><button class="btn-mini btn-mini-ghost" onclick="invClosePrint()">Close</button>' +
    '<button class="btn-mini btn-mini-primary" onclick="invPrintNow()"><i data-lucide="printer"></i>' + (isPreview ? 'Print preview' : 'Download / Print') + '</button></div>' +
    '<div>' + doc + '</div>';
  host.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.invDoPrint = invDoPrint;

function invClosePrint() {
  var host = document.getElementById('inv-print-view');
  if (host) host.classList.remove('open');
  document.body.classList.remove('printing-invoice');
}
window.invClosePrint = invClosePrint;

function invPrintNow() {
  document.body.classList.add('printing-invoice');
  window.print();
  setTimeout(function() { document.body.classList.remove('printing-invoice'); }, 400);
}
window.invPrintNow = invPrintNow;

// ── Small DOM helpers ─────────────────────────────────────────────────────────

function invDrSet(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function invDrField(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
function invDrVal(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
