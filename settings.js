// settings.js — Enterprise Settings page backed by Worker /settings KV config (v1)
// All Authorization headers live here, never in app.html (WAF constraint).

var _st = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';
var _stCfg = null;

// ── Authenticated fetch ───────────────────────────────────────────────────────

async function stFetch(method, path, body) {
  var client = window.__auth0Client || window.auth0Client;
  if (!client) return { status: 0 };
  var claims;
  try { claims = await client.getIdTokenClaims(); } catch (e) { return { status: 0 }; }
  if (!claims || !claims.__raw) return { status: 0 };
  try {
    var res = await fetch(_st + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data };
  } catch (e) { return { status: 0 }; }
}

// ── Tab switcher ──────────────────────────────────────────────────────────────

function settingsTab(tab) {
  document.querySelectorAll('#page-settings .pivot-pane').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('#page-settings [data-stab]').forEach(function(b) { b.classList.remove('active'); });
  var pane = document.getElementById('st-' + tab);
  if (pane) pane.classList.add('active');
  var btn = document.querySelector('#page-settings [data-stab="' + tab + '"]');
  if (btn) btn.classList.add('active');
  if (tab === 'team') stLoadTeam();
  if (tab === 'channels') stGmailUI();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.settingsTab = settingsTab;

// ── Load config ───────────────────────────────────────────────────────────────

async function loadSettings() {
  var r = await stFetch('GET', '/settings');
  if (r.status !== 200 || !r.data || !r.data.config) return;
  _stCfg = r.data.config;
  applySettingsToUI(_stCfg);
  stMirror(_stCfg);
}
window.loadSettings = loadSettings;

// ── Apply config to UI ────────────────────────────────────────────────────────

function stSet(id, val) { var el = document.getElementById(id); if (el) el.value = (val == null ? '' : val); }
function stSetToggle(id, on) { var el = document.getElementById(id); if (el) el.classList.toggle('on', !!on); }

function applySettingsToUI(cfg) {
  if (!cfg) return;
  var p = cfg.profile || {};
  stSet('s-bizName', p.businessName);
  stSet('s-industry', p.industry);
  stSet('s-contactEmail', p.contactEmail);
  stSet('s-phone', p.phone);
  stSet('s-website', p.website);
  stSet('s-leadGoal', p.monthlyLeadGoal || '');
  var tz = document.getElementById('s-timezone');
  if (tz) tz.value = p.timezone || 'America/New_York';

  var bl = cfg.billing || {};
  stSet('s-inv-legal', bl.legalName);
  stSet('s-inv-addr1', bl.address1);
  stSet('s-inv-addr2', bl.address2);
  stSet('s-inv-city', bl.city);
  stSet('s-inv-region', bl.region);
  stSet('s-inv-postal', bl.postal);
  stSet('s-inv-country', bl.country);
  stSet('s-inv-supportEmail', bl.supportEmail);
  stSet('s-inv-taxId', bl.taxId);
  var curSel = document.getElementById('s-inv-currency');
  if (curSel) curSel.value = bl.defaultCurrency || 'USD';

  stSet('s-webhookUrl', cfg.webhookUrl);

  // Channels — SMS status is read-only (provisioned by Flowaify)
  var ch = cfg.channels || {};
  var smsBadge = document.getElementById('s-smsStatusBadge');
  if (smsBadge) {
    smsBadge.textContent = ch.sms ? 'Enabled' : 'Contact Flowaify to enable';
    smsBadge.className = 'badge ' + (ch.sms ? 'b-conn' : 'b-low');
  }
  var segs = ch.smsSegments || [];
  document.querySelectorAll('#s-smsSegments .seg-chip').forEach(function(chip) {
    chip.classList.toggle('active', segs.indexOf(chip.getAttribute('data-seg')) !== -1);
  });

  var ops = cfg.operations || {};
  stSet('s-fromEmail', ops.fromEmail || 'Not configured yet');

  // CRM — generic naming, datacenter shown as region only
  var crmBadge = document.getElementById('s-crmBadge');
  if (crmBadge) {
    var provisioned = !!((cfg.zoho || {}).datacenter);
    crmBadge.textContent = provisioned ? 'Provisioned' : 'Not provisioned';
    crmBadge.className = 'badge ' + (provisioned ? 'b-conn' : 'b-low');
  }
  var dc = String((cfg.zoho || {}).datacenter || '');
  var region = 'US';
  if (dc.indexOf('.eu') !== -1) region = 'EU';
  else if (dc.indexOf('.in') !== -1) region = 'IN';
  else if (dc.indexOf('.com.au') !== -1) region = 'AU';
  else if (dc.indexOf('.jp') !== -1) region = 'JP';
  stSet('s-crmRegion', region);

  var fc = cfg.followupCadence || {};
  stSet('s-cadenceEmail', Array.isArray(fc.email) ? fc.email.join(', ') : '');
  stSet('s-cadenceSms', Array.isArray(fc.sms) ? fc.sms.join(', ') : '');

  var ai = cfg.ai || {};
  var delay = ai.responseDelayMinutes || 0;
  var delayEl = document.getElementById('s-responseDelay');
  var delayVal = document.getElementById('s-responseDelayVal');
  if (delayEl) delayEl.value = delay;
  if (delayVal) delayVal.textContent = delay;
  stSetToggle('t-pauseHours', ai.pauseOutsideHours);
  stSetToggle('t-requireApproval', ai.requireApproval);
  stSetToggle('t-escalation', ai.escalation);
  var thresh = (ai.escalationThreshold == null ? 60 : ai.escalationThreshold);
  var threshEl = document.getElementById('s-escalationThreshold');
  var threshVal = document.getElementById('s-escalationThresholdVal');
  if (threshEl) threshEl.value = thresh;
  if (threshVal) threshVal.textContent = thresh;
  stSet('s-personaText', ai.personaText);
  stSet('s-fallbackTemplate', ai.fallbackTemplate);

  var n = cfg.notifications || {};
  stSetToggle('t-notifNewLead', n.newLead);
  stSetToggle('t-notifBooked', n.bookedCall);
  stSetToggle('t-notifUnresponsive', n.unresponsiveLead);
  stSetToggle('t-weeklyReport', n.weeklyReport);
  var days = cfg.reportDays || [];
  document.querySelectorAll('#s-reportDays .seg-chip').forEach(function(chip) {
    chip.classList.toggle('active', days.indexOf(chip.getAttribute('data-day')) !== -1);
  });
  var rm = document.getElementById('s-reportMode');
  if (rm) rm.value = cfg.reportMode || 'rolling7day';

  var planMap = { starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise' };
  var descMap = {
    starter: 'Core lead capture and AI replies',
    growth: 'Includes follow-up sequences and analytics',
    pro: 'Full automation engine with deep scoring',
    enterprise: 'Custom automation, dedicated support'
  };
  var plan = cfg.plan || 'starter';
  var pn = document.getElementById('s-planName');
  var pd = document.getElementById('s-planDesc');
  if (pn) pn.textContent = planMap[plan] || plan;
  if (pd) pd.textContent = descMap[plan] || '';
}

// ── Mirror profile into legacy localStorage (goal gauge, invoices, reports,
//    portal.html all read flw_settings_{sub}) ─────────────────────────────────

function stMirror(cfg) {
  try {
    var key = 'flw_settings_' + (window.__userSub || 'anon');
    var saved = JSON.parse(localStorage.getItem(key) || '{}');
    var p = (cfg && cfg.profile) || {};
    saved.businessName = p.businessName || saved.businessName || '';
    saved.biz = saved.biz || {};
    saved.biz['s2-biz-name'] = p.businessName || '';
    saved.biz['s2-biz-email'] = p.contactEmail || '';
    saved.biz['s2-email'] = p.contactEmail || '';
    saved.biz['s2-biz-phone'] = p.phone || '';
    saved.biz['s2-biz-site'] = p.website || '';
    saved.biz['s2-industry'] = p.industry || '';
    saved.biz['s2-goal-leads'] = p.monthlyLeadGoal ? String(p.monthlyLeadGoal) : (saved.biz['s2-goal-leads'] || '');
    localStorage.setItem(key, JSON.stringify(saved));
  } catch (e) {}
  if (window.__crmData && typeof renderGoalGauge === 'function') {
    renderGoalGauge(window.__crmData.contacts || []);
  }
}

// ── Core save (all sections call this with a partial payload) ─────────────────

async function pushSettings(partial, statusId) {
  var statusEl = statusId ? document.getElementById(statusId) : null;
  var r = await stFetch('PUT', '/settings', partial);
  if (r.status === 200 && r.data && r.data.config) {
    _stCfg = r.data.config;
    stMirror(_stCfg);
    if (statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.style.color = '';
      statusEl.classList.add('visible');
      setTimeout(function() { statusEl.classList.remove('visible'); }, 2500);
    }
    return true;
  }
  if (r.status === 403 && typeof showToast === 'function') {
    showToast((r.data && r.data.message) || 'Only admins can change settings.');
  }
  if (statusEl) {
    statusEl.textContent = 'Error saving';
    statusEl.style.color = 'var(--red)';
    statusEl.classList.add('visible');
    setTimeout(function() {
      statusEl.classList.remove('visible');
      statusEl.textContent = 'Saved';
      statusEl.style.color = '';
    }, 3000);
  } else if (typeof showToast === 'function') {
    showToast('Could not save settings. Please try again.');
  }
  return false;
}
window.pushSettings = pushSettings;

// ── Section saves ─────────────────────────────────────────────────────────────

function saveGeneralSettings() {
  pushSettings({
    profile: {
      businessName: (document.getElementById('s-bizName') || {}).value || '',
      industry: (document.getElementById('s-industry') || {}).value || '',
      contactEmail: (document.getElementById('s-contactEmail') || {}).value || '',
      phone: (document.getElementById('s-phone') || {}).value || '',
      website: (document.getElementById('s-website') || {}).value || '',
      timezone: (document.getElementById('s-timezone') || {}).value || 'America/New_York',
      monthlyLeadGoal: Number((document.getElementById('s-leadGoal') || {}).value) || 0
    }
  }, 'ss-general-status');
}
window.saveGeneralSettings = saveGeneralSettings;

function saveWebhookSettings() {
  var url = ((document.getElementById('s-webhookUrl') || {}).value || '').trim();
  pushSettings({ webhookUrl: url || null }, 'ss-webhook-status');
}
window.saveWebhookSettings = saveWebhookSettings;

function saveBillingSettings() {
  function v(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
  pushSettings({
    billing: {
      legalName: v('s-inv-legal'), address1: v('s-inv-addr1'), address2: v('s-inv-addr2'),
      city: v('s-inv-city'), region: v('s-inv-region'), postal: v('s-inv-postal'),
      country: v('s-inv-country'), supportEmail: v('s-inv-supportEmail'), taxId: v('s-inv-taxId'),
      defaultCurrency: v('s-inv-currency') || 'USD'
    }
  }, 'ss-billing-status');
}
window.saveBillingSettings = saveBillingSettings;

function saveChannelsSettings() {
  var segs = [];
  document.querySelectorAll('#s-smsSegments .seg-chip.active').forEach(function(c) {
    segs.push(c.getAttribute('data-seg'));
  });
  pushSettings({ channels: { smsSegments: segs } }, 'ss-channels-status');
}
window.saveChannelsSettings = saveChannelsSettings;

function saveCRMSettings() {
  function parseCadence(str) {
    if (!str || !str.trim()) return null; // blank = channel disabled
    return str.split(',').map(function(s) { return parseInt(s.trim(), 10); })
      .filter(function(n) { return !isNaN(n) && n >= 0; });
  }
  pushSettings({
    followupCadence: {
      email: parseCadence((document.getElementById('s-cadenceEmail') || {}).value),
      sms: parseCadence((document.getElementById('s-cadenceSms') || {}).value)
    }
  }, 'ss-crm-status');
}
window.saveCRMSettings = saveCRMSettings;

function saveAISettings() {
  pushSettings({
    ai: {
      responseDelayMinutes: Number((document.getElementById('s-responseDelay') || {}).value) || 0,
      pauseOutsideHours: !!(document.getElementById('t-pauseHours') || { classList: { contains: function(){} } }).classList.contains('on'),
      requireApproval: !!(document.getElementById('t-requireApproval') || { classList: { contains: function(){} } }).classList.contains('on')
    }
  }, 'ss-ai-status');
}
window.saveAISettings = saveAISettings;

function saveEscalationSettings() {
  var esc = document.getElementById('t-escalation');
  pushSettings({
    ai: {
      escalation: !!(esc && esc.classList.contains('on')),
      escalationThreshold: Number((document.getElementById('s-escalationThreshold') || {}).value) || 60
    }
  }, 'ss-escalation-status');
}
window.saveEscalationSettings = saveEscalationSettings;

function savePersonaSettings() {
  pushSettings({
    ai: {
      personaText: ((document.getElementById('s-personaText') || {}).value || '').trim(),
      fallbackTemplate: ((document.getElementById('s-fallbackTemplate') || {}).value || '').trim()
    }
  }, 'ss-persona-status');
}
window.savePersonaSettings = savePersonaSettings;

function saveNotifSettings() {
  function on(id) { var el = document.getElementById(id); return !!(el && el.classList.contains('on')); }
  pushSettings({
    notifications: {
      newLead: on('t-notifNewLead'),
      bookedCall: on('t-notifBooked'),
      unresponsiveLead: on('t-notifUnresponsive'),
      weeklyReport: on('t-weeklyReport')
    }
  }, 'ss-notif-status');
}
window.saveNotifSettings = saveNotifSettings;

function saveReportSettings() {
  var days = [];
  document.querySelectorAll('#s-reportDays .seg-chip.active').forEach(function(c) {
    days.push(c.getAttribute('data-day'));
  });
  var wr = document.getElementById('t-weeklyReport');
  pushSettings({
    reportDays: days,
    reportMode: (document.getElementById('s-reportMode') || {}).value || 'rolling7day',
    notifications: { weeklyReport: !!(wr && wr.classList.contains('on')) }
  }, 'ss-report-status');
}
window.saveReportSettings = saveReportSettings;

// ── Toggle helpers ────────────────────────────────────────────────────────────

function stToggleAI(field, el) {
  el.classList.toggle('on');
  var val = el.classList.contains('on');
  if (field === 'escalation') return; // saved via its section's Save button
  var partial = { ai: {} };
  partial.ai[field] = val;
  pushSettings(partial, 'ss-ai-status');
}
window.stToggleAI = stToggleAI;

function stToggleNotif(field, el) {
  el.classList.toggle('on');
  var partial = { notifications: {} };
  partial.notifications[field] = el.classList.contains('on');
  pushSettings(partial, 'ss-notif-status');
}
window.stToggleNotif = stToggleNotif;

function toggleSeg(chip) { chip.classList.toggle('active'); }
window.toggleSeg = toggleSeg;

function toggleReportDay(chip) { chip.classList.toggle('active'); }
window.toggleReportDay = toggleReportDay;

// ── Gmail connect / disconnect (reuses existing /inbox endpoints) ─────────────

async function stGmailUI() {
  var r = await stFetch('GET', '/inbox/status');
  var connected = !!(r.data && r.data.connected);
  var badge = document.getElementById('s-gmailBadge');
  var btn = document.getElementById('s-gmailBtn');
  var desc = document.getElementById('s-gmailDesc');
  if (badge) { badge.textContent = connected ? 'Connected' : 'Disconnected'; badge.className = 'badge ' + (connected ? 'b-conn' : 'b-low'); }
  if (btn) btn.textContent = connected ? 'Disconnect' : 'Connect';
  if (desc) desc.textContent = connected ? 'Inbox connected and syncing' : 'Not connected';
}
window.stGmailUI = stGmailUI;

async function handleGmailToggle() {
  var btn = document.getElementById('s-gmailBtn');
  var connected = btn && btn.textContent.trim() === 'Disconnect';
  if (connected) {
    if (!confirm('Disconnect your email account? You can reconnect at any time.')) return;
    await stFetch('POST', '/inbox/disconnect');
    stGmailUI();
    if (typeof showToast === 'function') showToast('Email disconnected.');
  } else {
    var r = await stFetch('GET', '/inbox/auth?provider=gmail');
    if (r.data && r.data.url) { window.location.href = r.data.url; return; }
    if (typeof showToast === 'function') showToast('Could not start the connection. Please try again.');
  }
}
window.handleGmailToggle = handleGmailToggle;

// ── Team roster (read-only; management lives on the Team page) ────────────────

async function stLoadTeam() {
  var list = document.getElementById('st-team-list');
  if (!list) return;
  var members = (window.__teamDoc && window.__teamDoc.members) || null;
  if (!members) {
    var r = await stFetch('GET', '/team');
    members = (r.data && r.data.doc && r.data.doc.members) || [];
  }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  if (!members.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-m);padding:8px 0;">No team members yet — invite one below.</div>';
    return;
  }
  list.innerHTML = members.map(function(m) {
    return '<div class="toggle-row">' +
      '<div><div class="toggle-label">' + esc(m.name || m.email) + '</div>' +
      '<div class="toggle-sub">' + esc(m.email) + '</div></div>' +
      '<span class="badge b-conn" style="text-transform:capitalize;">' + esc(m.role || 'member') + '</span>' +
    '</div>';
  }).join('');
}
window.stLoadTeam = stLoadTeam;

function stInvite() {
  if (window.openInvite) { openInvite(); return; }
  if (typeof showPage === 'function') showPage('team');
}
window.stInvite = stInvite;

// ── Security ──────────────────────────────────────────────────────────────────

async function sendPasswordReset() {
  var client = window.__auth0Client || window.auth0Client;
  if (!client) return;
  var user;
  try { user = await client.getUser(); } catch (e) { return; }
  if (!user || !user.email) return;
  if (!confirm('Send a password reset email to ' + user.email + '?')) return;
  try {
    var res = await fetch('https://' + AUTH0_DOMAIN + '/dbconnections/change_password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: AUTH0_CLIENT_ID,
        email: user.email,
        connection: 'Username-Password-Authentication'
      })
    });
    if (typeof showToast === 'function') {
      showToast(res.ok ? 'Password reset email sent to ' + user.email + '.' : 'Could not send the reset email — please try again.');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Could not send the reset email — please try again.');
  }
}
window.sendPasswordReset = sendPasswordReset;

