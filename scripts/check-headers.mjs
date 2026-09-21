// Verifies the security headers against a real response.
//
// The audit baseline is explicit that a control must be checked by reading the
// response, never by reading the configuration that was supposed to produce
// it. Unit tests prove the rules; this proves the deployment.
//
//   node scripts/check-headers.mjs http://localhost:8787
//   node scripts/check-headers.mjs https://terravisual.example --strict-tls

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/check-headers.mjs <url> [--strict-tls]');
  process.exit(1);
}

// HSTS is only meaningful over TLS and is not sent by a local dev server, so
// it is checked when the caller says this is a real deployment.
const strictTls = process.argv.includes('--strict-tls') || target.startsWith('https://');

const required = [
  {
    header: 'content-security-policy',
    check: (value) =>
      value.includes("default-src 'none'") &&
      value.includes("script-src 'self' 'wasm-unsafe-eval'") &&
      !/script-src[^;]*'unsafe-eval'(?!-)/.test(value) &&
      !/script-src[^;]*'unsafe-inline'/.test(value) &&
      // Styles are allowed by a per-response nonce. A deployment that fell back
      // to a blanket allowance would still look fine in a browser, which is
      // exactly why it is checked here against the real response.
      /style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/.test(value) &&
      !/style-src [^;]*'unsafe-inline'/.test(value) &&
      value.includes("frame-ancestors 'none'") &&
      value.includes("object-src 'none'") &&
      value.includes("base-uri 'self'"),
    describe:
      'must deny by default, allow wasm-unsafe-eval but not unsafe-eval or unsafe-inline, allow styles by nonce rather than by blanket permission, and close framing, object and base-uri',
  },
  {
    header: 'x-content-type-options',
    check: (value) => value.toLowerCase() === 'nosniff',
    describe: 'must be nosniff',
  },
  {
    header: 'referrer-policy',
    check: (value) => value.length > 0,
    describe: 'must be present',
  },
  {
    header: 'x-frame-options',
    check: (value) => value.toUpperCase() === 'DENY',
    describe: 'must be DENY',
  },
];

if (strictTls) {
  required.push({
    header: 'strict-transport-security',
    check: (value) => /max-age=\d{7,}/.test(value),
    describe: 'must set a max-age of at least a few months',
  });
}

const forbidden = [
  {
    header: 'access-control-allow-origin',
    describe:
      'there is no API here; an origin allowance nobody needs is one somebody comes to rely on',
  },
  { header: 'x-powered-by', describe: 'volunteers information about the stack for no benefit' },
  { header: 'server', describe: 'same' },
];

/*
 * Asking the way a browser asks.
 *
 * This is not decoration. Cloudflare injects its Web Analytics beacon into the
 * HTML based on the request: a plain `fetch` gets a clean page, and a browser
 * gets a page with a third-party script in it. A checker that looks like a bot
 * therefore verifies nothing about what people actually receive — it was
 * checked both ways against the first production deployment, and only the
 * browser-shaped request saw the beacon.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

const paths = ['/', '/analyzer.wasm'];
let failures = 0;

for (const path of paths) {
  const url = new URL(path, target);
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', headers: BROWSER_HEADERS });
  } catch (error) {
    console.error(`FAIL ${url} — could not be fetched: ${error.message}`);
    failures++;
    continue;
  }

  console.log(`\n${url}  ${response.status}`);

  for (const rule of required) {
    const value = response.headers.get(rule.header);
    if (value === null) {
      console.error(`  MISSING  ${rule.header} — ${rule.describe}`);
      failures++;
    } else if (!rule.check(value)) {
      console.error(`  WRONG    ${rule.header} — ${rule.describe}\n           got: ${value}`);
      failures++;
    } else {
      console.log(`  ok       ${rule.header}`);
    }
  }

  for (const rule of forbidden) {
    if (response.headers.has(rule.header)) {
      console.error(`  PRESENT  ${rule.header} — should not be sent: ${rule.describe}`);
      failures++;
    }
  }

  /*
   * Nothing third-party in the page, checked against what is actually served.
   *
   * Not hypothetical. The first production deployment came back with
   * Cloudflare's Web Analytics beacon injected into the HTML — added at the
   * edge, after the Worker, by a zone setting nobody in this repository can
   * see. The Content Security Policy refused to run it, which is the system
   * working, but relying on the policy to catch it every time means the page
   * ships a script we did not write and did not want.
   *
   * NFR-1 says user code never leaves the browser and the project ships no
   * telemetry. This is that promise checked rather than asserted.
   */
  if (path === '/') {
    const body = await response.text();
    const injected = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((src) => /^https?:\/\//.test(src) && !src.includes(new URL(target).host));

    if (injected.length > 0) {
      console.error(
        '  PRESENT  third-party script in the page — nothing here loads code from elsewhere',
      );
      for (const src of injected) console.error(`           ${src}`);
      failures++;
    } else {
      console.log('  ok       no third-party script in the page');
    }
  }

  // WebAssembly.instantiateStreaming refuses anything else, and the failure it
  // produces in the browser is easy to misread as a problem with the module.
  if (path.endsWith('.wasm')) {
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('application/wasm')) {
      console.error(`  WRONG    content-type — must be application/wasm, got: ${type || '(none)'}`);
      failures++;
    } else {
      console.log('  ok       content-type');
    }
  }
}

/*
 * Search engines. The single-page fallback answers any path with the index page
 * and a 200, so robots.txt and the sitemap are checked by content type: a
 * deployment that lost them would otherwise look fine. Production must be
 * indexable; every other host (previews, local runs) must ask not to be, or it
 * competes with the site in search results.
 */
const PRODUCTION_HOST = 'terravisual.cloudils.com';
const indexable = new URL(target).hostname === PRODUCTION_HOST;

const crawled = [
  { path: '/', type: /^text\/html/ },
  { path: '/robots.txt', type: /^text\/plain/ },
  { path: '/sitemap.xml', type: /xml/ },
];

console.log(
  `\nsearch engines (${indexable ? 'production: must be indexable' : 'not production: must be noindex'})`,
);

for (const { path, type } of crawled) {
  const url = new URL(path, target);
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', headers: BROWSER_HEADERS });
  } catch (error) {
    console.error(`  FAIL     ${path} — could not be fetched: ${error.message}`);
    failures++;
    continue;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const robots = response.headers.get('x-robots-tag');

  if (response.status !== 200 || !type.test(contentType)) {
    console.error(`  WRONG    ${path} — got ${response.status} ${contentType || '(no type)'}`);
    failures++;
  } else if (indexable && robots !== null) {
    console.error(`  PRESENT  ${path} — x-robots-tag: ${robots} would keep the site out of search`);
    failures++;
  } else if (!indexable && robots !== 'noindex') {
    console.error(`  MISSING  ${path} — x-robots-tag: noindex, or this copy gets indexed`);
    failures++;
  } else {
    console.log(`  ok       ${path}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the served headers.`);
  process.exit(1);
}

console.log('\nAll header checks passed against a real response.');
