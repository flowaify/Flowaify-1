// Flowaify CRM Proxy — Cloudflare Worker
// Sits between dashboard.html and Zoho CRM.
// All secrets come from Cloudflare environment variables — never hardcoded.
//
// Expected env vars:
//   AUTH0_DOMAIN         e.g. auth.flowaify.app
//   AUTH0_AUDIENCE       e.g. https://flowaify-crm-proxy.{sub}.workers.dev
//   ZOHO_CLIENT_ID       from api-console.zoho.com
//   ZOHO_CLIENT_SECRET   from api-console.zoho.com
//   REFRESH_TOKEN_{ID}   per-client, e.g. REFRESH_TOKEN_ACME
//   DATACENTER_{ID}      per-client, e.g. DATACENTER_ACME (defaults to https://www.zohoapis.com)

const ALLOWED_ORIGINS = new Set([
  'https://flowaify.app',
  'https://www.flowaify.app',
]);

// Auth0 config — not secrets (already in client-side HTML)
const AUTH0_DOMAIN     = 'auth.flowaify.app';
const AUTH0_CLIENT_ID  = 'tx74Owqn3jVeSaVuxfFHsKloqbPqfAmN';
const AUTH0_TENANT     = 'dev-8qaje37awjk3ptzf.us.auth0.com';

// Module-level caches survive across requests within the same isolate instance.
const jwksCache = { keys: null, fetchedAt: 0 };
const tokenCache = {}; // { [clientId]: { accessToken, expiresAt } }

// ─── Entry point ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : (isLocalDev ? origin : null);

    const corsHeaders = corsOrigin ? {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    } : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return json({ ok: true, service: 'flowaify-crm-proxy' }, 200, corsHeaders);
      }

      if (url.pathname === '/oauth/callback') {
        return handleOAuthCallback(url, corsHeaders);
      }

      if (url.pathname === '/data') {
        return handleData(request, env, corsHeaders);
      }

      return json({ error: 'Not found' }, 404, corsHeaders);

    } catch (err) {
      console.error('Unhandled Worker error:', err.message);
      return json({ error: 'Internal server error' }, 500, corsHeaders);
    }
  },
};

// ─── /oauth/callback ─────────────────────────────────────────────────────────
// Zoho redirects here with ?code=... during OAuth setup.
// Displays the code so you can paste it into the curl command.

function handleOAuthCallback(url, corsHeaders) {
  const code = url.searchParams.get('code');
  if (code) {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0f172a}
h2{color:#0057FF}code{display:block;background:#f0f4ff;border:1px solid #c7d7fe;padding:14px;border-radius:8px;
word-break:break-all;font-size:13px;margin:12px 0}p{color:#475569;line-height:1.6}</style></head><body>
<h2>Authorization Code Received</h2>
<p>Copy this code immediately — it expires in 60 seconds:</p>
<code>${escapeHtml(code)}</code>
<p>Paste it into the <code style="display:inline;background:none;border:none;padding:0;color:#0057FF">curl</code>
command from your setup doc to obtain your <strong>refresh_token</strong>.</p>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html;charset=utf-8' },
    });
  }
  return json({ message: 'OAuth callback endpoint ready. Redirect Zoho OAuth here.' }, 200, corsHeaders);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── /data ───────────────────────────────────────────────────────────────────

