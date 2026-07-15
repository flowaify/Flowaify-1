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
  twApplyBrief();
  twTasksLoad();
  twPinsLoad();
  /* one-time: stamp app_metadata.clientId on existing roster accounts */
  try {
    if (!localStorage.getItem('flw_bf2')) {
      twFetch('POST', '/team/backfill').then(function(r) {
        if (r && r.status === 200) localStorage.setItem('flw_bf2', '1');
      });
    }
  } catch (e) {}
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
    if (name === 'tasks') twTasksLoad();
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
  /* mobile channel switcher mirrors the list */
  var mob = document.getElementById('teams-ch-mobile');
  if (mob) {
    mob.innerHTML = channels.map(function(ch) {
      var sel = _teamsCurrentChannel && _teamsCurrentChannel.id === ch.id ? ' selected' : '';
      return '<option value="' + twEsc(ch.id) + '"' + sel + '>' + twEsc(ch.name) + (ch.unread ? ' (' + ch.unread + ')' : '') + '</option>';
    }).join('');
  }
  var canManage = window.__myRole === 'owner' || window.__myRole === 'admin';
  el.innerHTML = channels.map(function(ch) {
    var active = _teamsCurrentChannel && _teamsCurrentChannel.id === ch.id;
    var chId = twEsc(ch.id); var chName = twEsc(ch.name);
    var meta = twChMeta(ch.name);
    return '<div class="teams-ch-item' + (active ? ' active' : '') + '" data-chid="' + chId + '" onclick="teamsSelectChannel(\'' + chId + '\',\'' + chName + '\')">' +
      '<div class="teams-ch-item-body">' +
        '<div class="teams-ch-name-row">' +
          '<span class="teams-ch-item-name">' + twEsc(ch.name) + '</span>' +
          (ch.unread ? '<span class="teams-ch-unread">' + Math.min(ch.unread, 99) + '</span>' : '') +
          (ch.lastTs ? '<span class="teams-ch-time">' + twShortTime(ch.lastTs) + '</span>' : '') +
        '</div>' +
        '<div class="teams-ch-preview">' + twEsc(meta.desc) + '</div>' +
      '</div>' +
      (canManage ? '<button class="teams-ch-kebab" onclick="twChMenu(event,\'' + chId + '\',\'' + chName.replace(/'/g, '') + '\')" title="Channel options">⋮</button>' : '') +
    '</div>';
  }).join('');
}

function twShortTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  var yd = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yd.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function teamsSelectChannel(id, name) {
  _teamsCurrentChannel = { id: id, name: name };
  _teamsLastMsgTs = 0;
  var nameEl = document.getElementById('teams-active-name');
  if (nameEl) nameEl.textContent = name;
  var descEl = document.getElementById('teams-active-desc');
  if (descEl) descEl.textContent = twChMeta(name).desc;
  /* Announcements is broadcast-only for members/viewers */
  var isAnnounce = /announcement/i.test(name || '');
  var canPost = !isAnnounce || window.__myRole === 'admin' || window.__myRole === 'owner';
  var inputEl = document.getElementById('teams-input');
  if (inputEl) {
    inputEl.disabled = !canPost;
    inputEl.placeholder = canPost ? 'Type a message…' : 'Only owners and admins can post here.';
  }
  var composeEl = document.querySelector('#teams-posts-pane .teams-compose');
  if (composeEl) composeEl.classList.toggle('compose-locked', !canPost);
  twSubTab('posts');
  twRenderBrief();
  twRenderFocusBar();
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

    var mySub = window.__userSub || '';
    var isMine = msg.authorSub === mySub;

    var row = document.createElement('div');
    row.className = 'teams-msg-row' + (isMine ? ' mine' : '');
    row.dataset.mid    = msg.id || '';
    row.dataset.author = msg.authorSub || '';
    row.dataset.ts     = ts;

    /* Teams-style: own messages align right with no avatar or name */
    var avatarPart = isMine ? '' : (grouped
      ? '<div class="teams-msg-avatar-spacer"></div>'
      : '<div class="teams-msg-avatar" style="background:' + twColor(msg.authorSub) + ';">' + twInitials(msg.authorName || '?') + '</div>');

    var metaPart = grouped ? '' : (isMine
      ? '<div class="teams-msg-meta"><span class="teams-msg-time">' + twTimeStr(ts) + '</span></div>'
      : '<div class="teams-msg-meta">' +
          '<span class="teams-msg-author">' + twEsc(twDisplayName(msg.authorSub, msg.authorName)) + '</span>' +
          '<span class="teams-msg-time">' + twTimeStr(ts) + '</span>' +
        '</div>');

    var bodyPart = twMsgBody(msg);
    var rxPart   = twReactionsPart(msg);
    var mid      = twEsc(msg.id || '');

    var canDel = isMine || window.__myRole === 'admin' || window.__myRole === 'owner';
    row.innerHTML = avatarPart +
      '<div class="teams-msg-body">' + metaPart + bodyPart + rxPart + '</div>' +
      '<button class="teams-msg-react-btn" onclick="teamsReactPicker(\'' + mid + '\')" title="React">☺</button>' +
      (canDel ? '<button class="teams-msg-del-btn" onclick="twMsgDelete(\'' + mid + '\')" title="Delete message">✕</button>' : '');

    container.appendChild(row);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function twMsgBody(msg) {
  if (msg.type === 'lead' && msg.payload) {
    var lead = msg.payload;
    /* the auto-generated "Shared lead: X" line duplicates the card title —
       only show message text when the user wrote something custom */
    var txt = String(msg.content || '');
    var isAuto = txt.indexOf('Shared lead:') === 0;
    return (isAuto ? '' : '<div class="teams-msg-text">' + twEsc(txt) + '</div>') + twLeadCard(lead);
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
  return '<div class="teams-msg-text">' + twHighlightMentions(twLinkify(twEsc(msg.content || ''))) + '</div>';
}

/* Wrap @Name for every roster member in a highlight span */
function twHighlightMentions(html) {
  var members = (window.__teamDoc && window.__teamDoc.members) || [];
  members.forEach(function(m) {
    var nm = String(m.name || '').trim();
    if (nm && nm.indexOf('@') !== -1) nm = nm.split('@')[0];
    if (!nm) return;
    var esc = twEsc(nm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('@' + esc, 'g'), '<span class="tw-mention">@' + twEsc(nm) + '</span>');
  });
  return html;
}

function twReactionsPart(msg) {
  var rxs  = msg.reactions || {};
  var mine = msg.myReactions || [];
  var keys = Object.keys(rxs).filter(function(k) { return rxs[k] > 0; });
  if (!keys.length) return '';
  var mid = twEsc(msg.id || '');
  /* restrained: top 4 pills by count, rest collapsed behind +N */
  keys.sort(function(a, b) { return rxs[b] - rxs[a]; });
  var shown = keys.slice(0, 4);
  var hidden = keys.length - shown.length;
  var hiddenTotal = 0;
  keys.slice(4).forEach(function(k) { hiddenTotal += rxs[k]; });
  return '<div class="teams-reactions">' + shown.map(function(emoji) {
    var isMine = mine.indexOf(emoji) !== -1;
    return '<span class="teams-reaction' + (isMine ? ' mine' : '') + '" onclick="teamsReact(\'' + mid + '\',\'' + twEsc(emoji) + '\')">' +
      emoji + '<span class="teams-reaction-count">' + rxs[emoji] + '</span></span>';
  }).join('') +
  (hidden > 0 ? '<span class="teams-reaction" title="' + hidden + ' more reaction type' + (hidden === 1 ? '' : 's') + '">+' + hiddenTotal + '</span>' : '') +
  '</div>';
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

  /* collect mentions still present in the sent text */
  var mentions = [];
  var membersM = (window.__teamDoc && window.__teamDoc.members) || [];
  membersM.forEach(function(m) {
    var nm = String(m.name || '').trim();
    if (nm.indexOf('@') !== -1) nm = nm.split('@')[0];
    if (nm && m.sub && text.indexOf('@' + nm) !== -1) mentions.push(m.sub);
  });

  var r = await twFetch('POST', '/team/messages/send', {
    channelId: _teamsCurrentChannel.id, content: text, type: 'text', mentions: mentions
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

/* ── Typing indicator (iMessage-style) ─────────────────────────────────────── */
var _twTypingLastPing = 0;

function twTypingPing() {
  if (!_teamsCurrentChannel) return;
  var now = Date.now();
  if (now - _twTypingLastPing < 4000) return;
  _twTypingLastPing = now;
  twFetch('POST', '/team/typing', { channelId: _teamsCurrentChannel.id });
}
window.twTypingPing = twTypingPing;

function twRenderTyping(names) {
  var container = document.getElementById('teams-messages');
  if (!container) return;
  var row = document.getElementById('tw-typing-row');
  if (!names || !names.length) {
    if (row) row.remove();
    return;
  }
  var label = names.length === 1 ? names[0] + ' is typing'
    : names.length === 2 ? names[0] + ' and ' + names[1] + ' are typing'
    : 'Several people are typing';
  var html = '<div class="tw-typing-name">' + escDash(label) + '</div>' +
    '<div class="tw-typing-bubble"><span class="tw-typing-dot"></span><span class="tw-typing-dot"></span><span class="tw-typing-dot"></span></div>';
  var nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  if (!row) {
    row = document.createElement('div');
    row.id = 'tw-typing-row';
    row.className = 'tw-typing-row';
    container.appendChild(row);
  } else if (row !== container.lastElementChild) {
    container.appendChild(row); // keep the bubble below the newest message
  }
  row.innerHTML = html;
  if (nearBottom) teamsScrollBottom();
}

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
    twRenderTyping((r.data && r.data.typing) || []);
  }
  // Refresh channel badges + presence + sidebar nav badge
  var cr = await twFetch('GET', '/team/channels');
  if (cr && cr.status === 200) {
    var channels = (cr.data && cr.data.channels) || [];
    _teamsChannels = channels;
    window.__twPresence = (cr.data && cr.data.presence) || {};
    teamsRenderChannels(channels);
    teamsRenderInfoMembers();
    twNavBadge(channels);
  }
  // Mention notifications (throttled to ~every 3rd poll)
  _twMentionTick = (_twMentionTick || 0) + 1;
  if (_twMentionTick % 3 === 1) {
    var mr = await twFetch('GET', '/team/mentions');
    if (mr && mr.status === 200) {
      window.__twMentions = (mr.data && mr.data.mentions) || [];
      if (typeof buildNotifList === 'function') buildNotifList();
    }
  }
}
var _twMentionTick = 0;

/* Aggregate unread count on the sidebar Team nav item */
function twNavBadge(channels) {
  var total = 0;
  (channels || []).forEach(function(c) { total += c.unread || 0; });
  var nav = document.querySelector('.nav-item[data-page="team"]');
  if (!nav) return;
  var badge = nav.querySelector('.nav-badge');
  if (total > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      nav.appendChild(badge);
    }
    badge.textContent = Math.min(total, 99);
  } else if (badge) {
    badge.remove();
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

/* Channel Overview toggle — default open on desktop, closed on narrow.
   The info button and the panel's X both flip it; the center expands. */
var _briefOpen = null;

function twApplyBrief() {
  var sec = document.getElementById('teams-section-chat');
  if (!sec) return;
  if (_briefOpen === null) _briefOpen = window.innerWidth > 1180;
  sec.classList.toggle('brief-closed', !_briefOpen);
  sec.classList.toggle('brief-open', _briefOpen);
}

function teamsToggleInfo() {
  if (_briefOpen === null) _briefOpen = window.innerWidth > 1180;
  _briefOpen = !_briefOpen;
  twApplyBrief();
}
window.teamsToggleInfo = teamsToggleInfo;

function teamsRenderInfoMembers() {
  var el = document.getElementById('teams-info-members');
  if (!el) return;
  var doc     = window.__teamDoc;
  var members = doc && doc.members ? doc.members : [];
  var countEl = document.getElementById('teams-ch-member-count');
  if (countEl) countEl.textContent = members.length + ' member' + (members.length === 1 ? '' : 's');
  var avsEl = document.getElementById('teams-hdr-avatars');
  if (avsEl && typeof avatarHtml === 'function') {
    avsEl.innerHTML = members.slice(0, 4).map(function(m) {
      var nm = String(m.name || m.email || '?');
      if (nm.indexOf('@') !== -1) nm = nm.split('@')[0];
      return avatarHtml(nm, 'width:22px;height:22px;font-size:9px;flex-shrink:0;');
    }).join('') + (members.length > 4 ? '<span style="font-size:10px;color:var(--text-m);margin-left:4px;">+' + (members.length - 4) + '</span>' : '');
  }
  if (!members.length) {
    el.innerHTML = '<div class="teams-empty-note" style="padding:12px 14px;">No members yet</div>';
    return;
  }
  var presence = window.__twPresence || {};
  var pCut = Date.now() - 5 * 60 * 1000;
  el.innerHTML = members.map(function(m) {
    var nm = String(m.name || m.email || 'Member');
    if (nm.indexOf('@') !== -1) nm = nm.split('@')[0];
    var av = (typeof avatarHtml === 'function') ? avatarHtml(nm, 'width:28px;height:28px;font-size:11px;flex-shrink:0;') : '';
    var online = m.sub && presence[m.sub] && presence[m.sub] > pCut;
    return '<div class="teams-info-member">' +
      '<div class="teams-presence' + (online ? ' online' : '') + '"></div>' +
      av +
      '<div><div class="teams-info-member-name">' + twEsc(nm) + '</div>' +
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

// ── Overview "Team Chat" widget ───────────────────────────────────────────────

async function ovTeamWidgetRefresh() {
  var el = document.getElementById('ov-team-list');
  if (!el) return;
  var card = document.getElementById('card-team');
  if (card && card.style.display === 'none') return;
  var r = await twFetch('GET', '/team/channels');
  var channels = (r && r.status === 200 && r.data && r.data.channels) || [];
  if (!channels.length) {
    el.innerHTML = '<div class="empty-state" style="padding:26px 18px;"><i data-lucide="message-square"></i>' +
      '<div class="empty-state-title">No channels yet</div>' +
      '<div class="empty-state-sub">Open the Team page to start chatting.</div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  el.innerHTML = channels.slice(0, 4).map(function(c) {
    var unread = c.unreadCount || 0;
    var preview = c.lastMessage
      ? twEsc(String(c.lastMessage).slice(0, 48))
      : 'No messages yet';
    return '<div class="ovt-row" onclick="showPage(\'team\')">' +
      '<div class="ovt-hash">#</div>' +
      '<div class="ovt-body">' +
        '<div class="ovt-name">' + twEsc(c.name) + '</div>' +
        '<div class="ovt-preview">' + preview + '</div>' +
      '</div>' +
      (unread > 0 ? '<span class="ovt-unread">' + unread + '</span>' : '') +
    '</div>';
  }).join('');
}
window.ovTeamWidgetRefresh = ovTeamWidgetRefresh;

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

// ═══ Team Workspace v5 — channel meta, sub-tabs, lead cards, pins, tasks, brief ═══

var TW_CH_META = {
  'general':       { icon: 'building-2',     desc: 'Company-wide updates' },
  'lead handoffs': { icon: 'users',          desc: 'Ownership and next steps' },
  'leads':         { icon: 'users',          desc: 'Lead discussion and handoffs' },
  'follow-ups':    { icon: 'clock',          desc: 'Due this week' },
  'bookings':      { icon: 'calendar-check', desc: 'Confirmed meetings' },
  'announcements': { icon: 'megaphone',      desc: 'Read-only updates' }
};
function twChMeta(name) {
  return TW_CH_META[String(name || '').toLowerCase()] || { icon: 'message-square', desc: 'Team discussion' };
}

/* Roster display name by sub; falls back to the email prefix so raw
   addresses never render as author names */
function twDisplayName(sub, fallback) {
  var members = (window.__teamDoc && window.__teamDoc.members) || [];
  var m = members.find(function(x) { return x.sub === sub; });
  var n = (m && m.name) || fallback || 'Member';
  if (String(n).indexOf('@') !== -1) n = String(n).split('@')[0];
  return n;
}

// ── Center sub-tabs: Posts / Shared Leads / Tasks ────────────────────────────

var _twSubTab = 'posts';

function twSubTab(name) {
  _twSubTab = name;
  document.querySelectorAll('#teams-subtabs .tw-subtab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-sub') === name);
  });
  var posts = document.getElementById('teams-posts-pane');
  var shared = document.getElementById('teams-shared-pane');
  var tasks = document.getElementById('teams-chtasks-pane');
  /* 'flex', not '' — clearing the inline display would fall back to block
     and break the height chain, pushing the composer off-screen */
  if (posts) posts.style.display = name === 'posts' ? 'flex' : 'none';
  if (shared) shared.style.display = name === 'shared' ? '' : 'none';
  if (tasks) tasks.style.display = name === 'tasks' ? '' : 'none';
  if (name === 'shared') twRenderSharedLeads();
  if (name === 'tasks') twRenderChannelTasks();
  if (name === 'posts') teamsScrollBottom();
}
window.twSubTab = twSubTab;

// ── Shared lead card (used in posts + shared leads pane) ────────────────────

function twLeadLive(id) {
  var contacts = (window.__crmData || {}).contacts || [];
  return contacts.find(function(c) { return String(c.id) === String(id); }) || null;
}

function twLeadCard(lead) {
  var live = lead.id ? twLeadLive(lead.id) : null;
  var status = (live && live.status) || lead.status || '';
  var source = (live && live.source) || lead.source || '';
  var score = (live && typeof leadScore === 'function') ? leadScore(live) : null;
  var lastAct = live && live.lastTouchAt
    ? (typeof relTime === 'function' ? relTime(new Date(live.lastTouchAt).getTime()) : '')
    : 'No recent activity';
  var safeId = twEsc(lead.id || '');
  var safeName = twEsc(lead.name || 'Lead');
  return '<div class="tw-lead-card">' +
    '<div class="tw-lead-head">' +
      '<span class="tw-lead-name">' + safeName + '</span>' +
      (status ? twStatusBadge(status) : '<span class="tw-lead-dim">Status not set</span>') +
    '</div>' +
    '<div class="tw-lead-fields">' +
      '<div class="tw-lf"><span class="tw-lf-k">Source</span><span class="tw-lf-v">' + (source ? twEsc(source) : 'Not set') + '</span></div>' +
      '<div class="tw-lf"><span class="tw-lf-k">Score</span><span class="tw-lf-v">' + (score != null ? score : 'Unavailable') + '</span></div>' +
      '<div class="tw-lf"><span class="tw-lf-k">Last activity</span><span class="tw-lf-v">' + twEsc(lastAct) + '</span></div>' +
      '<div class="tw-lf"><span class="tw-lf-k">Owner</span><span class="tw-lf-v">Unassigned</span></div>' +
    '</div>' +
    '<div class="tw-lead-acts">' +
      '<button class="btn-mini btn-mini-ghost" onclick="teamsOpenLead(\'' + safeId + '\')">View lead</button>' +
      '<button class="btn-mini btn-mini-ghost" onclick="twPinLead(\'' + safeId + '\',\'' + safeName.replace(/'/g, '') + '\',\'' + twEsc(status) + '\')">Pin</button>' +
      '<button class="btn-mini btn-mini-ghost" onclick="twTaskModalOpen({leadId:\'' + safeId + '\',leadName:\'' + safeName.replace(/'/g, '') + '\'})">Create task</button>' +
    '</div>' +
  '</div>';
}

var _twSharedFilter = 'all';

function twSharedSetFilter(f) {
  _twSharedFilter = f;
  twRenderSharedLeads();
}
window.twSharedSetFilter = twSharedSetFilter;

async function twRenderSharedLeads() {
  var el = document.getElementById('teams-shared-pane');
  if (!el || !_teamsCurrentChannel) return;
  el.innerHTML = '<div class="teams-loading">Loading shared items…</div>';
  var r = await twFetch('GET', '/team/messages?channel=' + encodeURIComponent(_teamsCurrentChannel.id));
  var msgs = (r && r.data && r.data.messages) || [];
  var shared = msgs.filter(function(m) {
    if (!m.payload) return false;
    if (_twSharedFilter === 'all') return m.type === 'lead' || m.type === 'invoice' || m.type === 'report';
    return m.type === _twSharedFilter;
  });

  var chips = '<div class="lt-tabs" style="padding:12px 16px 0;margin-bottom:0;">' +
    [['all', 'All'], ['lead', 'Leads'], ['invoice', 'Invoices'], ['report', 'Reports']].map(function(f) {
      return '<div class="lt-tab' + (_twSharedFilter === f[0] ? ' active' : '') + '" onclick="twSharedSetFilter(\'' + f[0] + '\')">' + f[1] + '</div>';
    }).join('') + '</div>';

  if (!shared.length) {
    el.innerHTML = chips + '<div class="empty-state" style="padding:36px 20px;"><i data-lucide="share-2"></i>' +
      '<div class="empty-state-title">Nothing shared here yet</div>' +
      '<div class="empty-state-sub">Share leads, invoices, and reports from the composer.</div></div>';
  } else {
    var seen = {};
    el.innerHTML = chips + '<div style="padding:12px 16px;">' + shared.slice().reverse().filter(function(m) {
      var k = m.type + ':' + (m.payload.id || m.payload.number || m.payload.title || m.payload.name);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).map(function(m) {
      var body = (m.type === 'lead') ? twLeadCard(m.payload) : twMsgBody(m);
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:10.5px;color:var(--text-m);margin-bottom:4px;">Shared by ' + twEsc(twDisplayName(m.authorSub, m.authorName)) + ' · ' + twDayLabel(m.ts || Date.now()) + '</div>' +
        body + '</div>';
    }).join('') + '</div>';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Pinned leads ─────────────────────────────────────────────────────────────

var _twPins = [];

async function twPinsLoad() {
  var r = await twFetch('GET', '/team/pins');
  _twPins = (r && r.data && r.data.pins) || [];
  twRenderPins();
}

async function twPinLead(id, name, status) {
  if (window.flwWriteBlocked && flwWriteBlocked()) return;
  var r = await twFetch('POST', '/team/pins', { id: id, name: name, status: status });
  if (r && r.status === 200) {
    var wasPinned = _twPins.some(function(p) { return p.id === id; });
    _twPins = (r.data && r.data.pins) || [];
    twRenderPins();
    if (typeof showToast === 'function') showToast(wasPinned ? 'Lead unpinned.' : 'Lead pinned to the workspace.');
  }
}
window.twPinLead = twPinLead;

function twRenderPins() {
  ['teams-pins-side', 'teams-brief-pins'].forEach(function(cid) {
    var el = document.getElementById(cid);
    if (!el) return;
    if (!_twPins.length) {
      el.innerHTML = '<div class="teams-empty-note" style="padding:8px 12px;">No pinned leads yet</div>';
      return;
    }
    el.innerHTML = _twPins.slice(0, 5).map(function(p) {
      return '<div class="tw-pin-row" onclick="teamsOpenLead(\'' + twEsc(p.id) + '\')">' +
        '<span class="tw-pin-name">' + twEsc(p.name) + '</span>' +
        (p.status ? twStatusBadge(p.status) : '') +
      '</div>';
    }).join('');
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────────

var _twTasks = [];
var _twTaskFilter = 'all';

async function twTasksLoad() {
  var r = await twFetch('GET', '/team/tasks');
  _twTasks = (r && r.data && r.data.tasks) || [];
  twTasksRenderAll();
}
window.twTasksLoad = twTasksLoad;

function twTasksRenderAll() {
  twRenderBriefTasks();
  twRenderTasksTab();
  twRenderFocusBar();
  if (_twSubTab === 'tasks') twRenderChannelTasks();
  /* tasks with due dates surface on the Calendar page */
  if (typeof renderCalendar === 'function') renderCalendar();
}

function twTaskDueLabel(t) {
  if (!t.due) return 'No due date';
  var d = new Date(t.due);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var days = Math.floor((t.due - today.getTime()) / 86400000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return 'Due ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function twTaskDueColor(t) {
  if (!t.due || t.status === 'done') return 'var(--text-m)';
  var days = Math.floor((t.due - Date.now()) / 86400000);
  if (days < 0) return 'var(--red)';
  if (days <= 1) return '#d97706';
  return 'var(--text-m)';
}

async function twTaskToggle(id) {
  var t = _twTasks.find(function(x) { return x.id === id; });
  if (!t) return;
  var next = t.status === 'done' ? 'open' : 'done';
  var r = await twFetch('PUT', '/team/tasks', { id: id, status: next });
  if (r && r.status === 200) {
    _twTasks = (r.data && r.data.tasks) || _twTasks;
    twTasksRenderAll();
    if (next === 'done') twFetch('POST', '/team/activity', { text: 'completed task “' + t.title + '”' });
  }
}
window.twTaskToggle = twTaskToggle;

function twTaskModalOpen(opts) {
  if (window.flwWriteBlocked && flwWriteBlocked()) return;
  opts = opts || {};
  var m = document.getElementById('tw-task-modal');
  if (!m) return;
  var titleEl = document.getElementById('twt-title');
  if (titleEl) titleEl.value = opts.leadName ? 'Follow up with ' + opts.leadName : '';
  var leadSel = document.getElementById('twt-lead');
  if (leadSel) {
    var contacts = ((window.__crmData || {}).contacts || []).slice(0, 60);
    leadSel.innerHTML = '<option value="">No linked lead</option>' + contacts.map(function(c) {
      var sel = opts.leadId && String(c.id) === String(opts.leadId) ? ' selected' : '';
      return '<option value="' + twEsc(c.id) + '"' + sel + '>' + twEsc(c.name) + '</option>';
    }).join('');
  }
  var ownerSel = document.getElementById('twt-owner');
  if (ownerSel) {
    var members = (window.__teamDoc && window.__teamDoc.members) || [];
    ownerSel.innerHTML = '<option value="">Unassigned</option>' + members.map(function(mm) {
      return '<option value="' + twEsc(mm.name || mm.email) + '">' + twEsc(mm.name || mm.email) + '</option>';
    }).join('');
  }
  var due = document.getElementById('twt-due');
  if (due) due.value = '';
  var pri = document.getElementById('twt-priority');
  if (pri) pri.value = 'normal';
  m.classList.add('open');
  if (titleEl) titleEl.focus();
}
window.twTaskModalOpen = twTaskModalOpen;

function twTaskModalClose() {
  var m = document.getElementById('tw-task-modal');
  if (m) m.classList.remove('open');
}
window.twTaskModalClose = twTaskModalClose;

async function twTaskSave() {
  var title = ((document.getElementById('twt-title') || {}).value || '').trim();
  if (!title) { if (typeof showToast === 'function') showToast('Give the task a title first.'); return; }
  var leadSel = document.getElementById('twt-lead');
  var leadId = leadSel ? leadSel.value : '';
  var leadName = leadSel && leadSel.selectedIndex > 0 ? leadSel.options[leadSel.selectedIndex].text : null;
  var dueVal = (document.getElementById('twt-due') || {}).value;
  var payload = {
    title: title,
    leadId: leadId || null,
    leadName: leadName,
    owner: (document.getElementById('twt-owner') || {}).value || '',
    due: dueVal ? new Date(dueVal + 'T12:00:00').getTime() : null,
    priority: (document.getElementById('twt-priority') || {}).value || 'normal',
    channelId: _teamsCurrentChannel ? _teamsCurrentChannel.id : null
  };
  var r = await twFetch('POST', '/team/tasks', payload);
  if (r && r.status === 200) {
    _twTasks = (r.data && r.data.tasks) || _twTasks;
    twTaskModalClose();
    twTasksRenderAll();
    twFetch('POST', '/team/activity', { text: 'created task “' + title + '”' + (payload.owner ? ' for ' + payload.owner : '') });
    if (typeof showToast === 'function') showToast('Task created.');
  } else {
    if (typeof showToast === 'function') showToast('Could not create the task — try again.');
  }
}
window.twTaskSave = twTaskSave;

function twTaskRowHtml(t, compact) {
  var done = t.status === 'done';
  return '<div class="tw-task-row' + (done ? ' done' : '') + '">' +
    '<input type="checkbox" class="lt-check" ' + (done ? 'checked' : '') + ' onchange="twTaskToggle(\'' + twEsc(t.id) + '\')" />' +
    '<div class="tw-task-body">' +
      '<div class="tw-task-title">' + twEsc(t.title) + (t.priority === 'high' ? ' <span class="tw-task-pri">High</span>' : '') + '</div>' +
      (compact ? '' : '<div class="tw-task-sub">' +
        (t.leadName ? twEsc(t.leadName) + ' · ' : '') +
        (t.owner ? twEsc(t.owner) : 'Unassigned') + '</div>') +
    '</div>' +
    '<span class="tw-task-due" style="color:' + twTaskDueColor(t) + ';">' + twTaskDueLabel(t) + '</span>' +
    (t.leadId ? '<button class="row-act" title="View lead" onclick="teamsOpenLead(\'' + twEsc(t.leadId) + '\')"><i data-lucide="eye"></i></button>' : '') +
  '</div>';
}

function twRenderChannelTasks() {
  var el = document.getElementById('teams-chtasks-pane');
  if (!el) return;
  var chId = _teamsCurrentChannel ? _teamsCurrentChannel.id : null;
  var tasks = _twTasks.filter(function(t) { return t.channelId === chId; });
  var h = '<div style="padding:12px 16px;">' +
    '<button class="btn-mini btn-mini-primary" style="margin-bottom:12px;" onclick="twTaskModalOpen()">New task</button>';
  if (!tasks.length) {
    h += '<div class="empty-state" style="padding:30px 16px;"><i data-lucide="check-square"></i>' +
      '<div class="empty-state-title">No tasks in this channel</div>' +
      '<div class="empty-state-sub">Create a task from the composer or a shared lead card.</div></div>';
  } else {
    h += tasks.map(function(t) { return twTaskRowHtml(t, false); }).join('');
  }
  el.innerHTML = h + '</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function twTasksSetFilter(f) {
  _twTaskFilter = f;
  document.querySelectorAll('#tw-task-filters .lt-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === f);
  });
  twRenderTasksTab();
}
window.twTasksSetFilter = twTasksSetFilter;

function twRenderTasksTab() {
  var tbody = document.getElementById('tw-tasks-tbody');
  if (!tbody) return;
  var mySub = window.__userSub || '';
  var me = '';
  try {
    var members = (window.__teamDoc && window.__teamDoc.members) || [];
    var meM = members.find(function(m) { return m.sub === mySub; });
    me = meM ? (meM.name || meM.email) : '';
  } catch (e) {}
  var soon = Date.now() + 72 * 3600000;
  var shown = _twTasks.filter(function(t) {
    if (_twTaskFilter === 'mine') return me && t.owner === me;
    if (_twTaskFilter === 'due') return t.status === 'open' && t.due && t.due <= soon;
    if (_twTaskFilter === 'done') return t.status === 'done';
    return true;
  });
  var cnt = document.getElementById('tw-tasks-count');
  if (cnt) cnt.textContent = shown.length + ' task' + (shown.length === 1 ? '' : 's');
  if (!shown.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:36px 20px;"><i data-lucide="check-square"></i>' +
      '<div class="empty-state-title">' + (_twTaskFilter === 'done' ? 'Nothing completed yet' : 'No tasks here') + '</div>' +
      '<div class="empty-state-sub">Create a task to assign follow-up work to your team.</div></div></td></tr>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }
  tbody.innerHTML = shown.map(function(t) {
    var done = t.status === 'done';
    return '<tr class="' + (done ? 'tw-tr-done' : '') + '">' +
      '<td style="width:34px;"><input type="checkbox" class="lt-check" ' + (done ? 'checked' : '') + ' onchange="twTaskToggle(\'' + twEsc(t.id) + '\')" /></td>' +
      '<td style="font-size:12.5px;font-weight:600;color:var(--text);">' + twEsc(t.title) + '</td>' +
      '<td style="font-size:12px;">' + (t.leadName ? '<span class="sec-link" onclick="teamsOpenLead(\'' + twEsc(t.leadId || '') + '\')">' + twEsc(t.leadName) + '</span>' : '<span style="color:var(--text-m);">None</span>') + '</td>' +
      '<td style="font-size:12px;">' + (t.owner ? twEsc(t.owner) : '<span style="color:var(--text-m);">Unassigned</span>') + '</td>' +
      '<td style="font-size:11.5px;white-space:nowrap;color:' + twTaskDueColor(t) + ';">' + twTaskDueLabel(t) + '</td>' +
      '<td>' + (done
        ? '<span class="badge b-conn">Done</span>'
        : '<span class="badge b-low">Open</span>') + '</td>' +
      '<td style="font-size:11.5px;">' + (t.priority === 'high' ? '<span style="color:var(--red);font-weight:700;">High</span>' : '<span style="color:var(--text-m);">Normal</span>') + '</td>' +
    '</tr>';
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Channel Brief (right panel) ──────────────────────────────────────────────

function twRenderBrief() {
  var name = _teamsCurrentChannel ? _teamsCurrentChannel.name : 'General';
  var meta = twChMeta(name);
  var t = document.getElementById('teams-brief-chname');
  if (t) t.textContent = name;
  var d = document.getElementById('teams-brief-desc');
  if (d) {
    var descMap = {
      'lead handoffs': 'Use this space to discuss lead ownership, follow-ups, and handoffs between teammates.',
      'general': 'Company-wide updates and team-wide coordination.',
      'follow-ups': 'Track and discuss follow-up work due this week.',
      'bookings': 'Coordinate confirmed meetings and appointments.',
      'announcements': 'Read-only updates from workspace owners.'
    };
    d.textContent = descMap[String(name).toLowerCase()] || 'Team discussion for ' + name + '.';
  }
  var i = document.getElementById('teams-brief-icon');
  if (i) i.innerHTML = '<i data-lucide="' + meta.icon + '"></i>';
  twRenderBriefTasks();
  twRenderPins();
  teamsRenderInfoMembers();
  twRenderBriefActivity();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function twRenderBriefTasks() {
  var el = document.getElementById('teams-brief-tasks');
  if (!el) return;
  var open = _twTasks.filter(function(t) { return t.status === 'open'; }).slice(0, 3);
  var cnt = document.getElementById('teams-brief-tasks-count');
  var totalOpen = _twTasks.filter(function(t) { return t.status === 'open'; }).length;
  if (cnt) cnt.textContent = '(' + totalOpen + ')';
  if (!open.length) {
    el.innerHTML = '<div class="teams-empty-note" style="padding:8px 12px;">No open tasks — nice work.</div>';
    return;
  }
  el.innerHTML = open.map(function(t) { return twTaskRowHtml(t, true); }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function twRenderBriefActivity() {
  var el = document.getElementById('teams-brief-activity');
  if (!el) return;
  var r = await twFetch('GET', '/team/activity');
  var log = ((r && r.data && r.data.log) || []).slice(-3).reverse();
  if (!log.length) {
    el.innerHTML = '<div class="teams-empty-note" style="padding:8px 12px;">Collaboration activity shows here.</div>';
    return;
  }
  el.innerHTML = log.map(function(e) {
    var nm = twDisplayName(e.sub, e.name);
    var txt = String(e.text || '');
    /* some log entries already begin with the actor — don't double it */
    var line = txt.indexOf(e.name || '') === 0 && e.name ? nm + txt.slice(String(e.name).length) : nm + ' ' + txt;
    return '<div class="tw-brief-act"><span class="tw-brief-dot"></span>' +
      '<div style="flex:1;min-width:0;"><div class="tw-brief-act-text">' + twEsc(line) + '</div>' +
      '<div class="tw-brief-act-time">' + twTimeStr(e.ts || Date.now()) + '</div></div></div>';
  }).join('');
}

// ── Composer helpers ─────────────────────────────────────────────────────────

function twMention() {
  var ta = document.getElementById('teams-input');
  if (!ta) return;
  ta.value = (ta.value ? ta.value + ' ' : '') + '@';
  ta.focus();
}
window.twMention = twMention;

function twAttachStub() {
  if (typeof showToast === 'function') showToast('File attachments aren’t available yet — share leads, invoices, and reports instead.');
}
window.twAttachStub = twAttachStub;

// ═══ Composer extensions v8 — share pickers, mention menu, delete ═════════════

// ── Attach invoice / report pickers ──────────────────────────────────────────

async function twPickShare(kind) {
  var ov = document.getElementById('tw-share-picker');
  var list = document.getElementById('tw-share-list');
  var title = document.getElementById('tw-share-title');
  if (!ov || !list) return;
  if (!_teamsCurrentChannel) {
    if (typeof showToast === 'function') showToast('Select a channel first.');
    return;
  }
  title.textContent = kind === 'invoice' ? 'Share an invoice' : 'Share a report';
  list.innerHTML = '<div style="padding:20px 16px;text-align:center;font-size:12.5px;color:var(--text-m);">Loading…</div>';
  ov.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  if (kind === 'invoice') {
    var r = await twFetch('GET', '/invoice/list');
    var invoices = (r && r.data && r.data.invoices) || [];
    if (!invoices.length) {
      list.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:12.5px;color:var(--text-m);">No invoices yet — create one on the Invoices page.</div>';
      return;
    }
    window.__twShareInvoices = invoices;
    list.innerHTML = invoices.slice(0, 30).map(function(inv, i) {
      return '<div class="tw-share-row" onclick="twShareInvoicePick(' + i + ')">' +
        '<div style="flex:1;min-width:0;"><div class="tw-share-name">' + twEsc(inv.number || 'Invoice') + ' · ' + twEsc((inv.billTo || {}).name || '') + '</div>' +
        '<div class="tw-share-sub">' + (inv.total != null ? '$' + Number(inv.total).toFixed(2) : '') + (inv.dueDate ? ' · due ' + twEsc(inv.dueDate) : '') + '</div></div>' +
        twStatusBadge((inv.status || 'draft').toUpperCase()) +
      '</div>';
    }).join('');
  } else {
    var reports = [];
    try { reports = JSON.parse(localStorage.getItem('flw_reports_' + (window.__userSub || 'anon')) || '[]'); } catch (e) {}
    if (!reports.length) {
      list.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:12.5px;color:var(--text-m);">No reports yet — generate one on the Reports page.</div>';
      return;
    }
    window.__twShareReports = reports;
    list.innerHTML = reports.slice(0, 30).map(function(rpt, i) {
      var date = rpt.createdAt ? new Date(rpt.createdAt).toLocaleDateString() : (rpt.dateStr || '');
      return '<div class="tw-share-row" onclick="twShareReportPick(' + i + ')">' +
        '<div style="flex:1;min-width:0;"><div class="tw-share-name">' + twEsc(rpt.title || 'Report') + '</div>' +
        '<div class="tw-share-sub">' + twEsc(date) + (rpt.reportFor ? ' · ' + twEsc(rpt.reportFor) : '') + '</div></div>' +
      '</div>';
    }).join('');
  }
}
window.twPickShare = twPickShare;

function twCloseSharePicker() {
  var ov = document.getElementById('tw-share-picker');
  if (ov) ov.classList.remove('open');
}
window.twCloseSharePicker = twCloseSharePicker;

function twShareInvoicePick(i) {
  var inv = (window.__twShareInvoices || [])[i];
  twCloseSharePicker();
  if (inv && typeof teamsShareInvoice === 'function') teamsShareInvoice(inv);
}
window.twShareInvoicePick = twShareInvoicePick;

function twShareReportPick(i) {
  var rpt = (window.__twShareReports || [])[i];
  twCloseSharePicker();
  if (rpt && typeof teamsShareReport === 'function') teamsShareReport(rpt);
}
window.twShareReportPick = twShareReportPick;

// ── Mention picker ────────────────────────────────────────────────────────────

function twMentionMenu() {
  var menu = document.getElementById('tw-mention-menu');
  if (!menu) return;
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  var members = (window.__teamDoc && window.__teamDoc.members) || [];
  if (!members.length) {
    if (typeof showToast === 'function') showToast('No team members to mention yet.');
    return;
  }
  menu.innerHTML = members.map(function(m) {
    var nm = String(m.name || m.email || 'Member');
    if (nm.indexOf('@') !== -1) nm = nm.split('@')[0];
    return '<div class="tw-mention-item" onclick="twMentionPick(\'' + twEsc(nm).replace(/'/g, '') + '\')">' +
      ((typeof avatarHtml === 'function') ? avatarHtml(nm, 'width:22px;height:22px;font-size:9px;flex-shrink:0;') : '') +
      '<span>' + twEsc(nm) + '</span>' +
      '<span style="margin-left:auto;font-size:10px;color:var(--text-m);text-transform:capitalize;">' + twEsc(m.role || 'member') + '</span>' +
    '</div>';
  }).join('');
  menu.classList.add('open');
}
window.twMentionMenu = twMentionMenu;

function twMentionPick(name) {
  var menu = document.getElementById('tw-mention-menu');
  if (menu) menu.classList.remove('open');
  var ta = document.getElementById('teams-input');
  if (!ta) return;
  /* replace a trailing bare '@' (typed trigger) or append */
  if (/@$/.test(ta.value)) ta.value = ta.value.slice(0, -1);
  ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + ' ' : ta.value) + '@' + name + ' ';
  ta.focus();
  teamsAutoResize(ta);
}
window.twMentionPick = twMentionPick;

/* typing '@' opens the picker */
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'teams-input') {
    var v = e.target.value;
    var menu = document.getElementById('tw-mention-menu');
    if (v.slice(-1) === '@' && (v.length === 1 || /\s/.test(v.slice(-2, -1)))) {
      twMentionMenu();
    } else if (menu && menu.classList.contains('open') && v.slice(-1) !== '@') {
      menu.classList.remove('open');
    }
  }
});

// ── Delete message ────────────────────────────────────────────────────────────

async function twMsgDelete(msgId) {
  if (!_teamsCurrentChannel || !msgId) return;
  if (!confirm('Delete this message?')) return;
  var r = await twFetch('POST', '/team/messages/delete', {
    channelId: _teamsCurrentChannel.id, msgId: msgId
  });
  if (r && r.status === 200) {
    var row = document.querySelector('.teams-msg-row[data-mid="' + msgId + '"]');
    if (row) row.remove();
  } else {
    var msg = (r && r.data && r.data.message) || 'Could not delete the message.';
    if (typeof showToast === 'function') showToast(msg);
  }
}
window.twMsgDelete = twMsgDelete;

// ═══ Workspace v9 — focus bar, channel management, calendar task feed ═════════

// ── Focus bar: channel task health at a glance ───────────────────────────────

function twRenderFocusBar() {
  var el = document.getElementById('teams-focus');
  if (!el) return;
  var chId = _teamsCurrentChannel ? _teamsCurrentChannel.id : null;
  var tasks = _twTasks.filter(function(t) { return t.channelId === chId && t.status === 'open'; });
  var now = Date.now();
  var dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  var overdue = 0, dueToday = 0, unassigned = 0;
  tasks.forEach(function(t) {
    if (t.due && t.due < now - 86400000) overdue++;
    else if (t.due && t.due <= dayEnd.getTime()) dueToday++;
    if (!t.owner) unassigned++;
  });
  if (!tasks.length) {
    el.innerHTML = '<span class="tw-focus-label">Focus for this channel</span><span class="tw-focus-ok">All clear — no open tasks.</span>';
    return;
  }
  var parts = [];
  if (overdue) parts.push('<span class="tw-focus-warn">' + overdue + ' overdue</span>');
  if (dueToday) parts.push('<span>' + dueToday + ' due today</span>');
  if (unassigned) parts.push('<span>' + unassigned + ' unassigned</span>');
  if (!parts.length) parts.push('<span>' + tasks.length + ' open task' + (tasks.length === 1 ? '' : 's') + '</span>');
  el.innerHTML = '<span class="tw-focus-label">Focus for this channel</span>' + parts.join('<span class="tw-focus-dot">·</span>');
}
window.twRenderFocusBar = twRenderFocusBar;

// ── Channel manage menu (rename / delete — admins) ───────────────────────────

function twChMenu(e, id, name) {
  e.stopPropagation();
  var m = document.getElementById('tw-ch-menu');
  if (!m) return;
  var protectedCh = /^(general|lead handoffs|leads|follow-ups|bookings|announcements)$/i.test(name || '');
  m.innerHTML =
    '<div class="card-ctx-item" onclick="twChRename(\'' + id + '\',\'' + twEsc(name).replace(/'/g, '') + '\')"><i data-lucide="pencil"></i>Rename channel</div>' +
    (protectedCh
      ? '<div class="card-ctx-item" style="opacity:.45;cursor:default;" title="Default channels cannot be deleted"><i data-lucide="lock"></i>Default channel</div>'
      : '<div class="card-ctx-item ctx-danger" onclick="twChDelete(\'' + id + '\',\'' + twEsc(name).replace(/'/g, '') + '\')"><i data-lucide="trash-2"></i>Delete channel</div>');
  var r = e.currentTarget.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.left = Math.max(8, r.right - 170) + 'px';
  m.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.twChMenu = twChMenu;

document.addEventListener('click', function() {
  var m = document.getElementById('tw-ch-menu');
  if (m) m.classList.remove('open');
});

async function twChRename(id, oldName) {
  var m = document.getElementById('tw-ch-menu');
  if (m) m.classList.remove('open');
  var name = prompt('Rename channel:', oldName);
  if (!name || !name.trim() || name.trim() === oldName) return;
  var r = await twFetch('POST', '/team/channels/update', { id: id, name: name.trim() });
  if (r && r.status === 200) {
    _teamsChannels = (r.data && r.data.channels) || _teamsChannels;
    if (_teamsCurrentChannel && _teamsCurrentChannel.id === id) _teamsCurrentChannel.name = name.trim();
    teamsRenderChannels(_teamsChannels);
    if (typeof showToast === 'function') showToast('Channel renamed.');
  } else {
    if (typeof showToast === 'function') showToast((r && r.data && r.data.message) || (r && r.data && r.data.error) || 'Could not rename the channel.');
  }
}
window.twChRename = twChRename;

async function twChDelete(id, name) {
  var m = document.getElementById('tw-ch-menu');
  if (m) m.classList.remove('open');
  if (!confirm('Delete the "' + name + '" channel? Its messages will be permanently removed.')) return;
  var r = await twFetch('POST', '/team/channels/delete', { id: id });
  if (r && r.status === 200) {
    _teamsChannels = (r.data && r.data.channels) || [];
    teamsRenderChannels(_teamsChannels);
    if (_teamsCurrentChannel && _teamsCurrentChannel.id === id && _teamsChannels[0]) {
      teamsSelectChannel(_teamsChannels[0].id, _teamsChannels[0].name);
    }
    if (typeof showToast === 'function') showToast('Channel deleted.');
  } else {
    if (typeof showToast === 'function') showToast((r && r.data && r.data.message) || 'Could not delete the channel.');
  }
}
window.twChDelete = twChDelete;

// ── Team header block name (business name from settings mirror) ──────────────

function twTeamHeadName() {
  var el = document.getElementById('tw-team-name');
  if (!el) return;
  var name = '';
  try {
    var saved = JSON.parse(localStorage.getItem('flw_settings_' + (window.__userSub || 'anon')) || '{}');
    name = ((saved.biz || {})['s2-biz-name'] || saved.businessName || '').trim();
  } catch (e) {}
  el.textContent = (name || 'Your') + ' Team';
  var av = document.getElementById('tw-team-avatar');
  if (av) av.textContent = (name || 'T').charAt(0).toUpperCase();
}

/* boot: load tasks early so due-dated tasks appear on the Calendar even
   before the Team page is ever opened */
setTimeout(function() { twTasksLoad(); twTeamHeadName(); }, 5000);
