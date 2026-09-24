import path from 'node:path';

import { expect, test } from '@playwright/test';

import { editor, openApp } from './app';

/**
 * Importing a project, the way people actually do it: a folder whose name is
 * in every path. The analyzer reads the root module from the workspace root,
 * so for a long time every folder import drew an empty diagram (#94).
 */

const PROJECT = path.resolve(import.meta.dirname, '../../fixtures/import/project');

test('a folder import draws the project, modules included', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Import project' }).click();
  await page.getByLabel('Choose a folder').setInputFiles(PROJECT);

  await expect(page.locator('.react-flow__node', { hasText: 'assets' })).toBeVisible();
  await expect(page.locator('.react-flow__node', { hasText: 'this' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'main.tf', exact: true })).toBeVisible();

  // The report outlives the panel, which closes once the files are in.
  const report = page.getByTestId('import-report');
  await expect(report).toContainText('Imported 2 files.');
  await expect(report).toContainText('1 file skipped: not Terraform.');
});

test('single files can be chosen as well as folders', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Import project' }).click();
  await page.getByLabel('Choose files').setInputFiles(path.join(PROJECT, 'main.tf'));

  await expect(page.getByTestId('import-report')).toContainText('Imported 1 file.');
  await expect(page.locator('.react-flow__node', { hasText: 'assets' })).toBeVisible();
});

// A file that misses the panel used to be opened by the browser, or pasted
// into the open file by the editor.
test('a file dropped on the editor is imported, not pasted', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['resource "aws_s3_bucket" "dropped" {}\n'], 'dropped.tf'));
    const target = document.querySelector('.cm-content')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }
  });

  await expect(page.getByTestId('import-report')).toContainText('Imported 1 file.');
  await expect(editor(page)).toHaveText('resource "aws_s3_bucket" "dropped" {}');
  await expect(page.locator('.react-flow__node', { hasText: 'dropped' })).toBeVisible();
});
