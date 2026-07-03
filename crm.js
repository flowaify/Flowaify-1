const WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

/* ── State ──────────────────────────────────────────────────────────────────── */
window.__crmData        = null;
window.__rangeDays      = 30;
window.__selectedLeadId = null;
window.__leadFilters    = { q: '', status: '', source: '' };

/* ── Data loading ───────────────────────────────────────────────────────────── */
async function loadDashboardData(token) {
  try {
    const authHeader = 'Bearer ' + token;
    const res = await fetch(WORKER + '/data', {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) {
      console.warn('Worker responded', res.status, await res.text());
      return;
    }
    window.__crmData = await res.json();
    rerender();
  } catch (err) {
    console.warn('CRM load failed:', err.message);
  }
}

async function refreshData() {
  const btn = document.getElementById('btn-refresh');
  const icon = btn ? btn.querySelector('i, svg') : null;
  if (icon) icon.classList.add('spinning');
  try {
    const claims = await auth0Client.getIdTokenClaims();
    if (claims && claims.__raw) await loadDashboardData(claims.__raw);
    if (typeof showToast === 'function') showToast('Dashboard refreshed with the latest CRM data.');
  } catch (e) {
    console.warn('Refresh failed:', e.message);
  }
  const icon2 = btn ? btn.querySelector('i, svg') : null;
  if (icon2) icon2.classList.remove('spinning');
}

/* ── Utilities ──────────────────────────────────────────────────────────────── */
const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function setText(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = val != null ? String(val) : '—';
  const m = target.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!m || REDUCED_MOTION) { el.textContent = target; el._num = m ? parseFloat(m[2].replace(/,/g, '')) : null; return; }

  const end = parseFloat(m[2].replace(/,/g, ''));
  if (!isFinite(end)) { el.textContent = target; return; }
  const useCommas = m[2].indexOf(',') !== -1 || Math.abs(end) >= 1000;
  const decimals = (m[2].split('.')[1] || '').length;
  const start = typeof el._num === 'number' && isFinite(el._num) ? el._num : 0;
  el._num = end;
  if (start === end) { el.textContent = target; return; }

  if (el._raf) cancelAnimationFrame(el._raf);
  const t0 = performance.now(), dur = 600;
  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const cur = start + (end - start) * eased;
    const num = decimals > 0 ? cur.toFixed(decimals) : Math.round(cur);
    el.textContent = m[1] + (useCommas ? Number(num).toLocaleString() : num) + m[3];
    if (p < 1) el._raf = requestAnimationFrame(frame);
    else { el.textContent = target; el._raf = null; }
  }
  el._raf = requestAnimationFrame(frame);
}

function sparkline(id, series, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!series || series.length < 2 || series.every(function(v) { return v === 0; })) {
    el.innerHTML = '';
    return;
  }
  const w = 64, h = 22, pad = 2;
  const max = Math.max.apply(null, series), min = Math.min.apply(null, series);
  const span = (max - min) || 1;
  const pts = series.map(function(v, i) {
    const x = (i / (series.length - 1)) * (w - 2) + 1;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  el.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (color || '#0057FF') + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
}

function escDash(val) {
  if (val == null || val === '') return '—';
  return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtMoney(v) {
  return v != null ? '$' + Number(v).toLocaleString() : '—';
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)    return 'just now';
  if (m < 60)   return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24)   return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7)    return d + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusBadge(status) {
  if (!status || !String(status).trim()) return '<span style="color:rgba(15,23,42,0.30);">—</span>';
  const s = String(status).toUpperCase();
  let cls = 'b-muted';
  if (s.indexOf('HOT') !== -1)         cls = 'b-high';
  else if (s.indexOf('WARM') !== -1)   cls = 'b-med';
  else if (s.indexOf('BOOK') !== -1)   cls = 'b-conn';
  else if (s.indexOf('COLD') !== -1)   cls = 'b-low';
  return '<span class="badge ' + cls + '">' + escDash(status) + '</span>';
}

/* ── Range helpers ──────────────────────────────────────────────────────────── */
function filterByRange(contacts, days) {
  const cutoff = Date.now() - days * 86400000;
  return contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() >= cutoff;
  });
}

