import { areaTiles, countFor, shapeFrom } from '@/simulation/spawnShape';
import { createId, type EntityId } from '@/core/ids';
import { t as tr } from '@/i18n';
import { getCreatureType, type CreatureType } from '@/data/creatureTypes';
import { getNpcType, randomNpcName, type NpcType } from '@/data/npcTypes';
import { getObjectDef } from '@/data/objects';
import { getRegionType, type RegionType } from '@/data/regionTypes';
import type { CreatureTemplate, EntityCollection, MapObject, NpcDef, Region, SpawnArea, WorldEntities } from '@/models/entities';
import type { EntityChange } from '@/simulation/EntityStore';
import type { WorldRuntime } from '@/simulation/WorldRuntime';
import type { ItemDef, QuestDef } from '@/models/rpg';
import type { EventDef } from '@/models/events';
import type { StudioService } from '@/simulation/studio/StudioService';
import { DEFAULT_NPC_GOLD, defaultLoot, defaultShop, itemKeyIndex } from '@/data/rpgDefaults';
import { getBossPreset, LAIR_SIZE } from '@/data/bossTypes';
import { defaultInterior } from '@/data/furniture';
import { EntityCommand, type History } from './History';
import { autoRewards } from '@/systems/rpg/questRewards';
import type { TileRect } from './shapes';

type Item<C extends EntityCollection> = WorldEntities[C][number];

/** Kinds of things the editor can select on the map. */
export type SelectionKind = 'objects' | 'npcs' | 'regions' | 'spawnAreas';
export interface Selection { col: SelectionKind; ids: EntityId[] }

/**
 * All editor operations on entities. Every call records exactly one undo step.
 * Validation (footprints, bounds) happens here so UI and Phaser can't bypass it.
 */
export class EntityEditor {
  /** Standard mode budget (null in sandbox / tests). */
  budget: StudioService | null = null;
  /** Why the last operation was refused (budget / server caps). */
  lastError: string | null = null;

  constructor(private world: () => WorldRuntime, private history: History) {}

  private get rt() {
    return this.world();
  }

  private commit(label: string, changes: (EntityChange | null)[], mergeKey?: string): EntityChange[] {
    const real = changes.filter((c): c is EntityChange => !!c);
    if (!real.length) return real;
    this.lastError = this.budget?.check(real) ?? null;
    if (this.lastError) {
      // Refused: roll back without charging.
      this.rt.entities.applyChanges(real, 'backward');
      return [];
    }
    this.budget?.apply(real);
    this.history.push(new EntityCommand(label, real, mergeKey));
    return real;
  }

  // ----------------------------------------------------------- objects
  /** `mergeKey` groups a drag-placement stroke into one undo step. */
  placeObject(kind: string, x: number, y: number, mergeKey?: string): MapObject | null {
    const def = getObjectDef(kind);
    if (!def || !this.rt.objectIndex.canPlace(def, x, y)) return null;
    // Don't wall an NPC in with a building.
    if (def.blocks && this.rt.entities.list('npcs').some((n) => n.x >= x && n.x < x + def.w && n.y >= y && n.y < y + def.h)) return null;
    const obj: MapObject = { id: createId('obj'), kind, x, y };
    const furnished = defaultInterior(kind);
    if (furnished) obj.interior = furnished;
    const ok = this.commit(tr('Place {name}', { name: tr(def.name) }), [this.rt.entities.add('objects', obj)], mergeKey);
    return ok.length ? obj : null;
  }

  removeObjectAt(x: number, y: number, mergeKey?: string): boolean {
    const o = this.rt.objectIndex.objectAt(x, y);
    if (!o) return false;
    this.commit(tr('Erase objects'), [this.rt.entities.remove('objects', o.id)], mergeKey);
    return true;
  }

