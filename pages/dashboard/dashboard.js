const WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

/* ── State ──────────────────────────────────────────────────────────────────── */
window.__crmData        = null;
window.__rangeDays      = 30;
window.__selectedLeadId = null;
window.__leadFilters    = { q: '', status: '', source: '' };
window.__leadSort       = { key: 'createdAt', dir: -1 };
window.__leadsShown     = 25;
window.__leadsFiltered  = [];
window.__lastKpiValues  = {};
window.__kpiFirstRender = true;

/* ── Data loading ───────────────────────────────────────────────────────────── */
async function loadDashboardData(token) {
  try {
    const authHeader = 'Bearer ' + token;
    const res = await fetch(WORKER + '/data', {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) {
      console.warn('Worker responded', res.status, await res.text());
      showErrBanner(true);
      return;
    }
    window.__crmData = await res.json();
    window.__lastSync = Date.now();
    showErrBanner(false);
    updateSyncLabel();
    rerender();
  } catch (err) {
    console.warn('CRM load failed:', err.message);
    showErrBanner(true);
  }
}

function showErrBanner(show) {
  const b = document.getElementById('err-banner');
  if (b) b.style.display = show ? 'flex' : 'none';
}

function updateSyncLabel() {
  const el = document.getElementById('sync-label');
  if (!el) return;
  if (!window.__lastSync) { el.textContent = ''; return; }
  const m = Math.floor((Date.now() - window.__lastSync) / 60000);
  el.textContent = m < 1 ? 'Synced just now' : 'Synced ' + m + 'm ago';
}
setInterval(updateSyncLabel, 30000);

// Silent auto-refresh every 5 minutes while the tab is visible
setInterval(function() {
  if (!document.hidden && window.__crmData) refreshData(true);
}, 300000);

async function refreshData(quiet) {
  const btn = document.getElementById('btn-refresh');
  const icon = btn ? btn.querySelector('i, svg') : null;
  if (icon) icon.classList.add('spinning');
  try {
    const claims = await auth0Client.getIdTokenClaims();
    if (claims && claims.__raw) await loadDashboardData(claims.__raw);
    if (!quiet && typeof showToast === 'function') showToast('Dashboard refreshed with the latest CRM data.');
  } catch (e) {
    console.warn('Refresh failed:', e.message);
    showErrBanner(true);
  }
  const icon2 = btn ? btn.querySelector('i, svg') : null;
  if (icon2) icon2.classList.remove('spinning');
}

/* ── Write-back: update a lead in Zoho via the Worker ───────────────────────── */
async function updateLead(contactId, payload) {
  let claims;
  try { claims = await auth0Client.getIdTokenClaims(); } catch (e) { return false; }
  if (!claims || !claims.__raw) return false;
  try {
    const res = await fetch(WORKER + '/update', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + claims.__raw,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(Object.assign({ contactId: contactId }, payload)),
    });
    if (res.status === 404) {
      if (typeof showToast === 'function') showToast('Lead updates need the new Worker — paste and deploy it in Cloudflare first.');
      return false;
    }
    if (!res.ok) {
      const err = await res.json().catch(function() { return {}; });
      if (typeof showToast === 'function') showToast(err.error || 'Update failed — try again.');
      return false;
    }
    return true;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Update failed — check your connection.');
    return false;
  }
}

async function setLeadStatus(contactId, status) {
  if (typeof flwWriteBlocked === 'function' && flwWriteBlocked()) return;
  const data = window.__crmData;
  if (!data) return;
  const c = data.contacts.find(function(x) { return String(x.id) === String(contactId); });
  if (!c) return;
  const prev = c.status;
  c.status = status;               // optimistic
  rerender();
  selectLead(contactId);
  const ok = await updateLead(contactId, { status: status });
  if (ok) {
    if (typeof showToast === 'function') showToast(escDash(c.name) + ' marked ' + status + '.');
  } else {
    c.status = prev;               // revert
    rerender();
    selectLead(contactId);
  }
}
window.setLeadStatus = setLeadStatus;

async function saveLeadNote(contactId) {
  if (typeof flwWriteBlocked === 'function' && flwWriteBlocked()) return;
  const ta = document.getElementById('lead-note-input');
  if (!ta || !ta.value.trim()) return;
  const note = ta.value.trim();
  const btn = document.getElementById('lead-note-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const ok = await updateLead(contactId, { note: note });
  if (btn) { btn.disabled = false; btn.textContent = 'Save note'; }
  if (ok) {
    ta.value = '';
    if (typeof showToast === 'function') showToast('Note saved to your CRM.');
  }
}
window.saveLeadNote = saveLeadNote;

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

function setKpi(id, val) {
  const target = val != null ? String(val) : '—';
  const m = target.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  const num = m ? parseFloat(m[2].replace(/,/g, '')) : null;
  const prev = window.__lastKpiValues[id];
  window.__lastKpiValues[id] = num;
  setText(id, val);
  if (!window.__kpiFirstRender && num !== null && typeof prev === 'number' && num !== prev) {
    const el = document.getElementById(id);
    const card = el && el.closest('.stat-card');
    if (card) {
      card.classList.remove('kpi-pulsed');
      requestAnimationFrame(function() {
        card.classList.add('kpi-pulsed');
        setTimeout(function() { card.classList.remove('kpi-pulsed'); }, 2400);
      });
    }
  }
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
  if (!status || !String(status).trim()) return '<span style="color:var(--text-m);opacity:.55;">—</span>';
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
    el.innerHTML = '<span class="stat-delta delta-up">↗ +' + cur + '</span><span class="delta-caption">' + label + '</span>';
    return;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) { el.innerHTML = '<span class="stat-delta delta-flat">— 0%</span><span class="delta-caption">' + label + '</span>'; return; }
  const up = pct > 0;
  el.innerHTML = '<span class="stat-delta ' + (up ? 'delta-up' : 'delta-down') + '">' +
    (up ? '↗ +' : '↘ −') + Math.abs(pct) + '%</span><span class="delta-caption">' + label + '</span>';
}

/* Deterministic colored initials avatar */
const AVATAR_HUES = [212, 262, 152, 22, 340, 190, 48, 288];
function avatarHtml(name) {
  const n = String(name || '?');
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  const initials = n.split(/\s+/).slice(0, 2).map(function(w) { return w.charAt(0); }).join('').toUpperCase() || '?';
  return '<span class="lead-avatar" style="background:hsl(' + hue + ',62%,45%);">' + escDash(initials) + '</span>';
}

function setAwaitPill(id, isLive) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = isLive
    ? '<span class="dot-live" title="Live"></span>'
    : '<span class="dot-await" title="No data yet"></span>';
  // Swap the hint line if this stat has one (hint id mirrors the await id)
  const hint = document.getElementById(id.replace('await-', 'hint-'));
  if (hint) {
    const liveText = hint.getAttribute('data-live');
    const emptyText = hint.getAttribute('data-empty');
    hint.textContent = isLive && liveText ? liveText : (emptyText || 'No data yet');
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
  if (!window.__srcCharts) window.__srcCharts = {};
  const names = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
  if (names.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:50px 20px;">' +
      '<i data-lucide="pie-chart"></i>' +
      '<div class="empty-state-title">' + escDash(emptyTitle) + '</div>' +
      '<div class="empty-state-sub">' + escDash(emptySub) + '</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  let total = 0;
  names.forEach(function(n) { total += counts[n]; });
  const shown = names.slice(0, 6);
  const donutColors = ['#3b82f6','#0f172a','#64748b','#0057FF','#94a3b8','#475569'];
  const legendHtml = shown.map(function(name, i) {
    return '<div class="src-leg-row">' +
      '<div class="src-leg-dot" style="background:' + donutColors[i % donutColors.length] + ';"></div>' +
      '<div class="src-leg-name" title="' + escDash(name) + '">' + escDash(name) + '</div>' +
      '<div class="src-leg-cnt">' + counts[name] + '</div>' +
    '</div>';
  }).join('');
  el.innerHTML = '<div class="src-donut-wrap">' +
    '<div class="src-donut-pos">' +
      '<canvas id="' + containerId + '-canvas" width="100" height="100"></canvas>' +
      '<div class="src-donut-center">' +
        '<div class="src-donut-num">' + total + '</div>' +
        '<div class="src-donut-lbl">Total Leads</div>' +
      '</div>' +
    '</div>' +
    '<div class="src-legend">' + legendHtml + '</div>' +
  '</div>' +
  '<div class="src-foot2">' + total + ' lead' + (total === 1 ? '' : 's') + ' · ' + names.length + ' source' + (names.length === 1 ? '' : 's') + '</div>';
  if (typeof Chart !== 'undefined') {
    const canvas = document.getElementById(containerId + '-canvas');
    if (canvas) {
      if (!window.__srcCharts) window.__srcCharts = {};
      if (window.__srcCharts[containerId]) { window.__srcCharts[containerId].destroy(); }
      window.__srcCharts[containerId] = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: shown,
          datasets: [{ data: shown.map(function(n) { return counts[n]; }), backgroundColor: donutColors, borderWidth: 0, hoverOffset: 3 }]
        },
        options: {
          cutout: '68%',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ' ' + ctx.label + ': ' + ctx.parsed; } } } },
          animation: { duration: 500, easing: 'easeOutQuart' }
        }
      });
    }
  }
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

/* ── Goal gauge ─────────────────────────────────────────────────────────────── */
function goalTarget() {
  try {
    const all = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    const v = parseInt((all.biz || {})['s2-goal-leads'], 10);
    if (isFinite(v) && v > 0) return v;
  } catch (e) {}
  return 50;
}

function renderGoalGauge(contacts) {
  const el = document.getElementById('goal-gauge');
  if (!el) return;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const count = contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() >= monthStart;
  }).length;
  const goal = goalTarget();
  const pct = Math.min(1, count / goal);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();

  const r = 70, cx = 90, cy = 84, sw = 13;
  const circ = Math.PI * r;
  const off = circ * (1 - pct);
  el.innerHTML =
    '<div class="gauge-wrap">' +
    '<svg width="180" height="96" viewBox="0 0 180 96">' +
    '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + '" fill="none" stroke="var(--track, rgba(15,23,42,0.09))" stroke-width="' + sw + '" stroke-linecap="round"/>' +
    '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy + '" fill="none" stroke="#0057FF" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" style="transition: stroke-dashoffset .7s ease;"/>' +
    '</svg>' +
    '<div class="gauge-center"><div class="gauge-val">' + count + '</div><div class="gauge-sub">of ' + goal + ' leads</div></div>' +
    '<div class="gauge-foot"><span>' + Math.round(pct * 100) + '% of goal</span><span>' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left</span></div>' +
    '</div>';

  const ml = document.getElementById('goal-month-label');
  if (ml) ml.textContent = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/* ── Pipeline stage list ────────────────────────────────────────────────────── */
function stageColor(stage) {
  const s = String(stage || '').toUpperCase();
  if (s.indexOf('WON') !== -1 || s.indexOf('CLOSED W') !== -1) return '#059669';
  if (s.indexOf('LOST') !== -1)      return '#dc2626';
  if (s.indexOf('PROPOS') !== -1)    return '#d97706';
  if (s.indexOf('NEGOTIAT') !== -1)  return '#ea580c';
  if (s.indexOf('QUALIF') !== -1)    return '#0057FF';
  if (s.indexOf('BOOK') !== -1)      return '#0d9488';
  return '#64748b';
}

function renderStageList(deals) {
  const el = document.getElementById('stage-list');
  if (!el) return;
  if (!deals || deals.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:36px 20px;"><i data-lucide="bar-chart-2"></i>' +
      '<div class="empty-state-title">No deals yet</div>' +
      '<div class="empty-state-sub">Pipeline value by stage will appear once deals exist in your CRM.</div></div>';
    return;
  }
  const totals = {};
  deals.forEach(function(d) {
    const st = d.stage || 'Unknown';
    totals[st] = (totals[st] || 0) + (d.amount || 0);
  });
  const stages = Object.keys(totals).sort(function(a, b) { return totals[b] - totals[a]; });
  const max = totals[stages[0]] || 1;
  el.innerHTML = stages.map(function(st) {
    const pct = Math.max(3, Math.round((totals[st] / max) * 100));
    return '<div class="stage-row">' +
      '<div class="stage-name" title="' + escDash(st) + '">' + escDash(st) + '</div>' +
      '<div class="stage-track"><div class="stage-fill" style="width:' + pct + '%;background:' + stageColor(st) + ';"></div></div>' +
      '<div class="stage-amt">' + fmtMoney(totals[st]) + '</div>' +
      '</div>';
  }).join('');
}

/* ── Calendar ───────────────────────────────────────────────────────────────── */
/* ── Calendar — planning workspace (agenda / month / week / list) ───────────── */
var _calView = 'agenda';
var _calSelDay = null;
var _calSelEv = null;

const CAL_TYPES = {
  booking:  { label: 'Booking',   color: 'var(--green)', dim: 'var(--green-dim)' },
  followup: { label: 'Follow-up', color: '#d97706',      dim: 'var(--amber-dim)' },
  due:      { label: 'Due',       color: 'var(--blue)',  dim: 'var(--blue-dim)' },
  task:     { label: 'Task',      color: 'var(--purple)', dim: 'rgba(139,92,246,0.12)' }
};

function calKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Booking = confirmed appointment (booked lead's touch time).
   Follow-up = due 48h after the last touch (or creation) — derived, honest.
   Due = deal closing dates from the CRM. */
function calBuildEvents(data) {
  const evs = [];
  (data.contacts || []).forEach(function(c) {
    const booked = scoreRank(c.status) === 3;
    if (booked && c.lastTouchAt) {
      evs.push({ type: 'booking', ts: new Date(c.lastTouchAt).getTime(), name: c.name, desc: 'Confirmed appointment', id: c.id, hasTime: true });
    }
    if (!booked) {
      const baseT = c.lastTouchAt ? new Date(c.lastTouchAt).getTime() : (c.createdAt ? new Date(c.createdAt).getTime() : 0);
      if (baseT) {
        evs.push({ type: 'followup', ts: baseT + 48 * 3600000, name: c.name,
          desc: c.lastTouchAt ? 'Follow-up due — keep the thread warm' : 'First follow-up due', id: c.id, hasTime: true });
      }
    }
  });
  (data.deals || []).forEach(function(d) {
    if (!d.closingDate) return;
    evs.push({ type: 'due', ts: new Date(d.closingDate).getTime(), name: d.name,
      desc: (d.stage ? d.stage : 'Closing') + (d.amount != null ? ' · ' + fmtMoney(d.amount) : ''), amount: d.amount, hasTime: false });
  });
  /* open team tasks with due dates (loaded by team.js) */
  (window.__twTasks || []).forEach(function(t) {
    if (!t.due || t.status !== 'open') return;
    evs.push({ type: 'task', ts: t.due, name: t.title,
      desc: 'Team task' + (t.owner ? ' · ' + t.owner : ' · Unassigned') + (t.leadName ? ' · ' + t.leadName : ''),
      id: t.leadId || null, hasTime: false });
  });
  evs.sort(function(a, b) { return a.ts - b.ts; });
  return evs;
}

function calTypeFilter() { return ((document.getElementById('cal-filter') || {}).value) || ''; }

function calShown() {
  const f = calTypeFilter();
  const out = [];
  (window.__calEvents || []).forEach(function(ev, i) {
    if (f && ev.type !== f) return;
    out.push({ ev: ev, i: i });
  });
  return out;
}

function calEvTime(ev) {
  if (!ev.hasTime) return 'Time not set';
  return new Date(ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function calPill(ev) {
  const t = CAL_TYPES[ev.type] || CAL_TYPES.due;
  return '<span class="ag-pill" style="background:' + t.dim + ';color:' + t.color + ';">' + t.label + '</span>';
}

function calAgRow(item, showDate) {
  const ev = item.ev;
  const t = CAL_TYPES[ev.type] || CAL_TYPES.due;
  const sel = item.i === _calSelEv ? ' sel' : '';
  const timeCol = showDate
    ? '<div class="ag-time">' + new Date(ev.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + '<small>' + calEvTime(ev) + '</small></div>'
    : '<div class="ag-time">' + calEvTime(ev) + '</div>';
  return '<div class="ag-row' + sel + '" onclick="calSelectEv(' + item.i + ')">' +
    timeCol +
    '<span class="ag-dot" style="background:' + t.color + ';"></span>' +
    '<div class="ag-body"><div class="ag-name">' + escDash(ev.name) + ' ' + calPill(ev) + '</div>' +
    '<div class="ag-desc">' + escDash(ev.desc) + '</div></div>' +
    (ev.id ? '<button class="btn-mini btn-mini-ghost ag-view" onclick="calViewLead(' + item.i + ', event)">View</button>' : '') +
  '</div>';
}

function calEmptyHtml(title, sub, icon) {
  return '<div class="empty-state" style="padding:40px 20px;"><i data-lucide="' + (icon || 'calendar') + '"></i>' +
    '<div class="empty-state-title">' + title + '</div>' +
    '<div class="empty-state-sub">' + sub + '</div></div>';
}

function renderCalendar() {
  const data = window.__crmData;
  if (!data || !document.getElementById('cal-main')) return;
  window.__calMonth = window.__calMonth || new Date();
  window.__calView = _calView;
  window.__calEvents = calBuildEvents(data);
  const contacts = data.contacts || [];

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const now = Date.now();
  const evs = window.__calEvents;
  const upcoming = evs.filter(function(e) { return e.ts >= dayStart.getTime(); });
  const followupsDue = evs.filter(function(e) { return e.type === 'followup' && e.ts <= now; });
  const unscheduled = contacts.filter(function(c) { return scoreRank(c.status) !== 3 && !c.lastTouchAt; });

  setText('cal-kpi-upcoming', upcoming.length);
  setText('cal-kpi-bookings', evs.filter(function(e) { return e.type === 'booking'; }).length);
  setText('cal-kpi-followups', followupsDue.length);
  setText('cal-kpi-unscheduled', unscheduled.length);

  const base = window.__calMonth;
  const title = document.getElementById('cal-title');
  if (title) {
    title.textContent = _calView === 'agenda'
      ? new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })
      : base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  if (_calView === 'agenda') renderCalAgenda();
  else if (_calView === 'month') renderCalMonth();
  else if (_calView === 'week') renderCalWeek();
  else renderCalList();

  renderCalSide();
  renderCalHealth(followupsDue.length, unscheduled.length);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderCalendar = renderCalendar;

function calMainHead(t, s) {
  const mt = document.getElementById('cal-main-title');
  const ms = document.getElementById('cal-main-sub');
  if (mt) mt.textContent = t;
  if (ms) ms.textContent = s || '';
}

function renderCalAgenda() {
  const el = document.getElementById('cal-main');
  if (!el) return;
  const today = new Date();
  calMainHead('Today Agenda', today.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  const weekEnd = dayStart.getTime() + 7 * 86400000;
  const shown = calShown();
  const todayEvs = shown.filter(function(x) { return x.ev.ts >= dayStart.getTime() && x.ev.ts < dayEnd; });
  const laterEvs = shown.filter(function(x) { return x.ev.ts >= dayEnd && x.ev.ts < weekEnd; }).slice(0, 8);

  let h = '';
  if (!todayEvs.length) {
    h += calEmptyHtml('No scheduled activity today',
      'Upcoming items will appear here when bookings, follow-ups, or reviews are scheduled.');
  } else {
    h += todayEvs.map(function(x) { return calAgRow(x, false); }).join('');
  }
  h += '<div class="ag-sec">Later this week</div>';
  if (!laterEvs.length) {
    h += '<div style="padding:14px 16px;font-size:12px;color:var(--text-m);">Nothing else scheduled this week.</div>';
  } else {
    h += laterEvs.map(function(x) { return calAgRow(x, true); }).join('');
  }
  h += '<div style="padding:12px 16px;text-align:center;"><span class="sec-link" onclick="calSetView(\'month\')">View full calendar</span></div>';
  el.innerHTML = h;
}

function renderCalMonth() {
  const el = document.getElementById('cal-main');
  if (!el) return;
  const base = window.__calMonth;
  const y = base.getFullYear(), m = base.getMonth();
  calMainHead('Month', base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  const byDay = {};
  calShown().forEach(function(x) {
    const key = calKey(new Date(x.ev.ts));
    (byDay[key] = byDay[key] || []).push(x);
  });
  const leadsByDay = {};
  ((window.__crmData || {}).contacts || []).forEach(function(c) {
    if (!c.createdAt) return;
    const key = calKey(new Date(c.createdAt));
    leadsByDay[key] = (leadsByDay[key] || 0) + 1;
  });

  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const start = new Date(y, m, 1 - firstDow);
  const todayKey = calKey(new Date());

  let h = '<div class="cal-grid">' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d) {
    return '<div class="cal-dow">' + d + '</div>';
  }).join('');

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = calKey(d);
    const cls = (d.getMonth() !== m ? ' other' : '') + (key === todayKey ? ' today' : '') + (key === _calSelDay ? ' selday' : '');
    let cell = '<div class="cal-cell' + cls + '" onclick="calSelectDay(\'' + key + '\')"><span class="cal-daynum">' + d.getDate() + '</span>';
    const dd = byDay[key] || [];
    dd.slice(0, 2).forEach(function(x) {
      const t = CAL_TYPES[x.ev.type] || CAL_TYPES.due;
      cell += '<span class="cal-chip" style="background:' + t.dim + ';color:' + t.color + ';" title="' + escDash(x.ev.name) + ' · ' + t.label + '">' + escDash(x.ev.name) + '</span>';
    });
    if (dd.length > 2) cell += '<span class="cal-chip" style="background:var(--hover);color:var(--text-m);">+' + (dd.length - 2) + ' more</span>';
    if (leadsByDay[key]) cell += '<span class="cal-dot-badge">' + leadsByDay[key] + ' lead' + (leadsByDay[key] === 1 ? '' : 's') + '</span>';
    cell += '</div>';
    h += cell;
  }
  el.innerHTML = h + '</div>';
}

function renderCalWeek() {
  const el = document.getElementById('cal-main');
  if (!el) return;
  const base = window.__calMonth;
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  calMainHead('Week', monday.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + sunday.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));

  const byDay = {};
  calShown().forEach(function(x) {
    const key = calKey(new Date(x.ev.ts));
    (byDay[key] = byDay[key] || []).push(x);
  });
  const todayKey = calKey(new Date());

  let h = '<div class="cal-grid">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    h += '<div class="cal-dow">' + d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.getDate() + '</div>';
  }
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    const key = calKey(d);
    const cls = (key === todayKey ? ' today' : '') + (key === _calSelDay ? ' selday' : '');
    let cell = '<div class="cal-cell cal-wcell' + cls + '" onclick="calSelectDay(\'' + key + '\')">';
    (byDay[key] || []).slice(0, 6).forEach(function(x) {
      const t = CAL_TYPES[x.ev.type] || CAL_TYPES.due;
      cell += '<span class="cal-chip" style="background:' + t.dim + ';color:' + t.color + ';" title="' + escDash(x.ev.name) + '">' +
        (x.ev.hasTime ? new Date(x.ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ' : '') + escDash(x.ev.name) + '</span>';
    });
    cell += '</div>';
    h += cell;
  }
  el.innerHTML = h + '</div>';
}

function renderCalList() {
  const el = document.getElementById('cal-main');
  if (!el) return;
  calMainHead('Upcoming', 'Next 90 days');
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const horizon = dayStart.getTime() + 90 * 86400000;
  const shown = calShown().filter(function(x) { return x.ev.ts >= dayStart.getTime() && x.ev.ts < horizon; });
  if (!shown.length) {
    el.innerHTML = calEmptyHtml('Nothing scheduled ahead',
      'Bookings, follow-ups, and due dates will appear here as they are scheduled.');
    return;
  }
  const groups = [];
  let cur = null;
  shown.forEach(function(x) {
    const lbl = dayLabel(x.ev.ts);
    if (lbl !== cur) { groups.push({ label: lbl, items: [] }); cur = lbl; }
    groups[groups.length - 1].items.push(x);
  });
  el.innerHTML = groups.map(function(g) {
    return '<div class="feed-day">' + g.label + '</div>' + g.items.map(function(x) { return calAgRow(x, false); }).join('');
  }).join('');
}

/* ── right rail ── */
function renderCalSide() {
  const el = document.getElementById('cal-upcoming');
  const titleEl = document.getElementById('cal-up-title');
  const back = document.getElementById('cal-up-back');
  if (!el) return;

  if (_calSelEv != null) {
    const ev = (window.__calEvents || [])[_calSelEv];
    if (ev) {
      const t = CAL_TYPES[ev.type] || CAL_TYPES.due;
      if (titleEl) titleEl.textContent = 'Event Detail';
      if (back) back.style.display = '';
      el.innerHTML = '<div style="padding:14px 16px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
          '<span class="ag-dot" style="background:' + t.color + ';width:9px;height:9px;"></span>' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text);">' + escDash(ev.name) + '</div>' +
          '<div style="font-size:10.5px;color:var(--text-m);">' + new Date(ev.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + calEvTime(ev) + '</div></div>' +
          calPill(ev) +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + escDash(ev.desc) + '</div>' +
        (ev.type === 'followup' ? '<div style="font-size:12px;color:var(--text-s);line-height:1.6;margin-top:8px;">Next action: reach out before this lead goes cold.</div>' : '') +
        (ev.id ? '<button class="btn-mini btn-mini-primary" style="width:100%;justify-content:center;margin-top:14px;display:inline-flex;" onclick="calViewLead(' + _calSelEv + ')">View lead</button>' : '') +
      '</div>';
      return;
    }
  }

  if (_calSelDay) {
    const d = new Date(_calSelDay + 'T12:00:00');
    if (titleEl) titleEl.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (back) back.style.display = '';
    const items = calShown().filter(function(x) { return calKey(new Date(x.ev.ts)) === _calSelDay; });
    el.innerHTML = items.length
      ? items.map(function(x) { return calAgRow(x, false); }).join('')
      : calEmptyHtml('Nothing scheduled', 'No bookings, follow-ups, or due dates on this day.');
    return;
  }

  if (titleEl) titleEl.textContent = 'Upcoming Schedule';
  if (back) back.style.display = 'none';
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const next = calShown().filter(function(x) { return x.ev.ts >= dayStart.getTime(); }).slice(0, 5);
  el.innerHTML = next.length
    ? next.map(function(x) { return calAgRow(x, true); }).join('')
    : calEmptyHtml('Nothing scheduled ahead', 'Upcoming bookings and follow-ups will appear here.');
}

function renderCalHealth(followupsDue, unscheduled) {
  const el = document.getElementById('cal-health');
  if (!el) return;
  const evs = window.__calEvents || [];
  const now = Date.now();
  const bookings = evs.filter(function(e) { return e.type === 'booking'; }).length;
  const overdue = evs.filter(function(e) { return (e.type === 'followup' || e.type === 'due') && e.ts < now - 86400000; }).length;

  function row(icon, label, n, color) {
    return '<div class="ch-row"><div class="ch-label"><i data-lucide="' + icon + '"></i>' + label + '</div>' +
      '<span class="ch-num" style="color:' + (n > 0 ? color : 'var(--text-m)') + ';">' + n + '</span></div>';
  }
  el.innerHTML =
    row('calendar-check', 'Bookings confirmed', bookings, 'var(--green)') +
    row('clock', 'Follow-ups due', followupsDue, '#d97706') +
    row('user-x', 'Leads missing next step', unscheduled, 'var(--blue)') +
    row('alert-circle', 'Overdue items', overdue, 'var(--red)');
}

/* ── interactions ── */
function calSetView(v) {
  _calView = v;
  window.__calView = v;
  document.querySelectorAll('#cal-views .cal-seg-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-view') === v);
  });
  renderCalendar();
}
window.calSetView = calSetView;

function calSelectDay(key) {
  _calSelEv = null;
  _calSelDay = (_calSelDay === key) ? null : key;
  renderCalendar();
}
window.calSelectDay = calSelectDay;

function calSelectEv(i) {
  _calSelEv = i;
  renderCalendar();
}
window.calSelectEv = calSelectEv;

function calClearSel() {
  _calSelEv = null;
  _calSelDay = null;
  renderCalendar();
}
window.calClearSel = calClearSel;

function calViewLead(i, e) {
  if (e) e.stopPropagation();
  const ev = (window.__calEvents || [])[i];
  if (!ev || !ev.id) return;
  bellOpenLead(String(ev.id).replace(/[^\w-]/g, ''), String(ev.name || '').replace(/[^\w\s.@-]/g, ''));
}
window.calViewLead = calViewLead;

/* ── Notification bell ──────────────────────────────────────────────────────── */
function renderBell(needsAttention) {
  // Delegate to notification drawer builder if available; it handles badge too
  if (typeof buildNotifList === 'function') { buildNotifList(); return; }
  // Fallback: update badge only
  const badge = document.getElementById('bell-badge');
  const n = (needsAttention || []).length;
  if (badge) { badge.textContent = n; badge.style.display = n > 0 ? 'flex' : 'none'; }
}

function bellOpenLead(id, name) {
  const m = document.getElementById('bell-menu');
  if (m) m.classList.remove('open');
  showPage('leads');
  if (id && window.__crmData && window.__crmData.contacts.some(function(c) { return String(c.id) === id; })) {
    selectLead(id);
  } else if (name) {
    const ls = document.getElementById('lead-search');
    if (ls) { ls.value = name; applyLeadFilters(); }
  }
}
window.bellOpenLead = bellOpenLead;

