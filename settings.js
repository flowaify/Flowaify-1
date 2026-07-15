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
// AUTOMATIONS PAGE MODULE — control center: rules, health, details, runs.
// Lives here (not app.html) so every /settings fetch keeps its Authorization
// header inside a .js file (WAF constraint). All toggle state is KV-backed;
// _autoOn is the render source of truth, refreshed from KV on page open.
// ══════════════════════════════════════════════════════════════════════════════

var _autoOn = { autoreply: true, email: true, sms: true, escalation: false, 'pause-hours': false, behavioral: false };
var _autoSelRule = null;
var _autoRunFilter = null;
var _autoLastFeedTs = null;

var AUTO_RULES = [
  { key: 'autoreply', name: 'Instant Lead Reply', type: 'Replies', icon: 'sparkles', ic: 'kg-purple',
    desc: 'Sends a first response to every new qualified lead. When paused, replies are drafted and held for manual approval.',
    trigger: 'Qualified lead created', action: 'Draft or send first reply', applies: 'New qualified leads',
    next: 'On the next qualified lead', tab: 'ai', runMatch: ['REPLY'] },
  { key: 'email', name: 'Follow-up Sequence', type: 'Follow-ups', icon: 'mail', ic: 'kg-blue',
    desc: 'Sends scheduled email touches after initial contact. Pausing stops all future touches.',
    trigger: 'No reply after initial contact', action: 'Send scheduled email touch', applies: 'Leads awaiting response',
    next: 'Scheduled automatically', tab: 'crm', runMatch: ['FOLLOWUP', 'EMAIL'], cadence: 'email' },
  { key: 'sms', name: 'SMS Follow-up', type: 'Messaging', icon: 'message-square', ic: 'kg-green',
    desc: 'Sends scheduled text messages for the configured lead segments.',
    trigger: 'Scheduled cadence day reached', action: 'Send text follow-up', applies: 'Configured SMS segments',
    next: 'Scheduled automatically', tab: 'crm', runMatch: ['SMS'], cadence: 'sms', setupCheck: true },
  { key: 'escalation', name: 'Score Escalation', type: 'Scoring', icon: 'zap', ic: 'kg-amber',
    desc: 'Runs a premium AI analysis on high-scoring leads and flags them for priority follow-up.',
    trigger: 'Lead score at or above threshold', action: 'Deep analysis + priority flag', applies: 'High-score leads',
    next: 'On the next high-score lead', tab: 'ai', runMatch: [] },
  { key: 'pause-hours', name: 'Business Hours Guardrail', type: 'Scheduling', icon: 'clock', ic: 'kg-teal',
    desc: 'Queues replies received outside business hours and sends them when the next open window starts.',
    trigger: 'Reply generated outside business hours', action: 'Queue until business hours', applies: 'All outgoing AI replies',
    next: 'On the next outside-hours reply', tab: 'general', runMatch: [] },
  { key: 'behavioral', name: 'Engagement Signal Tracking', type: 'Tracking', icon: 'activity', ic: 'kg-red',
    desc: 'Marks leads Engaged when they reply and stops further follow-up sequences automatically.',
    trigger: 'Lead replies to any email', action: 'Write engagement signal, stop sequences', applies: 'All active leads',
    next: 'On the next lead reply', tab: 'ai', runMatch: [] },
];

function autoRuleByKey(k) { return AUTO_RULES.find(function(r) { return r.key === k; }); }
function autoTogglesKey() { return 'flw_autos_' + (window.__userSub || 'anon'); }
function autoPrepauseKey() { return 'flw_autos_prepause_' + (window.__userSub || 'anon'); }

function autoCanEdit() {
  return !window.__myRole || window.__myRole === 'admin' || window.__myRole === 'owner';
}

/* rule status: needs-setup beats on/off (SMS without provisioning cannot run) */
function autoRuleStatus(rule) {
  if (rule.setupCheck) {
    var cfg = window._autoLastCfg;
    if (!cfg || !cfg.channels || !cfg.channels.sms) return 'setup';
  }
  return _autoOn[rule.key] ? 'live' : 'paused';
}

function autoStatusPill(st) {
  var m = { live: ['Live', 'ar-live'], paused: ['Paused', 'ar-paused'], setup: ['Needs setup', 'ar-setup'] }[st];
  return '<span class="ar-pill ' + m[1] + '"><span class="ar-dot"></span>' + m[0] + '</span>';
}

function autoEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function autoFmtWhen(ts) {
  if (!ts) return null;
  var d = new Date(ts);
  if (isNaN(d)) return null;
  var now = new Date();
  var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today, ' + time;
  var yd = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yd.toDateString()) return 'Yesterday, ' + time;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
}

/* last run derived from CRM touch data already loaded at boot */
function autoRuleLastRun(rule) {
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var best = 0;
  if (rule.runMatch.length) {
    contacts.forEach(function(c) {
      if (!c.lastTouchAt || !c.lastTouch) return;
      var t = String(c.lastTouch).toUpperCase();
      if (rule.runMatch.some(function(m) { return t.indexOf(m) !== -1; })) {
        var ts = new Date(c.lastTouchAt).getTime();
        if (ts > best) best = ts;
      }
    });
  }
  if (best) return autoFmtWhen(best);
  return autoRuleStatus(rule) === 'live' ? 'No runs recorded yet' : 'Not active';
}

function autoCadenceLabel(rule) {
  var cfg = window._autoLastCfg;
  if (!rule.cadence) return null;
  var fc = cfg && cfg.followupCadence;
  var arr = fc && fc[rule.cadence];
  return (Array.isArray(arr) && arr.length) ? 'Days ' + arr.join(', ') : 'Not configured';
}

// ── rules list ────────────────────────────────────────────────────────────────

function autoRulesFilterChange() { renderAutoRules(); }
window.autoRulesFilterChange = autoRulesFilterChange;

