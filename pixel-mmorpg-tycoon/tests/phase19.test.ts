import { describe, expect, it } from 'vitest';
import { buildWorld } from './bench';
import { EntityEditor } from '@/systems/editor/EntityEditor';
import { History } from '@/systems/editor/History';
import { areaSize, inArea } from '@/simulation/spawnShape';

/** A walkable, empty 20×12 spot without spawn areas. */
function spot(w: ReturnType<typeof buildWorld>) {
  for (let y = 4; y < 80; y += 4) for (let x = 4; x < 80; x += 4) {
    let ok = true;
    for (let yy = y; yy < y + 12 && ok; yy++) for (let xx = x; xx < x + 20 && ok; xx++) ok = w.rt.nav.isWalkable(xx, yy);
    if (ok && !w.rt.entities.list('spawnAreas').some((a) => a.x < x + 20 && a.x + a.w > x && a.y < y + 12 && a.y + a.h > y)) return { x, y };
  }
  throw new Error('no spot');
}

const line = (W: number, x0: number, x1: number, y: number) => new Set(Array.from({ length: x1 - x0 + 1 }, (_, i) => y * W + x0 + i));

describe('spawn brush', () => {
  it('paints, grows, merges and erases spawn areas of any shape', () => {
    const w = buildWorld({ size: 96, npcs: 10, seed: 3 });
    const history = new History(50, () => undefined);
    const ed = new EntityEditor(() => w.rt, history);
    const W = w.rt.grid.width;
    const tpl = w.rt.entities.list('creatureTemplates').find((c) => !c.boss)!;
    const s = spot(w);
    const count = () => w.rt.entities.list('spawnAreas').filter((a) => a.templateId === tpl.id && a.x >= s.x - 1 && a.x < s.x + 20 && a.y >= s.y - 1 && a.y < s.y + 12);

    // An L shape: not a rectangle.
    ed.paintSpawn(tpl.id, new Set([...line(W, s.x, s.x + 5, s.y), ...line(W, s.x, s.x, s.y + 1), ...line(W, s.x, s.x, s.y + 2)]));
    expect(count().length).toBe(1);
    const a = count()[0];
    expect(areaSize(a)).toBe(8);
    expect(inArea(a, s.x + 3, s.y)).toBe(true);
    expect(inArea(a, s.x + 3, s.y + 2)).toBe(false); // inside the bounding box, not painted
    // Monsters only appear on painted cells.
    for (let i = 0; i < 50; i++) { const p = w.actors.randomTileInArea(a)!; expect(inArea(a, p.x, p.y)).toBe(true); }

    // A separate stroke far away = a second area; a stroke linking both merges them.
    ed.paintSpawn(tpl.id, line(W, s.x + 10, s.x + 15, s.y));
    expect(count().length).toBe(2);
    ed.paintSpawn(tpl.id, line(W, s.x + 6, s.x + 9, s.y));
    expect(count().length).toBe(1);
    expect(areaSize(count()[0])).toBe(8 + 6 + 4);

    // Eraser cuts tiles out; erasing everything deletes the area.
    ed.paintSpawn(null, line(W, s.x + 10, s.x + 15, s.y));
    expect(areaSize(count()[0])).toBe(12);
    ed.paintSpawn(null, new Set([...line(W, s.x, s.x + 9, s.y), ...line(W, s.x, s.x, s.y + 1), ...line(W, s.x, s.x, s.y + 2)]));
    expect(count().length).toBe(0);
    // Undo brings it back.
    history.undo(w.rt);
    expect(count().length).toBe(1);
  });
});