/* ── Insights ───────────────────────────────────────────────────────────────── */
function buildInsights(data, ranged, days) {
  const out = [];
  const contacts = data.contacts || [];
  const deals = data.deals || [];

  // Top source share
  if (ranged.length >= 3) {
    const counts = groupCount(ranged, function(c) { return c.source; });
    const top = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; })[0];
    const share = Math.round((counts[top] / ranged.length) * 100);
    if (share >= 25 && top !== 'Unknown') {
      out.push({ icon: 'pie-chart', color: 'var(--blue)', text: '<strong>' + escDash(top) + '</strong> drives ' + share + '% of your leads this period.' });
    }
  }

  // Best weekday
  if (ranged.length >= 4) {
    const dow = [0,0,0,0,0,0,0];
    const names = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
    ranged.forEach(function(c) { if (c.createdAt) dow[new Date(c.createdAt).getDay()]++; });
    const max = Math.max.apply(null, dow);
    if (max >= 2 && dow.filter(function(v) { return v === max; }).length === 1) {
      out.push({ icon: 'calendar-days', color: 'var(--purple)', text: '<strong>' + names[dow.indexOf(max)] + '</strong> bring the most new leads.' });
    }
  }

  // Deals closing within 7 days
  const now = Date.now();
  const week = deals.filter(function(d) {
    if (!d.closingDate) return false;
    const t = new Date(d.closingDate).getTime();
    return t >= now - 86400000 && t <= now + 7 * 86400000;
  });
  if (week.length > 0) {
    let total = 0; week.forEach(function(d) { total += d.amount || 0; });
    out.push({ icon: 'dollar-sign', color: 'var(--green)', text: '<strong>' + week.length + ' deal' + (week.length === 1 ? '' : 's') + '</strong>' + (total > 0 ? ' worth ' + fmtMoney(total) : '') + ' close within 7 days.' });
  }

  // Lead flow trend
  const prev = prevWindowCount(contacts, days);
  if (prev > 0 && ranged.length !== prev) {
    const pct = Math.round(((ranged.length - prev) / prev) * 100);
    if (Math.abs(pct) >= 15) {
      out.push({
        icon: pct > 0 ? 'trending-up' : 'trending-down',
        color: pct > 0 ? 'var(--green)' : 'var(--red)',
        text: 'Lead flow is <strong>' + (pct > 0 ? 'up ' : 'down ') + Math.abs(pct) + '%</strong> vs the prior period.'
      });
    }
  }

  // Unresponsive
  const twoDaysAgo = now - 48 * 3600000;
  const unresp = contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() < twoDaysAgo && !c.lastTouchAt;
  }).length;
  if (unresp > 0) {
    out.push({ icon: 'alert-circle', color: '#d97706', text: '<strong>' + unresp + ' lead' + (unresp === 1 ? ' hasn\'t' : 's haven\'t') + '</strong> been touched in 48h+.' });
  }

  // Goal pace
  const nowD = new Date();
  const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
  const monthCount = contacts.filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= monthStart; }).length;
  const goal = goalTarget();
  const daysIn = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const elapsed = nowD.getDate() / daysIn;
  if (goal > 0 && elapsed > 0.15) {
    const pace = (monthCount / goal) / elapsed;
    if (pace >= 1) out.push({ icon: 'target', color: 'var(--green)', text: 'You\'re <strong>on pace</strong> for your ' + goal + '-lead monthly goal.' });
    else if (pace < 0.7) out.push({ icon: 'target', color: '#d97706', text: 'You\'re <strong>behind pace</strong> for your ' + goal + '-lead monthly goal.' });
  }

  return out.slice(0, 4);
}

function renderInsights(data, ranged, days) {
  const el = document.getElementById('insights-list');
  if (!el) return;
  const items = buildInsights(data, ranged, days);
  if (items.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:22px 16px;"><i data-lucide="lightbulb"></i>' +
      '<div class="empty-state-title">No insights yet</div>' +
      '<div class="empty-state-sub">Findings appear automatically as your lead data grows.</div></div>';
    return;
  }
  el.innerHTML = items.map(function(it) {
    return '<div class="insight-row">' +
      '<div class="insight-icon" style="color:' + it.color + ';"><i data-lucide="' + it.icon + '"></i></div>' +
      '<div class="insight-text">' + it.text + '</div>' +
      '</div>';
  }).join('');
}

/* ── Pipeline funnel ────────────────────────────────────────────────────────── */
function renderFunnel(data, ranged) {
  const el = document.getElementById('funnel');
  if (!el) return;
  const overview = data.overview || {};
  const total = ranged.length;
  if (total === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:28px 20px;"><i data-lucide="filter"></i>' +
      '<div class="empty-state-title">No leads in this period</div>' +
      '<div class="empty-state-sub">The funnel fills in as leads flow through your pipeline.</div></div>';
    return;
  }
  const qualified = ranged.filter(function(c) { return c.status && String(c.status).trim() !== ''; }).length;
  const booked = Math.min(overview.bookedCalls || 0, total);
  const won = (data.deals || []).filter(function(d) { return String(d.stage || '').toUpperCase().indexOf('WON') !== -1; }).length;
  const stages = [
    { name: 'Leads',     n: total,     color: 'var(--blue)' },
    { name: 'Qualified', n: qualified, color: '#8b5cf6' },
    { name: 'Booked',    n: booked,    color: '#0d9488' },
    { name: 'Won',       n: won,       color: 'var(--green)' },
  ];
  el.innerHTML = stages.map(function(s, i) {
    const pct = Math.max(3, Math.round((s.n / total) * 100));
    const conv = i > 0 && stages[i-1].n > 0 ? Math.round((s.n / stages[i-1].n) * 100) + '%' : '';
    return '<div class="funnel-row">' +
      '<div class="funnel-name">' + s.name + '</div>' +
      '<div class="funnel-track"><div class="funnel-fill" style="width:' + pct + '%;background:' + s.color + ';"></div></div>' +
      '<div class="funnel-n">' + s.n + '</div>' +
      '<div class="funnel-conv">' + conv + '</div>' +
      '</div>';
  }).join('');
}

/* ── CSV export ─────────────────────────────────────────────────────────────── */
function exportLeadsCsv() {
  const rows = window.__leadsFiltered && window.__leadsFiltered.length
    ? window.__leadsFiltered
    : (window.__crmData ? window.__crmData.contacts : []);
  leadsCsvDownload(rows);
}
window.exportLeadsCsv = exportLeadsCsv;

function leadsCsvDownload(rows) {
  if (!rows.length) { if (typeof showToast === 'function') showToast('No leads to export.'); return; }
  const esc = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  const head = ['Name','Email','Phone','Source','Status','Last Activity','Created'];
  const lines = [head.map(esc).join(',')].concat(rows.map(function(c) {
    return [c.name, c.email, c.phone, c.source, c.status,
      c.lastTouchAt ? new Date(c.lastTouchAt).toLocaleDateString() : '',
      c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''].map(esc).join(',');
  }));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flowaify-leads-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  if (typeof showToast === 'function') showToast('Exported ' + rows.length + ' leads to CSV.');
}
window.leadsCsvDownload = leadsCsvDownload;

/* ── Printable report ───────────────────────────────────────────────────────── */
/* ── Report Editor ───────────────────────────────────────────────────────────── */
var __reDays     = 30;
var __reSections = { kpis: true, sources: true, funnel: true, insights: true, topleads: true, stages: true };
var __reType     = 'full';

function openReportEditor() {
  var drawer = document.getElementById('report-editor-drawer');
  if (!drawer) return;
  try {
    var sub = window.__userSub || 'anon';
    var s = JSON.parse(localStorage.getItem('flw_settings_' + sub) || '{}');
    var rf = document.getElementById('re-report-for');
    var rs = document.getElementById('re-signed-by');
    if (rf && !rf.value) rf.value = s.businessName || '';
    if (rs && !rs.value) rs.value = s.ownerName || s.name || '';
  } catch(e) {}
  __reDays = window.__rangeDays;
  updateReportHint();
  drawer.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeReportEditor() {
  var drawer = document.getElementById('report-editor-drawer');
  if (drawer) drawer.classList.remove('open');
}

function reTypeSelect(type) {
  __reType = type;
  document.querySelectorAll('.re-type-card').forEach(function(c) {
    c.classList.toggle('sel', c.dataset.type === type);
  });
  var defaults = {
    full:        { kpis: true,  sources: true,  funnel: true,  insights: true,  topleads: true,  stages: true  },
    leads:       { kpis: true,  sources: true,  funnel: false, insights: true,  topleads: true,  stages: false },
    pipeline:    { kpis: false, sources: false, funnel: true,  insights: false, topleads: false, stages: true  },
    automations: { kpis: true,  sources: false, funnel: false, insights: true,  topleads: false, stages: false },
  };
  __reSections = Object.assign({}, defaults[type] || defaults.full);
  document.querySelectorAll('.re-chk').forEach(function(cb) {
    cb.checked = !!__reSections[cb.dataset.sec];
  });
  updateReportHint();
}

function reRangeSelect(days, el) {
  __reDays = days;
  document.querySelectorAll('.re-range-btn').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  updateReportHint();
}

function reSectionToggle(sec, checked) {
  __reSections[sec] = checked;
  updateReportHint();
}

function updateReportHint() {
  var hint = document.getElementById('re-hint');
  if (!hint) return;
  var count = Object.values(__reSections).filter(Boolean).length;
  hint.textContent = count + ' section' + (count !== 1 ? 's' : '') + ' selected · Last ' + __reDays + ' days';
}

function generateReportEditor() {
  var data = window.__crmData;
  if (!data) { alert('Dashboard data is still loading. Please wait a moment.'); return; }
  var rf = document.getElementById('re-report-for');
  var rs = document.getElementById('re-signed-by');
  var reportFor = rf ? rf.value.trim() : '';
  var signedBy  = rs ? rs.value.trim() : '';
  var days = __reDays;
  var sections = __reSections;
  var ranged = filterByRange(data.contacts, days);
  var overview = data.overview || {};
  var dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  var typeLabels = { full: 'Full Performance Report', leads: 'Lead Summary', pipeline: 'Pipeline Report', automations: 'Automation Report' };
  var reportTitle = typeLabels[__reType] || 'Performance Report';
  var html = '';

  // Cover — clean, no platform branding
  html += '<div class="rp-cover">';
  html += '<div class="rp-cover-body">';
  if (reportFor) html += '<div class="rp-cover-client">' + escDash(reportFor) + '</div>';
  html += '<h1>' + reportTitle + '</h1>';
  html += '<div class="rp-cover-range">Last ' + days + ' days &nbsp;&nbsp;·&nbsp;&nbsp; ' + dateStr + '</div>';
  if (signedBy) html += '<div class="rp-cover-sig">Prepared by: ' + escDash(signedBy) + '</div>';
  html += '</div></div>';

  // Key Metrics
  if (sections.kpis) {
    var conv = ranged.length ? Math.round((Math.min(overview.bookedCalls || 0, ranged.length) / ranged.length) * 100) : 0;
    html += '<div class="rp-section"><div class="rp-section-head">Key Metrics</div>';
    html += '<div class="rp-kpi-grid">';
    html += '<div class="rp-kpi-card"><div class="rp-kpi-val">' + ranged.length + '</div><div class="rp-kpi-label">New Leads</div></div>';
    html += '<div class="rp-kpi-card"><div class="rp-kpi-val">' + (overview.bookedCalls || 0) + '</div><div class="rp-kpi-label">Booked Calls</div></div>';
    html += '<div class="rp-kpi-card"><div class="rp-kpi-val">' + fmtMoney(overview.pipelineValue) + '</div><div class="rp-kpi-label">Pipeline Value</div></div>';
    html += '<div class="rp-kpi-card"><div class="rp-kpi-val">' + conv + '%</div><div class="rp-kpi-label">Conversion Rate</div></div>';
    html += '</div></div>';
  }

  // Insights
  if (sections.insights) {
    var ins = buildInsights(data, ranged, days);
    if (ins.length) {
      html += '<div class="rp-section"><div class="rp-section-head">Insights</div>';
      html += '<ul class="rp-list">' + ins.map(function(i) { return '<li>' + i.text + '</li>'; }).join('') + '</ul></div>';
    }
  }

  // Lead Sources
  if (sections.sources) {
    var src = groupCount(ranged, function(c) { return c.source; });
    var srcRows = Object.keys(src).sort(function(a, b) { return src[b] - src[a]; })
      .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + src[k] + '</td></tr>'; }).join('');
    if (srcRows) {
      html += '<div class="rp-section"><div class="rp-section-head">Lead Sources</div>';
      html += '<table class="rp-table"><tr><th>Source</th><th>Leads</th></tr>' + srcRows + '</table></div>';
    }
  }

  // Funnel
  if (sections.funnel) {
    var qual = ranged.filter(function(c) { return c.status && String(c.status).trim(); }).length;
    var won = (data.deals || []).filter(function(d) { return String(d.stage || '').toUpperCase().indexOf('WON') !== -1; }).length;
    html += '<div class="rp-section"><div class="rp-section-head">Conversion Funnel</div>';
    html += '<table class="rp-table"><tr><th>Stage</th><th>Count</th></tr>';
    html += '<tr><td>Total Leads</td><td>' + ranged.length + '</td></tr>';
    html += '<tr><td>Qualified</td><td>' + qual + '</td></tr>';
    html += '<tr><td>Booked</td><td>' + (overview.bookedCalls || 0) + '</td></tr>';
    html += '<tr><td>Won</td><td>' + won + '</td></tr></table></div>';
  }

  // Top Leads
  if (sections.topleads) {
    var top = (data.contacts || []).slice().sort(function(a, b) {
      var r = scoreRank(b.status) - scoreRank(a.status);
      if (r !== 0) return r;
      return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    }).slice(0, 10);
    if (top.length) {
      html += '<div class="rp-section"><div class="rp-section-head">Top Leads</div>';
      html += '<table class="rp-table"><tr><th>Lead</th><th>Source</th><th>Status</th><th>Created</th></tr>';
      top.forEach(function(c) {
        html += '<tr><td>' + escDash(c.name) + '</td><td>' + escDash(c.source) + '</td><td>' + escDash(c.status || '—') + '</td><td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td></tr>';
      });
      html += '</table></div>';
    }
  }

  // Pipeline by Stage
  if (sections.stages) {
    var stgs = {};
    (data.deals || []).forEach(function(d) { var s = d.stage || 'Unknown'; stgs[s] = (stgs[s] || 0) + (d.amount || 0); });
    var stgRows = Object.keys(stgs).sort(function(a, b) { return stgs[b] - stgs[a]; })
      .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + fmtMoney(stgs[k]) + '</td></tr>'; }).join('');
    if (stgRows) {
      html += '<div class="rp-section"><div class="rp-section-head">Pipeline by Stage</div>';
      html += '<table class="rp-table"><tr><th>Stage</th><th>Value</th></tr>' + stgRows + '</table></div>';
    }
  }

  html += '<div class="rp-footer"><span>Confidential &nbsp;·&nbsp; ' + dateStr + (signedBy ? ' &nbsp;·&nbsp; ' + escDash(signedBy) : '') + '</span><span class="rp-footer-brand">Flowaify</span></div>';

  var rpt = {
    id: 'rpt_' + Date.now(),
    title: reportTitle,
    type: __reType || 'full',
    days: days,
    dateStr: dateStr,
    reportFor: reportFor,
    signedBy: signedBy,
    createdAt: Date.now(),
    html: html
  };

  closeReportEditor();
  if (typeof showPage === 'function') showPage('reports');
  if (typeof reportsSave === 'function') {
    reportsSave(rpt);
  }
  if (typeof showToast === 'function') showToast('Report saved.');
}

