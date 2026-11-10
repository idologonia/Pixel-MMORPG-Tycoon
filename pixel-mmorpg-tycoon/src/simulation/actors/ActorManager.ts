import { EventBus } from '@/core/EventBus';
import { SeededRandom } from '@/core/random';
import type { EntityId } from '@/core/ids';
import type { CreatureTemplate, NpcDef, SpawnArea } from '@/models/entities';
import { Pathfinder } from '../nav/Pathfinder';
import { SpatialHash } from '../nav/SpatialHash';
import type { WorldRuntime } from '../WorldRuntime';
import { newActor, type Actor } from './Actor';

export type ActorEvents = {
  hit: { target: Actor; attacker: Actor; amount: number };
  died: { victim: Actor; killer: Actor | null };
  respawned: { actor: Actor };
  /** Boss area attack (for screen shake and effects). */
  slam: { actor: Actor; radius: number; victims: number };
  enrage: { actor: Actor };
  /** Someone stepped through a portal. */
  portal: { actor: Actor; fromX: number; fromY: number; toX: number; toY: number };
  /** A player healed someone. */
  heal: { target: Actor; healer: Actor; amount: number };
  /** Boss lost all its attackers and went home (raid wipe or players fled). */
  bossReset: { actor: Actor };
};

export interface ActorStats { creatureKills: number; npcDeaths: number; hits: number }

/** Distance (tiles) a moving actor covers per tick at speed 1. One tick = 100ms real time. */
export const TILES_PER_TICK = 0.1;

/**
 * Owns every live actor, keeps them in sync with the authored entities
 * (NPC defs, spawn areas, creature templates) and provides movement helpers.
 */
export class ActorManager {
  readonly actors = new Map<string, Actor>();
  readonly spatial = new SpatialHash<Actor>(8);
  readonly events = new EventBus<ActorEvents>();
  readonly pathfinder: Pathfinder;
  readonly rng: SeededRandom;
  readonly stats: ActorStats = { creatureKills: 0, npcDeaths: 0, hits: 0 };
  tick = 0;
  /** Combat stats and names for player actors (provided by the player simulation). */
  playerStats: ((a: Actor) => { damage: number; defense: number; attackRange: number; speed: number } | null) | null = null;
  playerName: ((a: Actor) => string) | null = null;
  /** Called when an NPC reaches the merchant of its trade errand (set by the economy). */
  errandHandler: ((a: Actor) => void) | null = null;
  private unsub: () => void;

  constructor(readonly world: WorldRuntime, seed = Date.now() & 0x7fffffff) {
    this.rng = new SeededRandom(seed);
    this.pathfinder = new Pathfinder(world.nav);
    this.syncAll();
    this.unsub = world.entities.events.on('changed', ({ col, ids }) => {
      if (col === 'npcs') ids.forEach((id) => this.syncNpc(id));
      if (col === 'spawnAreas') ids.forEach((id) => this.syncArea(id));
      if (col === 'creatureTemplates') this.world.entities.list('spawnAreas').forEach((a) => this.syncArea(a.id));
    });
  }

  get gameMinutes(): number {
    return this.world.clock.totalMinutes;
  }

  rand(): number {
    return this.rng.next();
  }

  syncAll(): void {
    const npcIds = new Set(this.world.entities.list('npcs').map((n) => n.id));
    for (const a of [...this.actors.values()]) if (a.kind === 'npc' && !npcIds.has(a.defId)) this.removeActor(a);
    npcIds.forEach((id) => this.syncNpc(id));
    this.world.entities.list('spawnAreas').forEach((a) => this.syncArea(a.id));
  }

  // ------------------------------------------------------------- NPCs
  private syncNpc(id: EntityId): void {
    const def = this.world.entities.get('npcs', id);
    const existing = this.actors.get(id);
    if (!def) {
      if (existing) this.removeActor(existing);
      return;
    }
    if (!existing) {
      const a = newActor(id, 'npc', id, def.x, def.y, def.maxHp);
      this.actors.set(id, a);
      this.spatial.upsert(a);
      return;
    }
    if (existing.homeX !== def.x || existing.homeY !== def.y) {
      // Home moved in the editor: teleport there.
      existing.homeX = def.x;
      existing.homeY = def.y;
      this.teleport(existing, def.x, def.y);
    }
    if (existing.maxHp !== def.maxHp) {
      existing.hp = Math.min(def.maxHp, Math.round((existing.hp / existing.maxHp) * def.maxHp));
      existing.maxHp = def.maxHp;
    }
  }

  npcDef(a: Actor): NpcDef | undefined {
    return this.world.entities.get('npcs', a.defId);
  }

  // -------------------------------------------------------- creatures
  private syncArea(areaId: EntityId): void {
    const area = this.world.entities.get('spawnAreas', areaId);
    const tpl = area && this.world.entities.get('creatureTemplates', area.templateId);
    const members = [...this.actors.values()].filter((a) => a.spawnAreaId === areaId);
    if (!area || !tpl) {
      members.forEach((m) => this.removeActor(m));
      return;
    }
    // Template switched: rebuild all members.
    const stale = members.filter((m) => m.defId !== tpl.id);
    stale.forEach((m) => this.removeActor(m));
    const keep = members.filter((m) => m.defId === tpl.id);
    for (const m of keep) {
      if (m.maxHp !== tpl.maxHp) {
        m.hp = Math.min(tpl.maxHp, Math.max(1, Math.round((m.hp / m.maxHp) * tpl.maxHp)));
        m.maxHp = tpl.maxHp;
      }
      // Area moved/resized: relocate members that ended up outside.
      if (!this.inArea(area, m.x, m.y)) {
        const p = this.randomTileInArea(area);
        if (p) this.teleport(m, p.x, p.y);
      }
    }
    for (let i = keep.length; i > area.maxCount; i--) this.removeActor(keep[i - 1]);
    for (let i = keep.length; i < area.maxCount; i++) this.spawnCreature(area, tpl);
  }

