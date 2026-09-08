# Deployment

The artifact is a static directory plus a Worker that serves it and sets the
security headers. There is no application backend
([ADR-0001](../adr/0001-client-only-architecture.md)), and
[ADR-0006](../adr/0006-hosting-cloudflare-workers.md) explains why Workers was
chosen over flat static hosting: **the security headers are code, so they can
be asserted against a real response.** Configuration cannot be.

## Running it locally

```bash
npm run preview:worker      # builds, then serves through the real Worker
node scripts/check-headers.mjs http://localhost:8787
```

`npm run dev` is faster for day-to-day work, but it does not send the security
headers. Anything to do with CSP has to be checked through the Worker.

## What has to exist before the first deploy

Two repository secrets, and neither can be created from inside CI:

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A scoped API token, **not** a global key. It needs *Workers Scripts: Edit* on the account, and nothing else |
| `CLOUDFLARE_ACCOUNT_ID` | From the Cloudflare dashboard, or `wrangler whoami` |

Optionally `PRODUCTION_URL`, so the header check can run against production
after a deploy as well as against previews.

Create the token at **My Profile → API Tokens → Create Token**, starting from
*Edit Cloudflare Workers* and narrowing it to this account. A global key would
work and should not be used: it can do everything, forever, and it is the
project's only real secret.

Add them under **Settings → Secrets and variables → Actions**.

Until they exist, the deploy workflow skips with a notice instead of failing.
A red X nobody can fix teaches people to ignore red X's.

## How deployment happens

```
pull request  →  wrangler versions upload  →  preview URL, headers verified, URL posted on the PR
merge to main →  wrangler deploy           →  production, headers verified
```

A pull request gets a **versioned preview** rather than taking over the live
site, which is what makes reviewing a change on a real deployment possible
without publishing it.

The header check runs against whichever deployment was just made. It reads the
response, because [the audit baseline](../security/) is explicit that a control
must never be inferred from the configuration that was supposed to produce it.

## A custom domain

`wrangler.jsonc` deploys to the `workers.dev` subdomain by default. To use your
own domain, add a route:

```jsonc
"routes": [{ "pattern": "terravisual.example", "custom_domain": true }]
```

The zone has to be on the same Cloudflare account. After changing this, run the
header check against the custom hostname: a route that resolves elsewhere would
serve the site without the Worker, and therefore without any of its headers.

## What is deliberately absent

- **No environment variables and no secrets in the Worker.** It has nothing to
  authenticate against. If a future change adds one, that is a signal the Worker
  is becoming a backend, and ADR-0001 should be revisited on purpose rather than
  by accident.
- **No CORS headers.** There is no API here to call from elsewhere, and an
  origin allowance nobody needs is one somebody eventually relies on.
- **No analytics beyond Cloudflare's request metrics**, which exist anyway and
  never see the contents of a workspace. Anything finer would mean watching how
  people use a tool we promised runs entirely on their own machine.

## Rolling back

```bash
npx wrangler versions list
npx wrangler rollback [VERSION_ID]
```

Rolling back restores the previous Worker *and* its assets, since a version is
both.
