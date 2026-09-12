/**
 * Orthogonal routing for the diagram's connections.
 *
 * Arrows run through the gaps between boxes: a sparse grid is built from the
 * sides of every nearby box, and A* finds the cheapest path along it, where a
 * bend costs extra and a corridor another arrow already uses costs more.
 * Everything derives from the layout, so the same model always routes the same
 * way (ADR-0003).
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type Connection = { id: string; source: Rect; target: Rect; label: string };
export type RoutedConnection = { points: Point[]; label: Rect | null };

/** Distance kept between an arrow and any box; half the layout's sibling gap. */
const CLEARANCE = 6;
const BEND_COST = 30;
const SHARED_CORRIDOR_COST = 150;
/** How much longer a route may be to make room for its label. */
const DETOUR_ALLOWANCE = 400;
const WINDOW_MARGINS = [160, 480];
const LABEL_HEIGHT = 16;
const LABEL_MARGIN = 4;

type Direction = 0 | 1 | 2 | 3; // +x, -x, +y, -y
const DIRECTIONS: readonly Direction[] = [0, 1, 2, 3];
const OPPOSITE: readonly Direction[] = [1, 0, 3, 2];

type Port = { attach: Point; outer: Point; outward: Direction };
type Route = { points: Point[]; cost: number };

export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.ceil(text.length * 6.2) + 12, height: LABEL_HEIGHT };
}

/**
 * Routes every connection and places its label.
 *
 * Connections are handled in id order. Each one avoids the labels placed
 * before it, and each label avoids the arrows drawn before it, so nothing ends
 * up on top of anything else. A label that fits nowhere is dropped: the caller
 * keeps the text in the arrow's accessible name.
 */
export function routeConnections(
  connections: readonly Connection[],
  obstacles: readonly Rect[],
  containers: readonly Rect[],
): Map<string, RoutedConnection> {
  const routed = new Map<string, RoutedConnection>();
  const corridors = new Corridors();
  const labels: Rect[] = [];
  const lines: Point[][] = [];

  const ordered = [...connections].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const connection of ordered) {
    const blocked = [...obstacles, ...labels];
    const candidates = routeCandidates(connection.source, connection.target, blocked, corridors);
    const size = labelSize(connection.label);
    const cheapest = candidates[0]!.cost;

    let chosen = candidates[0]!;
    let label: Rect | null = null;
    for (const candidate of candidates) {
      if (candidate.cost > cheapest + DETOUR_ALLOWANCE) break;
      label = placeLabel(candidate.points, size, blocked, containers, lines);
      if (label) {
        chosen = candidate;
        break;
      }
    }

    corridors.add(chosen.points);
    lines.push(chosen.points);
    if (label) labels.push(label);
    routed.set(connection.id, { points: chosen.points, label });
  }

  return routed;
}

/**
 * Every viable route between two boxes, cheapest first — one per pair of
 * sides. Alternatives matter: the shortest route between adjacent boxes is a
 * 12-pixel stub with no room for a label, and going round underneath often has.
 *
 * The search window grows until something is found. The last resorts stop
 * treating the endpoints as obstacles (a container pointing at its own child
 * has to be entered) and finally draw a straight line.
 */
function routeCandidates(
  source: Rect,
  target: Rect,
  obstacles: readonly Rect[],
  corridors: Corridors,
): Route[] {
  const span = union(source, target);
  const attempts: { window: Rect | null; blockEndpoints: boolean }[] = [
    ...WINDOW_MARGINS.map((margin) => ({ window: inflate(span, margin), blockEndpoints: true })),
    { window: null, blockEndpoints: true },
    { window: null, blockEndpoints: false },
  ];

  const sourcePorts = ports(source);
  const targetPorts = ports(target);

  for (const { window, blockEndpoints } of attempts) {
    const nearby = window ? obstacles.filter((rect) => intersects(rect, window)) : obstacles;
    const blocking = blockEndpoints ? [...nearby, source, target] : nearby;
    const frame = window ?? inflate(bounds([...blocking, source, target]), CLEARANCE * 3);
    const grid = new Grid(
      blocking,
      frame,
      [...sourcePorts, ...targetPorts].map((port) => port.outer),
    );

    const routes: Route[] = [];
    for (const start of sourcePorts) {
      if (!grid.isFree(start.outer)) continue;
      for (const goal of targetPorts) {
        if (!grid.isFree(goal.outer)) continue;
        const found = search(grid, start, goal, corridors);
        if (found) routes.push(found);
      }
    }

    if (routes.length > 0) return routes.sort((a, b) => a.cost - b.cost);
  }

  return [{ points: [centre(source), centre(target)], cost: Infinity }];
}

