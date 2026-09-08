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
 * Two directives are load-bearing and worth explaining rather than copying:
 *
 * `'wasm-unsafe-eval'` is what allows WebAssembly to be compiled **without**
 * opening `unsafe-eval`. The analyzer cannot run without it, and the broader
 * directive would re-enable string-to-code evaluation across the whole page.
 *
 * `connect-src 'self'` is the privacy promise expressed as policy. The
 * application fetches its own WASM module and nothing else; if some future
 * dependency tried to phone home, the browser would refuse and we would find
 * out from a report rather than from a user.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
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

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
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
 */
export function withSecurityHeaders(response: Response, url?: URL): Response {
  const headers = new Headers(response.headers);

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