function prevWindowCount(contacts, days) {
  const now = Date.now();
  const start = now - 2 * days * 86400000;
  const end   = now - days * 86400000;
  return contacts.filter(function(c) {
    if (!c.createdAt) return false;
    const t = new Date(c.createdAt).getTime();
    return t >= start && t < end;
  }).length;
}

function setDelta(id, cur, prev, label) {
  const el = document.getElementById(id);
  if (!el) return;
  if (prev === 0 && cur === 0) { el.innerHTML = ''; return; }
  if (prev === 0) {
    el.innerHTML = '<span class="stat-delta delta-up">↑ ' + cur + ' new ' + label + '</span>';
    return;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) { el.innerHTML = '<span class="stat-delta delta-flat">— flat ' + label + '</span>'; return; }
  const up = pct > 0;
  el.innerHTML = '<span class="stat-delta ' + (up ? 'delta-up' : 'delta-down') + '">' +
    (up ? '↑ ' : '↓ ') + Math.abs(pct) + '% ' + label + '</span>';
}

function setAwaitPill(id, isLive) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = isLive
    ? '<span class="dot-live" title="Live"></span>'
    : '<span class="dot-await" title="Awaiting automation data"></span>';
  // Swap the hint line if this stat has one (hint id mirrors the await id)
  const hint = document.getElementById(id.replace('await-', 'hint-'));
  if (hint) {
    const liveText = hint.getAttribute('data-live');
    hint.textContent = isLive && liveText ? liveText : 'Awaiting automation';
  }
}

/* ── Chart helpers ──────────────────────────────────────────────────────────── */
const PALETTE = ['#0057FF','#0f172a','#64748b','#94a3b8','#3b82f6','#475569','#cbd5e1','#1e293b'];

function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === 'undefined') return null;
  const existing = Chart.getChart(el);
  if (existing) existing.destroy();
  return new Chart(el, cfg);
}

function chartOverlay(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  if (show && typeof Chart !== 'undefined') {
    const existing = Chart.getChart(el);
    if (existing) existing.destroy();
  }
  const wrap = el.closest('.chart-wrap');
  if (!wrap) return;
  const ov = wrap.querySelector('.chart-empty');
  if (ov) ov.style.display = show ? 'flex' : 'none';
  el.style.opacity = show ? '0' : '1';
}

function renderSourceList(containerId, counts, emptyTitle, emptySub) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const names = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
  if (names.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:50px 20px;">' +
      '<i data-lucide="pie-chart"></i>' +
      '<div class="empty-state-title">' + escDash(emptyTitle) + '</div>' +
      '<div class="empty-state-sub">' + escDash(emptySub) + '</div></div>';
    return;
  }
  const max = counts[names[0]] || 1;
  let total = 0;
  names.forEach(function(n) { total += counts[n]; });
  el.innerHTML = names.map(function(name, i) {
    const n = counts[name];
    const pct = Math.max(3, Math.round((n / max) * 100));
    const color = PALETTE[i % PALETTE.length];
    return '<div class="src-row">' +
      '<div class="src-name" title="' + escDash(name) + '">' + escDash(name) + '</div>' +
      '<div class="src-track"><div class="src-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
      '<div class="src-count">' + n + '</div>' +
      '</div>';
  }).join('') +
  '<div class="src-foot">' + total + ' lead' + (total === 1 ? '' : 's') + ' · ' + names.length + ' source' + (names.length === 1 ? '' : 's') + '</div>';
}

