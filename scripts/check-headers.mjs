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
      value.includes("frame-ancestors 'none'") &&
      value.includes("object-src 'none'") &&
      value.includes("base-uri 'self'"),
    describe:
      'must deny by default, allow wasm-unsafe-eval but not unsafe-eval or unsafe-inline, and close framing, object and base-uri',
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

const paths = ['/', '/analyzer.wasm'];
let failures = 0;

for (const path of paths) {
  const url = new URL(path, target);
  let response;
  try {
    response = await fetch(url, { redirect: 'manual' });
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

if (failures > 0) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the served headers.`);
  process.exit(1);
}

console.log('\nAll header checks passed against a real response.');
