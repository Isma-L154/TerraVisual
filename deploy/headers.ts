/**
 * Security headers and caching rules for every response. Kept apart from
 * worker.ts, which may export nothing but its handler.
 */

/**
 * The Content Security Policy.
 *
 * - `'wasm-unsafe-eval'` compiles WebAssembly without enabling string eval.
 * - `connect-src 'self'` is the privacy promise as policy: the page can reach
 *   only its own origin.
 * - Styles are allowed by per-response nonce, for CodeMirror's runtime
 *   stylesheet. `style-src-attr` stays open because React Flow positions nodes
 *   with inline style attributes, which no nonce can cover.
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

/** 16 random bytes per response: a predictable or reused nonce is worthless. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** A copy of the response with the security headers and, given a URL, caching. */
export function withSecurityHeaders(response: Response, nonce: string, url?: URL): Response {
  const headers = new Headers(response.headers);

  headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

  // No CORS: there is no API to be called from elsewhere.
  headers.delete('Access-Control-Allow-Origin');

  if (url) applyCaching(headers, url.pathname);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Hashed bundles are immutable, the analyzer is revalidated, and HTML is never
 * cached: it points at the current bundle and carries this response's nonce.
 */
export function applyCaching(headers: Headers, pathname: string): void {
  // Vite hashes with a dash, other bundlers with a dot; the length bound keeps
  // an ordinary long filename from being cached for a year.
  if (/[.-][0-9a-zA-Z_-]{8,24}\.(js|css|woff2?|png|svg|jpg)$/.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (pathname.endsWith('.wasm') || pathname.endsWith('wasm_exec.js')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  } else if (pathname === '/' || pathname.endsWith('.html')) {
    headers.set('Cache-Control', 'no-cache');
  } else {
    headers.set('Cache-Control', 'public, max-age=3600');
  }
}
