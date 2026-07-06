// Invoice module — Flowaify dashboard v1

var _invWorker = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';
var _invList   = [];
var _invLines  = [{ description: '', qty: 1, unitPrice: 0 }];
var _invEditing = null; // invoice id being edited, null = new

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

// ── Init ──────────────────────────────────────────────────────────────────────

async function invoicesInit() {
  renderInvoiceKPIs([]);
  var tbody = document.getElementById('inv-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px 16px;color:var(--text-m);font-size:12.5px;">Loading…</td></tr>';
  var r = await invFetch('GET', '/invoice/list');
  if (r.status === 200 && r.data && r.data.invoices) {
    _invList = r.data.invoices;
  } else {
    _invList = [];
  }
  renderInvoiceKPIs(_invList);
  renderInvoiceList(_invList);
}
window.invoicesInit = invoicesInit;

// ── KPIs ──────────────────────────────────────────────────────────────────────

function renderInvoiceKPIs(list) {
  var total = 0, outstanding = 0, drafts = 0;
  list.forEach(function(inv) {
    if (inv.status !== 'draft') total += (inv.total || 0);
    if (inv.status === 'sent' || inv.status === 'overdue') outstanding += (inv.total || 0);
    if (inv.status === 'draft') drafts++;
  });
  invSetText('inv-kpi-total', invFmt(total));
  invSetText('inv-kpi-outstanding', invFmt(outstanding));
  invSetText('inv-kpi-drafts', drafts);
}

// ── List ──────────────────────────────────────────────────────────────────────

function renderInvoiceList(list) {
  var q = ((document.getElementById('inv-search') || {}).value || '').toLowerCase().trim();
  var f = ((document.getElementById('inv-filter') || {}).value || 'all');
  var shown = list.filter(function(inv) {
    if (f !== 'all' && inv.status !== f) return false;
    if (q) {
      var name = ((inv.billTo || {}).name || '').toLowerCase();
      var num  = (inv.number || '').toLowerCase();
      return name.indexOf(q) !== -1 || num.indexOf(q) !== -1;
    }
    return true;
  });
  var tbody = document.getElementById('inv-tbody');
  if (!tbody) return;
  if (!shown.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="table-empty-overlay"><i data-lucide="file-text"></i><div class="empty-state-title">No invoices yet</div><div class="empty-state-sub">Create your first invoice with the button above.</div></div></td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  tbody.innerHTML = shown.map(function(inv) {
    var name = invEsc((inv.billTo || {}).name || '—');
    var num  = invEsc(inv.number || '—');
    var amt  = invFmt(inv.total || 0);
    var date = inv.issueDate ? inv.issueDate.slice(0, 10) : '—';
    return '<tr onclick="selectInvoice(\'' + invEsc(inv.id) + '\')" style="cursor:pointer;">' +
      '<td style="font-size:12.5px;font-weight:600;color:var(--text);">' + num + '</td>' +
      '<td>' + name + '</td>' +
      '<td style="font-variant-numeric:tabular-nums;font-weight:600;">' + amt + '</td>' +
      '<td>' + invStatusBadge(inv.status) + '</td>' +
      '<td style="font-size:11.5px;color:var(--text-m);">' + date + '</td>' +
      '</tr>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderInvoiceList = renderInvoiceList;

function invFilterList() { renderInvoiceList(_invList); }
window.invFilterList = invFilterList;

// ── Detail panel ──────────────────────────────────────────────────────────────

function selectInvoice(id) {
  var inv = _invList.find(function(x) { return x.id === id; });
  var panel = document.getElementById('inv-detail-panel');
  if (!panel) return;
  // Highlight row
  document.querySelectorAll('#inv-tbody tr').forEach(function(r) { r.classList.remove('row-selected'); });
  var rows = document.querySelectorAll('#inv-tbody tr');
  rows.forEach(function(r) { if (r.onclick && r.onclick.toString().indexOf(id) !== -1) r.classList.add('row-selected'); });
  if (!inv) { panel.innerHTML = invDetailEmpty(); return; }

  var bt = inv.billTo || {};
  var lines = inv.lines || [];
  var linesHtml = lines.map(function(l) {
    return '<tr><td style="font-size:12.5px;color:var(--text-s);">' + invEsc(l.description || '—') + '</td>' +
      '<td style="text-align:right;font-size:12.5px;color:var(--text-m);">' + (l.qty || 1) + '</td>' +
      '<td style="text-align:right;font-size:12.5px;color:var(--text-m);">' + invFmt(l.unitPrice || 0) + '</td>' +
      '<td style="text-align:right;font-size:12.5px;font-weight:600;">' + invFmt(l.total || 0) + '</td></tr>';
  }).join('');

  panel.innerHTML =
    '<div class="inv-det-head">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--text);">' + invEsc(inv.number || '—') + '</div>' +
        '<div style="margin-top:4px;">' + invStatusBadge(inv.status) + '</div>' +
      '</div>' +
      '<div class="inv-det-acts">' +
        '<button class="btn-mini btn-mini-ghost" onclick="openEditInvoice(\'' + id + '\')"><i data-lucide="pencil"></i>Edit</button>' +
        '<button class="btn-mini btn-mini-ghost" onclick="invPrintById(\'' + id + '\')"><i data-lucide="printer"></i>Print</button>' +
        (inv.status === 'draft' || inv.status === 'sent' ?
          '<button class="btn-mini btn-mini-primary" onclick="invMarkSent(\'' + id + '\')">' + (inv.status === 'draft' ? 'Mark Sent' : 'Mark Paid') + '</button>' : '') +
        '<button class="btn-mini btn-mini-ghost inv-del-btn" onclick="deleteInvoice(\'' + id + '\')" title="Delete"><i data-lucide="trash-2"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="inv-det-body">' +
      '<div class="inv-det-section">' +
        '<div class="inv-det-label">Bill To</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);">' + invEsc(bt.name || '—') + '</div>' +
        (bt.company ? '<div style="font-size:11.5px;color:var(--text-m);">' + invEsc(bt.company) + '</div>' : '') +
        (bt.email ? '<div style="font-size:11.5px;color:var(--text-m);">' + invEsc(bt.email) + '</div>' : '') +
      '</div>' +
      '<div class="inv-det-section">' +
        '<div class="inv-det-row"><span class="inv-det-label">Issue date</span><span>' + (inv.issueDate || '—') + '</span></div>' +
        '<div class="inv-det-row"><span class="inv-det-label">Due date</span><span>' + (inv.dueDate || '—') + '</span></div>' +
      '</div>' +
      (lines.length ? '<table class="skel-table" style="margin-top:4px;">' +
        '<thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>' +
        '<tbody>' + linesHtml + '</tbody></table>' : '') +
      '<div class="inv-det-totals">' +
        '<div class="inv-det-total-row"><span>Subtotal</span><span>' + invFmt(inv.subtotal || 0) + '</span></div>' +
        (inv.taxRate ? '<div class="inv-det-total-row"><span>Tax (' + inv.taxRate + '%)</span><span>' + invFmt((inv.subtotal || 0) * (inv.taxRate / 100)) + '</span></div>' : '') +
        (inv.discount ? '<div class="inv-det-total-row"><span>Discount</span><span>−' + invFmt(inv.discount) + '</span></div>' : '') +
        '<div class="inv-det-total-row inv-grand-total"><span>Total</span><span>' + invFmt(inv.total || 0) + '</span></div>' +
      '</div>' +
      (inv.notes ? '<div class="inv-det-section"><div class="inv-det-label">Notes</div><div style="font-size:12px;color:var(--text-s);line-height:1.5;">' + invEsc(inv.notes) + '</div></div>' : '') +
    '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.selectInvoice = selectInvoice;

function invDetailEmpty() {
  return '<div class="empty-state" style="padding:60px 20px;">' +
    '<i data-lucide="file-text"></i>' +
    '<div class="empty-state-title">Select an invoice</div>' +
    '<div class="empty-state-sub">Click any invoice to preview details here.</div>' +
    '</div>';
}

// ── Drawer: open / close ──────────────────────────────────────────────────────

function openNewInvoice(lead) {
  _invEditing = null;
  _invLines = [{ description: '', qty: 1, unitPrice: 0 }];
  invDrSetField('inv-dr-num', invAutoNumber(_invList));
  invDrSetField('inv-dr-issue', new Date().toISOString().slice(0, 10));
  invDrSetField('inv-dr-due', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  invDrSetField('inv-dr-bill-name', lead ? (lead.name || '') : '');
  invDrSetField('inv-dr-bill-email', lead ? (lead.email || '') : '');
  invDrSetField('inv-dr-bill-company', '');
  invDrSetField('inv-dr-tax', '');
  invDrSetField('inv-dr-discount', '');
  invDrSetField('inv-dr-notes', '');
  invRenderLines();
  document.getElementById('inv-dr-title').textContent = 'New Invoice';
  invOpenDrawer();
  // Load business info from settings
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    var biz = saved.biz || {};
    invSetText('inv-biz-name', biz['s2-biz-name'] || '—');
    invSetText('inv-biz-email', biz['s2-email'] || '—');
  } catch (e) {}
}
window.openNewInvoice = openNewInvoice;

function openEditInvoice(id) {
  var inv = _invList.find(function(x) { return x.id === id; });
  if (!inv) return;
  _invEditing = id;
  _invLines = (inv.lines || [{ description: '', qty: 1, unitPrice: 0 }]).map(function(l) {
    return { description: l.description || '', qty: l.qty || 1, unitPrice: l.unitPrice || 0 };
  });
  var bt = inv.billTo || {};
  invDrSetField('inv-dr-num', inv.number || '');
  invDrSetField('inv-dr-issue', inv.issueDate || '');
  invDrSetField('inv-dr-due', inv.dueDate || '');
  invDrSetField('inv-dr-bill-name', bt.name || '');
  invDrSetField('inv-dr-bill-email', bt.email || '');
  invDrSetField('inv-dr-bill-company', bt.company || '');
  invDrSetField('inv-dr-tax', inv.taxRate || '');
  invDrSetField('inv-dr-discount', inv.discount || '');
  invDrSetField('inv-dr-notes', inv.notes || '');
  invRenderLines();
  document.getElementById('inv-dr-title').textContent = 'Edit Invoice';
  invOpenDrawer();
}
window.openEditInvoice = openEditInvoice;

function invOpenDrawer() {
  document.getElementById('inv-drawer').classList.add('open');
  document.getElementById('inv-drawer-overlay').classList.add('open');
  invoiceCalcTotals();
}

function closeInvoiceDrawer() {
  document.getElementById('inv-drawer').classList.remove('open');
  document.getElementById('inv-drawer-overlay').classList.remove('open');
}
window.closeInvoiceDrawer = closeInvoiceDrawer;

// ── Line items ────────────────────────────────────────────────────────────────

function invRenderLines() {
  var wrap = document.getElementById('inv-lines-wrap');
  if (!wrap) return;
  wrap.innerHTML = _invLines.map(function(l, i) {
    return '<div class="inv-line" id="inv-line-' + i + '">' +
      '<input class="inv-line-desc" placeholder="Description" value="' + invEsc(l.description) + '" oninput="invLineChange(' + i + ',\'description\',this.value)" />' +
      '<input class="inv-line-qty" type="number" min="1" value="' + (l.qty || 1) + '" oninput="invLineChange(' + i + ',\'qty\',this.value)" />' +
      '<input class="inv-line-price" type="number" min="0" step="0.01" placeholder="0.00" value="' + (l.unitPrice || '') + '" oninput="invLineChange(' + i + ',\'unitPrice\',this.value)" />' +
      '<div class="inv-line-total">' + invFmt((l.qty || 1) * (l.unitPrice || 0)) + '</div>' +
      '<button class="inv-line-del" onclick="invoiceRemoveLine(' + i + ')" title="Remove"' + (_invLines.length === 1 ? ' disabled' : '') + '><i data-lucide="x"></i></button>' +
    '</div>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invLineChange(idx, field, val) {
  if (!_invLines[idx]) return;
  if (field === 'qty' || field === 'unitPrice') {
    _invLines[idx][field] = parseFloat(val) || 0;
  } else {
    _invLines[idx][field] = val;
  }
  invoiceCalcTotals();
  // Update line total display
  var totEl = document.querySelector('#inv-line-' + idx + ' .inv-line-total');
  if (totEl) totEl.textContent = invFmt((_invLines[idx].qty || 1) * (_invLines[idx].unitPrice || 0));
}
window.invLineChange = invLineChange;

function invoiceAddLine() {
  _invLines.push({ description: '', qty: 1, unitPrice: 0 });
  invRenderLines();
  invoiceCalcTotals();
  // Focus new line desc
  setTimeout(function() {
    var lines = document.querySelectorAll('.inv-line-desc');
    if (lines.length) lines[lines.length - 1].focus();
  }, 50);
}
window.invoiceAddLine = invoiceAddLine;

function invoiceRemoveLine(idx) {
  if (_invLines.length === 1) return;
  _invLines.splice(idx, 1);
  invRenderLines();
  invoiceCalcTotals();
}
window.invoiceRemoveLine = invoiceRemoveLine;

function invoiceCalcTotals() {
  var subtotal = 0;
  _invLines.forEach(function(l) { subtotal += (l.qty || 1) * (l.unitPrice || 0); });
  var taxRate  = parseFloat((document.getElementById('inv-dr-tax') || {}).value) || 0;
  var discount = parseFloat((document.getElementById('inv-dr-discount') || {}).value) || 0;
  var tax      = subtotal * (taxRate / 100);
  var total    = Math.max(0, subtotal + tax - discount);
  invSetText('inv-dr-subtotal', invFmt(subtotal));
  invSetText('inv-dr-tax-amt', taxRate ? invFmt(tax) : '—');
  invSetText('inv-dr-disc-amt', discount ? '−' + invFmt(discount) : '—');
  invSetText('inv-dr-total', invFmt(total));
}
window.invoiceCalcTotals = invoiceCalcTotals;

// ── Save ──────────────────────────────────────────────────────────────────────

async function invoiceSave(status) {
  status = status || 'draft';
  var subtotal = 0;
  _invLines.forEach(function(l) { subtotal += (l.qty || 1) * (l.unitPrice || 0); });
  var taxRate  = parseFloat((document.getElementById('inv-dr-tax') || {}).value) || 0;
  var discount = parseFloat((document.getElementById('inv-dr-discount') || {}).value) || 0;
  var total    = Math.max(0, subtotal + taxRate / 100 * subtotal - discount);

  var inv = {
    id:         _invEditing || ('inv_' + Date.now()),
    number:     (document.getElementById('inv-dr-num') || {}).value || invAutoNumber(_invList),
    billTo: {
      name:    (document.getElementById('inv-dr-bill-name') || {}).value || '',
      email:   (document.getElementById('inv-dr-bill-email') || {}).value || '',
      company: (document.getElementById('inv-dr-bill-company') || {}).value || '',
    },
    lines:      _invLines.map(function(l) {
      return { description: l.description, qty: l.qty || 1, unitPrice: l.unitPrice || 0, total: (l.qty || 1) * (l.unitPrice || 0) };
    }),
    subtotal:   subtotal,
    taxRate:    taxRate,
    discount:   discount,
    total:      total,
    status:     status,
    issueDate:  (document.getElementById('inv-dr-issue') || {}).value || new Date().toISOString().slice(0, 10),
    dueDate:    (document.getElementById('inv-dr-due') || {}).value || '',
    notes:      (document.getElementById('inv-dr-notes') || {}).value || '',
    createdAt:  _invEditing ? (_invList.find(function(x) { return x.id === _invEditing; }) || {}).createdAt || Date.now() : Date.now(),
  };

  var btn = document.getElementById('inv-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  var r = await invFetch('POST', '/invoice/save', inv);
  if (btn) { btn.disabled = false; btn.textContent = 'Save Draft'; }

  if (r.status === 200 && r.data && r.data.invoice) {
    var saved = r.data.invoice;
    var idx = _invList.findIndex(function(x) { return x.id === saved.id; });
    if (idx !== -1) _invList[idx] = saved; else _invList.unshift(saved);
    renderInvoiceKPIs(_invList);
    renderInvoiceList(_invList);
    closeInvoiceDrawer();
    selectInvoice(saved.id);
    if (typeof showToast === 'function') showToast('Invoice saved.');
  } else {
    if (typeof showToast === 'function') showToast('Could not save — try again.');
  }
}
window.invoiceSave = invoiceSave;

async function invMarkSent(id) {
  var inv = _invList.find(function(x) { return x.id === id; });
  if (!inv) return;
  var newStatus = inv.status === 'draft' ? 'sent' : 'paid';
  var updated = Object.assign({}, inv, { status: newStatus });
  var r = await invFetch('POST', '/invoice/save', updated);
  if (r.status === 200 && r.data && r.data.invoice) {
    var idx = _invList.findIndex(function(x) { return x.id === id; });
    if (idx !== -1) _invList[idx] = r.data.invoice;
    renderInvoiceKPIs(_invList);
    renderInvoiceList(_invList);
    selectInvoice(id);
    if (typeof showToast === 'function') showToast('Status updated.');
  }
}
window.invMarkSent = invMarkSent;

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  var r = await invFetch('DELETE', '/invoice/' + id);
  if (r.status === 200) {
    _invList = _invList.filter(function(x) { return x.id !== id; });
    renderInvoiceKPIs(_invList);
    renderInvoiceList(_invList);
    var panel = document.getElementById('inv-detail-panel');
    if (panel) panel.innerHTML = invDetailEmpty();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (typeof showToast === 'function') showToast('Invoice deleted.');
  }
}
window.deleteInvoice = deleteInvoice;

// ── Print ─────────────────────────────────────────────────────────────────────

function invPrintById(id) {
  var inv = _invList.find(function(x) { return x.id === id; });
  if (inv) invRenderPrint(inv);
}
window.invPrintById = invPrintById;

function invPrintCurrent() {
  // Print invoice from drawer (unsaved state)
  var subtotal = 0;
  _invLines.forEach(function(l) { subtotal += (l.qty || 1) * (l.unitPrice || 0); });
  var taxRate  = parseFloat((document.getElementById('inv-dr-tax') || {}).value) || 0;
  var discount = parseFloat((document.getElementById('inv-dr-discount') || {}).value) || 0;
  var total    = Math.max(0, subtotal + taxRate / 100 * subtotal - discount);
  var inv = {
    number:   (document.getElementById('inv-dr-num') || {}).value || '—',
    billTo:   {
      name:    (document.getElementById('inv-dr-bill-name') || {}).value || '',
      email:   (document.getElementById('inv-dr-bill-email') || {}).value || '',
      company: (document.getElementById('inv-dr-bill-company') || {}).value || '',
    },
    lines:    _invLines.map(function(l) { return { description: l.description, qty: l.qty || 1, unitPrice: l.unitPrice || 0, total: (l.qty || 1) * (l.unitPrice || 0) }; }),
    subtotal: subtotal, taxRate: taxRate, discount: discount, total: total,
    issueDate: (document.getElementById('inv-dr-issue') || {}).value || '',
    dueDate:   (document.getElementById('inv-dr-due') || {}).value || '',
    notes:     (document.getElementById('inv-dr-notes') || {}).value || '',
    status:    'draft',
  };
  invRenderPrint(inv);
}
window.invPrintCurrent = invPrintCurrent;

function invRenderPrint(inv) {
  var biz = {};
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    biz = saved.biz || {};
  } catch (e) {}
  var bizName  = biz['s2-biz-name'] || 'Your Business';
  var bizEmail = biz['s2-email'] || '';
  var bt = inv.billTo || {};
  var lines = inv.lines || [];

  var linesHtml = lines.map(function(l) {
    return '<tr>' +
      '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">' + invEsc(l.description || '—') + '</td>' +
      '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">' + (l.qty || 1) + '</td>' +
      '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">' + invFmt(l.unitPrice || 0) + '</td>' +
      '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#111827;">' + invFmt(l.total || 0) + '</td>' +
    '</tr>';
  }).join('');

  var tax      = (inv.subtotal || 0) * ((inv.taxRate || 0) / 100);
  var discount = inv.discount || 0;

  var view = document.getElementById('inv-print-view');
  if (!view) return;
  view.innerHTML =
    '<div class="ipv-bar">' +
      '<span style="font-size:13px;font-weight:600;color:#111827;flex:1;">Invoice ' + invEsc(inv.number || '') + '</span>' +
      '<button class="rpo-print" onclick="window.print()"><i data-lucide="printer"></i>Print / Save PDF</button>' +
      '<button class="rpo-close" onclick="closeInvPrint()">Close</button>' +
    '</div>' +
    '<div class="ipv-page">' +
      '<div class="ipv-header">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:700;color:#0050e6;letter-spacing:0.3px;">' + invEsc(bizName) + '</div>' +
          (bizEmail ? '<div style="font-size:12px;color:#6b7280;margin-top:2px;">' + invEsc(bizEmail) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:28px;font-weight:800;color:#111827;letter-spacing:-0.5px;">INVOICE</div>' +
          '<div style="font-size:13px;color:#6b7280;margin-top:4px;">' + invEsc(inv.number || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ipv-parties">' +
        '<div>' +
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9ca3af;margin-bottom:6px;">Bill To</div>' +
          '<div style="font-size:13px;font-weight:700;color:#111827;">' + invEsc(bt.name || '—') + '</div>' +
          (bt.company ? '<div style="font-size:12px;color:#6b7280;">' + invEsc(bt.company) + '</div>' : '') +
          (bt.email ? '<div style="font-size:12px;color:#6b7280;">' + invEsc(bt.email) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div class="ipv-date-row"><span style="color:#9ca3af;">Issue Date</span><span>' + (inv.issueDate || '—') + '</span></div>' +
          '<div class="ipv-date-row"><span style="color:#9ca3af;">Due Date</span><span style="font-weight:600;">' + (inv.dueDate || '—') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:24px;">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Description</th>' +
          '<th style="text-align:right;padding:8px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Qty</th>' +
          '<th style="text-align:right;padding:8px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Unit Price</th>' +
          '<th style="text-align:right;padding:8px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;">Total</th>' +
        '</tr></thead>' +
        '<tbody>' + linesHtml + '</tbody>' +
      '</table>' +
      '<div class="ipv-totals">' +
        '<div class="ipv-total-row"><span>Subtotal</span><span>' + invFmt(inv.subtotal || 0) + '</span></div>' +
        (inv.taxRate ? '<div class="ipv-total-row"><span>Tax (' + inv.taxRate + '%)</span><span>' + invFmt(tax) + '</span></div>' : '') +
        (discount ? '<div class="ipv-total-row"><span>Discount</span><span>−' + invFmt(discount) + '</span></div>' : '') +
        '<div class="ipv-total-row ipv-grand"><span>Total Due</span><span>' + invFmt(inv.total || 0) + '</span></div>' +
      '</div>' +
      (inv.notes ? '<div class="ipv-notes"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9ca3af;margin-bottom:6px;">Notes</div><div style="font-size:12px;color:#6b7280;line-height:1.6;">' + invEsc(inv.notes) + '</div></div>' : '') +
      '<div class="ipv-footer">Generated via Flowaify · Payment due ' + (inv.dueDate || '—') + '</div>' +
    '</div>';

  view.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeInvPrint() {
  var view = document.getElementById('inv-print-view');
  if (view) view.classList.remove('open');
}
window.closeInvPrint = closeInvPrint;

// ── Lead picker in drawer ─────────────────────────────────────────────────────

function invPickLead() {
  var q = document.getElementById('inv-lead-search');
  if (q) q.value = '';
  invFilterLeads('');
  document.getElementById('inv-lead-picker').classList.add('open');
  if (q) setTimeout(function() { q.focus(); }, 100);
}
window.invPickLead = invPickLead;

function invCloseLeadPicker() {
  document.getElementById('inv-lead-picker').classList.remove('open');
}
window.invCloseLeadPicker = invCloseLeadPicker;

function invFilterLeads(q) {
  var list = document.getElementById('inv-lead-pick-list');
  if (!list) return;
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var results = q
    ? contacts.filter(function(c) { return (c.name || '').toLowerCase().indexOf(q.toLowerCase()) !== -1 || (c.email || '').toLowerCase().indexOf(q.toLowerCase()) !== -1; })
    : contacts;
  results = results.slice(0, 20);
  if (!results.length) {
    list.innerHTML = '<div style="padding:20px 16px;text-align:center;font-size:12.5px;color:var(--text-m);">No leads found</div>';
    return;
  }
  list.innerHTML = results.map(function(c) {
    return '<div class="teams-lead-pick-item" onclick="invSelectLead(\'' + invEsc(String(c.id).replace(/[^\w-]/g, '')) + '\')">' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="teams-lead-pick-name">' + invEsc(c.name || '—') + '</div>' +
        '<div class="teams-lead-pick-meta">' + invEsc(c.email || '') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
window.invFilterLeads = invFilterLeads;

function invSelectLead(id) {
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var c = contacts.find(function(x) { return String(x.id).replace(/[^\w-]/g, '') === id; });
  if (!c) return;
  invDrSetField('inv-dr-bill-name', c.name || '');
  invDrSetField('inv-dr-bill-email', c.email || '');
  invCloseLeadPicker();
}
window.invSelectLead = invSelectLead;

// ── Utilities ─────────────────────────────────────────────────────────────────

function invAutoNumber(list) {
  var max = 0;
  list.forEach(function(inv) {
    var m = String(inv.number || '').match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'INV-' + String(max + 1).padStart(3, '0');
}

function invStatusBadge(status) {
  var map = {
    draft:   'state-pill awaiting',
    sent:    'state-pill pending',
    paid:    'state-pill live',
    overdue: 'state-pill dead',
  };
  var cls = map[status] || 'state-pill awaiting';
  var label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Draft';
  return '<span class="' + cls + '"><span class="sp-dot"></span>' + label + '</span>';
}

function invFmt(n) {
  if (isNaN(n) || n === null) return '$0.00';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function invEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function invSetText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function invDrSetField(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = val;
  else el.textContent = val;
}
