import type { EntityId } from '@/core/ids';
import { t } from '@/i18n';
import { ZONE_CHUNK, ZoneId } from '@/data/zones';
import type { WorldRuntime } from '@/simulation/WorldRuntime';
import type { EntityEditor } from './EntityEditor';
import { History, ZoneEditCommand } from './History';
import { brushFootprint, lineTiles, type BrushShape } from './shapes';

/** Walkable monster-zone tiles a chunk needs before monsters appear there. */
const MIN_TILES = 16;

/**
 * Zone brush: paints towns, safe zones, monster zones and PvP zones tile by tile.
 * Monster zones fill themselves with spawn areas of the chosen monster.
 */
export class ZonePainter {
  private stroke: { before: Map<number, number>; zone: number; last: [number, number] | null; x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private world: () => WorldRuntime, private history: History, private ents: EntityEditor) {}

  begin(zone: number): void {
    this.stroke = { before: new Map(), zone, last: null, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  }

  strokeTo(x: number, y: number, size: number, shape: BrushShape): void {
    const s = this.stroke;
    if (!s) return;
    const w = this.world();
    const z = w.zones;
    const points = s.last ? lineTiles(s.last[0], s.last[1], x, y) : [[x, y] as [number, number]];
    s.last = [x, y];
    const changed: number[] = [];
    for (const [px, py] of points) for (const [dx, dy] of brushFootprint(size, shape)) {
      const tx = px + dx, ty = py + dy;
      if (!z.inBounds(tx, ty)) continue;
      const i = z.index(tx, ty);
      if (z.tiles[i] === s.zone) continue;
      if (!s.before.has(i)) s.before.set(i, z.tiles[i]);
      changed.push(i);
      s.x0 = Math.min(s.x0, tx); s.y0 = Math.min(s.y0, ty); s.x1 = Math.max(s.x1, tx); s.y1 = Math.max(s.y1, ty);
    }
    if (changed.length) w.setZones(changed, new Uint8Array(changed.length).fill(s.zone));
  }

  /** Finish the stroke (one undo step) and refresh the monsters living in touched zones. */
  end(templateId: EntityId | null, spawn = { x: 0, y: 0 }): number {
    const s = this.stroke;
    this.stroke = null;
    if (!s || !s.before.size) return 0;
    const indices = Uint32Array.from(s.before.keys());
    this.history.push(new ZoneEditCommand(t('Paint zones'), indices, Uint8Array.from(s.before.values()), new Uint8Array(indices.length).fill(s.zone)));
    if (s.zone === ZoneId.Monsters || [...s.before.values()].includes(ZoneId.Monsters)) this.syncMonsters(s.x0, s.y0, s.x1, s.y1, templateId, spawn);
    return indices.length;
  }

  /** Monster level for a spot: farther from where players appear = tougher. */
  private autoTemplate(x: number, y: number, spawn: { x: number; y: number }): EntityId | null {
    const tpls = this.world().entities.list('creatureTemplates').filter((c) => !c.boss);
    if (!tpls.length) return null;
    const want = 1 + Math.hypot(x - spawn.x, y - spawn.y) / 10;
    return tpls.sort((a, b) => Math.abs(a.level - want) - Math.abs(b.level - want))[0].id;
  }

  /** Every chunk mostly painted as a monster zone gets a spawn area; erased chunks lose theirs. */
  syncMonsters(x0: number, y0: number, x1: number, y1: number, templateId: EntityId | null, spawn = { x: 0, y: 0 }): void {
    const w = this.world();
    const key = `zone-${Date.now()}`;
    const C = ZONE_CHUNK;
    for (let cy = Math.floor(y0 / C) * C; cy <= y1; cy += C) for (let cx = Math.floor(x0 / C) * C; cx <= x1; cx += C) {
      let n = 0;
      for (let y = cy; y < cy + C; y++) for (let x = cx; x < cx + C; x++) if (w.zoneAt(x, y) === ZoneId.Monsters && w.nav.isWalkable(x, y)) n++;
      const areas = w.entities.list('spawnAreas');
      const mine = areas.find((a) => a.zone && a.x === cx && a.y === cy);
      if (n >= MIN_TILES && !mine) {
        // Hand-made spawn areas already here: leave them alone.
        if (areas.some((a) => a.x < cx + C && a.x + a.w > cx && a.y < cy + C && a.y + a.h > cy)) continue;
        const tpl = templateId ?? this.autoTemplate(cx + C / 2, cy + C / 2, spawn);
        if (tpl) this.ents.addZoneSpawn(tpl, { x: cx, y: cy, w: Math.min(C, w.zones.width - cx), h: Math.min(C, w.zones.height - cy) }, key);
      } else if (n < MIN_TILES && mine) this.ents.removeZoneSpawn(mine.id, key);
    }
  }
}
