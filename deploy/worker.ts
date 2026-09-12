/**
 * The deployment Worker: serves the static build with its security headers
 * (ADR-0006). There is no backend (ADR-0001), and this must not become one.
 *
 * Only the handler and `Env` may be exported: the Workers runtime refuses to
 * start a module with any other named export.
 */

import { createNonce, withSecurityHeaders } from './headers';
import { clientKey, isAllowed, tooManyRequests, type RateLimiter } from './rate-limit';

// Cloudflare's types are described rather than imported, so this file checks
// under the repository's own TypeScript configuration.
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Absent in local development; the site serves without it. */
  RATE_LIMITER?: RateLimiter;
}

declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: unknown): { transform(response: Response): Response };
  };
};

/** Writes the response's CSP nonce into the page, where the editor reads it. */
class NonceInjector {
  constructor(private readonly nonce: string) {}

  element(element: { prepend(content: string, options: { html: boolean }): void }) {
    element.prepend(`<meta name="csp-nonce" content="${this.nonce}">`, { html: true });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The header and the page must carry the same nonce.
    const nonce = createNonce();

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(
        new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }),
        nonce,
      );
    }

    if (!(await isAllowed(env.RATE_LIMITER, clientKey(request)))) {
      return withSecurityHeaders(tooManyRequests(), nonce);
    }

    const asset = await env.ASSETS.fetch(request);
    const response = withSecurityHeaders(asset, nonce, new URL(request.url));
    if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

    return new HTMLRewriter().on('head', new NonceInjector(nonce)).transform(response);
  },
};
