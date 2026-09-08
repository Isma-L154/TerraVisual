import { applyCaching, CONTENT_SECURITY_POLICY, withSecurityHeaders } from './headers';

/**
 * Unit tests for the header logic.
 *
 * These check the rules. They are not evidence that the deployed site sends
 * them — the audit baseline is explicit that a control must be verified
 * against a real response, which `scripts/check-headers.mjs` does against a
 * running Worker.
 */

function headersFor(pathname: string): Headers {
  const response = withSecurityHeaders(new Response('x'), new URL(`https://example.test${pathname}`));
  return response.headers;
}

describe('content security policy', () => {
  it('allows WebAssembly without opening unsafe-eval', () => {
    // The analyzer cannot run without the narrow directive, and the broad one
    // would re-enable string-to-code evaluation across the whole page.
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'; ");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('denies everything not explicitly allowed', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
  });

  // The privacy promise, expressed as policy rather than as documentation.
  it('permits connections only to our own origin', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  });

  it('closes the framing, object and base-uri surfaces', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
  });
});

describe('security headers', () => {
  it('sets the whole set on every response', () => {
    const headers = headersFor('/');

    expect(headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
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
      new URL('https://example.test/')
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses to grant capabilities nothing here uses', () => {
    expect(headersFor('/').get('Permissions-Policy')).toContain('camera=()');
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
