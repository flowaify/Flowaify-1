// Teams Hub — Flowaify dashboard v1

var _tw = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';

var _teamsCurrentChannel = null;
var _teamsPollingId      = null;
var _teamsLastMsgTs      = 0;
var _teamsInfoOpen       = false;
var _teamsChannels       = [];
var _teamsAllActivity    = [];

// ── Init ──────────────────────────────────────────────────────────────────────

async function teamsInit() {
  if (_teamsPollingId) { clearInterval(_teamsPollingId); _teamsPollingId = null; }
  _teamsLastMsgTs = 0;
  _teamsCurrentChannel = null;
  teamsTab('chat', true);
  await teamLoad();
  var hub = document.getElementById('teams-hub');
  if (!hub) return;
  // teamLoad sets inline style to 'flex' on success; check computed display as fallback
  var hubVisible = hub.style.display !== 'none' && hub.style.display !== '';
  if (!hubVisible) {
    var computed = window.getComputedStyle(hub).display;
    if (computed === 'none') return;
  }
  await teamsLoadChannels();
  _teamsPollingId = setInterval(teamsPoll, 8000);
}
window.teamsInit = teamsInit;

// ── Tab switching ─────────────────────────────────────────────────────────────

function teamsTab(name, silent) {
  document.querySelectorAll('.teams-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.teams-section').forEach(function(s) {
    s.classList.toggle('active', s.id === 'teams-section-' + name);
  });
  if (!silent) {
    if (name === 'activity') teamsLoadActivity();
    if (name === 'chat' && _teamsCurrentChannel) teamsScrollBottom();
  }
}
window.teamsTab = teamsTab;

// ── Authenticated fetch ───────────────────────────────────────────────────────

async function twFetch(method, path, body) {
  var client = window.__auth0Client;
  if (!client) return { status: 0 };
  var claims;
  try { claims = await client.getIdTokenClaims(); } catch (e) { return { status: 0 }; }
  if (!claims || !claims.__raw) return { status: 0 };
  try {
    var res = await fetch(_tw + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + claims.__raw, 'Content-Type': 'application/json' },
      body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, data: data };
  } catch (e) { return { status: 0 }; }
}

// ── Channels ──────────────────────────────────────────────────────────────────

async function teamsLoadChannels() {
  var listEl = document.getElementById('teams-ch-list');
  if (listEl) listEl.innerHTML = '<div class="teams-loading" style="padding:16px 12px;font-size:12.5px;">Loading channels…</div>';
  var r = await twFetch('GET', '/team/channels');
  if (!r || r.status !== 200) {
    await teamsBootDefaultChannels();
    return;
  }
  var channels = (r.data && r.data.channels) || [];
  if (channels.length === 0) {
    await teamsBootDefaultChannels();
    return;
  }
  _teamsChannels = channels;
  teamsRenderChannels(channels);
  teamsSelectChannel(channels[0].id, channels[0].name);
}

async function teamsBootDefaultChannels() {
  var defaults = ['General', 'Leads', 'Announcements'];
  var created = [];
  for (var i = 0; i < defaults.length; i++) {
    var r = await twFetch('POST', '/team/channels', { name: defaults[i] });
    if (r && r.status === 200 && r.data && r.data.channel) created.push(r.data.channel);
  }
  _teamsChannels = created;
  teamsRenderChannels(created);
  if (created[0]) teamsSelectChannel(created[0].id, created[0].name);
}

