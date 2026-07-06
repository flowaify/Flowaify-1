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
  const ta = document.getElementById('lead-note-input');
  if (!ta || !ta.value.trim()) return;
  const note = ta.value.trim();
  const btn = document.getElementById('lead-note-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const ok = await updateLead(contactId, { note: note });
  if (btn) { btn.disabled = false; btn.textContent = 'Save note'; }
  if (ok) {
    ta.value = '';
    if (typeof showToast === 'function') showToast('Note saved to Zoho.');
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
function renderCalendar() {
  const data = window.__crmData;
  const grid = document.getElementById('cal-grid');
  if (!grid || !data) return;
  const base = window.__calMonth || new Date();
  window.__calMonth = base;
  const y = base.getFullYear(), m = base.getMonth();

  const title = document.getElementById('cal-title');
  if (title) title.textContent = base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const dealsByDay = {}, leadsByDay = {};
  (data.deals || []).forEach(function(d) {
    if (!d.closingDate) return;
    const key = String(d.closingDate).slice(0, 10);
    (dealsByDay[key] = dealsByDay[key] || []).push(d);
  });
  (data.contacts || []).forEach(function(c) {
    if (!c.createdAt) return;
    const key = new Date(c.createdAt).toISOString().slice(0, 10);
    leadsByDay[key] = (leadsByDay[key] || 0) + 1;
  });

  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const start = new Date(y, m, 1 - firstDow);
  const todayKey = new Date().toISOString().slice(0, 10);

  let htmlOut = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d) {
    return '<div class="cal-dow">' + d + '</div>';
  }).join('');

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const other = d.getMonth() !== m ? ' other' : '';
    const today = key === todayKey ? ' today' : '';
    let cell = '<div class="cal-cell' + other + today + '"><span class="cal-daynum">' + d.getDate() + '</span>';
    const dd = dealsByDay[key] || [];
    dd.slice(0, 2).forEach(function(deal) {
      const col = stageColor(deal.stage);
      cell += '<span class="cal-chip" style="background:' + col + '2e;color:' + col + ';" title="' + escDash(deal.name) + ' · ' + fmtMoney(deal.amount) + '">' + escDash(deal.name) + '</span>';
    });
    if (dd.length > 2) cell += '<span class="cal-chip" style="background:var(--hover);color:var(--text-m);">+' + (dd.length - 2) + ' more</span>';
    if (leadsByDay[key]) cell += '<span class="cal-dot-badge">' + leadsByDay[key] + ' lead' + (leadsByDay[key] === 1 ? '' : 's') + '</span>';
    cell += '</div>';
    htmlOut += cell;
  }
  grid.innerHTML = htmlOut;

  // Upcoming closings
  const up = document.getElementById('cal-upcoming');
  if (up) {
    const nowT = new Date(); nowT.setHours(0, 0, 0, 0);
    const upcoming = (data.deals || [])
      .filter(function(d) { return d.closingDate && new Date(d.closingDate).getTime() >= nowT.getTime(); })
      .sort(function(a, b) { return new Date(a.closingDate) - new Date(b.closingDate); })
      .slice(0, 5);
    if (upcoming.length === 0) {
      up.innerHTML = '<div class="empty-state" style="padding:30px 16px;"><i data-lucide="calendar-check"></i>' +
        '<div class="empty-state-title">No upcoming closings</div>' +
        '<div class="empty-state-sub">Deals with closing dates will appear here.</div></div>';
    } else {
      up.innerHTML = upcoming.map(function(d) {
        return '<div class="cal-up-item">' +
          '<span class="lead-avatar" style="background:' + stageColor(d.stage) + ';">$</span>' +
          '<div><div class="cal-up-name">' + escDash(d.name) + '</div>' +
          '<div class="cal-up-sub">' + new Date(d.closingDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (d.stage ? ' · ' + escDash(d.stage) : '') + '</div></div>' +
          (d.amount != null ? '<div class="cal-up-amt">' + fmtMoney(d.amount) + '</div>' : '') +
          '</div>';
      }).join('');
    }
  }

  // Month counts
  const mStart = new Date(y, m, 1).getTime(), mEnd = new Date(y, m + 1, 1).getTime();
  setText('cal-count-leads', (data.contacts || []).filter(function(c) {
    if (!c.createdAt) return false;
    const t = new Date(c.createdAt).getTime();
    return t >= mStart && t < mEnd;
  }).length);
  setText('cal-count-closings', (data.deals || []).filter(function(d) {
    if (!d.closingDate) return false;
    const t = new Date(d.closingDate).getTime();
    return t >= mStart && t < mEnd;
  }).length);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderCalendar = renderCalendar;

/* ── Notification bell ──────────────────────────────────────────────────────── */
function renderBell(needsAttention) {
  const badge = document.getElementById('bell-badge');
  const list = document.getElementById('bell-list');
  const n = (needsAttention || []).length;
  if (badge) {
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  if (!list) return;
  if (n === 0) {
    list.innerHTML = '<div class="bell-empty">All clear — no leads need attention.</div>';
    return;
  }
  list.innerHTML = needsAttention.slice(0, 6).map(function(c) {
    const safeName = String(c.name || '').replace(/[^\w\s.@-]/g, '');
    return '<div class="bell-item" onclick="bellOpenLead(\'' + (c.id ? String(c.id).replace(/[^\w-]/g, '') : '') + '\', \'' + safeName + '\')">' +
      avatarHtml(c.name) +
      '<div><div class="bell-item-name">' + escDash(c.name) + '</div>' +
      '<div class="bell-item-sub">' + escDash(c.status) + ' · No touch in 24h+</div></div>' +
      '</div>';
  }).join('');
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
window.exportLeadsCsv = exportLeadsCsv;

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

  // Cover
  html += '<div class="rp-cover">';
  html += '<div class="rp-cover-logo"><svg viewBox="0 0 24 24" fill="none" stroke="#0050e6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Flowaify</div>';
  html += '<div class="rp-cover-body">';
  if (reportFor) html += '<div class="rp-cover-client">' + escDash(reportFor) + '</div>';
  html += '<h1>' + reportTitle + '</h1>';
  html += '<div class="rp-cover-range">Last ' + days + ' days &nbsp;·&nbsp; ' + dateStr + '</div>';
  if (signedBy) html += '<div class="rp-cover-sig">Prepared by ' + escDash(signedBy) + ' via Flowaify</div>';
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

  html += '<div class="rp-footer">Flowaify &nbsp;·&nbsp; Confidential &nbsp;·&nbsp; ' + dateStr + (signedBy ? ' &nbsp;·&nbsp; ' + escDash(signedBy) : '') + '</div>';

  var content = document.getElementById('report-preview-content');
  if (content) content.innerHTML = html;
  closeReportEditor();
  var overlay = document.getElementById('report-preview-overlay');
  if (overlay) overlay.classList.add('open');
}

function closeReportPreview() {
  var overlay = document.getElementById('report-preview-overlay');
  if (overlay) overlay.classList.remove('open');
}

function printReportEditor() { window.print(); }

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

function renderTopLeads(contacts) {
  const el = document.getElementById('top-leads-list');
  if (!el) return;
  if (!contacts || contacts.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:34px 20px;"><i data-lucide="users"></i>' +
      '<div class="empty-state-title">No leads yet</div>' +
      '<div class="empty-state-sub">Your top 5 scored leads will rank here once contacts exist in Zoho CRM.</div></div>';
    return;
  }
  const top = contacts.slice().sort(function(a, b) {
    const r = scoreRank(b.status) - scoreRank(a.status);
    if (r !== 0) return r;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  }).slice(0, 5);

  el.innerHTML = top.map(function(c, i) {
    const scored = scoreRank(c.status) > 0;
    const right = scored
      ? statusBadge(c.status)
      : '<span class="state-pill awaiting"><span class="sp-dot"></span>Awaiting score</span>';
    const sub = [c.source, c.createdAt ? relTime(new Date(c.createdAt).getTime()) : null]
      .filter(Boolean).map(escDash).join(' · ') || '—';
    const safeId = c.id ? String(c.id).replace(/[^\w-]/g, '') : '';
    return '<div class="tl-row" onclick="bellOpenLead(\'' + safeId + '\', \'' + String(c.name || '').replace(/[^\w\s.@-]/g, '') + '\')">' +
      '<span class="tl-rank">' + (i + 1) + '</span>' +
      avatarHtml(c.name) +
      '<div class="tl-body"><div class="tl-name">' + escDash(c.name) + '</div>' +
      '<div class="tl-sub">' + sub + '</div></div>' +
      right +
      '</div>';
  }).join('');
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

  const sort = window.__leadSort;
  const dateKeys = { createdAt: 1, lastTouchAt: 1 };
  filtered.sort(function(a, b) {
    let va = a[sort.key], vb = b[sort.key];
    if (dateKeys[sort.key]) {
      va = va ? new Date(va).getTime() : null;
      vb = vb ? new Date(vb).getTime() : null;
    } else {
      va = va ? String(va).toLowerCase() : null;
      vb = vb ? String(vb).toLowerCase() : null;
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return va < vb ? -1 * sort.dir : va > vb ? sort.dir : 0;
  });

  window.__leadsFiltered = filtered;
  window.__leadsShown = 25;
  const sc = document.getElementById('leads-scroll');
  if (sc) sc.scrollTop = 0;
  renderLeadsTable(filtered.slice(0, window.__leadsShown));
}

function leadsScrollMore() {
  const sc = document.getElementById('leads-scroll');
  if (!sc) return;
  if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 120) return;
  const all = window.__leadsFiltered || [];
  if (window.__leadsShown >= all.length) return;
  const from = window.__leadsShown;
  window.__leadsShown = Math.min(all.length, from + 25);
  const tbody = document.getElementById('full-leads-tbody');
  if (tbody) {
    tbody.insertAdjacentHTML('beforeend', all.slice(from, window.__leadsShown).map(leadRowHtml).join(''));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
document.addEventListener('DOMContentLoaded', function() {
  const sc = document.getElementById('leads-scroll');
  if (sc) sc.addEventListener('scroll', leadsScrollMore);
});

function sortLeads(key) {
  const s = window.__leadSort;
  if (s.key === key) s.dir = -s.dir;
  else { s.key = key; s.dir = key === 'createdAt' || key === 'lastTouchAt' ? -1 : 1; }
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
}

function leadRowHtml(c) {
  const sel = c.id === window.__selectedLeadId ? ' class="row-selected"' : '';
  return '<tr' + sel + ' data-id="' + escDash(c.id) + '" onclick="selectLead(\'' + String(c.id).replace(/[^\w-]/g, '') + '\')">' +
    '<td><div class="lead-cell">' + avatarHtml(c.name) + '<div style="font-weight:600;font-size:12.5px;">' + escDash(c.name) + '</div></div></td>' +
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

  const safeId = String(c.id).replace(/[^\w-]/g, '');
  rows.push('<div style="padding:12px 18px 14px;border-top:1px solid var(--border);">');
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Set Status</div>');
  rows.push('<div class="status-picker">' + ['HOT','WARM','COLD','BOOKED'].map(function(s) {
    const active = String(c.status || '').toUpperCase().indexOf(s) !== -1 ? ' active' : '';
    return '<button class="status-chip sc-' + s.toLowerCase() + active + '" onclick="setLeadStatus(\'' + safeId + '\', \'' + s + '\')">' + s + '</button>';
  }).join('') + '</div>');
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px;">Add Note</div>');
  rows.push('<textarea id="lead-note-input" class="lead-note" rows="2" placeholder="Type a note — saves to Zoho…"></textarea>');
  rows.push('<button class="btn-mini btn-mini-primary" id="lead-note-save" style="margin-top:6px;" onclick="saveLeadNote(\'' + safeId + '\')">Save note</button>');
  rows.push('</div>');

  rows.push('<div style="padding:12px 18px 18px;border-top:1px solid var(--border);">');
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">AI Summary</div>');
  if (c.summary) {
    rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;">' + escDash(c.summary) + '</div>');
  } else {
    rows.push('<span class="state-pill awaiting"><span class="sp-dot"></span>Awaiting automation data</span>');
  }
  rows.push('<div style="font-size:11px;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.4px;margin:14px 0 8px;">Automation Insights</div>');
  if (c.score || c.insight) {
    if (c.score) rows.push('<div class="detail-row"><span class="dk">Urgency Score</span><span class="dv">' + escDash(c.score) + '</span></div>');
    if (c.insight) rows.push('<div style="font-size:12px;color:var(--text-s);line-height:1.6;margin-top:6px;">' + escDash(c.insight) + '</div>');
  } else {
    rows.push('<div style="font-size:11.5px;color:var(--text-m);line-height:1.6;">Lead score and insights will appear here once Flowaify automations are live for this lead.</div>');
  }
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
  touch:        { icon: 'sparkles',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
  ai_reply:     { icon: 'sparkles',            bg: 'rgba(139,92,246,.13)',  color: '#8b5cf6' },
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
          animation: { duration: 400 }
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
  var content = document.getElementById('team-content');
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
  if (content) content.style.display = 'block';

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

function renderTeam(doc) {
  var members = doc.members || [];
  var used = members.length;
  var total = doc.seatsIncluded || 3;
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
    inviteBtn.disabled = used >= total;
    inviteBtn.style.opacity = used >= total ? '0.5' : '1';
    inviteBtn.title = used >= total ? 'All seats are in use — buy more seats to invite' : 'Invite a team member';
  }

  var tbody = document.getElementById('team-tbody');
  if (tbody) {
    tbody.innerHTML = members.map(function(m) {
      var isOwner = m.role === 'owner';
      var safeId = String(m.id).replace(/[^\w-]/g, '');
      var roleCell = isOwner
        ? roleChipHtml('owner')
        : '<select class="role-sel" onchange="setRole(\'' + safeId + '\', this.value)">' +
            ['admin', 'member', 'viewer'].map(function(r) {
              return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
            }).join('') + '</select>';
      var statusCell = m.status === 'active'
        ? '<span class="state-pill live"><span class="sp-dot"></span>Active</span>'
        : '<span class="state-pill awaiting"><span class="sp-dot"></span>Pending</span>';
      var actions = isOwner ? '' :
        (m.status === 'pending'
          ? '<button class="team-act" onclick="resendProvision(\'' + safeId + '\')" title="Resend provisioning email"><i data-lucide="mail"></i></button>' +
            '<button class="team-act" onclick="markActive(\'' + safeId + '\')" title="Mark active"><i data-lucide="check"></i></button>'
          : '') +
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
  if (doc.members.some(function(m) { return m.email.toLowerCase() === email.toLowerCase(); })) {
    if (typeof showToast === 'function') showToast('That email is already on the team.');
    return;
  }
  var member = {
    id: 'm' + Date.now(),
    name: name.trim().slice(0, 80),
    email: email.slice(0, 120),
    role: role,
    status: 'pending',
    addedAt: Date.now(),
  };
  var prev = JSON.parse(JSON.stringify(doc));
  doc.members.push(member);
  teamLogPush(doc, (window.__userName || 'Owner') + ' invited ' + member.name + ' as ' + role);
  renderTeam(doc);
  closeInvite();
  var ok = await teamSave(doc);
  if (!ok) { window.__teamDoc = prev; renderTeam(prev); return; }
  provisionMail(member);
  if (typeof showToast === 'function') showToast('Invite recorded — Flowaify is provisioning the login.');
}
window.inviteMember = inviteMember;

async function setRole(id, role) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m || m.role === 'owner') return;
  var prev = m.role;
  m.role = role;
  teamLogPush(doc, m.name + ' changed to ' + role);
  renderTeam(doc);
  var ok = await teamSave(doc);
  if (!ok) { m.role = prev; renderTeam(doc); }
  else if (typeof showToast === 'function') showToast(escDash(m.name) + ' is now ' + role + '.');
}
window.setRole = setRole;

async function markActive(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m) return;
  m.status = 'active';
  teamLogPush(doc, m.name + '\u2019s seat activated');
  renderTeam(doc);
  await teamSave(doc);
}
window.markActive = markActive;

async function removeMember(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (!m || m.role === 'owner') return;
  if (!confirm('Remove ' + m.name + ' from the team? Their login will be deactivated.')) return;
  var prev = JSON.parse(JSON.stringify(doc));
  doc.members = doc.members.filter(function(x) { return String(x.id) !== String(id); });
  teamLogPush(doc, m.name + ' removed from the team');
  renderTeam(doc);
  var ok = await teamSave(doc);
  if (!ok) { window.__teamDoc = prev; renderTeam(prev); }
  else if (typeof showToast === 'function') showToast(escDash(m.name) + ' removed — we\u2019ll deactivate their login.');
}
window.removeMember = removeMember;

function resendProvision(id) {
  var doc = window.__teamDoc;
  if (!doc) return;
  var m = doc.members.find(function(x) { return String(x.id) === String(id); });
  if (m) provisionMail(m);
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
