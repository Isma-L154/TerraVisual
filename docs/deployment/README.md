# Deployment

The artifact is a static directory plus a Worker that serves it and sets the
security headers. There is no application backend
([ADR-0001](../adr/0001-client-only-architecture.md)), and
[ADR-0006](../adr/0006-hosting-cloudflare-workers.md) explains why Workers was
chosen over flat static hosting: **the security headers are code, so they can
be asserted against a real response.** Configuration cannot be.

## Where it lives

**https://terravisual.cloudils.com**

A subdomain rather than the apex: `cloudils.com` already serves something else,
and a Worker on the apex would have taken it over. The route is in
`wrangler.jsonc` with `custom_domain: true`, so Cloudflare creates and manages
the DNS record and the certificate — one place rather than half here and half in
a dashboard nobody remembers editing.

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

### Two things the dashboard has to do

**Turn off Web Analytics for this zone.** The first production deployment came
back with Cloudflare's beacon injected into the page — `beacon.min.js` from
`static.cloudflareinsights.com`, added at the edge after the Worker, by a zone
setting no file in this repository can see. The Content Security Policy refused
to run it, so nothing was ever collected, and `scripts/check-headers.mjs` now
fails a deployment that serves it. But a promise of zero telemetry should not
depend on a policy catching an injection every time: *Analytics → Web Analytics*
on the zone, off.

It is worth knowing that Cloudflare only injects it for browser-shaped requests.
A plain `curl` sees a clean page; a browser sees the beacon. That is why the
header check now sends a browser's `User-Agent` and `Accept` — a checker that
looks like a bot verifies nothing about what people receive.

**A spend alert.**

The Worker rate-limits requests per address, generously, which stops the
cheapest kind of abuse (see below). It cannot stop every kind, and a rate limit
is a guard rather than a guarantee. The other half of that guard is a
notification budget — *Manage Account → Billing → Notifications* — so an
unexpected month arrives as an email rather than as an invoice. Nothing in this
repository can create it, and it is the difference between noticing in a day and
noticing in a month.

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

## The rate limit

Configured in `wrangler.jsonc` and applied in `deploy/worker.ts`:
**1000 requests per minute per address**.

That is deliberately far above any person — a page load is about seven requests,
so it allows roughly 140 loads a minute from a single address, and a classroom
sharing one NAT address is nowhere near it. A limit that catches real users
would be worse than no limit here, because nothing served is private: what
flooding this site costs is billed requests and, at volume, availability for
everybody else.

It **fails open**. If the binding is missing or the limiter errors, requests are
served. A static site that goes down because its rate limiter had a bad day has
turned a billing safeguard into an outage.

Proven by being tripped rather than by being configured — with the limit
temporarily lowered to five:

```
$ for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " http://localhost:8792/; done
200 200 200 200 200 429 429 429 429 429 429 429

$ curl -si http://localhost:8792/ | head -3
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: text/plain; charset=utf-8
```

The refusal carries the full set of security headers, because the one response
on the site without a Content Security Policy would be a strange thing to leave
lying around.

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
