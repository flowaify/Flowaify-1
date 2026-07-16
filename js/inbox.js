// inbox.js — Flowaify Inbox page
var _iw = 'https://flowaify-crm-proxy.black-glitter-c4cd.workers.dev';
var _inboxPollingId = null;
var _inboxConnected = false;
var _inboxProvider  = null;
var _inboxCurrentFolder = 'INBOX';
var _inboxCurrentThread = null;
var _inboxSearchTimer   = null;

// ─── init ─────────────────────────────────────────────────────────────────────

function inboxInit() {
  if (_inboxPollingId) { clearInterval(_inboxPollingId); _inboxPollingId = null; }
  inboxShowMain();
  inboxRenderStaticFolders();
  var list = document.getElementById('inbox-thread-list');
  if (list) list.innerHTML = inboxEmptyFolderState();
  var vp = document.getElementById('inbox-view-pane');
  if (vp) { vp.innerHTML = inboxEmptyThread(); vp.classList.remove('open'); }
  lucide.createIcons();
}
window.inboxInit = inboxInit;

// ─── connect view ─────────────────────────────────────────────────────────────

function inboxShowConnect() {
  var cv = document.getElementById('inbox-connect-view');
  var mv = document.getElementById('inbox-main-view');
  if (cv) cv.style.display = 'flex';
  if (mv) mv.style.display = 'none';
}

function inboxShowMain() {
  var cv = document.getElementById('inbox-connect-view');
  var mv = document.getElementById('inbox-main-view');
  if (cv) cv.style.display = 'none';
  if (mv) mv.style.display = 'flex';
}

async function inboxConnect(provider) {
  if (provider === 'outlook') { showToast('Outlook integration coming soon.'); return; }
  var btn = document.getElementById('inbox-connect-gmail-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    var r = await inboxFetch('GET', '/inbox/auth?provider=gmail');
    if (r.url) { window.location.href = r.url; return; }
    if (r.error) { showToast(r.error); }
  } catch(e) { showToast('Could not start Gmail connection. Please try again.'); }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="mail"></i>Connect Gmail'; lucide.createIcons(); }
}
window.inboxConnect = inboxConnect;

async function inboxDisconnect() {
  if (!confirm('Disconnect your email account? You can reconnect at any time.')) return;
  try { await inboxFetch('POST', '/inbox/disconnect'); } catch(e) {}
  _inboxConnected = false; _inboxProvider = null;
  if (_inboxPollingId) { clearInterval(_inboxPollingId); _inboxPollingId = null; }
  inboxShowConnect();
  showToast('Email disconnected.');
}
window.inboxDisconnect = inboxDisconnect;

// ─── folders ──────────────────────────────────────────────────────────────────

async function inboxLoadFolders() {
  try {
    var r = await inboxFetch('GET', '/inbox/folders');
    renderFolderList(r.folders || []);
  } catch(e) {
    var el = document.getElementById('inbox-folder-list');
    if (el) el.innerHTML = '<div style="padding:14px;font-size:11.5px;color:var(--text-m);">Could not load folders</div>';
  }
}

var _inboxFolderData = [];

var INBOX_STATIC_FOLDERS = [
  { id: 'INBOX',   name: 'Inbox',   icon: 'inbox' },
  { id: 'STARRED', name: 'Starred', icon: 'star' },
  { id: 'DRAFT',   name: 'Drafts',  icon: 'file' },
  { id: 'SENT',    name: 'Sent',    icon: 'send-horizontal' },
  { id: 'SPAM',    name: 'Spam',    icon: 'shield-off' },
  { id: 'TRASH',   name: 'Trash',   icon: 'trash-2' },
];

function inboxRenderStaticFolders() {
  var html = '';
  INBOX_STATIC_FOLDERS.forEach(function(f) {
    var act = f.id === _inboxCurrentFolder ? ' active' : '';
    html += '<div class="inbox-folder-item' + act + '" onclick="inboxSelectFolder(\'' + f.id + '\')">' +
      '<i data-lucide="' + f.icon + '"></i><span>' + f.name + '</span></div>';
  });
  html += '<div class="inbox-folder-sep"></div>';
  var la = _inboxCurrentFolder === 'LEAD_THREADS' ? ' active' : '';
  html += '<div class="inbox-folder-item' + la + '" onclick="inboxSelectFolder(\'LEAD_THREADS\')">' +
    '<i data-lucide="users-round"></i><span>Lead Threads</span></div>';
  var el = document.getElementById('inbox-folder-list');
  if (el) { el.innerHTML = html; lucide.createIcons(); }
}

