import { getZone } from '@/data/zones';
import Phaser from 'phaser';
import { canvasFont, onLangChange, t } from '@/i18n';
import { getCreatureType } from '@/data/creatureTypes';
import { getNpcType } from '@/data/npcTypes';
import { getObjectDef } from '@/data/objects';
import { getRegionType } from '@/data/regionTypes';
import { TerrainId, TILE_SIZE } from '@/data/terrain';
import type { GameSession } from '@/session/GameSession';
import type { Actor } from '@/simulation/actors/Actor';
import { ATTACK_COOLDOWN_TICKS } from '@/simulation/actors/combat';
import { gearCode } from '../sprites/characterArt';
import type { PlayerState } from '@/models/sim';
import { audio } from '@/audio/AudioEngine';

/** Camera zoom from which chat bubbles are shown. */
export const BUBBLE_ZOOM = 1.3;
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ATLAS_KEY, getSpriteAtlas } from '../sprites/SpriteAtlas';
import { DEPTH, entityDepth } from './depth';

const S = TILE_SIZE;

export function registerAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists(ATLAS_KEY)) return;
  const { canvas, frames } = getSpriteAtlas();
  const tex = scene.textures.addCanvas(ATLAS_KEY, canvas)!;
  for (const [name, f] of Object.entries(frames)) tex.add(name, 0, f.x, f.y, f.w, f.h);
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number; g: number }

interface FloatText { text: Phaser.GameObjects.Text; life: number; vy: number }

/**
 * Draws map objects, live actors and editor overlays (regions, spawn areas, selection).
 * Uses pooled game objects; nothing is created per frame in steady state.
 */
export class EntityRenderer {
  private objectSprites = new Map<string, Phaser.GameObjects.Image>();
  private objectsDirty = true;
  private actorPool: Phaser.GameObjects.Sprite[] = [];
  private markerPool: Phaser.GameObjects.Image[] = [];
  private renderPos = new Map<string, { x: number; y: number }>();
  private hpGfx: Phaser.GameObjects.Graphics;
  /** Under actors: clan rings, raid rally flags (redrawn every frame). */
  private groundGfx: Phaser.GameObjects.Graphics;
  /** Particles and shockwaves. */
  private fxGfx: Phaser.GameObjects.Graphics;
  private particles: Particle[] = [];
  private inside = new Set<string>();
  private bubblePool: Phaser.GameObjects.Text[] = [];
  private insideAt = -1e9;
  private waves: { x: number; y: number; r: number; max: number; life: number; color: number }[] = [];
  private overlayGfx: Phaser.GameObjects.Graphics;
  private regionGfx: Phaser.GameObjects.Graphics;
  private labelPool: Phaser.GameObjects.Text[] = [];
  private floatPool: FloatText[] = [];
  private floats: FloatText[] = [];
  private hoverLabel: Phaser.GameObjects.Text;
  private overlaysDirty = true;
  private unsubs: (() => void)[] = [];
  private time = 0;
  /** NPC ids that hand out at least one quest (shown with a "!" marker). */
  private questGivers = new Set<string>();

