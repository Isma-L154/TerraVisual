import type { InfraModel, InfraNode } from '../model';
import { summarise } from './summarise';

/**
 * A model shaped like real infrastructure: one provider, one region, and a
 * number of VPCs each holding a number of subnets each holding instances.
 */
function infrastructure(
  vpcs: number,
  subnetsPerVpc: number,
  instancesPerSubnet: number,
): InfraModel {
  const nodes: InfraNode[] = [node('provider.aws', 'aws', 'provider', undefined)];
  nodes.push(node('region.eu', 'eu-west-1', 'region', 'provider.aws'));

  for (let v = 0; v < vpcs; v++) {
    const vpc = `aws_vpc.v${v}`;
    nodes.push(node(vpc, `v${v}`, 'aws_vpc', 'region.eu'));

    for (let s = 0; s < subnetsPerVpc; s++) {
      const subnet = `aws_subnet.v${v}s${s}`;
      nodes.push(node(subnet, `v${v}s${s}`, 'aws_subnet', vpc));

      for (let i = 0; i < instancesPerSubnet; i++) {
        nodes.push(node(`aws_instance.v${v}s${s}i${i}`, `i${i}`, 'aws_instance', subnet, false));
      }
    }
  }

  return {
    schemaVersion: 1,
    nodes,
    edges: [],
    diagnostics: [],
    stats: { resources: nodes.length, modules: 0, edges: 0, truncated: false },
  } as unknown as InfraModel;
}

function node(
  id: string,
  label: string,
  type: string,
  parentId: string | undefined,
  isContainer = true,
): InfraNode {
  return {
    id,
    address: id,
    type,
    provider: 'aws',
    category: 'network',
    label,
    isContainer,
    ...(parentId ? { parentId } : {}),
    unplaced: false,
    catalogued: true,
    attributes: {},
    source: { file: 'main.tf', startLine: 1, startCol: 1, endLine: 2, endCol: 2 },
  } as unknown as InfraNode;
}

describe('small models', () => {
  it('draws everything when there is no reason not to', () => {
    const model = infrastructure(2, 2, 2);
    const summary = summarise(model, { budget: 400 });

    expect(summary.nodes).toBe(model.nodes);
    expect(summary.hidden.size).toBe(0);
    expect(summary.hiddenTotal).toBe(0);
  });
});

describe('large models', () => {
  // 1 provider + 1 region + 10 VPCs + 100 subnets + 1000 instances = 1112.
  const model = infrastructure(10, 10, 10);

  it('draws no more than the budget allows', () => {
    const summary = summarise(model, { budget: 120 });

    expect(model.nodes.length).toBeGreaterThan(1000);
    expect(summary.nodes.length).toBeLessThanOrEqual(120);
  });

  it('keeps the top of the tree, which is the shape somebody is looking for', () => {
    const summary = summarise(model, { budget: 120 });
    const drawn = new Set(summary.nodes.map((n) => n.id));

    expect(drawn.has('provider.aws')).toBe(true);
    expect(drawn.has('region.eu')).toBe(true);
    for (let v = 0; v < 10; v++) expect(drawn.has(`aws_vpc.v${v}`)).toBe(true);
  });

  // "Three of forty-seven subnets" invites the reader to believe they are
  // looking at three subnets. A container shows its children or says how many.
  it('never draws part of a container', () => {
    expectWholeKinds(model, summarise(model, { budget: 120 }));
  });

  it('counts every descendant it is holding, not just the direct children', () => {
    const summary = summarise(model, { budget: 120 });

    expect(summary.hidden.size).toBeGreaterThan(0);

    for (const [id, count] of summary.hidden) {
      expect(count).toBe(trueDescendantCount(model, id));
    }

    expect(summary.nodes.length + summary.hiddenTotal).toBe(model.nodes.length);
  });

  it('says how much it folded away, so the interface can be honest about it', () => {
    const summary = summarise(model, { budget: 120 });

    expect(summary.hiddenTotal).toBeGreaterThan(0);
    expect(summary.hidden.size).toBeGreaterThan(0);
  });

  // The whole point of ADR-0003 is that boxes do not move on their own. A
  // summary that reshuffled between two analyses of identical code would undo
  // that at the last step.
  it('makes the same choices for the same model', () => {
    const first = summarise(model, { budget: 120 });
    const second = summarise(model, { budget: 120 });

    expect(second.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id));
    expect([...second.hidden.keys()]).toEqual([...first.hidden.keys()]);
  });

  it('folds the deepest level rather than the most useful one', () => {
    // With this budget the providers, regions, VPCs and subnets all fit; it is
    // the instances inside the subnets that do not. Folding a VPC would hide
    // the structure somebody came to see, and folding a subnet hides a list.
    const summary = summarise(model, { budget: 120 });
    const drawn = new Set(summary.nodes.map((n) => n.id));

    for (let v = 0; v < 10; v++) {
      expect(drawn.has(`aws_vpc.v${v}`)).toBe(true);
      expect(drawn.has(`aws_subnet.v${v}s0`)).toBe(true);
    }
    expect([...summary.hidden.keys()].every((id) => id.startsWith('aws_subnet.'))).toBe(true);
  });

  it('opens what the user asked to open, budget or not', () => {
    const closed = summarise(model, { budget: 120 });
    const folded = [...closed.hidden.keys()][0];
    expect(folded).toBeDefined();

    const opened = summarise(model, { budget: 120, expanded: new Set([folded!]) });
    const drawn = new Set(opened.nodes.map((n) => n.id));

    // Its children are now on screen, and it is no longer reported as folded.
    const kids = model.nodes.filter((n) => n.parentId === folded);
    expect(kids.length).toBeGreaterThan(0);
    for (const kid of kids) expect(drawn.has(kid.id)).toBe(true);
    expect(opened.hidden.has(folded!)).toBe(false);

    // Somebody who opens something has made a choice about their own machine.
    expect(opened.nodes.length).toBeGreaterThan(closed.nodes.length);
  });
});

