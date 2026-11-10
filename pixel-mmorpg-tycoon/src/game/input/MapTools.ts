import Phaser from 'phaser';
import { t as tr } from '@/i18n';
import type { EntityId } from '@/core/ids';
import { getNpcType } from '@/data/npcTypes';
import { getObjectDef } from '@/data/objects';
import { getBossPreset, LAIR_SIZE } from '@/data/bossTypes';
import { getRegionType } from '@/data/regionTypes';
import { ENTERABLE } from '@/data/furniture';
import { TILE_SIZE } from '@/data/terrain';
import { getBiome, pickObject } from '@/data/biomes';
import { getZone } from '@/data/zones';
import type { GameSession } from '@/session/GameSession';
import { displayName } from '@/simulation/actors/combat';
import type { Selection } from '@/systems/editor/EntityEditor';
import { brushFootprint, lineTiles, normalizeRect, type TileRect } from '@/systems/editor/shapes';
import { inArea } from '@/simulation/spawnShape';
import { useEditorStore } from '@/stores/editorStore';
import { log } from '@/stores/logStore';
import { audio } from '@/audio/AudioEngine';
import { toast } from '@/stores/toastStore';
import { DEPTH } from '../render/depth';
import type { EntityRenderer } from '../render/EntityRenderer';
import { ATLAS_KEY } from '../sprites/SpriteAtlas';
import type { CameraController } from './CameraController';
import { ACTIVITY_LABEL } from '@/simulation/players/PlayerBrain';

const S = TILE_SIZE;

interface Pick { col: Selection['col']; id: EntityId }

/** Translates pointer input into editor actions for every map tool. */
export class MapTools {
  private cursor: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Image;
  private painting = false;
  private dragRect: { x: number; y: number } | null = null;
  private moveDrag: { sel: Selection; sx: number; sy: number; dx: number; dy: number } | null = null;
  private strokeKey: string | null = null;
  private lastStrokeTile = '';
  private hover = { x: -1, y: -1, wx: 0, wy: 0 };

  constructor(private scene: Phaser.Scene, private session: GameSession, private renderer: EntityRenderer, private cam: CameraController) {
    this.cursor = scene.add.graphics().setDepth(DEPTH.CURSOR);
    this.ghost = scene.add.image(0, 0, ATLAS_KEY, 'obj:tree_oak').setOrigin(0, 1).setAlpha(0.7).setDepth(DEPTH.CURSOR - 1).setVisible(false);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
    scene.input.on('gameout', () => {
      this.hover = { x: -1, y: -1, wx: 0, wy: 0 };
      this.cursor.clear();
      this.ghost.setVisible(false);
      this.renderer.showHoverLabel(null);
      useEditorStore.getState().setHover(null);
    });
  }

  private get rt() {
    return this.session.runtime;
  }

