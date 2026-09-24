import { outerBounds } from './camera';
import type { DiagramNode } from './toFlow';

function box(id: string, x: number, y: number, width: number, height: number, parentId?: string) {
  return {
    id,
    position: { x, y },
    style: { width, height },
    data: {},
    ...(parentId ? { parentId } : {}),
  } as unknown as DiagramNode;
}

describe('the diagram bounds the camera follows', () => {
  it('spans the top-level boxes', () => {
    expect(outerBounds([box('a', 0, 0, 100, 50), box('b', 200, 10, 100, 80)])).toBe('0,0,300,90');
  });

  // Children are positioned inside their parents: counting them would move the
  // camera for changes that leave the picture's edges where they were.
  it('ignores children, which sit inside their parents', () => {
    const parent = box('vpc', 0, 0, 400, 300);
    expect(outerBounds([parent, box('subnet', 350, 250, 200, 200, 'vpc')])).toBe('0,0,400,300');
  });

  it('is empty for an empty diagram', () => {
    expect(outerBounds([])).toBe('');
  });
});