describe('regions crowded with loose resources', () => {
  // Buckets, functions and roles belong to no network, so they sit directly in
  // the region. Enough of them used to fold the region itself, and a thousand-
  // resource workspace became two boxes (#117).
  const crowded = withLooseResources(infrastructure(20, 2, 0), 500);

  it('keeps the networks and folds the loose resources', () => {
    const summary = summarise(crowded, { budget: 400 });
    const drawn = new Set(summary.nodes.map((n) => n.id));

    for (let v = 0; v < 20; v++) expect(drawn.has(`aws_vpc.v${v}`)).toBe(true);
    expect(drawn.has('aws_s3_bucket.b0')).toBe(false);
    expect(summary.hidden.get('region.eu')).toBe(500);
  });

  it('still shows each kind of child whole or not at all', () => {
    expectWholeKinds(crowded, summarise(crowded, { budget: 400 }));
  });

  it('counts every hidden resource exactly once', () => {
    for (const budget of [30, 60, 400]) {
      const summary = summarise(crowded, { budget });
      const counted = [...summary.hidden.values()].reduce((a, b) => a + b, 0);

      expect(counted).toBe(summary.hiddenTotal);
      expect(summary.nodes.length + summary.hiddenTotal).toBe(crowded.nodes.length);
    }
  });

  it('folds the region whole when even its networks do not fit', () => {
    const summary = summarise(crowded, { budget: 10 });

    expect(summary.nodes.map((n) => n.id)).toEqual(['provider.aws', 'region.eu']);
    expect(summary.hidden.get('region.eu')).toBe(crowded.nodes.length - 2);
  });
});

describe('models that are strange rather than large', () => {
  it('draws every root even when there are more of them than the budget', () => {
    // Nothing above a root to fold it into, so the budget cannot help. Drawing
    // them is better than drawing an arbitrary subset.
    const nodes = Array.from({ length: 50 }, (_, i) =>
      node(`r${i}`, `r${i}`, 'aws_vpc', undefined),
    );
    const model = { ...infrastructure(0, 0, 0), nodes } as InfraModel;

    const summary = summarise(model, { budget: 10 });

    expect(summary.nodes.length).toBe(50);
  });

  it('ignores a parent that is not in the model', () => {
    const orphan = node('aws_subnet.orphan', 'orphan', 'aws_subnet', 'aws_vpc.missing');
    const model = infrastructure(1, 1, 1);
    const withOrphan = { ...model, nodes: [...model.nodes, orphan] } as InfraModel;

    const summary = summarise(withOrphan, { budget: 400 });

    expect(summary.nodes.map((n) => n.id)).toContain('aws_subnet.orphan');
  });
});

/** Adds resources that belong to no network, straight under the region. */
function withLooseResources(model: InfraModel, count: number): InfraModel {
  const loose = Array.from({ length: count }, (_, i) =>
    node(`aws_s3_bucket.b${i}`, `b${i}`, 'aws_s3_bucket', 'region.eu', false),
  );
  return { ...model, nodes: [...model.nodes, ...loose] } as InfraModel;
}

/**
 * Of a drawn node's children, the containers are all drawn or none are, and
 * so are the leaves; anything left out is counted on the node.
 */
function expectWholeKinds(model: InfraModel, summary: ReturnType<typeof summarise>) {
  const drawn = new Set(summary.nodes.map((n) => n.id));

  for (const parent of summary.nodes) {
    const kids = model.nodes.filter((n) => n.parentId === parent.id);
    for (const kind of [true, false]) {
      const group = kids.filter((kid) => kid.isContainer === kind);
      const shown = group.filter((kid) => drawn.has(kid.id)).length;
      expect(shown === 0 || shown === group.length).toBe(true);
    }
    if (kids.some((kid) => !drawn.has(kid.id))) expect(summary.hidden.has(parent.id)).toBe(true);
  }
}

/** Counts descendants independently of the implementation being tested. */
function trueDescendantCount(model: InfraModel, id: string): number {
  const kids = model.nodes.filter((node) => node.parentId === id);
  return kids.reduce((total, kid) => total + 1 + trueDescendantCount(model, kid.id), 0);
}
