# Flowaify — Client Dashboard & Platform

Live at **https://flowaify.app** (GitHub Pages) · API on Cloudflare Workers + KV · Auth via Auth0.

## What this is

The Flowaify product suite: marketing site, client portal, and the full CRM dashboard
(leads, activity, calendar, automations, team hub with chat, Gmail inbox, invoicing,
reports with AI narratives, analytics, settings). Vanilla JS — **no build step**:
what's in this repo is exactly what ships.

## Repository layout

```
/                     HTML entry points (URLs are load-bearing — do not move)
├── index.html          Marketing/landing page
├── portal.html         Login + client success hub (Auth0 callback URL)
├── app.html            The dashboard SPA (all pages live inside, toggled by showPage)
├── invoice.html        PUBLIC client-facing invoice page (token links in client emails)
├── report.html         PUBLIC shared-report page (token links)
├── 404.html
├── manifest.json, sw.js, favicon.ico, version.json
├── pages/              One folder per dashboard page (module + future page files)
│   ├── dashboard/        Core: boot, CRM data, overview, leads, activity, calendar
│   ├── team/             Team hub: chat, channels, tasks, presence, typing
│   ├── settings/         Settings + automations control center (KV-backed)
│   ├── invoices/         Invoicing (server-truth store, payments, receipts)
│   ├── reports/          Reports (snapshots, AI narrative, documents)
│   ├── analytics/        Analytics widget grid
│   ├── inbox/            Gmail OAuth inbox
│   ├── flowy/            Flowy AI assistant rail (cross-page)
│   └── portal/           Portal-page logic
├── site/               Secondary marketing pages (demo, team, onboarding, changelog, auth0-login)
├── assets/             Images, favicons + assets/data/ (flowyfaq, whatsnew)
├── worker/             Cloudflare Worker (API) + wrangler.toml — see docs/
└── docs/               ARCHITECTURE.md · RUNBOOK.md
```

## Golden rules

1. **Root HTML files never move or rename** — Auth0 callbacks, emailed invoice/report
   links, the service-worker scope, and client bookmarks all point at them.
2. **Authorization headers live only in `js/*.js`**, never inline in HTML (WAF rule).
3. **Every deploy bumps `version.json` + `FLW_BUILD`** in app.html (update banner),
   and any changed JS file's `?v=` query in the HTML that loads it (cache-bust).
4. Money is **integer cents** end-to-end; the Worker recomputes all totals server-side.
5. Completed reports/invoices are **immutable snapshots** — never recompute after the fact.

## Quickstart for developers

- Frontend: edit (page modules live in `pages/<page>/`), then push to `main` — GitHub Pages deploys (~1 min). No compiler.
- API: `cd worker && npx wrangler deploy` (needs Cloudflare auth).
- Full deploy checklist, KV key map, and client onboarding: **docs/RUNBOOK.md**.
- System map (pages → modules → Worker routes → KV): **docs/ARCHITECTURE.md**.
