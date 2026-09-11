import awsVpc from '../../../schemas/examples/aws-vpc.json';

import type { InfraModel, InfraNode } from '../model';
import { absoluteBoxes, layout, METRICS } from './layout';

function node(overrides: Partial<InfraNode> & { id: string }): InfraNode {
  return {
    address: overrides.id,
    type: 'aws_instance',
    provider: 'aws',
    category: 'compute',
    label: overrides.id,
    isContainer: false,
    unplaced: false,
    catalogued: true,
    attributes: {},
    source: { file: 'main.tf', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    ...overrides,
  };
}

function model(nodes: InfraNode[]): InfraModel {
  return {
    schemaVersion: 1,
    nodes,
    edges: [],
    diagnostics: [],
    stats: { files: 1, resources: nodes.length, durationMs: 0, truncated: false },
  };
}

describe('nesting', () => {
  it('places children inside their parent', () => {
    const result = layout(
      model([
        node({ id: 'vpc', isContainer: true, category: 'network', label: 'main' }),
        node({ id: 'subnet', parentId: 'vpc', isContainer: true, category: 'network', label: 'a' }),
        node({ id: 'instance', parentId: 'subnet', label: 'web' }),
      ]),
    );

    const vpc = result.boxes.get('vpc')!;
    const subnet = result.boxes.get('subnet')!;
    const instance = result.boxes.get('instance')!;

    // Coordinates are parent-relative, so containment shows up as the child
    // fitting inside its parent's box rather than as overlapping rectangles.
    expect(subnet.x + subnet.width).toBeLessThanOrEqual(vpc.width);
    expect(subnet.y + subnet.height).toBeLessThanOrEqual(vpc.height);
    expect(instance.x + instance.width).toBeLessThanOrEqual(subnet.width);
  });

  it('sizes a container to fit what it holds', () => {
    const one = layout(
      model([
        node({ id: 'vpc', isContainer: true }),
        node({ id: 'a', parentId: 'vpc', label: 'a' }),
      ]),
    );
    const three = layout(
      model([
        node({ id: 'vpc', isContainer: true }),
        node({ id: 'a', parentId: 'vpc', label: 'a' }),
        node({ id: 'b', parentId: 'vpc', label: 'b' }),
        node({ id: 'c', parentId: 'vpc', label: 'c' }),
      ]),
    );

    expect(three.boxes.get('vpc')!.width).toBeGreaterThan(one.boxes.get('vpc')!.width);
  });

  it('gives an empty container a size of its own', () => {
    const result = layout(model([node({ id: 'vpc', isContainer: true })]));

    const vpc = result.boxes.get('vpc')!;
    expect(vpc.width).toBeGreaterThan(0);
    expect(vpc.height).toBeGreaterThan(0);
  });

  it('emits parents before their children', () => {
    const result = layout(
      model([
        node({ id: 'instance', parentId: 'subnet' }),
        node({ id: 'subnet', parentId: 'vpc', isContainer: true }),
        node({ id: 'vpc', isContainer: true }),
      ]),
    );

    expect(result.order.indexOf('vpc')).toBeLessThan(result.order.indexOf('subnet'));
    expect(result.order.indexOf('subnet')).toBeLessThan(result.order.indexOf('instance'));
  });

  it('records depth so a renderer does not have to walk up', () => {
    const result = layout(
      model([
        node({ id: 'vpc', isContainer: true }),
        node({ id: 'subnet', parentId: 'vpc', isContainer: true }),
        node({ id: 'instance', parentId: 'subnet' }),
      ]),
    );

    expect(result.boxes.get('vpc')!.depth).toBe(0);
    expect(result.boxes.get('subnet')!.depth).toBe(1);
    expect(result.boxes.get('instance')!.depth).toBe(2);
  });
});

// Identical input must produce identical output, whatever order the analyzer
// happened to emit nodes in.
describe('determinism', () => {
  it('does not depend on the order nodes arrive in', () => {
    const nodes = [
      node({ id: 'vpc', isContainer: true }),
      node({ id: 'a', parentId: 'vpc', label: 'a' }),
      node({ id: 'b', parentId: 'vpc', label: 'b' }),
      node({ id: 'c', parentId: 'vpc', label: 'c' }),
    ];

    const forward = layout(model(nodes));
    const reversed = layout(model([...nodes].reverse()));

    for (const id of ['vpc', 'a', 'b', 'c']) {
      expect(reversed.boxes.get(id)).toEqual(forward.boxes.get(id));
    }
  });

  it('produces the same result every time', () => {
    const input = model([
      node({ id: 'vpc', isContainer: true }),
      node({ id: 'a', parentId: 'vpc', label: 'a' }),
      node({ id: 'b', parentId: 'vpc', label: 'b' }),
    ]);

    const first = layout(input);
    for (let i = 0; i < 5; i++) {
      expect(layout(input).boxes).toEqual(first.boxes);
    }
  });
});

// The reason for a hand-written layout in the first place: a diagram that
// reshuffles while somebody types destroys the link between what they wrote
// and what changed.
describe('stability while typing', () => {
  it('does not move existing siblings when one is appended', () => {
    const before = layout(
      model([
        node({ id: 'vpc', isContainer: true }),
        node({ id: 'a', parentId: 'vpc', label: 'a' }),
        node({ id: 'b', parentId: 'vpc', label: 'b' }),
      ]),
    );
    const after = layout(
      model([
        node({ id: 'vpc', isContainer: true }),
        node({ id: 'a', parentId: 'vpc', label: 'a' }),
        node({ id: 'b', parentId: 'vpc', label: 'b' }),
        node({ id: 'c', parentId: 'vpc', label: 'c' }),
      ]),
    );

    expect(after.boxes.get('a')).toEqual(before.boxes.get('a'));
    expect(after.boxes.get('b')).toEqual(before.boxes.get('b'));
  });

  it('does not move a sibling container when another one grows', () => {
    const base = [
      node({ id: 'left', isContainer: true, label: 'a-left' }),
      node({ id: 'right', isContainer: true, label: 'b-right' }),
      node({ id: 'x', parentId: 'right', label: 'x' }),
    ];

    const before = layout(model(base));
    const after = layout(model([...base, node({ id: 'y', parentId: 'right', label: 'y' })]));

    // The left container is untouched by anything happening on the right.
    expect(after.boxes.get('left')).toEqual(before.boxes.get('left'));
  });
});

describe('unplaced nodes', () => {
  it('lays them out after everything that could be placed', () => {
    const result = layout(
      model([
        node({ id: 'orphan', unplaced: true, catalogued: false, label: 'orphan' }),
        node({ id: 'vpc', isContainer: true, label: 'vpc' }),
      ]),
    );

    const orphan = result.boxes.get('orphan')!;
    const vpc = result.boxes.get('vpc')!;
    expect(orphan.y).toBeGreaterThanOrEqual(vpc.y + vpc.height);
  });
});

describe('robustness', () => {
  it('lays out an empty model', () => {
    const result = layout(model([]));

    expect(result.boxes.size).toBe(0);
    expect(result.width).toBe(0);
  });

  // A producer emitting an inconsistent model should cost us a parent
  // relationship, not the node itself.
  it('treats a missing parent as no parent rather than dropping the node', () => {
    const result = layout(model([node({ id: 'lonely', parentId: 'does-not-exist' })]));

    expect(result.boxes.has('lonely')).toBe(true);
  });

  it('handles deep nesting without losing anything', () => {
    const nodes: InfraNode[] = [];
    for (let depth = 0; depth < 40; depth++) {
      nodes.push(
        node({
          id: `n${depth}`,
          isContainer: true,
          ...(depth > 0 ? { parentId: `n${depth - 1}` } : {}),
        }),
      );
    }

    const result = layout(model(nodes));
    expect(result.boxes.size).toBe(40);
    expect(result.boxes.get('n39')!.depth).toBe(39);
  });
});

describe('absolute boxes', () => {
  it('accumulates offsets down the tree', () => {
    const input = model([
      node({ id: 'vpc', isContainer: true }),
      node({ id: 'subnet', parentId: 'vpc', isContainer: true }),
      node({ id: 'instance', parentId: 'subnet' }),
    ]);
    const result = layout(input);
    const absolute = absoluteBoxes(result, input);

    expect(absolute.get('vpc')).toEqual(result.boxes.get('vpc'));
    expect(absolute.get('instance')!.x).toBe(
      result.boxes.get('instance')!.x + result.boxes.get('subnet')!.x + result.boxes.get('vpc')!.x,
    );
  });
});

describe('folded containers', () => {
  it('are tall enough for the button they render', () => {
    const input = model([node({ id: 'vpc', isContainer: true })]);
    const result = layout(input, { folded: new Set(['vpc']) });

    expect(result.boxes.get('vpc')!.height).toBe(METRICS.foldedContainerHeight);
    expect(METRICS.foldedContainerHeight).toBeGreaterThan(METRICS.emptyContainerHeight);
  });
});

// The shared example is the same one the Go tests validate, so a layout that
// cannot handle it would be a contract problem rather than a layout problem.
describe('the shared example', () => {
  it('lays out every node', () => {
    const result = layout(awsVpc as InfraModel);

    for (const item of (awsVpc as InfraModel).nodes) {
      expect(result.boxes.has(item.id)).toBe(true);
    }
    expect(result.width).toBeGreaterThan(METRICS.leafWidth);
  });
});
