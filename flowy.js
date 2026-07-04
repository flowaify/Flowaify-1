/* Flowy — Copilot-style AI assistant for the Flowaify dashboard.
   Hybrid brain: local intent router (instant) + Cloudflare Workers AI fallback. */

var FLOWY_WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

window.__flowyOpen = false;
var flowyHistory = [];      // { role, content } for the LLM
var flowyBriefed = false;
var flowyBusy = false;

/* ── Panel open/close ───────────────────────────────────────────────────────── */
function toggleFlowy() {
  window.__flowyOpen = !window.__flowyOpen;
  document.body.classList.toggle('flowy-open', window.__flowyOpen);
  setTimeout(function() { window.dispatchEvent(new Event('resize')); }, 300);
  if (window.__flowyOpen) {
    var inp = document.getElementById('fl-input');
    if (inp) setTimeout(function() { inp.focus(); }, 240);
    if (!flowyBriefed) { flowyBriefed = true; flowyBriefing(); }
  }
}
window.toggleFlowy = toggleFlowy;

/* ── Rendering ──────────────────────────────────────────────────────────────── */
function flEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function flMd(s) {
  // markdown-lite on already-escaped text: **bold** + newlines
  return flEsc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
function flScroll() {
  var m = document.getElementById('fl-msgs');
  if (m) m.scrollTop = m.scrollHeight;
}
function flAdd(html, cls) {
  var m = document.getElementById('fl-msgs');
  if (!m) return null;
  var div = document.createElement('div');
  div.className = 'fl-msg ' + cls;
  div.innerHTML = html;
  m.appendChild(div);
  flScroll();
  if (typeof lucide !== 'undefined') lucide.createIcons();
  return div;
}
function flUser(text) { flAdd(flEsc(text), 'fl-user'); }
function flBot(html, opts) {
  opts = opts || {};
  var foot = opts.ai
    ? '<div class="fl-foot"><i data-lucide="sparkles"></i>AI answer · based on your live CRM data</div>'
    : (opts.instant ? '<div class="fl-foot"><i data-lucide="zap"></i>Instant · from your live data</div>' : '');
  flAdd('<div class="fl-orb-sm"><i data-lucide="sparkles"></i></div><div class="fl-bubble">' + html + foot + '</div>', 'fl-bot');
}
function flTyping(show) {
  var ex = document.getElementById('fl-typing');
  if (ex) ex.remove();
  if (show) {
    flAdd('<div class="fl-orb-sm"><i data-lucide="sparkles"></i></div><div class="fl-bubble fl-dots"><span></span><span></span><span></span></div>', 'fl-bot')
      .id = 'fl-typing';
  }
}

/* ── Send flow ──────────────────────────────────────────────────────────────── */
function flowySend(text) {
  var inp = document.getElementById('fl-input');
  var q = (text != null ? text : (inp ? inp.value : '')).trim();
  if (!q || flowyBusy) return;
  if (inp) { inp.value = ''; flInputSize(); }
  flUser(q);
  flowyHistory.push({ role: 'user', content: q });

  var local = flowyLocal(q);
  if (local) {
    flowyBusy = true;
    flTyping(true);
    setTimeout(function() {
      flTyping(false);
      flBot(local.html, { instant: true });
      flowyHistory.push({ role: 'assistant', content: local.plain || 'done' });
      if (local.run) { try { local.run(); } catch (e) {} }
      flowyBusy = false;
    }, 350);
    return;
  }
  flowyAskAI(q);
}
window.flowySend = flowySend;

function flKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flowySend(); }
}
window.flKey = flKey;
function flInputSize() {
  var t = document.getElementById('fl-input');
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 88) + 'px';
  var btn = document.getElementById('fl-send');
  if (btn) btn.disabled = !t.value.trim();
}
window.flInputSize = flInputSize;