function teamsRenderChannels(channels) {
  var el = document.getElementById('teams-ch-list');
  if (!el) return;
  if (!channels || channels.length === 0) {
    el.innerHTML = '<div class="teams-empty-note" style="padding:12px 8px;">No channels yet</div>';
    return;
  }
  el.innerHTML = channels.map(function(ch) {
    var active = _teamsCurrentChannel && _teamsCurrentChannel.id === ch.id;
    var chId = twEsc(ch.id); var chName = twEsc(ch.name);
    return '<div class="teams-ch-item' + (active ? ' active' : '') + '" data-chid="' + chId + '" onclick="teamsSelectChannel(\'' + chId + '\',\'' + chName + '\')">' +
      '<span class="teams-ch-icon">#</span>' +
      '<div class="teams-ch-item-body">' +
        '<div class="teams-ch-name-row">' +
          '<span class="teams-ch-item-name">' + twEsc(ch.name) + '</span>' +
          (ch.unread ? '<span class="teams-ch-unread">' + Math.min(ch.unread, 99) + '</span>' : '') +
        '</div>' +
        '<div class="teams-ch-preview">' + twEsc(ch.lastMessage || 'No messages yet') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function teamsSelectChannel(id, name) {
  _teamsCurrentChannel = { id: id, name: name };
  _teamsLastMsgTs = 0;
  var nameEl = document.getElementById('teams-active-name');
  if (nameEl) nameEl.textContent = name;
  var inputEl = document.getElementById('teams-input');
  if (inputEl) inputEl.placeholder = 'Message #' + name + '…';
  // Highlight active channel
  document.querySelectorAll('.teams-ch-item').forEach(function(item) {
    item.classList.toggle('active', item.dataset.chid === id);
  });
  var msgWrap = document.getElementById('teams-messages');
  if (msgWrap) msgWrap.innerHTML = '<div class="teams-loading">Loading messages…</div>';
  var r = await twFetch('GET', '/team/messages?channel=' + encodeURIComponent(id));
  if (r && r.status === 200) {
    var msgs = (r.data && r.data.messages) || [];
    teamsRenderMessages(msgs, false);
    if (msgs.length > 0) _teamsLastMsgTs = msgs[msgs.length - 1].ts || 0;
    teamsRenderInfoMembers();
    teamsScrollBottom();
  } else {
    if (msgWrap) msgWrap.innerHTML = '<div class="teams-loading">No messages yet — say hello!</div>';
    teamsRenderInfoMembers();
  }
  // Update channel list to clear unread badge
  teamsRenderChannels(_teamsChannels.map(function(c) {
    return c.id === id ? Object.assign({}, c, { unread: 0 }) : c;
  }));
}
window.teamsSelectChannel = teamsSelectChannel;

// ── Render messages ───────────────────────────────────────────────────────────

function teamsRenderMessages(msgs, append) {
  var container = document.getElementById('teams-messages');
  if (!container) return;
  if (!append) container.innerHTML = '';

  var prevAuthor = null;
  var prevTs = 0;

  if (append) {
    var rows = container.querySelectorAll('.teams-msg-row[data-author]');
    if (rows.length > 0) {
      var last = rows[rows.length - 1];
      prevAuthor = last.dataset.author || null;
      prevTs = parseInt(last.dataset.ts || '0', 10);
    }
  }

  msgs.forEach(function(msg) {
    var ts = msg.ts || Date.now();

    // Day separator
    if (!prevTs || !twSameDay(prevTs, ts)) {
      var sep = document.createElement('div');
      sep.className = 'teams-day-sep';
      sep.innerHTML = '<span>' + twDayLabel(ts) + '</span>';
      container.appendChild(sep);
    }

    var grouped = prevAuthor === msg.authorSub && (ts - prevTs) < 3 * 60 * 1000;
    prevAuthor = msg.authorSub;
    prevTs = ts;

    var row = document.createElement('div');
    row.className = 'teams-msg-row';
    row.dataset.mid    = msg.id || '';
    row.dataset.author = msg.authorSub || '';
    row.dataset.ts     = ts;

    var avatarPart = grouped
      ? '<div class="teams-msg-avatar-spacer"></div>'
      : '<div class="teams-msg-avatar" style="background:' + twColor(msg.authorSub) + ';">' + twInitials(msg.authorName || '?') + '</div>';

    var metaPart = grouped ? '' :
      '<div class="teams-msg-meta">' +
        '<span class="teams-msg-author">' + twEsc(msg.authorName || 'Member') + '</span>' +
        '<span class="teams-msg-time">' + twTimeStr(ts) + '</span>' +
      '</div>';

    var bodyPart = twMsgBody(msg);
    var rxPart   = twReactionsPart(msg);
    var mid      = twEsc(msg.id || '');

    row.innerHTML = avatarPart +
      '<div class="teams-msg-body">' + metaPart + bodyPart + rxPart + '</div>' +
      '<button class="teams-msg-react-btn" onclick="teamsReactPicker(\'' + mid + '\')" title="React">☺</button>';

    container.appendChild(row);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function twMsgBody(msg) {
  if (msg.type === 'lead' && msg.payload) {
    var lead = msg.payload;
    return '<div class="teams-msg-text">' + twEsc(msg.content || '') + '</div>' +
      '<div class="teams-share-card">' +
        '<div class="teams-share-card-title">Lead</div>' +
        '<div class="teams-share-card-name">' + twEsc(lead.name || '—') + '</div>' +
        '<div class="teams-share-card-meta">' +
          (lead.status ? twStatusBadge(lead.status) : '') +
          (lead.source ? '<span style="font-size:11.5px;color:var(--text-m);">' + twEsc(lead.source) + '</span>' : '') +
          '<span class="teams-share-card-link" onclick="teamsOpenLead(\'' + twEsc(lead.id || '') + '\')">View lead →</span>' +
        '</div>' +
      '</div>';
  }
  if (msg.type === 'invoice' && msg.payload) {
    var inv = msg.payload;
    return '<div class="teams-msg-text">' + twEsc(msg.content || '') + '</div>' +
      '<div class="teams-share-card">' +
        '<div class="teams-share-card-title">Invoice</div>' +
        '<div class="teams-share-card-name">' + twEsc(inv.number || '—') + ' &nbsp;·&nbsp; ' + twEsc(inv.clientName || '—') + '</div>' +
        '<div class="teams-share-card-meta">' +
          (inv.status ? twStatusBadge(inv.status) : '') +
          '<span style="font-size:11.5px;color:var(--text-m);">' + (inv.total ? '$' + Number(inv.total).toFixed(2) : '') + '</span>' +
        '</div>' +
      '</div>';
  }
  if (msg.type === 'report' && msg.payload) {
    var rep = msg.payload;
    return '<div class="teams-msg-text">' + twEsc(msg.content || '') + '</div>' +
      '<div class="teams-share-card">' +
        '<div class="teams-share-card-title">Report</div>' +
        '<div class="teams-share-card-name">' + twEsc(rep.title || 'Report') + '</div>' +
        '<div class="teams-share-card-meta">' +
          '<span style="font-size:11.5px;color:var(--text-m);">' + twEsc(rep.date || '') + (rep.reportFor ? ' · ' + twEsc(rep.reportFor) : '') + '</span>' +
        '</div>' +
      '</div>';
  }
  return '<div class="teams-msg-text">' + twLinkify(twEsc(msg.content || '')) + '</div>';
}

function twReactionsPart(msg) {
  var rxs  = msg.reactions || {};
  var mine = msg.myReactions || [];
  var keys = Object.keys(rxs).filter(function(k) { return rxs[k] > 0; });
  if (!keys.length) return '';
  var mid = twEsc(msg.id || '');
  return '<div class="teams-reactions">' + keys.map(function(emoji) {
    var isMine = mine.indexOf(emoji) !== -1;
    return '<span class="teams-reaction' + (isMine ? ' mine' : '') + '" onclick="teamsReact(\'' + mid + '\',\'' + twEsc(emoji) + '\')">' +
      emoji + '<span class="teams-reaction-count">' + rxs[emoji] + '</span></span>';
  }).join('') + '</div>';
}

// ── Sending ───────────────────────────────────────────────────────────────────

async function teamsSendMsg() {
  var input = document.getElementById('teams-input');
  if (!input || !_teamsCurrentChannel) return;
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  teamsAutoResize(input);

  // Optimistic local message
  var tempId = 'tmp_' + Date.now();
  var tempMsg = {
    id: tempId, authorSub: window.__userSub || 'self',
    authorName: window.__userName || 'Me',
    content: text, type: 'text', ts: Date.now(), reactions: {}, myReactions: []
  };
  teamsRenderMessages([tempMsg], true);
  teamsScrollBottom();

  var r = await twFetch('POST', '/team/messages/send', {
    channelId: _teamsCurrentChannel.id, content: text, type: 'text'
  });
  if (r && r.status === 200 && r.data && r.data.message) {
    var real = r.data.message;
    var tempRow = document.querySelector('.teams-msg-row[data-mid="' + tempId + '"]');
    if (tempRow) tempRow.dataset.mid = real.id;
    _teamsLastMsgTs = real.ts || Date.now();
    teamsUpdateChannelPreview(_teamsCurrentChannel.id, text);
  }
}
window.teamsSendMsg = teamsSendMsg;

function teamsKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); teamsSendMsg(); }
}
window.teamsKeyDown = teamsKeyDown;

function teamsAutoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}
window.teamsAutoResize = teamsAutoResize;

// ── Polling ───────────────────────────────────────────────────────────────────

async function teamsPoll() {
  if (!_teamsCurrentChannel) return;
  var url = '/team/messages?channel=' + encodeURIComponent(_teamsCurrentChannel.id) + '&after=' + _teamsLastMsgTs;
  var r = await twFetch('GET', url);
  if (r && r.status === 200) {
    var msgs = (r.data && r.data.messages) || [];
    var mySub = window.__userSub || '';
    var newMsgs = msgs.filter(function(m) { return m.ts > _teamsLastMsgTs && m.authorSub !== mySub; });
    if (newMsgs.length > 0) {
      teamsRenderMessages(newMsgs, true);
      _teamsLastMsgTs = newMsgs[newMsgs.length - 1].ts;
      teamsScrollBottom();
    }
  }
  // Refresh channel badges
  var cr = await twFetch('GET', '/team/channels');
  if (cr && cr.status === 200) {
    var channels = (cr.data && cr.data.channels) || [];
    _teamsChannels = channels;
    teamsRenderChannels(channels);
  }
}

// ── Reactions ─────────────────────────────────────────────────────────────────

function teamsReactPicker(msgId) {
  var EMOJIS = ['👍', '❤️', '😂', '🔥', '✅', '👀', '🎉', '🙌'];
  var existing = document.getElementById('teams-react-picker');
  if (existing) { existing.remove(); return; }
  var picker = document.createElement('div');
  picker.id = 'teams-react-picker';
  picker.style.cssText = 'position:fixed;z-index:700;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;display:flex;gap:4px;box-shadow:0 4px 20px rgba(0,0,0,0.18);';
  picker.innerHTML = EMOJIS.map(function(e) {
    return '<span style="font-size:20px;cursor:pointer;padding:3px 4px;border-radius:4px;transition:background 0.1s;" ' +
      'onmouseenter="this.style.background=\'var(--hover)\'" ' +
      'onmouseleave="this.style.background=\'\'" ' +
      'onclick="teamsReact(\'' + twEsc(msgId) + '\',\'' + e + '\');var p=document.getElementById(\'teams-react-picker\');if(p)p.remove();">' + e + '</span>';
  }).join('');
  picker.style.bottom = '130px';
  picker.style.right  = '20px';
  document.body.appendChild(picker);
  setTimeout(function() {
    function closeOnClick(ev) {
      if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closeOnClick); }
    }
    document.addEventListener('click', closeOnClick);
  }, 0);
}
window.teamsReactPicker = teamsReactPicker;

