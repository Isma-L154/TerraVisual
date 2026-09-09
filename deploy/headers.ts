/**
 * The security headers, and the rules for applying them.
 *
 * Separate from worker.ts because the Workers runtime rejects a module whose
 * named exports are not handlers -- exporting these for tests from the entry
 * point stops the Worker booting at all. Splitting them is the better shape
 * anyway: the rules are ordinary functions, testable without a runtime.
 */

/**
 * The Content-Security-Policy.
 *
 * Three directives are load-bearing and worth explaining rather than copying:
 *
 * `'wasm-unsafe-eval'` is what allows WebAssembly to be compiled **without**
 * opening `unsafe-eval`. The analyzer cannot run without it, and the broader
 * directive would re-enable string-to-code evaluation across the whole page.
 *
 * `connect-src 'self'` is the privacy promise expressed as policy. The
 * application fetches its own WASM module and nothing else; if some future
 * dependency tried to phone home, the browser would refuse and we would find
 * out from a report rather than from a user.
 *
 * `style-src` takes a fresh nonce on every response instead of the
 * `'unsafe-inline'` it used to carry. CodeMirror mounts its theme as a `<style>`
 * element at runtime, which is why the blanket allowance was there; a nonce
 * covers exactly that element and nothing else. `style-src-attr` still allows
 * inline style *attributes*, because React Flow positions every node with one
 * and a nonce cannot cover an attribute — but an attribute cannot declare a
 * selector or an `@import`, so it is a far narrower door than the one it
 * replaces.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * A nonce for one response.
 *
 * Must never be reused: a nonce an attacker can predict or replay is worth
 * exactly as much as `'unsafe-inline'`. `crypto.getRandomValues` is available in
 * the Workers runtime and is the right source.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Nothing here needs a camera, a microphone or a location, so nothing gets
  // one. This costs nothing today and closes the door on a dependency quietly
  // asking for one later.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/**
 * Copies a response and applies the headers.
 *
 * The response from the asset server is immutable, so it is rebuilt rather
 * than mutated.
 *
 * The nonce is a parameter rather than generated here because the same value
 * has to reach two places: this header, and the HTML the page is built from.
 * Generating it in both would produce two different nonces and a page whose
 * editor has no styles.
 */
export function withSecurityHeaders(response: Response, nonce: string, url?: URL): Response {
  const headers = new Headers(response.headers);

  headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  // No CORS headers, deliberately. There is no API here to be called from
  // elsewhere, and an origin allowance nobody needs is an origin allowance
  // somebody will eventually rely on (baseline control 2).
  headers.delete('Access-Control-Allow-Origin');

  if (url) applyCaching(headers, url.pathname);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Caching, split by whether the filename identifies its content.
 *
 * Hashed bundles can be cached forever because a change produces a new name.
 * The HTML entry point cannot: it is what points at the current bundle, so a
 * cached copy would pin a returning visitor to an old build indefinitely.
 *
 * The WASM module sits in the middle. Its name is not hashed, but it is large
 * and changes rarely, so it is revalidated rather than re-downloaded.
 */
export function applyCaching(headers: Headers, pathname: string): void {
  // The separator is a dash in Vite's output (index-B4MOF_Ed.js) and a dot in
  // other bundlers', so both count. The length bound keeps an ordinary long
  // filename from being mistaken for a content hash and cached for a year.
  if (/[.-][0-9a-zA-Z_-]{8,24}\.(js|css|woff2?|png|svg|jpg)$/.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (pathname.endsWith('.wasm') || pathname.endsWith('wasm_exec.js')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return;
  }

  if (pathname === '/' || pathname.endsWith('.html')) {
    headers.set('Cache-Control', 'no-cache');
    return;
  }

  headers.set('Cache-Control', 'public, max-age=3600');
}
