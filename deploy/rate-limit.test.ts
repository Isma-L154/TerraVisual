import { clientKey, isAllowed, RETRY_AFTER_SECONDS, tooManyRequests } from './rate-limit';
import { withSecurityHeaders } from './headers';

/**
 * The limiter's behaviour, exercised by being tripped.
 *
 * The security baseline is explicit that a configured limit nobody has provoked
 * is unverified, so every test here drives the thing past its threshold rather
 * than asserting that a number is set somewhere.
 */

/** A limiter that allows a fixed number of requests per key, then refuses. */
function limiterAllowing(perKey: number) {
  const seen = new Map<string, number>();

  return {
    calls: 0,
    limit(options: { key: string }) {
      this.calls++;
      const used = (seen.get(options.key) ?? 0) + 1;
      seen.set(options.key, used);
      return Promise.resolve({ success: used <= perKey });
    },
  };
}

describe('who gets limited', () => {
  it('separates clients by address, so one flood does not block everybody', async () => {
    const limiter = limiterAllowing(2);

    // One client exhausts its allowance.
    expect(await isAllowed(limiter, '203.0.113.1')).toBe(true);
    expect(await isAllowed(limiter, '203.0.113.1')).toBe(true);
    expect(await isAllowed(limiter, '203.0.113.1')).toBe(false);

    // A different client is unaffected, which is the difference between a rate
    // limit and an outage.
    expect(await isAllowed(limiter, '203.0.113.2')).toBe(true);
  });

  it('keys on the address Cloudflare sets, not on one the client can choose', () => {
    const spoofed = new Request('https://example.test/', {
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        'X-Forwarded-For': '10.0.0.1',
        'X-Real-IP': '10.0.0.2',
      },
    });

    expect(clientKey(spoofed)).toBe('203.0.113.7');
  });

  it('still has a key when the header is absent', () => {
    expect(clientKey(new Request('https://example.test/'))).toBe('unknown-client');
  });
});

// A rate limiter that can take the site down has become the outage it was
// supposed to prevent. Nothing served here is private, so serving is always the
// safer failure.
describe('failing open', () => {
  it('serves the request when there is no limiter at all', async () => {
    expect(await isAllowed(undefined, 'anyone')).toBe(true);
  });

  it('serves the request when the limiter throws', async () => {
    const broken = {
      limit: () => Promise.reject(new Error('the limiter is having a bad day')),
    };

    expect(await isAllowed(broken, 'anyone')).toBe(true);
  });
});

describe('what a limited client is told', () => {
  it('answers 429 with a Retry-After', () => {
    const response = tooManyRequests();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String(RETRY_AFTER_SECONDS));
  });

  // Somebody who hits this has a workspace in their browser and no idea why the
  // page stopped loading. Saying that their work is safe costs one sentence.
  it('says that their work is not lost', async () => {
    expect(await tooManyRequests().text()).toMatch(/stored in your browser/i);
  });

  // The one response on the site without a Content Security Policy would be a
  // strange thing to leave lying around.
  it('carries the security headers like every other response', () => {
    const response = withSecurityHeaders(tooManyRequests(), 'test-nonce');

    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Retry-After')).toBe(String(RETRY_AFTER_SECONDS));
  });
});
