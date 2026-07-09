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