/* ── Workers AI fallback ────────────────────────────────────────────────────── */
async function flowyAskAI(q) {
  flowyBusy = true;
  flTyping(true);
  var claims;
  try { claims = await auth0Client.getIdTokenClaims(); } catch (e) {}
  if (!claims || !claims.__raw) {
    flTyping(false); flowyBusy = false;
    flBot('I could not verify your session — try refreshing the page.');
    return;
  }
  try {
    var res = await fetch(FLOWY_WORKER + '/ai', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, context: flowyContext(), history: flowyHistory.slice(-7, -1) }),
    });
    flTyping(false);
    if (res.status === 501 || res.status === 404) {
      flBot("I can answer data questions and run commands instantly, but open-ended questions need my AI engine. " +
        "**One-time setup:** in Cloudflare, open the Worker → Settings → Bindings → add a <strong>Workers AI</strong> binding named <strong>AI</strong>, then redeploy. Free tier included.");
      flowyBusy = false;
      return;
    }
    if (!res.ok) {
      flBot('Hmm, my AI engine had trouble with that one. Try rephrasing, or ask me a data question.');
      flowyBusy = false;
      return;
    }
    var out = await res.json();
    var ans = String(out.answer || '').trim() || 'Sorry — I came back empty on that one.';
    flBot(flMd(ans), { ai: true });
    flowyHistory.push({ role: 'assistant', content: ans });
  } catch (e) {
    flTyping(false);
    flBot('I could not reach the AI engine — check your connection and try again.');
  }
  flowyBusy = false;
}

/* Compact CRM context for the LLM — a summary, never the raw dump */
function flowyContext() {
  var d = window.__crmData;
  if (!d) return {};
  var contacts = d.contacts || [], deals = d.deals || [], ov = d.overview || {};
  var now = Date.now();
  var srcs = {}, stages = {};
  contacts.forEach(function(c) { var s = c.source || 'Unknown'; srcs[s] = (srcs[s] || 0) + 1; });
  deals.forEach(function(x) { var s = x.stage || 'Unknown'; stages[s] = (stages[s] || 0) + (x.amount || 0); });
  var upcoming = deals.filter(function(x) { return x.closingDate && new Date(x.closingDate).getTime() >= now - 86400000; })
    .sort(function(a, b) { return new Date(a.closingDate) - new Date(b.closingDate); }).slice(0, 5)
    .map(function(x) { return { name: x.name, stage: x.stage, amount: x.amount, closing: String(x.closingDate).slice(0, 10) }; });
  var top = contacts.slice(0, 10).map(function(c) {
    return {
      name: c.name, status: c.status || 'unscored', source: c.source || 'Unknown',
      daysOld: c.createdAt ? Math.floor((now - new Date(c.createdAt).getTime()) / 86400000) : null,
      summary: c.summary ? String(c.summary).slice(0, 120) : undefined,
    };
  });
  var insights = (typeof buildInsights === 'function')
    ? buildInsights(d, filterByRange(contacts, window.__rangeDays || 30), window.__rangeDays || 30)
        .map(function(i) { return i.text.replace(/<[^>]+>/g, ''); })
    : [];
  return {
    today: new Date().toISOString().slice(0, 10),
    totals: {
      contacts: contacts.length,
      newLeadsToday: ov.newLeadsToday, bookedCalls: ov.bookedCalls,
      pipelineValue: ov.pipelineValue, openDeals: deals.length,
      monthlyLeadGoal: (typeof goalTarget === 'function') ? goalTarget() : null,
    },
    leadsBySource: srcs, pipelineByStage: stages,
    recentLeads: top, upcomingClosings: upcoming, insights: insights,
  };
}

