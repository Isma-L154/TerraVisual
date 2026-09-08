import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import awsVpc from '../../../schemas/examples/aws-vpc.json';
import type { InfraModel } from '../model';
import { Outline } from './Outline';
import { buildTree, countItems, describe as describeItem, visibleItems } from './tree';

const example = awsVpc as InfraModel;

/**
 * Two VPCs, each with one subnet.
 *
 * The shape matters: the subnets share a level but not a parent, which is the
 * only arrangement where counting by depth and counting by parent disagree.
 */
const twoVpcs: InfraModel = {
  ...example,
  nodes: [
    vpc('aws_vpc.a', 'a'),
    subnet('aws_subnet.a-public', 'a-public', 'aws_vpc.a'),
    vpc('aws_vpc.b', 'b'),
    subnet('aws_subnet.b-public', 'b-public', 'aws_vpc.b'),
  ],
  edges: [],
};

function vpc(id: string, label: string) {
  return { ...base(id, label), type: 'aws_vpc', isContainer: true };
}

function subnet(id: string, label: string, parentId: string) {
  return { ...base(id, label), type: 'aws_subnet', isContainer: true, parentId };
}

function base(id: string, label: string) {
  return {
    id,
    address: id,
    type: 'aws_vpc',
    provider: 'aws',
    category: 'network' as const,
    label,
    isContainer: false,
    unplaced: false,
    catalogued: true,
    attributes: {},
    source: { file: 'main.tf', startLine: 1, startCol: 1, endLine: 3, endCol: 2 },
  };
}

function renderOutline(model: InfraModel | null = example, selectedId: string | null = null) {
  const onSelect = vi.fn();
  const result = render(<Outline model={model} selectedId={selectedId} onSelect={onSelect} />);
  return { ...result, onSelect };
}

describe('tree building', () => {
  it('nests containment the same way the diagram does', () => {
    const tree = buildTree(example);
    const vpc = tree.find((item) => item.node.id === 'aws_vpc.main');

    // The fixture has no provider frame, so the VPC is itself a root.
    expect(tree).toHaveLength(2); // the VPC, plus the resource that could not be placed
    expect(vpc?.children.map((child) => child.node.id)).toEqual(['aws_subnet.public']);
    expect(vpc?.children[0]?.children.map((child) => child.node.id)).toEqual([
      'aws_instance.web[0]',
    ]);
  });

  it('includes every node exactly once', () => {
    expect(countItems(buildTree(example))).toBe(example.nodes.length);
  });

  it('puts unplaced nodes last', () => {
    const tree = buildTree(example);

    expect(tree[tree.length - 1]!.node.unplaced).toBe(true);
  });

  it('hides the children of a collapsed branch', () => {
    const tree = buildTree(example);
    const all = visibleItems(tree, new Set());
    const collapsed = visibleItems(tree, new Set(['aws_vpc.main']));

    expect(collapsed.length).toBeLessThan(all.length);
    expect(collapsed.some((item) => item.node.id === 'aws_subnet.public')).toBe(false);
  });
});

// The announcement is the outline's actual content. Reading "aws_instance.web"
// aloud tells somebody almost nothing.
describe('announcements', () => {
  const tree = buildTree(example);
  const items = visibleItems(tree, new Set());
  const find = (id: string) => items.find((item) => item.node.id === id)!;

  it('names the kind of thing, not just the identifier', () => {
    expect(describeItem(find('aws_instance.web[0]'))).toContain('EC2 Instance');
  });

  it('says where something sits', () => {
    const subnet = example.nodes.find((node) => node.id === 'aws_subnet.public')!;

    expect(describeItem(find('aws_instance.web[0]'), subnet)).toContain('in public');
  });

  it('says how many values could not be determined', () => {
    expect(describeItem(find('aws_instance.web[0]'))).toContain('1 value not determinable');
  });

  it('says when a resource type is not catalogued', () => {
    expect(describeItem(find('some_exotic_thing.x'))).toContain('not in the catalog');
  });

  it('says when something could not be placed', () => {
    expect(describeItem(find('some_exotic_thing.x'))).toContain('could not be placed');
  });

  it('says how many things a container holds', () => {
    expect(describeItem(find('aws_vpc.main'))).toContain('contains 1');
  });
});

