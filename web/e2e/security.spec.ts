import { expect, test } from '@playwright/test';

import { editor, openApp } from './app';

/**
 * The Content Security Policy, checked against a real response and a real page.
 *
 * The security baseline is explicit that a control must be verified against
 * what is actually served rather than against the configuration that is
 * supposed to produce it. `scripts/check-headers.mjs` reads the headers; this
 * checks the other half — that the page still works under them, which is the
 * failure mode a stricter policy actually has.
 */

test.describe('content security policy', () => {
  test('allows styles by nonce rather than by blanket permission', async ({ page }) => {
    const response = await page.goto('/');
    const policy = response?.headers()['content-security-policy'] ?? '';

    expect(policy).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).not.toMatch(/style-src [^;]*'unsafe-inline'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  // A nonce that repeats across responses is worth exactly as much as
  // 'unsafe-inline': anything injected once could carry it forever.
  test('uses a different nonce on every response', async ({ page }) => {
    const nonces = new Set<string>();

    for (let i = 0; i < 3; i++) {
      const response = await page.goto('/?cache-buster=' + i);
      const policy = response?.headers()['content-security-policy'] ?? '';
      nonces.add(/nonce-([A-Za-z0-9+/=]+)/.exec(policy)?.[1] ?? '');
    }

    expect(nonces.size).toBe(3);
    expect(nonces.has('')).toBe(false);
  });

  test('the page carries the same nonce the header names', async ({ page }) => {
    const response = await page.goto('/');
    const policy = response?.headers()['content-security-policy'] ?? '';
    const fromHeader = /nonce-([A-Za-z0-9+/=]+)/.exec(policy)?.[1];

    const fromPage = await page.evaluate(
      () => document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content,
    );

    expect(fromHeader).toBeTruthy();
    expect(fromPage).toBe(fromHeader);
  });

  // The whole risk of tightening a policy: the browser enforces it silently and
  // the page comes up broken. This is why the policy is tested in a browser
  // rather than only in a unit test over a string.
  test('nothing on the page is refused by the policy', async ({ page }) => {
    const refusals: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) {
        refusals.push(message.text());
      }
    });

    await openApp(page);
    await page.getByRole('button', { name: 'Outline' }).click();
    await page.getByRole('button', { name: 'Diagram' }).click();
    await page.getByRole('button', { name: 'Import project' }).click();

    expect(refusals).toEqual([]);
  });

  test('the editor still has its styles', async ({ page }) => {
    await openApp(page);

    // CodeMirror mounts its theme as a <style> element at runtime. Under the
    // nonce policy that element is allowed only because the Worker told the
    // page which nonce to use; if that wiring breaks, the editor loses its
    // layout entirely rather than failing loudly.
    const styled = await page.evaluate(() => {
      const sheet = [...document.querySelectorAll('style')].find((element) =>
        (element.textContent ?? '').includes('cm-'),
      );
      const gutters = document.querySelector('.cm-gutters');

      return {
        sheetHasNonce: Boolean(sheet?.getAttribute('nonce')),
        gutterPosition: gutters ? getComputedStyle(gutters).position : null,
      };
    });

    expect(styled.sheetHasNonce).toBe(true);
    expect(styled.gutterPosition).toBe('sticky');
    await expect(editor(page)).toBeVisible();
  });

  test('the diagram can still position its nodes', async ({ page }) => {
    await openApp(page);

    // React Flow positions nodes with inline style attributes, which no nonce
    // can cover — `style-src-attr` is what keeps them working. If that
    // directive were dropped, every node would pile up at the origin.
    const transforms = await page
      .locator('.react-flow__node')
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).style.transform),
      );

    expect(transforms.length).toBeGreaterThan(1);
    expect(new Set(transforms).size).toBeGreaterThan(1);
  });
});