/* ── Local intent router ────────────────────────────────────────────────────── */
function flFindLead(nameFrag) {
  var d = window.__crmData;
  if (!d || !nameFrag) return null;
  var q = nameFrag.trim().toLowerCase();
  if (!q) return null;
  var exact = d.contacts.find(function(c) { return (c.name || '').toLowerCase() === q; });
  if (exact) return exact;
  return d.contacts.find(function(c) { return (c.name || '').toLowerCase().indexOf(q) !== -1; }) || null;
}
function flNames(list, cap) {
  return list.slice(0, cap || 5).map(function(c) { return '<strong>' + flEsc(c.name) + '</strong>'; }).join(', ') +
    (list.length > (cap || 5) ? ' +' + (list.length - (cap || 5)) + ' more' : '');
}
function flStatusList(word) {
  var d = window.__crmData;
  return (d ? d.contacts : []).filter(function(c) {
    return String(c.status || '').toUpperCase().indexOf(word) !== -1;
  });
}

function flowyLocal(q) {
  var d = window.__crmData;
  var s = q.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!d) return { html: 'Your CRM data is still loading — give me a second and try again.' };
  var contacts = d.contacts || [], deals = d.deals || [], ov = d.overview || {};
  var now = Date.now();
  var m;

  // help
  if (/^(help|what can you do|what do you do)/.test(s)) {
    return { html: 'I can do a lot:<br>• <strong>Answer data questions</strong> — "how many leads this week?", "what\'s my pipeline?", "who needs attention?"<br>• <strong>Run commands</strong> — "show hot leads", "go to analytics", "export csv", "dark mode"<br>• <strong>Update leads</strong> — "mark Sarah warm" writes straight to Zoho<br>• <strong>Draft follow-ups</strong> — "draft a follow-up text for Jacob"<br>• <strong>Brief you</strong> — "daily briefing"<br>Anything else, I\'ll think it through with AI.' };
  }

  // briefing
  if (/briefing|summary of (the )?day|catch me up|what.s (new|happening)/.test(s)) {
    return { html: flowyBriefingHtml(), plain: 'briefing' };
  }

  // mark {name} {status}  — write-back
  m = s.match(/(?:mark|set|make)\s+(.+?)\s+(?:as\s+)?(hot|warm|cold|booked)\b/);
  if (m) {
    var lead = flFindLead(m[1]);
    if (!lead) return { html: 'I couldn\'t find a lead matching "<strong>' + flEsc(m[1]) + '</strong>". Check the spelling or try their full name.' };
    var st = m[2].toUpperCase();
    var safeId = String(lead.id).replace(/[^\w-]/g, '');
    return {
      html: '✓ Marking <strong>' + flEsc(lead.name) + '</strong> as <strong>' + st + '</strong> — writing to Zoho now.',
      plain: 'marked ' + lead.name + ' ' + st,
      run: function() { setLeadStatus(safeId, st); },
    };
  }

  // draft follow-up
  m = s.match(/(?:draft|write|compose)\s+(?:a\s+)?(?:follow[\s-]?up\s*)?(text|sms|email|message|follow[\s-]?up)?\s*(?:for|to)\s+(.+)$/);
  if (m && /draft|write|compose/.test(s)) {
    var lead2 = flFindLead(m[2]);
    if (!lead2) return { html: 'I couldn\'t find a lead named "<strong>' + flEsc(m[2]) + '</strong>" to draft for.' };
    flowyDraft(lead2, /email/.test(m[1] || '') ? 'email' : 'text');
    return { html: 'On it — drafting a ' + (/email/.test(m[1] || '') ? 'follow-up email' : 'follow-up text') + ' for <strong>' + flEsc(lead2.name) + '</strong>…', plain: 'drafting' };
  }

  // show/filter status leads
  m = s.match(/(?:show|filter|list|see)\s+(?:me\s+)?(hot|warm|cold|booked)\s+leads/);
  if (m) {
    var st2 = m[1].toUpperCase();
    var list = flStatusList(st2);
    return {
      html: list.length
        ? '✓ Opening your <strong>' + list.length + ' ' + st2 + '</strong> lead' + (list.length === 1 ? '' : 's') + ': ' + flNames(list)
        : 'No leads are marked <strong>' + st2 + '</strong> yet — scoring fills in as your automations run. Opening the Leads page anyway.',
      plain: st2 + ' leads: ' + list.length,
      run: function() {
        showPage('leads');
        var f = document.getElementById('filter-status');
        if (f) {
          var opt = Array.prototype.find.call(f.options, function(o) { return o.value.toUpperCase().indexOf(st2) !== -1; });
          f.value = opt ? opt.value : '';
        }
        applyLeadFilters();
      },
    };
  }

  // navigate
  m = s.match(/(?:go to|open|take me to|show)\s+(?:the\s+)?(overview|home|leads|activity|calendar|automations|analytics|settings)/);
  if (m) {
    var page = m[1] === 'home' ? 'overview' : m[1];
    return { html: '✓ Opening <strong>' + page.charAt(0).toUpperCase() + page.slice(1) + '</strong>.', plain: 'opened ' + page, run: function() { showPage(page); } };
  }

  // actions
  if (/export.*(csv|leads)|download.*(csv|leads)/.test(s)) return { html: '✓ Exporting your leads to CSV.', plain: 'exported', run: function() { exportLeadsCsv(); } };
  if (/report/.test(s) && /download|open|generate|print|create/.test(s)) return { html: '✓ Building your report — the print dialog will open.', plain: 'report', run: function() { openReport(); } };
  if (/dark mode|light mode|toggle theme|switch theme/.test(s)) return { html: '✓ Switching the theme.', plain: 'theme', run: function() { toggleTheme(); } };
  if (/^refresh|sync (data|now)|pull latest/.test(s)) return { html: '✓ Refreshing your CRM data.', plain: 'refresh', run: function() { refreshData(true); } };

  // find/open lead
  m = s.match(/(?:find|open|look ?up|pull up)\s+(?:lead\s+)?(.+)$/);
  if (m && !/leads|page/.test(m[1])) {
    var lead3 = flFindLead(m[1]);
    if (lead3) {
      var sid = String(lead3.id).replace(/[^\w-]/g, '');
      var nm = String(lead3.name || '').replace(/[^\w\s.@-]/g, '');
      return { html: '✓ Opening <strong>' + flEsc(lead3.name) + '</strong>.', plain: 'opened lead', run: function() { bellOpenLead(sid, nm); } };
    }
  }

  // data Q&A
  if (/how many leads.*today|leads today|today.s leads/.test(s)) {
    return { html: 'You have <strong>' + (ov.newLeadsToday || 0) + '</strong> new lead' + (ov.newLeadsToday === 1 ? '' : 's') + ' today.', plain: 'leads today: ' + ov.newLeadsToday };
  }
  if (/how many leads.*(week|7)|this week/.test(s) && /lead/.test(s)) {
    var wk = contacts.filter(function(c) { return c.createdAt && (now - new Date(c.createdAt).getTime()) < 7 * 86400000; }).length;
    return { html: 'You have <strong>' + wk + '</strong> new lead' + (wk === 1 ? '' : 's') + ' in the last 7 days.', plain: 'week leads: ' + wk };
  }
  if (/how many leads.*(month|30)|this month/.test(s) && /lead/.test(s)) {
    var ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
    var mo = contacts.filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= ms.getTime(); }).length;
    return { html: '<strong>' + mo + '</strong> lead' + (mo === 1 ? '' : 's') + ' so far this month.', plain: 'month leads: ' + mo };
  }
  if (/(total|how many) (leads|contacts)/.test(s)) {
    return { html: 'You have <strong>' + contacts.length + '</strong> total contacts in your CRM.', plain: 'total: ' + contacts.length };
  }
  if (/pipeline|deal value|worth/.test(s)) {
    return { html: 'Your pipeline is worth <strong>' + fmtMoney(ov.pipelineValue) + '</strong> across <strong>' + deals.length + '</strong> open deals.', plain: 'pipeline ' + ov.pipelineValue };
  }
  if (/booked|appointments|calls booked/.test(s)) {
    return { html: 'You have <strong>' + (ov.bookedCalls || 0) + '</strong> booked call' + (ov.bookedCalls === 1 ? '' : 's') + '.', plain: 'booked ' + ov.bookedCalls };
  }
  if (/goal|pace/.test(s)) {
    var g = (typeof goalTarget === 'function') ? goalTarget() : 50;
    var ms2 = new Date(); ms2.setDate(1); ms2.setHours(0, 0, 0, 0);
    var mc = contacts.filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= ms2.getTime(); }).length;
    return { html: 'You\'re at <strong>' + mc + ' of ' + g + '</strong> leads this month (' + Math.round((mc / g) * 100) + '% of your goal).', plain: 'goal ' + mc + '/' + g };
  }
  if (/(top|best) source|where.*leads (come|coming) from|sources/.test(s)) {
    var sc = {};
    contacts.forEach(function(c) { var k = c.source || 'Unknown'; sc[k] = (sc[k] || 0) + 1; });
    var keys = Object.keys(sc).sort(function(a, b) { return sc[b] - sc[a]; });
    if (!keys.length) return { html: 'No source data yet.' };
    return { html: 'Top sources: ' + keys.slice(0, 4).map(function(k) { return '<strong>' + flEsc(k) + '</strong> (' + sc[k] + ')'; }).join(' · '), plain: 'top source ' + keys[0] };
  }
  if (/need(s)? attention|unresponsive|follow.?up.*needed|stale/.test(s)) {
    var att = d.needsAttention || [];
    return att.length
      ? { html: '<strong>' + att.length + '</strong> lead' + (att.length === 1 ? '' : 's') + ' need attention: ' + flNames(att) + '. Say "show them" or check the bell.', plain: 'attention ' + att.length }
      : { html: 'All clear — no leads need immediate attention right now. ✓', plain: 'attention 0' };
  }
  if (/clos(e|ing|es).*(week|soon|month)|deals? clos/.test(s)) {
    var horizon = /month/.test(s) ? 31 : 7;
    var cl = deals.filter(function(x) {
      if (!x.closingDate) return false;
      var t = new Date(x.closingDate).getTime();
      return t >= now - 86400000 && t <= now + horizon * 86400000;
    });
    if (!cl.length) return { html: 'No deals have closing dates in the next ' + horizon + ' days.', plain: 'closings 0' };
    var tot = 0; cl.forEach(function(x) { tot += x.amount || 0; });
    return { html: '<strong>' + cl.length + '</strong> deal' + (cl.length === 1 ? '' : 's') + (tot ? ' worth <strong>' + fmtMoney(tot) + '</strong>' : '') + ' close in the next ' + horizon + ' days: ' + cl.slice(0, 4).map(function(x) { return '<strong>' + flEsc(x.name) + '</strong>'; }).join(', '), plain: 'closings ' + cl.length };
  }
  if (/(hot|warm|cold) leads?( count)?|how many (hot|warm|cold)/.test(s)) {
    var stw = (s.match(/hot|warm|cold/) || ['hot'])[0].toUpperCase();
    var ls = flStatusList(stw);
    return ls.length
      ? { html: '<strong>' + ls.length + '</strong> ' + stw + ' lead' + (ls.length === 1 ? '' : 's') + ': ' + flNames(ls), plain: stw + ' ' + ls.length }
      : { html: 'No leads are marked <strong>' + stw + '</strong> yet — scoring lands as your automations run.', plain: stw + ' 0' };
  }
  if (/conversion/.test(s)) {
    var cr = contacts.length ? Math.round(((ov.bookedCalls || 0) / contacts.length) * 100) : 0;
    return { html: 'Your conversion rate is <strong>' + cr + '%</strong> (' + (ov.bookedCalls || 0) + ' booked of ' + contacts.length + ' leads).', plain: 'conv ' + cr };
  }

  return null; // → Workers AI
}