  spawnCreature(area: SpawnArea, tpl: CreatureTemplate): Actor | null {
    const p = this.randomTileInArea(area);
    if (!p) return null;
    const id = `cr_${area.id}_${Math.floor(this.rand() * 1e9).toString(36)}`;
    const a = newActor(id, 'creature', tpl.id, p.x, p.y, tpl.maxHp);
    a.spawnAreaId = area.id;
    a.idleUntil = this.tick + Math.floor(this.rand() * 40);
    this.actors.set(id, a);
    this.spatial.upsert(a);
    return a;
  }

  template(a: Actor): CreatureTemplate | undefined {
    return this.world.entities.get('creatureTemplates', a.defId);
  }

  area(a: Actor): SpawnArea | undefined {
    return a.spawnAreaId ? this.world.entities.get('spawnAreas', a.spawnAreaId) : undefined;
  }

  inArea(area: SpawnArea, x: number, y: number): boolean {
    return x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h;
  }

  randomTileInArea(area: SpawnArea): { x: number; y: number } | null {
    const cells = (area as { cells?: number[] }).cells;
    for (let i = 0; i < 30; i++) {
      // Painted areas: pick one of the painted cells.
      const c = cells?.length ? cells[Math.floor(this.rand() * cells.length)] : -1;
      const x = c >= 0 ? area.x + (c % area.w) : area.x + Math.floor(this.rand() * area.w);
      const y = c >= 0 ? area.y + Math.floor(c / area.w) : area.y + Math.floor(this.rand() * area.h);
      if (this.world.nav.isWalkable(x, y)) return { x, y };
    }
    return null;
  }

  randomWalkableNear(cx: number, cy: number, r: number): { x: number; y: number } | null {
    for (let i = 0; i < 16; i++) {
      const x = Math.round(cx + (this.rand() * 2 - 1) * r);
      const y = Math.round(cy + (this.rand() * 2 - 1) * r);
      if (this.world.nav.isWalkable(x, y)) return { x, y };
    }
    return null;
  }

  // ---------------------------------------------------------- common
  /** Register an externally managed actor (players). */
  addActor(a: Actor): void {
    this.actors.set(a.id, a);
    this.spatial.upsert(a);
  }

  removeActor(a: Actor): void {
    this.actors.delete(a.id);
    this.spatial.remove(a);
  }

  teleport(a: Actor, tx: number, ty: number): void {
    a.x = tx + 0.5;
    a.y = ty + 0.5;
    a.path = null;
    a.targetId = null;
    a.state = a.state === 'dead' ? 'dead' : 'idle';
    this.spatial.upsert(a);
  }

  /** Plan a path to a tile. Returns false when unreachable. */
  goTo(a: Actor, tx: number, ty: number, maxNodes = 2500): boolean {
    const path = this.pathfinder.find(Math.floor(a.x), Math.floor(a.y), tx, ty, maxNodes);
    if (!path) {
      a.path = null;
      return false;
    }
    a.path = path;
    a.pathIdx = 0;
    a.pathRev = this.world.nav.revision;
    a.goalX = tx;
    a.goalY = ty;
    return true;
  }

  /** Advance along the current path. Returns true when the path is finished. */
  step(a: Actor, speed: number): boolean {
    const path = a.path;
    if (!path || a.pathIdx >= path.length) {
      a.moving = false;
      a.path = null;
      return true;
    }
    const nav = this.world.nav;
    nav.ensure();
    if (a.pathRev !== nav.revision) {
      // Map changed under us: replan.
      if (!this.goTo(a, a.goalX, a.goalY)) return true;
    }
    const W = nav.width;
    let budget = speed * TILES_PER_TICK;
    while (budget > 0 && a.path && a.pathIdx < a.path.length) {
      const idx = a.path[a.pathIdx];
      const tx = (idx % W) + 0.5;
      const ty = Math.floor(idx / W) + 0.5;
      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      const slow = nav.cost[idx] || 1;
      const stepLen = budget / slow;
      if (d <= stepLen) {
        a.x = tx;
        a.y = ty;
        budget -= d * slow;
        a.pathIdx++;
      } else {
        a.x += (dx / d) * stepLen;
        a.y += (dy / d) * stepLen;
        budget = 0;
      }
      if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
    }
    a.moving = true;
    this.spatial.upsert(a);
    if (!a.path || a.pathIdx >= a.path.length) {
      a.path = null;
      a.moving = false;
      return true;
    }
    return false;
  }

  /** Step directly toward a point (used for the final approach to a moving target). */
  stepToward(a: Actor, x: number, y: number, speed: number, stopAt: number): void {
    const dx = x - a.x;
    const dy = y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopAt) {
      a.moving = false;
      return;
    }
    const s = Math.min(d - stopAt, speed * TILES_PER_TICK);
    const nx = a.x + (dx / d) * s;
    const ny = a.y + (dy / d) * s;
    if (this.world.nav.isWalkable(Math.floor(nx), Math.floor(ny))) {
      a.x = nx;
      a.y = ny;
      a.moving = true;
      if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
      this.spatial.upsert(a);
    } else a.moving = false;
  }

  dispose(): void {
    this.unsub();
    this.events.clear();
  }
}