async function signOutAll() {
  if (!confirm('Sign out of all sessions? You will be logged out immediately.')) return;
  var client = window.__auth0Client || window.auth0Client;
  if (!client) return;
  try { await client.logout({ logoutParams: { returnTo: 'https://flowaify.app/portal.html' } }); } catch (e) {}
}
window.signOutAll = signOutAll;

// ══════════════════════════════════════════════════════════════════════════════
// AUTOMATIONS PAGE MODULE — KV-backed toggles + live activity feed
// Lives here (not app.html) so every /settings fetch keeps its Authorization
// header inside a .js file (WAF constraint). Loaded before the inline script,
// so boot()'s restoreAutoToggles() call resolves to these definitions.
// ══════════════════════════════════════════════════════════════════════════════

var AUTO_TOGGLE_IDS = [
  'tog-sms', 'tog-email', 'tog-autoreply',
  'tog-escalation', 'tog-pause-hours', 'tog-behavioral'
];

function autoTogglesKey() { return 'flw_autos_' + (window.__userSub || 'anon'); }
function autoPrepauseKey() { return 'flw_autos_prepause_' + (window.__userSub || 'anon'); }

function autoCanEdit() {
  return !window.__myRole || window.__myRole === 'admin' || window.__myRole === 'owner';
}

