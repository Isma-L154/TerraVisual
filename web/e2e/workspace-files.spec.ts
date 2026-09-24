import { expect, test } from '@playwright/test';

import { editor, openApp } from './app';

/** Creating, renaming and deleting files in the page (#109). */

const tab = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('navigation', { name: 'Workspace files' }).getByRole('button', {
    name,
    exact: true,
  });

test('a new file joins the workspace and is drawn', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByLabel('New file path').fill('storage.tf');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(tab(page, 'storage.tf')).toHaveAttribute('aria-current', 'true');
  await editor(page).click();
  await page.keyboard.type('resource "aws_s3_bucket" "extra" {');
  await expect(page.locator('.react-flow__node', { hasText: 'extra' })).toBeVisible();
});

test('says why a path is refused, next to where it was typed', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: 'New file' }).click();
  const input = page.getByLabel('New file path');
  await input.fill('../escape.tf');
  await input.press('Enter');

  await expect(page.getByRole('alert')).toHaveText(/stays inside the workspace/);
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.fill('main.tf');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('main.tf already exists.');
});

test('renames the open file and deletes it after asking', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New file' }).click();
  await page.getByLabel('New file path').fill('extra.tf');
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Rename extra.tf to').fill('network/extra.tf');
  await page.getByLabel('Rename extra.tf to').press('Enter');
  await expect(tab(page, 'network/extra.tf')).toHaveAttribute('aria-current', 'true');

  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(tab(page, 'network/extra.tf')).toHaveCount(0);
  await expect(tab(page, 'main.tf')).toHaveAttribute('aria-current', 'true');

  // The last file stays.
  await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
});
