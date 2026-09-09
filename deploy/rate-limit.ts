/**
 * The rate limit on the deployment.
 *
 * Worth being precise about what this protects, because it is not user data.
 * Every response here is a public static file containing nobody's workspace, so
 * flooding this site discloses nothing and corrupts nothing. What it consumes
 * is Workers requests, which are billed, and at volume the site's availability
 * for everyone else. The realistic bad day is an invoice, and this is the thing
 * that stops one.
 *
 * Two properties matter more than the number:
 *
 * It **fails open**. If the binding is missing or the limiter itself errors, the
 * request is served. A static site that stops working because its rate limiter
 * had a bad day has turned a billing safeguard into an outage, which is a worse
 * failure than the one it was guarding against.
 *
 * It is **generous**. A limit that catches real users is worse than no limit at
 * all here: it makes the tool look broken to exactly the audience it exists for
 * — a classroom sharing one address is a normal Tuesday for a teaching tool.
 */

/** The shape of Cloudflare's rate limiter binding, described rather than imported. */
export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/** How long a blocked client is asked to wait, matching the binding's period. */
export const RETRY_AFTER_SECONDS = 60;

/**
 * The key a client is limited by.
 *
 * `CF-Connecting-IP` is set by Cloudflare and cannot be spoofed by the client at
 * the edge — an attacker-supplied header would be replaced. When it is absent,
 * which is the case in local development, everything shares one key: that keeps
 * the limiter exercisable in tests instead of silently doing nothing.
 */
export function clientKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown-client';
}

/**
 * Whether this request is allowed through.
 *
 * Returns true when there is no limiter, which is not an oversight: see the
 * note about failing open above.
 */
export async function isAllowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;

  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    // A limiter that throws must not take the site down with it.
    return true;
  }
}

/**
 * The answer to a client that has gone over the limit.
 *
 * Plain text and a `Retry-After`, so an automated client learns when to come
 * back and a person learns that nothing is broken. The security headers are
 * applied by the caller, because a rate-limited response must not become the
 * one response on the site without a Content Security Policy.
 */
export function tooManyRequests(): Response {
  return new Response(
    'Too many requests from this address. Nothing is wrong with your workspace — ' +
      'it is stored in your browser and will still be there. Please try again in a minute.\n',
    {
      status: 429,
      headers: {
        'Retry-After': String(RETRY_AFTER_SECONDS),
        'Content-Type': 'text/plain; charset=utf-8',
      },
    },
  );
}