  /** Place many objects in one undo step, skipping invalid spots. */
  placeMany(items: { kind: string; x: number; y: number }[], label: string): number {
    const placed: { col: EntityCollection; id: EntityId; value: MapObject }[] = [];
    for (const it of items) {
      const def = getObjectDef(it.kind);
      if (!def || !this.rt.objectIndex.canPlace(def, it.x, it.y)) continue;
      const obj = { id: createId('obj'), kind: it.kind, x: it.x, y: it.y };
      // Add immediately so later items in the batch see it.
      placed.push({ col: 'objects', id: obj.id, value: obj });
      this.rt.entities.bulk([{ col: 'objects', id: obj.id, value: obj }]);
    }
    if (!placed.length) return 0;
    return this.commit(label, placed.map((p) => ({ col: p.col, id: p.id, before: null, after: structuredClone(p.value) }))).length;
  }

  /** Move objects by (dx,dy). All-or-nothing: fails if any lands on an invalid spot. */
  moveObjects(ids: EntityId[], dx: number, dy: number): boolean {
    if (!dx && !dy) return true;
    const objs = ids.map((id) => this.rt.entities.get('objects', id)).filter((o): o is MapObject => !!o);
    const ignore = new Set(ids);
    for (const o of objs) {
      const def = getObjectDef(o.kind);
      if (!def || !this.rt.objectIndex.canPlace(def, o.x + dx, o.y + dy, ignore)) return false;
    }
    this.commit(objs.length > 1 ? tr('Move objects: {n}', { n: objs.length }) : tr('Move object'), objs.map((o) => this.rt.entities.update('objects', o.id, { x: o.x + dx, y: o.y + dy })));
    return true;
  }

  /** Copy objects with an offset. Returns the new ids (only those that fit). */
  duplicateObjects(ids: EntityId[], dx: number, dy: number): EntityId[] {
    return this.pasteObjects(ids.map((id) => this.rt.entities.get('objects', id)).filter((o): o is MapObject => !!o), dx, dy);
  }

  /** Paste copies of object data (e.g. from the clipboard) shifted by (dx,dy). */
  pasteObjects(objs: MapObject[], dx: number, dy: number): EntityId[] {
    const created: EntityChange[] = [];
    for (const o of objs) {
      const def = getObjectDef(o.kind);
      if (!def || !this.rt.objectIndex.canPlace(def, o.x + dx, o.y + dy)) continue;
      created.push(this.rt.entities.add('objects', { ...o, id: createId('obj'), x: o.x + dx, y: o.y + dy, linkId: undefined }));
    }
    return this.commit(created.length > 1 ? tr('Copy objects: {n}', { n: created.length }) : tr('Copy object'), created).map((c) => c.id);
  }

  // ----------------------------------------------------------- generic
  update<C extends EntityCollection>(col: C, id: EntityId, patch: Partial<Item<C>>, label = tr('Edit')): void {
    this.commit(label, [this.rt.entities.update(col, id, patch)], `${col}:${id}:${label}`);
  }