function inboxEmptyFolderState() {
  return '<div class="empty-state" style="padding:40px 16px;">' +
    '<i data-lucide="mail"></i>' +
    '<div class="empty-state-title">Select a folder</div>' +
    '<div class="empty-state-sub">Choose a folder on the left to view messages.</div></div>';
}

function renderFolderList(folders) {
  if (folders.length) _inboxFolderData = folders;
  var use = _inboxFolderData;
  var labelMap = { 'INBOX':'Inbox','SENT':'Sent','DRAFT':'Drafts','DRAFTS':'Drafts','STARRED':'Starred','SPAM':'Spam','TRASH':'Trash' };
  var iconMap  = { 'INBOX':'inbox','SENT':'send-horizontal','DRAFT':'file','DRAFTS':'file','STARRED':'star','SPAM':'shield-off','TRASH':'trash-2' };
  var order    = ['INBOX','STARRED','DRAFT','DRAFTS','SENT','SPAM','TRASH'];
  var sorted   = use.slice().sort(function(a,b) {
    var ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return (a.name||'').localeCompare(b.name||'');
    if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi;
  });
  var html = '';
  sorted.forEach(function(f) {
    var nm  = labelMap[f.id] || f.name || f.id;
    var ico = iconMap[f.id] || 'folder';
    var act = f.id === _inboxCurrentFolder ? ' active' : '';
    html += '<div class="inbox-folder-item' + act + '" onclick="inboxSelectFolder(\'' + inboxEsc(f.id) + '\')">' +
      '<i data-lucide="' + ico + '"></i><span>' + inboxEscHtml(nm) + '</span></div>';
  });
  html += '<div class="inbox-folder-sep"></div>';
  var la = _inboxCurrentFolder === 'LEAD_THREADS' ? ' active' : '';
  html += '<div class="inbox-folder-item' + la + '" onclick="inboxSelectFolder(\'LEAD_THREADS\')">' +
    '<i data-lucide="users-round"></i><span>Lead Threads</span></div>';
  html += '<div class="inbox-folder-disconnect" onclick="inboxDisconnect()"><i data-lucide="log-out"></i><span>Disconnect</span></div>';
  var el = document.getElementById('inbox-folder-list');
  if (el) { el.innerHTML = html; lucide.createIcons(); }
}

async function inboxSelectFolder(folderId) {
  _inboxCurrentFolder = folderId;
  _inboxCurrentThread = null;
  inboxRenderStaticFolders();
  var vp = document.getElementById('inbox-view-pane');
  if (vp) { vp.innerHTML = inboxEmptyThread(); vp.classList.remove('open'); lucide.createIcons(); }
  if (_inboxConnected) {
    await inboxLoadThreads(folderId);
  } else {
    var list = document.getElementById('inbox-thread-list');
    if (list) {
      list.innerHTML = '<div class="empty-state" style="padding:40px 16px;">' +
        '<i data-lucide="mail"></i>' +
        '<div class="empty-state-title">No messages</div>' +
        '<div class="empty-state-sub">This folder is empty.</div></div>';
      lucide.createIcons();
    }
  }
}
window.inboxSelectFolder = inboxSelectFolder;

// ─── thread list ──────────────────────────────────────────────────────────────