/* Cadence arrays on resume: prefer the client's configured cadence from the
   last loaded KV config, fall back to defaults. The toggle is a circuit
   breaker, not a cadence editor. */
function autoEmailCadence() {
  var fc = window._autoLastCfg && window._autoLastCfg.followupCadence;
  return (fc && Array.isArray(fc.email) && fc.email.length) ? fc.email : [3, 7];
}
function autoSmsCadence() {
  var fc = window._autoLastCfg && window._autoLastCfg.followupCadence;
  return (fc && Array.isArray(fc.sms) && fc.sms.length) ? fc.sms : [0, 5, 7];
}

/* All six controls map to real KV config fields — no toggle is a no-op.
   INVERSION: autoreply UI ON = AI sends freely = ai.requireApproval FALSE.
   Must stay consistent with applyAutoTogglesToUI(). */
var AUTO_CFG_MAP = {
  'sms':         function(on) { return { followupCadence: { sms:   on ? autoSmsCadence()   : null } }; },
  'email':       function(on) { return { followupCadence: { email: on ? autoEmailCadence() : null } }; },
  'autoreply':   function(on) { return { ai: { requireApproval: !on } }; },
  'escalation':  function(on) { return { ai: { escalation: on } }; },
  'pause-hours': function(on) { return { ai: { pauseOutsideHours: on } }; },
  'behavioral':  function(on) { return { behavioralSignal: on }; }
};