function groupCount(items, keyFn) {
  const out = {};
  items.forEach(function(it) {
    const k = keyFn(it) || 'Unknown';
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

/* Bucket contacts by day (7/30d ranges) or ISO week (90d) */
function timeBuckets(contacts, days) {
  const buckets = {};
  const labels = [];
  const now = new Date();

  if (days <= 30) {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
      labels.push({ key: key, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
    contacts.forEach(function(c) {
      if (!c.createdAt) return;
      const key = new Date(c.createdAt).toISOString().slice(0, 10);
      if (key in buckets) buckets[key]++;
    });
  } else {
    const weeks = Math.ceil(days / 7);
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 7 * 86400000);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      if (!(key in buckets)) {
        buckets[key] = 0;
        labels.push({ key: key, label: 'Wk of ' + monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
      }
    }
    contacts.forEach(function(c) {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      if (key in buckets) buckets[key]++;
    });
  }
  return { labels: labels.map(function(l) { return l.label; }), data: labels.map(function(l) { return buckets[l.key]; }) };
}

/* ── Master rerender ────────────────────────────────────────────────────────── */
function rerender() {
  const data = window.__crmData;
  if (!data) return;
  const days   = window.__rangeDays;
  const ranged = filterByRange(data.contacts, days);

  document.querySelectorAll('.range-label').forEach(function(el) {
    el.textContent = 'Last ' + days + ' days';
  });

  renderOverviewStats(data, ranged, days);
  renderRecentLeadsTable(data.contacts);
  renderNeedsAttention(data.needsAttention);
  renderLeadsStats(data, ranged, days);
  populateLeadFilterOptions(data.contacts);
  applyLeadFilters();
  renderAnalyticsStats(data, ranged, days);
  renderCharts(data, ranged, days);
  renderActivitySections(data, days);
  renderAutomationStats(data);

  // Sparklines — real daily counts, never fake data
  const spark14 = timeBuckets(data.contacts, 14).data;
  const sparkRange = timeBuckets(ranged, Math.min(days, 30)).data;
  sparkline('spark-new-leads',   spark14,    '#0057FF');
  sparkline('spark-leads-total', spark14,    '#0057FF');
  sparkline('spark-an-total',    sparkRange, '#0057FF');

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.rerender = rerender;

function setRange(days) {
  window.__rangeDays = Number(days) || 30;
  rerender();
}

/* Kept for backward compatibility with older callers */
function renderDashboard(data) {
  window.__crmData = data;
  rerender();
}

/* ── Overview ───────────────────────────────────────────────────────────────── */
function renderOverviewStats(data, ranged, days) {
  const overview = data.overview || {};
  const contacts = data.contacts || [];

  setText('val-new-leads',     overview.newLeadsToday);
  setText('val-response-time', overview.avgResponseTimeSecs != null ? overview.avgResponseTimeSecs + 's' : '—');
  setText('val-ai-replies',    overview.aiRepliesSent);
  setText('val-follow-ups',    overview.activeSequences);
  setText('val-pipeline',      fmtMoney(overview.pipelineValue));
  setText('val-booked-calls',  overview.bookedCalls);

  // New-leads delta: today vs yesterday
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const ydayStart = dayStart.getTime() - 86400000;
  const todayCount = contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() >= dayStart.getTime();
  }).length;
  const ydayCount = contacts.filter(function(c) {
    if (!c.createdAt) return false;
    const t = new Date(c.createdAt).getTime();
    return t >= ydayStart && t < dayStart.getTime();
  }).length;
  setDelta('delta-new-leads', todayCount, ydayCount, 'vs yesterday');

  setAwaitPill('await-response', overview.avgResponseTimeSecs != null && overview.avgResponseTimeSecs > 0);
  setAwaitPill('await-ai-replies', (overview.aiRepliesSent || 0) > 0);
  setAwaitPill('await-follow-ups', (overview.activeSequences || 0) > 0);

  const dealsCountEl = document.getElementById('delta-pipeline');
  if (dealsCountEl) {
    const n = (data.deals || []).length;
    dealsCountEl.innerHTML = n > 0 ? '<span class="stat-delta delta-flat">' + n + ' open deal' + (n === 1 ? '' : 's') + '</span>' : '';
  }
}

function renderRecentLeadsTable(contacts) {
  const tbody = document.getElementById('leads-table-body');
  const emptyState = document.getElementById('leads-empty-state');
  if (!tbody) return;
  if (contacts.length > 0) {
    tbody.innerHTML = contacts.slice(0, 10).map(function(c) {
      return '<tr>' +
        '<td><div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div>' +
        (c.email ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.email) + '</div>' : '') +
        (c.phone ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.phone) + '</div>' : '') +
        '</td>' +
        '<td>' + escDash(c.source) + '</td>' +
        '<td>' + statusBadge(c.status) + '</td>' +
        '<td>' + escDash(c.lastTouch) + '</td>' +
        '<td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td>' +
        '</tr>';
    }).join('');
    if (emptyState) emptyState.style.display = 'none';
  } else if (emptyState) {
    emptyState.style.display = 'flex';
  }
}

function renderNeedsAttention(needsAttention) {
  const attnList = document.getElementById('attn-list');
  const attnEmpty = document.getElementById('attn-empty');
  if (!attnList) return;
  if (needsAttention && needsAttention.length > 0) {
    attnList.innerHTML = needsAttention.map(function(c) {
      return '<div class="attn-item">' +
        '<div class="attn-dot" style="background:var(--amber);"></div>' +
        '<div>' +
        '<div class="attn-title">' + escDash(c.name) + '</div>' +
        '<div class="attn-sub">' + escDash(c.status) + ' · No touch in 24h+</div>' +
        '</div></div>';
    }).join('');
    if (attnEmpty) attnEmpty.style.display = 'none';
  } else if (attnEmpty) {
    attnList.innerHTML = '';
    attnEmpty.style.display = 'flex';
  }
}

/* ── Leads page ─────────────────────────────────────────────────────────────── */
function renderLeadsStats(data, ranged, days) {
  const contacts = data.contacts || [];
  const overview = data.overview || {};

  setText('val-total-leads', contacts.length);
  setText('val-leads-new', ranged.length);
  setDelta('delta-leads-new', ranged.length, prevWindowCount(contacts, days), 'vs prior ' + days + 'd');

  const newLabel = document.getElementById('label-leads-new');
  if (newLabel) newLabel.textContent = 'New Leads (' + days + 'd)';

  const qualified = contacts.filter(function(c) { return c.status && String(c.status).trim() !== '' && c.status !== '—'; }).length;
  setText('val-leads-qualified', qualified);
  setText('val-leads-booked', overview.bookedCalls);

  const twoDaysAgo = Date.now() - 48 * 3600000;
  const unresponsive = contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() < twoDaysAgo && !c.lastTouchAt;
  }).length;
  setText('val-leads-unresponsive', unresponsive);
}

