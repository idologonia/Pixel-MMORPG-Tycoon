import { describe, expect, it } from 'vitest';
import { buildWorld } from './bench';
import { EntityEditor } from '@/systems/editor/EntityEditor';
import { History } from '@/systems/editor/History';
import { ZonePainter } from '@/systems/editor/ZonePainter';
import { ZoneId } from '@/data/zones';
import { BIOMES, pickObject } from '@/data/biomes';
import { getObjectDef } from '@/data/objects';
import { WorldRuntime } from '@/simulation/WorldRuntime';

function setup() {
  const w = buildWorld({ size: 96, npcs: 10, seed: 3 });
  const history = new History(50, () => undefined);
  const ed = new EntityEditor(() => w.rt, history);
  const zones = new ZonePainter(() => w.rt, history, ed);
  return { w, history, ed, zones };
}

describe('landscape brush', () => {
  it('every biome only uses objects that exist', () => {
    for (const b of BIOMES) for (let i = 0; i < 20; i++) expect(getObjectDef(pickObject(b, i / 20))).toBeTruthy();
  });
});

describe('zone brush', () => {
  it('paints, undoes and saves zones', () => {
    const { w, history, zones } = setup();
    zones.begin(ZoneId.Safe);
    zones.strokeTo(10, 10, 3, 'square');
    zones.strokeTo(14, 10, 3, 'square');
    zones.end(null);
    expect(w.rt.zoneAt(12, 10)).toBe(ZoneId.Safe);
    expect(w.rt.safeAt(12, 10)).toBe(true);
    // Saved and loaded.
    const again = new WorldRuntime(w.rt.toSave());
    expect(again.zoneAt(12, 10)).toBe(ZoneId.Safe);
    history.undo(w.rt);
    expect(w.rt.zoneAt(12, 10)).toBe(0);
  });

  it('PvP and safe zones change the PvP rule', () => {
    const { w, zones } = setup();
    zones.begin(ZoneId.Pvp); zones.strokeTo(30, 30, 3, 'square'); zones.end(null);
    zones.begin(ZoneId.Town); zones.strokeTo(40, 40, 3, 'square'); zones.end(null);
    expect(w.brain.pvpRule(30, 30)).toBe('open');
    expect(w.brain.pvpRule(40, 40)).toBe('none');
    // Even griefers can't attack in a town.
    const g = w.players.join()!; g.cheat = 'griefer';
    expect(w.brain.mayAttack(g, 40, 40)).toBe(false);
  });

  it('monster zones get monsters; erasing removes them', () => {
    const { w, zones } = setup();
    // An empty, walkable 16×16 spot.
    let spot: { x: number; y: number } | null = null;
    for (let y = 8; y < 80 && !spot; y += 8) for (let x = 8; x < 80 && !spot; x += 8) {
      let ok = true;
      for (let yy = y; yy < y + 16 && ok; yy++) for (let xx = x; xx < x + 16 && ok; xx++) ok = w.rt.nav.isWalkable(xx, yy);
      if (ok && !w.rt.entities.list('spawnAreas').some((a) => a.x < x + 16 && a.x + a.w > x && a.y < y + 16 && a.y + a.h > y)) spot = { x, y };
    }
    expect(spot).toBeTruthy();
    const before = w.rt.entities.count('spawnAreas');
    zones.begin(ZoneId.Monsters);
    for (let y = spot!.y + 2; y < spot!.y + 16; y += 4) zones.strokeTo(spot!.x + 8, y, 15, 'square');
    zones.end(null);
    const made = w.rt.entities.list('spawnAreas').filter((a) => a.zone);
    expect(made.length).toBeGreaterThan(0);
    expect(w.rt.entities.count('spawnAreas')).toBeGreaterThan(before);
    zones.begin(0);
    for (let y = spot!.y + 2; y < spot!.y + 16; y += 4) zones.strokeTo(spot!.x + 8, y, 15, 'square');
    zones.end(null);
    expect(w.rt.entities.list('spawnAreas').filter((a) => a.zone).length).toBe(0);
  });

  it('monsters never attack players standing in a safe zone', () => {
    const { w, zones } = setup();
    const area = w.rt.entities.list('spawnAreas').find((a) => !a.lair)!;
    const tpl = w.rt.entities.get('creatureTemplates', area.templateId)!;
    w.rt.entities.update('creatureTemplates', tpl.id, { aggression: 'aggressive', aggroRange: 8 });
    const cx = Math.floor(area.x + area.w / 2), cy = Math.floor(area.y + area.h / 2);
    zones.begin(ZoneId.Safe); zones.strokeTo(cx, cy, 15, 'square'); zones.end(null);
    const p = w.players.join()!;
    const a = w.actors.actors.get(p.id)!;
    let hits = 0;
    w.actors.events.on('hit', ({ target, attacker }) => { if (target.id === a.id && attacker.kind === 'creature') hits++; });
    for (let i = 0; i < 300; i++) { w.actors.teleport(a, cx + 0.5, cy + 0.5); a.hp = a.maxHp; w.ps.mind(p.id).act = null; w.engine.step(); }
    expect(hits).toBe(0);
  });
});