function closeReportPreview() {
  var content = document.getElementById('report-page-content');
  if (content) {
    content.innerHTML = '<div class="empty-state" style="padding:80px 20px;"><i data-lucide="bar-chart-2"></i><div class="empty-state-title">No report generated yet</div><div class="empty-state-sub">Configure and generate a report to view your performance data here.</div><button class="cmd-primary" style="margin-top:14px;" onclick="openReportEditor()"><i data-lucide="plus"></i>New Report</button></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  var pb = document.getElementById('rpt-print-btn');
  if (pb) pb.style.display = 'none';
  var sub = document.getElementById('rpt-page-sub');
  if (sub) sub.textContent = 'No report generated yet — click New Report to get started';
}

function printReportEditor() {
  document.body.classList.add('printing-report');
  window.print();
  window.addEventListener('afterprint', function() {
    document.body.classList.remove('printing-report');
  }, { once: true });
}

window.openReportEditor  = openReportEditor;
window.closeReportEditor = closeReportEditor;
window.reTypeSelect      = reTypeSelect;
window.reRangeSelect     = reRangeSelect;
window.reSectionToggle   = reSectionToggle;
window.updateReportHint  = updateReportHint;
window.generateReportEditor = generateReportEditor;
window.closeReportPreview   = closeReportPreview;
window.printReportEditor    = printReportEditor;

function openReport() {
  const data = window.__crmData;
  const el = document.getElementById('report-view');
  if (!el || !data) return;
  const days = window.__rangeDays;
  const ranged = filterByRange(data.contacts, days);
  const overview = data.overview || {};
  const src = groupCount(ranged, function(c) { return c.source; });
  const srcRows = Object.keys(src).sort(function(a, b) { return src[b] - src[a]; })
    .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + src[k] + '</td></tr>'; }).join('');
  const stages = {};
  (data.deals || []).forEach(function(d) { const s = d.stage || 'Unknown'; stages[s] = (stages[s] || 0) + (d.amount || 0); });
  const stageRows = Object.keys(stages).sort(function(a, b) { return stages[b] - stages[a]; })
    .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + fmtMoney(stages[k]) + '</td></tr>'; }).join('');
  const insights = buildInsights(data, ranged, days)
    .map(function(it) { return '<li>' + it.text + '</li>'; }).join('');

  el.innerHTML =
    '<h1>Flowaify — Performance Report</h1>' +
    '<p class="rp-sub">Last ' + days + ' days · Generated ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + '</p>' +
    '<div class="rp-kpis">' +
      '<div><b>' + ranged.length + '</b><span>New Leads</span></div>' +
      '<div><b>' + (overview.bookedCalls || 0) + '</b><span>Booked Calls</span></div>' +
      '<div><b>' + fmtMoney(overview.pipelineValue) + '</b><span>Pipeline Value</span></div>' +
      '<div><b>' + (data.contacts || []).length + '</b><span>Total Contacts</span></div>' +
    '</div>' +
    (insights ? '<h2>Insights</h2><ul>' + insights + '</ul>' : '') +
    '<h2>Lead Sources</h2><table><tr><th>Source</th><th>Leads</th></tr>' + srcRows + '</table>' +
    (stageRows ? '<h2>Pipeline by Stage</h2><table><tr><th>Stage</th><th>Value</th></tr>' + stageRows + '</table>' : '') +
    '<p class="rp-foot">Prepared by Flowaify · flowaify.app</p>';
  window.print();
}
window.openReport = openReport;

/* ── Custom reports (Flowy-driven) ──────────────────────────────────────────── */
function openCustomReport(cfg) {
  const data = window.__crmData;
  const el = document.getElementById('report-view');
  if (!el || !data) return;
  const days = cfg.days || 30;
  const sections = cfg.sections || ['kpis', 'sources', 'funnel', 'insights', 'topleads', 'stages'];
  const ranged = filterByRange(data.contacts, days);
  const overview = data.overview || {};
  let out = '<h1>Flowaify — Custom Report</h1>' +
    '<p class="rp-sub">' + escDash(cfg.rangeLabel || ('Last ' + days + ' days')) + ' · Generated ' +
    new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + '</p>';

  if (sections.indexOf('kpis') !== -1) {
    out += '<div class="rp-kpis">' +
      '<div><b>' + ranged.length + '</b><span>New Leads</span></div>' +
      '<div><b>' + (overview.bookedCalls || 0) + '</b><span>Booked Calls</span></div>' +
      '<div><b>' + fmtMoney(overview.pipelineValue) + '</b><span>Pipeline Value</span></div>' +
      '<div><b>' + (data.contacts || []).length + '</b><span>Total Contacts</span></div>' +
      '</div>';
  }
  if (sections.indexOf('insights') !== -1) {
    const ins = buildInsights(data, ranged, days).map(function(i) { return '<li>' + i.text + '</li>'; }).join('');
    if (ins) out += '<h2>Insights</h2><ul>' + ins + '</ul>';
  }
  if (sections.indexOf('sources') !== -1) {
    const src = groupCount(ranged, function(c) { return c.source; });
    const rows = Object.keys(src).sort(function(a, b) { return src[b] - src[a]; })
      .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + src[k] + '</td></tr>'; }).join('');
    out += '<h2>Lead Sources</h2><table><tr><th>Source</th><th>Leads</th></tr>' + (rows || '<tr><td colspan="2">No leads in this period</td></tr>') + '</table>';
  }
  if (sections.indexOf('funnel') !== -1) {
    const qual = ranged.filter(function(c) { return c.status && String(c.status).trim(); }).length;
    const won = (data.deals || []).filter(function(d) { return String(d.stage || '').toUpperCase().indexOf('WON') !== -1; }).length;
    out += '<h2>Conversion Funnel</h2><table><tr><th>Stage</th><th>Count</th></tr>' +
      '<tr><td>Leads</td><td>' + ranged.length + '</td></tr>' +
      '<tr><td>Qualified</td><td>' + qual + '</td></tr>' +
      '<tr><td>Booked</td><td>' + Math.min(overview.bookedCalls || 0, ranged.length || (overview.bookedCalls || 0)) + '</td></tr>' +
      '<tr><td>Won</td><td>' + won + '</td></tr></table>';
  }
  if (sections.indexOf('topleads') !== -1) {
    const top = (data.contacts || []).slice().sort(function(a, b) {
      const r = scoreRank(b.status) - scoreRank(a.status);
      if (r !== 0) return r;
      return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    }).slice(0, 10);
    out += '<h2>Top Leads</h2><table><tr><th>Lead</th><th>Source</th><th>Status</th><th>Created</th></tr>' +
      top.map(function(c) {
        return '<tr><td>' + escDash(c.name) + '</td><td>' + escDash(c.source) + '</td><td>' +
          escDash(c.status || 'Unscored') + '</td><td>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td></tr>';
      }).join('') + '</table>';
  }
  if (sections.indexOf('stages') !== -1) {
    const stages = {};
    (data.deals || []).forEach(function(d) { const s = d.stage || 'Unknown'; stages[s] = (stages[s] || 0) + (d.amount || 0); });
    const rows2 = Object.keys(stages).sort(function(a, b) { return stages[b] - stages[a]; })
      .map(function(k) { return '<tr><td>' + escDash(k) + '</td><td>' + fmtMoney(stages[k]) + '</td></tr>'; }).join('');
    if (rows2) out += '<h2>Pipeline by Stage</h2><table><tr><th>Stage</th><th>Value</th></tr>' + rows2 + '</table>';
  }
  out += '<p class="rp-foot">Prepared by Flowy · Flowaify · flowaify.app</p>';
  el.innerHTML = out;
  window.print();
}
window.openCustomReport = openCustomReport;

function openLeadReport(id) {
  const data = window.__crmData;
  const el = document.getElementById('report-view');
  if (!el || !data) return;
  const c = (data.contacts || []).find(function(x) { return String(x.id) === String(id); });
  if (!c) return;

  const events = [];
  if (c.createdAt) events.push({ ts: new Date(c.createdAt).getTime(), text: 'Lead created' + (c.source ? ' via ' + c.source : '') });
  if (c.lastTouchAt) events.push({ ts: new Date(c.lastTouchAt).getTime(), text: (c.lastTouch || 'Touch') + ' — most recent contact' });
  events.sort(function(a, b) { return a.ts - b.ts; });

  const relatedDeals = (data.deals || []).filter(function(d) {
    const last = String(c.name || '').split(/\s+/).pop();
    return last && last.length > 2 && String(d.name || '').toLowerCase().indexOf(last.toLowerCase()) !== -1;
  });

  let nextStep;
  const st = String(c.status || '').toUpperCase();
  if (st.indexOf('HOT') !== -1) nextStep = 'This lead is HOT — call today while interest is high.';
  else if (st.indexOf('BOOK') !== -1) nextStep = 'Call is booked — confirm the appointment and prepare talking points.';
  else if (st.indexOf('WARM') !== -1) nextStep = 'Warm lead — a personal follow-up this week keeps momentum.';
  else if (!c.lastTouchAt) nextStep = 'No touches recorded yet — reach out with a first personal message.';
  else nextStep = 'Keep the automated sequence running and monitor for engagement.';

  el.innerHTML = '<h1>Lead Report — ' + escDash(c.name) + '</h1>' +
    '<p class="rp-sub">Generated ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + ' · Prepared by Flowy</p>' +
    '<div class="rp-kpis">' +
      '<div><b>' + escDash(c.status || 'Unscored') + '</b><span>Status</span></div>' +
      '<div><b>' + escDash(c.source || 'Unknown') + '</b><span>Source</span></div>' +
      '<div><b>' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</b><span>Created</span></div>' +
      '<div><b>' + (c.lastTouchAt ? new Date(c.lastTouchAt).toLocaleDateString() : 'Never') + '</b><span>Last Touch</span></div>' +
    '</div>' +
    '<h2>Contact</h2><table>' +
      (c.email ? '<tr><td>Email</td><td>' + escDash(c.email) + '</td></tr>' : '') +
      (c.phone ? '<tr><td>Phone</td><td>' + escDash(c.phone) + '</td></tr>' : '') +
    '</table>' +
    (c.score ? '<h2>Urgency Score</h2><p style="font-size:12px;line-height:1.7;">' + escDash(c.score) + '</p>' : '') +
    (c.insight ? '<h2>Insight</h2><p style="font-size:12px;line-height:1.7;">' + escDash(c.insight) + '</p>' : '') +
    (c.summary ? '<h2>AI Summary</h2><p style="font-size:12px;line-height:1.7;">' + escDash(c.summary) + '</p>' : '') +
    '<h2>Timeline</h2><table><tr><th>Date</th><th>Event</th></tr>' +
      (events.length ? events.map(function(e) {
        return '<tr><td>' + new Date(e.ts).toLocaleDateString() + '</td><td>' + escDash(e.text) + '</td></tr>';
      }).join('') : '<tr><td colspan="2">No recorded events yet</td></tr>') + '</table>' +
    (relatedDeals.length ? '<h2>Related Deals</h2><table><tr><th>Deal</th><th>Stage</th><th>Value</th></tr>' +
      relatedDeals.map(function(d) {
        return '<tr><td>' + escDash(d.name) + '</td><td>' + escDash(d.stage) + '</td><td>' + fmtMoney(d.amount) + '</td></tr>';
      }).join('') + '</table>' : '') +
    '<h2>Recommended Next Step</h2><p style="font-size:12px;line-height:1.7;">' + escDash(nextStep) + '</p>' +
    '<p class="rp-foot">Prepared by Flowy · Flowaify · flowaify.app</p>';
  window.print();
}
window.openLeadReport = openLeadReport;

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
  renderTopLeads(data.contacts);
  renderNeedsAttention(data.needsAttention);
  renderLeadsStats(data, ranged, days);
  populateLeadFilterOptions(data.contacts);
  applyLeadFilters();
  renderLeadIntel();
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

  renderGoalGauge(data.contacts || []);
  renderStageList(data.deals || []);
  renderBell(data.needsAttention || []);
  renderInsights(data, ranged, days);
  renderFunnel(data, ranged);
  renderMiniFunnel(data.contacts || []);
  renderCalendar();

  if (typeof lucide !== 'undefined') lucide.createIcons();

  if (typeof flowyWatch === 'function') flowyWatch(data);

  if (!window.__nudged && typeof maybeShowNudge === 'function') {
    window.__nudged = true;
    const ins = buildInsights(data, ranged, days);
    maybeShowNudge(ins.length ? ins[0].text + ' <strong>Ask me about it.</strong>' : null);
  }

  window.__kpiFirstRender = false;
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

  setKpi('val-new-leads',     overview.newLeadsToday);
  setKpi('val-response-time', overview.avgResponseTimeSecs != null ? overview.avgResponseTimeSecs + 's' : '—');
  setKpi('val-ai-replies',    overview.aiRepliesSent);
  setKpi('val-follow-ups',    overview.activeSequences);
  setKpi('val-pipeline',      fmtMoney(overview.pipelineValue));
  setKpi('val-booked-calls',  overview.bookedCalls);

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

function scoreRank(status) {
  const s = String(status || '').toUpperCase();
  if (s.indexOf('HOT') !== -1)  return 4;
  if (s.indexOf('BOOK') !== -1) return 3;
  if (s.indexOf('WARM') !== -1) return 2;
  if (s.indexOf('COLD') !== -1) return 1;
  return 0;
}

var _plFilter = 'all';

function ovSetLeadFilter(f) {
  _plFilter = f;
  document.querySelectorAll('.pl-tab').forEach(function(t) {
    t.classList.toggle('active', (t.dataset.filter || t.getAttribute('data-filter')) === f);
  });
  if (window.__crmData) renderTopLeads(window.__crmData.contacts || []);
}
window.ovSetLeadFilter = ovSetLeadFilter;

function renderTopLeads(contacts) {
  const el = document.getElementById('top-leads-list');
  if (!el) return;
  const all = contacts || [];

  const hot  = all.filter(function(c) { return scoreRank(c.status) >= 4; });
  const warm = all.filter(function(c) { return scoreRank(c.status) === 2; });
  const cold = all.filter(function(c) { return scoreRank(c.status) === 1; });

  const cntAll  = document.getElementById('pl-cnt-all');
  const cntHot  = document.getElementById('pl-cnt-hot');
  const cntWarm = document.getElementById('pl-cnt-warm');
  const cntCold = document.getElementById('pl-cnt-cold');
  if (cntAll)  cntAll.textContent  = all.length  || '';
  if (cntHot)  cntHot.textContent  = hot.length  || '';
  if (cntWarm) cntWarm.textContent = warm.length || '';
  if (cntCold) cntCold.textContent = cold.length || '';

  let filtered;
  if (_plFilter === 'hot')  filtered = hot;
  else if (_plFilter === 'warm') filtered = warm;
  else if (_plFilter === 'cold') filtered = cold;
  else filtered = all;

  if (filtered.length === 0) {
    const lbl = _plFilter === 'all' ? 'leads' : _plFilter + ' leads';
    el.innerHTML = '<div class="empty-state" style="padding:34px 20px;"><i data-lucide="users"></i>' +
      '<div class="empty-state-title">No ' + lbl + ' yet</div>' +
      '<div class="empty-state-sub">Priority leads appear here as contacts come in.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const top = filtered.slice().sort(function(a, b) {
    const r = scoreRank(b.status) - scoreRank(a.status);
    if (r !== 0) return r;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  }).slice(0, 8);

  el.innerHTML = top.map(function(c) {
    const safeId = c.id ? String(c.id).replace(/[^\w-]/g, '') : '';
    const safeName = String(c.name || '').replace(/[^\w\s.@-]/g, '');
    const lastAct = c.lastTouchAt
      ? relTime(new Date(c.lastTouchAt).getTime())
      : (c.createdAt ? relTime(new Date(c.createdAt).getTime()) : '—');
    const rank = scoreRank(c.status);
    const scorePct = rank > 0 ? Math.round((rank / 4) * 100) + '%' : '—';
    return '<div class="pl-row" onclick="bellOpenLead(\'' + safeId + '\', \'' + safeName + '\')">' +
      avatarHtml(c.name) +
      '<div class="pl-body">' +
        '<div class="pl-name">' + escDash(c.name || '—') + '</div>' +
        '<div class="pl-meta">' + (c.source ? escDash(c.source) + ' · ' : '') + lastAct + '</div>' +
      '</div>' +
      statusBadge(c.status) +
      '<div class="pl-score">' + scorePct + '</div>' +
    '</div>';
  }).join('');
}

