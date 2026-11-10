import type { SpawnArea } from '@/models/entities';

/**
 * Spawn areas are painted with a brush, so they can have any shape: a bounding
 * rectangle plus the list of painted cells inside it (local index = ly * w + lx).
 * Without `cells` the whole rectangle counts (older saves, lairs, event spawns).
 */
const sets = new WeakMap<number[], Set<number>>();

function cellSet(cells: number[]): Set<number> {
  let s = sets.get(cells);
  if (!s) { s = new Set(cells); sets.set(cells, s); }
  return s;
}

type Shape = Pick<SpawnArea, 'x' | 'y' | 'w' | 'h'> & { cells?: number[] };

export function inArea(a: Shape, x: number, y: number): boolean {
  if (x < a.x || y < a.y || x >= a.x + a.w || y >= a.y + a.h) return false;
  return !a.cells || cellSet(a.cells).has((y - a.y) * a.w + (x - a.x));
}

/** Every tile of the area as a global index (y * mapWidth + x). */
export function areaTiles(a: Shape, mapW: number): Set<number> {
  const out = new Set<number>();
  if (a.cells) for (const c of a.cells) out.add((a.y + Math.floor(c / a.w)) * mapW + a.x + (c % a.w));
  else for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) out.add(y * mapW + x);
  return out;
}

export function areaSize(a: Shape): number {
  return a.cells ? a.cells.length : a.w * a.h;
}

/** Shape covering a set of global tiles (cells dropped when it is a full rectangle). */
export function shapeFrom(tiles: Set<number>, mapW: number): Shape | null {
  if (!tiles.size) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of tiles) { const x = i % mapW, y = Math.floor(i / mapW); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (tiles.size === w * h) return { x: x0, y: y0, w, h, cells: undefined };
  const cells = [...tiles].map((i) => (Math.floor(i / mapW) - y0) * w + (i % mapW) - x0).sort((a, b) => a - b);
  return { x: x0, y: y0, w, h, cells };
}

/** How many monsters a painted area holds. */
export function countFor(tiles: number): number {
  return Math.max(1, Math.min(15, Math.round(tiles / 20)));
}
