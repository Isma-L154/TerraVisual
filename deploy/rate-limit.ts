/**
 * Per-address rate limiting for the deployment.
 *
 * Nothing served is private, so this protects availability and cost rather
 * than data. It fails open, because a broken limiter must not take the site
 * down, and it is generous, because a classroom can share one address.
 */

/** Cloudflare's rate limiter binding. */
export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export const RETRY_AFTER_SECONDS = 60;

/**
 * Cloudflare sets `CF-Connecting-IP`, and a client cannot forge it at the edge.
 * Without it, as in local development, everyone shares one key.
 */
export function clientKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown-client';
}

export async function isAllowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;

  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

/** The caller adds the security headers, as for every other response. */
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
