import { expect, test } from '@playwright/test';

import {
  BROKEN_SOURCE,
  SIMPLE_SOURCE,
  editor,
  focused,
  focusIsVisible,
  openApp,
  settle,
  tabThrough,
  tabUntil,
  typeWorkspace,
} from './app';

/**
 * The keyboard journey.
 *
 * One person, one keyboard, the whole product: write some Terraform, read the
 * infrastructure it describes, walk the outline, fix a problem, share the
 * result. It exists so keyboard access cannot regress quietly — that is the
 * kind of thing which breaks two refactors after anybody last checked.
 *
 * Focus is moved by pressing keys, never by calling `focus()`. Chrome only
 * treats focus as keyboard focus when it arrived from the keyboard, so a
 * scripted `focus()` would report a focus ring that a real user never sees.
 */

test.describe('keyboard journey', () => {
  test('the skip link comes first and reaches the workspace', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Tab');
    const first = await focused(page);
    expect(first.name).toMatch(/skip to workspace/i);
    expect(await focusIsVisible(page)).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.locator('#workspace')).toBeVisible();
  });

  test('writes Terraform and sees the infrastructure appear', async ({ page }) => {
    await openApp(page);
    await typeWorkspace(page, SIMPLE_SOURCE, 4);

    await expect(page.getByTestId('diagram')).toBeVisible();
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  });

  // WCAG 2.1.2. The editor takes Tab for indentation, which is a trade-off
  // rather than an oversight: Escape releases it. Both halves are asserted —
  // the exit has to work, and the user has to be told it exists.
  test('focus can leave the editor, and the way out is documented', async ({ page }) => {
    await openApp(page);

    const area = editor(page);
    await area.click();
    await expect(area).toBeFocused();

    // The instruction must reach somebody who cannot read our source code.
    const described = await area.evaluate((element) => {
      const id = element.getAttribute('aria-describedby');
      if (!id) return '';
      return id
        .split(/\s+/)
        .map((each) => document.getElementById(each)?.textContent ?? '')
        .join(' ');
    });
    expect(described.toLowerCase()).toContain('escape');

    // It is on the page as well, for a sighted keyboard user who is just as
    // stuck and never hears an accessible description.
    await expect(page.getByText(/press escape and then tab/i)).toBeVisible();

    // Tab inside the editor indents rather than moving focus.
    await page.keyboard.press('Tab');
    await expect(area).toBeFocused();

    // Escape, then Tab, gets out.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(area).not.toBeFocused();
  });

  test('reaches a diagram node by tabbing, and can see where focus is', async ({ page }) => {
    await openApp(page);
    await typeWorkspace(page, SIMPLE_SOURCE, 4);

    const reached = await tabUntil(page, (stop) => stop.className.includes('react-flow__node'));
    expect(reached, 'tabbing never reached a diagram node').toBe(true);

    // WCAG 2.4.7. React Flow removes the outline on focused nodes; if that
    // regresses, a keyboard user loses any idea of where they are.
    expect(await focusIsVisible(page), 'a focused diagram node has no visible focus').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('details')).toBeVisible();
  });

  // The diagram's instructions are read aloud on every node, so they have to
  // describe this diagram. Nodes here cannot be dragged or deleted.
  test('the diagram does not promise interactions it does not have', async ({ page }) => {
    await openApp(page);
    await typeWorkspace(page, SIMPLE_SOURCE, 4);

    const description = await page
      .locator('.react-flow__node')
      .first()
      .evaluate((element) => {
        const id = element.getAttribute('aria-describedby');
        if (!id) return '';
        return id
          .split(/\s+/)
          .map((each) => document.getElementById(each)?.textContent ?? '')
          .join(' ');
      });

    expect(description).not.toMatch(/move the node|remove it/i);
    expect(description).toMatch(/select/i);
  });

  test('walks the outline with arrow keys, one tab stop for the whole tree', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Outline' }).click();
    const tree = page.getByRole('tree', { name: /infrastructure outline/i });
    await expect(tree).toBeVisible();

    const items = tree.getByRole('treeitem');
    expect(await items.count()).toBeGreaterThan(2);

    // Exactly one item is in the tab order: the roving tab stop. A tree that
    // put every resource in the tab order would bury the rest of the page.
    const tabbable = await items.evaluateAll(
      (elements) => elements.filter((element) => element.getAttribute('tabindex') === '0').length,
    );
    expect(tabbable).toBe(1);

    const reached = await tabUntil(page, (stop) => stop.role === 'treeitem');
    expect(reached, 'tabbing never reached the outline tree').toBe(true);
    expect(await focusIsVisible(page)).toBe(true);

    const before = (await focused(page)).name;
    await page.keyboard.press('ArrowDown');
    const after = await focused(page);
    expect(after.role).toBe('treeitem');
    expect(after.name).not.toBe(before);

    // End and Home belong to the tree pattern, and a hundred-resource project
    // is exactly where they earn their place.
    await page.keyboard.press('End');
    expect((await focused(page)).role).toBe('treeitem');
    await page.keyboard.press('Home');
    expect((await focused(page)).role).toBe('treeitem');

    // Enter selects, which fills the details pane.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('details')).toBeVisible();
  });

  test('finds a problem in the list and jumps to the code that caused it', async ({ page }) => {
    await openApp(page);
    await typeWorkspace(page, BROKEN_SOURCE, 2);

    const problem = page.getByRole('button', { name: /error/i }).first();
    await expect(problem).toBeVisible();

    const reached = await tabUntil(page, (stop) => stop.className.includes('diagnostic-error'));
    expect(reached, 'tabbing never reached a problem').toBe(true);
    expect(await focusIsVisible(page)).toBe(true);

    await page.keyboard.press('Enter');

    // Jumping puts the cursor in the code, rather than merely scrolling it.
    await expect(editor(page)).toBeFocused();
  });

  test('shares the workspace without touching the mouse', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);

    const reached = await tabUntil(page, (stop) => /copy share link/i.test(stop.name));
    expect(reached, 'tabbing never reached the share button').toBe(true);
    expect(await focusIsVisible(page)).toBe(true);

    await page.keyboard.press('Enter');

    // The result is announced, not only shown: it is a status region.
    const status = page.getByRole('status').filter({ hasText: /link/i });
    await expect(status.first()).toBeVisible();
  });

  test('every control on the opening screen can be reached, and focus is always visible', async ({
    page,
  }) => {
    await openApp(page);
    await settle(page);

    const seen: string[] = [];
    const invisible: string[] = [];

    await tabThrough(page, async (stop) => {
      seen.push(`${stop.tag}:${stop.role}:${stop.name}`.toLowerCase());

      // Every stop in the tab order must show where focus is (WCAG 2.4.7),
      // with two exceptions that are not the page's to answer for: the editor
      // marks focus on its wrapper rather than on the focused content element,
      // and `body` is where focus rests when Tab leaves the document for the
      // browser's own chrome.
      if (stop.tag === 'body' || stop.className.includes('cm-content')) return;
      if (!(await focusIsVisible(page))) invisible.push(`${stop.tag}: ${stop.name}`);
    });

    const names = seen.join(' | ');
    for (const expected of ['skip to workspace', 'import project', 'reset', 'diagram', 'outline']) {
      expect(names, `nothing in the tab order was "${expected}"`).toContain(expected);
    }
    expect(invisible).toEqual([]);
  });
});