/* Mini conversion funnel — overview widget */
function renderMiniFunnel(contacts) {
  const el = document.getElementById('ov-funnel');
  if (!el) return;
  const total = contacts.length;
  if (!total) {
    el.innerHTML = '<div class="empty-state" style="padding:26px 18px;"><i data-lucide="filter"></i>' +
      '<div class="empty-state-title">No leads yet</div>' +
      '<div class="empty-state-sub">Funnel fills in as leads come in.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  const engaged = contacts.filter(function(c) { return c.lastTouchAt || scoreRank(c.status) > 0; }).length;
  const booked = contacts.filter(function(c) { return String(c.status || '').toUpperCase().indexOf('BOOK') !== -1; }).length;
  const rows = [
    ['All Leads', total,   '#3b82f6'],
    ['Engaged',   engaged, '#0057FF'],
    ['Booked',    booked,  '#059669']
  ];
  const conv = Math.round((booked / total) * 100);
  el.innerHTML = rows.map(function(r) {
    const pct = Math.max(4, Math.round((r[1] / total) * 100));
    return '<div class="ovf-row">' +
      '<div class="ovf-label">' + r[0] + '</div>' +
      '<div class="ovf-track"><div class="ovf-fill" style="width:' + pct + '%;background:' + r[2] + ';"></div></div>' +
      '<div class="ovf-count">' + r[1] + '</div>' +
    '</div>';
  }).join('') +
  '<div class="ovf-foot">' + conv + '% lead-to-booked conversion</div>';
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

  setText('val-leads-hot', contacts.filter(function(c) { return scoreRank(c.status) === 4; }).length);
  setText('val-leads-booked', contacts.filter(function(c) { return scoreRank(c.status) === 3; }).length);
  setText('val-leads-followup', leadsNeedFollowUp(contacts).length);
}

/* No contact in 48h+ — never touched (and older than 48h) or last touch older than 48h */
function leadsNeedFollowUp(contacts) {
  const cut = Date.now() - 48 * 3600000;
  return contacts.filter(function(c) {
    const touch = c.lastTouchAt ? new Date(c.lastTouchAt).getTime() : null;
    if (touch) return touch < cut;
    const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    return created < cut;
  });
}

/* Lead score: real automation score when present; deterministic status-based fallback otherwise */
function leadScore(c) {
  const real = parseInt(c.score, 10);
  if (isFinite(real) && real >= 0 && real <= 100) return real;
  let h = 0;
  const str = String(c.id || c.name || '');
  for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) & 0x7fffffff;
  const r = scoreRank(c.status);
  if (r === 4) return 85 + (h % 11); /* HOT 85–95 */
  if (r === 3) return 70 + (h % 21); /* BOOKED 70–90 */
  if (r === 2) return 55 + (h % 21); /* WARM 55–75 */
  if (r === 1) return 25 + (h % 26); /* COLD 25–50 */
  return 15 + (h % 21);
}

function leadScoreColor(c) {
  const r = scoreRank(c.status);
  if (r === 4) return 'var(--red)';
  if (r === 3) return 'var(--green)';
  if (r === 2) return '#d97706';
  if (r === 1) return '#3b82f6';
  return 'var(--border)';
}