var AUTO_LABELS = {
  'sms': 'SMS Follow-up Sequence', 'email': 'Email Follow-up Sequence',
  'autoreply': 'AI Auto-Reply', 'escalation': 'Deep-Score Escalation',
  'pause-hours': 'Pause Outside Business Hours', 'behavioral': 'Behavioral Signal Tracking'
};

function updateAutoActiveCount() {
  var active = AUTO_TOGGLE_IDS.filter(function(id) {
    var el = document.getElementById(id);
    return el && el.classList.contains('on');
  }).length;
  var valEl = document.getElementById('val-auto-active');
  if (valEl) valEl.textContent = active;
  var dot = document.getElementById('auto-live-dot');
  if (dot) dot.classList.toggle('active', active > 0);
  var master = document.getElementById('auto-master-btn');
  if (master) master.textContent = active > 0 ? 'Pause all' : 'Resume all';
}

/* Fast optimistic render at boot from localStorage. automationsInit()
   overrides with KV truth when the page is actually opened. */
function restoreAutoToggles() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(autoTogglesKey()) || '{}'); } catch (e) {}
  AUTO_TOGGLE_IDS.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var key = id.replace('tog-', '');
    if (key in saved) el.classList.toggle('on', !!saved[key]);
  });
  updateAutoActiveCount();
}

