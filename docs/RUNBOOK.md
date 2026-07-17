# Flowaify Runbook

## Deploying frontend

1. Edit files. If you changed a `pages/` module, bump its `?v=` in every HTML that loads it.
2. Bump BOTH `version.json` `build` and `FLW_BUILD` in app.html (same number,
   format `2026MMDDN`) — this triggers the in-app "new version available" banner.
3. `git push origin main` → GitHub Pages serves in ~1 minute.

## Deploying the API

```bash
cd worker && npx wrangler deploy
```
Routes, cron trigger, and the (pending) api.flowaify.app custom domain are in
`worker/wrangler.toml`. KV namespace id: `d3aae082c21d42a68da4817e3bd7be7c`.

## Onboarding a new client (zero-deploy)

1. Auth0 → create the user(s); set `app_metadata.clientId = "<CLIENTID>"`.
2. Get the client's Zoho refresh token, then:
   ```bash
   npx wrangler kv key put "tenant:<CLIENTID>:zoho" \
     '{"refreshToken":"...","datacenter":"https://www.zohoapis.com"}' \
     --namespace-id d3aae082c21d42a68da4817e3bd7be7c --remote
   ```
3. Seed `settings:<CLIENTID>` (or let defaults apply on first save).
4. Configure their automation rules via the internal `/rules/*` API (clients have
   no rule builder by design).
5. First login: roster empty → first user resolves as owner; invite the rest from Team.

## Backups & recovery

- Nightly cron copies settings/invoices/report-index/rules/team-roster to
  `bak:{YYYY-MM-DD}:{key}` (14-day TTL). Restore = `kv key get` the backup,
  `kv key put` the original key.

## Debugging

- Per-workspace error log: `GET /admin/errors` with an owner token, or
  `kv key get "errs:<CLIENTID>" --remote`.
- Worker logs: `cd worker && npx wrangler tail`.
- A user's chat POSTs failing with browser "status 0" while GETs work = their
  ad-blocker; flowaify.app whitelist fixes it (permanent fix = api.flowaify.app
  custom domain, pending Porkbun→Cloudflare nameserver move).

## Auth0 admin (Management API)

M2M credentials (in team vault) carry users CRUD + read/update:clients +
read/update:tenant_settings. Session policy: rotation ON, tokens 30d/15d idle,
tenant sessions 720h absolute / 72h idle (plan max).