  constructor(private scene: Phaser.Scene, private session: GameSession) {
    registerAtlas(scene);
    this.regionGfx = scene.add.graphics().setDepth(DEPTH.REGIONS);
    this.overlayGfx = scene.add.graphics().setDepth(DEPTH.OVERLAY);
    this.hpGfx = scene.add.graphics().setDepth(DEPTH.LABELS);
    this.groundGfx = scene.add.graphics().setDepth(DEPTH.ENTITY_BASE - 1);
    this.fxGfx = scene.add.graphics().setDepth(DEPTH.OVERLAY + 1);
    this.hoverLabel = this.makeText('', 12).setDepth(DEPTH.LABELS + 1).setVisible(false);
    this.refreshQuestGivers();

    const rt = session.runtime;
    this.unsubs.push(
      rt.entities.events.on('changed', ({ col }) => {
        if (col === 'quests') this.refreshQuestGivers();
        if (col === 'objects') this.objectsDirty = true;
        this.overlaysDirty = true;
      }),
      rt.events.on('map:replaced', () => { this.objectsDirty = true; this.overlaysDirty = true; }),
      rt.events.on('zones:changed', () => { this.overlaysDirty = true; }),
      onLangChange(() => this.applyFont()),
      session.actors.events.on('hit', ({ target, amount, attacker }) => {
        this.spawnFloat(target.x * S, (target.y - 0.6) * S, `-${amount}`, attacker.kind === 'npc' ? '#ffe08a' : '#ff7a6a');
        this.burst(target.x * S, (target.y - 0.4) * S, 3, [0xffffff, 0xffe08a], 0.12, 260, 2);
        if (this.onScreen(target.x, target.y)) audio.play('hit');
      }),
      session.actors.events.on('portal', ({ fromX, fromY, toX, toY }) => {
        this.burst((fromX + 0.5) * S, (fromY + 0.5) * S, 14, [0xb56cff, 0x7fd7ff, 0xffffff], 0.1, 600, 3, -0.02);
        this.burst((toX + 0.5) * S, (toY + 0.5) * S, 14, [0xb56cff, 0x7fd7ff, 0xffffff], 0.1, 600, 3, -0.02);
        if (this.onScreen(toX, toY) || this.onScreen(fromX, fromY)) audio.play('place');
      }),
      session.actors.events.on('heal', ({ target, amount }) => {
        if (amount === 0) { this.burst(target.x * S, (target.y - 0.6) * S, 10, [0xf2c14e, 0xffffff], 0.08, 500, 2, -0.03); return; } // a buff
        this.spawnFloat(target.x * S, (target.y - 0.6) * S, `+${amount}`, '#9cf0c0');
        this.burst(target.x * S, (target.y - 0.4) * S, 8, [0x9cf0c0, 0xffffff], 0.06, 600, 2, -0.03);
      }),
      session.actors.events.on('slam', ({ actor, radius }) => {
        this.waves.push({ x: actor.x * S, y: actor.y * S, r: 6, max: radius * S, life: 400, color: actor.enraged ? 0xff3030 : 0xffa040 });
        this.burst(actor.x * S, actor.y * S, 14, [0xb08050, 0x806040, 0xffa040], 0.18, 500, 3);
        const view = this.scene.cameras.main.worldView;
        if (view.contains(actor.x * S, actor.y * S)) { this.scene.cameras.main.shake(180, 0.004); audio.play('slam'); }
      }),
      session.actors.events.on('enrage', ({ actor }) => {
        this.spawnFloat(actor.x * S, (actor.y - 2) * S, t('ENRAGED!'), '#ff4040');
        this.burst(actor.x * S, (actor.y - 0.8) * S, 24, [0xff3030, 0xff8040], 0.2, 700, 3);
        if (this.onScreen(actor.x, actor.y)) audio.play('enrage');
      }),
      session.actors.events.on('died', ({ victim }) => {
        if (this.onScreen(victim.x, victim.y)) audio.play('death');
        this.burst(victim.x * S, (victim.y - 0.3) * S, victim.kind === 'creature' && session.actors.template(victim)?.boss ? 40 : 10, [0xdddddd, 0xaaaaaa, 0x777777], 0.08, 600, 4, -0.02);
        if (victim.kind === 'creature') {
          const xp = session.actors.template(victim)?.xpReward ?? 0;
          this.spawnFloat(victim.x * S, (victim.y - 1) * S, `+${xp} XP`, '#9cf0c0');
        }
      }),
      session.players.events.on('levelUp', ({ player, level }) => {
        const a = session.actors.actors.get(player.id);
        if (a) {
          this.spawnFloat(a.x * S, (a.y - 1.1) * S, t('LEVEL {n}!', { n: level }), '#f2c14e');
          this.burst(a.x * S, (a.y - 0.5) * S, 16, [0xf2c14e, 0xffffff, 0xffe08a], 0.1, 900, 2, -0.06);
          if (this.onScreen(a.x, a.y)) audio.play('levelup');
        }
      }),
      session.players.events.on('questDone', ({ player }) => {
        const a = session.actors.actors.get(player.id);
        if (a) this.spawnFloat(a.x * S, (a.y - 1.4) * S, t('Quest complete!'), '#7fd7ff');
        if (a && this.onScreen(a.x, a.y)) audio.play('quest');
      }),
      useEditorStore.subscribe((s, p) => {
        if (s.selection !== p.selection || s.tab !== p.tab || s.tool !== p.tool || s.section !== p.section) this.overlaysDirty = true;
      }),
    );
  }

