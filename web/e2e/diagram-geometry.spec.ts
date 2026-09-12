import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { editor, openApp } from './app';

/**
 * Nothing in the diagram draws on top of anything else. Measured on the
 * rendered page, because that is where an overlap is seen: box against box,
 * content against its own box, arrows against boxes and names, labels
 * against everything.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const fixture = (path: string) => readFileSync(join(FIXTURES, path), 'utf8');

const WORKSPACES: Record<string, string | null> = {
  'the starter example': null,
  'networking with many connections': fixture('diagram/networking.tf'),
  'long names': fixture('diagram/long-names.tf'),
  'every badge at once': fixture('diagram/badges.tf'),
  'three cloud providers': fixture('diagram/multi-cloud.tf'),
  'a summarised thousand-resource workspace': fixture('perf/1000.tf'),
};

async function load(page: Page, source: string | null) {
  await openApp(page);
  if (source !== null) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), source);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.getByText('Analyzing…')).toBeHidden({ timeout: 60_000 });
    await page.waitForTimeout(1500);
  }
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(500);
}

/** Every overlap on the page, described so a failure says what hit what. */
function findOverlaps(page: Page) {
  return page.evaluate(() => {
    type Box = { x: number; y: number; w: number; h: number };
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const overlap = (a: Box, b: Box) =>
      a.x + a.w - 1 > b.x && b.x + b.w - 1 > a.x && a.y + a.h - 1 > b.y && b.y + b.h - 1 > a.y;
    const within = (outer: Box, inner: Box) =>
      inner.x >= outer.x - 1 &&
      inner.y >= outer.y - 1 &&
      inner.x + inner.w <= outer.x + outer.w + 1 &&
      inner.y + inner.h <= outer.y + outer.h + 1;
    const inside = (x: number, y: number, b: Box, margin: number) =>
      x > b.x + margin && x < b.x + b.w - margin && y > b.y + margin && y < b.y + b.h - margin;

    const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((el) => ({
      id: el.dataset.id ?? '',
      el,
      box: box(el),
      leaf: !el.classList.contains('parent'),
    }));
    const headers = [...document.querySelectorAll('.dg-container-header')].map(box);
    const labels = [...document.querySelectorAll<HTMLElement>('.dg-edge-label')].map((el) => ({
      text: el.textContent ?? '',
      el,
      box: box(el),
    }));

    const problems: string[] = [];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        if (within(a.box, b.box) || within(b.box, a.box)) continue;
        if (overlap(a.box, b.box)) problems.push(`box ${a.id} overlaps box ${b.id}`);
      }
    }

    for (const node of nodes) {
      const content = node.el.querySelectorAll(
        '.dg-container-header > *, .dg-resource > :not(.react-flow__handle), .dg-folded',
      );
      for (const child of content) {
        const b = box(child);
        if (b.w > 0 && !within(node.box, b)) problems.push(`content spills out of ${node.id}`);
      }
      for (const name of node.el.querySelectorAll<HTMLElement>('.dg-label')) {
        if (name.scrollWidth > name.clientWidth + 1 && !name.title) {
          problems.push(`name in ${node.id} is cut off with no way to read it`);
        }
      }
    }

    for (const label of labels) {
      for (const node of nodes) {
        if (node.leaf && overlap(label.box, node.box))
          problems.push(`label "${label.text}" covers ${node.id}`);
        if (!node.leaf && overlap(label.box, node.box) && !within(node.box, label.box)) {
          problems.push(`label "${label.text}" straddles the border of ${node.id}`);
        }
      }
      for (const header of headers) {
        if (overlap(label.box, header))
          problems.push(`label "${label.text}" covers a container name`);
      }
      // Labels ignore the pointer, so hit-testing needs them to take it briefly.
      label.el.style.pointerEvents = 'auto';
      const centre = document.elementFromPoint(
        label.box.x + label.box.w / 2,
        label.box.y + label.box.h / 2,
      );
      label.el.style.pointerEvents = '';
      if (!centre || !label.el.contains(centre))
        problems.push(`label "${label.text}" is painted over`);
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (overlap(labels[i]!.box, labels[j]!.box)) {
          problems.push(`label "${labels[i]!.text}" overlaps label "${labels[j]!.text}"`);
        }
      }
    }

    for (const edge of document.querySelectorAll<SVGGElement>('.react-flow__edge')) {
      const path = edge.querySelector<SVGPathElement>('path.react-flow__edge-path');
      const matrix = path?.getScreenCTM();
      if (!path || !matrix) continue;
      const [, from, to] = /^(.+?)->([^#]+)/.exec(edge.getAttribute('data-id') ?? '') ?? [];
      const total = path.getTotalLength();

      for (let s = 0; s <= total; s += 2) {
        const p = path.getPointAtLength(s);
        const x = p.x * matrix.a + p.y * matrix.c + matrix.e;
        const y = p.x * matrix.b + p.y * matrix.d + matrix.f;
        for (const node of nodes) {
          if (!node.leaf) continue;
          const endpoint = node.id === from || node.id === to;
          if (inside(x, y, node.box, endpoint ? 1 : -1)) {
            problems.push(`arrow ${from} → ${to} crosses ${node.id}`);
          }
        }
        for (const header of headers) {
          if (inside(x, y, header, 1))
            problems.push(`arrow ${from} → ${to} crosses a container name`);
        }
      }
    }

    return { problems: [...new Set(problems)], labels: labels.length, nodes: nodes.length };
  });
}

test.describe('diagram geometry', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  for (const [name, source] of Object.entries(WORKSPACES)) {
    test(`nothing overlaps: ${name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await load(page, source);

      const { problems, nodes } = await findOverlaps(page);

      expect(nodes).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  }

  // Dropping a label is allowed when there is no room; dropping them all is
  // not a fix, so the workspaces with connections must still show some.
  test('connections keep their labels where there is room', async ({ page }) => {
    for (const source of [null, WORKSPACES['networking with many connections']!]) {
      await load(page, source);
      expect((await findOverlaps(page)).labels).toBeGreaterThan(0);
    }
  });
});
