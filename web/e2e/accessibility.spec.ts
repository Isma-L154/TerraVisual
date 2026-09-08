import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { BROKEN_SOURCE, openApp, settle, typeWorkspace } from './app';

/**
 * Automated accessibility checks.
 *
 * These catch roughly a third of real accessibility problems — the mechanical
 * third: missing names, broken roles, insufficient contrast. The keyboard
 * journey next door and the manual screen reader pass recorded in
 * `docs/testing/` cover what a scanner cannot see. Passing here is a floor, not
 * a certificate.
 *
 * Every state a user can actually reach is scanned, because a violation in a
 * panel that only appears after a click is still a violation.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

/**
 * One reviewed exception, as narrow as it can be made.
 *
 * `scrollable-region-focusable` fires on CodeMirror's `.cm-scroller`, which
 * carries `tabindex="-1"`. The rule looks for focusable content inside a
 * scrollable region and does not count the `contenteditable` element that
 * CodeMirror puts there — but that element *is* focusable, *is* in the tab
 * order, and arrow keys and Page Up/Down scroll the region from it. The
 * keyboard journey next door proves it by tabbing in and typing.
 *
 * Filtering afterwards rather than excluding the element up front matters:
 * excluding it would also stop the scanner checking the contrast of the syntax
 * highlighting inside, which is where this audit found a real failure. So the
 * editor is still scanned by every rule, and exactly one rule is forgiven on
 * exactly one element.
 */
function isReviewedException(violation: Awaited<ReturnType<typeof scan>>['violations'][number]) {
  return (
    violation.id === 'scrollable-region-focusable' &&
    violation.nodes.every((node) => node.target.join(' ').includes('.cm-scroller'))
  );
}

/** Fails with the rule, the impact and the offending markup, not just a count. */
function describeViolations(violations: Awaited<ReturnType<typeof scan>>['violations']): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => `      ${node.target.join(' ')}\n        ${node.html.slice(0, 160)}`)
        .join('\n');
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${targets}`;
    })
    .join('\n');
}

async function expectNoViolations(page: Page) {
  const results = await scan(page);
  const violations = results.violations.filter((violation) => !isReviewedException(violation));
  expect(violations, `\n${describeViolations(violations)}`).toEqual([]);
}

test.describe('automated accessibility', () => {
  test('the opening screen', async ({ page }) => {
    await openApp(page);
    await expectNoViolations(page);
  });

  test('the outline view', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Outline' }).click();
    await expect(page.getByRole('tree', { name: /infrastructure outline/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('a selected node, with its details', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Outline' }).click();

    const tree = page.getByRole('tree', { name: /infrastructure outline/i });
    await tree.getByRole('treeitem').first().click();

    await expect(page.getByTestId('details')).toBeVisible();
    await expectNoViolations(page);
  });

  test('the import panel', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Import project' }).click();

    await expect(page.getByTestId('import-zone')).toBeVisible();
    await expectNoViolations(page);
  });

  test('problems, when the code has some', async ({ page }) => {
    await openApp(page);
    await typeWorkspace(page, BROKEN_SOURCE, 2);

    await expect(page.getByRole('button', { name: /error/i }).first()).toBeVisible();
    await expectNoViolations(page);
  });

  test('the share link, once created', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);

    await page.getByRole('button', { name: /copy share link/i }).click();
    await expect(page.getByRole('textbox', { name: 'Share link' })).toBeVisible();

    await expectNoViolations(page);
  });

  // Contrast is a property of the theme, and the theme has two halves. Checking
  // only the one the CI machine happens to prefer would leave half the users
  // unchecked.
  test('the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Outline' }).click();
    await expectNoViolations(page);
  });

  test('the light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page);
    await expectNoViolations(page);
  });

  // A diagram whose only content is a picture would fail the brief, not just a
  // guideline. This asserts the model is readable as structure.
  test('the diagram is exposed as structure, not only as a picture', async ({ page }) => {
    await openApp(page);
    await settle(page);

    const nodes = page.locator('.react-flow__node');
    await expect(nodes.first()).toBeVisible();

    // Every node carries an accessible name, so a screen reader announces what
    // it is rather than "group".
    const unnamed = await nodes.evaluateAll(
      (elements) => elements.filter((element) => !element.textContent?.trim()).length,
    );
    expect(unnamed).toBe(0);
  });
});

test.describe('motion', () => {
  test('respects a preference for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);

    // Nothing on the page may animate for longer than the instant the reduced
    // motion rule allows.
    const longest = await page.evaluate(() => {
      let worst = 0;
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        for (const value of [style.transitionDuration, style.animationDuration]) {
          for (const part of value.split(',')) {
            const seconds = part.trim().endsWith('ms')
              ? parseFloat(part) / 1000
              : parseFloat(part) || 0;
            if (seconds > worst) worst = seconds;
          }
        }
      }
      return worst;
    });

    expect(longest).toBeLessThanOrEqual(0.05);
  });
});

test.describe('layout', () => {
  // WCAG 1.4.10. 320 CSS pixels is the width the criterion names, and it is
  // also a real phone held upright — the diagram is the part most likely to
  // insist on more room than it has.
  test('reflows at 320 pixels wide without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openApp(page);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // WCAG 1.4.4. Doubling the root font size is how somebody who needs larger
  // text actually reads this, and a layout in fixed pixels breaks here.
  test('survives text at 200 per cent', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // WCAG 2.5.8, new in 2.2. Small targets are hardest for people with tremor
  // or on a phone, and the outline's rows are the ones most likely to shrink.
  test('every pointer target is at least 24 by 24', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Outline' }).click();

    const undersized = await page.evaluate(() => {
      const found: string[] = [];
      const targets = document.querySelectorAll(
        'button, a[href], input, [role="treeitem"], [role="button"]',
      );

      for (const element of targets) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.width < 24 || box.height < 24) {
          const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
          found.push(`${name.slice(0, 40)} (${Math.round(box.width)}x${Math.round(box.height)})`);
        }
      }
      return found;
    });

    expect(undersized).toEqual([]);
  });
});