async function teamsReact(msgId, emoji) {
  if (!_teamsCurrentChannel) return;
  await twFetch('POST', '/team/react', { channelId: _teamsCurrentChannel.id, msgId: msgId, emoji: emoji });
  var r = await twFetch('GET', '/team/messages?channel=' + encodeURIComponent(_teamsCurrentChannel.id));
  if (r && r.status === 200) {
    teamsRenderMessages((r.data && r.data.messages) || [], false);
    teamsScrollBottom();
  }
}
window.teamsReact = teamsReact;

// ── Info panel ────────────────────────────────────────────────────────────────

function teamsToggleInfo() {
  _teamsInfoOpen = !_teamsInfoOpen;
  var sec = document.getElementById('teams-section-chat');
  if (sec) sec.classList.toggle('teams-info-panel-open', _teamsInfoOpen);
}
window.teamsToggleInfo = teamsToggleInfo;

function teamsRenderInfoMembers() {
  var el = document.getElementById('teams-info-members');
  if (!el) return;
  var doc     = window.__teamDoc;
  var members = doc && doc.members ? doc.members : [];
  var countEl = document.getElementById('teams-ch-member-count');
  if (countEl) countEl.textContent = members.length + ' member' + (members.length === 1 ? '' : 's');
  if (!members.length) {
    el.innerHTML = '<div class="teams-empty-note" style="padding:12px 14px;">No members yet</div>';
    return;
  }
  el.innerHTML = members.map(function(m) {
    var av = (typeof avatarHtml === 'function') ? avatarHtml(m.name || m.email, 'width:28px;height:28px;font-size:11px;flex-shrink:0;') : '';
    return '<div class="teams-info-member">' +
      '<div class="teams-presence' + (m.status === 'active' ? ' online' : '') + '"></div>' +
      av +
      '<div><div class="teams-info-member-name">' + twEsc(m.name || m.email) + '</div>' +
      '<div class="teams-info-member-role">' + twEsc(m.role || 'member') + '</div></div>' +
    '</div>';
  }).join('');
}