async function handleData(request, env, corsHeaders) {
  // 1. Extract bearer token
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing token' }, 401, corsHeaders);
  }
  const token = authHeader.slice(7).trim();

  // 2. Validate JWT (ID token — aud = AUTH0_CLIENT_ID)
  let payload;
  try {
    payload = await verifyJWT(token, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_TENANT);
  } catch (err) {
    console.warn('JWT validation failed:', err.message);
    return json({ error: err.message }, 401, corsHeaders);
  }

  // 3. Resolve clientId — prefer custom claim, fall back to sub-based env var
  //    Env var format: CLIENT_{AUTH0_SUB_SANITIZED} e.g. CLIENT_AUTH0_6A2E630CC822B4846155D262
  let clientId = payload['https://flowaify.app/clientId'];
  if (!clientId && payload.sub) {
    const subKey = 'CLIENT_' + payload.sub.replace(/[^A-Z0-9]/gi, '_').toUpperCase();
    clientId = env[subKey];
  }
  if (!clientId) {
    return json({ error: 'No clientId in token' }, 403, corsHeaders);
  }

  // 4. Resolve per-client Zoho credentials from env vars
  const key = clientId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const refreshToken = env[`REFRESH_TOKEN_${key}`];
  if (!refreshToken) {
    console.error(`Missing env var: REFRESH_TOKEN_${key}`);
    return json({ error: `No Zoho credentials for client: ${clientId}` }, 500, corsHeaders);
  }
  const datacenter = env[`DATACENTER_${key}`] || 'https://www.zohoapis.com';

  // 5. Get Zoho access token (cached 55 min)
  let zohoToken;
  try {
    zohoToken = await getZohoToken(clientId, refreshToken, datacenter, env);
  } catch (err) {
    if (err.message === 'ZOHO_UNAUTHORIZED') {
      return json({ error: 'ZOHO_UNAUTHORIZED' }, 401, corsHeaders);
    }
    console.error('Zoho auth error:', err.message);
    return json({ error: 'Failed to authenticate with CRM' }, 500, corsHeaders);
  }

  // 6. Fetch CRM data in parallel
  let contacts = [];
  let deals = [];
  try {
    [contacts, deals] = await Promise.all([
      fetchContacts(datacenter, zohoToken),
      fetchDeals(datacenter, zohoToken),
    ]);
  } catch (err) {
    if (err.message === 'ZOHO_UNAUTHORIZED') {
      // Token expired mid-request; evict cache
      delete tokenCache[clientId];
      return json({ error: 'ZOHO_UNAUTHORIZED' }, 401, corsHeaders);
    }
    console.error('Zoho fetch error:', err.message);
    return json({ error: 'Failed to fetch CRM data' }, 500, corsHeaders);
  }

  // 7. Shape and return
  return json(shapeResponse(contacts, deals), 200, corsHeaders);
}

// ─── JWT Validation (Web Crypto API — no external deps) ──────────────────────

async function verifyJWT(token, domain, audience, jwksDomain) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const header  = jsonDecodeB64(parts[0]);
  const payload = jsonDecodeB64(parts[1]);

  if (header.alg !== 'RS256') throw new Error('Unsupported JWT algorithm');

  // Fetch JWKS — cached 5 min at module scope
  const nowMs = Date.now();
  if (!jwksCache.keys || nowMs - jwksCache.fetchedAt > 5 * 60 * 1000) {
    const resp = await fetch(`https://${jwksDomain || domain}/.well-known/jwks.json`, {
      cf: { cacheTtl: 300 },
    });
    if (!resp.ok) throw new Error('Failed to fetch JWKS');
    const data = await resp.json();
    jwksCache.keys = data.keys;
    jwksCache.fetchedAt = nowMs;
  }

  const jwkKey = jwksCache.keys.find(k => k.kid === header.kid);
  // Return a generic error so callers cannot enumerate key IDs
  if (!jwkKey) throw new Error('JWT key not found');

  // Import public key and verify signature
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwkKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature    = base64UrlDecode(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signingInput);
  if (!valid) throw new Error('JWT key not found');

  // Validate standard claims
  const nowSecs = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSecs) throw new Error('Token expired');
  if (payload.iss !== `https://${domain}/`) throw new Error('JWT key not found');

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw new Error('JWT key not found');

  return payload;
}

function jsonDecodeB64(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(b64url)));
}

function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// ─── Zoho Token Management ────────────────────────────────────────────────────

function getAccountsUrl(datacenter) {
  if (datacenter.includes('.eu'))     return 'https://accounts.zoho.eu';
  if (datacenter.includes('.com.au')) return 'https://accounts.zoho.com.au';
  if (datacenter.includes('.in'))     return 'https://accounts.zoho.in';
  if (datacenter.includes('.jp'))     return 'https://accounts.zoho.jp';
  return 'https://accounts.zoho.com';
}

async function getZohoToken(clientId, refreshToken, datacenter, env) {
  const cached = tokenCache[clientId];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  const accountsUrl = getAccountsUrl(datacenter);
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
  });

  const resp = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('ZOHO_UNAUTHORIZED');
  }

  const data = await resp.json();
  if (!data.access_token) {
    console.error('Zoho token exchange failed:', JSON.stringify({ error: data.error }));
    throw new Error('ZOHO_UNAUTHORIZED');
  }

  tokenCache[clientId] = {
    accessToken: data.access_token,
    expiresAt:   Date.now() + 55 * 60 * 1000, // 55 min (Zoho tokens live 60 min)
  };
  return data.access_token;
}

// ─── Zoho CRM Fetchers ────────────────────────────────────────────────────────

