/**
 * The deployment Worker.
 *
 * It serves the static build and nothing else. There is no application backend
 * (ADR-0001), and this file must never become one: the moment it starts
 * handling user data it stops being a header-setting wrapper and starts being
 * a server with all the obligations that implies.
 *
 * Cloudflare Workers was chosen over flat static hosting precisely so the
 * security headers are code (ADR-0006). Configuration cannot be asserted
 * against a real response; this can, and the tests do.
 */

import { createNonce, withSecurityHeaders } from './headers';
import { clientKey, isAllowed, tooManyRequests, type RateLimiter } from './rate-limit';

/**
 * Puts the response's nonce where the application can read it.
 *
 * The editor mounts its theme as a `<style>` element at runtime, so that
 * element needs the nonce from *this* response — which means the page has to be
 * told what it is. A `<meta>` tag is the smallest way to say it, and the
 * application reads it once at start-up.
 *
 * This is why the HTML is served `no-cache`: a cached page would carry a nonce
 * that no longer matches the header, and the editor would come up unstyled.
 */
class NonceInjector {
  constructor(private readonly nonce: string) {}

  element(element: { prepend(content: string, options: { html: boolean }): void }) {
    element.prepend(`<meta name="csp-nonce" content="${this.nonce}">`, { html: true });
  }
}

/**
 * The Worker's bindings.
 *
 * Typed structurally rather than by importing Cloudflare's type package: the
 * only binding is a fetcher, and describing it here keeps this file checkable
 * by the same TypeScript configuration as the rest of the repository, with no
 * extra dependency to install and keep current.
 *
 * This module exports nothing but the handler and this type. The Workers
 * runtime refuses to start a module whose named exports are not handlers, so
 * the header logic lives in headers.ts.
 */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /**
   * Optional on purpose. Local development does not always provide it, and the
   * site must serve without it rather than refuse to start — see rate-limit.ts
   * on failing open.
   */
  RATE_LIMITER?: RateLimiter;
}

/**
 * The runtime's streaming HTML rewriter, described rather than imported.
 *
 * Same reasoning as `Env` above: only the two methods used here are needed, and
 * declaring them keeps this file checkable by the repository's own TypeScript
 * configuration with no extra dependency to keep current.
 */
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: unknown): { transform(response: Response): Response };
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One nonce per response, used by both the policy and the page. Generating
    // it in either place alone would give the two different values, and the
    // editor would load without its styles.
    const nonce = createNonce();

    // Static assets answer GET and HEAD. Anything else has no meaning here, and
    // saying so is better than letting the asset server decide.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(
        new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        }),
        nonce
      );
    }

    // Before doing any work: a request that will be refused should cost as
    // little as possible, which is the whole point of refusing it.
    if (!(await isAllowed(env.RATE_LIMITER, clientKey(request)))) {
      return withSecurityHeaders(tooManyRequests(), nonce);
    }

    const url = new URL(request.url);
    const asset = await env.ASSETS.fetch(request);
    const response = withSecurityHeaders(asset, nonce, url);

    // Only the HTML carries the nonce; every other asset is served untouched.
    const isHtml = response.headers.get('Content-Type')?.includes('text/html');
    if (!isHtml) return response;

    return new HTMLRewriter().on('head', new NonceInjector(nonce)).transform(response);
  },
};