function leadsTabMatch(c, tab) {
  const r = scoreRank(c.status);
  if (tab === 'hot') return r === 4;
  if (tab === 'warm') return r === 2;
  if (tab === 'cold') return r === 1;
  if (tab === 'booked') return r === 3;
  if (tab === 'followup') return leadsNeedFollowUp([c]).length === 1;
  if (tab === 'noactivity') return !c.lastTouchAt;
  return true;
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

window.__leadTab = window.__leadTab || 'all';
window.__leadsPage = window.__leadsPage || 1;
window.__leadsPerPage = window.__leadsPerPage || 10;

function applyLeadFilters() {
  const data = window.__crmData;
  if (!data) return;
  const contacts = data.contacts || [];
  const q      = (document.getElementById('lead-search')   || {}).value || '';
  const status = (document.getElementById('filter-status') || {}).value || '';
  const source = (document.getElementById('filter-source') || {}).value || '';
  const rangeD = parseInt((document.getElementById('filter-range') || {}).value || '', 10);
  const ql = q.trim().toLowerCase();
  const tab = window.__leadTab || 'all';

  /* tab counts always reflect the whole book */
  const counts = { all: contacts.length, hot: 0, warm: 0, cold: 0, booked: 0, noactivity: 0 };
  contacts.forEach(function(c) {
    const r = scoreRank(c.status);
    if (r === 4) counts.hot++;
    else if (r === 3) counts.booked++;
    else if (r === 2) counts.warm++;
    else if (r === 1) counts.cold++;
    if (!c.lastTouchAt) counts.noactivity++;
  });
  counts.followup = leadsNeedFollowUp(contacts).length;
  Object.keys(counts).forEach(function(k) {
    const el = document.getElementById('ltc-' + k);
    if (el) el.textContent = '(' + counts[k] + ')';
  });

  const cutoff = isFinite(rangeD) ? Date.now() - rangeD * 86400000 : null;
  const filtered = contacts.filter(function(c) {
    if (!leadsTabMatch(c, tab)) return false;
    if (status && c.status !== status) return false;
    if (source && c.source !== source) return false;
    if (cutoff && (!c.createdAt || new Date(c.createdAt).getTime() < cutoff)) return false;
    if (ql) {
      const hay = ((c.name || '') + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase();
      if (hay.indexOf(ql) === -1) return false;
    }
    return true;
  });

  const sort = window.__leadSort;
  const dateKeys = { createdAt: 1, lastTouchAt: 1 };
  filtered.sort(function(a, b) {
    let va, vb;
    if (sort.key === 'score') {
      va = leadScore(a); vb = leadScore(b);
    } else if (dateKeys[sort.key]) {
      va = a[sort.key] ? new Date(a[sort.key]).getTime() : null;
      vb = b[sort.key] ? new Date(b[sort.key]).getTime() : null;
    } else {
      va = a[sort.key] ? String(a[sort.key]).toLowerCase() : null;
      vb = b[sort.key] ? String(b[sort.key]).toLowerCase() : null;
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return va < vb ? -1 * sort.dir : va > vb ? sort.dir : 0;
  });

  window.__leadsFiltered = filtered;
  window.__leadsPage = 1;

  /* clear-filters chip visibility */
  const clearChip = document.getElementById('lt-clear');
  if (clearChip) {
    const active = !!(ql || status || source || isFinite(rangeD) || tab !== 'all');
    clearChip.style.display = active ? '' : 'none';
  }

  renderLeadsPageSlice();
}

function leadsClearFilters() {
  const ls = document.getElementById('lead-search');   if (ls) ls.value = '';
  const fs = document.getElementById('filter-status'); if (fs) fs.value = '';
  const fo = document.getElementById('filter-source'); if (fo) fo.value = '';
  const fr = document.getElementById('filter-range');  if (fr) fr.value = '';
  leadsSetTab('all');
}
window.leadsClearFilters = leadsClearFilters;

function renderLeadsPageSlice() {
  const all = window.__leadsFiltered || [];
  const per = window.__leadsPerPage || 10;
  const pages = Math.max(1, Math.ceil(all.length / per));
  if (window.__leadsPage > pages) window.__leadsPage = pages;
  const page = window.__leadsPage;
  const from = (page - 1) * per;
  renderLeadsTable(all.slice(from, from + per));
  leadsApplyCols();
  leadsBulkSync();

  const countEl = document.getElementById('leads-page-count');
  if (countEl) countEl.textContent = all.length + ' lead' + (all.length === 1 ? '' : 's');

  const foot = document.getElementById('lt-foot');
  const info = document.getElementById('lt-foot-info');
  const pager = document.getElementById('lt-pager');
  if (!foot || !info || !pager) return;
  if (!all.length) { foot.style.display = 'none'; return; }
  foot.style.display = 'flex';
  info.textContent = 'Showing ' + (from + 1) + ' to ' + Math.min(from + per, all.length) + ' of ' + all.length + ' leads';
  let s = Math.max(1, page - 3);
  const e = Math.min(pages, s + 6);
  s = Math.max(1, e - 6);
  let h = '<button class="lt-pg" onclick="leadsSetPage(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>&lsaquo;</button>';
  for (let i = s; i <= e; i++) {
    h += '<button class="lt-pg' + (i === page ? ' active' : '') + '" onclick="leadsSetPage(' + i + ')">' + i + '</button>';
  }
  h += '<button class="lt-pg" onclick="leadsSetPage(' + (page + 1) + ')"' + (page >= pages ? ' disabled' : '') + '>&rsaquo;</button>';
  pager.innerHTML = h;
}

function leadsSetPage(n) {
  const all = window.__leadsFiltered || [];
  const pages = Math.max(1, Math.ceil(all.length / (window.__leadsPerPage || 10)));
  window.__leadsPage = Math.min(Math.max(1, n), pages);
  renderLeadsPageSlice();
}
window.leadsSetPage = leadsSetPage;

function leadsSetPerPage(v) {
  window.__leadsPerPage = parseInt(v, 10) || 10;
  window.__leadsPage = 1;
  renderLeadsPageSlice();
}
window.leadsSetPerPage = leadsSetPerPage;

function leadsSetTab(t) {
  window.__leadTab = t;
  document.querySelectorAll('.lt-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === t);
  });
  applyLeadFilters();
}
window.leadsSetTab = leadsSetTab;

function leadsCheckAll(cb) {
  document.querySelectorAll('#full-leads-tbody .lt-check').forEach(function(c) { c.checked = cb.checked; });
  leadsBulkSync();
}
window.leadsCheckAll = leadsCheckAll;

/* ── Bulk actions ────────────────────────────────────────────────────────────── */
function leadsSelectedIds() {
  return Array.from(document.querySelectorAll('#full-leads-tbody .lt-check:checked'))
    .map(function(c) { return c.getAttribute('data-id'); }).filter(Boolean);
}

function leadsBulkSync() {
  const n = leadsSelectedIds().length;
  const bar = document.getElementById('lt-bulk');
  const cnt = document.getElementById('lt-bulk-count');
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  if (cnt) cnt.textContent = n + ' selected';
  const head = document.querySelector('#page-leads thead .lt-check');
  if (head) {
    const total = document.querySelectorAll('#full-leads-tbody .lt-check').length;
    head.checked = total > 0 && n === total;
  }
}
window.leadsBulkSync = leadsBulkSync;

function leadsBulkClear() {
  document.querySelectorAll('#page-leads .lt-check').forEach(function(c) { c.checked = false; });
  leadsBulkSync();
}
window.leadsBulkClear = leadsBulkClear;

function leadsBulkExport() {
  const ids = leadsSelectedIds();
  const rows = ((window.__crmData || {}).contacts || []).filter(function(c) { return ids.indexOf(String(c.id)) !== -1; });
  leadsCsvDownload(rows);
}
window.leadsBulkExport = leadsBulkExport;

async function leadsBulkStatus(status) {
  if (typeof flwWriteBlocked === 'function' && flwWriteBlocked()) return;
  const ids = leadsSelectedIds();
  if (!ids.length) return;
  const contacts = (window.__crmData || {}).contacts || [];
  const targets = contacts.filter(function(c) { return ids.indexOf(String(c.id)) !== -1; });
  const prev = {};
  targets.forEach(function(c) { prev[c.id] = c.status; c.status = status; }); /* optimistic */
  rerender();
  let fails = 0;
  for (let i = 0; i < targets.length; i++) {
    const ok = await updateLead(targets[i].id, { status: status });
    if (!ok) { targets[i].status = prev[targets[i].id]; fails++; }
  }
  if (fails) rerender();
  if (typeof showToast === 'function') {
    showToast(fails
      ? (targets.length - fails) + ' updated, ' + fails + ' failed.'
      : targets.length + ' lead' + (targets.length === 1 ? '' : 's') + ' marked ' + status + '.');
  }
  leadsBulkClear();
}
window.leadsBulkStatus = leadsBulkStatus;

function sortLeads(key) {
  const s = window.__leadSort;
  if (s.key === key) s.dir = -s.dir;
  else { s.key = key; s.dir = (key === 'createdAt' || key === 'lastTouchAt' || key === 'score') ? -1 : 1; }
  document.querySelectorAll('.th-sort').forEach(function(th) {
    th.classList.remove('asc', 'desc');
    if (th.getAttribute('data-sort') === s.key) th.classList.add(s.dir === 1 ? 'asc' : 'desc');
  });
  applyLeadFilters();
}
window.sortLeads = sortLeads;

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
  tbody.innerHTML = contacts.map(leadRowHtml).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function leadTouchLabel(c) {
  if (c.lastTouchAt) return relTime(new Date(c.lastTouchAt).getTime());
  return 'No touch yet';
}

function leadRowHtml(c) {
  const sel = c.id === window.__selectedLeadId ? ' class="row-selected"' : '';
  const safeId = String(c.id).replace(/[^\w-]/g, '');
  return '<tr' + sel + ' data-id="' + escDash(c.id) + '" onclick="selectLead(\'' + safeId + '\')">' +
    '<td data-col="check" onclick="event.stopPropagation()"><input type="checkbox" class="lt-check" data-id="' + escDash(c.id) + '" onchange="leadsBulkSync()" /></td>' +
    '<td><div class="lead-cell">' + avatarHtml(c.name) + '<div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div></div></td>' +
    '<td data-col="contact">' +
    (c.email ? '<div style="font-size:11.5px;">' + escDash(c.email) + '</div>' : '') +
    (c.phone ? '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(c.phone) + '</div>' : '') +
    ((!c.email && !c.phone) ? '<span style="font-size:11.5px;color:var(--text-m);">No contact info</span>' : '') +
    '</td>' +
    '<td data-col="source" style="font-size:12px;">' + (c.source ? escDash(c.source) : '<span style="color:var(--text-m);">—</span>') + '</td>' +
    '<td data-col="status">' + statusBadge(c.status) + '</td>' +
    '<td data-col="touch" style="font-size:12px;color:' + (c.lastTouchAt ? 'var(--text-s)' : 'var(--text-m)') + ';">' + leadTouchLabel(c) + '</td>' +
    '<td data-col="score"><span class="score-ring" style="border-color:' + leadScoreColor(c) + ';">' + leadScore(c) + '</span></td>' +
    '<td data-col="created" style="font-size:12px;">' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—') + '</td>' +
    '<td data-col="actions" onclick="event.stopPropagation()" style="white-space:nowrap;">' +
      '<button class="row-act" title="View profile" onclick="selectLead(\'' + safeId + '\')"><i data-lucide="eye"></i></button>' +
      '<button class="row-act" title="More actions" onclick="leadRowMenu(event, \'' + safeId + '\')"><i data-lucide="more-vertical"></i></button>' +
    '</td>' +
    '</tr>';
}

function selectLead(id) {
  const data = window.__crmData;
  if (!data) return;
  const c = (data.contacts || []).find(function(x) {
    return String(x.id) === String(id) || String(x.id).replace(/[^\w-]/g, '') === String(id);
  });
  if (!c) return;
  window.__selectedLeadId = c.id;

  document.querySelectorAll('#full-leads-tbody tr').forEach(function(tr) {
    tr.classList.toggle('row-selected', tr.getAttribute('data-id') === String(c.id));
  });

  const title = document.getElementById('lead-panel-title');
  const back = document.getElementById('lead-panel-back');
  if (title) title.textContent = 'Lead Profile';
  if (back) back.style.display = '';

  const body = document.getElementById('lead-detail-body');
  if (!body) return;
  const safeId = String(c.id).replace(/[^\w-]/g, '');

  const rows = [];
  rows.push('<div class="lp-head">' + avatarHtml(c.name) +
    '<div style="flex:1;min-width:0;">' +
      '<div class="lp-name">' + escDash(c.name) + '</div>' +
      '<div class="lp-meta">' + (c.source ? escDash(c.source) + ' · ' : '') + (c.createdAt ? 'Added ' + new Date(c.createdAt).toLocaleDateString() : '') + '</div>' +
      '<div style="margin-top:7px;display:flex;align-items:center;gap:8px;">' + statusBadge(c.status) +
        '<span class="score-ring" style="border-color:' + leadScoreColor(c) + ';">' + leadScore(c) + '</span></div>' +
    '</div></div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">Contact</div>');
  if (c.email) rows.push('<div class="detail-row"><span class="dk">Email</span><a class="dv" style="color:var(--blue);" href="mailto:' + escDash(c.email) + '">' + escDash(c.email) + '</a></div>');
  if (c.phone) rows.push('<div class="detail-row"><span class="dk">Phone</span><a class="dv" style="color:var(--blue);" href="tel:' + escDash(c.phone) + '">' + escDash(c.phone) + '</a></div>');
  if (!c.email && !c.phone) rows.push('<div style="font-size:11.5px;color:var(--text-m);">No contact details synced yet.</div>');
  rows.push('</div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">Set Status</div>');
  rows.push('<div class="status-picker">' + ['HOT','WARM','COLD','BOOKED'].map(function(s) {
    const active = String(c.status || '').toUpperCase().indexOf(s) !== -1 ? ' active' : '';
    return '<button class="status-chip sc-' + s.toLowerCase() + active + '" onclick="setLeadStatus(\'' + safeId + '\', \'' + s + '\')">' + s + '</button>';
  }).join('') + '</div></div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">AI Summary</div>');
  if (c.summary) {
    rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + escDash(c.summary) + '</div>');
  } else {
    rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;">This lead came in' + (c.source ? ' from ' + escDash(c.source) : '') +
      (!c.lastTouchAt
        ? ' and has no recorded touch yet. Recommended next step: send a first follow-up.'
        : ' and was last touched ' + relTime(new Date(c.lastTouchAt).getTime()) + '.') + '</div>');
  }
  if (c.insight) rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;margin-top:6px;">' + escDash(c.insight) + '</div>');
  rows.push('</div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">Next Best Action</div><div class="lp-actions">');
  rows.push('<button class="lp-act-btn" onclick="leadSendFollowUp(\'' + safeId + '\')"><i data-lucide="send"></i>Send follow-up</button>');
  rows.push('<button class="lp-act-btn" onclick="leadMarkBooked(\'' + safeId + '\')"><i data-lucide="calendar-check"></i>Mark booked</button>');
  rows.push('</div></div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">Add Note</div>');
  rows.push('<textarea id="lead-note-input" class="lead-note" rows="2" placeholder="Type a note — saves to your CRM…"></textarea>');
  rows.push('<button class="btn-mini btn-mini-primary" id="lead-note-save" style="margin-top:6px;" onclick="saveLeadNote(\'' + safeId + '\')">Save note</button>');
  rows.push('</div>');

  rows.push('<div class="lp-sec"><div class="lp-sec-label">Activity Timeline</div>');
  if (c.createdAt) {
    rows.push('<div class="lp-tl-item"><div class="lp-tl-dot"></div><div><div class="lp-tl-text">Created in CRM</div><div class="lp-tl-time">' + new Date(c.createdAt).toLocaleDateString() + '</div></div></div>');
  }
  rows.push('<div class="lp-tl-item"><div class="lp-tl-dot"></div><div><div class="lp-tl-text">Synced to Flowaify</div><div class="lp-tl-time">Live</div></div></div>');
  if (c.lastTouchAt) {
    rows.push('<div class="lp-tl-item"><div class="lp-tl-dot"></div><div><div class="lp-tl-text">' + (c.lastTouch ? escDash(c.lastTouch) : 'Touch logged') + '</div><div class="lp-tl-time">' + relTime(new Date(c.lastTouchAt).getTime()) + '</div></div></div>');
  } else {
    rows.push('<div class="lp-tl-item"><div class="lp-tl-dot muted"></div><div><div class="lp-tl-text" style="color:var(--text-m);">No outreach yet</div></div></div>');
  }
  rows.push('</div>');

  body.innerHTML = rows.join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.selectLead = selectLead;

function leadDeselect() {
  window.__selectedLeadId = null;
  document.querySelectorAll('#full-leads-tbody tr').forEach(function(tr) { tr.classList.remove('row-selected'); });
  renderLeadIntel();
}
window.leadDeselect = leadDeselect;

/* ── Lead Intelligence (default right-panel state) ──────────────────────────── */
function renderLeadIntel() {
  if (window.__selectedLeadId) return;
  const body = document.getElementById('lead-detail-body');
  if (!body) return;
  const title = document.getElementById('lead-panel-title');
  const back = document.getElementById('lead-panel-back');
  if (title) title.textContent = 'Lead Intelligence';
  if (back) back.style.display = 'none';

  const contacts = (window.__crmData && window.__crmData.contacts) || [];
  if (!contacts.length) {
    body.innerHTML = '<div class="empty-state" style="padding:40px 16px;"><i data-lucide="user-circle"></i>' +
      '<div class="empty-state-title">No leads yet</div>' +
      '<div class="empty-state-sub">Intelligence appears here once leads sync from your CRM.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const followup = leadsNeedFollowUp(contacts).length;
  const hot = contacts.filter(function(c) { return scoreRank(c.status) === 4; }).length;
  const hotNoTouch = contacts.filter(function(c) { return scoreRank(c.status) === 4 && !c.lastTouchAt; }).length;
  const srcCounts = groupCount(contacts.filter(function(c) { return c.source; }), function(c) { return c.source; });
  const topSrc = Object.keys(srcCounts).sort(function(a, b) { return srcCounts[b] - srcCounts[a]; })[0] || null;

  let h = '<div class="li-grid">';
  h += '<div class="li-card"><div class="li-icon" style="color:#d97706;"><i data-lucide="alert-triangle"></i></div>' +
    '<div class="li-num">' + followup + '</div><div class="li-sub">Needs follow-up<br>No contact in 48h+</div>' +
    '<button class="li-btn" onclick="leadsSetTab(\'followup\')">Review leads</button></div>';
  h += '<div class="li-card"><div class="li-icon" style="color:var(--blue);"><i data-lucide="globe"></i></div>' +
    '<div class="li-title">' + (topSrc ? escDash(topSrc) : 'No source data') + '</div>' +
    '<div class="li-sub">Top source' + (topSrc ? '<br>' + srcCounts[topSrc] + ' lead' + (srcCounts[topSrc] === 1 ? '' : 's') + ' this period' : '') + '</div>' +
    (topSrc ? '<button class="li-btn" onclick="leadsFilterSource(decodeURIComponent(\'' + encodeURIComponent(topSrc) + '\'))">View source</button>' : '') + '</div>';
  h += '<div class="li-card"><div class="li-icon" style="color:var(--red);"><i data-lucide="flame"></i></div>' +
    '<div class="li-num">' + hot + '</div><div class="li-sub">Hot leads<br>Require immediate attention</div>' +
    '<button class="li-btn" onclick="leadsSetTab(\'hot\')">View hot leads</button></div>';
  h += '<div class="li-card"><div class="li-icon" style="color:var(--purple);"><i data-lucide="sparkles"></i></div>' +
    '<div class="li-title">Best next action</div>' +
    '<div class="li-sub">' + (hotNoTouch > 0
      ? 'Start with ' + hotNoTouch + ' hot lead' + (hotNoTouch === 1 ? '' : 's') + ' that ' + (hotNoTouch === 1 ? 'has' : 'have') + ' no activity.'
      : 'Work the follow-up queue, oldest first.') + '</div>' +
    '<button class="li-btn" onclick="if(window.flowyExplain)flowyExplain(\'which leads I should follow up with first\')">See suggestions</button></div>';
  h += '</div>';

  const recent = contacts.slice().sort(function(a, b) {
    return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
  }).slice(0, 3);
  if (recent.length) {
    h += '<div class="li-sec-label">Recently Added<span class="sec-link" onclick="leadsSetTab(\'all\')">View all</span></div>';
    h += recent.map(function(c) {
      const safeId = String(c.id).replace(/[^\w-]/g, '');
      return '<div class="li-recent-row" onclick="selectLead(\'' + safeId + '\')">' + avatarHtml(c.name) +
        '<div style="flex:1;min-width:0;"><div class="li-recent-name">' + escDash(c.name) + '</div>' +
        '<div class="li-recent-sub">' + (c.source ? escDash(c.source) + ' · ' : '') + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '') + '</div></div></div>';
    }).join('');
    h += '<div style="height:10px;"></div>';
  }
  body.innerHTML = h;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function leadsFilterSource(src) {
  const sel = document.getElementById('filter-source');
  if (sel) sel.value = src;
  applyLeadFilters();
}
window.leadsFilterSource = leadsFilterSource;

/* ── Lead row actions ────────────────────────────────────────────────────────── */
function leadSendFollowUp(id) {
  const c = ((window.__crmData || {}).contacts || []).find(function(x) {
    return String(x.id).replace(/[^\w-]/g, '') === String(id);
  });
  if (!c) return;
  if (!c.email) { showToast('This lead has no email address on file.'); return; }
  if (typeof showPage === 'function') showPage('inbox');
  setTimeout(function() {
    if (window.openCompose) openCompose({ to: c.email, subject: 'Following up — ' + (c.name || '') });
  }, 250);
}
window.leadSendFollowUp = leadSendFollowUp;

function leadMarkBooked(id) {
  if (typeof setLeadStatus === 'function') setLeadStatus(id, 'BOOKED');
}
window.leadMarkBooked = leadMarkBooked;

function leadRowMenu(e, id) {
  e.stopPropagation();
  const m = document.getElementById('lead-row-menu');
  if (!m) return;
  m.innerHTML =
    '<div class="card-ctx-item" onclick="selectLead(\'' + id + '\')"><i data-lucide="eye"></i>View profile</div>' +
    '<div class="card-ctx-item" onclick="leadSendFollowUp(\'' + id + '\')"><i data-lucide="send"></i>Send follow-up</div>' +
    '<div class="card-ctx-item" onclick="leadMarkBooked(\'' + id + '\')"><i data-lucide="calendar-check"></i>Mark booked</div>';
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.left = Math.max(8, r.right - 165) + 'px';
  m.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.leadRowMenu = leadRowMenu;

/* ── Column visibility ───────────────────────────────────────────────────────── */
const LEAD_COLS = { contact: 'Contact', source: 'Source', status: 'Status', touch: 'Last Touch', score: 'Score', created: 'Created' };

function leadsColsKey() { return 'flw_lead_cols_' + (window.__userSub || 'anon'); }

function leadsHiddenCols() {
  try { return JSON.parse(localStorage.getItem(leadsColsKey()) || '[]'); } catch(e) { return []; }
}

function leadsApplyCols() {
  const hidden = leadsHiddenCols();
  let styleEl = document.getElementById('lead-cols-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'lead-cols-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = hidden.map(function(c) {
    return '#page-leads .lead-table [data-col="' + c + '"] { display: none; }';
  }).join('\n');
}

function leadsColsToggle(e) {
  e.stopPropagation();
  const m = document.getElementById('cols-menu');
  if (!m) return;
  if (m.classList.contains('open')) { m.classList.remove('open'); return; }
  const hidden = leadsHiddenCols();
  m.innerHTML = Object.keys(LEAD_COLS).map(function(c) {
    const on = hidden.indexOf(c) === -1;
    return '<div class="cols-item" onclick="leadsColToggle(event, \'' + c + '\')"><input type="checkbox"' + (on ? ' checked' : '') + ' />' + LEAD_COLS[c] + '</div>';
  }).join('');
  const r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.left = Math.max(8, r.right - 170) + 'px';
  m.classList.add('open');
}
window.leadsColsToggle = leadsColsToggle;

function leadsColToggle(e, c) {
  e.stopPropagation();
  let hidden = leadsHiddenCols();
  if (hidden.indexOf(c) === -1) hidden.push(c);
  else hidden = hidden.filter(function(x) { return x !== c; });
  try { localStorage.setItem(leadsColsKey(), JSON.stringify(hidden)); } catch(err) {}
  leadsApplyCols();
  const cb = e.currentTarget.querySelector('input');
  if (cb) cb.checked = hidden.indexOf(c) === -1;
}
window.leadsColToggle = leadsColToggle;

document.addEventListener('click', function() {
  const m = document.getElementById('cols-menu');
  if (m) m.classList.remove('open');
  const rm = document.getElementById('lead-row-menu');
  if (rm) rm.classList.remove('open');
});

/* ── Activity feed ──────────────────────────────────────────────────────────── */
function buildActivityFeed(data, days) {
  const cutoff = Date.now() - days * 86400000;
  const events = [];

  (data.contacts || []).forEach(function(c) {
    if (c.createdAt) {
      const t = new Date(c.createdAt).getTime();
      if (t >= cutoff) events.push({ type: 'lead_created', ts: t, name: c.name, source: c.source, id: c.id });
    }
    if (c.lastTouchAt) {
      const t2 = new Date(c.lastTouchAt).getTime();
      if (t2 >= cutoff) {
        events.push({ type: 'touch', ts: t2, name: c.name, touchType: c.lastTouch, status: c.status, id: c.id });
        if (scoreRank(c.status) === 3) {
          events.push({ type: 'booking', ts: t2, name: c.name, source: c.source, id: c.id });
        }
      }
    }
  });

  (data.deals || []).forEach(function(d) {
    if (d.createdAt) {
      const t3 = new Date(d.createdAt).getTime();
      if (t3 >= cutoff) events.push({ type: 'deal', ts: t3, name: d.name, stage: d.stage, amount: d.amount });
    }
  });

  /* warning fires 48h after creation with no recorded touch */
  (data.needsAttention || []).forEach(function(c) {
    const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    if (!created) return;
    const t4 = Math.min(created + 48 * 3600000, Date.now());
    if (t4 >= cutoff) events.push({ type: 'warning', ts: t4, name: c.name, status: c.status, id: c.id });
  });

  events.sort(function(a, b) { return b.ts - a.ts; });
  return events;
}

const FEED_ICON = {
  lead_created: { icon: 'user-plus',      bg: 'rgba(0,87,255,.13)',    color: '#0057FF' },
  touch:        { icon: 'sparkles',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
  ai_reply:     { icon: 'sparkles',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
  deal:         { icon: 'dollar-sign',    bg: 'rgba(5,150,105,.13)',   color: '#059669' },
  booking:      { icon: 'calendar-check', bg: 'rgba(5,150,105,.13)',   color: '#059669' },
  warning:      { icon: 'alert-triangle', bg: 'rgba(217,119,6,.13)',   color: '#d97706' },
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
  if (ev.type === 'booking') {
    return 'Call booked with <strong>' + escDash(ev.name) + '</strong>';
  }
  if (ev.type === 'warning') {
    return '<strong>' + escDash(ev.name) + '</strong> has had no contact in 48h+';
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
  renderActivityPage(data, days, events);

  // Overview "Live Activity" (compact)
  renderActivityFeed(events, 'ov-activity', {
    limit: 6,
    emptyTitle: 'No activity yet',
    emptySub: 'New leads, touches, and booked calls will appear here as they happen.',
  });

  // Automations "Recent Activity" — owned by settings.js renderAutoActivity
  // (shaped-contact event stream). Delegate so the two writers never fight.
  if (window.renderAutoActivity) renderAutoActivity(data.contacts || []);

}

/* ── Activity page — operational history & review ───────────────────────────── */
var _actTab = 'all';
var _actSel = null;

const ACT_META = {
  lead_created: { title: 'New lead entered pipeline', pill: 'New Lead',     dot: '#3b82f6' },
  touch:        { title: 'Follow-up sent',            pill: 'Completed',    dot: 'var(--green)' },
  ai_reply:     { title: 'AI reply sent',             pill: 'Completed',    dot: 'var(--green)' },
  deal:         { title: 'Deal record updated',       pill: 'Updated',      dot: '#64748b' },
  booking:      { title: 'Call booked',               pill: 'Completed',    dot: 'var(--green)' },
  warning:      { title: 'No contact in 48h+',        pill: 'Needs Review', dot: '#d97706' }
};

function actEvSub(ev) {
  if (ev.type === 'lead_created') return escDash(ev.name) + (ev.source ? ' came in via ' + escDash(ev.source) : ' entered the pipeline');
  if (ev.type === 'touch' || ev.type === 'ai_reply') return (ev.touchType ? escDash(ev.touchType) + ' sent to ' : 'Touch logged for ') + escDash(ev.name);
  if (ev.type === 'deal') return escDash(ev.name) + (ev.stage ? ' · ' + escDash(ev.stage) : '') + (ev.amount != null ? ' · ' + fmtMoney(ev.amount) : '');
  if (ev.type === 'booking') return 'Call booked with ' + escDash(ev.name);
  if (ev.type === 'warning') return escDash(ev.name) + ' has not been contacted in 48 hours';
  return escDash(ev.name);
}

function actTabMatch(ev, tab) {
  if (tab === 'leads') return ev.type === 'lead_created';
  if (tab === 'followups') return ev.type === 'touch' || ev.type === 'ai_reply';
  if (tab === 'deals') return ev.type === 'deal';
  if (tab === 'bookings') return ev.type === 'booking';
  if (tab === 'warnings') return ev.type === 'warning';
  return true;
}

function renderActivityPage(data, days, events) {
  window.__actEvents = events;
  const contacts = data.contacts || [];

  setText('act-kpi-key', events.length);
  setText('act-kpi-followup', leadsNeedFollowUp(contacts).length);
  setText('act-kpi-bookings', events.filter(function(e) { return e.type === 'booking'; }).length);
  setText('act-kpi-updates', events.filter(function(e) { return e.type === 'lead_created' || e.type === 'touch' || e.type === 'ai_reply'; }).length);

  const counts = { all: events.length, leads: 0, followups: 0, deals: 0, bookings: 0, warnings: 0 };
  events.forEach(function(ev) {
    if (ev.type === 'lead_created') counts.leads++;
    else if (ev.type === 'touch' || ev.type === 'ai_reply') counts.followups++;
    else if (ev.type === 'deal') counts.deals++;
    else if (ev.type === 'booking') counts.bookings++;
    else if (ev.type === 'warning') counts.warnings++;
  });
  Object.keys(counts).forEach(function(k) {
    const el = document.getElementById('act-cnt-' + k);
    if (el) el.textContent = '(' + counts[k] + ')';
  });

  renderActTimeline();
  renderActImportant(data, days, events);
  if (_actSel == null) actDetailEmpty();
}

function renderActTimeline() {
  const el = document.getElementById('act-timeline');
  if (!el) return;
  const q = (((document.getElementById('act-search') || {}).value) || '').trim().toLowerCase();
  const all = window.__actEvents || [];
  const shown = [];
  all.forEach(function(ev, i) {
    if (!actTabMatch(ev, _actTab)) return;
    if (q && String(ev.name || '').toLowerCase().indexOf(q) === -1) return;
    shown.push({ ev: ev, i: i });
  });

  if (!shown.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><i data-lucide="activity"></i>' +
      '<div class="empty-state-title">No activity here yet</div>' +
      '<div class="empty-state-sub">' + (q ? 'No events match your search.' : 'Events appear as leads come in, follow-ups send, and records update.') + '</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const groups = [];
  let curLabel = null;
  shown.forEach(function(item) {
    const lbl = dayLabel(item.ev.ts);
    if (lbl !== curLabel) { groups.push({ label: lbl, items: [] }); curLabel = lbl; }
    groups[groups.length - 1].items.push(item);
  });

  el.innerHTML = groups.map(function(g) {
    return '<div class="feed-day">' + g.label + '</div>' + g.items.map(function(item) {
      const ev = item.ev;
      const meta = ACT_META[ev.type] || ACT_META.lead_created;
      const icon = (FEED_ICON[ev.type] || FEED_ICON.lead_created).icon;
      const sel = item.i === _actSel ? ' sel' : '';
      const time = new Date(ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return '<div class="act-row' + sel + '" onclick="actSelect(' + item.i + ')">' +
        '<div class="act-ico"><i data-lucide="' + icon + '"></i></div>' +
        '<div class="act-body"><div class="act-title">' + meta.title + '</div>' +
        '<div class="act-sub">' + actEvSub(ev) + '</div></div>' +
        '<span class="act-pill"><span class="act-dot" style="background:' + meta.dot + ';"></span>' + meta.pill + '</span>' +
        '<span class="act-time">' + time + '</span>' +
        '<button class="btn-mini btn-mini-ghost act-view" onclick="actView(' + item.i + ', event)">View</button>' +
      '</div>';
    }).join('');
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderActTimeline = renderActTimeline;

function actSetTab(t) {
  _actTab = t;
  document.querySelectorAll('#act-tabs .lt-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === t);
  });
  renderActTimeline();
}
window.actSetTab = actSetTab;

function actSelect(i) {
  _actSel = i;
  renderActTimeline();
  actDetailRender();
}
window.actSelect = actSelect;

function actDeselect() {
  _actSel = null;
  renderActTimeline();
  actDetailEmpty();
}
window.actDeselect = actDeselect;

function actView(i, e) {
  if (e) e.stopPropagation();
  const ev = (window.__actEvents || [])[i];
  if (!ev) return;
  if (ev.id) bellOpenLead(String(ev.id).replace(/[^\w-]/g, ''), String(ev.name || '').replace(/[^\w\s.@-]/g, ''));
  else if (ev.name) bellOpenLead('', String(ev.name).replace(/[^\w\s.@-]/g, ''));
}
window.actView = actView;

function actDetailEmpty() {
  const el = document.getElementById('act-detail');
  if (!el) return;
  const x = document.getElementById('act-detail-close');
  if (x) x.style.display = 'none';
  el.innerHTML = '<div class="empty-state" style="padding:26px 16px;"><i data-lucide="mouse-pointer-click"></i>' +
    '<div class="empty-state-title">Select an event</div>' +
    '<div class="empty-state-sub">Click any row in the timeline to review what happened.</div></div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function actDetailRender() {
  const el = document.getElementById('act-detail');
  const ev = (window.__actEvents || [])[_actSel];
  if (!el || !ev) return;
  const x = document.getElementById('act-detail-close');
  if (x) x.style.display = '';
  const meta = ACT_META[ev.type] || ACT_META.lead_created;
  const when = new Date(ev.ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + new Date(ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let what = actEvSub(ev) + '.';
  let next = '';
  if (ev.type === 'warning') next = 'Send a follow-up now — leads contacted within 48 hours convert significantly better.';
  else if (ev.type === 'lead_created') next = 'Review the lead and confirm the first touch went out.';
  else if (ev.type === 'booking') next = 'Confirm the appointment is on the calendar.';

  el.innerHTML =
    '<div style="padding:14px 16px;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
        '<div class="act-ico"><i data-lucide="' + (FEED_ICON[ev.type] || FEED_ICON.lead_created).icon + '"></i></div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text);">' + meta.title + '</div>' +
        '<div style="font-size:10.5px;color:var(--text-m);">' + when + '</div></div>' +
        '<span class="act-pill"><span class="act-dot" style="background:' + meta.dot + ';"></span>' + meta.pill + '</span>' +
      '</div>' +
      (ev.name ? '<div class="detail-row"><span class="dk">Lead</span><span class="dv">' + escDash(ev.name) + '</span></div>' : '') +
      (ev.source ? '<div class="detail-row"><span class="dk">Source</span><span class="dv">' + escDash(ev.source) + '</span></div>' : '') +
      (ev.status ? '<div class="detail-row"><span class="dk">Status</span><span class="dv">' + escDash(ev.status) + '</span></div>' : '') +
      (ev.stage ? '<div class="detail-row"><span class="dk">Stage</span><span class="dv">' + escDash(ev.stage) + '</span></div>' : '') +
      (ev.amount != null ? '<div class="detail-row"><span class="dk">Value</span><span class="dv">' + fmtMoney(ev.amount) + '</span></div>' : '') +
      '<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-m);margin:12px 0 5px;">What happened</div>' +
      '<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + what + '</div>' +
      (next ? '<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-m);margin:12px 0 5px;">Next step</div>' +
        '<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + next + '</div>' : '') +
      ((ev.id || ev.name) && ev.type !== 'deal'
        ? '<button class="btn-mini btn-mini-primary" style="width:100%;justify-content:center;margin-top:14px;display:inline-flex;" onclick="actView(' + _actSel + ')">View lead</button>'
        : '') +
    '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderActImportant(data, days, events) {
  const el = document.getElementById('act-important');
  if (!el) return;
  const contacts = data.contacts || [];
  const followup = leadsNeedFollowUp(contacts).length;
  const warnings = events.filter(function(e) { return e.type === 'warning'; }).length;
  const bookings = events.filter(function(e) { return e.type === 'booking'; }).length;
  const srcCounts = groupCount(contacts.filter(function(c) { return c.source; }), function(c) { return c.source; });
  const topSrc = Object.keys(srcCounts).sort(function(a, b) { return srcCounts[b] - srcCounts[a]; })[0] || null;
  const srcPct = topSrc && contacts.length ? Math.round((srcCounts[topSrc] / contacts.length) * 100) : 0;

  const rows = [];
  rows.push({
    icon: 'clock', color: '#d97706',
    title: followup + ' lead' + (followup === 1 ? '' : 's') + ' need follow-up',
    sub: 'No contact in 48h+',
    run: "showPage('leads');setTimeout(function(){if(window.leadsSetTab)leadsSetTab('followup');},120);"
  });
  if (topSrc) {
    rows.push({
      icon: 'layers', color: 'var(--blue)',
      title: escDash(topSrc) + ' is top source',
      sub: srcPct + '% of leads this period',
      run: "showPage('analytics');"
    });
  }
  rows.push({
    icon: 'calendar-check', color: 'var(--green)',
    title: bookings + ' booking' + (bookings === 1 ? '' : 's') + ' recorded this period',
    sub: bookings > 0 ? 'Keep the momentum going' : 'Bookings will appear as calls get scheduled',
    run: "actSetTab('bookings');"
  });
  rows.push({
    icon: warnings > 0 ? 'alert-triangle' : 'check-circle-2',
    color: warnings > 0 ? '#d97706' : 'var(--green)',
    title: warnings > 0 ? warnings + ' lead' + (warnings === 1 ? '' : 's') + ' flagged for review' : 'No warnings detected',
    sub: warnings > 0 ? 'Review recommended' : 'All automations running normally',
    run: warnings > 0 ? "actSetTab('warnings');" : ''
  });

  el.innerHTML = rows.map(function(r) {
    return '<div class="imp-row"' + (r.run ? ' onclick="' + r.run + '"' : '') + '>' +
      '<div class="act-ico" style="color:' + r.color + ';"><i data-lucide="' + r.icon + '"></i></div>' +
      '<div style="flex:1;min-width:0;"><div class="imp-title">' + r.title + '</div>' +
      '<div class="imp-sub">' + r.sub + '</div></div>' +
      '<i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--text-m);flex-shrink:0;"></i>' +
    '</div>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function actExport() {
  const events = window.__actEvents || [];
  if (!events.length) { if (typeof showToast === 'function') showToast('No activity to export.'); return; }
  const esc = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  const head = ['Date', 'Time', 'Event', 'Lead', 'Detail', 'Status'];
  const lines = [head.map(esc).join(',')].concat(events.map(function(ev) {
    const meta = ACT_META[ev.type] || {};
    return [
      new Date(ev.ts).toLocaleDateString(),
      new Date(ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      meta.title || ev.type,
      ev.name || '',
      actEvSub(ev).replace(/<[^>]*>/g, ''),
      meta.pill || ''
    ].map(esc).join(',');
  }));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flowaify-activity-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  if (typeof showToast === 'function') showToast('Exported ' + events.length + ' events to CSV.');
}
window.actExport = actExport;

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

  const srcCount = ranged.length > 0 ? Object.keys(groupCount(ranged, function(c){ return c.source; })).length : 0;
  setText('val-an-sources', srcCount);

  // Brand panel inline stats
  setText('bp-leads',  ranged.length);
  setText('bp-booked', overview.bookedCalls);

  const convRate = contacts.length > 0
    ? Math.round(((overview.bookedCalls || 0) / contacts.length) * 100) + '%'
    : '—';
  setText('val-an-conv', convRate);
  setText('bp-conv', convRate);
}

/* ── Charts ─────────────────────────────────────────────────────────────────── */
function renderCharts(data, ranged, days) {
  if (typeof Chart === 'undefined') return;
  const darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  Chart.defaults.color = darkMode ? 'rgba(232,235,242,0.55)' : '#64748b';
  Chart.defaults.borderColor = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.08)';
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
  const pRespOv = document.getElementById('pill-resp-ov');
  const pRespAn = document.getElementById('pill-resp-an');
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
          animation: { duration: 450, easing: 'easeOutQuart' }
        }
      });
    }
    chartOverlay(id, !hasResp);
  });
  if (pRespOv) pRespOv.style.display = hasResp ? 'none' : '';
  if (pRespAn) pRespAn.style.display = hasResp ? 'none' : '';

  /* Leads Over Time (an-leads) — day/week buckets */
  const buckets = timeBuckets(chartSet, days);
  const hasLeadsTime = chartSet.length > 0;
  if (hasLeadsTime) {
    mkChart('an-leads', {
      type: 'line',
      data: { labels: buckets.labels, datasets: [{ data: buckets.data, borderColor: '#ffffff', backgroundColor: function(ctx) {
        const area = ctx.chart.chartArea;
        if (!area) return 'rgba(255,255,255,0.15)';
        const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, 'rgba(255,255,255,0.30)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      }, fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: '#ffffff' }] },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 }, maxTicksLimit: 10, color: 'rgba(255,255,255,0.7)' }, grid: { display: false } },
          y: { ticks: { font: { size: 10 }, stepSize: 1, color: 'rgba(255,255,255,0.7)' }, grid: { color: 'rgba(255,255,255,0.12)' } }
        },
        animation: { duration: 450, easing: 'easeOutQuart' }
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
        animation: { duration: 450, easing: 'easeOutQuart' }
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
        animation: { duration: 450, easing: 'easeOutQuart' }
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
        animation: { duration: 450, easing: 'easeOutQuart' }
      }
    });
  }
  chartOverlay('an-booked-chart', !hasBookedTime);
  const pBooked = document.getElementById('pill-booked');
  if (pBooked) pBooked.style.display = hasBookedTime ? 'none' : '';

}


/* ── Team (Worker /team, KV-backed) ─────────────────────────────────────────── */
window.__teamDoc = null;
var teamLoading = false;

async function teamFetch(method, body) {
  var claims;
  try { claims = await auth0Client.getIdTokenClaims(); } catch (e) { return { status: 0 }; }
  if (!claims || !claims.__raw) return { status: 0 };
  try {
    var res = await fetch(WORKER + '/team', {
      method: method,
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data };
  } catch (e) {
    return { status: 0 };
  }
}

async function teamLoad(force) {
  if (teamLoading) return;
  if (window.__teamDoc && !force) { renderTeam(window.__teamDoc); return; }
  teamLoading = true;
  var r = await teamFetch('GET');
  teamLoading = false;
  var setup = document.getElementById('team-setup-card');
  var content = document.getElementById('teams-hub');
  if (r.status === 501 || r.status === 404) {
    if (setup) setup.style.display = 'block';
    if (content) content.style.display = 'none';
    return;
  }
  if (r.status !== 200 || !r.data) {
    if (typeof showToast === 'function') showToast("Couldn't load your team — try refreshing.");
    return;
  }
  if (setup) setup.style.display = 'none';
  if (content) content.style.display = 'flex';

  var doc = r.data;
  doc.members = doc.members || [];
  doc.log = doc.log || [];
  if (!doc.seatsIncluded) doc.seatsIncluded = 3;

  // Seed the signed-in account as Owner on first load
  var hasOwner = doc.members.some(function(m) { return m.role === 'owner'; });
  if (!hasOwner) {
    doc.members.unshift({
      id: 'owner',
      name: window.__userName || 'Account owner',
      email: window.__userEmail || '',
      role: 'owner',
      status: 'active',
      addedAt: Date.now(),
    });
    teamLogPush(doc, 'Workspace created — owner seat activated');
    await teamSave(doc, true);
  }
  window.__teamDoc = doc;
  renderTeam(doc);
}
window.teamLoad = teamLoad;

async function teamSave(doc, quiet) {
  var r = await teamFetch('PUT', doc);
  if (r.status === 200 && r.data && r.data.doc) {
    window.__teamDoc = r.data.doc;
    return true;
  }
  if (!quiet && typeof showToast === 'function') showToast("Couldn't save — your change was not stored.");
  return false;
}

function teamLogPush(doc, text) {
  doc.log = doc.log || [];
  doc.log.unshift({ ts: Date.now(), text: String(text).slice(0, 200) });
  doc.log = doc.log.slice(0, 20);
}

function roleChipHtml(role) {
  var cls = { owner: 'rc-owner', admin: 'rc-admin', member: 'rc-member', viewer: 'rc-viewer' }[role] || 'rc-member';
  return '<span class="role-chip ' + cls + '">' + escDash(role) + '</span>';
}

/* My role in this workspace — roster lookup by sub/email; empty roster = owner */
function teamMyRole(doc) {
  var members = (doc && doc.members) || [];
  if (!members.length) return 'owner';
  var sub = window.__userSub || '';
  var em = String(window.__userEmail || '').toLowerCase();
  var m = members.find(function(x) {
    return (x.sub && x.sub === sub) || (em && String(x.email || '').toLowerCase() === em);
  });
  return m ? (m.role || 'member') : 'member';
}

/* Viewer write guard — Worker enforces; this gives a friendly message first */
function flwWriteBlocked() {
  if (window.__myRole === 'viewer') {
    if (typeof showToast === 'function') showToast('View-only access — ask an admin for a member seat.');
    return true;
  }
  return false;
}
window.flwWriteBlocked = flwWriteBlocked;

function renderTeam(doc) {
  var members = doc.members || [];
  var used = members.length;
  var total = doc.seatsIncluded || 3;
  window.__myRole = teamMyRole(doc);
  var canManage = window.__myRole === 'owner' || window.__myRole === 'admin';
  var active = members.filter(function(m) { return m.status === 'active'; }).length;
  var pending = used - active;

  setText('team-used', used);
  setText('team-total', total);
  setText('team-active', active);
  setText('team-pending', pending);
  var bar = document.getElementById('team-bar');
  if (bar) bar.style.width = Math.min(100, Math.round((used / total) * 100)) + '%';
  var countEl = document.getElementById('team-count');
  if (countEl) countEl.textContent = used + ' member' + (used === 1 ? '' : 's');

  var inviteBtn = document.getElementById('team-invite-btn');
  if (inviteBtn) {
    var blocked = used >= total || !canManage;
    inviteBtn.disabled = blocked;
    inviteBtn.style.opacity = blocked ? '0.5' : '1';
    inviteBtn.title = !canManage ? 'Only admins can invite members'
      : (used >= total ? 'All seats are in use — buy more seats to invite' : 'Invite a team member');
  }

  var tbody = document.getElementById('team-tbody');
  if (tbody) {
    tbody.innerHTML = members.map(function(m) {
      var isOwner = m.role === 'owner';
      var safeId = String(m.id).replace(/[^\w-]/g, '');
      var roleCell = (isOwner || !canManage)
        ? roleChipHtml(m.role || 'member')
        : '<select class="role-sel" onchange="setRole(\'' + safeId + '\', this.value)">' +
            ['admin', 'member', 'viewer'].map(function(r) {
              return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
            }).join('') + '</select>';
      var statusCell = m.status === 'active'
        ? '<span class="state-pill live"><span class="sp-dot"></span>Active</span>'
        : '<span class="state-pill awaiting"><span class="sp-dot"></span>Invited</span>';
      var actions = (isOwner || !canManage) ? '' :
        '<button class="team-act" onclick="resendProvision(\'' + safeId + '\')" title="Resend set-password email"><i data-lucide="mail"></i></button>' +
        '<button class="team-act danger" onclick="removeMember(\'' + safeId + '\')" title="Remove"><i data-lucide="trash-2"></i></button>';
      return '<tr data-mid="' + safeId + '" onclick="if(!event.target.closest(\'select,button\'))openMember(\'' + safeId + '\')" style="cursor:pointer;">' +
        '<td><div class="lead-cell">' + avatarHtml(m.name || m.email) +
          '<div><div style="font-weight:600;font-size:12.5px;">' + escDash(m.name || '—') + '</div>' +
          '<div style="font-size:10.5px;color:var(--text-m);">' + escDash(m.email) + '</div></div></div></td>' +
        '<td>' + roleCell + '</td>' +
        '<td>' + statusCell + '</td>' +
        '<td style="font-size:11.5px;color:var(--text-m);">' + (m.addedAt ? new Date(m.addedAt).toLocaleDateString() : '—') + '</td>' +
        '<td style="text-align:right;white-space:nowrap;">' + actions + '</td>' +
        '</tr>';
    }).join('');
  }

  var logEl = document.getElementById('team-log');
  if (logEl) {
    var log = doc.log || [];
    logEl.innerHTML = log.length
      ? log.slice(0, 10).map(function(l) {
          return '<div class="tl-item"><span>' + escDash(l.text) + '</span><span class="tl-time">' + relTime(l.ts) + '</span></div>';
        }).join('')
      : '<div style="padding:20px 16px;text-align:center;font-size:11.5px;color:var(--text-m);">Invites, role changes, and removals show here.</div>';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openInvite() {
  var doc = window.__teamDoc;
  if (doc && (doc.members || []).length >= (doc.seatsIncluded || 3)) {
    if (typeof showToast === 'function') showToast('All seats are in use — buy more seats first.');
    return;
  }
  var ov = document.getElementById('inv-overlay');
  if (ov) {
    document.getElementById('inv-name').value = '';
    document.getElementById('inv-email').value = '';
    document.getElementById('inv-role').value = 'member';
    ov.classList.add('open');
    lucide.createIcons();
    setTimeout(function() { document.getElementById('inv-name').focus(); }, 80);
  }
}
window.openInvite = openInvite;
function closeInvite() {
  var ov = document.getElementById('inv-overlay');
  if (ov) ov.classList.remove('open');
}
window.closeInvite = closeInvite;

function provisionMail(m) {
  var biz = (typeof bizNameCrm === 'function') ? bizNameCrm() : '';
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    biz = ((saved.biz || {})['s2-biz-name'] || '').trim();
  } catch (e) {}
  var subject = 'Provision new seat' + (biz ? ' — ' + biz : '');
  var body = 'Please provision a Flowaify login for a new team member.\n\n' +
    'Name: ' + m.name + '\nEmail: ' + m.email + '\nRole: ' + m.role +
    (biz ? '\nBusiness: ' + biz : '') +
    '\nRequested by: ' + (window.__userEmail || '') +
    '\n\nSent from Flowaify Dashboard → Team';
  window.location.href = 'mailto:contact@flowaify.app?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

async function inviteMember() {
  var doc = window.__teamDoc;
  if (!doc) return;
  var name = (document.getElementById('inv-name') || {}).value || '';
  var email = ((document.getElementById('inv-email') || {}).value || '').trim();
  var role = (document.getElementById('inv-role') || {}).value || 'member';
  if (!name.trim() || email.indexOf('@') === -1) {
    if (typeof showToast === 'function') showToast('Add a name and a valid email first.');
    return;
  }
  if (typeof showToast === 'function') showToast('Creating account\u2026');
  var r = await twFetch('POST', '/team/invite', { name: name.trim(), email: email, role: role });
  if (r && r.status === 200 && r.data && r.data.doc) {
    window.__teamDoc = r.data.doc;
    renderTeam(r.data.doc);
    closeInvite();
    if (typeof showToast === 'function') {
      showToast('Invitation sent \u2014 ' + escDash(name.trim()) + ' will get an email to set their password.');
    }
  } else {
    var msg = (r && r.data && r.data.message) || 'Could not send the invite \u2014 try again.';
    if (typeof showToast === 'function') showToast(msg);
  }
}
window.inviteMember = inviteMember;

async function setRole(id, role) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m || m.role === 'owner') return;
  var r = await twFetch('POST', '/team/role', { email: m.email, role: role });
  if (r && r.status === 200 && r.data && r.data.doc) {
    window.__teamDoc = r.data.doc;
    renderTeam(r.data.doc);
    if (typeof showToast === 'function') showToast(escDash(m.name) + ' is now ' + role + '.');
  } else {
    renderTeam(doc); /* reset the select */
    var msg = (r && r.data && r.data.message) || 'Could not change the role.';
    if (typeof showToast === 'function') showToast(msg);
  }
}
window.setRole = setRole;

async function removeMember(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m || m.role === 'owner') return;
  if (!confirm('Remove ' + m.name + ' from the team? Their login will be blocked immediately.')) return;
  var r = await twFetch('POST', '/team/remove', { email: m.email });
  if (r && r.status === 200 && r.data && r.data.doc) {
    window.__teamDoc = r.data.doc;
    renderTeam(r.data.doc);
    if (typeof showToast === 'function') showToast(escDash(m.name) + ' removed and their login blocked.');
  } else {
    var msg = (r && r.data && r.data.message) || 'Could not remove the member.';
    if (typeof showToast === 'function') showToast(msg);
  }
}
window.removeMember = removeMember;

async function resendProvision(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m || !m.email) return;
  /* Auth0's public change-password endpoint re-sends the set-password email */
  try {
    await fetch('https://auth.flowaify.app/dbconnections/change_password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'tx74Owqn3jVeSaVuxfFHsKloqbPqfAmN',
        email: m.email,
        connection: 'Username-Password-Authentication'
      })
    });
    if (typeof showToast === 'function') showToast('Set-password email re-sent to ' + escDash(m.email) + '.');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Could not re-send the email \u2014 try again.');
  }
}
window.resendProvision = resendProvision;

function buySeats() {
  var biz = '';
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    biz = ((saved.biz || {})['s2-biz-name'] || '').trim();
  } catch (e) {}
  var doc = window.__teamDoc || {};
  var subject = 'Seat purchase request' + (biz ? ' — ' + biz : '');
  var body = 'We\u2019d like to add more seats to our Flowaify plan.\n\n' +
    'Current seats: ' + ((doc.members || []).length) + ' of ' + (doc.seatsIncluded || 3) +
    (biz ? '\nBusiness: ' + biz : '') +
    '\nRequested by: ' + (window.__userEmail || '') +
    '\n\nSent from Flowaify Dashboard \u2192 Team';
  window.location.href = 'mailto:contact@flowaify.app?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}
window.buySeats = buySeats;


/* ── Member drawer ──────────────────────────────────────────────────────────── */
var ROLE_PERMS = {
  owner:  'Owner — full control: billing, seats, team, settings, and all lead actions.',
  admin:  'Admin — manage the team and settings, edit leads, use Flowy and reports.',
  member: 'Member — work leads, update statuses, use Flowy; no team or settings control.',
  viewer: 'Viewer — read-only access to dashboards, analytics, and reports.',
};

function openMember(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m) return;
  window.__memId = m.id;
  var ov = document.getElementById('mem-overlay');
  if (!ov) return;
  document.getElementById('mem-avatar').innerHTML = avatarHtml(m.name || m.email);
  document.getElementById('mem-title').textContent = m.name || m.email || 'Member';
  document.getElementById('mem-status-sub').textContent =
    (m.status === 'active' ? 'Active' : 'Pending — being provisioned') +
    ' · added ' + (m.addedAt ? new Date(m.addedAt).toLocaleDateString() : '—');
  document.getElementById('mem-name').value = m.name || '';
  document.getElementById('mem-email').value = m.email || '';
  var roleSel = document.getElementById('mem-role');
  var isOwner = m.role === 'owner';
  roleSel.disabled = isOwner;
  if (isOwner) {
    roleSel.innerHTML = '<option value="owner" selected>Owner</option>';
  } else {
    roleSel.innerHTML = ['admin','member','viewer'].map(function(r) {
      return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
    }).join('');
  }
  document.getElementById('mem-perms').textContent = ROLE_PERMS[m.role] || '';
  roleSel.onchange = function() { document.getElementById('mem-perms').textContent = ROLE_PERMS[roleSel.value] || ''; };
  document.getElementById('mem-resend').style.display   = m.status === 'pending' ? '' : 'none';
  document.getElementById('mem-activate').style.display = m.status === 'pending' ? '' : 'none';
  var removeBtn = document.querySelector('#mem-overlay .team-act.danger');
  if (removeBtn) removeBtn.style.display = isOwner ? 'none' : '';
  ov.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.openMember = openMember;

function closeMember() {
  var ov = document.getElementById('mem-overlay');
  if (ov) ov.classList.remove('open');
}
window.closeMember = closeMember;

async function saveMember() {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(window.__memId); });
  if (!m) return;
  var name = (document.getElementById('mem-name') || {}).value || '';
  var email = ((document.getElementById('mem-email') || {}).value || '').trim();
  var role = (document.getElementById('mem-role') || {}).value || m.role;
  if (!name.trim() || email.indexOf('@') === -1) {
    if (typeof showToast === 'function') showToast('Name and a valid email are required.');
    return;
  }
  var prev = JSON.parse(JSON.stringify(doc));
  var changed = [];
  if (m.name !== name.trim()) changed.push('name');
  if (m.email !== email) changed.push('email');
  if (m.role !== role && m.role !== 'owner') { changed.push('role → ' + role); m.role = role; }
  m.name = name.trim().slice(0, 80);
  m.email = email.slice(0, 120);
  if (changed.length) teamLogPush(doc, m.name + ' — ' + changed.join(', ') + ' updated');
  renderTeam(doc);
  closeMember();
  var ok = await teamSave(doc);
  if (!ok) { window.__teamDoc = prev; renderTeam(prev); return; }
  if (changed.length && typeof showToast === 'function') showToast(escDash(m.name) + ' updated.');
}
window.saveMember = saveMember;

/* ── Team search + export ───────────────────────────────────────────────────── */
function teamFilter() {
  var q = ((document.getElementById('team-search') || {}).value || '').trim().toLowerCase();
  document.querySelectorAll('#team-tbody tr').forEach(function(tr) {
    tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
  });
}
window.teamFilter = teamFilter;

function exportTeamCsv() {
  var doc = window.__teamDoc;
  var rows = doc ? (doc.members || []) : [];
  if (!rows.length) { if (typeof showToast === 'function') showToast('No team members to export.'); return; }
  var esc = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var lines = [['Name','Email','Role','Status','Added'].map(esc).join(',')].concat(rows.map(function(m) {
    return [m.name, m.email, m.role, m.status, m.addedAt ? new Date(m.addedAt).toLocaleDateString() : ''].map(esc).join(',');
  }));
  var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flowaify-team-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  if (typeof showToast === 'function') showToast('Exported ' + rows.length + ' team members.');
}
window.exportTeamCsv = exportTeamCsv;
