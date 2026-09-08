import awsVpc from '../../../schemas/examples/aws-vpc.json';

import type { InfraModel, InfraNode } from '../model';
import { catalogSize, displayType } from './catalog';
import { countUnknown, toFlowNodes } from './toFlow';

const example = awsVpc as InfraModel;

describe('model to flow nodes', () => {
  it('renders every node in the model', () => {
    const { nodes } = toFlowNodes(example);

    expect(nodes).toHaveLength(example.nodes.length);
  });

  it('uses the container type for containers and the resource type for leaves', () => {
    const { nodes } = toFlowNodes(example);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get('aws_vpc.main')!.type).toBe('container');
    expect(byId.get('aws_instance.web[0]')!.type).toBe('resource');
  });

  it('carries the parent relationship across so React Flow nests them', () => {
    const { nodes } = toFlowNodes(example);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get('aws_subnet.public')!.parentId).toBe('aws_vpc.main');
    expect(byId.get('aws_instance.web[0]')!.parentId).toBe('aws_subnet.public');
    expect(byId.get('aws_vpc.main')!.parentId).toBeUndefined();
  });

  // React Flow needs a parent before its children, and so does anything else
  // building a tree in one pass. The layout already guarantees that order, so
  // reusing it keeps one definition of what nests in what.
  it('emits parents before children', () => {
    const { nodes } = toFlowNodes(example);
    const seen = new Set<string>();

    for (const node of nodes) {
      if (node.parentId) expect(seen.has(node.parentId)).toBe(true);
      seen.add(node.id);
    }
  });

  // A node the user can drag out of its subnet would show something the
  // Terraform does not say. The diagram reports; it does not invite editing.
  it('does not let nodes be dragged out of their containers', () => {
    const { nodes } = toFlowNodes(example);

    for (const node of nodes) {
      expect(node.draggable).toBe(false);
      if (node.parentId) expect(node.extent).toBe('parent');
    }
  });

  it('sizes each node from the layout', () => {
    const { nodes, layout } = toFlowNodes(example);

    for (const node of nodes) {
      const box = layout.boxes.get(node.id)!;
      expect(node.style).toMatchObject({ width: box.width, height: box.height });
      expect(node.position).toEqual({ x: box.x, y: box.y });
    }
  });

  it('produces nothing for an empty model', () => {
    const { nodes } = toFlowNodes({ ...example, nodes: [] });

    expect(nodes).toHaveLength(0);
  });
});

// "Unknown" is a first-class state in this model. A diagram that rendered
// undeterminable values as blank would quietly undo that at the last step.
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
    const { nodes } = toFlowNodes(example);
    const instance = nodes.find((node) => node.id === 'aws_instance.web[0]')!;

    expect(instance.data.unknownCount).toBe(1);
  });
});

describe('catalog presentation', () => {
  it('names types the way a person would', () => {
    expect(displayType('aws_db_instance')).toBe('RDS Instance');
    expect(displayType('aws_instance')).toBe('EC2 Instance');
  });

  // Falling back to the raw type is honest: we genuinely do not know a better
  // name for something nobody has catalogued.
  it('falls back to the raw type for something uncatalogued', () => {
    expect(displayType('some_exotic_thing')).toBe('some_exotic_thing');
  });

  it('reads the same catalog the analyzer does', () => {
    expect(catalogSize()).toBeGreaterThanOrEqual(12);
  });
});

describe('uncatalogued nodes', () => {
  it('keeps them in the diagram', () => {
    const { nodes } = toFlowNodes(example);
    const exotic = nodes.find((node) => node.id === 'some_exotic_thing.x');

    expect(exotic).toBeDefined();
    expect((exotic!.data.node as InfraNode).catalogued).toBe(false);
  });
});
