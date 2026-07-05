/* Flowaify Workspace hub — live snapshot, service status, activity, closings.
   Lives in a .js file because requests carry an Authorization header. */

var PORTAL_WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

function pEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pSet(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}
function pMoney(v) {
  return v != null ? '$' + Number(v).toLocaleString() : '—';
}
function pDot(id, state) { // 'ok' | 'warn' | ''
  var el = document.getElementById(id);
  if (el) el.className = 'svc-dot' + (state ? ' ' + state : '');
}

/* ── Service status (/health is public — no auth header) ───────────────────── */
async function portalHealth() {
  var ok = false;
  try {
    var res = await fetch(PORTAL_WORKER + '/health', { cache: 'no-cache' });
    ok = res.ok;
  } catch (e) { ok = false; }

  pDot('svc-main-dot', ok ? 'ok' : 'warn');
  pSet('svc-main-text', ok ? 'All systems operational' : 'Partial disruption — we’re on it');
  pSet('svc-checked', 'Checked ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));

  // Dashboard is static hosting — if this page loaded, it's up
  pDot('svc-dash', 'ok');
  pSet('svc-dash-state', 'Operational');
  // Flowy AI rides the same Worker
  pDot('svc-ai', ok ? 'ok' : 'warn');
  pSet('svc-ai-state', ok ? 'Operational' : 'Degraded');
  if (!ok) {
    pDot('svc-crm', 'warn');
    pSet('svc-crm-state', 'Degraded');
  }
}

/* ── Authenticated snapshot ─────────────────────────────────────────────────── */
async function portalBoot(token) {
  var data = null;
  try {
    var res = await fetch(PORTAL_WORKER + '/data', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.ok) data = await res.json();
  } catch (e) {}

  if (!data) {
    pSet('ps-leads', '—');
    pSet('ps-pipeline', '—');
    pSet('ps-attn', '—');
    pDot('svc-crm', 'warn');
    pSet('svc-crm-state', 'Degraded');
    var actEl = document.getElementById('pt-activity');
    if (actEl) actEl.innerHTML = '<div class="empty-note">Couldn’t load activity right now.</div>';
    var upEl = document.getElementById('pt-rec');
    if (upEl) upEl.innerHTML = '<div class="empty-note">Couldn’t size things up right now.</div>';
    return;
  }

  var contacts = data.contacts || [];
  var overview = data.overview || {};

  // Hero mini-stats
  var weekAgo = Date.now() - 7 * 86400000;
  var week = contacts.filter(function(c) {
    return c.createdAt && new Date(c.createdAt).getTime() >= weekAgo;
  }).length;
  pSet('ps-leads', week);
  pSet('ps-pipeline', pMoney(overview.pipelineValue));
  pSet('ps-attn', (data.needsAttention || []).length);

  // CRM sync confirmed live
  pDot('svc-crm', 'ok');
  pSet('svc-crm-state', 'Operational');

  window.__crmData = data;
  if (typeof flowyWatch === 'function') flowyWatch(data);
  if (typeof flowyPortalInit === 'function') flowyPortalInit();
  renderMiniFeed(data);
  renderRecommended(data);
  portalTeam(token);
}

/* ── Your team (KV roster via /team) ────────────────────────────────────────── */
var PTM_HUES = [212, 262, 152, 22, 340, 190, 48, 288];
function ptmAvatar(name) {
  var n = String(name || '?');
  var hash = 0;
  for (var i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  var hue = PTM_HUES[hash % PTM_HUES.length];
  var initials = n.split(/\s+/).slice(0, 2).map(function(w) { return w.charAt(0); }).join('').toUpperCase() || '?';
  return '<span class="lead-avatar" style="background:hsl(' + hue + ',62%,45%);">' + pEsc(initials) + '</span>';
}

async function portalTeam(token) {
  var card = document.getElementById('pt-team-card');
  var el = document.getElementById('pt-team');
  if (!card || !el) return;
  try {
    var res = await fetch(PORTAL_WORKER + '/team', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return; // 501 (no KV) or error → keep card hidden
    var doc = await res.json();
    var members = doc.members || [];
    if (!members.length) return;
    var pending = members.filter(function(m) { return m.status === 'pending'; }).length;
    el.innerHTML = '<div class="ptm-wrap">' +
      '<div class="ptm-avatars">' + members.slice(0, 5).map(function(m) { return ptmAvatar(m.name || m.email); }).join('') + '</div>' +
      '<div class="ptm-info"><strong>' + members.length + ' of ' + (doc.seatsIncluded || 3) + '</strong> seats used' +
      (pending ? '<br>' + pending + ' invite' + (pending === 1 ? '' : 's') + ' pending provisioning' : '') +
      '</div></div>';
    card.style.display = 'block';
  } catch (e) {}
}

/* ── Latest activity (mini feed) ────────────────────────────────────────────── */
function pRelTime(ts) {
  var m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  var d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderMiniFeed(data) {
  var el = document.getElementById('pt-activity');
  if (!el) return;
  var events = [];
  (data.contacts || []).forEach(function(c) {
    if (c.createdAt) events.push({ ts: new Date(c.createdAt).getTime(), icon: 'user-plus', bg: 'rgba(0,87,255,.12)', color: '#0057FF',
      text: '<strong>' + pEsc(c.name) + '</strong> came in' + (c.source ? ' via ' + pEsc(c.source) : '') });
    if (c.lastTouchAt) events.push({ ts: new Date(c.lastTouchAt).getTime(), icon: 'sparkles', bg: 'rgba(139,92,246,.12)', color: '#8b5cf6',
      text: (c.lastTouch ? pEsc(c.lastTouch) + ' sent to ' : 'Touch logged for ') + '<strong>' + pEsc(c.name) + '</strong>' });
  });
  (data.deals || []).forEach(function(d) {
    if (d.createdAt) events.push({ ts: new Date(d.createdAt).getTime(), icon: 'dollar-sign', bg: 'rgba(5,150,105,.12)', color: '#059669',
      text: 'Deal <strong>' + pEsc(d.name) + '</strong>' + (d.stage ? ' · ' + pEsc(d.stage) : '') });
  });
  events.sort(function(a, b) { return b.ts - a.ts; });
  var top = events.slice(0, 4);
  if (!top.length) {
    el.innerHTML = '<div class="empty-note">New leads and automation events will appear here.</div>';
    return;
  }
  el.innerHTML = top.map(function(ev, i) {
    return '<div class="act-item" style="animation-delay:' + (i * 45) + 'ms">' +
      '<div class="act-icon" style="background:' + ev.bg + ';color:' + ev.color + ';"><i data-lucide="' + ev.icon + '"></i></div>' +
      '<div class="act-text">' + ev.text + '</div>' +
      '<div class="act-time">' + pRelTime(ev.ts) + '</div>' +
      '</div>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ── Recommended for you (rule-based, taps into Flowy) ─────────────────────── */
function renderRecommended(data) {
  var el = document.getElementById('pt-rec');
  if (!el) return;
  var recs = [];
  var att = (data.needsAttention || []).length;
  var contacts = data.contacts || [], deals = data.deals || [];
  var now = Date.now();

  if (att > 0) {
    recs.push({ icon: 'alert-circle', bg: 'rgba(217,119,6,.12)', color: '#d97706',
      text: '<strong>' + att + ' lead' + (att === 1 ? '' : 's') + '</strong> waiting on a first touch — momentum fades fast.',
      cta: 'Ask Flowy who needs attention', q: 'Who needs attention?' });
  }
  var soon = deals.filter(function(d) {
    if (!d.closingDate) return false;
    var t = new Date(d.closingDate).getTime();
    return t >= now - 86400000 && t <= now + 7 * 86400000;
  });
  if (soon.length) {
    var tot = 0; soon.forEach(function(d) { tot += d.amount || 0; });
    recs.push({ icon: 'dollar-sign', bg: 'rgba(5,150,105,.12)', color: '#059669',
      text: '<strong>' + soon.length + ' deal' + (soon.length === 1 ? '' : 's') + '</strong>' + (tot ? ' worth <strong>$' + Number(tot).toLocaleString() + '</strong>' : '') + ' close this week — worth a prep pass.',
      cta: 'See what closes this week', q: 'What closes this week?' });
  }
  try {
    var g = goalTarget();
    var ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
    var mo = contacts.filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= ms.getTime(); }).length;
    var nowD = new Date();
    var elapsed = nowD.getDate() / new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
    if (g > 0 && elapsed > 0.2 && (mo / g) / elapsed < 0.7) {
      recs.push({ icon: 'target', bg: 'rgba(0,87,255,.12)', color: '#0057FF',
        text: 'You\u2019re at <strong>' + mo + ' of ' + g + '</strong> leads — behind pace for the month.',
        cta: 'Check my goal', q: 'How is my goal?' });
    }
  } catch (e) {}
  var hot = contacts.filter(function(c) { return String(c.status || '').toUpperCase().indexOf('HOT') !== -1; });
  if (hot.length) {
    recs.push({ icon: 'flame', bg: 'rgba(220,38,38,.12)', color: '#dc2626',
      text: '<strong>' + hot.length + ' HOT lead' + (hot.length === 1 ? '' : 's') + '</strong> on the board — strike while it\u2019s warm.',
      cta: 'Show my hot leads', q: 'How many hot leads do I have?' });
  }
  // Evergreen fillers
  recs.push({ icon: 'sparkles', bg: 'rgba(139,92,246,.12)', color: '#8b5cf6',
    text: 'Start the day with a 20-second rundown of where everything stands.',
    cta: 'Get my daily briefing', q: 'Daily briefing' });
  recs.push({ icon: 'file-text', bg: 'rgba(0,87,255,.12)', color: '#0057FF',
    text: 'Need something for a meeting? Flowy builds custom reports on request.',
    cta: 'What can you do?', q: 'What can you do?' });

  el.innerHTML = recs.slice(0, 4).map(function(r) {
    return '<div class="rec-item" onclick="recAsk(\'' + r.q.replace(/[^\w\s?]/g, '') + '\')">' +
      '<div class="rec-icon" style="background:' + r.bg + ';color:' + r.color + ';"><i data-lucide="' + r.icon + '"></i></div>' +
      '<div><div class="rec-text">' + r.text + '</div>' +
      '<div class="rec-cta">' + pEsc(r.cta) + ' →</div></div>' +
      '</div>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function recAsk(q) {
  var card = document.getElementById('flowy-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function() { if (typeof flowySend === 'function') flowySend(q); }, 350);
}
window.recAsk = recAsk;