// ── New channel modal ─────────────────────────────────────────────────────────

function teamsNewChannel() {
  var modal = document.getElementById('teams-ch-modal');
  if (!modal) return;
  modal.classList.add('open');
  var inp = document.getElementById('teams-ch-name-input');
  if (inp) { inp.value = ''; inp.focus(); }
}
window.teamsNewChannel = teamsNewChannel;

function teamsCloseChModal() {
  var modal = document.getElementById('teams-ch-modal');
  if (modal) modal.classList.remove('open');
}
window.teamsCloseChModal = teamsCloseChModal;

async function teamsCreateChannel() {
  var inp = document.getElementById('teams-ch-name-input');
  if (!inp) return;
  var raw  = inp.value.trim();
  var name = raw.replace(/[^a-zA-Z0-9 \-_]/g, '').trim().slice(0, 40);
  if (!name) return;
  teamsCloseChModal();
  var r = await twFetch('POST', '/team/channels', { name: name });
  if (r && r.status === 200 && r.data && r.data.channel) {
    _teamsChannels.push(r.data.channel);
    teamsRenderChannels(_teamsChannels);
    teamsSelectChannel(r.data.channel.id, r.data.channel.name);
    if (typeof showToast === 'function') showToast('#' + name + ' channel created');
  } else if (r && r.status === 409) {
    if (typeof showToast === 'function') showToast('A channel with that name already exists.');
  }
}
window.teamsCreateChannel = teamsCreateChannel;