function autoSaveLocalState() {
  var state = {};
  AUTO_TOGGLE_IDS.forEach(function(id) {
    var t = document.getElementById(id);
    if (t) state[id.replace('tog-', '')] = t.classList.contains('on');
  });
  try { localStorage.setItem(autoTogglesKey(), JSON.stringify(state)); } catch (e) {}
}

function autoLogActivity(text) {
  if (window.twFetch) { try { twFetch('POST', '/team/activity', { text: text }); } catch (e) {} }
}

function toggleAuto(el, name) {
  if (!autoCanEdit()) {
    if (typeof showToast === 'function') showToast('Only admins can change automations.');
    return;
  }
  el.classList.toggle('on');
  var isOn = el.classList.contains('on');
  updateAutoActiveCount();
  autoSaveLocalState();

  if (AUTO_CFG_MAP[name] && window.pushSettings) {
    pushSettings(AUTO_CFG_MAP[name](isOn), 'auto-save-status');
  }

  var label = AUTO_LABELS[name] || name;
  if (typeof showToast === 'function') showToast((isOn ? 'Resumed: ' : 'Paused: ') + label);
  autoLogActivity((isOn ? 'resumed' : 'paused') + ' the “' + label + '” automation');
}

/* Pause All / Resume All — the emergency brake. Pausing snapshots current
   states + cadences so Resume restores exactly what was running before. */
