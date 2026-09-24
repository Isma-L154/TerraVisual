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

The header check also verifies robots.txt, the sitemap and that the local copy
asks not to be indexed; see *Search engines and link previews* below.

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

### Three things the dashboard has to do

**Enable a workers.dev subdomain.** *Workers & Pages → Subdomain.* The site does
not use it — `workers_dev` is off, and one address is enough — but preview URLs
are built on it: with a subdomain, every uploaded version gets
`<version>-terravisual.<subdomain>.workers.dev`, and without one
`wrangler versions upload` produces a version with no address. That is what the
deploy workflow tries to post on each pull request, and it is how a change to
the way the edge serves things gets tested on the real edge before it becomes
the site. Its absence has already cost one improvement: see #69.


**Turn off Web Analytics for this zone.** The first production deployment came
back with Cloudflare's beacon injected into the page — `beacon.min.js` from
`static.cloudflareinsights.com`, added at the edge after the Worker, by a zone
setting no file in this repository can see. The Content Security Policy refused
to run it, so nothing was ever collected. Turning it off (*Analytics → Web
Analytics* on the zone) is still the better state, but it was decided not to
pursue it (#88), so `scripts/check-headers.mjs` tolerates exactly that beacon,
and only while the same response's policy refuses to run it (#100). Any other
third-party script, or a policy that allowed the beacon's host, fails the check.

It is worth knowing that Cloudflare only injects it for browser-shaped requests.
A plain `curl` sees a clean page; a browser sees the beacon. That is why the
header check now sends a browser's `User-Agent` and `Accept` — a checker that
looks like a bot verifies nothing about what people receive.

The edge also adds `Server: cloudflare` to every response, after the Worker,
and no Worker code can remove it. The header check accepts exactly that value,
since it names only the CDN (readable from the IP address anyway), and fails on
anything that says more.

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

## Search engines and link previews

The site is one page, so what search engines and link previews need is small,
and all of it is static files in `web/public/` plus tags in `web/index.html`:

| What | Where | Why |
|---|---|---|
| `robots.txt` | `web/public/` | Allows everything and names the sitemap |
| `sitemap.xml` | `web/public/` | One URL, `https://terravisual.cloudils.com/`. A shared workspace lives in the URL fragment, which crawlers never send, so there are no other pages to list |
| Canonical, title, description | `web/index.html` | The canonical names the one address; title ≤ 60 and description 120–160 characters, which the browser suite enforces |
| Structured data | `web/index.html` | A `WebApplication` JSON-LD block. It is a data block the browser never executes, so the CSP's `script-src` does not apply |
| Open Graph / Twitter tags | `web/index.html` | What a pasted link unfurls into; every URL absolute |
| Icons, manifest, `og-image.png` | `web/public/` | Generated from `favicon.svg` and `web/brand/social-card.html` by `node scripts/make-brand-assets.mjs`. The outputs are committed |

These files must exist as files. The asset server answers any unknown path
with the index page and a 200 (the single-page fallback), so a missing
`robots.txt` or sitemap does not 404; it quietly serves HTML, which Search
Console rejects. The checks therefore look at content types, not status codes.

### Only production is indexable

The Worker sends `X-Robots-Tag: noindex` on every response from a host other
than `terravisual.cloudils.com`, and on HTML at any path but `/`. Preview
versions (`*.workers.dev`) and local runs serve the same page, and indexed they
would compete with the site as duplicates; so would the fallback page served
at made-up paths. `scripts/check-headers.mjs` verifies both directions against
the deployment it is pointed at.

Locally, `wrangler dev` presents every request as the production route's
hostname unless it is started with `--local-upstream`, and then the Worker
would treat a local run as the site. `npm run preview:worker` and the browser
suite both pass it.

### Adding the site to Google Search Console

Nothing in this repository can do these steps; they need the Google account and
the Cloudflare dashboard.

1. **Add a property.** In [Search Console](https://search.google.com/search-console),
   *Add property → Domain*, and enter `terravisual.cloudils.com`. A domain
   property covers http and https and needs no file or tag in the site. (If a
   `cloudils.com` domain property already exists, it already covers this
   subdomain: skip to step 3 there.)
2. **Verify it by DNS.** Google shows a `google-site-verification=…` TXT value.
   In Cloudflare, *DNS → Records → Add record*: type `TXT`, name `terravisual`,
   content the value Google gave. Then *Verify*. Leave the record in place:
   removing it un-verifies the property.
3. **Submit the sitemap.** *Sitemaps*, enter
   `https://terravisual.cloudils.com/sitemap.xml`, *Submit*. It should read
   *Success* with one discovered page.
4. **Ask for the page.** *URL inspection*, enter
   `https://terravisual.cloudils.com/`, *Request indexing*. The live test there
   also shows the page as Googlebot renders it.

### Checking a link preview

Platforms cache previews for days. After changing the card or its tags, check
with [LinkedIn's Post Inspector](https://www.linkedin.com/post-inspector/),
which also refreshes LinkedIn's cache, or re-share the link with a throwaway
query string (`?v=2`), which platforms treat as a new URL.

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