// ── Lead picker ───────────────────────────────────────────────────────────────

function teamsPickLead() {
  var picker = document.getElementById('teams-lead-picker');
  if (!picker) return;
  picker.classList.add('open');
  teamsFilterLeadPicker('');
  var inp = document.getElementById('teams-lead-search');
  if (inp) { inp.value = ''; inp.focus(); }
}
window.teamsPickLead = teamsPickLead;

function teamsCloseLeadPicker() {
  var picker = document.getElementById('teams-lead-picker');
  if (picker) picker.classList.remove('open');
}
window.teamsCloseLeadPicker = teamsCloseLeadPicker;

function teamsFilterLeadPicker(q) {
  var listEl   = document.getElementById('teams-lead-pick-list');
  if (!listEl) return;
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var q2 = (q || '').toLowerCase();
  var filtered = q2
    ? contacts.filter(function(c) { return ((c.name || '') + ' ' + (c.email || '')).toLowerCase().indexOf(q2) !== -1; })
    : contacts;
  filtered = filtered.slice(0, 20);
  if (!filtered.length) {
    listEl.innerHTML = '<div style="padding:20px 16px;text-align:center;font-size:12.5px;color:var(--text-m);">No leads found</div>';
    return;
  }
  listEl.innerHTML = filtered.map(function(c) {
    var av = (typeof avatarHtml === 'function') ? avatarHtml(c.name || c.email, 'width:32px;height:32px;font-size:12px;flex-shrink:0;') : '';
    return '<div class="teams-lead-pick-item" onclick="teamsShareLead(\'' + twEsc(c.id) + '\')">' +
      av +
      '<div><div class="teams-lead-pick-name">' + twEsc(c.name || '—') + '</div>' +
      '<div class="teams-lead-pick-meta">' + twEsc(c.email || '—') +
        (c.status ? ' · ' + c.status : '') +
      '</div></div>' +
    '</div>';
  }).join('');
}
window.teamsFilterLeadPicker = teamsFilterLeadPicker;