async function autoMasterToggle() {
  if (!autoCanEdit()) {
    if (typeof showToast === 'function') showToast('Only admins can change automations.');
    return;
  }
  var anyOn = AUTO_TOGGLE_IDS.some(function(id) {
    var el = document.getElementById(id);
    return el && el.classList.contains('on');
  });

  function setT(id, val) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!val);
  }

  if (anyOn) {
    var snap = { toggles: {}, emailCadence: autoEmailCadence(), smsCadence: autoSmsCadence() };
    AUTO_TOGGLE_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      snap.toggles[id.replace('tog-', '')] = !!(el && el.classList.contains('on'));
    });
    try { localStorage.setItem(autoPrepauseKey(), JSON.stringify(snap)); } catch (e) {}

    AUTO_TOGGLE_IDS.forEach(function(id) { setT(id, false); });
    updateAutoActiveCount();
    autoSaveLocalState();
    if (window.pushSettings) {
      pushSettings({
        followupCadence: { sms: null, email: null },
        ai: { requireApproval: true, escalation: false, pauseOutsideHours: false },
        behavioralSignal: false
      }, 'auto-save-status');
    }
    if (typeof showToast === 'function') showToast('All automations paused');
    autoLogActivity('paused all automations');
  } else {
    var snap2 = null;
    try { snap2 = JSON.parse(localStorage.getItem(autoPrepauseKey()) || 'null'); } catch (e) {}
    var t = (snap2 && snap2.toggles) || { sms: true, email: true, autoreply: true };
    var email = t.email ? ((snap2 && snap2.emailCadence) || [3, 7]) : null;
    var sms   = t.sms   ? ((snap2 && snap2.smsCadence)   || [0, 5, 7]) : null;

    Object.keys(t).forEach(function(k) { setT('tog-' + k, t[k]); });
    updateAutoActiveCount();
    autoSaveLocalState();
    if (window.pushSettings) {
      pushSettings({
        followupCadence: { sms: sms, email: email },
        ai: {
          requireApproval: !t.autoreply,
          escalation: !!t.escalation,
          pauseOutsideHours: !!t['pause-hours']
        },
        behavioralSignal: !!t.behavioral
      }, 'auto-save-status');
    }
    if (typeof showToast === 'function') showToast('Automations resumed');
    autoLogActivity('resumed automations');
  }
}

/* KV truth → toggle UI. Must mirror AUTO_CFG_MAP inversions exactly:
   requireApproval=false → autoreply toggle ON. */
