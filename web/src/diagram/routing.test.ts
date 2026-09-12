import { intersects, labelSize, routeConnections, type Point, type Rect } from './routing';

const rect = (x: number, y: number, width = 190, height = 68): Rect => ({ x, y, width, height });

function route(source: Rect, target: Rect, obstacles: Rect[] = [], label = 'to internet') {
  const routed = routeConnections(
    [{ id: 'e', source, target, label }],
    [source, target, ...obstacles],
    [],
  );
  return routed.get('e')!;
}

/** Every point along a route, one pixel apart. */
function sample(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
    }
  }
  return out;
}

const strictlyInside = (p: Point, r: Rect, margin = 0) =>
  p.x > r.x - margin &&
  p.x < r.x + r.width + margin &&
  p.y > r.y - margin &&
  p.y < r.y + r.height + margin;

const onBorder = (p: Point, r: Rect) =>
  (p.x === r.x || p.x === r.x + r.width || p.y === r.y || p.y === r.y + r.height) &&
  p.x >= r.x &&
  p.x <= r.x + r.width &&
  p.y >= r.y &&
  p.y <= r.y + r.height;

/** Deterministic pseudo-random numbers, so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('routes', () => {
  it('start on the source and end on the target', () => {
    const source = rect(0, 0);
    const target = rect(400, 0);
    const { points } = route(source, target);

    expect(onBorder(points[0]!, source)).toBe(true);
    expect(onBorder(points[points.length - 1]!, target)).toBe(true);
  });

  it('only run horizontally or vertically', () => {
    const { points } = route(rect(0, 0), rect(400, 300));

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('go around a box in the way', () => {
    const blocker = rect(210, 0);
    const { points } = route(rect(0, 0), rect(420, 0), [blocker]);

    expect(sample(points).some((p) => strictlyInside(p, blocker))).toBe(false);
  });

  it('are the same every time for the same input', () => {
    const obstacles = [rect(210, 0), rect(210, 100)];
    expect(route(rect(0, 50), rect(420, 50), obstacles)).toEqual(
      route(rect(0, 50), rect(420, 50), obstacles),
    );
  });

  // Generated layouts rather than hand-picked ones: boxes on a jittered grid,
  // connections between random pairs.
  it('never pass through a box they do not connect', () => {
    const next = random(42);

    for (let trial = 0; trial < 40; trial++) {
      const boxes: Rect[] = [];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          if (next() < 0.3) continue;
          boxes.push(
            rect(col * 230 + Math.floor(next() * 20), row * 110 + Math.floor(next() * 20)),
          );
        }
      }
      if (boxes.length < 2) continue;

      const source = boxes[Math.floor(next() * boxes.length)]!;
      const target =
        boxes.find((b) => b !== source && next() < 0.5) ?? boxes.find((b) => b !== source)!;
      const { points } = routeConnections([{ id: 'e', source, target, label: 'x' }], boxes, []).get(
        'e',
      )!;

      for (const p of sample(points)) {
        for (const box of boxes) {
          if (box === source || box === target) {
            expect(strictlyInside(p, box)).toBe(false);
          } else {
            expect(strictlyInside(p, box, 5)).toBe(false);
          }
        }
      }
    }
  });
});

describe('labels', () => {
  it('sit on the route, clear of every box', () => {
    const source = rect(0, 0);
    const target = rect(500, 200);
    const { points, label } = route(source, target);

    expect(label).not.toBeNull();
    expect(intersects(label!, source)).toBe(false);
    expect(intersects(label!, target)).toBe(false);

    // On the line or touching it, so it reads as belonging to this arrow.
    expect(sample(points).some((p) => strictlyInside(p, label!, 1.5))).toBe(true);
  });

  // Adjacent boxes: the shortest route is a stub through the gap with no room
  // for text, so the arrow goes round and takes its label with it.
  it('get room between neighbouring boxes by going round them', () => {
    const { label } = route(rect(202, 0), rect(0, 0));

    expect(label).not.toBeNull();
    expect(label!.width).toBe(labelSize('to internet').width);
  });

  it('are dropped when there is nowhere to put them', () => {
    const source = rect(0, 0);
    const target = rect(202, 0);
    // Walls 12 px away on every side: every corridor is too narrow for text.
    const walls = [
      rect(-1000, -1000, 2400, 988),
      rect(-1000, 80, 2400, 988),
      rect(-1000, -12, 988, 104),
      rect(404, -12, 988, 104),
    ];
    const { points, label } = route(source, target, walls);

    expect(label).toBeNull();
    expect(points.length).toBeGreaterThanOrEqual(2);
  });

  it('never cover another label or another arrow', () => {
    const a = rect(0, 0);
    const b = rect(600, 0);
    const c = rect(0, 300);
    const d = rect(600, 300);
    const routed = routeConnections(
      [
        { id: 'one', source: a, target: d, label: 'to internet' },
        { id: 'two', source: c, target: b, label: 'via NAT' },
      ],
      [a, b, c, d],
      [],
    );

    const one = routed.get('one')!;
    const two = routed.get('two')!;
    if (one.label && two.label) expect(intersects(one.label, two.label)).toBe(false);
    if (two.label) {
      expect(sample(one.points).some((p) => strictlyInside(p, two.label!))).toBe(false);
    }
  });
});