describe('tree semantics', () => {
  it('is a tree with items at the right levels', () => {
    renderOutline();

    const tree = screen.getByRole('tree', { name: /infrastructure outline/i });
    const items = within(tree).getAllByRole('treeitem');

    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.getAttribute('aria-level') === '1')).toBe(true);
    expect(items.some((item) => item.getAttribute('aria-level') === '2')).toBe(true);
  });

  it('marks branches as expanded and leaves as neither', () => {
    renderOutline();

    const branch = screen.getByRole('treeitem', { name: /main, VPC/i });
    const leaf = screen.getByRole('treeitem', { name: /web, EC2 Instance/i });

    expect(branch).toHaveAttribute('aria-expanded', 'true');
    expect(leaf).not.toHaveAttribute('aria-expanded');
  });

  it('marks the selected item', () => {
    renderOutline(example, 'aws_instance.web[0]');

    expect(screen.getByRole('treeitem', { name: /web, EC2 Instance/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  // A screen reader announces "2 of 5" from these attributes, so counting the
  // wrong set is not a detail: it tells somebody navigating by ear that there
  // are things beside this one which are not there.
  it('counts siblings within their parent, not everything at the same depth', () => {
    render(<Outline model={twoVpcs} selectedId={null} onSelect={vi.fn()} />);

    const first = screen.getByRole('treeitem', { name: /a-public/i });
    const second = screen.getByRole('treeitem', { name: /b-public/i });

    // Each subnet is an only child, even though both sit at level 2.
    for (const item of [first, second]) {
      expect(item).toHaveAttribute('aria-level', '2');
      expect(item).toHaveAttribute('aria-setsize', '1');
      expect(item).toHaveAttribute('aria-posinset', '1');
    }
  });

  // One tab stop for the whole tree. Making every item tabbable would be
  // easier to write and far worse to use: a hundred-resource project would
  // become a hundred tab stops.
  it('has exactly one tab stop', () => {
    renderOutline();

    const items = screen.getAllByRole('treeitem');
    const tabbable = items.filter((item) => item.getAttribute('tabindex') === '0');

    expect(tabbable).toHaveLength(1);
  });
});

describe('keyboard navigation', () => {
  it('moves down and up with the arrow keys', async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.tab();
    const first = document.activeElement;
    await user.keyboard('{ArrowDown}');
    const second = document.activeElement;

    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('role', 'treeitem');

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
  });

  it('collapses and expands with left and right', async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.tab();
    // The first root is the VPC's container chain; walk to a branch.
    const branch = screen.getByRole('treeitem', { name: /main, VPC/i });
    branch.focus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /main, VPC/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /main, VPC/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('jumps to the first and last item', async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.tab();
    await user.keyboard('{End}');
    const last = document.activeElement;

    await user.keyboard('{Home}');
    expect(document.activeElement).not.toBe(last);
  });

  it('selects with Enter and with Space', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderOutline();

    screen.getByRole('treeitem', { name: /web, EC2 Instance/i }).focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('aws_instance.web[0]');

    onSelect.mockClear();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledWith('aws_instance.web[0]');
  });
});

describe('empty states', () => {
  it('says what it is waiting for before the first analysis', () => {
    renderOutline(null);

    expect(screen.getByTestId('outline-waiting')).toBeInTheDocument();
  });

  it('says plainly when there is no infrastructure', () => {
    renderOutline({ ...example, nodes: [] });

    expect(screen.getByTestId('outline-empty')).toBeInTheDocument();
  });
});