function ports(rect: Rect): Port[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  return [
    { attach: { x: right, y: cy }, outer: { x: right + CLEARANCE, y: cy }, outward: 0 },
    { attach: { x: rect.x, y: cy }, outer: { x: rect.x - CLEARANCE, y: cy }, outward: 1 },
    { attach: { x: cx, y: bottom }, outer: { x: cx, y: bottom + CLEARANCE }, outward: 2 },
    { attach: { x: cx, y: rect.y }, outer: { x: cx, y: rect.y - CLEARANCE }, outward: 3 },
  ];
}

/**
 * A* from one port to another. Each state is a grid node plus the direction it
 * was entered from, which is what lets a bend be charged for.
 */
function search(grid: Grid, start: Port, goal: Port, corridors: Corridors): Route | null {
  const from = grid.node(start.outer);
  const to = grid.node(goal.outer);
  if (from === null || to === null) return null;

  const arrival = OPPOSITE[goal.outward]!;
  const heap = new Heap();
  const best = new Map<number, number>();
  const previous = new Map<number, number>();

  const first = from * 4 + start.outward;
  best.set(first, CLEARANCE);
  heap.push(CLEARANCE + grid.distance(from, to), CLEARANCE, first);

  let finalCost = Infinity;
  let finalState = -1;

  while (heap.size > 0) {
    const { priority, cost, state } = heap.pop();
    if (priority >= finalCost) break;
    if (cost > (best.get(state) ?? Infinity)) continue;

    const node = Math.floor(state / 4);
    const direction = (state % 4) as Direction;

    if (node === to) {
      const total = cost + (direction === arrival ? 0 : BEND_COST) + CLEARANCE;
      if (total < finalCost) {
        finalCost = total;
        finalState = state;
      }
      continue;
    }

    for (const next of DIRECTIONS) {
      if (next === OPPOSITE[direction]) continue;
      const neighbour = grid.travel(node, next);
      if (neighbour === null) continue;

      const a = grid.point(node);
      const b = grid.point(neighbour);
      const step =
        Math.abs(b.x - a.x) +
        Math.abs(b.y - a.y) +
        (next === direction ? 0 : BEND_COST) +
        (corridors.shares(a, b) ? SHARED_CORRIDOR_COST : 0);

      const nextState = neighbour * 4 + next;
      const nextCost = cost + step;
      if (nextCost < (best.get(nextState) ?? Infinity)) {
        best.set(nextState, nextCost);
        previous.set(nextState, state);
        heap.push(nextCost + grid.distance(neighbour, to), nextCost, nextState);
      }
    }
  }

  if (finalState < 0) return null;

  const nodes: number[] = [];
  for (
    let state: number | undefined = finalState;
    state !== undefined;
    state = previous.get(state)
  ) {
    nodes.push(Math.floor(state / 4));
    if (state === first) break;
  }
  nodes.reverse();

  const points = [start.attach, ...nodes.map((node) => grid.point(node)), goal.attach];
  return { points: simplify(points), cost: finalCost };
}

/**
 * Where a label can sit on a route: on a straight run long enough to hold it,
 * over nothing but empty space. Longest runs are tried first, then positions
 * either side of their middle; at each, centred on the line and then beside
 * it, since a route hugging a box leaves no room for text across it.
 */