async function inboxLoadThreads(folderId) {
  var list = document.getElementById('inbox-thread-list');
  if (list) list.innerHTML = '<div style="padding:20px 14px;text-align:center;font-size:12px;color:var(--text-m);">Loading…</div>';
  try {
    var apiFolder = folderId === 'LEAD_THREADS' ? 'INBOX' : folderId;
    var r = await inboxFetch('GET', '/inbox/threads?folder=' + encodeURIComponent(apiFolder));
    var threads = r.threads || [];
    if (folderId === 'LEAD_THREADS') {
      var emails = {};
      if (window.__crmData && window.__crmData.contacts) {
        window.__crmData.contacts.forEach(function(c) { if (c.email) emails[c.email.toLowerCase()] = true; });
      }
      threads = threads.filter(function(t) {
        var from = (t.from || '').toLowerCase();
        return Object.keys(emails).some(function(e) { return from.indexOf(e) !== -1; });
      });
    }
    renderThreadList(threads);
  } catch(e) {
    if (list) list.innerHTML = '<div style="padding:20px 14px;text-align:center;font-size:12px;color:var(--text-m);">Could not load messages</div>';
  }
}

function renderThreadList(threads) {
  var list = document.getElementById('inbox-thread-list');
  if (!list) return;
  if (!threads.length) {
    list.innerHTML = '<div class="empty-state" style="padding:40px 16px;">' +
      '<i data-lucide="mail"></i><div class="empty-state-title">No messages</div>' +
      '<div class="empty-state-sub">This folder is empty.</div></div>';
    lucide.createIcons(); return;
  }
  var html = '';
  threads.forEach(function(t) {
    var from    = inboxParseFrom(t.from);
    var date    = inboxFmtDate(t.date);
    var uCls    = t.unread ? ' unread' : '';
    var selCls  = t.id === _inboxCurrentThread ? ' selected' : '';
    var cnt     = t.messageCount > 1 ? ' <span class="itr-count">(' + t.messageCount + ')</span>' : '';
    html += '<div class="inbox-thread-row' + uCls + selCls + '" onclick="inboxSelectThread(\'' + inboxEsc(t.id) + '\')">' +
      '<div class="itr-top"><div class="itr-from">' + inboxEscHtml(from) + cnt + '</div><div class="itr-date">' + inboxEscHtml(date) + '</div></div>' +
      '<div class="itr-subject">' + inboxEscHtml(t.subject || '(no subject)') + '</div>' +
      '<div class="itr-snippet">' + inboxEscHtml((t.snippet || '').slice(0, 90)) + '</div>' +
    '</div>';
  });
  list.innerHTML = html;
}

async function inboxSelectThread(threadId) {
  _inboxCurrentThread = threadId;
  document.querySelectorAll('.inbox-thread-row').forEach(function(el) { el.classList.remove('selected'); });
  document.querySelectorAll('.inbox-thread-row').forEach(function(el) {
    if (el.getAttribute('onclick') && el.getAttribute('onclick').indexOf(threadId) !== -1) el.classList.add('selected');
  });
  var vp = document.getElementById('inbox-view-pane');
  if (vp) { vp.innerHTML = '<div style="padding:40px 16px;text-align:center;font-size:12px;color:var(--text-m);">Loading…</div>'; vp.classList.add('open'); }
  try {
    var r = await inboxFetch('GET', '/inbox/thread/' + threadId);
    renderThreadView(threadId, r.messages || []);
  } catch(e) {
    if (vp) vp.innerHTML = '<div style="padding:40px 16px;text-align:center;font-size:12px;color:var(--text-m);">Could not load thread</div>';
  }
}
window.inboxSelectThread = inboxSelectThread;

