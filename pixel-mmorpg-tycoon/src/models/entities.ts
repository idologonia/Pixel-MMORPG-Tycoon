import type { EntityId } from '@/core/ids';
import type { Aggression, CreatureType } from '@/data/creatureTypes';
import type { NpcBehavior, NpcType } from '@/data/npcTypes';
import type { RegionType } from '@/data/regionTypes';
import type { ItemDef, ItemStack, LootEntry, QuestDef, ShopEntry } from './rpg';
import type { EventDef } from './events';

export type { ItemStack, LootEntry, ShopEntry } from './rpg';

/** Editor-authored definitions. Runtime state (positions, HP) lives in the simulation. */

export interface MapObject {
  id: EntityId;
  kind: string;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  name?: string;
  /** Portal: id of the linked destination portal. */
  linkId?: EntityId;
  /** Enterable buildings: furniture placed inside. */
  interior?: Interior;
  /** Dungeon / cave entrances: an instanced group dungeon. */
  dungeon?: { level: number; name?: string };
}

export type FurnitureKind = 'spawn' | 'bed' | 'table' | 'chair' | 'counter' | 'barrel' | 'fireplace' | 'rug' | 'plant' | 'shelf';
export interface Furniture { kind: FurnitureKind; x: number; y: number; /** Beds: the player renting this room. */ ownerId?: EntityId }
export interface Interior { furniture: Furniture[] }

export interface Region {
  id: EntityId;
  name: string;
  type: RegionType;
  x: number;
  y: number;
  w: number;
  h: number;
  minLevel: number;
  maxLevel: number;
}

export interface Point { x: number; y: number }

export interface NpcDef {
  id: EntityId;
  name: string;
  type: NpcType;
  level: number;
  maxHp: number;
  /** Home tile. */
  x: number;
  y: number;
  /** Tiles per second at x1 speed. */
  speed: number;
  behavior: NpcBehavior;
  wanderRadius: number;
  waypoints: Point[];
  inventory: ItemStack[];
  /** Coins the NPC carries (used for trading). */
  gold: number;
  shop: { enabled: boolean; items: ShopEntry[] };
  /** Working hours, 0–24. Outside them the NPC goes home and rests. */
  workStart: number;
  workEnd: number;
  interactionRadius: number;
  /** Created by a world event (e.g. a travelling merchant). */
  eventId?: EntityId;
}

export interface CreatureTemplate {
  id: EntityId;
  name: string;
  type: CreatureType;
  level: number;
  maxHp: number;
  damage: number;
  defense: number;
  speed: number;
  aggression: Aggression;
  aggroRange: number;
  attackRange: number;
  respawnMinutes: number;
  xpReward: number;
  loot: LootEntry[];
  boss: boolean;
  /** Gold each participant receives on a kill (raid bosses). */
  goldReward?: number;
}

export interface SpawnArea {
  id: EntityId;
  name: string;
  templateId: EntityId;
  x: number;
  y: number;
  w: number;
  h: number;
  maxCount: number;
  /** Made by the monster-zone brush (removed when the zone is erased). */
  zone?: boolean;
  /** Created by a world event; removed when the event ends (free of charge). */
  eventId?: EntityId;
  /** Boss lair: one boss that stays home, respawns slowly and needs a raid. */
  lair?: LairConfig;
}

export interface LairConfig {
  /** Game hours before the boss comes back after a kill. */
  respawnHours: number;
  /** Recommended raid size (players gather at least this many before pulling). */
  minRaid: number;
}

export interface WorldEntities {
  objects: MapObject[];
  regions: Region[];
  npcs: NpcDef[];
  creatureTemplates: CreatureTemplate[];
  spawnAreas: SpawnArea[];
  items: ItemDef[];
  quests: QuestDef[];
  events: EventDef[];
}

export type EntityCollection = keyof WorldEntities;

export function emptyEntities(): WorldEntities {
  return { objects: [], regions: [], npcs: [], creatureTemplates: [], spawnAreas: [], items: [], quests: [], events: [] };
}