  private refreshQuestGivers(): void {
    this.questGivers = new Set(this.session.runtime.entities.list('quests').map((q) => q.giverId).filter((x): x is string => !!x));
  }

  private makeText(text: string, size: number): Phaser.GameObjects.Text {
    return this.scene.add
      .text(0, 0, text, { fontFamily: canvasFont().family, fontSize: `${Math.round(size * canvasFont().scale)}px`, color: '#ffffff', stroke: '#000000', strokeThickness: 3, resolution: 2 })
      .setOrigin(0.5, 1);
  }

  /** Switch every pooled text to the current language's font. */
  private applyFont(): void {
    const f = canvasFont();
    const all = [this.hoverLabel, ...this.labelPool, ...this.floatPool.map((x) => x.text), ...this.floats.map((x) => x.text)];
    for (const tx of all) tx.setFontFamily(f.family);
    this.overlaysDirty = true;
  }

  markOverlaysDirty(): void {
    this.overlaysDirty = true;
  }

  // ------------------------------------------------------------ objects
  private syncObjects(): void {
    this.objectsDirty = false;
    const seen = new Set<string>();
    for (const o of this.session.runtime.entities.list('objects')) {
      const def = getObjectDef(o.kind);
      if (!def) continue;
      seen.add(o.id);
      let img = this.objectSprites.get(o.id);
      if (!img) {
        img = this.scene.add.image(0, 0, ATLAS_KEY, `obj:${o.kind}`).setOrigin(0, 1);
        if (o.kind === 'portal') this.scene.tweens.add({ targets: img, alpha: 0.65, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.objectSprites.set(o.id, img);
      }
      img.setFrame(`obj:${o.kind}`);
      const bottom = (o.y + def.h) * S;
      img.setPosition(o.x * S, bottom);
      img.setDepth(def.flat ? DEPTH.FLAT_OBJECTS : entityDepth(bottom - 2));
    }
    for (const [id, img] of this.objectSprites) if (!seen.has(id)) { this.scene.tweens.killTweensOf(img); img.destroy(); this.objectSprites.delete(id); }
  }

  // ------------------------------------------------------------- actors
  /** Hash per actor so animations are not in lockstep. */
  private seed(a: Actor): number {
    let h = 0;
    for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  private gearCache = new Map<string, { key: string; code: string }>();

  /** Visible armour: chest tier by defense, helmet if anything is worn on the head. */
  private gear(p: PlayerState): string {
    const chest = p.equipment.chest, head = p.equipment.head;
    const key = `${chest ?? ''}|${head ?? ''}`;
    const hit = this.gearCache.get(p.id);
    if (hit && hit.key === key) return hit.code;
    const it = chest ? this.session.runtime.entities.get('items', chest) : undefined;
    const def = it?.stats.defense ?? 0;
    const tier = !it ? 0 : def >= 15 ? 3 : def >= 6 ? 2 : 1;
    const code = gearCode(tier, !!head);
    this.gearCache.set(p.id, { key, code });
    return code;
  }

  private isAfk(a: Actor): boolean {
    const act = this.session.playerSystem.activityOf(a.id);
    return act?.kind === 'leisure' && act.action === 'afk' && act.ticks > 0;
  }

  /** Pick the animation pose from what the player is doing. */
  private playerPose(a: Actor, moving: boolean): string {
    const t = this.time + (this.seed(a) % 1000);
    const tick = this.session.actors.tick;
    if (moving) return `walk${Math.floor(t / 110) % 4}`;
    if ((a.castUntil ?? 0) > tick) return `cast${Math.floor(t / 120) % 2}`;
    if (a.state === 'attack') return a.attackCd > ATTACK_COOLDOWN_TICKS - 4 ? 'attack1' : a.attackCd > ATTACK_COOLDOWN_TICKS - 8 ? 'attack0' : 'idle0';
    const act = this.session.playerSystem.activityOf(a.id);
    switch (act?.kind) {
      case 'gather': return `work${Math.floor(t / 260) % 2}`;
      case 'rest': return 'sit';
      case 'leisure':
        if (act.action === 'fish') return 'fish';
        if (act.action === 'campfire') return 'sit';
        if (act.action === 'dance') return `dance${Math.floor(t / 300) % 2}`;
        break;
      case 'social': {
        const slot = Math.floor(t / 4000) % 4;
        if (slot === 0) return `dance${Math.floor(t / 300) % 2}`;
        if (slot === 1) return 'sit';
        if (slot === 2 && this.session.chat.bubbles.has(a.id)) return 'wave';
        break;
      }
    }
    if (this.session.chat.bubbles.has(a.id) && Math.floor(t / 700) % 3 === 0) return 'wave';
    return `idle${Math.floor(t / 600) % 2}`;
  }

  private actorFrame(a: Actor, moving: boolean): { frame: string; scale: number; quest: boolean; live?: boolean; clanColor?: number; boss?: boolean; afk?: boolean } {
    const anim = moving ? Math.floor(this.time / 180 + (a.id.charCodeAt(a.id.length - 1) % 2)) % 2 : 0;
    if (a.kind === 'player') {
      const p = this.session.players.get(a.defId);
      const clan = p?.clanId ? this.session.clans.get(p.clanId) : undefined;
      return { frame: `pl:${p?.classKey ?? 'warrior'}:${this.playerPose(a, moving)}${p ? this.gear(p) : ''}`, scale: 1, quest: false, live: !!p?.streamer, clanColor: clan ? parseInt(clan.color.slice(1), 16) : undefined, afk: this.isAfk(a) };
    }
    if (a.kind === 'npc') {
      const def = this.session.actors.npcDef(a);
      const type = def ? getNpcType(def.type).key : 'villager';
      return { frame: `npc:${type}:${anim}`, scale: 1, quest: this.questGivers.has(a.defId) };
    }
    const tpl = this.session.actors.template(a);
    const type = tpl ? getCreatureType(tpl.type).key : 'slime';
    const bossScale = tpl?.boss && getCreatureType(type).size === 1 ? 1.5 : 1;
    return { frame: `cr:${type}:${anim}`, scale: bossScale, quest: false, boss: !!tpl?.boss };
  }

  private drawActors(dt: number): void {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const margin = 2 * S;
    let used = 0;
    let markers = 0;
    const hp = this.hpGfx;
    hp.clear();
    const ground = this.groundGfx;
    ground.clear();
    this.drawRaids(ground);
    const sel = useEditorStore.getState().selection;
    const selectedNpc = sel?.col === 'npcs' ? new Set(sel.ids) : null;
    const focus = useEditorStore.getState().focusPlayer;
    const k = Math.min(1, dt / 60);
    const alive = new Set<string>();

    // Chat bubbles only when zoomed in (like nameplates in a real MMO).
    const showChat = cam.zoom >= BUBBLE_ZOOM;
    const warRegion = this.session.worldEvents.warRegion();
    let bubbles = 0;
    if (this.time - this.insideAt > 500) { this.inside = this.session.playersInside(); this.insideAt = this.time; }
    for (const a of this.session.actors.actors.values()) {
      alive.add(a.id);
      if (a.state === 'dead') { this.renderPos.delete(a.id); continue; }
      if (this.inside.has(a.id)) continue; // resting inside a building
      let rp = this.renderPos.get(a.id);
      if (!rp || Math.hypot(rp.x - a.x, rp.y - a.y) > 3) {
        rp = { x: a.x, y: a.y };
        this.renderPos.set(a.id, rp);
      } else {
        rp.x += (a.x - rp.x) * k;
        rp.y += (a.y - rp.y) * k;
      }
      const px = rp.x * S;
      const py = rp.y * S;
      if (px < view.x - margin || px > view.right + margin || py < view.y - margin || py > view.bottom + margin * 2) continue;

      let spr = this.actorPool[used];
      if (!spr) {
        spr = this.scene.add.sprite(0, 0, ATLAS_KEY, 'npc:villager:0').setOrigin(0.5, 0.9);
        this.actorPool.push(spr);
      }
      used++;
      const moving = a.moving && this.session.engine.isRunning;
      const f = this.actorFrame(a, moving);
      // Attack lunge: a quick step towards the target right after striking.
      const lunge = a.state === 'attack' && a.attackCd > ATTACK_COOLDOWN_TICKS - 3 ? a.facing * 3 : 0;
      spr.setVisible(true).setFrame(f.frame).setPosition(px + lunge, py + 6).setScale(f.scale).setDepth(entityDepth(py + 6));
      // Standing players look around now and then.
      const lookAround = a.kind === 'player' && !moving && a.state !== 'attack' && Math.floor((this.time + (this.seed(a) % 3000)) / 2500) % 3 === 2;
      spr.setFlipX(lookAround ? a.facing > 0 : a.facing < 0);
      // Fishing: face the water, a bobber floats there with rings around it.
      if (f.frame.includes(':fish')) {
        const g = this.session.runtime.grid;
        const tx = Math.floor(a.x), ty = Math.floor(a.y);
        const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.inBounds(tx + dx, ty + dy) && g.get(tx + dx, ty + dy) === TerrainId.Water);
        if (dir) {
          spr.setFlipX(dir[0] < 0);
          const bx = (tx + dir[0] + 0.5) * S + (dir[0] === 0 ? (dir[1] > 0 ? 6 : -6) : 0), by = (ty + dir[1] + 0.5) * S + Math.sin(this.time / 300) * 1.5;
          const ring = (this.time / 1200) % 1;
          ground.lineStyle(1, 0xffffff, 0.6 * (1 - ring)).strokeEllipse(bx, by + 2, 6 + ring * 14, 3 + ring * 6);
          ground.fillStyle(0xffffff, 1).fillRect(bx - 2, by - 3, 4, 2);
          ground.fillStyle(0xe2574c, 1).fillRect(bx - 2, by - 1, 4, 3);
        }
      }
      // Dust puffs from running feet.
      if (moving && a.kind !== 'npc' && Math.random() < dt / 900) this.burst(px, py + 6, 2, [0xb8a27a, 0x8f7c58], 0.02, 380, 2, -0.00005);
      if (warRegion && a.kind === 'player' && px >= warRegion.x * S && py >= warRegion.y * S && px < (warRegion.x + warRegion.w) * S && py < (warRegion.y + warRegion.h) * S) {
        const side = this.session.worldEvents.faction(a.defId);
        const fc = side ? 0x3a7bd5 : 0xd53a3a;
        hp.lineStyle(1, 0x1a1020, 1).lineBetween(px + 7, py - 26, px + 7, py - 14);
        hp.fillStyle(fc, 1).fillRect(px + 8, py - 26, 7, 5);
      }
      spr.setAlpha(a.state === 'rest' ? 0.75 : 1);
      if (a.hitFlash > 0) spr.setTintFill(0xffffff);
      else if (a.enraged) spr.setTint(Math.floor(this.time / 200) % 2 ? 0xff6060 : 0xff9090);
      else spr.clearTint();
      const b = showChat && a.kind === 'player' ? this.session.chat.bubbles.get(a.id) : undefined;
      if (b && bubbles < 40) {
        let tx = this.bubblePool[bubbles];
        if (!tx) {
          tx = this.scene.add.text(0, 0, '', { fontFamily: canvasFont().family, fontSize: `${Math.round(18 * canvasFont().scale)}px`, color: '#1a1530', backgroundColor: '#f4f1e6', padding: { x: 4, y: 1 }, resolution: 2 }).setOrigin(0.5, 1).setDepth(DEPTH.LABELS + 3);
          this.bubblePool.push(tx);
        }
        bubbles++;
        const text = t(b.key, b.params);
        tx.setText(text.length > 40 ? text.slice(0, 38) + '…' : text).setPosition(px, py - (f.scale > 1 ? 60 : 36)).setScale(1 / cam.zoom * 1.1).setVisible(true);
      }
      if (f.clanColor !== undefined) {
        ground.fillStyle(f.clanColor, 0.25).fillEllipse(px, py + 5, 22, 9);
        ground.lineStyle(2, f.clanColor, 1).strokeEllipse(px, py + 5, 22, 9);
      }

      // Quest marker / sleeping marker / AFK
      if (f.quest || a.state === 'rest' || f.live || f.afk) {
        let m = this.markerPool[markers];
        if (!m) { m = this.scene.add.image(0, 0, ATLAS_KEY, 'fx:quest').setOrigin(0.5, 1); this.markerPool.push(m); }
        markers++;
        const bob = f.live ? 0 : Math.sin(this.time / 250) * 2;
        const frame = f.live ? 'fx:live' : a.state === 'rest' || f.afk ? 'fx:zzz' : 'fx:quest';
        m.setVisible(true).setFrame(frame).setPosition(px + (a.state === 'rest' ? 8 : 0), py - (f.live ? 26 : 22) + bob).setDepth(DEPTH.LABELS).setAlpha(f.live && Math.floor(this.time / 600) % 2 ? 0.75 : 1);
      }

      // HP bar when damaged or selected
      const selected = selectedNpc?.has(a.defId) || (a.kind === 'player' && focus === a.defId);
      if (f.boss && (a.hp < a.maxHp || a.targetId)) {
        // Raid boss: wide bar with a frame.
        const w = 64, top = py - (f.frame.startsWith('cr:dragon') || f.frame.startsWith('cr:boss') ? 66 : 44);
        hp.fillStyle(0x000000, 0.85).fillRect(px - w / 2 - 2, top - 2, w + 4, 8);
        hp.fillStyle(a.enraged ? 0xff3030 : 0xc0392b, 1).fillRect(px - w / 2, top, w * Math.max(0, a.hp / a.maxHp), 4);
        hp.lineStyle(1, 0xf2c14e, 1).strokeRect(px - w / 2 - 2, top - 2, w + 4, 8);
      } else if (a.hp < a.maxHp || selected) {
        const w = 22 * f.scale * (a.kind === 'creature' && f.frame.includes('dragon') ? 2 : 1);
        const top = py - (f.frame.startsWith('cr:dragon') || f.frame.startsWith('cr:boss') ? 58 : 26 * f.scale);
        hp.fillStyle(0x000000, 0.8).fillRect(px - w / 2 - 1, top - 1, w + 2, 5);
        const pct = Math.max(0, a.hp / a.maxHp);
        hp.fillStyle(pct > 0.5 ? 0x6cc551 : pct > 0.25 ? 0xf2c14e : 0xe2574c, 1).fillRect(px - w / 2, top, w * pct, 3);
      }
      if (selected) {
        hp.lineStyle(2, 0xffe08a, 1).strokeEllipse(px, py + 5, 26, 10);
      }
    }
    for (let i = used; i < this.actorPool.length; i++) this.actorPool[i].setVisible(false);
    for (let i = bubbles; i < this.bubblePool.length; i++) this.bubblePool[i].setVisible(false);
    for (let i = markers; i < this.markerPool.length; i++) this.markerPool[i].setVisible(false);
    for (const id of this.renderPos.keys()) if (!alive.has(id)) this.renderPos.delete(id);
  }

  /** Smoothed render position of an actor (for picking and labels). */
  actorScreenPos(id: string): { x: number; y: number } | undefined {
    return this.renderPos.get(id);
  }

  showHoverLabel(text: string | null, x = 0, y = 0): void {
    if (!text) { this.hoverLabel.setVisible(false); return; }
    this.hoverLabel.setText(text).setPosition(x, y).setVisible(true);
  }

  // ----------------------------------------------------------- overlays
  private drawOverlays(): void {
    this.overlaysDirty = false;
    const rt = this.session.runtime;
    const g = this.regionGfx;
    const o = this.overlayGfx;
    g.clear();
    o.clear();
    const ed = useEditorStore.getState();
    const show = useSettingsStore.getState().showRegions;
    let labels = 0;
    const label = (text: string, x: number, y: number, color: string) => {
      let t = this.labelPool[labels];
      if (!t) { t = this.makeText('', 14).setOrigin(0, 0).setDepth(DEPTH.LABELS); this.labelPool.push(t); }
      labels++;
      t.setText(text).setColor(color).setPosition(x, y).setVisible(true);
    };
    const sel = ed.selection;
    const isSel = (col: string, id: string) => sel?.col === col && sel.ids.includes(id);

    // Painted zones: tinted tiles, merged into runs per row.
    const zoneTool = ed.tool === 'zone' || ed.section === 'zones';
    if (show || zoneTool) {
      const z = rt.zones;
      for (let y = 0; y < z.height; y++) {
        let x = 0;
        while (x < z.width) {
          const v = z.tiles[z.index(x, y)];
          if (!v) { x++; continue; }
          let e = x + 1;
          while (e < z.width && z.tiles[z.index(e, y)] === v) e++;
          const def = getZone(v);
          if (def) g.fillStyle(def.color, zoneTool ? 0.3 : 0.14).fillRect(x * S, y * S, (e - x) * S, S);
          x = e;
        }
      }
    }
    if (show || ed.tool === 'region' || sel?.col === 'regions') {
      for (const r of rt.entities.list('regions')) {
        const c = getRegionType(r.type).color;
        g.fillStyle(c, 0.1).fillRect(r.x * S, r.y * S, r.w * S, r.h * S);
        g.lineStyle(isSel('regions', r.id) ? 4 : 2, c, isSel('regions', r.id) ? 1 : 0.7).strokeRect(r.x * S, r.y * S, r.w * S, r.h * S);
        label(`${r.name}  ${t('Lv')} ${r.minLevel}-${r.maxLevel}`, r.x * S + 4, r.y * S + 2, `#${c.toString(16).padStart(6, '0')}`);
      }
    }
    // Boss lairs are always marked: scorched ground, a skull-red ring and the name.
    for (const a of rt.entities.list('spawnAreas')) {
      if (!a.lair) continue;
      const cx = (a.x + a.w / 2) * S, cy = (a.y + a.h / 2) * S;
      g.fillStyle(0x2a0a0a, 0.28).fillEllipse(cx, cy, a.w * S, a.h * S * 0.8);
      g.lineStyle(isSel('spawnAreas', a.id) ? 3 : 2, 0xb02020, 0.85).strokeEllipse(cx, cy, a.w * S, a.h * S * 0.8);
      label(a.name, a.x * S, (a.y + a.h) * S + 2, '#ff6a5a');
    }
    if (show || ed.tool === 'spawn-area' || sel?.col === 'spawnAreas') {
      for (const a of rt.entities.list('spawnAreas')) {
        if (a.lair && !isSel('spawnAreas', a.id)) continue;
        const tpl = rt.entities.get('creatureTemplates', a.templateId);
        const selA = isSel('spawnAreas', a.id);
        o.lineStyle(selA ? 3 : 2, 0xe2574c, selA ? 1 : 0.8);
        this.dashedRect(o, a.x * S, a.y * S, a.w * S, a.h * S);
        if (selA) o.fillStyle(0xe2574c, 0.08).fillRect(a.x * S, a.y * S, a.w * S, a.h * S);
        label(`${tpl?.name ?? '?'} ×${a.maxCount}`, a.x * S + 4, (a.y + a.h) * S - 18, '#ff9a8a');
      }
    }
    // Selected objects
    if (sel?.col === 'objects') {
      o.lineStyle(2, 0xffe08a, 1);
      for (const id of sel.ids) {
        const ob = rt.entities.get('objects', id);
        const d = ob && getObjectDef(ob.kind);
        if (ob && d) o.strokeRect(ob.x * S - 1, ob.y * S - 1, d.w * S + 2, d.h * S + 2);
        if (ob?.kind === 'portal' && ob.linkId) {
          const dest = rt.entities.get('objects', ob.linkId);
          if (dest) { o.lineStyle(2, 0xb56cff, 0.9); o.lineBetween((ob.x + 0.5) * S, (ob.y + 0.5) * S, (dest.x + 0.5) * S, (dest.y + 0.5) * S); }
        }
      }
    }
    // Selected NPC: home, radius, waypoints
    if (sel?.col === 'npcs' && sel.ids.length === 1) {
      const n = rt.entities.get('npcs', sel.ids[0]);
      if (n) {
        const hx = (n.x + 0.5) * S, hy = (n.y + 0.5) * S;
        o.lineStyle(1, 0x7fd7ff, 0.8).strokeCircle(hx, hy, n.interactionRadius * S);
        if (n.behavior === 'wander') { o.lineStyle(1, 0x9cf0c0, 0.6); this.dashedRect(o, (n.x - n.wanderRadius) * S, (n.y - n.wanderRadius) * S, (n.wanderRadius * 2 + 1) * S, (n.wanderRadius * 2 + 1) * S); }
        o.fillStyle(0xffe08a, 1).fillRect(n.x * S + 12, n.y * S + 12, 8, 8);
        if (n.behavior === 'patrol' && n.waypoints.length) {
          const pts = [{ x: n.x, y: n.y }, ...n.waypoints];
          o.lineStyle(2, 0xffe08a, 0.8);
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            o.lineBetween((p.x + 0.5) * S, (p.y + 0.5) * S, (q.x + 0.5) * S, (q.y + 0.5) * S);
            if (i > 0) { o.fillStyle(0xffe08a, 1).fillCircle((p.x + 0.5) * S, (p.y + 0.5) * S, 5); label(`${i}`, (p.x + 0.5) * S + 6, (p.y + 0.5) * S - 8, '#ffe08a'); }
          }
        }
      }
    }
    for (let i = labels; i < this.labelPool.length; i++) this.labelPool[i].setVisible(false);
  }

  private dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const dash = 8;
    const seg = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < len; d += dash * 2) {
        const t0 = d / len, t1 = Math.min(1, (d + dash) / len);
        g.lineBetween(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
      }
    };
    seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
  }

  // ------------------------------------------------------- float text
  private spawnFloat(x: number, y: number, text: string, color: string): void {
    if (this.floats.length > 60) return;
    const f = this.floatPool.pop() ?? { text: this.makeText('', 16), life: 0, vy: 0 };
    f.text.setText(text).setColor(color).setPosition(x, y).setAlpha(1).setVisible(true).setDepth(DEPTH.LABELS + 2);
    f.life = 900;
    f.vy = -0.03;
    this.floats.push(f);
  }

  private updateFloats(dt: number): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      f.text.y += f.vy * dt;
      f.text.setAlpha(Math.min(1, f.life / 300));
      if (f.life <= 0) {
        f.text.setVisible(false);
        this.floats.splice(i, 1);
        this.floatPool.push(f);
      }
    }
  }

  // ---------------------------------------------------------- raids & fx
  /** Raid rally points: a banner in the clan colour while the raid gathers. */
  private drawRaids(g: Phaser.GameObjects.Graphics): void {
    // Meetups: a soft ring where players gather to talk.
    for (const m of this.session.meetups.active) {
      const x = (m.x + 0.5) * S, y = (m.y + 0.5) * S;
      const pulse = 0.85 + 0.15 * Math.sin(this.time / 400);
      g.lineStyle(2, 0xffe08a, 0.55).strokeEllipse(x, y, 4.4 * S * pulse, 3.2 * S * pulse);
      g.fillStyle(0xffe08a, 0.08).fillEllipse(x, y, 4.4 * S * pulse, 3.2 * S * pulse);
    }
    for (const r of this.session.runtime.sim.raids) {
      const clan = this.session.clans.get(r.clanId);
      const color = clan ? parseInt(clan.color.slice(1), 16) : 0xdddddd;
      const x = (r.rallyX + 0.5) * S, y = (r.rallyY + 0.5) * S;
      const wave = Math.sin(this.time / 200) * 2;
      g.fillStyle(0x000000, 0.3).fillEllipse(x, y + 4, 18, 6);
      g.lineStyle(2, 0x5a3a1a, 1).lineBetween(x, y + 4, x, y - 22);
      g.fillStyle(color, 1).fillTriangle(x, y - 22, x + 14, y - 17 + wave, x, y - 12);
      if (r.phase === 'gathering') g.lineStyle(1, color, 0.5).strokeCircle(x, y, 5 * S * (0.9 + 0.1 * Math.sin(this.time / 300)));
    }
  }

  private onScreen(x: number, y: number): boolean {
    return this.scene.cameras.main.worldView.contains(x * S, y * S);
  }

  private burst(x: number, y: number, n: number, colors: number[], speed: number, life: number, size: number, gravity = 0.0004): void {
    for (let i = 0; i < n && this.particles.length < 500; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - speed * 0.5, life, max: life, color: colors[i % colors.length], size, g: gravity });
    }
  }

  private updateFx(dt: number): void {
    const g = this.fxGfx;
    g.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.fillStyle(p.color, Math.min(1, (p.life / p.max) * 1.5)).fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      if (w.life <= 0) { this.waves.splice(i, 1); continue; }
      w.r += (w.max - w.r) * Math.min(1, dt / 90);
      g.lineStyle(3, w.color, w.life / 400).strokeEllipse(w.x, w.y, w.r * 2, w.r * 1.2);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.updateFx(dt);
    if (this.objectsDirty) this.syncObjects();
    if (this.overlaysDirty) this.drawOverlays();
    this.drawActors(dt);
    this.updateFloats(dt);
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
    this.particles = [];
  }
}