/* ── Briefing ───────────────────────────────────────────────────────────────── */
function flowyBriefingHtml() {
  var d = window.__crmData;
  if (!d) return 'Your data is still loading — ask me again in a moment.';
  var ov = d.overview || {}, contacts = d.contacts || [];
  var ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
  var mo = contacts.filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= ms.getTime(); }).length;
  var g = (typeof goalTarget === 'function') ? goalTarget() : 50;
  var att = (d.needsAttention || []).length;
  var parts = [];
  parts.push('<strong>' + (ov.newLeadsToday || 0) + '</strong> new lead' + (ov.newLeadsToday === 1 ? '' : 's') + ' today, <strong>' + mo + '</strong> this month (' + Math.round((mo / g) * 100) + '% of your ' + g + '-lead goal).');
  parts.push('Pipeline: <strong>' + fmtMoney(ov.pipelineValue) + '</strong> across ' + (d.deals || []).length + ' open deals.');
  if (typeof buildInsights === 'function') {
    var ins = buildInsights(d, filterByRange(contacts, 30), 30).slice(0, 2);
    ins.forEach(function(i) { parts.push(i.text); });
  }
  if (att > 0) parts.push('<strong>' + att + '</strong> lead' + (att === 1 ? '' : 's') + ' need attention — say <em>"show them"</em>.');
  return parts.join('<br><br>');
}
function flowyBriefing() {
  flTyping(true);
  setTimeout(function() {
    flTyping(false);
    var h = new Date().getHours();
    var hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    flBot('<div class="fl-brief-head">' + hello + '! Here\'s where things stand:</div>' + flowyBriefingHtml(), { instant: true });
  }, 500);
}

