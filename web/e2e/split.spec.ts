import { expect, test } from '@playwright/test';

import { openApp } from './app';

/** Resizing the code and the infrastructure (#121). */

const width = (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);

test('the separator is dragged to give the diagram more room', async ({ page }) => {
  await openApp(page);
  const separator = page.getByRole('separator', { name: /resize the code/i });
  const before = await width(page, '.pane-diagram');

  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  expect(await width(page, '.pane-diagram')).toBeGreaterThan(before + 150);
});

test('the separator moves with the keyboard and says where it is', async ({ page }) => {
  await openApp(page);
  const separator = page.getByRole('separator', { name: /resize the code/i });

  await separator.focus();
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '75');
});

test('there is no separator on a phone, where the panes stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  await expect(page.getByRole('separator', { name: /resize the code/i })).toBeHidden();
});

test('the diagram refits to its new size while it follows the code', async ({ page }) => {
  await openApp(page);
  const transform = () =>
    page.locator('.react-flow__viewport').evaluate((element) => element.style.transform);
  const before = await transform();

  await page.getByRole('separator', { name: /resize the code/i }).focus();
  await page.keyboard.press('Home');

  await expect.poll(transform).not.toBe(before);
});