  remove(col: EntityCollection, ids: EntityId[]): number {
    const changes: (EntityChange | null)[] = ids.map((id) => this.rt.entities.remove(col, id));
    // Deleting a creature template also deletes the spawn areas that use it.
    if (col === 'creatureTemplates') {
      for (const a of this.rt.entities.list('spawnAreas')) if (ids.includes(a.templateId)) changes.push(this.rt.entities.remove('spawnAreas', a.id));
    }
    // Deleting items removes them from shops, inventories, loot tables and quest rewards; quest targets become empty.
    if (col === 'items') {
      const gone = new Set(ids);
      for (const n of this.rt.entities.list('npcs')) {
        if (n.inventory.some((s) => gone.has(s.itemId)) || n.shop.items.some((s) => gone.has(s.itemId)))
          changes.push(this.rt.entities.update('npcs', n.id, { inventory: n.inventory.filter((s) => !gone.has(s.itemId)), shop: { ...n.shop, items: n.shop.items.filter((s) => !gone.has(s.itemId)) } }));
      }
      for (const c of this.rt.entities.list('creatureTemplates'))
        if (c.loot.some((l) => gone.has(l.itemId))) changes.push(this.rt.entities.update('creatureTemplates', c.id, { loot: c.loot.filter((l) => !gone.has(l.itemId)) }));
      for (const q of this.rt.entities.list('quests'))
        if (q.rewards.items.some((s) => gone.has(s.itemId)) || q.objectives.some((o) => o.targetId && gone.has(o.targetId)))
          changes.push(this.rt.entities.update('quests', q.id, {
            rewards: { ...q.rewards, items: q.rewards.items.filter((s) => !gone.has(s.itemId)) },
            objectives: q.objectives.map((o) => (o.targetId && gone.has(o.targetId) ? { ...o, targetId: null } : o)),
          }));
    }
    // Quests: drop chains pointing at deleted quests; givers/targets pointing at deleted NPCs/regions/creatures become empty.
    if (col === 'quests' || col === 'npcs' || col === 'regions' || col === 'creatureTemplates') {
      const gone = new Set(ids);
      for (const q of this.rt.entities.list('quests')) {
        if (gone.has(q.id)) continue;
        const patch: Partial<QuestDef> = {};
        if (q.prerequisiteId && gone.has(q.prerequisiteId)) patch.prerequisiteId = null;
        if (q.giverId && gone.has(q.giverId)) patch.giverId = null;
        if (q.objectives.some((o) => (o.targetId && gone.has(o.targetId)) || (o.receiverId && gone.has(o.receiverId))))
          patch.objectives = q.objectives.map((o) => ({ ...o, targetId: o.targetId && gone.has(o.targetId) ? null : o.targetId, receiverId: o.receiverId && gone.has(o.receiverId) ? null : o.receiverId }));
        if (Object.keys(patch).length) changes.push(this.rt.entities.update('quests', q.id, patch));
      }
    }
    // Unlink portals pointing at deleted portals.
    if (col === 'objects') {
      for (const o of this.rt.entities.list('objects')) if (o.linkId && ids.includes(o.linkId)) changes.push(this.rt.entities.update('objects', o.id, { linkId: undefined }));
    }
    return this.commit(ids.length > 1 ? tr('Deleted: {n}', { n: ids.length }) : tr('Delete'), changes).length;
  }

  // ----------------------------------------------------------- regions & areas
  addRegion(type: RegionType, r: TileRect, name?: string): Region {
    const region: Region = { id: createId('reg'), name: name ?? `${tr(getRegionType(type).name)} ${this.rt.entities.count('regions') + 1}`, type, ...r, minLevel: 1, maxLevel: 10 };
    this.commit(tr('Add region'), [this.rt.entities.add('regions', region)]);
    return region;
  }

  moveRect(col: 'regions' | 'spawnAreas', id: EntityId, r: TileRect): void {
    this.commit(tr('Move area'), [this.rt.entities.update(col, id, r as Partial<Item<typeof col>>)]);
  }

  addSpawnArea(templateId: EntityId, r: TileRect): SpawnArea | null {
    const tpl = this.rt.entities.get('creatureTemplates', templateId);
    if (!tpl) return null;
    const area: SpawnArea = { id: createId('spawn'), name: tr('{name} area', { name: tpl.name }), templateId, ...r, maxCount: Math.max(1, Math.min(12, Math.round((r.w * r.h) / 24))) };
    const ok = this.commit(tr('Add spawn area'), [this.rt.entities.add('spawnAreas', area)]);
    return ok.length ? area : null;
  }

