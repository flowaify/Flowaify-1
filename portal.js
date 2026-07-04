/* Flowaify Workspace hub — live snapshot, service status, setup progress.
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

/* ── Authenticated snapshot + setup progress ────────────────────────────────── */
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
    pSet('setup-count', 'Couldn’t check your setup right now.');
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

  // Setup progress — derived from real signals only
  var goalSet = false;
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    var g = parseInt((saved.biz || {})['s2-goal-leads'], 10);
    goalSet = isFinite(g) && g > 0;
  } catch (e) {}

  var steps = [
    { label: 'CRM connected',            done: true,
      sub: 'Zoho is syncing to your dashboard' },
    { label: 'Workspace access',         done: true,
      sub: 'You’re signed in and ready' },
    { label: 'Monthly lead goal set',    done: goalSet,
      sub: goalSet ? 'Tracking on your Overview gauge' : 'Set it in Dashboard → Settings → General' },
    { label: 'Automations live',         done: (overview.aiRepliesSent || 0) > 0 || (overview.activeSequences || 0) > 0,
      sub: 'AI replies and follow-up sequences running' },
    { label: 'Lead scoring live',        done: contacts.some(function(c) { return c.status && String(c.status).trim(); }),
      sub: 'Hot / Warm / Cold labels flowing in' },
    { label: 'First booked call',        done: (overview.bookedCalls || 0) > 0,
      sub: 'The moment it all pays off' },
  ];

  var doneCount = steps.filter(function(s) { return s.done; }).length;
  var fill = document.getElementById('setup-fill');
  if (fill) fill.style.width = Math.round((doneCount / steps.length) * 100) + '%';
  pSet('setup-count', doneCount + ' of ' + steps.length + ' complete');
  pSet('setup-count-head', doneCount === steps.length ? 'All set 🎉' : (steps.length - doneCount) + ' to go');

  var list = document.getElementById('setup-list');
  if (list) {
    list.innerHTML = steps.map(function(s) {
      return '<div class="setup-item' + (s.done ? ' done' : '') + '">' +
        '<span class="setup-check"><i data-lucide="check"></i></span>' +
        '<div><div>' + pEsc(s.label) + '</div>' +
        '<div style="font-size:10.5px;color:var(--text-m);">' + pEsc(s.sub) + '</div></div>' +
        '</div>';
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
