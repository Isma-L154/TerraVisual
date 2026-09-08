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

import { withSecurityHeaders } from './headers';

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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Static assets answer GET and HEAD. Anything else has no meaning here, and
    // saying so is better than letting the asset server decide.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(
        new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        })
      );
    }

    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(asset, new URL(request.url));
  },
};