function placeLabel(
  points: readonly Point[],
  size: { width: number; height: number },
  blocked: readonly Rect[],
  containers: readonly Rect[],
  lines: readonly (readonly Point[])[],
): Rect | null {
  const segments: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1]!, points[i]!]);
  segments.sort((s, t) => length(t) - length(s));

  for (const segment of segments) {
    const [a, b] = segment;
    const horizontal = a.y === b.y;
    // The label may touch the run it labels, but not the arrow's other runs.
    const avoid = [...lines, ...segments.filter((other) => other !== segment)];
    const room = length([a, b]) - (horizontal ? size.width : size.height) - 2 * LABEL_MARGIN;
    if (room < 0) continue;

    for (const t of [0.5, 0.3, 0.7]) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const centred = { x: x - size.width / 2, y: y - size.height / 2, ...size };
      const beside = horizontal
        ? [
            { ...centred, y: y - size.height - 1 },
            { ...centred, y: y + 1 },
          ]
        : [
            { ...centred, x: x - size.width - 1 },
            { ...centred, x: x + 1 },
          ];

      for (const rect of [centred, ...beside]) {
        if (!withinSegment(rect, a, b, horizontal)) continue;
        if (isClear(rect, blocked, containers, avoid)) return rect;
      }
    }
  }

  return null;
}

function withinSegment(rect: Rect, a: Point, b: Point, horizontal: boolean): boolean {
  if (horizontal) {
    return (
      rect.x >= Math.min(a.x, b.x) + LABEL_MARGIN &&
      rect.x + rect.width <= Math.max(a.x, b.x) - LABEL_MARGIN
    );
  }
  return (
    rect.y >= Math.min(a.y, b.y) + LABEL_MARGIN &&
    rect.y + rect.height <= Math.max(a.y, b.y) - LABEL_MARGIN
  );
}

function isClear(
  rect: Rect,
  blocked: readonly Rect[],
  containers: readonly Rect[],
  lines: readonly (readonly Point[])[],
): boolean {
  if (blocked.some((box) => intersects(rect, inflate(box, 2)))) return false;
  // Inside a container or outside it, never across its border.
  if (containers.some((box) => intersects(rect, box) && !contains(box, rect))) return false;
  return !lines.some((line) => crosses(line, rect));
}

/** The sparse grid a route may travel along. */
class Grid {
  readonly #xs: number[];
  readonly #ys: number[];
  readonly #xIndex: Map<number, number>;
  readonly #yIndex: Map<number, number>;
  readonly #blocked: Rect[];
  readonly #free = new Map<number, boolean>();
  readonly #passable = new Map<number, boolean>();

  constructor(blocking: readonly Rect[], frame: Rect, extra: readonly Point[]) {
    this.#blocked = blocking.map((rect) => inflate(rect, CLEARANCE - 0.5));

    const xs = new Set([frame.x, frame.x + frame.width]);
    const ys = new Set([frame.y, frame.y + frame.height]);
    for (const rect of blocking) {
      xs.add(rect.x - CLEARANCE);
      xs.add(rect.x + rect.width + CLEARANCE);
      ys.add(rect.y - CLEARANCE);
      ys.add(rect.y + rect.height + CLEARANCE);
    }
    for (const point of extra) {
      xs.add(point.x);
      ys.add(point.y);
    }

    const inside = (value: number, low: number, high: number) => value >= low && value <= high;
    this.#xs = [...xs]
      .filter((x) => inside(x, frame.x, frame.x + frame.width))
      .sort((a, b) => a - b);
    this.#ys = [...ys]
      .filter((y) => inside(y, frame.y, frame.y + frame.height))
      .sort((a, b) => a - b);
    this.#xIndex = new Map(this.#xs.map((x, i) => [x, i]));
    this.#yIndex = new Map(this.#ys.map((y, i) => [y, i]));
  }

  node(point: Point): number | null {
    const i = this.#xIndex.get(point.x);
    const j = this.#yIndex.get(point.y);
    return i === undefined || j === undefined ? null : i * this.#ys.length + j;
  }

