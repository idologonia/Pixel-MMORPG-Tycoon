import { dist, isAlive, type Actor } from '../actors/Actor';
import type { ActorManager } from '../actors/ActorManager';
import { attack, combatStats, engage, respawn, type CombatStats } from '../actors/combat';
import { BOSS_ENRAGE_AT, BOSS_SLAM_POWER, BOSS_SLAM_RADIUS, BOSS_SLAM_TICKS } from '@/data/bossTypes';
import type { CreatureTemplate, SpawnArea } from '@/models/entities';
import type { SimContext, SimulationSystem } from '../types';

/** Monster behaviour: respawning, wandering their spawn area, aggro, chasing, leashing. */
export class CreatureSystem implements SimulationSystem {
  readonly id = 'creatures';
  private near: Actor[] = [];

  constructor(private mgr: ActorManager) {}

  update(ctx: SimContext): void {
    const mgr = this.mgr;
    mgr.tick = ctx.tick;
    for (const a of mgr.actors.values()) {
      if (a.kind !== 'creature') continue;
      const tpl = mgr.template(a);
      const area = mgr.area(a);
      const stats = combatStats(mgr, a);
      if (!tpl || !area || !stats) continue;

      if (a.state === 'dead') {
        if (mgr.gameMinutes >= a.respawnAt) {
          const p = mgr.randomTileInArea(area);
          if (p) respawn(mgr, a, p.x, p.y);
        }
        continue;
      }
      if (a.attackCd > 0) a.attackCd--;
      if (a.hitFlash > 0) a.hitFlash--;
      if (tpl.boss) { this.boss(a, tpl, area, stats, ctx.tick); continue; }

      let target = a.targetId ? mgr.actors.get(a.targetId) : undefined;
      if (target && !isAlive(target)) target = undefined;
      // Prey that reached a town or safe zone is out of reach: go home.
      if (target && this.safe(target)) {
        target = undefined;
        a.lastAttackerId = null;
        a.state = 'return';
        const p = mgr.randomTileInArea(area);
        if (p) mgr.goTo(a, p.x, p.y);
      }
      if (!target) a.targetId = null;
      const attacker = a.lastAttackerId ? mgr.actors.get(a.lastAttackerId) : undefined;

      if (!target && tpl.aggression === 'aggressive' && ctx.tick >= a.nextThink) {
        a.nextThink = ctx.tick + 4 + Math.floor(mgr.rand() * 4);
        target = this.findPrey(a, tpl.aggroRange);
        if (target) a.targetId = target.id;
      }
      if (!target && tpl.aggression === 'defensive' && attacker && isAlive(attacker) && !this.safe(attacker)) {
        target = attacker;
        a.targetId = attacker.id;
      }

      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      const leash = Math.max(area.w, area.h) / 2 + tpl.aggroRange + 4;

      if (target) {
        if (Math.hypot(a.x - cx, a.y - cy) > leash) {
          // Too far from home: give up and go back.
          a.targetId = null;
          a.lastAttackerId = null;
          a.state = 'return';
          const p = mgr.randomTileInArea(area);
          if (p) mgr.goTo(a, p.x, p.y);
        } else {
          engage(mgr, a, target, stats);
          continue;
        }
      }

      if (tpl.aggression === 'passive' && attacker && isAlive(attacker) && dist(a, attacker) < 5) {
        if (!a.path) {
          const away = mgr.randomWalkableNear(a.x + (a.x - attacker.x) * 2, a.y + (a.y - attacker.y) * 2, 2);
          if (away) mgr.goTo(a, away.x, away.y, 800);
        }
        a.state = 'flee';
        mgr.step(a, stats.speed * 1.2);
        continue;
      }

      // Out of combat: slowly regenerate, wander inside the area.
      if (a.hp < a.maxHp && ctx.tick % 10 === 0) a.hp = Math.min(a.maxHp, a.hp + Math.ceil(a.maxHp * 0.02));
      if (a.path) {
        a.state = a.state === 'return' ? 'return' : 'walk';
        if (mgr.step(a, stats.speed * (a.state === 'return' ? 1.2 : 0.7))) {
          a.state = 'idle';
          a.idleUntil = ctx.tick + 15 + Math.floor(mgr.rand() * 60);
        }
        continue;
      }
      a.state = 'idle';
      a.moving = false;
      if (ctx.tick >= a.idleUntil) {
        const p = mgr.randomTileInArea(area);
        if (!p || !mgr.goTo(a, p.x, p.y, 1200)) a.idleUntil = ctx.tick + 25;
      }
    }
  }

