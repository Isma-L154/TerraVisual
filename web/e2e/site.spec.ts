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