function populateLeadFilterOptions(contacts) {
  const statusSel = document.getElementById('filter-status');
  const sourceSel = document.getElementById('filter-source');
  if (statusSel) {
    const cur = statusSel.value;
    const statuses = Object.keys(groupCount(contacts.filter(function(c){ return c.status; }), function(c){ return c.status; })).sort();
    statusSel.innerHTML = '<option value="">All statuses</option>' +
      statuses.map(function(s) { return '<option value="' + escDash(s) + '">' + escDash(s) + '</option>'; }).join('');
    statusSel.value = cur || '';
  }
  if (sourceSel) {
    const cur2 = sourceSel.value;
    const sources = Object.keys(groupCount(contacts.filter(function(c){ return c.source; }), function(c){ return c.source; })).sort();
    sourceSel.innerHTML = '<option value="">All sources</option>' +
      sources.map(function(s) { return '<option value="' + escDash(s) + '">' + escDash(s) + '</option>'; }).join('');
    sourceSel.value = cur2 || '';
  }
}

function applyLeadFilters() {
  const data = window.__crmData;
  if (!data) return;
  const q      = (document.getElementById('lead-search')   || {}).value || '';
  const status = (document.getElementById('filter-status') || {}).value || '';
  const source = (document.getElementById('filter-source') || {}).value || '';
  const ql = q.trim().toLowerCase();

  const filtered = (data.contacts || []).filter(function(c) {
    if (status && c.status !== status) return false;
    if (source && c.source !== source) return false;
    if (ql) {
      const hay = ((c.name || '') + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase();
      if (hay.indexOf(ql) === -1) return false;
    }
    return true;
  });

  const countEl = document.getElementById('leads-page-count');
  if (countEl) {
    countEl.textContent = (filtered.length === data.contacts.length)
      ? data.contacts.length + ' contacts'
      : filtered.length + ' of ' + data.contacts.length + ' contacts';
  }
  renderLeadsTable(filtered);
}

function renderLeadsTable(contacts) {
  const tbody = document.getElementById('full-leads-tbody');
  const empty = document.getElementById('full-leads-empty');
  if (!tbody) return;
  if (contacts.length === 0) {
    tbody.innerHTML = '';
    if (empty) {
      empty.style.display = 'flex';
      const t = empty.querySelector('.empty-state-title');
      const s = empty.querySelector('.empty-state-sub');
      if (window.__crmData && window.__crmData.contacts.length > 0) {
        if (t) t.textContent = 'No matching leads';
        if (s) s.textContent = 'Try a different search or clear the filters.';
      }
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  tbody.innerHTML = contacts.map(function(c) {
    const sel = c.id === window.__selectedLeadId ? ' class="row-selected"' : '';
    return '<tr' + sel + ' data-id="' + escDash(c.id) + '" onclick="selectLead(\'' + String(c.id).replace(/[^\w-]/g, '') + '\')">' +
      '<td><div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div></td>' +
      '<td>' +
      (c.email ? '<div style="font-size:11.5px;">' + escDash(c.email) + '</div>' : '') +
      (c.phone ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.phone) + '</div>' : '') +
      ((!c.email && !c.phone) ? '—' : '') +
      '</td>' +
      '<td>' + escDash(c.source) + '</td>' +
      '<td>' + statusBadge(c.status) + '</td>' +
      '<td>' + (c.lastTouchAt ? new Date(c.lastTouchAt).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td>' +
      '</tr>';
  }).join('');
}

function selectLead(id) {
  const data = window.__crmData;
  if (!data) return;
  const c = (data.contacts || []).find(function(x) { return String(x.id) === String(id); });
  if (!c) return;
  window.__selectedLeadId = c.id;

  document.querySelectorAll('#full-leads-tbody tr').forEach(function(tr) {
    tr.classList.toggle('row-selected', tr.getAttribute('data-id') === String(c.id));
  });

  const body = document.getElementById('lead-detail-body');
  if (!body) return;

  const rows = [];
  rows.push('<div style="padding:18px 18px 4px;"><div style="font-size:15px;font-weight:800;color:var(--text);">' + escDash(c.name) + '</div>' +
    '<div style="margin-top:6px;">' + statusBadge(c.status) + '</div></div>');

  rows.push('<div style="padding:10px 18px 14px;">');
  if (c.email) rows.push('<div class="detail-row"><span class="dk">Email</span><a class="dv" style="color:var(--blue);" href="mailto:' + escDash(c.email) + '">' + escDash(c.email) + '</a></div>');
  if (c.phone) rows.push('<div class="detail-row"><span class="dk">Phone</span><a class="dv" style="color:var(--blue);" href="tel:' + escDash(c.phone) + '">' + escDash(c.phone) + '</a></div>');
  rows.push('<div class="detail-row"><span class="dk">Source</span><span class="dv">' + escDash(c.source) + '</span></div>');
  rows.push('<div class="detail-row"><span class="dk">Created</span><span class="dv">' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</span></div>');
  rows.push('<div class="detail-row"><span class="dk">Last Activity</span><span class="dv">' + (c.lastTouchAt ? relTime(new Date(c.lastTouchAt).getTime()) : '—') + '</span></div>');
  if (c.lastTouch) rows.push('<div class="detail-row"><span class="dk">Last Touch Type</span><span class="dv">' + escDash(c.lastTouch) + '</span></div>');
  rows.push('</div>');

  rows.push('<div style="padding:12px 18px 18px;border-top:1px solid var(--border);">');
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">AI Summary</div>');
  if (c.summary) {
    rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + escDash(c.summary) + '</div>');
  } else {
    rows.push('<span class="state-pill awaiting"><span class="sp-dot"></span>Awaiting automation data</span>');
  }
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px;">Automation Insights</div>');
  rows.push('<div style="font-size:11.5px;color:var(--text-m);line-height:1.6;">Lead score and next follow-up will appear here once Flowaify automations are live for this lead.</div>');
  rows.push('</div>');

  body.innerHTML = rows.join('');
}
window.selectLead = selectLead;

/* ── Activity feed ──────────────────────────────────────────────────────────── */
function buildActivityFeed(data, days) {
  const cutoff = Date.now() - days * 86400000;
  const events = [];

  (data.contacts || []).forEach(function(c) {
    if (c.createdAt) {
      const t = new Date(c.createdAt).getTime();
      if (t >= cutoff) events.push({ type: 'lead_created', ts: t, name: c.name, source: c.source });
    }
    if (c.lastTouchAt) {
      const t2 = new Date(c.lastTouchAt).getTime();
      if (t2 >= cutoff) events.push({ type: 'touch', ts: t2, name: c.name, touchType: c.lastTouch, status: c.status });
    }
  });

  (data.deals || []).forEach(function(d) {
    if (d.createdAt) {
      const t3 = new Date(d.createdAt).getTime();
      if (t3 >= cutoff) events.push({ type: 'deal', ts: t3, name: d.name, stage: d.stage, amount: d.amount });
    }
  });

  events.sort(function(a, b) { return b.ts - a.ts; });
  return events;
}

const FEED_ICON = {
  lead_created: { icon: 'user-plus',      bg: 'rgba(0,87,255,.13)',    color: '#0057FF' },
  touch:        { icon: 'bot',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
  ai_reply:     { icon: 'bot',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
  deal:         { icon: 'dollar-sign',    bg: 'rgba(5,150,105,.13)',   color: '#059669' },
};

function feedItemText(ev) {
  if (ev.type === 'lead_created') {
    return '<strong>' + escDash(ev.name) + '</strong> came in' + (ev.source ? ' via ' + escDash(ev.source) : '');
  }
  if (ev.type === 'touch' || ev.type === 'ai_reply') {
    return (ev.touchType ? escDash(ev.touchType) + ' sent to ' : 'Touch logged for ') + '<strong>' + escDash(ev.name) + '</strong>';
  }
  if (ev.type === 'deal') {
    return 'Deal <strong>' + escDash(ev.name) + '</strong>' + (ev.stage ? ' · ' + escDash(ev.stage) : '') + (ev.amount != null ? ' · ' + fmtMoney(ev.amount) : '');
  }
  return escDash(ev.name);
}

function feedItemHtml(ev, idx) {
  const meta = FEED_ICON[ev.type] || FEED_ICON.lead_created;
  const i = Math.min(idx || 0, 12);
  return '<div class="feed-item" style="--i:' + i + '">' +
    '<div class="feed-icon" style="background:' + meta.bg + ';color:' + meta.color + ';"><i data-lucide="' + meta.icon + '"></i></div>' +
    '<div class="feed-body"><div class="feed-text">' + feedItemText(ev) + '</div></div>' +
    '<div class="feed-time">' + relTime(ev.ts) + '</div>' +
    '</div>';
}

function dayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderActivityFeed(events, containerId, opts) {
  opts = opts || {};
  const el = document.getElementById(containerId);
  if (!el) return;

  let list = events;
  if (opts.filter) list = list.filter(opts.filter);
  if (opts.limit)  list = list.slice(0, opts.limit);

  if (list.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:26px 18px;">' +
      '<i data-lucide="' + (opts.emptyIcon || 'activity') + '"></i>' +
      '<div class="empty-state-title">' + (opts.emptyTitle || 'No activity in this period') + '</div>' +
      '<div class="empty-state-sub">' + (opts.emptySub || 'Try widening the date range, or check back once new leads come in.') + '</div>' +
      '</div>';
    return;
  }

  if (opts.groupByDay) {
    const groups = [];
    let curLabel = null;
    list.forEach(function(ev) {
      const lbl = dayLabel(ev.ts);
      if (lbl !== curLabel) { groups.push({ label: lbl, items: [] }); curLabel = lbl; }
      groups[groups.length - 1].items.push(ev);
    });
    let n = 0;
    el.innerHTML = groups.map(function(g) {
      return '<div class="feed-day">' + g.label + '</div>' + g.items.map(function(ev) { return feedItemHtml(ev, n++); }).join('');
    }).join('');
  } else {
    el.innerHTML = list.map(function(ev, i) { return feedItemHtml(ev, i); }).join('');
  }
}

function renderActivitySections(data, days) {
  const events = buildActivityFeed(data, days);

  // Full Activity page
  renderActivityFeed(events, 'activity-feed', { groupByDay: true });

  // Overview "Live Activity" (compact)
  renderActivityFeed(events, 'ov-activity', {
    limit: 6,
    emptyTitle: 'No activity yet',
    emptySub: 'New leads, touches, and booked calls will appear here as they happen.',
  });

  // Automations "Recent Activity" — automation touches only
  renderActivityFeed(events, 'auto-activity', {
    limit: 6,
    filter: function(ev) { return ev.type === 'touch' || ev.type === 'ai_reply'; },
    emptyIcon: 'scroll-text',
    emptyTitle: 'No automation activity yet',
    emptySub: 'AI replies, follow-ups, and sequence events will appear here once your flows go live.',
  });

  // "This period" summary card on Activity page
  const leadsN   = events.filter(function(e) { return e.type === 'lead_created'; }).length;
  const touchesN = events.filter(function(e) { return e.type === 'touch' || e.type === 'ai_reply'; }).length;
  setText('feed-count-leads',   leadsN);
  setText('feed-count-touches', touchesN);
  setText('feed-count-deals',   (data.deals || []).length);
}

/* ── Automations page ───────────────────────────────────────────────────────── */
function renderAutomationStats(data) {
  const overview = data.overview || {};
  setText('val-ai-replies-auto',  overview.aiRepliesSent);
  setText('val-follow-ups-auto',  overview.activeSequences);
  setText('val-booked-auto',      overview.bookedCalls);
  setAwaitPill('await-ai-auto',   (overview.aiRepliesSent || 0) > 0);
  setAwaitPill('await-fu-auto',   (overview.activeSequences || 0) > 0);
}

/* ── Analytics ──────────────────────────────────────────────────────────────── */
function renderAnalyticsStats(data, ranged, days) {
  const contacts = data.contacts || [];
  const overview = data.overview || {};

  setText('val-an-total', ranged.length);
  setDelta('delta-an-total', ranged.length, prevWindowCount(contacts, days), 'vs prior ' + days + 'd');

  setText('val-an-pipeline', fmtMoney(overview.pipelineValue));
  setText('val-an-booked',   overview.bookedCalls);
  setText('val-an-response', overview.avgResponseTimeSecs != null ? overview.avgResponseTimeSecs + 's' : '—');

  const srcCount = Object.keys(groupCount(ranged.filter(function(c){ return c.source; }), function(c){ return c.source; })).length;
  setText('val-an-sources', srcCount);

  const convRate = contacts.length > 0 && overview.bookedCalls
    ? Math.round((overview.bookedCalls / contacts.length) * 100) + '%'
    : '—';
  setText('val-an-conv', convRate);
}

/* ── Charts ─────────────────────────────────────────────────────────────────── */
function renderCharts(data, ranged, days) {
  if (typeof Chart === 'undefined') return;
  const contacts = data.contacts || [];
  const deals    = data.deals || [];
  const chartSet = ranged.length > 0 ? ranged : [];

  /* Lead Sources bar list (Overview) + Source Performance (Analytics) */
  const srcCounts = groupCount(chartSet, function(c) { return c.source; });
  renderSourceList('src-list', srcCounts, 'No leads in this period', 'Widen the date range, or check back when new leads come in.');
  renderSourceList('an-srclist', srcCounts, 'No source data in this period', 'Widen the date range to compare lead sources.');

  /* Response time trend (Overview ch-resp + Analytics an-resp) — real when touches exist */
  const respPoints = contacts.filter(function(c) { return c.createdAt && c.lastTouchAt; })
    .map(function(c) {
      return { ts: new Date(c.createdAt).getTime(), secs: (new Date(c.lastTouchAt).getTime() - new Date(c.createdAt).getTime()) / 1000 };
    })
    .filter(function(p) { return p.secs >= 0 && p.secs < 7 * 86400; })
    .sort(function(a, b) { return a.ts - b.ts; });

  const hasResp = respPoints.length >= 2;
  ['ch-resp', 'an-resp'].forEach(function(id) {
    if (hasResp) {
      mkChart(id, {
        type: 'line',
        data: {
          labels: respPoints.map(function(p) { return new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }),
          datasets: [{ data: respPoints.map(function(p) { return Math.round(p.secs); }), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.05)', fill: true, tension: 0.3, pointRadius: 2 }]
        },
        options: {
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.raw + 's'; } } } },
          scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: function(v) { return v + 's'; } } } },
          animation: { duration: 400 }
        }
      });
    }
    chartOverlay(id, !hasResp);
  });

  /* Leads Over Time (an-leads) — day/week buckets */
  const buckets = timeBuckets(chartSet, days);
  const hasLeadsTime = chartSet.length > 0;
  if (hasLeadsTime) {
    mkChart('an-leads', {
      type: 'line',
      data: { labels: buckets.labels, datasets: [{ data: buckets.data, borderColor: '#0057FF', backgroundColor: 'rgba(0,87,255,0.05)', fill: true, tension: 0.3, pointRadius: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 9 }, maxTicksLimit: 10 } }, y: { ticks: { font: { size: 10 }, stepSize: 1 } } },
        animation: { duration: 400 }
      }
    });
  }
  chartOverlay('an-leads', !hasLeadsTime);

  /* Status Breakdown (an-status) */
  const stCounts = groupCount(chartSet.filter(function(c) { return c.status; }), function(c) { return c.status; });
  const stLabels = Object.keys(stCounts);
  const hasStatus = stLabels.length > 0;
  if (hasStatus) {
    const stColors = stLabels.map(function(s) {
      const u = s.toUpperCase();
      if (u.indexOf('HOT') !== -1)  return '#dc2626';
      if (u.indexOf('WARM') !== -1) return '#d97706';
      if (u.indexOf('BOOK') !== -1) return '#059669';
      if (u.indexOf('COLD') !== -1) return '#0057FF';
      return '#64748b';
    });
    mkChart('an-status', {
      type: 'bar',
      data: { labels: stLabels, datasets: [{ data: stLabels.map(function(k) { return stCounts[k]; }), backgroundColor: stColors, borderRadius: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, stepSize: 1 } } },
        animation: { duration: 400 }
      }
    });
  }
  chartOverlay('an-status', !hasStatus);

  /* New Leads by Day of Week (an-dow) */
  const dowNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowData = [0, 0, 0, 0, 0, 0, 0];
  chartSet.forEach(function(c) {
    if (!c.createdAt) return;
    dowData[(new Date(c.createdAt).getDay() + 6) % 7]++;
  });
  const hasDow = chartSet.length > 0;
  if (hasDow) {
    mkChart('an-dow', {
      type: 'bar',
      data: { labels: dowNames, datasets: [{ data: dowData, backgroundColor: '#8b5cf6', borderRadius: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, stepSize: 1 } } },
        animation: { duration: 400 }
      }
    });
  }
  chartOverlay('an-dow', !hasDow);

  /* Booked Calls Over Time — real once deals carry createdAt (Worker update) */
  const bookedDeals = deals.filter(function(d) { return d.createdAt; });
  const hasBookedTime = bookedDeals.length > 0;
  if (hasBookedTime) {
    const db = timeBuckets(bookedDeals, days);
    mkChart('an-booked-chart', {
      type: 'bar',
      data: { labels: db.labels, datasets: [{ data: db.data, backgroundColor: '#059669', borderRadius: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font: { size: 9 }, maxTicksLimit: 10 } }, y: { ticks: { font: { size: 10 }, stepSize: 1 } } },
        animation: { duration: 400 }
      }
    });
  }
  chartOverlay('an-booked-chart', !hasBookedTime);

  /* Pipeline by Stage (all-time) */
  const hasDeals = deals.length > 0;
  if (hasDeals) {
    const stageTotals = {};
    deals.forEach(function(d) {
      const stage = d.stage || 'Unknown';
      stageTotals[stage] = (stageTotals[stage] || 0) + (d.amount || 0);
    });
    const stageLabels = Object.keys(stageTotals);
    mkChart('an-pipestage', {
      type: 'bar',
      data: { labels: stageLabels, datasets: [{ data: stageLabels.map(function(k) { return stageTotals[k]; }), backgroundColor: '#0057FF', borderRadius: 2 }] },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function(ctx) { return fmtMoney(ctx.raw); } } }
        },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { ticks: { callback: function(v) { return '$' + Number(v).toLocaleString(); }, font: { size: 10 } } }
        },
        animation: { duration: 400 }
      }
    });
  }
  chartOverlay('an-pipestage', !hasDeals);
}