const CONTACT_FIELDS = [
  'Full_Name', 'Email', 'Phone',
  'Lead_Source',
  'flow_state', 'flow_source',
  'flow_last_touch_type', 'flow_last_touch_at',
  'flow_claude_summary',
  'Created_Time', 'Modified_Time',
].join(',');

const DEAL_FIELDS = [
  'Deal_Name', 'Stage', 'Amount', 'Closing_Date', 'Created_Time',
].join(',');

async function fetchContacts(datacenter, token) {
  const url = `${datacenter}/crm/v2/Contacts` +
    `?fields=${encodeURIComponent(CONTACT_FIELDS)}&per_page=100&sort_by=Created_Time&sort_order=desc`;

  const resp = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });

  if (resp.status === 401) throw new Error('ZOHO_UNAUTHORIZED');
  if (!resp.ok) throw new Error(`Contacts fetch failed: ${resp.status}`);

  const data = await resp.json();
  return data.data || [];
}

async function fetchDeals(datacenter, token) {
  const url = `${datacenter}/crm/v2/Deals` +
    `?fields=${encodeURIComponent(DEAL_FIELDS)}&per_page=100&sort_by=Created_Time&sort_order=desc`;

  const resp = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });

  if (resp.status === 401) throw new Error('ZOHO_UNAUTHORIZED');
  if (!resp.ok) throw new Error(`Deals fetch failed: ${resp.status}`);

  const data = await resp.json();
  return data.data || [];
}

// ─── Data Shaping ─────────────────────────────────────────────────────────────

function shapeContact(c) {
  return {
    id:          c.id,
    name:        c.Full_Name || '—',
    email:       c.Email     || null,
    phone:       c.Phone     || null,
    source:      c.flow_source   || c.Lead_Source || null,
    status:      c.flow_state    || null,
    lastTouch:   c.flow_last_touch_type || null,
    lastTouchAt: c.flow_last_touch_at   || null,
    summary:     c.flow_claude_summary  || null,
    createdAt:   c.Created_Time         || null,
  };
}

function shapeDeal(d) {
  return {
    id:          d.id,
    name:        d.Deal_Name    || '—',
    stage:       d.Stage        || null,
    amount:      d.Amount != null ? Number(d.Amount) : null,
    closingDate: d.Closing_Date || null,
    createdAt:   d.Created_Time || null,
  };
}

function buildMetrics(rawContacts, rawDeals) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const newLeadsToday = rawContacts.filter(c =>
    c.Created_Time && new Date(c.Created_Time).getTime() >= todayMs
  ).length;

  // Response time = seconds between lead creation and first AI touch.
  // Only valid when both timestamps are present and touch comes after creation.
  const responseTimes = rawContacts
    .filter(c => c.Created_Time && c.flow_last_touch_at)
    .map(c => (new Date(c.flow_last_touch_at).getTime() - new Date(c.Created_Time).getTime()) / 1000)
    .filter(t => t > 0 && t < 7 * 86400); // positive and under 7 days

  const avgResponseTimeSecs = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  const activeSequences = rawContacts.filter(c => {
    const s = (c.flow_state || '').toUpperCase();
    return s === 'HOT' || s === 'WARM';
  }).length;

  const bookedCalls = [
    ...rawDeals.filter(d => d.Stage && d.Stage.toLowerCase().includes('booked')),
    ...rawContacts.filter(c => (c.flow_state || '').toUpperCase() === 'BOOKED'),
  ].length;

  const aiRepliesSent = rawContacts.filter(c => {
    const t = (c.flow_last_touch_type || '').toUpperCase();
    return t === 'AI_REPLY' || t.startsWith('AI');
  }).length;

  const pipelineValue = rawDeals.reduce((sum, d) => sum + (Number(d.Amount) || 0), 0);

  return { newLeadsToday, avgResponseTimeSecs, activeSequences, bookedCalls, aiRepliesSent, pipelineValue };
}

function shapeResponse(rawContacts, rawDeals) {
  const contacts = rawContacts.map(shapeContact);
  const deals    = rawDeals.map(shapeDeal);
  const overview = buildMetrics(rawContacts, rawDeals);

  // Contacts that are HOT/WARM but haven't been touched in over 24 hours
  const attentionCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const needsAttention = contacts
    .filter(c => {
      const active = c.status && (c.status.toUpperCase() === 'HOT' || c.status.toUpperCase() === 'WARM');
      const stale  = !c.lastTouchAt || new Date(c.lastTouchAt).getTime() < attentionCutoff;
      return active && stale;
    })
    .slice(0, 10);

  return { overview, contacts, deals, needsAttention };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