  private tileOf(p: Phaser.Input.Pointer) {
    const wp = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(wp.x / S), y: Math.floor(wp.y / S), wx: wp.x / S, wy: wp.y / S };
  }

  /** Top-left tile for an object so the cursor sits on its bottom-centre tile. */
  private anchorFor(kind: string, tx: number, ty: number) {
    const d = getObjectDef(kind)!;
    return { x: tx - Math.floor((d.w - 1) / 2), y: ty - (d.h - 1) };
  }

  /** Simulated player under the cursor, if any. */
  pickPlayer(wx: number, wy: number): string | null {
    let best: string | null = null;
    let bestD = 0.7;
    for (const a of this.session.actors.actors.values()) {
      if (a.kind !== 'player' || a.state === 'dead') continue;
      const rp = this.renderer.actorScreenPos(a.id) ?? a;
      const d = Math.hypot(rp.x - wx, rp.y - 0.3 - wy);
      if (d < bestD) { bestD = d; best = a.defId; }
    }
    return best;
  }

  /** What is under the cursor, in priority order: NPC, object, spawn area, region. */
  pick(wx: number, wy: number, tx: number, ty: number): Pick | null {
    let best: Pick | null = null;
    let bestD = 0.75;
    for (const a of this.session.actors.actors.values()) {
      if (a.kind !== 'npc' || a.state === 'dead') continue;
      const rp = this.renderer.actorScreenPos(a.id) ?? a;
      const d = Math.hypot(rp.x - wx, rp.y - 0.3 - wy);
      if (d < bestD) { bestD = d; best = { col: 'npcs', id: a.defId }; }
    }
    if (best) return best;
    const o = this.rt.objectIndex.objectAt(tx, ty);
    if (o) return { col: 'objects', id: o.id };
    const inR = (r: TileRect) => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
    const area = this.rt.entities.list('spawnAreas').find((a) => inArea(a, tx, ty));
    if (area) return { col: 'spawnAreas', id: area.id };
    const reg = this.rt.entities.list('regions').filter(inR).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (reg) return { col: 'regions', id: reg.id };
    return null;
  }

  // ------------------------------------------------------------- down
  private onDown(p: Phaser.Input.Pointer): void {
    if (!p.leftButtonDown() || this.cam.spaceHeld) return;
    const ed = useEditorStore.getState();
    if (ed.tab !== 'map') return;
    const t = this.tileOf(p);
    const grid = this.rt.grid;
    const inMap = grid.inBounds(t.x, t.y);
    switch (ed.tool) {
      case 'brush':
        this.painting = true;
        this.session.painter.beginStroke(ed.terrain);
        this.session.painter.strokeTo(t.x, t.y, ed.brushSize, ed.brushShape);
        break;
      case 'scatter':
        this.scattering = true;
        this.strokeKey = `scatter-${Date.now()}`;
        this.scattered.clear();
        if (ed.biomeGround) { this.painting = true; this.session.painter.beginStroke(getBiome(ed.biome).terrain); this.session.painter.strokeTo(t.x, t.y, ed.brushSize, ed.brushShape); }
        this.scatterAt(t.x, t.y);
        break;
      case 'zone':
        this.zoning = true;
        this.session.zonePainter.begin(ed.zone);
        this.session.zonePainter.strokeTo(t.x, t.y, ed.brushSize, ed.brushShape);
        break;
      case 'fill':
        if (inMap) this.session.painter.fill(t.x, t.y, ed.terrain);
        break;
      case 'picker':
        if (inMap) { ed.setTerrain(grid.get(t.x, t.y)); ed.setTool('brush'); }
        break;
      case 'spawn-area':
        if (!ed.spawnErase && (!ed.templateId || !this.rt.entities.get('creatureTemplates', ed.templateId))) { toast(tr('Pick a creature first'), 'error'); break; }
        this.spawnStroke = new Set();
        this.addSpawnStroke(t.x, t.y);
        break;
      case 'rect':
      case 'region':
        this.dragRect = { x: t.x, y: t.y };
        break;
      case 'lair': {
        if (!inMap) break;
        const ents = this.session.entities;
        ents.lastError = null;
        const area = ents.addLair(ed.bossPreset, t.x, t.y);
        if (area) {
          ed.select({ col: 'spawnAreas', ids: [area.id] });
          ed.setTool('select');
          log.event(tr('Boss lair placed: {name}.', { name: this.rt.entities.get('creatureTemplates', area.templateId)?.name ?? area.name }), 'success', this.rt.clock.totalMinutes);
          const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
          const town = this.rt.entities.list('regions').find((r) => getRegionType(r.type).safe && cx + 9 > r.x && cy + 9 > r.y && cx - 9 < r.x + r.w && cy - 9 < r.y + r.h);
          if (town) toast(tr('Careful: this boss is next to "{name}" and will attack townsfolk and passers-by.', { name: town.name }), 'error');
          audio.play('place');
        } else if (ents.lastError) toast(ents.lastError, 'error');
        break;
      }
      case 'select': {
        const pl = this.pickPlayer(t.wx, t.wy);
        if (pl) { ed.setFocusPlayer(pl); break; }
        const hit = this.pick(t.wx, t.wy, t.x, t.y);
        // Double-click a building to walk inside.
        if (hit?.col === 'objects' && p.event.detail >= 2) {
          const o = this.rt.entities.get('objects', hit.id);
          if (o && ENTERABLE.has(o.kind)) { ed.setInterior(o.id); break; }
        }
        if (!hit) {
          if (!p.event.shiftKey) ed.select(null);
          this.dragRect = { x: t.x, y: t.y };
          break;
        }
        let sel = ed.selection;
        if (p.event.shiftKey && hit.col === 'objects' && sel?.col === 'objects') {
          const ids = sel.ids.includes(hit.id) ? sel.ids.filter((i) => i !== hit.id) : [...sel.ids, hit.id];
          ed.select({ col: 'objects', ids });
          break;
        }
        if (!sel || sel.col !== hit.col || !sel.ids.includes(hit.id)) {
          sel = { col: hit.col, ids: [hit.id] };
          ed.select(sel);
        }
        this.moveDrag = { sel, sx: t.x, sy: t.y, dx: 0, dy: 0 };
        break;
      }
      case 'place-object': {
        this.strokeKey = `place-${Date.now()}`;
        this.lastStrokeTile = '';
        this.placeAt(t.x, t.y);
        break;
      }
      case 'erase-object':
        this.strokeKey = `erase-${Date.now()}`;
        this.session.entities.removeObjectAt(t.x, t.y, this.strokeKey);
        break;
      case 'npc': {
        this.session.entities.lastError = null;
        const npc = this.session.entities.addNpc(ed.npcType, t.x, t.y);
        if (!npc && this.session.entities.lastError) { toast(this.session.entities.lastError, 'error'); break; }
        if (npc) {
          ed.select({ col: 'npcs', ids: [npc.id] });
          audio.play('place');
          log.event(tr('{name} joined the world.', { name: npc.name }), 'info', this.rt.clock.totalMinutes);
        } else toast(tr('NPCs need a walkable tile'), 'error');
        break;
      }
      case 'waypoint': {
        const sel = ed.selection;
        const npc = sel?.col === 'npcs' ? this.rt.entities.get('npcs', sel.ids[0]) : undefined;
        if (!npc) { toast(tr('Select an NPC first'), 'error'); ed.setTool('select'); break; }
        if (!this.rt.nav.isWalkable(t.x, t.y)) { toast(tr('Waypoints need a walkable tile'), 'error'); break; }
        this.session.entities.update('npcs', npc.id, { waypoints: [...npc.waypoints, { x: t.x, y: t.y }], behavior: 'patrol' }, tr('Add waypoint'));
        break;
      }
    }
    this.drawCursor();
  }

  private placeAt(tx: number, ty: number): void {
    const ed = useEditorStore.getState();
    const key = `${tx},${ty}`;
    if (key === this.lastStrokeTile) return;
    this.lastStrokeTile = key;
    const a = this.anchorFor(ed.objectKind, tx, ty);
    this.session.entities.lastError = null;
    const placed = this.session.entities.placeObject(ed.objectKind, a.x, a.y, this.strokeKey ?? undefined);
    if (placed) audio.play('click');
    if (!placed && this.session.entities.lastError) {
      if (this.lastBudgetToast !== this.session.entities.lastError) toast(this.session.entities.lastError, 'error');
      this.lastBudgetToast = this.session.entities.lastError;
    }
  }
  private lastBudgetToast: string | null = null;
  private scattering = false;
  /** Tiles painted by the current spawn-brush stroke (global indices). */
  private spawnStroke: Set<number> | null = null;
  private lastSpawn: [number, number] | null = null;

  private addSpawnStroke(tx: number, ty: number): void {
    const ed = useEditorStore.getState();
    const grid = this.rt.grid;
    const pts = this.lastSpawn ? lineTiles(this.lastSpawn[0], this.lastSpawn[1], tx, ty) : [[tx, ty] as [number, number]];
    this.lastSpawn = [tx, ty];
    for (const [px, py] of pts) for (const [dx, dy] of brushFootprint(ed.brushSize, ed.brushShape)) {
      const x = px + dx, y = py + dy;
      if (grid.inBounds(x, y)) this.spawnStroke!.add(grid.index(x, y));
    }
  }
  private zoning = false;
  private scattered = new Set<number>();

  /** Scatter brush: drop biome objects on some of the tiles under the brush (each tile once per stroke). */
  private scatterAt(tx: number, ty: number): void {
    const ed = useEditorStore.getState();
    const grid = this.rt.grid;
    const b = getBiome(ed.biome);
    const rand = () => this.session.actors.rand();
    for (const [dx, dy] of brushFootprint(ed.brushSize, ed.brushShape)) {
      const x = tx + dx, y = ty + dy;
      if (!grid.inBounds(x, y)) continue;
      const i = grid.index(x, y);
      if (this.scattered.has(i)) continue;
      this.scattered.add(i);
      if (rand() >= ed.density) continue;
      const kind = pickObject(b, rand());
      // Keep a free tile around blocking objects so the forest stays walkable.
      if (getObjectDef(kind)?.blocks && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => this.rt.objectIndex.objectAt(x + ax, y + ay))) continue;
      this.session.entities.lastError = null;
      this.session.entities.placeObject(kind, x, y, this.strokeKey ?? undefined);
      if (this.session.entities.lastError && this.lastBudgetToast !== this.session.entities.lastError) { toast(this.session.entities.lastError, 'error'); this.lastBudgetToast = this.session.entities.lastError; }
    }
  }

  // ------------------------------------------------------------- move
  private onMove(p: Phaser.Input.Pointer): void {
    const t = this.tileOf(p);
    const ed = useEditorStore.getState();
    const down = p.leftButtonDown() && !this.cam.spaceHeld;
    if (this.painting && down) this.session.painter.strokeTo(t.x, t.y, ed.brushSize, ed.brushShape);
    if (this.scattering && down) this.scatterAt(t.x, t.y);
    if (this.spawnStroke && down) this.addSpawnStroke(t.x, t.y);
    if (this.zoning && down) this.session.zonePainter.strokeTo(t.x, t.y, ed.brushSize, ed.brushShape);
    if (down && ed.tool === 'place-object' && this.strokeKey) {
      const d = getObjectDef(ed.objectKind);
      if (d && d.w === 1 && d.h === 1) this.placeAt(t.x, t.y);
    }
    if (down && ed.tool === 'erase-object' && this.strokeKey) this.session.entities.removeObjectAt(t.x, t.y, this.strokeKey);
    if (this.moveDrag) {
      this.moveDrag.dx = t.x - this.moveDrag.sx;
      this.moveDrag.dy = t.y - this.moveDrag.sy;
    }
    const changed = t.x !== this.hover.x || t.y !== this.hover.y;
    this.hover = t;
    if (changed) {
      const grid = this.rt.grid;
      ed.setHover(grid.inBounds(t.x, t.y) ? { x: t.x, y: t.y, terrain: grid.get(t.x, t.y) } : null);
    }
    this.updateHoverLabel(t);
    this.drawCursor();
  }

  private updateHoverLabel(t: { x: number; y: number; wx: number; wy: number }) {
    const hit = this.pick(t.wx, t.wy, t.x, t.y);
    if (hit?.col === 'npcs') {
      const a = this.session.actors.actors.get(hit.id);
      if (a) {
        const def = this.rt.entities.get('npcs', hit.id);
        const rp = this.renderer.actorScreenPos(a.id) ?? a;
        this.renderer.showHoverLabel(`${displayName(this.session.actors, a)} · ${tr('Lv')} ${def?.level ?? '?'} · ${tr(a.state)}`, rp.x * S, (rp.y - 0.8) * S);
        return;
      }
    }
    const pl = this.pickPlayer(t.wx, t.wy);
    const ps = pl ? this.session.players.get(pl) : undefined;
    const pa = pl ? this.session.actors.actors.get(pl) : undefined;
    if (ps && pa) {
      const rp = this.renderer.actorScreenPos(pa.id) ?? pa;
      const act = this.session.playerSystem.activityOf(pa.id);
      this.renderer.showHoverLabel(`${ps.name} · ${tr(this.session.players.classDef(ps).name)} ${tr('Lv')} ${ps.level}${act ? ' · ' + tr(ACTIVITY_LABEL[act.kind]) : ''}`, rp.x * S, (rp.y - 0.8) * S);
      return;
    }
    // Creatures (not selectable, but inspectable)
    for (const a of this.session.actors.actors.values()) {
      if (a.kind !== 'creature' || a.state === 'dead') continue;
      const rp = this.renderer.actorScreenPos(a.id) ?? a;
      if (Math.hypot(rp.x - t.wx, rp.y - 0.3 - t.wy) < 0.7) {
        const tpl = this.session.actors.template(a);
        this.renderer.showHoverLabel(`${tpl?.name ?? '?'} · ${tr('Lv')} ${tpl?.level ?? '?'} · ${a.hp}/${a.maxHp} ${tr('HP')}`, rp.x * S, (rp.y - 0.9) * S);
        return;
      }
    }
    this.renderer.showHoverLabel(null);
  }

  // --------------------------------------------------------------- up
  private onUp(p: Phaser.Input.Pointer): void {
    const ed = useEditorStore.getState();
    const t = this.tileOf(p);
    if (this.painting) {
      this.painting = false;
      this.session.painter.endStroke(tr('Paint'));
    }
    if (this.scattering) { this.scattering = false; audio.play('place'); }
    if (this.spawnStroke) {
      const stroke = this.spawnStroke;
      this.spawnStroke = null;
      this.lastSpawn = null;
      this.session.entities.lastError = null;
      const n = this.session.entities.paintSpawn(ed.spawnErase ? null : ed.templateId, stroke);
      if (n) audio.play('place');
      else if (this.session.entities.lastError) toast(this.session.entities.lastError, 'error');
    }
    if (this.zoning) {
      this.zoning = false;
      this.session.zonePainter.end(ed.zoneTemplate, this.session.players.spawnPoint());
    }
    this.strokeKey = null;
    this.lastBudgetToast = null;
    if (this.dragRect) {
      const r = this.clampRect(normalizeRect(this.dragRect.x, this.dragRect.y, t.x, t.y));
      this.dragRect = null;
      if (r) this.finishRect(r, ed.tool);
    }
    if (this.moveDrag) {
      const { sel, dx, dy } = this.moveDrag;
      this.moveDrag = null;
      if (dx || dy) this.finishMove(sel, dx, dy);
    }
    this.drawCursor();
  }

  private clampRect(r: TileRect): TileRect | null {
    const g = this.rt.grid;
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    const x1 = Math.min(g.width, r.x + r.w), y1 = Math.min(g.height, r.y + r.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  private finishRect(r: TileRect, tool: string): void {
    const ed = useEditorStore.getState();
    switch (tool) {
      case 'rect':
        this.session.painter.rect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, ed.terrain, ed.rectOutline);
        break;
      case 'region': {
        if (r.w < 2 || r.h < 2) { toast(tr('Drag a larger area for the region'), 'error'); return; }
        const reg = this.session.entities.addRegion(ed.regionType, r);
        ed.select({ col: 'regions', ids: [reg.id] });
        log.event(tr('Region "{name}" created ({w}×{h}).', { name: reg.name, w: r.w, h: r.h }), 'info', this.rt.clock.totalMinutes);
        break;
      }
      case 'spawn-area': {
        if (!ed.templateId || !this.rt.entities.get('creatureTemplates', ed.templateId)) { toast(tr('Pick a creature first'), 'error'); return; }
        this.session.entities.lastError = null;
        const area = this.session.entities.addSpawnArea(ed.templateId, r);
        if (area) ed.select({ col: 'spawnAreas', ids: [area.id] });
        else if (this.session.entities.lastError) toast(this.session.entities.lastError, 'error');
        break;
      }
      case 'select': {
        const objs = this.rt.objectIndex.objectsInRect(r);
        if (objs.length) ed.select({ col: 'objects', ids: objs.map((o) => o.id) });
        break;
      }
    }
  }

  private finishMove(sel: Selection, dx: number, dy: number): void {
    const ents = this.session.entities;
    switch (sel.col) {
      case 'objects':
        if (!ents.moveObjects(sel.ids, dx, dy)) toast(tr("Can't move there — blocked"), 'error');
        break;
      case 'npcs': {
        const n = this.rt.entities.get('npcs', sel.ids[0]);
        if (!n) break;
        if (!this.rt.nav.isWalkable(n.x + dx, n.y + dy)) { toast(tr('NPC home must be walkable'), 'error'); break; }
        ents.update('npcs', n.id, { x: n.x + dx, y: n.y + dy, waypoints: n.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) }, tr('Move NPC'));
        break;
      }
      case 'regions':
      case 'spawnAreas': {
        const e = this.rt.entities.get(sel.col, sel.ids[0]);
        if (!e) break;
        const r = { x: e.x + dx, y: e.y + dy, w: e.w, h: e.h };
        const g = this.rt.grid;
        r.x = Math.max(0, Math.min(g.width - r.w, r.x));
        r.y = Math.max(0, Math.min(g.height - r.h, r.y));
        ents.moveRect(sel.col, e.id, r);
        break;
      }
    }
  }

  // ----------------------------------------------------------- cursor
  drawCursor(): void {
    const g = this.cursor;
    g.clear();
    this.ghost.setVisible(false);
    const ed = useEditorStore.getState();
    if (ed.tab !== 'map') return;
    const { x: tx, y: ty } = this.hover;
    const grid = this.rt.grid;

    if (this.dragRect) {
      const r = normalizeRect(this.dragRect.x, this.dragRect.y, tx, ty);
      const color = ed.tool === 'spawn-area' ? 0xe2574c : ed.tool === 'select' ? 0x7fd7ff : 0xffe08a;
      g.fillStyle(color, 0.18).fillRect(r.x * S, r.y * S, r.w * S, r.h * S);
      g.lineStyle(2, color, 1).strokeRect(r.x * S, r.y * S, r.w * S, r.h * S);
      return;
    }
    if (this.moveDrag && (this.moveDrag.dx || this.moveDrag.dy)) {
      const { sel, dx, dy } = this.moveDrag;
      g.lineStyle(2, 0x7fd7ff, 1);
      for (const id of sel.ids) {
        const e = sel.col === 'objects' ? this.rt.entities.get('objects', id) : sel.col === 'npcs' ? this.rt.entities.get('npcs', id) : this.rt.entities.get(sel.col, id);
        if (!e) continue;
        const d = sel.col === 'objects' ? getObjectDef((e as { kind: string }).kind) : null;
        const w = d ? d.w : 'w' in e ? (e as TileRect).w : 1;
        const h = d ? d.h : 'h' in e ? (e as TileRect).h : 1;
        g.fillStyle(0x7fd7ff, 0.15).fillRect((e.x + dx) * S, (e.y + dy) * S, w * S, h * S);
        g.strokeRect((e.x + dx) * S, (e.y + dy) * S, w * S, h * S);
      }
      return;
    }
    if (!grid.inBounds(tx, ty)) return;

    switch (ed.tool) {
      case 'spawn-area': {
        // Painted-so-far tiles of this stroke, then the brush.
        const col = ed.spawnErase ? 0x000000 : 0xe2574c;
        if (this.spawnStroke) {
          g.fillStyle(col, 0.35);
          const W = grid.width;
          for (const i of this.spawnStroke) g.fillRect((i % W) * S, Math.floor(i / W) * S, S, S);
        }
        g.fillStyle(col, 0.25);
        for (const [dx, dy] of brushFootprint(ed.brushSize, ed.brushShape)) g.fillRect((tx + dx) * S, (ty + dy) * S, S, S);
        break;
      }
      case 'brush':
      case 'scatter':
      case 'zone': {
        g.fillStyle(ed.tool === 'zone' ? (getZone(ed.zone)?.color ?? 0xffffff) : 0xffffff, ed.tool === 'zone' ? 0.35 : 0.18);
        for (const [dx, dy] of brushFootprint(ed.brushSize, ed.brushShape)) g.fillRect((tx + dx) * S, (ty + dy) * S, S, S);
        const half = Math.floor((ed.brushSize - 1) / 2);
        g.lineStyle(2, 0xffe08a, 1).strokeRect((tx - half) * S, (ty - half) * S, ed.brushSize * S, ed.brushSize * S);
        break;
      }
      case 'place-object': {
        const d = getObjectDef(ed.objectKind);
        if (!d) break;
        const a = this.anchorFor(ed.objectKind, tx, ty);
        const ok = this.rt.objectIndex.canPlace(d, a.x, a.y);
        this.ghost.setFrame(`obj:${ed.objectKind}`).setPosition(a.x * S, (a.y + d.h) * S).setVisible(true);
        if (ok) this.ghost.clearTint(); else this.ghost.setTint(0xff5040);
        g.lineStyle(2, ok ? 0x9cf0c0 : 0xe2574c, 1).strokeRect(a.x * S, a.y * S, d.w * S, d.h * S);
        break;
      }
      case 'npc': {
        const ok = this.rt.nav.isWalkable(tx, ty);
        this.ghost.setFrame(`npc:${getNpcType(ed.npcType).key}:0`).setPosition(tx * S, (ty + 1) * S).setVisible(true);
        if (ok) this.ghost.clearTint(); else this.ghost.setTint(0xff5040);
        g.lineStyle(2, ok ? 0x9cf0c0 : 0xe2574c, 1).strokeRect(tx * S, ty * S, S, S);
        break;
      }
      case 'lair': {
        const half = Math.floor(LAIR_SIZE / 2);
        const x0 = Math.max(0, Math.min(grid.width - LAIR_SIZE, tx - half)), y0 = Math.max(0, Math.min(grid.height - LAIR_SIZE, ty - half));
        const b = getBossPreset(ed.bossPreset);
        this.ghost.setFrame(`cr:${b.type}:0`).setPosition((x0 + half) * S, (y0 + half + 1) * S).setVisible(true).clearTint();
        g.fillStyle(0xb02020, 0.18).fillRect(x0 * S, y0 * S, LAIR_SIZE * S, LAIR_SIZE * S);
        g.lineStyle(2, 0xe2574c, 1).strokeRect(x0 * S, y0 * S, LAIR_SIZE * S, LAIR_SIZE * S);
        g.lineStyle(1, 0xe2574c, 0.35).strokeCircle((x0 + LAIR_SIZE / 2) * S, (y0 + LAIR_SIZE / 2) * S, (LAIR_SIZE / 2 + 7) * S);
        break;
      }
      case 'erase-object': {
        const o = this.rt.objectIndex.objectAt(tx, ty);
        const d = o && getObjectDef(o.kind);
        g.lineStyle(2, 0xe2574c, 1);
        if (o && d) { g.fillStyle(0xe2574c, 0.25).fillRect(o.x * S, o.y * S, d.w * S, d.h * S); g.strokeRect(o.x * S, o.y * S, d.w * S, d.h * S); }
        else g.strokeRect(tx * S, ty * S, S, S);
        break;
      }
      case 'select': {
        const hit = this.pick(this.hover.wx, this.hover.wy, tx, ty);
        if (hit?.col === 'objects') {
          const o = this.rt.entities.get('objects', hit.id)!;
          const d = getObjectDef(o.kind)!;
          g.lineStyle(1, 0x7fd7ff, 0.9).strokeRect(o.x * S, o.y * S, d.w * S, d.h * S);
        } else g.lineStyle(1, 0x7fd7ff, 0.6).strokeRect(tx * S, ty * S, S, S);
        break;
      }
      default:
        g.lineStyle(2, ed.tool === 'picker' ? 0x7fd7ff : ed.tool === 'waypoint' ? 0xffe08a : 0xffe08a, 1).strokeRect(tx * S, ty * S, S, S);
    }
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.scene.input.off('pointerupoutside', this.onUp, this);
  }
}
