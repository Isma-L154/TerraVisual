import awsVpc from '../../../schemas/examples/aws-vpc.json';

import type { InfraModel, InfraNode } from '../model';
import { layout } from '../layout/layout';
import { displayType } from './catalog';
import { countUnknown, toFlow } from './toFlow';

const example = awsVpc as InfraModel;

describe('model to flow nodes', () => {
  it('renders every node in the model', () => {
    expect(toFlow(example).nodes).toHaveLength(example.nodes.length);
  });

  it('uses the container type for containers and the resource type for leaves', () => {
    const byId = new Map(toFlow(example).nodes.map((node) => [node.id, node]));

    expect(byId.get('aws_vpc.main')!.type).toBe('container');
    expect(byId.get('aws_instance.web[0]')!.type).toBe('resource');
  });

  it('carries the parent relationship across so React Flow nests them', () => {
    const byId = new Map(toFlow(example).nodes.map((node) => [node.id, node]));

    expect(byId.get('aws_subnet.public')!.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_instance.web[0]')!.parentId).toBe('aws_subnet.public');
    expect(byId.get('aws_vpc.main')!.parentId).toBeUndefined();
  });

  it('emits parents before children', () => {
    const seen = new Set<string>();

    for (const node of toFlow(example).nodes) {
      if (node.parentId) expect(seen.has(node.parentId)).toBe(true);
      seen.add(node.id);
    }
  });

  it('does not let nodes be dragged out of their containers', () => {
    for (const node of toFlow(example).nodes) {
      expect(node.draggable).toBe(false);
      if (node.parentId) expect(node.extent).toBe('parent');
    }
  });

  it('sizes each node from the layout', () => {
    const computed = layout(example);

    for (const node of toFlow(example).nodes) {
      const box = computed.boxes.get(node.id)!;
      expect(node.style).toMatchObject({ width: box.width, height: box.height });
      expect(node.position).toEqual({ x: box.x, y: box.y });
    }
  });

  it('produces nothing for an empty model', () => {
    expect(toFlow({ ...example, nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });
});

describe('model to flow edges', () => {
  // The example's own edge points at a node it does not contain, so it is
  // retargeted at one it does.
  const connected: InfraModel = {
    ...example,
    edges: example.edges.map((edge) => ({ ...edge, to: 'some_exotic_thing.x' })),
  };

  it('drops a connection to a node that is not drawn', () => {
    expect(toFlow(example).edges).toHaveLength(0);
  });

  it('routes every drawn connection', () => {
    const { edges } = toFlow(connected);

    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe('routed');
    expect(edges[0]!.data!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('names each arrow for assistive technology, label included', () => {
    const [edge] = toFlow(connected).edges;

    expect(edge!.ariaLabel).toBe(`web connects to x (${edge!.data!.label})`);
  });
});

describe('unknown values', () => {
  it('counts the attributes that could not be determined', () => {
    const node = example.nodes.find((item) => item.id === 'aws_instance.web[0]')!;

    expect(countUnknown(node)).toBe(1);
  });

  it('counts nothing when everything resolved', () => {
    const node = example.nodes.find((item) => item.id === 'aws_vpc.main')!;

    expect(countUnknown(node)).toBe(0);
  });

  it('surfaces the count on the node data', () => {
    const instance = toFlow(example).nodes.find((node) => node.id === 'aws_instance.web[0]')!;

    expect(instance.data.unknownCount).toBe(1);
  });
});

describe('catalog presentation', () => {
  it('names types the way a person would', () => {
    expect(displayType('aws_db_instance')).toBe('RDS Instance');
    expect(displayType('aws_instance')).toBe('EC2 Instance');
  });

  it('falls back to the raw type for something uncatalogued', () => {
    expect(displayType('some_exotic_thing')).toBe('some_exotic_thing');
  });

  // Also proves the catalogs were discovered at all: a broken glob leaves
  // every type falling back to its raw name.
  it('names types from every provider', () => {
    expect(displayType('azurerm_virtual_network')).toBe('Virtual Network');
    expect(displayType('google_compute_instance')).toBe('Compute Instance');
  });
});

describe('uncatalogued nodes', () => {
  it('keeps them in the diagram', () => {
    const exotic = toFlow(example).nodes.find((node) => node.id === 'some_exotic_thing.x');

    expect(exotic).toBeDefined();
    expect((exotic!.data.node as InfraNode).catalogued).toBe(false);
  });
});