function renderThreadView(threadId, messages) {
  var vp = document.getElementById('inbox-view-pane');
  if (!vp || !messages.length) { if (vp) { vp.innerHTML = inboxEmptyThread(); lucide.createIcons(); } return; }
  var subject = inboxEscHtml(messages[0].subject || '(no subject)');
  var html = '<div class="inbox-thread-head">' +
    '<button class="inbox-back-btn cmd-btn" onclick="inboxCloseThread()"><i data-lucide="chevron-left"></i>Back</button>' +
    '<div class="inbox-thread-subject">' + subject + '</div>' +
    '<div class="inbox-thread-acts">' +
      '<button class="cmd-btn" onclick="inboxOpenReply(\'' + inboxEsc(threadId) + '\')"><i data-lucide="reply"></i>Reply</button>' +
      '<button class="cmd-btn" onclick="openCompose({})"><i data-lucide="pen-line"></i>Compose</button>' +
    '</div>' +
  '</div>' +
  '<div class="inbox-messages-list">';
  messages.forEach(function(m) {
    var from = inboxEscHtml(inboxParseFrom(m.from));
    var to   = inboxEscHtml(m.to || '');
    var date = inboxEscHtml(m.date ? new Date(m.date).toLocaleString([], { dateStyle:'medium', timeStyle:'short' }) : '');
    var ini  = inboxEscHtml((inboxParseFrom(m.from) || 'U').charAt(0).toUpperCase());
    var body = inboxRenderBody(m.body || '');
    html += '<div class="inbox-msg-card">' +
      '<div class="inbox-msg-head">' +
        '<div class="inbox-msg-from-wrap">' +
          '<div class="inbox-msg-avatar">' + ini + '</div>' +
          '<div><div class="inbox-msg-from">' + from + '</div><div class="inbox-msg-to">To: ' + to + '</div></div>' +
        '</div>' +
        '<div class="inbox-msg-date">' + date + '</div>' +
      '</div>' +
      '<div class="inbox-msg-body">' + body + '</div>' +
    '</div>';
  });
  html += '</div>' +
    '<div class="inbox-reply-bar" id="inbox-reply-bar" style="display:none;">' +
      '<div class="inbox-reply-head"><span style="font-size:12px;font-weight:600;color:var(--text);">Reply</span>' +
        '<button class="cmd-btn" onclick="inboxCloseReply()" style="margin-left:auto;padding:3px 7px;"><i data-lucide="x"></i></button></div>' +
      '<textarea id="inbox-reply-text" class="inbox-compose-textarea" placeholder="Write a reply…" rows="4"></textarea>' +
      '<div class="inbox-compose-foot">' +
        '<button class="cmd-primary" onclick="inboxSendReply(\'' + inboxEsc(threadId) + '\')"><i data-lucide="send"></i>Send</button>' +
        '<button class="cmd-btn" onclick="inboxCloseReply()">Discard</button>' +
      '</div>' +
    '</div>';
  vp.innerHTML = html;
  lucide.createIcons();
  vp.classList.add('open');
}

function inboxEmptyThread() {
  return '<div class="empty-state" style="flex:1;padding:60px 16px;">' +
    '<i data-lucide="mail-open"></i>' +
    '<div class="empty-state-title">Select a conversation</div>' +
    '<div class="empty-state-sub">Choose a thread on the left to read it here.</div>' +
    '<button class="cmd-primary" style="margin-top:12px;" onclick="openCompose({})"><i data-lucide="pen-line"></i>Compose</button>' +
  '</div>';
}

function inboxCloseThread() {
  var vp = document.getElementById('inbox-view-pane');
  if (vp) vp.classList.remove('open');
  _inboxCurrentThread = null;
}
window.inboxCloseThread = inboxCloseThread;

// ─── reply ────────────────────────────────────────────────────────────────────