function applyAutoTogglesToUI(cfg) {
  if (!cfg) return;
  window._autoLastCfg = cfg;

  function setToggle(id, val) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!val);
  }

  var fc = cfg.followupCadence || {};
  setToggle('tog-email', Array.isArray(fc.email) && fc.email.length > 0);
  setToggle('tog-sms',   Array.isArray(fc.sms)   && fc.sms.length > 0);
  setToggle('tog-autoreply', !(cfg.ai && cfg.ai.requireApproval));
  setToggle('tog-escalation', !!(cfg.ai && cfg.ai.escalation));
  setToggle('tog-pause-hours', !!(cfg.ai && cfg.ai.pauseOutsideHours));
  setToggle('tog-behavioral', !!cfg.behavioralSignal);

  var smsNote = document.getElementById('auto-sms-note');
  if (smsNote) smsNote.style.display = (cfg.channels && cfg.channels.sms) ? 'none' : 'flex';

  var emailCadEl = document.getElementById('auto-email-cadence');
  if (emailCadEl) emailCadEl.textContent = (Array.isArray(fc.email) && fc.email.length) ? 'Days ' + fc.email.join(', ') : 'Not configured';
  var smsCadEl = document.getElementById('auto-sms-cadence');
  if (smsCadEl) smsCadEl.textContent = (Array.isArray(fc.sms) && fc.sms.length) ? 'Days ' + fc.sms.join(', ') : 'Not configured';
  var threshEl = document.getElementById('auto-esc-threshold');
  if (threshEl) threshEl.textContent = ((cfg.ai && cfg.ai.escalationThreshold != null) ? cfg.ai.escalationThreshold : 60) + '/100';

  autoSaveLocalState();
  updateAutoActiveCount();
}

/* Visual lock for members/viewers — Worker enforces admin on writes;
   this just makes that visible instead of a silent flip-and-fail. */
function autoApplyRoleLock() {
  var locked = !autoCanEdit();
  AUTO_TOGGLE_IDS.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('locked', locked);
  });
  var master = document.getElementById('auto-master-btn');
  if (master) master.style.display = locked ? 'none' : '';
}

/* Called by showPage('automations'). KV config is the authoritative
   toggle-state source; localStorage state (applied at boot) is the fallback. */
async function automationsInit() {
  autoApplyRoleLock();

  stFetch('GET', '/settings').then(function(r) {
    if (r.status === 200 && r.data && r.data.config) applyAutoTogglesToUI(r.data.config);
  }).catch(function() {});

  if (window.__crmData && window.__crmData.contacts) {
    renderAutoActivity(window.__crmData.contacts);
  } else {
    var feed = document.getElementById('auto-activity');
    if (feed) feed.innerHTML = autoActivitySkeleton();
    var waitAttempts = 0;
    var waitForData = setInterval(function() {
      waitAttempts++;
      if (window.__crmData) {
        clearInterval(waitForData);
        renderAutoActivity(window.__crmData.contacts || []);
      } else if (waitAttempts >= 20) {
        clearInterval(waitForData);
        var f = document.getElementById('auto-activity');
        if (f) { f.innerHTML = autoEmptyState(); if (typeof lucide !== 'undefined') lucide.createIcons(); }
      }
    }, 400);
  }

  if (window._autoHeartbeatInterval) clearInterval(window._autoHeartbeatInterval);
  window._autoHeartbeatInterval = setInterval(function() {
    if (window.__crmData) renderAutoActivity(window.__crmData.contacts || []);
  }, 90000);
}

function autoActivitySkeleton() {
  var rows = '';
  for (var i = 0; i < 4; i++) {
    rows += '<div class="auto-activity-item" style="animation-delay:' + (i * 0.08) + 's">' +
      '<div class="skel skel-icon"></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:6px;padding-top:2px;">' +
        '<div class="skel skel-line" style="width:58%;"></div>' +
        '<div class="skel skel-line" style="width:36%;"></div>' +
      '</div>' +
    '</div>';
  }
  return rows;
}

/* Feed built from SHAPED contacts (Worker shapeContact): status, lastTouch,
   lastTouchAt, score, createdAt, name — not raw Zoho flow_* field names. */