  /**
   * Spawn brush, one stroke = one undo step. With a template: painted tiles join a
   * touching area of the same monster (merging several if the stroke links them) or
   * become a new area. Without (eraser): painted tiles are cut out of every area.
   */
  paintSpawn(templateId: EntityId | null, stroke: Set<number>): number {
    const W = this.rt.grid.width;
    const changes: (EntityChange | null)[] = [];
    const areas = this.rt.entities.list('spawnAreas').filter((a) => !a.lair && !a.eventId);
    if (!templateId) {
      for (const a of areas) {
        const tiles = areaTiles(a, W);
        let hit = false;
        for (const i of stroke) if (tiles.delete(i)) hit = true;
        if (!hit) continue;
        const shape = shapeFrom(tiles, W);
        changes.push(shape ? this.rt.entities.update('spawnAreas', a.id, { ...shape, maxCount: countFor(tiles.size) }) : this.rt.entities.remove('spawnAreas', a.id));
      }
      return this.commit(tr('Erase spawn area'), changes).length;
    }
    const tpl = this.rt.entities.get('creatureTemplates', templateId);
    if (!tpl) return 0;
    // Areas of this monster the stroke touches (or comes within one tile of).
    const near = new Set<number>();
    for (const i of stroke) for (const d of [0, 1, -1, W, -W]) near.add(i + d);
    const touching = areas.filter((a) => a.templateId === templateId && [...areaTiles(a, W)].some((i) => near.has(i)));
    const tiles = new Set(stroke);
    for (const a of touching) for (const i of areaTiles(a, W)) tiles.add(i);
    // Only walkable tiles count.
    for (const i of [...tiles]) if (!this.rt.nav.isWalkable(i % W, Math.floor(i / W))) tiles.delete(i);
    const shape = shapeFrom(tiles, W);
    if (!shape) return 0;
    if (touching.length) {
      const [keep, ...rest] = touching;
      changes.push(this.rt.entities.update('spawnAreas', keep.id, { ...shape, maxCount: Math.max(countFor(tiles.size), Math.min(15, keep.maxCount)) }));
      for (const a of rest) changes.push(this.rt.entities.remove('spawnAreas', a.id));
    } else {
      const area: SpawnArea = { id: createId('spawn'), name: tr('{name} area', { name: tpl.name }), templateId, ...shape, maxCount: countFor(tiles.size) };
      changes.push(this.rt.entities.add('spawnAreas', area));
    }
    return this.commit(tr('Paint spawn area'), changes).length;
  }

  /** Monster-zone brush: a spawn area that belongs to the painted zone. */
  addZoneSpawn(templateId: EntityId, r: TileRect, mergeKey?: string): SpawnArea | null {
    const tpl = this.rt.entities.get('creatureTemplates', templateId);
    if (!tpl) return null;
    const area: SpawnArea = { id: createId('spawn'), name: tr('{name} area', { name: tpl.name }), templateId, ...r, maxCount: 3, zone: true };
    return this.commit(tr('Paint zones'), [this.rt.entities.add('spawnAreas', area)], mergeKey).length ? area : null;
  }

  removeZoneSpawn(id: EntityId, mergeKey?: string): void {
    this.commit(tr('Paint zones'), [this.rt.entities.remove('spawnAreas', id)], mergeKey);
  }

  /** Raid boss template from a preset (loot resolved against this world's items). */
  static makeBossTemplate(presetKey: string, items: ItemDef[]): CreatureTemplate {
    const b = getBossPreset(presetKey);
    const idx = itemKeyIndex(items);
    return {
      id: createId('ctpl'), name: tr(b.name), type: b.type, level: b.level, maxHp: b.maxHp, damage: b.damage, defense: b.defense,
      speed: 1.1, aggression: 'aggressive', aggroRange: 4, attackRange: b.attackRange, respawnMinutes: b.respawnHours * 60,
      xpReward: b.xpReward, boss: true, goldReward: b.gold,
      loot: b.loot.filter(([k]) => idx.has(k)).map(([k, chance, min, max]) => ({ itemId: idx.get(k)!, chance, min, max })),
    };
  }