async function teamsShareLead(contactId) {
  teamsCloseLeadPicker();
  if (!_teamsCurrentChannel) return;
  var contacts = (window.__crmData && window.__crmData.contacts) || [];
  var lead = contacts.find(function(c) { return c.id === contactId; });
  if (!lead) return;
  var payload = { id: lead.id, name: lead.name, email: lead.email, status: lead.status, source: lead.source };
  var r = await twFetch('POST', '/team/messages/send', {
    channelId: _teamsCurrentChannel.id,
    content: 'Shared lead: ' + lead.name,
    type: 'lead',
    payload: payload
  });
  if (r && r.status === 200 && r.data && r.data.message) {
    teamsRenderMessages([r.data.message], true);
    teamsScrollBottom();
    _teamsLastMsgTs = r.data.message.ts || _teamsLastMsgTs;
    teamsUpdateChannelPreview(_teamsCurrentChannel.id, 'Shared lead: ' + lead.name);
    if (typeof showToast === 'function') showToast('Lead shared in #' + _teamsCurrentChannel.name);
  }
}
window.teamsShareLead = teamsShareLead;

function teamsOpenLead(leadId) {
  if (!leadId) return;
  if (typeof showPage === 'function') showPage('leads');
  setTimeout(function() { if (typeof openLead === 'function') openLead(leadId); }, 150);
}
window.teamsOpenLead = teamsOpenLead;

// ── Share lead from Flowy ─────────────────────────────────────────────────────

function teamsShareLeadInChat(contactId, channelId) {
  // Called by Flowy Actions after approval
  var chId = channelId || (_teamsChannels[0] && _teamsChannels[0].id) || null;
  var chName = channelId
    ? ((_teamsChannels.find(function(c) { return c.id === channelId; }) || {}).name || 'General')
    : (_teamsChannels[0] && _teamsChannels[0].name) || 'General';
  _teamsCurrentChannel = { id: chId, name: chName };
  teamsShareLead(contactId);
}
window.teamsShareLeadInChat = teamsShareLeadInChat;

// ── Share invoice ─────────────────────────────────────────────────────────────

async function teamsShareInvoice(inv) {
  if (!_teamsCurrentChannel) {
    if (typeof showPage === 'function') showPage('team');
    if (typeof showToast === 'function') showToast('Select a channel on the Team page first.');
    return;
  }
  var payload = {
    id: inv.id,
    number: inv.number,
    clientName: (inv.billTo || {}).name || '—',
    total: inv.total || 0,
    status: inv.status || 'draft',
    dueDate: inv.dueDate || ''
  };
  var r = await twFetch('POST', '/team/messages/send', {
    channelId: _teamsCurrentChannel.id,
    content: 'Shared invoice ' + (inv.number || '') + ' for ' + payload.clientName,
    type: 'invoice',
    payload: payload
  });
  if (r && r.status === 200 && r.data && r.data.message) {
    teamsRenderMessages([r.data.message], true);
    teamsScrollBottom();
    _teamsLastMsgTs = r.data.message.ts || _teamsLastMsgTs;
    teamsUpdateChannelPreview(_teamsCurrentChannel.id, 'Shared invoice ' + (inv.number || ''));
    if (typeof showToast === 'function') showToast('Invoice shared in #' + _teamsCurrentChannel.name);
  }
}
window.teamsShareInvoice = teamsShareInvoice;

// ── Share report ──────────────────────────────────────────────────────────────

async function teamsShareReport(rpt) {
  if (!_teamsCurrentChannel) {
    if (typeof showPage === 'function') showPage('team');
    if (typeof showToast === 'function') showToast('Select a channel on the Team page first.');
    return;
  }
  var payload = {
    id: rpt.id,
    title: rpt.title || 'Report',
    type: rpt.type || 'full',
    days: rpt.days || 30,
    date: rpt.dateStr || new Date(rpt.createdAt).toLocaleDateString(),
    reportFor: rpt.reportFor || ''
  };
  var r = await twFetch('POST', '/team/messages/send', {
    channelId: _teamsCurrentChannel.id,
    content: 'Shared report: ' + payload.title + (payload.reportFor ? ' for ' + payload.reportFor : ''),
    type: 'report',
    payload: payload
  });
  if (r && r.status === 200 && r.data && r.data.message) {
    teamsRenderMessages([r.data.message], true);
    teamsScrollBottom();
    _teamsLastMsgTs = r.data.message.ts || _teamsLastMsgTs;
    teamsUpdateChannelPreview(_teamsCurrentChannel.id, 'Shared report: ' + payload.title);
    if (typeof showToast === 'function') showToast('Report shared in #' + _teamsCurrentChannel.name);
  }
}
window.teamsShareReport = teamsShareReport;

// ── Channel preview update ────────────────────────────────────────────────────

