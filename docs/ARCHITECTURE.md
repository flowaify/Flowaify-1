# Flowaify Architecture

Last verified: 2026-07-16. Stack: vanilla JS SPA · Cloudflare Worker + KV · Workers AI ·
Auth0 (SPA SDK v2) · Zoho CRM as system of record · Gmail API for outbound email.

## Big picture

```
Browser (flowaify.app, GitHub Pages)
  app.html  ──▶ js/* modules ──▶ Worker (flowaify-crm-proxy.…workers.dev)
                                   ├── Zoho CRM  (leads/deals, per-client creds)
                                   ├── TEAM_KV   (all platform data, key map below)
                                   ├── Workers AI (Flowy chat + report narratives)
                                   ├── Gmail API  (send-as-user via stored OAuth)
                                   └── Auth0 Mgmt API (team user provisioning)
  invoice.html / report.html — public, token-gated, no auth, sanitized payloads
```

## Auth (all verified live)

- Auth0 SPA app, OIDC-conformant, **refresh-token rotation ON** (30d absolute/15d idle),
  SDK: `useRefreshTokens + useRefreshTokensFallback + cacheLocation:'localstorage'`.
- `getIdTokenClaims` is shimmed in app.html: silently refreshes before every API call;
  redirects to login only on genuine `login_required`.
- Remember-me: `flw_remember` in localStorage → portal auto-runs loginWithRedirect
  (90s loop guard); explicit sign-outs clear it (`?lo=1` suppresses auto-login).
- Worker validates the Auth0 ID token JWT on every request; workspace (clientId) comes
  from the `https://flowaify.app/clientId` custom claim (set by an Auth0 post-login
  Action from `app_metadata.clientId`).
- Roles: viewer < member < admin < owner — resolved from the team roster in KV,
  enforced Worker-side on every write route.

## Pages → modules

| Dashboard page | Module | Notes |
|---|---|---|
| Overview | js/dashboard.js | customizable widget engine (OV_*), KPIs, charts |
| Leads / Activity / Calendar | js/dashboard.js | write-back via /update |
| Automations | js/settings.js | control center; toggles are KV-backed config |
| Team | js/team.js | chat (4s adaptive poll), tasks, provisioning, typing |
| Inbox | js/inbox.js | Gmail OAuth (tokens in KV per user) |
| Invoices | js/invoice.js | v2 store, INV-###### numbering, payments/receipts |
| Reports | js/reports.js | snapshot engine, AI narrative, doc renderer |
| Analytics | js/analytics.js | AN_* widget grid |
| Settings | js/settings.js | mirrors KV config; billing/seller details |
| Flowy rail | js/flowy.js | streams /ai; intents can drive pages |

## Worker route map (worker/index.js)

- `/data` GET, `/update` POST — Zoho read/write (creds: KV `tenant:{ID}:zoho` first, env fallback)
- `/settings` GET/PUT — per-workspace config (sanitizeSettings whitelist; locked fields)
- `/team*` — roster/channels/messages (+ `/team/post`, `/team/pulse`: **ad-blocker-safe
  aliases** for send/typing; filter lists block 'messages/send' and 'typing' patterns)
- `/invoice/*` — list/save/finalize/sent/payment/refund/void/token/email/delete
- `/report/*` — generate/list/get/update/retry/delete/migrate/token/email
- `/rules/*` — INTERNAL ONLY automation rule engine (clients never see a builder;
  Flowaify configures rules pre-handoff)
- `/pub/invoice?t=` `/pub/report?t=` — public, 48-hex tokens, sanitized projections
- `/ai` — Flowy (Workers AI, streamed)
- `/inbox/*` — Gmail OAuth + threads + send
- `/admin/errors` GET (owner) — error ring buffer
- cron `17 9 * * *` — nightly KV backups (`bak:{date}:{key}`, 14-day TTL)

## KV key map (namespace: flowaify-team)

```
settings:{ID}            workspace config          invoices:{ID}   invoice store v2
team:{ID} (+ :channels,  roster / chat / tasks     rptidx:{ID}     report index
  :ch:{ch}:msgs, :read:*, :typing)                 rpt:{ID}:{id}   full report record
rules:{ID} rulestate rul eruns                     invtok:/rpttok:{token}  public links
tenant:{ID}:zoho         Zoho creds (zero-deploy   inbox:{sub}:*   Gmail OAuth tokens
                         onboarding)               flowy:{ID}:{sub} chat memory
errs:{ID}                error ring (cap 50)       bak:{date}:{key} nightly backups
```

## Frontend conventions

- Modules are classic scripts sharing globals; load order in app.html matters
  (dashboard.js first → team → settings → analytics → invoice → reports → flowy → inbox).
- Shared helpers: `invModal/invConfirm` (dialogs), `showToast`, `relTime`, `escDash`,
  `avatarHtml`. Theme via CSS custom properties; light+dark both required; **no new
  color tokens** without design approval.
- Chat/typing latency = polling (4s on Team page, 12s background). A future
  websocket/Durable-Object upgrade slots in behind the same render functions.