/* ── Draft follow-ups ───────────────────────────────────────────────────────── */
async function flowyDraft(lead, kind) {
  flowyBusy = true;
  flTyping(true);
  var draft = null;
  // Try Workers AI first
  var claims;
  try { claims = await auth0Client.getIdTokenClaims(); } catch (e) {}
  if (claims && claims.__raw) {
    try {
      var res = await fetch(FLOWY_WORKER + '/ai', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Write a short, friendly follow-up ' + (kind === 'email' ? 'email (subject line + 3-4 sentence body)' : 'SMS (under 300 characters)') +
            ' to this lead. Sound human, reference how they came in, end with a soft call-to-action to book a call. Output ONLY the message text.',
          context: { lead: { name: lead.name, source: lead.source || 'your website', status: lead.status || 'new', summary: lead.summary || null } },
        }),
      });
      if (res.ok) { var out = await res.json(); draft = String(out.answer || '').trim(); }
    } catch (e) {}
  }
  if (!draft) {
    var first = String(lead.name || 'there').split(/\s+/)[0];
    draft = kind === 'email'
      ? 'Subject: Quick follow-up, ' + first + '\n\nHi ' + first + ',\n\nThanks for reaching out' + (lead.source ? ' through ' + lead.source : '') + '! I wanted to personally follow up and see how we can help. Would you be open to a quick call this week?\n\nBest,\n[Your name]'
      : 'Hi ' + first + '! Thanks for reaching out' + (lead.source ? ' via ' + lead.source : '') + ' — just following up to see how we can help. Any chance you\'re free for a quick call this week?';
  }
  flTyping(false);
  var id = 'draft-' + Date.now();
  flBot('Here\'s a ' + (kind === 'email' ? 'follow-up email' : 'follow-up text') + ' for <strong>' + flEsc(lead.name) + '</strong>:' +
    '<div class="fl-draft" id="' + id + '">' + flEsc(draft) + '</div>' +
    '<button class="fl-copy" onclick="flowyCopy(\'' + id + '\')"><i data-lucide="copy"></i>Copy</button>', { ai: !!claims });
  flowyBusy = false;
}
function flowyCopy(id) {
  var el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(function() {
    if (typeof showToast === 'function') showToast('Draft copied to clipboard.');
  });
}
window.flowyCopy = flowyCopy;

/* Chip helper */
function flowyChip(text) { flowySend(text); }
window.flowyChip = flowyChip;
