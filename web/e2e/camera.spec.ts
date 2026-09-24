import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { editor, openApp } from './app';

/**
 * The camera follows the code (#102). React Flow fits the view once, when it
 * mounts; before this, pasting a larger workspace left most of it off-screen
 * and a smaller one tiny in a corner.
 */

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'diagram', name), 'utf8');

async function paste(page: Page, source: string) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByText('Analyzing…')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** Top-level nodes whose box leaves the diagram's visible area. */
async function outside(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const frame = document.querySelector('.react-flow')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.left < frame.left - 1 ||
          box.top < frame.top - 1 ||
          box.right > frame.right + 1 ||
          box.bottom > frame.bottom + 1
        );
      })
      .map((node) => node.getAttribute('data-id') ?? '?');
  });
}

const viewport = (page: Page) =>
  page.locator('.react-flow__viewport').evaluate((element) => element.style.transform);

test.describe('the diagram camera', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  for (const name of ['networking.tf', 'multi-cloud.tf', 'badges.tf']) {
    test(`keeps every resource in view after pasting ${name}`, async ({ page }) => {
      await openApp(page);
      await paste(page, fixture(name));

      expect(await outside(page)).toEqual([]);
    });
  }

  test('stays where the user put it', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForTimeout(300);
    const before = await viewport(page);

    await paste(page, fixture('badges.tf'));

    expect(await viewport(page)).toBe(before);
  });
});