  /**
   * Raid boss: guards its lair, switches targets now and then (no real threat table —
   * just like real MMOs feel), slams everyone nearby, enrages at low health and
   * fully resets when the raid dies or runs away.
   */
  private boss(a: Actor, tpl: CreatureTemplate, area: SpawnArea, stats: CombatStats, tick: number): void {
    const mgr = this.mgr;
    const home = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    const leash = Math.max(area.w, area.h) / 2 + 7;
    const inReach = (o: Actor) => isAlive(o) && dist(o, home) <= leash && !this.safe(o);
    let target = a.targetId ? mgr.actors.get(a.targetId) : undefined;
    if (target && !inReach(target)) target = undefined;
    if (!target || tick >= a.nextThink) {
      a.nextThink = tick + 30;
      const engaged = !!target || !!a.damagers?.size;
      const prey = this.findPrey(a, engaged ? leash + 2 : tpl.aggroRange, inReach);
      if (!target || (prey && mgr.rand() < 0.25)) target = prey;
    }
    if (!target) {
      a.targetId = null;
      if (a.damagers?.size || a.enraged || a.hp < a.maxHp) {
        if (a.damagers?.size) mgr.events.emit('bossReset', { actor: a });
        a.damagers = null;
        a.enraged = false;
        a.lastAttackerId = null;
        a.hp = a.maxHp;
        a.slamAt = 0;
      }
      if (dist(a, home) > 1.2) {
        if (!a.path) mgr.goTo(a, Math.floor(home.x), Math.floor(home.y), 800);
        a.state = 'return';
        if (!a.path || mgr.step(a, stats.speed * 1.4)) a.path = null;
      } else {
        a.state = 'idle';
        a.moving = false;
        a.path = null;
      }
      return;
    }
    a.targetId = target.id;
    if (!a.enraged && a.hp < a.maxHp * BOSS_ENRAGE_AT) {
      a.enraged = true;
      mgr.events.emit('enrage', { actor: a });
    }
    if (!a.slamAt) a.slamAt = tick + BOSS_SLAM_TICKS;
    if (tick >= a.slamAt) {
      a.slamAt = tick + BOSS_SLAM_TICKS;
      this.near.length = 0;
      mgr.spatial.query(a.x, a.y, BOSS_SLAM_RADIUS, this.near);
      let victims = 0;
      for (const o of [...this.near]) {
        if (o.kind === 'creature' || !isAlive(o) || dist(a, o) > BOSS_SLAM_RADIUS) continue;
        attack(mgr, a, o, BOSS_SLAM_POWER);
        victims++;
      }
      mgr.events.emit('slam', { actor: a, radius: BOSS_SLAM_RADIUS, victims });
      if (!isAlive(target)) return;
    }
    engage(mgr, a, target, stats);
  }

  /** Standing in a town or safe zone: monsters won't attack. */
  private safe(o: Actor): boolean {
    return this.mgr.world.safeAt(Math.floor(o.x), Math.floor(o.y));
  }

  private findPrey(a: Actor, range: number, ok?: (o: Actor) => boolean): Actor | undefined {
    this.near.length = 0;
    this.mgr.spatial.query(a.x, a.y, range, this.near);
    let best: Actor | undefined;
    let bestD = Infinity;
    for (const o of this.near) {
      if (o.kind === 'creature' || !isAlive(o) || (ok && !ok(o)) || this.safe(o)) continue;
      const d = dist(a, o);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }
}
