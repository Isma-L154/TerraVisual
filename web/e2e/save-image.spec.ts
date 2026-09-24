import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { openApp } from './app';

/** Saving the diagram as an image (#119), under the real Content Security Policy. */

test('saves the whole diagram as a PNG', async ({ page }, testInfo) => {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text())) refusals.push(message.text());
  });

  await openApp(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as PNG' }).click();

  const file = await download;
  expect(file.suggestedFilename()).toBe('terravisual-diagram.png');

  const path = testInfo.outputPath('diagram.png');
  await file.saveAs(path);
  const bytes = readFileSync(path);

  // The PNG signature, then the IHDR chunk's width and height.
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(800);
  expect(height).toBeGreaterThan(200);
  expect(width).toBeLessThanOrEqual(4096 + 48);

  expect(refusals).toEqual([]);
});
