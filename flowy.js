/* Flowy — Copilot-style AI assistant for the Flowaify dashboard.
   Hybrid brain: local intent router (instant) + Cloudflare Workers AI fallback. */

var FLOWY_WORKER = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

window.__flowyOpen = false;
var flowyHistory = [];      // { role, content } for the LLM
var flowyBriefed = false;
var flowyBusy = false;
var flowyRestored = false;
var flowyNews = null;       // cached whatsnew titles
var flowyReport = { active: false, step: null, config: {} };
var flowyDay = { active: false, queue: [], idx: 0, done: 0 };
var flowyFaq = null;
var flowyAbort = null;
window.__watchItems = [];
var watchShown = false;

function flChatKey() { return 'flw_chat_' + (window.__userSub || 'anon'); }

function flPortalOnly(what) {
  return {
    html: what + ' works best in the dashboard. <a href="app.html" style="color:var(--blue);font-weight:600;">Open Dashboard →</a>',
    plain: 'redirect',
  };
}

function flSaveTranscript() {
  // Chat is session-only by design — a page refresh starts clean.
  // Also purge any transcript saved by earlier versions.
  try { localStorage.removeItem(flChatKey()); } catch (e) {}
}

function flRestoreTranscript() {
  if (flowyRestored) return;
  flowyRestored = true;
  try { localStorage.removeItem(flChatKey()); } catch (e) {}
}

/* ── Panel open/close ───────────────────────────────────────────────────────── */
function toggleFlowy() {
  window.__flowyOpen = !window.__flowyOpen;
  document.body.classList.toggle('flowy-open', window.__flowyOpen);
  setTimeout(function() { window.dispatchEvent(new Event('resize')); }, 300);
  if (window.__flowyOpen) {
    var inp = document.getElementById('fl-input');
    if (inp) setTimeout(function() { inp.focus(); }, 240);
    flRestoreTranscript();
    if (!flowyBriefed) { flowyBriefed = true; flowyBriefing(); }
    setTimeout(flowyWatchAnnounce, flowyBriefed ? 1400 : 400);
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
  flSaveTranscript();

  if (flowyReport.active) {
    flowyReportStep(q);
    return;
  }
  if (flowyDay.active) {
    flowyDayStep(q);
    return;
  }

  var local = flowyLocal(q);
  if (local) {
    if (local.handled) return; // async intent (memory) renders its own reply
    flowyBusy = true;
    flTyping(true);
    setTimeout(function() {
      flTyping(false);
      flBot(local.html, { instant: true });
      flowyHistory.push({ role: 'assistant', content: local.plain || 'done' });
      flSaveTranscript();
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
    flowyAbort = new AbortController();
    var res = await fetch(FLOWY_WORKER + '/ai', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, context: flowyContext(), history: flowyHistory.slice(-7, -1) }),
      signal: flowyAbort.signal,
    });
    if (res.status === 501 || res.status === 404) {
      flTyping(false);
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

    flTyping(false);
    var ctype = res.headers.get('Content-Type') || '';
    if (ctype.indexOf('text/event-stream') === -1) {
      // Older Worker still deployed — plain JSON path
      var out = await res.json();
      var ans0 = String(out.answer || '').trim() || 'Sorry — I came back empty on that one.';
      flBot(flMd(ans0), { ai: true });
      flowyHistory.push({ role: 'assistant', content: ans0 });
      flSaveTranscript();
      flowyBusy = false;
      return;
    }

    // Streamed answer: live-typing bubble
    window.__flStreaming = true;
    flStopUI(true);
    var live = flAdd('<div class="fl-orb-sm"><img class="logo-white" src="logo-transparent.png" alt="" /></div><div class="fl-bubble"><span class="fl-live"></span></div>', 'fl-bot');
    var liveSpan = live ? live.querySelector('.fl-live') : null;
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', ans = '';
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (t.indexOf('data: ') === 0 && t !== 'data: [DONE]') {
          try {
            var obj = JSON.parse(t.slice(6));
            if (obj.response) {
              ans += obj.response;
              if (liveSpan) { liveSpan.innerHTML = flMd(ans); flScroll(); }
            }
          } catch (e) {}
        }
      }
    }
    window.__flStreaming = false;
    flStopUI(false);
    ans = ans.trim() || 'Sorry — I came back empty on that one.';
    if (liveSpan) {
      liveSpan.parentElement.innerHTML = flMd(ans) +
        '<div class="fl-foot"><i data-lucide="sparkles"></i>AI answer · based on your live CRM data</div>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      flScroll();
    }
    flowyHistory.push({ role: 'assistant', content: ans });
    flSaveTranscript();
  } catch (e) {
    flTyping(false);
    window.__flStreaming = false;
    flStopUI(false);
    if (e && e.name === 'AbortError') {
      flBot('<em>Stopped.</em>', { instant: true });
    } else {
      flBot('I could not reach the AI engine — check your connection and try again.');
    }
  }
  flowyAbort = null;
  flowyBusy = false;
}