  point(node: number): Point {
    const ny = this.#ys.length;
    return { x: this.#xs[Math.floor(node / ny)]!, y: this.#ys[node % ny]! };
  }

  distance(a: number, b: number): number {
    const p = this.point(a);
    const q = this.point(b);
    return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
  }

  isFree(point: Point): boolean {
    return !this.#blocked.some(
      (rect) =>
        point.x > rect.x &&
        point.x < rect.x + rect.width &&
        point.y > rect.y &&
        point.y < rect.y + rect.height,
    );
  }

  /** The neighbouring node in a direction, if the segment to it is clear. */
  travel(node: number, direction: Direction): number | null {
    const ny = this.#ys.length;
    const i = Math.floor(node / ny);
    const j = node % ny;
    const ni = direction === 0 ? i + 1 : direction === 1 ? i - 1 : i;
    const nj = direction === 2 ? j + 1 : direction === 3 ? j - 1 : j;
    if (ni < 0 || nj < 0 || ni >= this.#xs.length || nj >= ny) return null;

    const neighbour = ni * ny + nj;
    const key = Math.min(node, neighbour) * 2 + (direction < 2 ? 0 : 1);

    let passable = this.#passable.get(key);
    if (passable === undefined) {
      const a = this.point(node);
      const b = this.point(neighbour);
      // Every box side is a grid line, so a segment between neighbouring nodes
      // crosses a box only if its midpoint lies inside one.
      passable =
        this.#isFreeNode(node) &&
        this.#isFreeNode(neighbour) &&
        this.isFree({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      this.#passable.set(key, passable);
    }
    return passable ? neighbour : null;
  }

  #isFreeNode(node: number): boolean {
    let free = this.#free.get(node);
    if (free === undefined) {
      free = this.isFree(this.point(node));
      this.#free.set(node, free);
    }
    return free;
  }
}

/** Straight runs already taken by an arrow, so the next one looks elsewhere. */
class Corridors {
  readonly #horizontal = new Map<number, [number, number][]>();
  readonly #vertical = new Map<number, [number, number][]>();

  add(points: readonly Point[]): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (a.y === b.y) append(this.#horizontal, a.y, a.x, b.x);
      else if (a.x === b.x) append(this.#vertical, a.x, a.y, b.y);
    }
  }

  shares(a: Point, b: Point): boolean {
    const [ranges, low, high] =
      a.y === b.y
        ? [this.#horizontal.get(a.y), Math.min(a.x, b.x), Math.max(a.x, b.x)]
        : [this.#vertical.get(a.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    return (ranges ?? []).some(([from, to]) => from < high && low < to);
  }
}

function append(map: Map<number, [number, number][]>, key: number, a: number, b: number): void {
  const range: [number, number] = [Math.min(a, b), Math.max(a, b)];
  const ranges = map.get(key);
  if (ranges) ranges.push(range);
  else map.set(key, [range]);
}

/** A binary min-heap, ordered by priority and then by insertion for determinism. */
class Heap {
  readonly #items: { priority: number; order: number; cost: number; state: number }[] = [];
  #counter = 0;

  get size(): number {
    return this.#items.length;
  }

  push(priority: number, cost: number, state: number): void {
    const items = this.#items;
    items.push({ priority, order: this.#counter++, cost, state });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): { priority: number; cost: number; state: number } {
    const items = this.#items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && before(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && before(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

function before(a: { priority: number; order: number }, b: { priority: number; order: number }) {
  return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
}

function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const beforeLast = out[out.length - 2];
    if (
      last &&
      beforeLast &&
      ((beforeLast.x === last.x && last.x === point.x) ||
        (beforeLast.y === last.y && last.y === point.y))
    ) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

function crosses(line: readonly Point[], rect: Rect): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const segment = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
    if (touches(segment, rect)) return true;
  }
  return false;
}

function length([a, b]: [Point, Point]): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Like `intersects`, but a zero-width segment lying inside a rect counts. */
function touches(segment: Rect, rect: Rect): boolean {
  return (
    segment.x <= rect.x + rect.width &&
    rect.x <= segment.x + segment.width &&
    segment.y <= rect.y + rect.height &&
    rect.y <= segment.y + segment.height
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function inflate(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  };
}

function union(a: Rect, b: Rect): Rect {
  return bounds([a, b]);
}

function bounds(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
