import { expect, test } from '@playwright/test';

/**
 * The icons the page declares, fetched from the Worker that serves them.
 *
 * Checked by content type rather than by status, because a status proves
 * nothing here: the Worker answers unknown paths with the index page and a 200
 * (the single-page-application fallback), which is exactly how /favicon.ico
 * was being served before the site had one.
 */

test('every icon the page declares is served as an image', async ({ page, request }) => {
  await page.goto('/');

  const hrefs = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="apple-touch-icon"]',
      ),
    ].map((link) => link.href),
  );
  expect(hrefs.length).toBeGreaterThanOrEqual(3);

  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()['content-type'], href).toMatch(/^image\//);
  }
});

// Browsers and crawlers ask for this path whether or not the page mentions it.
test('/favicon.ico is an icon, not the index page', async ({ request }) => {
  const response = await request.get('/favicon.ico');
  expect(response.headers()['content-type']).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)/);
});

test('the web manifest parses and names icons that exist', async ({ request }) => {
  const response = await request.get('/site.webmanifest');
  expect(response.status()).toBe(200);

  const manifest = (await response.json()) as { name: string; icons: { src: string }[] };
  expect(manifest.name).toBe('TerraVisual');

  for (const icon of manifest.icons) {
    const served = await request.get(icon.src);
    expect(served.headers()['content-type'], icon.src).toMatch(/^image\//);
  }
});

/**
 * The link preview. Crawlers resolve nothing, so every URL must be absolute,
 * and they read tags from the served HTML — this reads them from the response,
 * not from the page after scripts have run.
 */
test.describe('social card', () => {
  const meta = (html: string, key: string) =>
    new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]+)"`).exec(html)?.[1];

  test('the served HTML carries Open Graph and Twitter tags', async ({ request }) => {
    const html = await (await request.get('/')).text();

    for (const key of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:image:alt']) {
      expect(meta(html, key), key).toBeTruthy();
    }
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'og:url')).toMatch(/^https:\/\//);
    expect(meta(html, 'og:image')).toMatch(/^https:\/\/.+\/og-image\.png$/);
    expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
  });

  test('the card image is served, at the size the tags declare', async ({ request }) => {
    const response = await request.get('/og-image.png');
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['cross-origin-resource-policy']).toBe('cross-origin');

    // Width and height are the two big-endian words after the PNG signature
    // and the IHDR chunk header.
    const png = await response.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeLessThan(300_000);
  });
});
