import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { editor, openApp } from './app';

/** The editor helping while somebody writes (#108). */

test.describe('writing in the editor', () => {
  test('completes a resource type from the catalog', async ({ page }) => {
    await openApp(page);
    const area = editor(page);
    await area.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nresource "aws_s3_b');

    const list = page.getByRole('listbox');
    await expect(list.getByRole('option', { name: /aws_s3_bucket/ })).toBeVisible();

    // CodeMirror ignores Enter for 75 ms after the list opens, so a keystroke
    // meant for the line is not taken as a choice. A person never notices.
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.type(' "logs" {');

    // The quote and the brace were closed as they were typed.
    await expect(area).toContainText('resource "aws_s3_bucket" "logs" {}');
    await expect(page.locator('.react-flow__node', { hasText: 'logs' })).toBeVisible();
  });

  test('finds and replaces with Ctrl+F, and passes an accessibility scan', async ({ page }) => {
    await openApp(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+f');

    const find = page.getByRole('textbox', { name: 'Find' });
    await expect(find).toBeFocused();
    await find.fill('aws_subnet');
    await page.getByRole('textbox', { name: 'Replace' }).fill('aws_subnet');
    await expect(page.locator('.cm-searchMatch').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.pane-editor')
      .exclude('.cm-scroller')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(find).toBeHidden();
  });
});
