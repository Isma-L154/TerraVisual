import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers shared by the end-to-end tests.
 *
 * Deliberately thin. A page object that hides the accessible name of every
 * control would defeat the purpose of these tests: half of what they assert is
 * that the controls *have* accessible names, so they are addressed by role and
 * name here rather than by CSS selector.
 */

/**
 * Opens the application and waits for the first analysis to finish.
 *
 * The analyzer is WebAssembly fetched and compiled after the page loads, so
 * "loaded" and "ready" are different moments. Everything here waits for ready.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'TerraVisual' })).toBeVisible();
  await expect(page.getByTestId('diagram')).toBeVisible({ timeout: 30_000 });
}

/** The editor's text area, addressed the way a screen reader would find it. */
export function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: /terraform source/i });
}

/**
 * Replaces the workspace file and waits for the new diagram to arrive.
 *
 * `expectedNodes` is not optional decoration. Analysis is debounced and then
 * runs in a worker, so "the status stopped saying Analyzing" can be true before
 * it ever started saying it — a race that made an early version of these tests
 * click on the *previous* diagram and then report the application broken.
 * Waiting for the node count the new source produces is deterministic.
 */
export async function typeWorkspace(
  page: Page,
  source: string,
  expectedNodes: number,
): Promise<void> {
  const area = editor(page);
  await area.click();
  await area.press('ControlOrMeta+a');
  await area.fill(source);

  await expect(page.locator('.react-flow__node')).toHaveCount(expectedNodes, { timeout: 30_000 });
  await settle(page);
}

/** Waits for the analyzer to be idle, once something has already changed. */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByText('Analyzing…')).toBeHidden({ timeout: 30_000 });
}

/** Which element currently has focus, as role and accessible name. */
export async function focused(page: Page): Promise<{ role: string; name: string; tag: string }> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return { role: '', name: '', tag: '' };
    return {
      role: element.getAttribute('role') ?? '',
      name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 80) ?? '',
      tag: element.tagName.toLowerCase(),
    };
  });
}

/**
 * Whether the focused element has a visible focus indicator.
 *
 * Reads the computed style rather than comparing screenshots: an outline that
 * resolves to `none`, or to zero width, is the failure this needs to catch, and
 * a pixel comparison would be both slower and more fragile.
 */
export async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return false;

    const style = getComputedStyle(element);
    const width = parseFloat(style.outlineWidth || '0');
    const hasOutline = style.outlineStyle !== 'none' && width > 0;
    // A box-shadow ring is the usual alternative to an outline, and CodeMirror
    // marks its own focus with a border colour change on the wrapper.
    const hasRing = style.boxShadow !== 'none' && style.boxShadow !== '';

    return hasOutline || hasRing;
  });
}

/**
 * Walks the tab order, one stop at a time.
 *
 * Focus is moved by pressing Tab rather than by calling `focus()`, because the
 * two are not equivalent for the thing being tested: Chrome only matches
 * `:focus-visible` when the focus came from the keyboard, so a scripted
 * `focus()` can report an invisible focus ring that a real user would see, and
 * a visible one they would not.
 *
 * The editor takes Tab for indentation, so this presses Escape first when
 * focus is inside it — which is exactly the documented way out, and therefore
 * worth exercising on every pass.
 */
export async function tabThrough(
  page: Page,
  /** Called at each stop. Return false to stop walking. */
  visit: (stop: TabStop) => boolean | void | Promise<boolean | void>,
  steps = 40,
): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const inEditor = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('.cm-editor')),
    );
    if (inEditor) await page.keyboard.press('Escape');

    await page.keyboard.press('Tab');

    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return { role: '', name: '', tag: '', className: '' };
      return {
        role: element.getAttribute('role') ?? '',
        name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 80),
        tag: element.tagName.toLowerCase(),
        className: element.className?.toString() ?? '',
      };
    });

    if ((await visit(stop)) === false) return;
  }
}

export type TabStop = { role: string; name: string; tag: string; className: string };

/** Tabs until the focused element matches, and says whether it got there. */
export async function tabUntil(
  page: Page,
  matches: (stop: TabStop) => boolean,
  steps = 40,
): Promise<boolean> {
  let found = false;
  await tabThrough(
    page,
    (stop) => {
      if (matches(stop)) {
        found = true;
        return false;
      }
      return true;
    },
    steps,
  );
  return found;
}

/** Terraform that produces a diagnostic, for the "fix a problem" journey. */
export const BROKEN_SOURCE = `resource "aws_vpc" "main" {
  cidr_block = var.does_not_exist
}
`;

/** A small, valid workspace with containment and a connection. */
export const SIMPLE_SOURCE = `provider "aws" {
  region = "eu-west-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`;
