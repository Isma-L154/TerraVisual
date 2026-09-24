import { expect, test } from '@playwright/test';

import { openApp } from './app';

/**
 * Every example opens, draws, and has nothing wrong with it (#107): an example
 * that shows an error teaches the wrong lesson.
 */

const EXAMPLES = [
  { title: 'AWS web app', shows: 'primary' },
  { title: 'AWS serverless', shows: 'uploads' },
  { title: 'Azure virtual machine', shows: 'logs' },
  { title: 'Google Cloud instance', shows: 'assets' },
  { title: 'Modules', shows: 'private' },
];

for (const { title, shows } of EXAMPLES) {
  test(`the "${title}" example opens and has no problems`, async ({ page }) => {
    await openApp(page);
    page.on('dialog', (dialog) => void dialog.accept());

    await page.getByRole('button', { name: 'Examples' }).click();
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();

    await expect(page.locator('.react-flow__node', { hasText: shows })).toBeVisible();
    await expect(page.getByTestId('diagnostics-empty')).toBeVisible();
    await expect(page.getByTestId('examples')).toBeHidden();
  });
}

test('keeps the workspace when opening an example is cancelled', async ({ page }) => {
  await openApp(page);
  page.on('dialog', (dialog) => void dialog.dismiss());

  await page.getByRole('button', { name: 'Examples' }).click();
  await page.getByRole('button', { name: /^AWS serverless/ }).click();

  await expect(page.locator('.react-flow__node', { hasText: 'primary' })).toBeVisible();
});
