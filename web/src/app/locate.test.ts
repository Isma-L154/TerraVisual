import type { InfraModel, InfraNode } from '../model';
import { hasSource, nodeAtLine } from './locate';

function node(
  id: string,
  file: string,
  startLine: number,
  endLine: number,
  overrides: Partial<InfraNode> = {},
): InfraNode {
  return {
    id,
    address: id,
    type: 'aws_instance',
    provider: 'aws',
    category: 'compute',
    label: id,
    isContainer: false,
    unplaced: false,
    catalogued: true,
    attributes: {},
    source: { file, startLine, startCol: 1, endLine, endCol: 2 },
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

describe('finding the node at a line', () => {
  const workspace = model([
    node('aws_vpc.main', 'main.tf', 1, 4),
    node('aws_subnet.public', 'main.tf', 6, 9),
    node('aws_s3_bucket.assets', 'storage.tf', 1, 3),
  ]);

  it('finds the node containing the line', () => {
    expect(nodeAtLine(workspace, 'main.tf', 2)).toBe('aws_vpc.main');
    expect(nodeAtLine(workspace, 'main.tf', 7)).toBe('aws_subnet.public');
  });

  it('includes the first and last lines of a definition', () => {
    expect(nodeAtLine(workspace, 'main.tf', 1)).toBe('aws_vpc.main');
    expect(nodeAtLine(workspace, 'main.tf', 4)).toBe('aws_vpc.main');
  });

  it('finds nothing between definitions', () => {
    expect(nodeAtLine(workspace, 'main.tf', 5)).toBeNull();
    expect(nodeAtLine(workspace, 'main.tf', 40)).toBeNull();
  });

  it('respects which file is open', () => {
    expect(nodeAtLine(workspace, 'storage.tf', 2)).toBe('aws_s3_bucket.assets');
    expect(nodeAtLine(workspace, 'storage.tf', 7)).toBeNull();
  });

  // The narrowest range is the most specific answer, and the most specific
  // answer is what somebody means when they put their cursor on a line.
  it('prefers the innermost of several nodes covering the line', () => {
    const nested = model([
      node('module.network', 'main.tf', 1, 20),
      node('aws_vpc.main', 'main.tf', 5, 9),
    ]);

    expect(nodeAtLine(nested, 'main.tf', 7)).toBe('aws_vpc.main');
  });

  // A diagram that flickered between two equally valid answers would be worse
  // than one that consistently picks the same one.
  it('breaks ties the same way every time', () => {
    const tied = model([node('b.second', 'main.tf', 1, 3), node('a.first', 'main.tf', 1, 3)]);

    expect(nodeAtLine(tied, 'main.tf', 2)).toBe('a.first');
    expect(nodeAtLine(model([...tied.nodes].reverse()), 'main.tf', 2)).toBe('a.first');
  });

  it('handles the absence of a model at all', () => {
    expect(nodeAtLine(null, 'main.tf', 1)).toBeNull();
    expect(nodeAtLine(workspace, '', 1)).toBeNull();
    expect(nodeAtLine(workspace, 'main.tf', 0)).toBeNull();
  });

  // Synthetic containers are not written anywhere, so nothing should claim a
  // line on their behalf.
  it('ignores nodes with no source position', () => {
    const synthetic = model([node('provider.aws', '', 0, 0)]);

    expect(nodeAtLine(synthetic, '', 1)).toBeNull();
  });
});

describe('whether a node can be jumped to', () => {
  it('is true for something the user wrote', () => {
    expect(hasSource(node('aws_vpc.main', 'main.tf', 1, 4))).toBe(true);
  });

  it('is false for a synthetic container', () => {
    expect(hasSource(node('provider.aws', '', 0, 0))).toBe(false);
  });
});