function teamsUpdateChannelPreview(channelId, text) {
  _teamsChannels = _teamsChannels.map(function(c) {
    return c.id === channelId ? Object.assign({}, c, { lastMessage: text }) : c;
  });
  teamsRenderChannels(_teamsChannels);
}

// ── Activity tab ──────────────────────────────────────────────────────────────

async function teamsLoadActivity() {
  var feed = document.getElementById('teams-activity-feed');
  if (!feed) return;
  feed.innerHTML = '<div class="teams-loading">Loading activity…</div>';
  var r = await twFetch('GET', '/team/activity');
  if (!r || r.status !== 200) {
    feed.innerHTML = '<div class="teams-loading">Could not load activity.</div>';
    return;
  }
  _teamsAllActivity = (r.data && r.data.log) || [];
  teamsRenderActivity(_teamsAllActivity);
  teamsPopulateActFilter();
}

function teamsRenderActivity(log) {
  var feed = document.getElementById('teams-activity-feed');
  if (!feed) return;
  if (!log || !log.length) {
    feed.innerHTML = '<div class="empty-state" style="padding:40px 20px;">' +
      '<i data-lucide="history"></i>' +
      '<div class="empty-state-title">No activity yet</div>' +
      '<div class="empty-state-sub">Team actions like invites, lead updates, and report generation show here.</div>' +
    '</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  var items = log.slice().reverse();
  feed.innerHTML = items.map(function(l) {
    return '<div class="feed-item">' +
      '<div class="feed-icon" style="background:var(--blue-dim);">' +
        '<i data-lucide="activity" style="width:14px;height:14px;color:var(--blue);"></i>' +
      '</div>' +
      '<div class="feed-text"><span>' + twEsc(l.text) + '</span></div>' +
      '<div class="feed-time">' + (typeof relTime === 'function' ? relTime(l.ts) : '') + '</div>' +
    '</div>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function teamsPopulateActFilter() {
  var sel = document.getElementById('teams-act-filter');
  if (!sel) return;
  var doc     = window.__teamDoc;
  var members = doc && doc.members ? doc.members : [];
  var existing = Array.from(sel.options).map(function(o) { return o.value; });
  members.forEach(function(m) {
    var val = m.name || m.email;
    if (val && existing.indexOf(val) === -1) {
      var opt = document.createElement('option');
      opt.value       = val;
      opt.textContent = val;
      sel.appendChild(opt);
    }
  });
}

function teamsApplyActFilter() {
  var sel = document.getElementById('teams-act-filter');
  var val = sel ? sel.value : 'all';
  var filtered = (val === 'all') ? _teamsAllActivity : _teamsAllActivity.filter(function(l) {
    return (l.text || '').toLowerCase().indexOf(val.toLowerCase()) !== -1;
  });
  teamsRenderActivity(filtered);
}
window.teamsApplyActFilter = teamsApplyActFilter;

// ── Scroll helpers ────────────────────────────────────────────────────────────

function teamsScrollBottom() {
  var wrap = document.getElementById('teams-messages-wrap');
  if (wrap) requestAnimationFrame(function() { wrap.scrollTop = wrap.scrollHeight; });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function twEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function twInitials(name) {
  var parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0][0] || '') + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function twColor(sub) {
  var palette = ['#0050e6','#7c3aed','#dc2626','#059669','#d97706','#0891b2','#be185d','#65a30d'];
  var h = 0;
  var s = String(sub || '');
  for (var i = 0; i < s.length; i++) { h = ((h * 31) + s.charCodeAt(i)) >>> 0; }
  return palette[h % palette.length];
}

function twSameDay(ts1, ts2) {
  var a = new Date(ts1), b = new Date(ts2);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function twDayLabel(ts) {
  var d = new Date(ts); var now = new Date();
  var diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function twTimeStr(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function twStatusBadge(status) {
  var s = (status || '').toUpperCase();
  var c = { HOT: 'var(--red)', WARM: '#d97706', COLD: '#64748b' }[s] || 'var(--text-m)';
  return '<span style="font-size:11px;font-weight:700;color:' + c + ';letter-spacing:0.4px;">' + s + '</span>';
}

function twLinkify(text) {
  return text.replace(/(https?:\/\/[^\s&lt;&gt;]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--blue);">$1</a>');
}
