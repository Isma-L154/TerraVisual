import {
  applyCaching,
  contentSecurityPolicy,
  createNonce,
  PRODUCTION_HOST,
  withSecurityHeaders,
} from './headers';

/**
 * Unit tests for the header logic.
 *
 * These check the rules. They are not evidence that the deployed site sends
 * them — the audit baseline is explicit that a control must be verified
 * against a real response, which `scripts/check-headers.mjs` does against a
 * running Worker.
 */

const NONCE = 'test-nonce';
const POLICY = contentSecurityPolicy(NONCE);

function headersFor(pathname: string): Headers {
  const response = withSecurityHeaders(
    new Response('x'),
    NONCE,
    new URL(`https://example.test${pathname}`)
  );
  return response.headers;
}

describe('content security policy', () => {
  it('allows WebAssembly without opening unsafe-eval', () => {
    // The analyzer cannot run without the narrow directive, and the broad one
    // would re-enable string-to-code evaluation across the whole page.
    expect(POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(POLICY).not.toContain("'unsafe-eval'; ");
    expect(POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('denies everything not explicitly allowed', () => {
    expect(POLICY).toContain("default-src 'none'");
  });

  // The privacy promise, expressed as policy rather than as documentation.
  it('permits connections only to our own origin', () => {
    expect(POLICY).toContain("connect-src 'self'");
  });

  // The whole point of the nonce: a `<style>` element from this response is
  // allowed, and an injected one is not. Losing this by accident would restore
  // `'unsafe-inline'` without anybody noticing, so it is asserted directly.
  it('allows styles by nonce rather than by blanket permission', () => {
    expect(POLICY).toContain(`style-src 'self' 'nonce-${NONCE}'`);
    expect(POLICY).not.toMatch(/style-src [^;]*'unsafe-inline'/);
  });

  // Style attributes are a separate directive, and they still need the blanket
  // allowance: React Flow positions every node with one, and a nonce cannot
  // cover an attribute. An attribute cannot declare a selector or an @import,
  // so this is a far narrower door than the one it replaced.
  it('allows inline style attributes, and says so explicitly', () => {
    expect(POLICY).toContain("style-src-attr 'unsafe-inline'");
  });

  it('closes the framing, object and base-uri surfaces', () => {
    expect(POLICY).toContain("frame-ancestors 'none'");
    expect(POLICY).toContain("object-src 'none'");
    expect(POLICY).toContain("base-uri 'self'");
    expect(POLICY).toContain("form-action 'none'");
  });
});

describe('security headers', () => {
  it('sets the whole set on every response', () => {
    const headers = headersFor('/');

    expect(headers.get('Content-Security-Policy')).toBe(POLICY);
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  // Baseline control 2. There is no API here to be called from elsewhere, and
  // an origin allowance nobody needs is one somebody eventually relies on.
  it('emits no CORS header', () => {
    const response = withSecurityHeaders(
      new Response('x', { headers: { 'Access-Control-Allow-Origin': '*' } }),
      NONCE,
      new URL('https://example.test/')
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // The social card is shown by other sites, so it alone may be loaded by them.
  // Everything else stays same-origin, including other images.
  it('lets other sites load the social card and nothing else', () => {
    expect(headersFor('/og-image.png').get('Cross-Origin-Resource-Policy')).toBe('cross-origin');

    for (const path of [
      '/',
      '/favicon.svg',
      '/analyzer.wasm',
      '/og-image.png.map',
      '/x/og-image.png',
    ]) {
      expect(headersFor(path).get('Cross-Origin-Resource-Policy'), path).toBe('same-origin');
    }
  });

  it('refuses to grant capabilities nothing here uses', () => {
    expect(headersFor('/').get('Permissions-Policy')).toContain('camera=()');
  });
});

describe('indexing', () => {
  function robotsTag(url: string, type = 'text/html; charset=utf-8'): string | null {
    const response = new Response('x', { headers: { 'Content-Type': type } });
    return withSecurityHeaders(response, NONCE, new URL(url)).headers.get('X-Robots-Tag');
  }

  it('lets search engines index the site itself', () => {
    expect(robotsTag(`https://${PRODUCTION_HOST}/`)).toBeNull();
    expect(robotsTag(`https://${PRODUCTION_HOST}/sitemap.xml`, 'application/xml')).toBeNull();
    expect(robotsTag(`https://${PRODUCTION_HOST}/og-image.png`, 'image/png')).toBeNull();
  });

  // A preview is the same page on another host; indexed, it competes with the site.
  it('keeps every other host out of the index', () => {
    for (const url of [
      'https://abc123-terravisual.someone.workers.dev/',
      'http://localhost:8787/',
      `https://${PRODUCTION_HOST}.evil.test/`,
    ]) {
      expect(robotsTag(url), url).toBe('noindex');
    }
  });

  // Unknown paths get the index page with a 200: a duplicate, not a page.
  it('keeps the single-page fallback out of the index', () => {
    expect(robotsTag(`https://${PRODUCTION_HOST}/anything`)).toBe('noindex');
    expect(robotsTag(`https://${PRODUCTION_HOST}/index.html`)).toBe('noindex');
  });
});

describe('caching', () => {
  it('caches hashed bundles forever, because a change renames them', () => {
    const headers = new Headers();
    applyCaching(headers, '/assets/index-B4MOF_Ed.js');

    expect(headers.get('Cache-Control')).toContain('immutable');
  });

  // The entry point is what points at the current bundle. A cached copy would
  // pin a returning visitor to an old build indefinitely.
  it('never caches the entry point', () => {
    const headers = new Headers();
    applyCaching(headers, '/');

    expect(headers.get('Cache-Control')).toBe('no-cache');
  });

  // A long but unhashed filename must not be cached for a year: renaming it
  // is not how it changes, so a stale copy would never be replaced.
  it('does not mistake a long filename for a content hash', () => {
    const headers = new Headers();
    applyCaching(headers, '/assets/analyzer-runtime.js');

    expect(headers.get('Cache-Control')).not.toContain('immutable');
  });

  it('revalidates the analyzer rather than re-downloading it', () => {
    const headers = new Headers();
    applyCaching(headers, '/analyzer.wasm');

    expect(headers.get('Cache-Control')).toContain('must-revalidate');
  });
});

// A nonce that repeats is worth exactly as much as 'unsafe-inline': anything
// injected once can carry it forever.
describe('nonces', () => {
  it('is different on every response', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));

    expect(nonces.size).toBe(100);
  });

  it('carries enough randomness to be worth having', () => {
    // 16 bytes, base64: guessing it is not a practical attack.
    expect(atob(createNonce())).toHaveLength(16);
  });

  it('contains nothing that would break the header it goes into', () => {
    for (let i = 0; i < 100; i++) {
      expect(createNonce()).not.toMatch(/[;'"\s]/);
    }
  });
});