function flStopUI(streaming) {
  var btn = document.getElementById('fl-send');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = streaming ? '<i data-lucide="square"></i>' : '<i data-lucide="arrow-up"></i>';
  btn.classList.toggle('stopping', !!streaming);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ── Memory API (teachable facts) ───────────────────────────────────────────── */
async function flowyMemory(op) {
  var claims;
  try { claims = await auth0Client.getIdTokenClaims(); } catch (e) { return null; }
  if (!claims || !claims.__raw) return null;
  try {
    var res = await fetch(FLOWY_WORKER + '/memory', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    });
    if (res.status === 501 || res.status === 404) return { notEnabled: true };
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function flowyMemReply(promise, render) {
  flowyBusy = true;
  flTyping(true);
  promise.then(function(out) {
    flTyping(false);
    if (out && out.notEnabled) {
      flBot('My memory needs the same one-time KV setup as your Team page — create the <strong>flowaify-team</strong> namespace, bind it as <strong>TEAM_KV</strong> on the Worker, and redeploy.');
    } else if (!out) {
      flBot("I couldn't reach my memory just now — try again in a moment.");
    } else {
      flBot(render(out), { instant: true });
    }
    flowyBusy = false;
  });
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
      score: c.score || undefined,
      insight: c.insight ? String(c.insight).slice(0, 100) : undefined,
      summary: c.summary ? String(c.summary).slice(0, 120) : undefined,
    };
  });
  var insights = (typeof buildInsights === 'function')
    ? buildInsights(d, filterByRange(contacts, window.__rangeDays || 30), window.__rangeDays || 30)
        .map(function(i) { return i.text.replace(/<[^>]+>/g, ''); })
    : [];
  var biz = '', industry = '';
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    biz = ((saved.biz || {})['s2-biz-name'] || '').trim();
    industry = ((saved.biz || {})['s2-industry'] || '').trim();
  } catch (e) {}
  if (flowyNews === null) {
    flowyNews = [];
    fetch('whatsnew.json', { cache: 'no-cache' }).then(function(r) { return r.json(); })
      .then(function(items) {
        if (Array.isArray(items)) flowyNews = items.slice(0, 3).map(function(it) { return it.title; });
      }).catch(function() {});
  }
  return {
    business: biz || undefined,
    industry: industry && industry !== 'Select…' ? industry : undefined,
    flowaifyService: 'Flowaify captures this client\u2019s CRM leads, replies instantly by SMS/email, scores and follows up automatically, and books calls.',
    latestFeatures: flowyNews && flowyNews.length ? flowyNews : undefined,
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
    return { html: 'I can do a lot:<br>• <strong>Answer data questions</strong> — "how many leads this week?", "what\'s my pipeline?", "who needs attention?"<br>• <strong>Run commands</strong> — "show hot leads", "go to analytics", "export csv", "dark mode"<br>• <strong>Update leads</strong> — "mark Sarah warm" writes straight to Zoho<br>• <strong>Draft follow-ups</strong> — "draft a follow-up text for Jacob"<br>• <strong>Build custom reports</strong> — "build me a report" (I\u2019ll ask what you want in it) or "report on Sarah"<br>• <strong>Brief you</strong> — "daily briefing"<br>Anything else, I\'ll think it through with AI.' };
  }

  // briefing
  if (/briefing|summary of (the )?day|catch me up|what.s (new|happening)/.test(s)) {
    return { html: flowyBriefingHtml(), plain: 'briefing' };
  }

  var portal = !!window.__isPortal;

  // start my day
  if (/start my day|work (my|the) (queue|leads)|daily run|morning run/.test(s)) {
    if (portal) return flPortalOnly('The daily lead queue');
    setTimeout(flowyDayStart, 300);
    return { html: null, handled: true };
  }

  // note on {name}: {text}   /  log a call with {name}: {text}
  m = q.match(/^(?:note (?:on|for)|log (?:a )?(?:call|meeting|chat) with)\s+([^:]+):\s*(.+)$/i);
  if (m) {
    if (portal) return flPortalOnly('Saving notes');
    var noteLead = flFindLead(m[1]);
    if (!noteLead) return { html: 'I couldn\u2019t find a lead named \u201c' + flEsc(m[1].trim()) + '\u201d.' };
    var noteText = m[2].trim();
    var noteId = String(noteLead.id).replace(/[^\w-]/g, '');
    flowyBusy = true;
    flTyping(true);
    updateLead(noteId, { note: noteText }).then(function(ok) {
      flTyping(false);
      flowyBusy = false;
      flBot(ok
        ? '✓ Note saved to <strong>' + flEsc(noteLead.name) + '</strong> in Zoho:<br><em>' + flEsc(noteText) + '</em>'
        : 'That note didn\u2019t save — try again in a moment.', { instant: true });
    });
    return { html: null, handled: true };
  }

  // compare this month vs last month
  if (/compare.*(month|period)|this month (vs|versus|to|against) last/.test(s)) {
    var contacts2 = contacts;
    var nowD = new Date();
    var thisStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
    var lastStart = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime();
    var thisN = 0, lastN = 0;
    contacts2.forEach(function(c) {
      if (!c.createdAt) return;
      var t = new Date(c.createdAt).getTime();
      if (t >= thisStart) thisN++;
      else if (t >= lastStart && t < thisStart) lastN++;
    });
    var diff = lastN > 0 ? Math.round(((thisN - lastN) / lastN) * 100) : null;
    var verdict = diff == null ? '' :
      diff >= 0 ? ' — up <strong>' + diff + '%</strong>. Keep feeding the machine.' : ' — down <strong>' + Math.abs(diff) + '%</strong>. Worth a look at your top source.';
    return { html: 'This month: <strong>' + thisN + '</strong> leads · Last month: <strong>' + lastN + '</strong>' + verdict, plain: 'compare ' + thisN + '/' + lastN };
  }

  // FAQ knowledge (flowyfaq.json)
  var faqHit = flowyFaqMatch(s);
  if (faqHit) return { html: faqHit, plain: 'faq' };

  // custom report builder
  m = q.match(/(?:report|summary)\s+(?:for|on|about)\s+(.+)$/i);
  if (/report/i.test(s) && m && !/change|issue/.test(s)) {
    if (portal) return flPortalOnly('Report building');
    var rl = flFindLead(m[1].replace(/lead\s*/i, ''));
    if (rl) {
      var rid = String(rl.id).replace(/[^\w-]/g, '');
      return {
        html: 'On it — building a full lead report for <strong>' + flEsc(rl.name) + '</strong>. The print dialog will open; save as PDF to share it.',
        plain: 'lead report',
        run: function() { openLeadReport(rid); },
      };
    }
  }
  if (/(?:build|create|make|generate|custom).{0,20}report|^report$|custom report/i.test(s)) {
    if (portal) return flPortalOnly('Report building');
    flowyReport = { active: true, step: 'type', config: {} };
    setTimeout(function() {
      flBot('Let\u2019s build it. What kind of report do you want?' + flOpts(['Performance summary', 'Specific lead', 'Pipeline & deals']) + '<div style="margin-top:6px;font-size:10.5px;color:var(--text-m);">(say \u201ccancel\u201d anytime)</div>', { instant: true });
    }, 300);
    return { html: null, handled: true };
  }

  // memory: remember / forget / list / clear
  m = q.match(/^remember\s+(?:that\s+)?(.+)$/i);
  if (m) {
    var fact = m[1].trim();
    flowyMemReply(flowyMemory({ add: fact }), function(out) {
      return "Got it — I'll remember that. ✓<br><em>" + flEsc(fact) + '</em>';
    });
    return { html: null, handled: true };
  }
  m = q.match(/^forget\s+(?:about\s+)?(.+)$/i);
  if (m) {
    var needle = m[1].trim();
    flowyMemReply(flowyMemory({ remove: needle }), function(out) {
      return out.changed
        ? 'Forgotten. ✓' + (out.removed && out.removed.length ? '<br><em>' + out.removed.map(flEsc).join('<br>') + '</em>' : '')
        : "I didn't have anything matching “" + flEsc(needle) + '”.';
    });
    return { html: null, handled: true };
  }
  if (/^(what do you remember|show (your )?memory|list memories)/i.test(s)) {
    flowyMemReply(flowyMemory({ list: true }), function(out) {
      return out.facts && out.facts.length
        ? 'Here\u2019s what I\u2019m holding onto:<br>' + out.facts.map(function(f) { return '• ' + flEsc(f); }).join('<br>')
        : "Nothing saved yet — tell me <em>\u201cremember \u2026\u201d</em> and I\u2019ll keep it in mind.";
    });
    return { html: null, handled: true };
  }
  if (/^(clear|wipe|reset) (your )?memory/i.test(s)) {
    flowyMemReply(flowyMemory({ reset: true }), function(out) {
      try { localStorage.removeItem(flChatKey()); } catch (e) {}
      flowyHistory = [];
      return 'Memory cleared — facts and chat history are gone. Fresh start. ✓';
    });
    return { html: null, handled: true };
  }

  // mark {name} {status}  — write-back
  m = s.match(/(?:mark|set|make)\s+(.+?)\s+(?:as\s+)?(hot|warm|cold|booked)\b/);
  if (m) {
    if (portal) return flPortalOnly('Updating leads');
    var lead = flFindLead(m[1]);
    if (!lead) return { html: 'I couldn\'t find a lead matching "<strong>' + flEsc(m[1]) + '</strong>". Check the spelling or try their full name.' };
    var st = m[2].toUpperCase();
    var safeId = String(lead.id).replace(/[^\w-]/g, '');
    var prevSt = lead.status || '';
    return {
      html: '✓ Marking <strong>' + flEsc(lead.name) + '</strong> as <strong>' + st + '</strong> — writing to Zoho now.' +
        '<div class="fl-opts"><button onclick="flowyUndoStatus(\'' + safeId + '\', \'' + prevSt.replace(/[^\w\s-]/g, '') + '\')">Undo</button></div>',
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
    if (portal) return flPortalOnly('Filtering leads');
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
    if (portal) {
      return { html: '✓ Taking you to the dashboard.', plain: 'nav', run: function() { window.location.href = 'app.html'; } };
    }
    var page = m[1] === 'home' ? 'overview' : m[1];
    return { html: '✓ Opening <strong>' + page.charAt(0).toUpperCase() + page.slice(1) + '</strong>.', plain: 'opened ' + page, run: function() { showPage(page); } };
  }

  // actions
  if (/export.*(csv|leads)|download.*(csv|leads)/.test(s)) {
    if (portal) return flPortalOnly('CSV export');
    return { html: '✓ Exporting your leads to CSV.', plain: 'exported', run: function() { exportLeadsCsv(); } };
  }
  if (/report/.test(s) && /download|open|generate|print|create/.test(s)) {
    if (portal) return flPortalOnly('Report building');
    return { html: '✓ Building your report — the print dialog will open.', plain: 'report', run: function() { openReport(); } };
  }
  if (/dark mode|light mode|toggle theme|switch theme/.test(s)) return { html: '✓ Switching the theme.', plain: 'theme', run: function() { toggleTheme(); } };
  if (/^refresh|sync (data|now)|pull latest/.test(s)) return { html: '✓ Refreshing your CRM data.', plain: 'refresh', run: function() { refreshData(true); } };

  // find/open lead
  m = s.match(/(?:find|open|look ?up|pull up)\s+(?:lead\s+)?(.+)$/);
  if (m && !/leads|page/.test(m[1])) {
    if (portal) return flPortalOnly('Opening leads');
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
  // Win first
  parts.push('The headline: <strong>' + fmtMoney(ov.pipelineValue) + '</strong> in play across ' + (d.deals || []).length + ' open deals, and <strong>' + mo + '</strong> lead' + (mo === 1 ? '' : 's') + ' in the door this month — ' + Math.round((mo / g) * 100) + '% of your ' + g + '-lead goal.');
  if (typeof buildInsights === 'function') {
    var ins = buildInsights(d, filterByRange(contacts, 30), 30).slice(0, 2);
    ins.forEach(function(i) { parts.push(i.text); });
  }
  // Risk + next step last
  if (att > 0) {
    parts.push('One thing I\u2019d handle today: <strong>' + att + '</strong> lead' + (att === 1 ? '' : 's') + ' sitting untouched for 48h+. Say <em>\u201cshow them\u201d</em> and I\u2019ll pull the list.');
  } else {
    parts.push('Nothing is slipping — every lead has been touched. Ask me anything, or say <em>\u201cwhat closes this week?\u201d</em>');
  }
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

/* ── Proactive watchdog ─────────────────────────────────────────────────────── */
function flowyWatch(data) {
  if (!data) return;
  var items = [];
  var att = (data.needsAttention || []).length;
  if (att > 0) {
    items.push({ text: '<strong>' + att + '</strong> lead' + (att === 1 ? '' : 's') + ' untouched for 48h+ — momentum dies fast.', chips: ['Start my day', 'Show them'] });
  }
  // Goal pace
  try {
    var g = (typeof goalTarget === 'function') ? goalTarget() : 50;
    var now = new Date();
    var ms = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var mo = (data.contacts || []).filter(function(c) { return c.createdAt && new Date(c.createdAt).getTime() >= ms; }).length;
    var daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var elapsed = now.getDate() / daysIn;
    if (g > 0 && elapsed > 0.2 && (mo / g) / elapsed < 0.7) {
      items.push({ text: 'You\u2019re at <strong>' + mo + ' of ' + g + '</strong> leads — behind pace for the month.', chips: ['How is my goal?'] });
    }
  } catch (e) {}
  // Deals closing within 48h
  var soon = (data.deals || []).filter(function(d) {
    if (!d.closingDate) return false;
    var t = new Date(d.closingDate).getTime();
    return t >= Date.now() - 86400000 && t <= Date.now() + 2 * 86400000;
  });
  if (soon.length) {
    var tot = 0; soon.forEach(function(d) { tot += d.amount || 0; });
    items.push({ text: '<strong>' + soon.length + '</strong> deal' + (soon.length === 1 ? '' : 's') + (tot ? ' worth <strong>' + fmtMoney(tot) + '</strong>' : '') + ' close within 48 hours.', chips: ['What closes this week?'] });
  }
  window.__watchItems = items;
  var badge = document.getElementById('fab-badge');
  if (badge) {
    badge.textContent = items.length;
    badge.style.display = items.length ? 'flex' : 'none';
  }
}
window.flowyWatch = flowyWatch;

function flowyWatchAnnounce() {
  var items = window.__watchItems || [];
  if (!items.length || watchShown) return;
  watchShown = true;
  var htmlOut = '<div class="fl-brief-head">I caught ' + items.length + ' thing' + (items.length === 1 ? '' : 's') + ' worth your attention:</div>' +
    items.map(function(it) { return '• ' + it.text; }).join('<br>');
  var chips = [];
  items.forEach(function(it) { (it.chips || []).forEach(function(c) { if (chips.indexOf(c) === -1) chips.push(c); }); });
  if (chips.length) htmlOut += flOpts(chips.slice(0, 3));
  flBot(htmlOut, { instant: true });
}

/* ── Start-my-day guided queue ──────────────────────────────────────────────── */
function flowyDayStart() {
  var d = window.__crmData;
  if (!d) { flBot('Your data is still loading — try again in a second.', { instant: true }); return; }
  var queue = (d.needsAttention && d.needsAttention.length ? d.needsAttention : d.contacts.filter(function(c) {
    return c.createdAt && (Date.now() - new Date(c.createdAt).getTime()) > 2 * 86400000 && !c.lastTouchAt;
  })).map(function(c) { return String(c.id); });
  if (!queue.length) {
    flBot('Your queue is clear — every lead has been touched. That\u2019s how it\u2019s done. ✓', { instant: true });
    return;
  }
  flowyDay = { active: true, queue: queue, idx: 0, done: 0 };
  flBot('Let\u2019s work the queue — <strong>' + queue.length + '</strong> lead' + (queue.length === 1 ? '' : 's') + ' need a touch. Here\u2019s the first:', { instant: true });
  setTimeout(flowyDayShow, 400);
}

function flowyDayShow() {
  var d = window.__crmData;
  if (!flowyDay.active || !d) return;
  if (flowyDay.idx >= flowyDay.queue.length) { flowyDayFinish(); return; }
  var c = d.contacts.find(function(x) { return String(x.id) === flowyDay.queue[flowyDay.idx]; });
  if (!c) { flowyDay.idx++; flowyDayShow(); return; }
  var age = c.createdAt ? relTime(new Date(c.createdAt).getTime()) : '—';
  flBot('<strong>' + flEsc(c.name) + '</strong> · ' + flEsc(c.source || 'Unknown source') + ' · came in ' + age +
    (c.status ? ' · ' + flEsc(c.status) : ' · unscored') +
    '<br><span style="font-size:11px;color:var(--text-m);">(' + (flowyDay.idx + 1) + ' of ' + flowyDay.queue.length + ')</span>' +
    flOpts(['Draft follow-up', 'Mark warm', 'Mark cold', 'Skip', 'Stop']), { instant: true });
}

function flowyDayStep(q) {
  var s = q.toLowerCase().trim();
  var d = window.__crmData;
  var c = d ? d.contacts.find(function(x) { return String(x.id) === flowyDay.queue[flowyDay.idx]; }) : null;
  if (/^(stop|cancel|quit|done|exit)/.test(s)) {
    var n = flowyDay.done;
    flowyDay = { active: false, queue: [], idx: 0, done: 0 };
    flBot('Stopping there — you handled <strong>' + n + '</strong> lead' + (n === 1 ? '' : 's') + ' this run. Say <em>\u201cstart my day\u201d</em> to pick it back up.', { instant: true });
    return;
  }
  if (!c) { flowyDay.idx++; flowyDayShow(); return; }
  var sid = String(c.id).replace(/[^\w-]/g, '');

  if (/draft/.test(s)) {
    flowyDraft(c, 'text').then(function() {
      flowyDay.done++;
      flowyDay.idx++;
      setTimeout(flowyDayShow, 700);
    });
    return;
  }
  var mm = s.match(/mark\s*(hot|warm|cold|booked)|^(hot|warm|cold|booked)$/);
  if (mm) {
    var st = (mm[1] || mm[2]).toUpperCase();
    flBot('✓ <strong>' + flEsc(c.name) + '</strong> → ' + st + '. Next:', { instant: true });
    setLeadStatus(sid, st);
    flowyDay.done++;
    flowyDay.idx++;
    setTimeout(flowyDayShow, 900);
    return;
  }
  if (/skip|next|pass/.test(s)) {
    flowyDay.idx++;
    flowyDayShow();
    return;
  }
  flBot('Tap a chip or say <em>draft</em>, <em>mark warm/cold</em>, <em>skip</em>, or <em>stop</em>.' + flOpts(['Draft follow-up', 'Mark warm', 'Skip', 'Stop']), { instant: true });
}

function flowyDayFinish() {
  var n = flowyDay.done;
  var total = flowyDay.queue.length;
  flowyDay = { active: false, queue: [], idx: 0, done: 0 };
  watchShown = true;
  flBot('🎉 Queue clear — <strong>' + n + ' of ' + total + '</strong> leads handled. That\u2019s a strong start to the day. I\u2019ll keep watch from here.', { instant: true });
}

/* Chip helper */
function flowyChip(text) { flowySend(text); }
window.flowyChip = flowyChip;

/* ── Conversational report builder ──────────────────────────────────────────── */
function flOpts(opts) {
  return '<div class="fl-opts">' + opts.map(function(o) {
    return '<button onclick="flowySend(\'' + o.replace(/[^\w\s&\u2013-]/g, '') + '\')">' + flEsc(o) + '</button>';
  }).join('') + '</div>';
}

function flowyReportCancel(msg) {
  flowyReport = { active: false, step: null, config: {} };
  flBot(msg || 'No problem — report cancelled. Ask me anytime.', { instant: true });
}

function flowyParseDays(s) {
  if (/7|week/.test(s)) return { days: 7, label: 'Last 7 days' };
  if (/90|quarter/.test(s)) return { days: 90, label: 'Last 90 days' };
  if (/30|month ago|last 30/.test(s)) return { days: 30, label: 'Last 30 days' };
  if (/this month|current month/.test(s)) {
    var now = new Date();
    return { days: now.getDate(), label: 'This month' };
  }
  var m = s.match(/(?:from|since)\s+(.+)$/);
  if (m) {
    var t = Date.parse(m[1]);
    if (!isNaN(t) && t < Date.now()) {
      var d = Math.max(1, Math.ceil((Date.now() - t) / 86400000));
      return { days: d, label: 'Since ' + new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
    }
  }
  return null;
}

var FLOWY_SECTIONS = [
  { key: 'kpis',     words: /kpi|number|stat|metric/,        label: 'Key numbers' },
  { key: 'sources',  words: /source/,                        label: 'Lead sources' },
  { key: 'funnel',   words: /funnel|conversion/,             label: 'Conversion funnel' },
  { key: 'insights', words: /insight|finding/,               label: 'Insights' },
  { key: 'topleads', words: /top lead|lead list|leads/,      label: 'Top leads' },
  { key: 'stages',   words: /stage|pipeline|deal/,           label: 'Pipeline by stage' },
];

function flowyReportStep(q) {
  var s = q.toLowerCase().trim();
  if (/^(cancel|never ?mind|stop|forget it|quit)/.test(s)) { flowyReportCancel(); return; }
  var cfg = flowyReport.config;

  flowyBusy = true;
  flTyping(true);
  setTimeout(function() {
    flTyping(false);
    flowyBusy = false;

    if (flowyReport.step === 'type') {
      if (/lead/.test(s) && !/leads/.test(s) || /specific/.test(s)) {
        flowyReport.step = 'lead';
        flBot('Which lead? Give me a name.', { instant: true });
        return;
      }
      if (/pipeline|deal/.test(s)) {
        cfg.type = 'performance';
        cfg.sections = ['kpis', 'stages', 'funnel'];
        flowyReport.step = 'range';
        flBot('Pipeline it is. What period should it cover?' + flOpts(['Last 7 days', 'Last 30 days', 'Last 90 days', 'This month']), { instant: true });
        return;
      }
      if (/performance|summary|everything|full/.test(s)) {
        cfg.type = 'performance';
        flowyReport.step = 'range';
        flBot('What period should the report cover?' + flOpts(['Last 7 days', 'Last 30 days', 'Last 90 days', 'This month']), { instant: true });
        return;
      }
      flBot('I can do a <strong>performance summary</strong>, a <strong>specific lead</strong> report, or a <strong>pipeline & deals</strong> report — which one?' + flOpts(['Performance summary', 'Specific lead', 'Pipeline & deals']), { instant: true });
      return;
    }

    if (flowyReport.step === 'lead') {
      var lead = flFindLead(q);
      if (!lead) {
        flBot('I couldn\u2019t find a lead matching \u201c' + flEsc(q) + '\u201d — try their full name, or say \u201ccancel\u201d.', { instant: true });
        return;
      }
      flowyReport = { active: false, step: null, config: {} };
      var rid = String(lead.id).replace(/[^\w-]/g, '');
      flBot('Building the full report for <strong>' + flEsc(lead.name) + '</strong> — the print dialog will open. Save as PDF to share it.', { instant: true });
      setTimeout(function() { openLeadReport(rid); }, 600);
      return;
    }

    if (flowyReport.step === 'range') {
      var r = flowyParseDays(s);
      if (!r) {
        flBot('Give me a period — like <em>last 30 days</em>, <em>this month</em>, or <em>since June 1</em>.' + flOpts(['Last 7 days', 'Last 30 days', 'Last 90 days', 'This month']), { instant: true });
        return;
      }
      cfg.days = r.days;
      cfg.rangeLabel = r.label;
      if (cfg.sections) {          // pipeline preset — skip section picking
        flowyReportFinish();
        return;
      }
      flowyReport.step = 'sections';
      flBot('Last one — what should go in? Say <strong>everything</strong>, or pick from: key numbers, sources, funnel, insights, top leads, pipeline stages.' + flOpts(['Everything', 'Key numbers & sources', 'Funnel & insights']), { instant: true });
      return;
    }

    if (flowyReport.step === 'sections') {
      var picked = [];
      if (/everything|all|full/.test(s)) {
        picked = FLOWY_SECTIONS.map(function(x) { return x.key; });
      } else {
        FLOWY_SECTIONS.forEach(function(sec) { if (sec.words.test(s)) picked.push(sec.key); });
      }
      if (!picked.length) {
        flBot('Tell me at least one section — or just say <strong>everything</strong>.' + flOpts(['Everything']), { instant: true });
        return;
      }
      cfg.sections = picked;
      flowyReportFinish();
      return;
    }

    flowyReportCancel();
  }, 350);
}

function flowyReportFinish() {
  var cfg = flowyReport.config;
  flowyReport = { active: false, step: null, config: {} };
  var names = (cfg.sections || []).map(function(k) {
    var f = FLOWY_SECTIONS.find(function(x) { return x.key === k; });
    return f ? f.label.toLowerCase() : k;
  });
  flBot('Done — building your <strong>' + flEsc(cfg.rangeLabel || '') + '</strong> report with ' + flEsc(names.join(', ')) + '. The print dialog will open; save as PDF to share it.', { instant: true });
  setTimeout(function() { openCustomReport(cfg); }, 600);
}


/* ── Undo status change ─────────────────────────────────────────────────────── */
function flowyUndoStatus(id, prev) {
  if (!prev || !prev.trim()) {
    // No previous status — nothing to revert in Zoho's allowed set; just tell the user
    flBot('That lead had no score before — I can\u2019t un-set it from here, but you can pick a new one anytime.', { instant: true });
    return;
  }
  var st = prev.toUpperCase();
  if (['HOT', 'WARM', 'COLD', 'BOOKED'].indexOf(st) === -1) {
    flBot('The previous status (\u201c' + flEsc(prev) + '\u201d) isn\u2019t one I can write back — leaving it as is.', { instant: true });
    return;
  }
  flBot('↩ Reverting to <strong>' + st + '</strong>.', { instant: true });
  setLeadStatus(id, st);
}
window.flowyUndoStatus = flowyUndoStatus;

/* ── FAQ knowledge (flowyfaq.json) ──────────────────────────────────────────── */
function flowyFaqLoad() {
  if (flowyFaq !== null) return;
  flowyFaq = [];
  fetch('flowyfaq.json', { cache: 'no-cache' }).then(function(r) { return r.json(); })
    .then(function(items) { if (Array.isArray(items)) flowyFaq = items; })
    .catch(function() {});
}
flowyFaqLoad();

function flowyFaqMatch(s) {
  if (!flowyFaq || !flowyFaq.length) return null;
  var best = null, bestScore = 0;
  flowyFaq.forEach(function(f) {
    var words = String(f.q || '').toLowerCase().split(/[^a-z0-9]+/).filter(function(w) { return w.length > 3; });
    if (!words.length) return;
    var hits = words.filter(function(w) { return s.indexOf(w) !== -1; }).length;
    var score = hits / words.length;
    if (hits >= 2 && score > bestScore) { best = f; bestScore = score; }
  });
  return best && bestScore >= 0.5 ? flMd(best.a) : null;
}

/* ── Voice input (Web Speech API) ───────────────────────────────────────────── */
var flRec = null;
function flVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function flVoice() {
  var btn = document.getElementById('fl-mic');
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (flRec) { flRec.stop(); return; }
  flRec = new SR();
  flRec.lang = 'en-US';
  flRec.interimResults = true;
  var inp = document.getElementById('fl-input');
  if (btn) btn.classList.add('rec');
  flRec.onresult = function(e) {
    var text = '';
    for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    if (inp) { inp.value = text; flInputSize(); }
  };
  flRec.onend = function() {
    flRec = null;
    if (btn) btn.classList.remove('rec');
    if (inp && inp.value.trim()) inp.focus();
  };
  flRec.onerror = function() {
    flRec = null;
    if (btn) btn.classList.remove('rec');
  };
  try { flRec.start(); } catch (e) { flRec = null; if (btn) btn.classList.remove('rec'); }
}
window.flVoice = flVoice;
document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('fl-mic');
  if (btn && !flVoiceSupported()) btn.style.display = 'none';
});

/* ── Send-or-stop control ───────────────────────────────────────────────────── */
function flSendOrStop() {
  if (window.__flStreaming && flowyAbort) {
    flowyAbort.abort();
    return;
  }
  flowySend();
}
window.flSendOrStop = flSendOrStop;
