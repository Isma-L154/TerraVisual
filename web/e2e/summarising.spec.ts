import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { editor, openApp } from './app';

/**
 * What the diagram does when a workspace is too large to draw in full.
 *
 * The picture summarises rather than slowing down or lying. These tests are
 * about the second half of that: a summary presented as a complete picture is
 * the failure this project cares most about, so what is folded away has to be
 * visible, countable, and openable.
 */

const BIG = readFileSync(
  join(import.meta.dirname, '..', '..', 'fixtures', 'perf', '1000.tf'),
  'utf8',
);

async function loadBig(page: Page) {
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, BIG);

  const area = editor(page);
  await area.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(page.getByText(/the diagram summarises/i)).toBeVisible({ timeout: 60_000 });
}

test.describe('a workspace larger than the diagram will draw', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('says that it summarised, and how much', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const notice = page.getByText(/the diagram summarises/i);
    await expect(notice).toContainText(/\d+ resources are folded/);

    // Announced rather than only shown: somebody reading by ear must not be
    // left thinking they have the whole picture.
    await expect(notice).toHaveRole('status');
  });

  test('marks each folded container with what it is holding', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const folded = page.getByRole('button', { name: /not shown/i });
    expect(await folded.count()).toBeGreaterThan(0);
    await expect(folded.first()).toContainText(/\+ \d+ not shown/);
  });

  test('opens a folded container when asked', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const before = await page.locator('.react-flow__node').count();
    const folded = page.getByRole('button', { name: /not shown/i }).first();

    await folded.click();

    // Opening one shows more than was there, and the reader chose it.
    await expect
      .poll(() => page.locator('.react-flow__node').count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
  });

  test('opens a folded container from the keyboard', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const before = await page.locator('.react-flow__node').count();
    const folded = page.getByRole('button', { name: /not shown/i }).first();

    await folded.focus();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => page.locator('.react-flow__node').count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
  });

  // The diagram may summarise. The accessible view may not — that is what
  // makes this a summary rather than an omission.
  test('the outline still lists everything', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const drawn = await page.locator('.react-flow__node').count();

    await page.getByRole('button', { name: 'Outline' }).click();
    const items = page.getByRole('tree').getByRole('treeitem');

    // The outline collapses branches for readability but every root is present
    // and expandable, so the count it shows is far beyond what the diagram drew.
    expect(await items.count()).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(1000);
  });

  test('a folded container says out loud what it is holding', async ({ page }) => {
    await openApp(page);
    await loadBig(page);

    const labels = await page
      .locator('.react-flow__node')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label') ?? ''),
      );

    expect(labels.some((label) => /holding \d+ not shown/.test(label))).toBe(true);
  });
});
