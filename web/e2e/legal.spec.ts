import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { openApp } from './app';

/** The privacy policy and the terms (#132): static pages under the same headers. */

const PAGES = [
  { path: '/privacy', heading: 'Privacy policy' },
  { path: '/terms', heading: 'Terms of use' },
];

for (const { path, heading } of PAGES) {
  test(`${path} is served, readable and accessible`, async ({ page }) => {
    const refusals: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) refusals.push(message.text());
    });

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");

    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('link', { name: 'info@cloudils.com' })).toBeVisible();
    // Styled by the external stylesheet, which the policy allows and inline CSS would not be.
    expect(
      await page.locator('article').evaluate((element) => getComputedStyle(element).borderRadius),
    ).toBe('10px');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(refusals).toEqual([]);
  });
}

test('the application links to both, and they link back', async ({ page }) => {
  await openApp(page);

  await page
    .getByRole('navigation', { name: 'Legal' })
    .getByRole('link', { name: 'Privacy policy' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();

  await page.getByRole('link', { name: 'Back to TerraVisual' }).click();
  await expect(page.getByTestId('diagram')).toBeVisible({ timeout: 30_000 });
});