function inboxOpenReply(threadId) {
  var bar = document.getElementById('inbox-reply-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  var ta = document.getElementById('inbox-reply-text');
  if (ta) ta.focus();
}
window.inboxOpenReply = inboxOpenReply;

function inboxCloseReply() {
  var bar = document.getElementById('inbox-reply-bar');
  if (bar) bar.style.display = 'none';
}
window.inboxCloseReply = inboxCloseReply;

async function inboxSendReply(threadId) {
  var ta  = document.getElementById('inbox-reply-text');
  if (!ta || !ta.value.trim()) { showToast('Write a message before sending.'); return; }
  var btn = document.querySelector('#inbox-reply-bar .cmd-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    var subjectEl = document.querySelector('.inbox-thread-subject');
    var sub = subjectEl ? 'Re: ' + subjectEl.textContent.replace(/^Re:\s*/i, '') : 'Re:';
    var fromEl = document.querySelector('.inbox-msg-from');
    var to = fromEl ? fromEl.textContent.trim() : '';
    await inboxFetch('POST', '/inbox/send', { to: to, subject: sub, content: ta.value.trim(), threadId: threadId });
    ta.value = '';
    inboxCloseReply();
    showToast('Reply sent.');
    var r = await inboxFetch('GET', '/inbox/thread/' + threadId);
    renderThreadView(threadId, r.messages || []);
  } catch(e) {
    showToast('Failed to send reply.');
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
}
window.inboxSendReply = inboxSendReply;

// ─── compose ──────────────────────────────────────────────────────────────────

function openCompose(opts) {
  opts = opts || {};
  var overlay = document.getElementById('inbox-compose-overlay');
  if (!overlay) return;
  document.getElementById('inbox-compose-to').value      = opts.to      || '';
  document.getElementById('inbox-compose-subject').value = opts.subject || '';
  document.getElementById('inbox-compose-body').value    = opts.body    || '';
  overlay.classList.add('open');
  lucide.createIcons();
  document.getElementById('inbox-compose-to').focus();
  if (!_inboxConnected) {
    showToast('Connect your email first to send messages.');
    overlay.classList.remove('open');
  }
}
window.openCompose = openCompose;

function inboxCloseCompose() {
  var overlay = document.getElementById('inbox-compose-overlay');
  if (overlay) overlay.classList.remove('open');
}
window.inboxCloseCompose = inboxCloseCompose;

async function inboxSendCompose() {
  var to      = document.getElementById('inbox-compose-to').value.trim();
  var subject = document.getElementById('inbox-compose-subject').value.trim();
  var body    = document.getElementById('inbox-compose-body').value.trim();
  if (!to || !subject || !body) { showToast('Fill in all fields before sending.'); return; }
  var btn = document.getElementById('inbox-compose-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await inboxFetch('POST', '/inbox/send', { to: to, subject: subject, content: body });
    inboxCloseCompose();
    showToast('Email sent.');
  } catch(e) {
    showToast('Failed to send email. Check recipient address.');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i>Send'; lucide.createIcons(); }
}
window.inboxSendCompose = inboxSendCompose;

// ─── search ───────────────────────────────────────────────────────────────────

function inboxOnSearch(q) {
  clearTimeout(_inboxSearchTimer);
  if (!q.trim()) { inboxLoadThreads(_inboxCurrentFolder); return; }
  _inboxSearchTimer = setTimeout(async function() {
    var list = document.getElementById('inbox-thread-list');
    if (list) list.innerHTML = '<div style="padding:20px 14px;text-align:center;font-size:12px;color:var(--text-m);">Searching…</div>';
    try {
      var r = await inboxFetch('GET', '/inbox/search?q=' + encodeURIComponent(q));
      renderThreadList(r.threads || []);
    } catch(e) {
      if (list) list.innerHTML = '<div style="padding:14px;font-size:12px;color:var(--text-m);">Search failed</div>';
    }
  }, 400);
}
window.inboxOnSearch = inboxOnSearch;

// ─── polling ──────────────────────────────────────────────────────────────────

async function inboxPoll() {
  try {
    var r = await inboxFetch('GET', '/inbox/unread-count');
    var count = r.count || 0;
    var badge = document.getElementById('inbox-nav-badge');
    if (badge) { badge.textContent = count > 0 ? count : ''; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
  } catch(e) {}
}

// ─── auth fetch ───────────────────────────────────────────────────────────────

async function inboxFetch(method, path, body) {
  var token = '';
  try { token = (await window.__auth0Client.getIdTokenClaims()).__raw; } catch(e) {}
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  var r = await fetch(_iw + path, opts);
  if (!r.ok) { var err = await r.json().catch(function() { return {}; }); throw new Error(err.error || String(r.status)); }
  return r.json();
}

// ─── utilities ────────────────────────────────────────────────────────────────

function inboxParseFrom(from) {
  if (!from) return 'Unknown';
  var m = from.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  if (m) return m[1].trim();
  var at = from.indexOf('@');
  return at !== -1 ? from.slice(0, at) : from;
}

function inboxFmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d   = new Date(dateStr);
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (now.getFullYear() === d.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  } catch(e) { return dateStr.slice(0, 10); }
}

function inboxRenderBody(body) {
  if (!body) return '<span style="color:var(--text-m);font-size:12px;">(empty)</span>';
  var stripped = body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000);
  var esc = stripped.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<pre class="inbox-msg-pre">' + esc + '</pre>';
}

function inboxEsc(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function inboxEscHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