  /** Place a boss lair centred on a tile: a new boss template + a 1-boss spawn area, one undo step. */
  addLair(presetKey: string, cx: number, cy: number, templateId?: EntityId): SpawnArea | null {
    const g = this.rt.grid;
    const half = Math.floor(LAIR_SIZE / 2);
    const r = { x: Math.max(0, Math.min(g.width - LAIR_SIZE, cx - half)), y: Math.max(0, Math.min(g.height - LAIR_SIZE, cy - half)), w: LAIR_SIZE, h: LAIR_SIZE };
    let walkable = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.rt.nav.isWalkable(x, y)) walkable++;
    if (walkable < 9) { this.lastError = tr('A lair needs open, walkable ground.'); return null; }
    const preset = getBossPreset(presetKey);
    const existing = templateId ? this.rt.entities.get('creatureTemplates', templateId) : undefined;
    const tpl = existing ?? EntityEditor.makeBossTemplate(presetKey, this.rt.entities.list('items'));
    const area: SpawnArea = {
      id: createId('spawn'), name: tr('Lair: {name}', { name: tpl.name }), templateId: tpl.id, ...r, maxCount: 1,
      lair: { respawnHours: preset.respawnHours, minRaid: preset.minRaid },
    };
    const changes = existing ? [] : [this.rt.entities.add('creatureTemplates', tpl)];
    changes.push(this.rt.entities.add('spawnAreas', area) as never);
    const ok = this.commit(tr('Place boss lair'), changes);
    return ok.length ? area : null;
  }

  // ----------------------------------------------------------- NPCs & creatures
  static makeNpc(type: NpcType, x: number, y: number, rand?: () => number, items: ItemDef[] = []): NpcDef {
    const d = getNpcType(type).defaults;
    return {
      id: createId('npc'), name: randomNpcName(type, rand), type, level: d.level, maxHp: d.maxHp, x, y, speed: d.speed,
      behavior: d.behavior, wanderRadius: 5, waypoints: [], inventory: [], gold: DEFAULT_NPC_GOLD[type] ?? 30,
      shop: { enabled: d.hasShop, items: d.hasShop ? defaultShop(type, items) : [] }, workStart: d.workStart, workEnd: d.workEnd, interactionRadius: d.interactionRadius,
    };
  }

  addNpc(type: NpcType, x: number, y: number): NpcDef | null {
    if (!this.rt.nav.isWalkable(x, y)) return null;
    const npc = EntityEditor.makeNpc(type, x, y, undefined, this.rt.entities.list('items'));
    const taken = new Set(this.rt.entities.list('npcs').map((n) => n.name));
    for (let t = 0; t < 30 && taken.has(npc.name); t++) npc.name = EntityEditor.makeNpc(type, x, y).name;
    const ok = this.commit(tr('Add {name}', { name: tr(getNpcType(type).name) }), [this.rt.entities.add('npcs', npc)]);
    return ok.length ? npc : null;
  }

  duplicateNpc(id: EntityId): NpcDef | null {
    const src = this.rt.entities.get('npcs', id);
    if (!src) return null;
    const spot = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]].find(([dx, dy]) => this.rt.nav.isWalkable(src.x + dx, src.y + dy)) ?? [0, 0];
    const copy: NpcDef = { ...structuredClone(src), id: createId('npc'), name: tr('{name} (copy)', { name: src.name }), x: src.x + spot[0], y: src.y + spot[1] };
    const ok = this.commit(tr('Duplicate NPC'), [this.rt.entities.add('npcs', copy)]);
    return ok.length ? copy : null;
  }

  static makeTemplate(type: CreatureType, items: ItemDef[] = []): CreatureTemplate {
    const t = getCreatureType(type);
    return { id: createId('ctpl'), name: tr(t.name), type, ...t.defaults, loot: defaultLoot(type, items), boss: type === 'boss' || type === 'dragon' };
  }

  addTemplate(type: CreatureType): CreatureTemplate {
    const tpl = EntityEditor.makeTemplate(type, this.rt.entities.list('items'));
    this.commit(tr('Add creature'), [this.rt.entities.add('creatureTemplates', tpl)]);
    return tpl;
  }

  duplicateTemplate(id: EntityId): CreatureTemplate | null {
    const src = this.rt.entities.get('creatureTemplates', id);
    if (!src) return null;
    const copy = { ...structuredClone(src), id: createId('ctpl'), name: tr('{name} (copy)', { name: src.name }) };
    this.commit(tr('Duplicate creature'), [this.rt.entities.add('creatureTemplates', copy)]);
    return copy;
  }

  addItem(category: ItemDef['category']): ItemDef {
    const icon = { weapon: 'sword', armor: 'tunic', potion: 'potion_red', resource: 'log', material: 'ingot', food: 'bread', accessory: 'ring', quest: 'letter', misc: 'coin' }[category];
    const slot = category === 'weapon' ? 'mainhand' : category === 'armor' ? 'chest' : category === 'accessory' ? 'ring' : 'none';
    const item: ItemDef = { id: createId('item'), name: tr('New item'), description: '', category, icon, rarity: 'common', value: 10, levelReq: 1, stats: {}, stackSize: ['weapon', 'armor', 'accessory'].includes(category) ? 1 : 20, slot };
    this.commit(tr('Add item'), [this.rt.entities.add('items', item)]);
    return item;
  }

  duplicateItem(id: EntityId): ItemDef | null {
    const src = this.rt.entities.get('items', id);
    if (!src) return null;
    const copy: ItemDef = { ...structuredClone(src), id: createId('item'), key: undefined, name: tr('{name} (copy)', { name: src.name }) };
    this.commit(tr('Duplicate item'), [this.rt.entities.add('items', copy)]);
    return copy;
  }

  addQuest(giverId: EntityId | null): QuestDef {
    const q: QuestDef = {
      id: createId('quest'), name: tr('New quest'), description: '', giverId, requiredLevel: 1,
      objectives: [], rewards: { xp: 100, currency: 20, items: [] }, prerequisiteId: null, repeatable: false, autoRewards: true,
    };
    this.commit(tr('Add quest'), [this.rt.entities.add('quests', q)]);
    return q;
  }

  /** Switch every quest to automatic rewards and recalculate them (one undo step). */
  recalcQuestRewards(): void {
    const changes = this.rt.entities.list('quests').map((q) => this.rt.entities.update('quests', q.id, { autoRewards: true, rewards: autoRewards(q, this.rt) }));
    this.commit(tr('Recalculate rewards'), changes);
  }

  /** Add several ready-made quests as one undo step. */
  addQuests(quests: QuestDef[], label: string): QuestDef[] {
    const ok = this.commit(label, quests.map((q) => this.rt.entities.add('quests', q)));
    return ok.length ? quests : [];
  }

  duplicateQuest(id: EntityId): QuestDef | null {
    const src = this.rt.entities.get('quests', id);
    if (!src) return null;
    const copy: QuestDef = { ...structuredClone(src), id: createId('quest'), name: tr('{name} (copy)', { name: src.name }), objectives: src.objectives.map((o) => ({ ...o, id: createId('obj') })) };
    this.commit(tr('Duplicate quest'), [this.rt.entities.add('quests', copy)]);
    return copy;
  }

  addEvent(def: EventDef): EventDef {
    this.commit(tr('Add event'), [this.rt.entities.add('events', def)]);
    return def;
  }

  duplicateEvent(id: EntityId): EventDef | null {
    const src = this.rt.entities.get('events', id);
    if (!src) return null;
    const copy: EventDef = { ...structuredClone(src), id: createId('evdef'), name: tr('{name} (copy)', { name: src.name }) };
    this.commit(tr('Duplicate event'), [this.rt.entities.add('events', copy)]);
    return copy;
  }

  /** Raw batch (used by generators). */
  commitBatch(label: string, changes: EntityChange[]): void {
    this.commit(label, changes);
  }
}