function renderAutoActivity(contacts) {
  var feed = document.getElementById('auto-activity');
  if (!feed) return;

  if (!contacts || contacts.length === 0) {
    feed.innerHTML = autoEmptyState();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  var active = contacts.filter(function(c) {
    return c.lastTouchAt || c.status || c.score != null;
  });

  active.sort(function(a, b) {
    var ta = a.lastTouchAt ? new Date(a.lastTouchAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    var tb = b.lastTouchAt ? new Date(b.lastTouchAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });

  var items = active.slice(0, 15);
  if (items.length === 0) {
    feed.innerHTML = autoEmptyState();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  var html = '<div class="auto-activity-list">';
  for (var i = 0; i < items.length; i++) html += buildAutoActivityItem(items[i], i);
  html += '</div>';
  feed.innerHTML = html;

  var syncEl = document.getElementById('auto-sync-ts');
  if (syncEl) syncEl.textContent = 'Synced just now';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function buildAutoActivityItem(contact, index) {
  var esc = window.escDash || function(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var name = esc(contact.name || 'Unknown Lead');
  var score = contact.score != null ? contact.score : null;
  var state = String(contact.status || '').toUpperCase();
  var touchType = String(contact.lastTouch || '').toUpperCase();
  var touchAt = contact.lastTouchAt ? new Date(contact.lastTouchAt) : null;
  var createdAt = contact.createdAt ? new Date(contact.createdAt) : null;
  var ts = touchAt || createdAt;

  var icon, label, color;

  if (state === 'ENGAGED') {
    icon = 'message-circle'; color = 'var(--green)';
    label = name + ' replied — marked Engaged';
  } else if (state.indexOf('BOOK') !== -1) {
    icon = 'calendar-check'; color = 'var(--green)';
    label = name + ' booked a call';
  } else if (touchType.indexOf('SMS') !== -1) {
    icon = 'message-square'; color = 'var(--blue)';
    label = 'SMS follow-up sent to ' + name;
  } else if (touchType.indexOf('FOLLOWUP') !== -1 || touchType.indexOf('EMAIL') !== -1) {
    icon = 'mail'; color = 'var(--blue)';
    label = 'Email follow-up sent to ' + name;
  } else if (state === 'HOT' && score != null) {
    icon = 'flame'; color = 'var(--red)';
    label = 'HOT lead scored ' + score + '/100 — ' + name;
  } else if (state === 'WARM' && score != null) {
    icon = 'thermometer'; color = 'var(--amber)';
    label = 'WARM lead scored ' + score + '/100 — ' + name;
  } else if (state === 'COLD' && score != null) {
    icon = 'snowflake'; color = 'var(--blue-soft)';
    label = 'COLD lead scored ' + score + '/100 — ' + name;
  } else if (touchType.indexOf('REPLY') !== -1) {
    icon = 'sparkles'; color = 'var(--purple)';
    label = 'AI replied to ' + name;
  } else if (state === 'DEAD') {
    icon = 'x-circle'; color = 'var(--text-m)';
    label = name + ' — sequence exhausted, marked inactive';
  } else {
    icon = 'user-check'; color = 'var(--text-m)';
    label = 'Lead received — ' + name + (score != null ? ' (Score: ' + score + ')' : '');
  }

  var timeStr = (ts && !isNaN(ts.getTime()) && typeof relTime === 'function') ? relTime(ts.getTime()) : '';

  return '<div class="auto-activity-item" style="--i:' + index + '">' +
    '<div class="auto-activity-icon" style="color:' + color + '">' +
      '<i data-lucide="' + icon + '"></i>' +
    '</div>' +
    '<div class="auto-activity-body">' +
      '<div class="auto-activity-label">' + label + '</div>' +
      (timeStr ? '<div class="auto-activity-ts">' + timeStr + '</div>' : '') +
    '</div>' +
  '</div>';
}

function autoEmptyState() {
  var anyOn = AUTO_TOGGLE_IDS.some(function(id) {
    var el = document.getElementById(id);
    return el && el.classList.contains('on');
  });
  if (anyOn) {
    return '<div class="empty-state" style="padding:40px 20px;">' +
      '<div class="auto-standby-icon"><i data-lucide="activity"></i></div>' +
      '<div class="empty-state-title">Engine standing by</div>' +
      '<div class="empty-state-sub">Automations are active. Events will appear here as leads move through the pipeline.</div>' +
    '</div>';
  }
  return '<div class="empty-state" style="padding:40px 20px;">' +
    '<i data-lucide="pause-circle"></i>' +
    '<div class="empty-state-title">All automations paused</div>' +
    '<div class="empty-state-sub">Resume an automation above to start processing leads.</div>' +
  '</div>';
}

window.restoreAutoToggles = restoreAutoToggles;
window.toggleAuto = toggleAuto;
window.autoMasterToggle = autoMasterToggle;
window.automationsInit = automationsInit;
window.renderAutoActivity = renderAutoActivity;