function renderAutoRules() {
  var host = document.getElementById('auto-rules-list');
  if (!host) return;
  var q = ((document.getElementById('auto-rule-search') || {}).value || '').toLowerCase();
  var fs = (document.getElementById('auto-rule-fstatus') || {}).value || 'all';
  var ft = (document.getElementById('auto-rule-ftype') || {}).value || 'all';
  var locked = !autoCanEdit();

  var rows = AUTO_RULES.filter(function(r) {
    var st = autoRuleStatus(r);
    if (fs !== 'all' && st !== fs) return false;
    if (ft !== 'all' && r.type !== ft) return false;
    if (q && (r.name + ' ' + r.desc + ' ' + r.type).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  if (!rows.length) {
    host.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><i data-lucide="search-x"></i>' +
      '<div class="empty-state-title">No rules match the filters</div>' +
      '<div class="empty-state-sub"><span class="sec-link" onclick="autoRulesClear()">Clear filters</span></div></div>';
  } else {
    host.innerHTML = rows.map(function(r) {
      var st = autoRuleStatus(r);
      var on = _autoOn[r.key];
      var cad = autoCadenceLabel(r);
      var meta = '<strong>Last run:</strong> ' + autoEsc(autoRuleLastRun(r));
      if (st !== 'setup') {
        meta += '<span><strong>' + (cad ? 'Cadence:' : 'Next:') + '</strong> ' + autoEsc(cad || r.next) + '</span>';
      }
      var threshold = '';
      if (r.key === 'escalation') {
        var cfg = window._autoLastCfg;
        var th = (cfg && cfg.ai && cfg.ai.escalationThreshold != null) ? cfg.ai.escalationThreshold : 60;
        meta += '<span><strong>Rule:</strong> Score at or above ' + th + '/100</span>';
      }
      var note = '';
      if (st === 'setup') {
        note = '<div class="auto-provision-note" style="margin-top:8px;"><i data-lucide="info" style="width:12px;height:12px;flex-shrink:0;"></i>' +
          'Messaging is not provisioned for this account. Contact Flowaify to enable SMS follow-ups.</div>';
      }
      return '<div class="auto-rule' + (_autoSelRule === r.key ? ' sel' : '') + '" onclick="autoSelectRule(\'' + r.key + '\')" role="button" tabindex="0" aria-label="' + autoEsc(r.name) + '">' +
        '<div class="auto-ctrl-icon-wrap ' + r.ic + '"><i data-lucide="' + r.icon + '"></i></div>' +
        '<div class="auto-rule-body">' +
          '<div class="auto-rule-top"><span class="auto-rule-name">' + r.name + '</span>' + autoStatusPill(st) + '</div>' +
          '<div class="auto-rule-desc">' + r.desc + '</div>' +
          '<div class="auto-rule-meta">' + meta + '</div>' + note +
        '</div>' +
        '<div class="auto-rule-side">' +
          '<div class="toggle' + (on ? ' on' : '') + (locked || st === 'setup' ? ' locked' : '') + '" id="tog-' + r.key + '" ' +
            'onclick="event.stopPropagation();autoToggleRule(\'' + r.key + '\')" role="switch" aria-checked="' + !!on + '" aria-label="Toggle ' + autoEsc(r.name) + '"></div>' +
          '<button class="auto-rule-kebab" onclick="event.stopPropagation();autoRuleMenu(event,\'' + r.key + '\')" aria-label="Rule actions">⋮</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function autoRulesClear() {
  var s = document.getElementById('auto-rule-search'); if (s) s.value = '';
  ['auto-rule-fstatus', 'auto-rule-ftype'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = 'all';
  });
  renderAutoRules();
}
window.autoRulesClear = autoRulesClear;

// ── rule menu ─────────────────────────────────────────────────────────────────

function autoRuleMenu(e, key) {
  var menu = document.getElementById('auto-rule-menu');
  var r = autoRuleByKey(key);
  if (!menu || !r) return;
  var st = autoRuleStatus(r);
  var items = [
    '<div class="card-ctx-item" onclick="autoSelectRule(\'' + key + '\')"><i data-lucide="eye"></i>View details</div>',
    '<div class="card-ctx-item" onclick="autoRunsFilter(\'' + key + '\')"><i data-lucide="list"></i>View runs</div>',
    '<div class="card-ctx-item" onclick="autoEditRule(\'' + key + '\')"><i data-lucide="settings-2"></i>Rule settings</div>',
  ];
  if (st !== 'setup' && autoCanEdit()) {
    items.push('<div class="card-ctx-item' + (_autoOn[key] ? ' ctx-danger' : '') + '" onclick="autoToggleRule(\'' + key + '\')">' +
      '<i data-lucide="' + (_autoOn[key] ? 'pause' : 'play') + '"></i>' + (_autoOn[key] ? 'Pause rule' : 'Enable rule') + '</div>');
  }
  menu.innerHTML = items.join('');
  var rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - items.length * 34 - 16) + 'px';
  menu.style.left = Math.max(8, rect.right - 180) + 'px';
  menu.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.autoRuleMenu = autoRuleMenu;

document.addEventListener('click', function() {
  var m = document.getElementById('auto-rule-menu');
  if (m) m.classList.remove('open');
});

function autoEditRule(key) {
  var r = autoRuleByKey(key);
  if (!r) return;
  if (typeof showPage === 'function') showPage('settings');
  if (typeof settingsTab === 'function') setTimeout(function() { settingsTab(r.tab); }, 80);
}
window.autoEditRule = autoEditRule;

// ── toggling with safety confirms ─────────────────────────────────────────────

var AUTO_CFG_MAP = {
  'sms':         function(on) { return { followupCadence: { sms:   on ? autoSmsCadence()   : null } }; },
  'email':       function(on) { return { followupCadence: { email: on ? autoEmailCadence() : null } }; },
  'autoreply':   function(on) { return { ai: { requireApproval: !on } }; }, // inverted on purpose
  'escalation':  function(on) { return { ai: { escalation: on } }; },
  'pause-hours': function(on) { return { ai: { pauseOutsideHours: on } }; },
  'behavioral':  function(on) { return { behavioralSignal: on }; },
};

function autoEmailCadence() {
  var fc = window._autoLastCfg && window._autoLastCfg.followupCadence;
  return (fc && Array.isArray(fc.email) && fc.email.length) ? fc.email : [3, 7];
}
function autoSmsCadence() {
  var fc = window._autoLastCfg && window._autoLastCfg.followupCadence;
  return (fc && Array.isArray(fc.sms) && fc.sms.length) ? fc.sms : [0, 5, 7];
}

function autoSaveLocalState() {
  try { localStorage.setItem(autoTogglesKey(), JSON.stringify(_autoOn)); } catch (e) {}
}

function autoLogActivity(text) {
  if (window.twFetch) { try { twFetch('POST', '/team/activity', { text: text }); } catch (e) {} }
}

function autoRerender() {
  renderAutoRules();
  updateAutoActiveCount();
  renderAutoHealth();
  renderAutoRuleDetail();
}

function autoApplyToggle(key, on, label) {
  _autoOn[key] = on;
  autoSaveLocalState();
  autoRerender();
  if (AUTO_CFG_MAP[key] && window.pushSettings) {
    pushSettings(AUTO_CFG_MAP[key](on), 'auto-save-status');
  }
  if (typeof showToast === 'function') showToast((on ? 'Enabled: ' : 'Paused: ') + label);
  autoLogActivity((on ? 'enabled' : 'paused') + ' the “' + label + '” automation rule');
}

function autoToggleRule(key) {
  var r = autoRuleByKey(key);
  if (!r) return;
  if (!autoCanEdit()) {
    if (typeof showToast === 'function') showToast('Only admins can change automations.');
    return;
  }
  if (autoRuleStatus(r) === 'setup') {
    if (typeof showToast === 'function') showToast('This rule needs setup first — messaging is not provisioned for this account.');
    return;
  }
  var turningOff = !!_autoOn[key];
  if (turningOff && typeof window.invConfirm === 'function') {
    invConfirm('Pause "' + r.name + '"?',
      'Pausing stops this rule from acting on live leads until it is enabled again. Historical records are not affected.',
      'Pause rule', true,
      function() { autoApplyToggle(key, false, r.name); });
  } else {
    autoApplyToggle(key, !turningOff, r.name);
  }
}
window.autoToggleRule = autoToggleRule;

/* kept for compatibility with any older callers */
function toggleAuto(el, name) { autoToggleRule(name); }
window.toggleAuto = toggleAuto;

function autoMasterApply(pause) {
  if (pause) {
    try { localStorage.setItem(autoPrepauseKey(), JSON.stringify({ toggles: JSON.parse(JSON.stringify(_autoOn)), emailCadence: autoEmailCadence(), smsCadence: autoSmsCadence() })); } catch (e) {}
    Object.keys(_autoOn).forEach(function(k) { _autoOn[k] = false; });
    autoSaveLocalState();
    autoRerender();
    if (window.pushSettings) {
      pushSettings({
        followupCadence: { sms: null, email: null },
        ai: { requireApproval: true, escalation: false, pauseOutsideHours: false },
        behavioralSignal: false,
      }, 'auto-save-status');
    }
    if (typeof showToast === 'function') showToast('All automation rules paused.');
    autoLogActivity('paused all automation rules');
  } else {
    var snap = null;
    try { snap = JSON.parse(localStorage.getItem(autoPrepauseKey()) || 'null'); } catch (e) {}
    var t = (snap && snap.toggles) || { autoreply: true, email: true, sms: true };
    Object.keys(_autoOn).forEach(function(k) { _autoOn[k] = !!t[k]; });
    autoSaveLocalState();
    autoRerender();
    if (window.pushSettings) {
      pushSettings({
        followupCadence: {
          sms: _autoOn.sms ? ((snap && snap.smsCadence) || [0, 5, 7]) : null,
          email: _autoOn.email ? ((snap && snap.emailCadence) || [3, 7]) : null,
        },
        ai: { requireApproval: !_autoOn.autoreply, escalation: !!_autoOn.escalation, pauseOutsideHours: !!_autoOn['pause-hours'] },
        behavioralSignal: !!_autoOn.behavioral,
      }, 'auto-save-status');
    }
    if (typeof showToast === 'function') showToast('Automation rules resumed.');
    autoLogActivity('resumed automation rules');
  }
}

function autoMasterToggle() {
  if (!autoCanEdit()) {
    if (typeof showToast === 'function') showToast('Only admins can change automations.');
    return;
  }
  var anyOn = Object.keys(_autoOn).some(function(k) { return _autoOn[k]; });
  if (anyOn && typeof window.invConfirm === 'function') {
    invConfirm('Pause all automation rules?',
      'All outgoing automation activity — replies, follow-ups, and escalations — stops until rules are resumed. Historical records are not affected.',
      'Pause all', true,
      function() { autoMasterApply(true); });
  } else {
    autoMasterApply(anyOn);
  }
}
window.autoMasterToggle = autoMasterToggle;

// ── boot state + KV truth ─────────────────────────────────────────────────────

function restoreAutoToggles() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(autoTogglesKey()) || 'null'); } catch (e) {}
  if (saved && typeof saved === 'object') {
    Object.keys(_autoOn).forEach(function(k) { if (k in saved) _autoOn[k] = !!saved[k]; });
  }
  updateAutoActiveCount();
}
window.restoreAutoToggles = restoreAutoToggles;

/* KV config is the authoritative source — mirrors AUTO_CFG_MAP inversions */
function applyAutoTogglesToUI(cfg) {
  if (!cfg) return;
  window._autoLastCfg = cfg;
  var fc = cfg.followupCadence || {};
  _autoOn.email = Array.isArray(fc.email) && fc.email.length > 0;
  _autoOn.sms = Array.isArray(fc.sms) && fc.sms.length > 0;
  _autoOn.autoreply = !(cfg.ai && cfg.ai.requireApproval);
  _autoOn.escalation = !!(cfg.ai && cfg.ai.escalation);
  _autoOn['pause-hours'] = !!(cfg.ai && cfg.ai.pauseOutsideHours);
  _autoOn.behavioral = !!cfg.behavioralSignal;
  autoSaveLocalState();
  autoRerender();
}
window.applyAutoTogglesToUI = applyAutoTogglesToUI;

// ── status strip + health ─────────────────────────────────────────────────────

function updateAutoActiveCount() {
  var live = 0, paused = 0, setup = 0;
  AUTO_RULES.forEach(function(r) {
    var st = autoRuleStatus(r);
    if (st === 'live') live++; else if (st === 'setup') setup++; else paused++;
  });
  function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  set('as-active', live);
  set('as-paused', paused);
  set('as-setup', setup);
  set('as-last', _autoLastFeedTs ? (typeof relTime === 'function' ? relTime(_autoLastFeedTs) : 'Just now') : '—');
  var sub = document.getElementById('as-last-sub');
  if (sub) sub.textContent = _autoLastFeedTs ? 'Automation check complete' : 'Awaiting first check';
  var dot = document.getElementById('auto-live-dot');
  if (dot) dot.classList.toggle('active', live > 0);
  var master = document.getElementById('auto-master-btn');
  if (master) master.textContent = (live > 0 || AUTO_RULES.some(function(r) { return _autoOn[r.key]; })) ? 'Pause all' : 'Resume all';
}
window.updateAutoActiveCount = updateAutoActiveCount;

function renderAutoHealth() {
  var host = document.getElementById('auto-health');
  if (!host) return;
  var live = 0, setup = 0;
  AUTO_RULES.forEach(function(r) {
    var st = autoRuleStatus(r);
    if (st === 'live') live++; else if (st === 'setup') setup++;
  });
  var rows = [];
  if (live > 0) rows.push('<div class="ah-row ah-ok"><span class="ah-dot"></span><span><strong>' + live + ' core rule' + (live === 1 ? '' : 's') + '</strong> responding normally</span></div>');
  else rows.push('<div class="ah-row ah-mut"><span class="ah-dot"></span><span>All rules are currently paused</span></div>');
  if (setup > 0) rows.push('<div class="ah-row ah-warn"><span class="ah-dot"></span><span><strong>' + setup + ' rule' + (setup === 1 ? '' : 's') + '</strong> need' + (setup === 1 ? 's' : '') + ' setup</span></div>');
  rows.push('<div class="ah-row ah-ok"><span class="ah-dot"></span><span>No failed runs detected</span></div>');
  rows.push('<div class="ah-row ah-mut"><span class="ah-dot"></span><span>Last system check: <strong>' +
    (_autoLastFeedTs ? (typeof relTime === 'function' ? relTime(_autoLastFeedTs) : 'just now') : 'pending') + '</strong></span></div>');
  host.innerHTML = rows.join('');
}

// ── rule details panel ────────────────────────────────────────────────────────

function autoSelectRule(key) {
  _autoSelRule = (_autoSelRule === key) ? key : key;
  renderAutoRules();
  renderAutoRuleDetail();
}
window.autoSelectRule = autoSelectRule;

function renderAutoRuleDetail() {
  var host = document.getElementById('auto-rule-detail');
  if (!host) return;
  var r = _autoSelRule ? autoRuleByKey(_autoSelRule) : null;
  if (!r) {
    host.innerHTML = '<div class="empty-state" style="padding:26px 14px;">' +
      '<i data-lucide="mouse-pointer-click"></i>' +
      '<div class="empty-state-title" style="font-size:12.5px;">Select a rule</div>' +
      '<div class="empty-state-sub">View configuration, recent runs, and the recommended next action.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var st = autoRuleStatus(r);
  var cad = autoCadenceLabel(r);
  var canEdit = autoCanEdit();

  var details = [
    ['Trigger', r.trigger],
    ['Action', r.action],
    ['Applies to', r.applies],
    cad ? ['Cadence', cad] : null,
    ['Last run', autoRuleLastRun(r)],
    st === 'live' ? ['Next run', r.next] : null,
    ['Mode', st === 'live' ? 'Automatic' : st === 'setup' ? 'Blocked — setup required' : 'Paused'],
  ].filter(Boolean).map(function(row) {
    return '<div class="ard-krow"><span>' + row[0] + '</span><span>' + autoEsc(row[1]) + '</span></div>';
  }).join('');

  var nextAction, buttons = [];
  function btn(label, fn, primary) {
    return '<button class="btn-mini ' + (primary ? 'btn-mini-primary' : 'btn-mini-ghost') + '" onclick="' + fn + '">' + label + '</button>';
  }
  if (st === 'setup') {
    nextAction = 'Configure messaging before enabling this rule.';
    buttons.push(btn('Contact Flowaify', "window.location.href='mailto:contact@flowaify.app?subject=Enable%20SMS%20messaging'", true));
    buttons.push(btn('View runs', "autoRunsFilter('" + r.key + "')"));
  } else if (st === 'paused') {
    nextAction = 'Review rule settings before enabling.';
    if (canEdit) buttons.push(btn('Enable rule', "autoToggleRule('" + r.key + "')", true));
    buttons.push(btn('Edit rule', "autoEditRule('" + r.key + "')"));
    buttons.push(btn('View runs', "autoRunsFilter('" + r.key + "')"));
  } else {
    nextAction = 'Review behavior in the rule settings, or inspect its recent runs.';
    buttons.push(btn('Edit rule', "autoEditRule('" + r.key + "')", true));
    buttons.push(btn('View runs', "autoRunsFilter('" + r.key + "')"));
    if (canEdit) buttons.push(btn('Pause rule', "autoToggleRule('" + r.key + "')"));
  }

  host.innerHTML =
    '<div style="display:flex;align-items:center;gap:9px;padding-top:2px;">' +
      '<div class="auto-ctrl-icon-wrap ' + r.ic + '" style="width:28px;height:28px;border-radius:7px;"><i data-lucide="' + r.icon + '" style="width:13px;height:13px;"></i></div>' +
      '<div style="min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text);">' + r.name + '</div></div>' +
      '<span style="margin-left:auto;">' + autoStatusPill(st) + '</span>' +
    '</div>' +
    '<div class="auto-rule-desc" style="margin-top:8px;">' + r.desc + '</div>' +
    '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:6px;">' + details + '</div>' +
    '<div class="ard-next"><strong>Recommended next action:</strong> ' + nextAction + '</div>' +
    '<div class="ard-actions">' + buttons.join('') + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── recent runs feed ──────────────────────────────────────────────────────────

function autoRunsFilter(key) {
  _autoRunFilter = key;
  var chip = document.getElementById('auto-runs-chip');
  if (chip) {
    var r = autoRuleByKey(key);
    chip.style.display = '';
    chip.innerHTML = autoEsc(r ? r.name : 'Filtered') + ' <i data-lucide="x" style="width:10px;height:10px;"></i>';
  }
  if (window.__crmData) renderAutoActivity(window.__crmData.contacts || []);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.autoRunsFilter = autoRunsFilter;

function autoRunsClearFilter() {
  _autoRunFilter = null;
  var chip = document.getElementById('auto-runs-chip');
  if (chip) chip.style.display = 'none';
  if (window.__crmData) renderAutoActivity(window.__crmData.contacts || []);
}
window.autoRunsClearFilter = autoRunsClearFilter;

/* which rule an event belongs to (by touch type / state) */
function autoRunRule(contact) {
  var t = String(contact.lastTouch || '').toUpperCase();
  if (t.indexOf('SMS') !== -1) return 'sms';
  if (t.indexOf('FOLLOWUP') !== -1 || t.indexOf('EMAIL') !== -1) return 'email';
  if (t.indexOf('REPLY') !== -1) return 'autoreply';
  var st = String(contact.status || '').toUpperCase();
  if (st === 'ENGAGED') return 'behavioral';
  return null;
}

function renderAutoActivity(contacts) {
  var feed = document.getElementById('auto-activity');
  if (!feed) return;
  _autoLastFeedTs = Date.now();
  var syncEl = document.getElementById('auto-sync-ts');
  if (syncEl) syncEl.textContent = 'Synced just now';
  updateAutoActiveCount();
  renderAutoHealth();

  if (!contacts || contacts.length === 0) {
    feed.innerHTML = autoEmptyState();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var active = contacts.filter(function(c) {
    if (!(c.lastTouchAt || c.status || c.score != null)) return false;
    if (_autoRunFilter) return autoRunRule(c) === _autoRunFilter;
    return true;
  });
  active.sort(function(a, b) {
    var ta = a.lastTouchAt ? new Date(a.lastTouchAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    var tb = b.lastTouchAt ? new Date(b.lastTouchAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });
  var items = active.slice(0, 6);
  if (!items.length) {
    feed.innerHTML = '<div class="empty-state" style="padding:36px 20px;"><i data-lucide="list-x"></i>' +
      '<div class="empty-state-title">No runs for this rule yet</div>' +
      '<div class="empty-state-sub">Runs appear here when this rule sends, queues, or updates lead activity.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  feed.innerHTML = '<div class="auto-activity-list">' + items.map(buildAutoActivityItem).join('') + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderAutoActivity = renderAutoActivity;

function buildAutoActivityItem(contact, index) {
  var esc = window.escDash || autoEsc;
  var name = esc(contact.name || 'Unknown Lead');
  var score = contact.score != null ? contact.score : null;
  var state = String(contact.status || '').toUpperCase();
  var touchType = String(contact.lastTouch || '').toUpperCase();
  var ts = contact.lastTouchAt ? new Date(contact.lastTouchAt) : (contact.createdAt ? new Date(contact.createdAt) : null);
  var icon, label, color, ruleKey = autoRunRule(contact);

  if (state === 'ENGAGED') {
    icon = 'message-circle'; color = 'var(--green)'; label = name + ' replied — marked Engaged';
  } else if (state.indexOf('BOOK') !== -1) {
    icon = 'calendar-check'; color = 'var(--green)'; label = 'Booking recorded — ' + name;
  } else if (touchType.indexOf('SMS') !== -1) {
    icon = 'message-square'; color = 'var(--blue)'; label = 'SMS follow-up sent to ' + name;
  } else if (touchType.indexOf('FOLLOWUP') !== -1 || touchType.indexOf('EMAIL') !== -1) {
    icon = 'mail'; color = 'var(--blue)'; label = 'Follow-up sent to ' + name;
  } else if (touchType.indexOf('REPLY') !== -1) {
    icon = 'sparkles'; color = 'var(--purple)'; label = 'Instant reply sent to ' + name;
  } else if (state === 'HOT' && score != null) {
    icon = 'flame'; color = 'var(--red)'; label = 'Lead scored ' + score + '/100 — ' + name;
  } else if (state === 'WARM' && score != null) {
    icon = 'thermometer'; color = 'var(--amber)'; label = 'Lead scored ' + score + '/100 — ' + name;
  } else if (state === 'COLD' && score != null) {
    icon = 'snowflake'; color = 'var(--blue-soft)'; label = 'Lead scored ' + score + '/100 — ' + name;
  } else if (state === 'DEAD') {
    icon = 'x-circle'; color = 'var(--text-m)'; label = name + ' — sequence exhausted';
  } else {
    icon = 'user-check'; color = 'var(--text-m)'; label = 'Lead received — ' + name;
  }
  var rule = ruleKey ? autoRuleByKey(ruleKey) : null;
  var timeStr = (ts && !isNaN(ts.getTime()) && typeof relTime === 'function') ? relTime(ts.getTime()) : '';
  return '<div class="auto-activity-item" style="--i:' + index + '">' +
    '<div class="auto-activity-icon" style="color:' + color + '"><i data-lucide="' + icon + '"></i></div>' +
    '<div class="auto-activity-body">' +
      '<div class="auto-activity-label">' + label + '</div>' +
      '<div class="auto-activity-ts">' + timeStr + (rule ? ' <span class="auto-run-rule">· ' + rule.name + '</span>' : '') + '</div>' +
    '</div></div>';
}

function autoEmptyState() {
  var anyOn = AUTO_RULES.some(function(r) { return autoRuleStatus(r) === 'live'; });
  if (anyOn) {
    return '<div class="empty-state" style="padding:36px 20px;">' +
      '<div class="auto-standby-icon"><i data-lucide="activity"></i></div>' +
      '<div class="empty-state-title">No automation runs yet</div>' +
      '<div class="empty-state-sub">Runs appear here when rules send, queue, skip, or update lead activity.</div></div>';
  }
  return '<div class="empty-state" style="padding:36px 20px;">' +
    '<i data-lucide="pause-circle"></i>' +
    '<div class="empty-state-title">All automation rules paused</div>' +
    '<div class="empty-state-sub">Resume a rule above to start processing leads.</div></div>';
}

// ── page init ─────────────────────────────────────────────────────────────────

async function automationsInit() {
  autoRerender();

  stFetch('GET', '/settings').then(function(r) {
    if (r.status === 200 && r.data && r.data.config) applyAutoTogglesToUI(r.data.config);
  }).catch(function() {});

  if (window.__crmData && window.__crmData.contacts) {
    renderAutoActivity(window.__crmData.contacts);
  } else {
    var waitAttempts = 0;
    var waitForData = setInterval(function() {
      waitAttempts++;
      if (window.__crmData) {
        clearInterval(waitForData);
        renderAutoActivity(window.__crmData.contacts || []);
        renderAutoRules(); // last-run values depend on CRM data
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
window.automationsInit = automationsInit;

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM RULES (Phase A) — builder, list integration, test-now, run log merge.
// Rules live in Worker KV (rules:{CLIENTID}); everything starts in Test mode.
// ══════════════════════════════════════════════════════════════════════════════

var _customRules = [];
var _ruleRuns = [];
var _ruleFlow = null;
var _ruleFlowDraft = null;

var RULE_TRIGGER_META = {
  new_lead: { label: 'New lead created', sentence: 'a new lead arrives' },
  score:    { label: 'Score threshold',  sentence: 'a lead scores {n}+' },
  stale:    { label: 'Stale lead',       sentence: 'a lead has no touch for {n} days' },
};

function ruleSentence(r) {
  var t = RULE_TRIGGER_META[r.trigger.type] || RULE_TRIGGER_META.new_lead;
  var when = t.sentence.replace('{n}', r.trigger.threshold || r.trigger.days || '');
  var conds = (r.conditions || []).map(function(c) {
    if (c.field === 'score') return 'score ' + (c.op === 'gte' ? '≥ ' : '≤ ') + c.value;
    return c.field + ' ' + (c.op === 'is' ? 'is ' : 'contains ') + '“' + c.value + '”';
  });
  var acts = (r.actions || []).map(function(a) {
    if (a.type === 'email') return a.ai && a.ai.enabled ? 'send a Flowy-drafted email' : 'send an email';
    if (a.type === 'status') return 'set status to ' + a.value;
    return 'notify the team';
  });
  return 'When ' + when + (conds.length ? ' and ' + conds.join(' and ') : '') + ', ' +
    (acts.join(', then ') || 'do nothing') + '.';
}

function rulePill(mode) {
  var m = { test: ['Test', 'ar-test'], live: ['Live', 'ar-live'], paused: ['Paused', 'ar-paused'] }[mode] || ['Test', 'ar-test'];
  return '<span class="ar-pill ' + m[1] + '"><span class="ar-dot"></span>' + m[0] + '</span>';
}

async function rulesRefresh() {
  var r = await stFetch('GET', '/rules/list');
  if (r.status === 200 && r.data && r.data.rules) { _customRules = r.data.rules; renderAutoRules(); }
  var rr = await stFetch('GET', '/rules/runs');
  if (rr.status === 200 && rr.data && rr.data.runs) {
    _ruleRuns = rr.data.runs;
    if (window.__crmData) renderAutoActivity(window.__crmData.contacts || []);
  }
}

/* custom rules render beneath the system rules */
function renderCustomRules() {
  if (!_customRules.length) return '';
  var q = ((document.getElementById('auto-rule-search') || {}).value || '').toLowerCase();
  var fs = (document.getElementById('auto-rule-fstatus') || {}).value || 'all';
  var rows = _customRules.filter(function(r) {
    if (fs === 'live' && r.mode !== 'live') return false;
    if (fs === 'paused' && r.mode !== 'paused') return false;
    if (fs === 'setup') return false;
    if (q && (r.name + ' ' + ruleSentence(r)).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  if (!rows.length) return '';
  return '<div class="auto-rules-divider">Custom rules</div>' + rows.map(function(r) {
    var stats = r.stats || {};
    var meta = '<strong>Tested:</strong> ' + (stats.tested || 0) + ' match' + ((stats.tested || 0) === 1 ? '' : 'es');
    if (stats.lastRunAt) meta += '<span><strong>Last run:</strong> ' + autoEsc(autoFmtWhen(stats.lastRunAt) || '—') + '</span>';
    meta += '<span><strong>Cap:</strong> ' + ((r.guards || {}).dailyCap || 25) + '/day</span>';
    return '<div class="auto-rule' + (_autoSelRule === 'rule:' + r.id ? ' sel' : '') + '" onclick="autoSelectRule(\'rule:' + r.id + '\')" role="button" tabindex="0">' +
      '<div class="auto-ctrl-icon-wrap kg-blue"><i data-lucide="git-branch"></i></div>' +
      '<div class="auto-rule-body">' +
        '<div class="auto-rule-top"><span class="auto-rule-name">' + autoEsc(r.name) + '</span>' + rulePill(r.mode) + '</div>' +
        '<div class="auto-rule-desc">' + autoEsc(ruleSentence(r)) + '</div>' +
        '<div class="auto-rule-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="auto-rule-side">' +
        '<button class="auto-rule-kebab" onclick="event.stopPropagation();customRuleMenu(event,\'' + r.id + '\')" aria-label="Rule actions">⋮</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function customRuleById(id) { return _customRules.find(function(r) { return r.id === id; }); }

function customRuleMenu(e, id) {
  var menu = document.getElementById('auto-rule-menu');
  var r = customRuleById(id);
  if (!menu || !r) return;
  var admin = autoCanEdit();
  var items = ['<div class="card-ctx-item" onclick="autoSelectRule(\'rule:' + id + '\')"><i data-lucide="eye"></i>View details</div>'];
  if (admin) {
    items.push('<div class="card-ctx-item" onclick="ruleTestNow(\'' + id + '\')"><i data-lucide="flask-conical"></i>Run test now</div>');
    items.push('<div class="card-ctx-item" onclick="ruleBuilderOpen(\'' + id + '\')"><i data-lucide="pencil"></i>Edit rule</div>');
    if (r.mode !== 'paused') items.push('<div class="card-ctx-item" onclick="ruleSetMode(\'' + id + '\',\'paused\')"><i data-lucide="pause"></i>Pause rule</div>');
    else items.push('<div class="card-ctx-item" onclick="ruleSetMode(\'' + id + '\',\'test\')"><i data-lucide="flask-conical"></i>Set to Test</div>');
    items.push('<div class="card-ctx-item ctx-danger" onclick="ruleDelete(\'' + id + '\')"><i data-lucide="trash-2"></i>Delete rule</div>');
  }
  menu.innerHTML = items.join('');
  var rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - items.length * 34 - 16) + 'px';
  menu.style.left = Math.max(8, rect.right - 180) + 'px';
  menu.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.customRuleMenu = customRuleMenu;

/* detail panel branch for custom rules */
function renderCustomRuleDetail(id) {
  var host = document.getElementById('auto-rule-detail');
  var r = customRuleById(id);
  if (!host || !r) return;
  var admin = autoCanEdit();
  var stats = r.stats || {};
  var details = [
    ['Trigger', (RULE_TRIGGER_META[r.trigger.type] || {}).label + (r.trigger.threshold ? ' (' + r.trigger.threshold + '+)' : '') + (r.trigger.days ? ' (' + r.trigger.days + ' days)' : '')],
    (r.conditions || []).length ? ['Conditions', r.conditions.length + ' filter' + (r.conditions.length === 1 ? '' : 's')] : null,
    ['Actions', (r.actions || []).map(function(a) { return a.type === 'email' ? 'Email' : a.type === 'status' ? 'Status → ' + a.value : 'Notify'; }).join(' · ')],
    ['Guards', 'Once per lead · ' + ((r.guards || {}).dailyCap || 25) + '/day'],
    ['Mode', r.mode === 'test' ? 'Test — logs matches, never sends' : r.mode === 'live' ? 'Live' : 'Paused'],
    ['Test matches', String(stats.tested || 0)],
    stats.lastRunAt ? ['Last run', autoFmtWhen(stats.lastRunAt) || '—'] : null,
    ['Created by', autoEsc(r.createdByName || '—')],
  ].filter(Boolean).map(function(row) {
    return '<div class="ard-krow"><span>' + row[0] + '</span><span>' + row[1] + '</span></div>';
  }).join('');

  var next, btns = [];
  function btn(label, fn, primary) {
    return '<button class="btn-mini ' + (primary ? 'btn-mini-primary' : 'btn-mini-ghost') + '" onclick="' + fn + '">' + label + '</button>';
  }
  if (r.mode === 'test') {
    next = 'Run a test to see exactly which leads this rule would act on. Live execution arrives with the engine update.';
    if (admin) btns.push(btn('Run test now', "ruleTestNow('" + r.id + "')", true));
    if (admin) btns.push(btn('Edit rule', "ruleBuilderOpen('" + r.id + "')"));
  } else if (r.mode === 'paused') {
    next = 'This rule is paused and will not run. Set it back to Test to keep validating it.';
    if (admin) btns.push(btn('Set to Test', "ruleSetMode('" + r.id + "','test')", true));
    if (admin) btns.push(btn('Edit rule', "ruleBuilderOpen('" + r.id + "')"));
  } else {
    next = 'This rule is live and executes on the engine schedule.';
    if (admin) btns.push(btn('Run test now', "ruleTestNow('" + r.id + "')", true));
    if (admin) btns.push(btn('Pause rule', "ruleSetMode('" + r.id + "','paused')"));
  }
  if (admin) btns.push(btn('Delete', "ruleDelete('" + r.id + "')"));

  host.innerHTML =
    '<div style="display:flex;align-items:center;gap:9px;padding-top:2px;">' +
      '<div class="auto-ctrl-icon-wrap kg-blue" style="width:28px;height:28px;border-radius:7px;"><i data-lucide="git-branch" style="width:13px;height:13px;"></i></div>' +
      '<div style="min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--text);">' + autoEsc(r.name) + '</div></div>' +
      '<span style="margin-left:auto;">' + rulePill(r.mode) + '</span>' +
    '</div>' +
    '<div class="auto-rule-desc" style="margin-top:8px;">' + autoEsc(ruleSentence(r)) + '</div>' +
    '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:6px;">' + details + '</div>' +
    '<div class="ard-next"><strong>Recommended next action:</strong> ' + next + '</div>' +
    '<div class="ard-actions">' + btns.join('') + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── actions ──

async function ruleSetMode(id, mode) {
  var r = await stFetch('POST', '/rules/mode', { id: id, mode: mode });
  if (r.status === 200 && r.data.rules) {
    _customRules = r.data.rules;
    renderAutoRules(); renderAutoRuleDetail();
    if (typeof showToast === 'function') showToast(mode === 'paused' ? 'Rule paused.' : 'Rule set to Test mode.');
  } else if (typeof showToast === 'function') showToast('Could not update the rule.');
}
window.ruleSetMode = ruleSetMode;

function ruleDelete(id) {
  var r = customRuleById(id);
  if (!r) return;
  var doIt = async function() {
    var res = await stFetch('DELETE', '/rules/' + id);
    if (res.status === 200) {
      _customRules = res.data.rules || [];
      if (_autoSelRule === 'rule:' + id) _autoSelRule = null;
      renderAutoRules(); renderAutoRuleDetail();
      if (typeof showToast === 'function') showToast('Rule deleted.');
    } else if (typeof showToast === 'function') showToast('Could not delete.');
  };
  if (typeof window.invConfirm === 'function') {
    invConfirm('Delete "' + r.name + '"?', 'The rule and its configuration are removed permanently. Run history is kept.', 'Delete rule', true, doIt);
  } else doIt();
}
window.ruleDelete = ruleDelete;

async function ruleTestNow(id) {
  var r = customRuleById(id);
  if (!r) return;
  if (typeof showToast === 'function') showToast('Testing rule against live CRM data…');
  var res = await stFetch('POST', '/rules/test-now', { id: id });
  if (res.status !== 200 || !res.data) {
    if (typeof showToast === 'function') showToast((res.data && res.data.error) || 'Test failed — try again.');
    return;
  }
  if (res.data.rule) {
    var i = _customRules.findIndex(function(x) { return x.id === id; });
    if (i !== -1) _customRules[i] = res.data.rule;
  }
  rulesRefresh();
  var rows = (res.data.sample || []).map(function(c) {
    return '<div class="rlf-test-row"><span>' + autoEsc(c.name) + '</span><span>' +
      (c.score != null ? 'score ' + c.score + ' · ' : '') + autoEsc(c.source || '') + '</span></div>';
  }).join('');
  var bodyHtml = res.data.matched
    ? '<div style="font-size:12.5px;color:var(--text-s);margin-bottom:8px;">This rule would act on <strong style="color:var(--text);">' + res.data.matched + ' lead' + (res.data.matched === 1 ? '' : 's') + '</strong> right now:</div>' + rows +
      (res.data.skipped ? '<div style="font-size:11px;color:var(--text-m);margin-top:8px;">' + res.data.skipped + ' additional match' + (res.data.skipped === 1 ? '' : 'es') + ' skipped by guards.</div>' : '')
    : '<div style="font-size:12.5px;color:var(--text-s);">No leads match this rule right now. The test is logged — adjust the trigger or conditions and test again.</div>';
  bodyHtml += '<div style="font-size:11px;color:var(--text-m);margin-top:10px;">Test only — no emails were sent and no records were changed.</div>';
  if (typeof window.invModal === 'function') {
    invModal('Test results — ' + autoEsc(r.name), bodyHtml, 'Done', async function() { return true; });
  } else if (typeof showToast === 'function') {
    showToast('Matched ' + res.data.matched + ' lead(s) — see Recent Runs.');
  }
}
window.ruleTestNow = ruleTestNow;

// ── builder (stepped, draft-preserving) ──

function ruleBuilderOpen(editId) {
  if (!autoCanEdit()) { if (typeof showToast === 'function') showToast('Only admins can create rules.'); return; }
  var editing = editId ? customRuleById(editId) : null;
  if (editing) {
    _ruleFlow = JSON.parse(JSON.stringify({
      step: 1, id: editing.id, name: editing.name, trigger: editing.trigger,
      conditions: editing.conditions || [], actions: editing.actions || [],
      dailyCap: (editing.guards || {}).dailyCap || 25,
    }));
  } else if (_ruleFlowDraft) {
    _ruleFlow = _ruleFlowDraft; _ruleFlowDraft = null;
  } else {
    _ruleFlow = { step: 1, id: null, name: '', trigger: { type: 'new_lead' }, conditions: [], actions: [], dailyCap: 25 };
  }
  var t = document.getElementById('rule-flow-title');
  if (t) t.textContent = _ruleFlow.id ? 'Edit Rule' : 'New Rule';
  ruleFlowRender();
  var host = document.getElementById('rule-flow');
  if (host) host.classList.add('open');
}
window.ruleBuilderOpen = ruleBuilderOpen;

function ruleBuilderClose() {
  ruleFlowHarvest();
  if (_ruleFlow && !_ruleFlow.id) _ruleFlowDraft = _ruleFlow;
  _ruleFlow = null;
  var host = document.getElementById('rule-flow');
  if (host) host.classList.remove('open');
}
window.ruleBuilderClose = ruleBuilderClose;

function ruleFlowHarvest() {
  if (!_ruleFlow) return;
  var f = _ruleFlow;
  function v(id) { var el = document.getElementById(id); return el ? el.value : null; }
  if (v('rlf-threshold') != null) f.trigger.threshold = Math.round(+v('rlf-threshold')) || 75;
  if (v('rlf-days') != null) f.trigger.days = Math.round(+v('rlf-days')) || 5;
  // conditions
  var rows = document.querySelectorAll ? document.querySelectorAll('.rlf-cond-row') : [];
  if (rows.length || document.getElementById('rlf-conds')) {
    var conds = [];
    Array.prototype.forEach.call(rows, function(row) {
      var sel = row.querySelectorAll('select, input');
      if (sel.length >= 3 && sel[2].value !== '') conds.push({ field: sel[0].value, op: sel[1].value, value: sel[2].value });
    });
    if (document.getElementById('rlf-conds')) f.conditions = conds;
  }
  // actions
  if (document.getElementById('rlf-act-email')) {
    var actions = [];
    if ((document.getElementById('rlf-act-email') || {}).checked) {
      actions.push({ type: 'email', subject: v('rlf-em-subject') || '', body: v('rlf-em-body') || '',
        ai: { enabled: !!(document.getElementById('rlf-em-ai') || {}).checked, prompt: v('rlf-em-prompt') || '' } });
    }
    if ((document.getElementById('rlf-act-status') || {}).checked) {
      actions.push({ type: 'status', value: v('rlf-st-value') || 'HOT' });
    }
    if ((document.getElementById('rlf-act-notify') || {}).checked) {
      actions.push({ type: 'notify', channel: v('rlf-nt-channel') || 'general', message: v('rlf-nt-message') || '', task: !!(document.getElementById('rlf-nt-task') || {}).checked });
    }
    f.actions = actions;
  }
  if (v('rlf-name') != null) f.name = v('rlf-name');
  if (v('rlf-cap') != null) f.dailyCap = Math.round(+v('rlf-cap')) || 25;
}

function ruleFlowSet(k, v2) { if (_ruleFlow) { ruleFlowHarvest(); _ruleFlow[k] = v2; ruleFlowRender(); } }
window.ruleFlowSet = ruleFlowSet;

function ruleFlowTrigger(type) {
  if (!_ruleFlow) return;
  _ruleFlow.trigger = { type: type };
  if (type === 'score') _ruleFlow.trigger.threshold = 75;
  if (type === 'stale') _ruleFlow.trigger.days = 5;
  ruleFlowRender();
}
window.ruleFlowTrigger = ruleFlowTrigger;

function ruleFlowAddCond() {
  ruleFlowHarvest();
  _ruleFlow.conditions.push({ field: 'source', op: 'contains', value: '' });
  ruleFlowRender();
}
window.ruleFlowAddCond = ruleFlowAddCond;

function ruleFlowDelCond(i) {
  ruleFlowHarvest();
  _ruleFlow.conditions.splice(i, 1);
  ruleFlowRender();
}
window.ruleFlowDelCond = ruleFlowDelCond;

function ruleFlowStep(dir) {
  if (!_ruleFlow) return;
  ruleFlowHarvest();
  var next = _ruleFlow.step + dir;
  if (next === 4) {
    var hasAction = (_ruleFlow.actions || []).some(function(a) {
      return a.type !== 'email' || true;
    });
    if (!(_ruleFlow.actions || []).length) { if (typeof showToast === 'function') showToast('Enable at least one action.'); return; }
    var em = _ruleFlow.actions.find(function(a) { return a.type === 'email'; });
    if (em && !em.ai.enabled && !em.body) { if (typeof showToast === 'function') showToast('Write the email body or enable Flowy drafting.'); return; }
  }
  _ruleFlow.step = Math.max(1, Math.min(4, next));
  ruleFlowRender();
}
window.ruleFlowStep = ruleFlowStep;

function ruleFlowInsertMerge(field, targetId) {
  var el = document.getElementById(targetId);
  if (!el) return;
  el.value += '{{' + field + '}}';
  el.focus();
}
window.ruleFlowInsertMerge = ruleFlowInsertMerge;

function ruleFlowRender() {
  var host = document.getElementById('rule-flow-body');
  if (!host || !_ruleFlow) return;
  var f = _ruleFlow;
  var steps = '<div class="rf-steps">' + ['Trigger', 'Conditions', 'Actions', 'Review'].map(function(l, i) {
    var n = i + 1;
    return '<div class="rf-step' + (n === f.step ? ' cur' : n < f.step ? ' done' : '') + '"><span>' + n + '</span>' + l + '</div>';
  }).join('') + '</div>';
  var body = '';

  if (f.step === 1) {
    var cards = [
      { t: 'new_lead', icon: 'user-plus', name: 'New lead created', desc: 'Fires once for each new lead after intake.' },
      { t: 'score', icon: 'gauge', name: 'Score threshold', desc: 'Fires when a lead\'s score reaches your threshold.' },
      { t: 'stale', icon: 'hourglass', name: 'Stale lead', desc: 'Fires when a lead has had no follow-up for N days.' },
    ];
    body = '<div class="rf-cards">' + cards.map(function(c) {
      return '<div class="rf-card' + (f.trigger.type === c.t ? ' sel' : '') + '" onclick="ruleFlowTrigger(\'' + c.t + '\')" role="button" tabindex="0">' +
        '<i data-lucide="' + c.icon + '"></i><div><div class="rf-card-name">' + c.name + '</div><div class="rf-card-desc">' + c.desc + '</div></div></div>';
    }).join('') + '</div>';
    if (f.trigger.type === 'score') {
      body += '<div class="inv-dr-field" style="margin-top:12px;max-width:200px;"><label>Score threshold (1–100)</label><input id="rlf-threshold" type="number" min="1" max="100" value="' + (f.trigger.threshold || 75) + '" /></div>';
    }
    if (f.trigger.type === 'stale') {
      body += '<div class="inv-dr-field" style="margin-top:12px;max-width:200px;"><label>Days without a touch</label><input id="rlf-days" type="number" min="1" max="90" value="' + (f.trigger.days || 5) + '" /></div>';
    }
  } else if (f.step === 2) {
    body = '<div class="rf-label">Only act when… (optional)</div><div id="rlf-conds">' +
      (f.conditions || []).map(function(c, i) {
        return '<div class="rlf-cond-row">' +
          '<select><option value="source"' + (c.field === 'source' ? ' selected' : '') + '>Source</option><option value="status"' + (c.field === 'status' ? ' selected' : '') + '>Status</option><option value="score"' + (c.field === 'score' ? ' selected' : '') + '>Score</option></select>' +
          '<select><option value="contains"' + (c.op === 'contains' ? ' selected' : '') + '>contains</option><option value="is"' + (c.op === 'is' ? ' selected' : '') + '>is</option><option value="gte"' + (c.op === 'gte' ? ' selected' : '') + '>≥</option><option value="lte"' + (c.op === 'lte' ? ' selected' : '') + '>≤</option></select>' +
          '<input type="text" placeholder="Value" value="' + autoEsc(c.value) + '" />' +
          '<button class="inv-line-x" onclick="ruleFlowDelCond(' + i + ')" aria-label="Remove condition">×</button>' +
        '</div>';
      }).join('') + '</div>' +
      ((f.conditions || []).length < 3 ? '<button class="btn-mini btn-mini-ghost" onclick="ruleFlowAddCond()" style="margin-top:4px;">+ Add condition</button>' : '') +
      '<div class="rpd-note" style="margin-top:12px;">No conditions means the rule applies to every lead the trigger matches.</div>';
  } else if (f.step === 3) {
    var em = (f.actions || []).find(function(a) { return a.type === 'email'; });
    var st = (f.actions || []).find(function(a) { return a.type === 'status'; });
    var nt = (f.actions || []).find(function(a) { return a.type === 'notify'; });
    body =
      '<div class="rlf-act' + (em ? ' on' : '') + '"><label class="rlf-act-head"><input type="checkbox" id="rlf-act-email" ' + (em ? 'checked' : '') + ' onchange="ruleFlowStep(0)" />Send email from your connected Gmail</label>' +
        (em ? '<div class="rlf-act-body">' +
          '<div class="inv-dr-field"><label>Subject</label><input id="rlf-em-subject" type="text" maxlength="160" placeholder="Quick follow-up, {{firstName}}" value="' + autoEsc(em.subject || '') + '" /></div>' +
          '<div class="inv-dr-field"><label>Body</label><textarea id="rlf-em-body" maxlength="4000" placeholder="Hi {{firstName}}, …">' + autoEsc(em.body || '') + '</textarea></div>' +
          '<div class="rlf-chips">' + ['name', 'firstName', 'source', 'score'].map(function(m) {
            return '<button class="rlf-chip" onclick="ruleFlowInsertMerge(\'' + m + '\',\'rlf-em-body\')">{{' + m + '}}</button>';
          }).join('') + '</div>' +
          '<label class="rf-check"><input type="checkbox" id="rlf-em-ai" ' + (em.ai && em.ai.enabled ? 'checked' : '') + ' onchange="ruleFlowStep(0)" /><span>Let Flowy draft each email from the lead\'s data</span></label>' +
          (em.ai && em.ai.enabled ? '<div class="inv-dr-field"><label>Drafting instructions for Flowy</label><textarea id="rlf-em-prompt" maxlength="600" placeholder="Friendly, two short paragraphs, mention their inquiry source…">' + autoEsc(em.ai.prompt || '') + '</textarea></div>' : '') +
        '</div>' : '') +
      '</div>' +
      '<div class="rlf-act' + (st ? ' on' : '') + '"><label class="rlf-act-head"><input type="checkbox" id="rlf-act-status" ' + (st ? 'checked' : '') + ' onchange="ruleFlowStep(0)" />Set lead status</label>' +
        (st ? '<div class="rlf-act-body"><div class="inv-dr-field" style="max-width:200px;"><label>New status</label><select id="rlf-st-value">' +
          ['HOT', 'WARM', 'COLD', 'BOOKED'].map(function(v) { return '<option' + (st.value === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
        '</select></div></div>' : '') +
      '</div>' +
      '<div class="rlf-act' + (nt ? ' on' : '') + '"><label class="rlf-act-head"><input type="checkbox" id="rlf-act-notify" ' + (nt ? 'checked' : '') + ' onchange="ruleFlowStep(0)" />Notify the team</label>' +
        (nt ? '<div class="rlf-act-body">' +
          '<div class="inv-dr-row">' +
            '<div class="inv-dr-field"><label>Channel</label><input id="rlf-nt-channel" type="text" maxlength="40" value="' + autoEsc(nt.channel || 'general') + '" /></div>' +
            '<div class="inv-dr-field"><label>Message</label><input id="rlf-nt-message" type="text" maxlength="400" placeholder="Hot lead: {{name}} ({{score}})" value="' + autoEsc(nt.message || '') + '" /></div>' +
          '</div>' +
          '<label class="rf-check"><input type="checkbox" id="rlf-nt-task" ' + (nt.task ? 'checked' : '') + ' /><span>Also create a team task</span></label>' +
        '</div>' : '') +
      '</div>';
  } else {
    body = '<div class="rf-label">Review</div>' +
      '<div class="rlf-sentence">' + autoEsc(ruleSentence({ trigger: f.trigger, conditions: f.conditions, actions: f.actions })) + '</div>' +
      '<div class="inv-dr-field" style="margin-top:12px;"><label>Rule name</label><input id="rlf-name" type="text" maxlength="80" placeholder="e.g. Hot lead alert" value="' + autoEsc(f.name || '') + '" /></div>' +
      '<div class="inv-dr-field" style="margin-top:10px;max-width:220px;"><label>Daily action cap</label><input id="rlf-cap" type="number" min="1" max="200" value="' + (f.dailyCap || 25) + '" /></div>' +
      '<div class="ard-next" style="margin-top:12px;"><strong>Safety:</strong> the rule saves in Test mode — it logs exactly which leads it would act on, and never fires twice on the same lead. Live execution arrives with the engine update.</div>';
  }

  var foot = '<div class="rf-foot">' +
    (f.step > 1 ? '<button class="btn-mini btn-mini-ghost" onclick="ruleFlowStep(-1)">Back</button>' : '<span></span>') +
    (f.step < 4
      ? '<button class="btn-mini btn-mini-primary" onclick="ruleFlowStep(1)">Continue</button>'
      : '<button class="btn-mini btn-mini-primary" id="rlf-save" onclick="ruleFlowSave()">' + (f.id ? 'Save Changes' : 'Save Rule (Test mode)') + '</button>') +
  '</div>';

  host.innerHTML = steps + '<div class="rf-body">' + body + '</div>' + foot;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function ruleFlowSave() {
  ruleFlowHarvest();
  var f = _ruleFlow;
  if (!f) return;
  if (!(f.actions || []).length) { if (typeof showToast === 'function') showToast('Enable at least one action.'); return; }
  var btn = document.getElementById('rlf-save');
  if (btn) btn.disabled = true;
  var res = await stFetch('POST', '/rules/save', {
    id: f.id || undefined, name: f.name, trigger: f.trigger,
    conditions: f.conditions, actions: f.actions, guards: { dailyCap: f.dailyCap },
  });
  if (btn) btn.disabled = false;
  if (res.status === 200 && res.data.rules) {
    _customRules = res.data.rules;
    _ruleFlow = null; _ruleFlowDraft = null;
    var host = document.getElementById('rule-flow');
    if (host) host.classList.remove('open');
    _autoSelRule = 'rule:' + res.data.rule.id;
    renderAutoRules(); renderAutoRuleDetail();
    if (typeof showToast === 'function') showToast('Rule saved in Test mode — run a test to see what it matches.');
  } else {
    if (typeof showToast === 'function') showToast((res.data && res.data.error) || 'Could not save the rule.');
  }
}
window.ruleFlowSave = ruleFlowSave;

// ── integration hooks ──

/* extend the system-rule renderers to include custom rules */
var _renderAutoRulesSystem = renderAutoRules;
renderAutoRules = function() {
  _renderAutoRulesSystem();
  var host = document.getElementById('auto-rules-list');
  if (host) host.innerHTML += renderCustomRules();
  var createBtn = document.getElementById('auto-create-rule');
  if (createBtn) createBtn.style.display = autoCanEdit() ? '' : 'none';
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

var _renderAutoRuleDetailSystem = renderAutoRuleDetail;
renderAutoRuleDetail = function() {
  if (_autoSelRule && String(_autoSelRule).indexOf('rule:') === 0) {
    renderCustomRuleDetail(String(_autoSelRule).slice(5));
    return;
  }
  _renderAutoRuleDetailSystem();
};

/* merge rule-run log entries into the Recent Runs feed */
var _renderAutoActivityBase = renderAutoActivity;
renderAutoActivity = function(contacts) {
  _renderAutoActivityBase(contacts);
  if (!_ruleRuns.length) return;
  var feed = document.getElementById('auto-activity');
  if (!feed) return;
  var list = feed.querySelector ? feed.querySelector('.auto-activity-list') : null;
  var runItems = _ruleRuns.slice(0, 3).map(function(e, i) {
    var icon = e.result === 'would_fire' ? 'flask-conical' : e.result === 'no_matches' ? 'search-x' : 'play';
    var label = e.result === 'would_fire'
      ? 'Would fire: ' + autoEsc(e.action) + ' → ' + autoEsc(e.contactName || '')
      : e.result === 'no_matches' ? 'Test run — no matching leads' : autoEsc(e.result);
    return '<div class="auto-activity-item" style="--i:' + i + '">' +
      '<div class="auto-activity-icon" style="color:var(--blue)"><i data-lucide="' + icon + '"></i></div>' +
      '<div class="auto-activity-body">' +
        '<div class="auto-activity-label">' + label + '</div>' +
        '<div class="auto-activity-ts">' + (typeof relTime === 'function' ? relTime(e.ts) : '') +
          ' <span class="auto-run-rule">· ' + autoEsc(e.ruleName) + '</span> <span class="ar-pill ar-test" style="font-size:8.5px;padding:0.5px 6px;">Test</span></div>' +
      '</div></div>';
  }).join('');
  if (list) list.innerHTML = runItems + list.innerHTML;
  else if (runItems) feed.innerHTML = '<div class="auto-activity-list">' + runItems + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
};
window.renderAutoActivity = renderAutoActivity;

/* load rules + runs when the page opens */
var _automationsInitBase = automationsInit;
automationsInit = function() {
  var r = _automationsInitBase();
  rulesRefresh();
  return r;
};
window.automationsInit = automationsInit;
