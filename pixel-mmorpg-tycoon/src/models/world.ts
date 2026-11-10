import type { EntityId } from '@/core/ids';
import type { Difficulty, WorldType } from '@/data/worldPresets';
import type { WorldEntities } from './entities';
import type { RpgConfig } from './rpg';
import type { GameMode, SimState, StudioState } from './sim';

/** Bump when the saved shape changes; migrations live in persistence/migrations.ts. */
export const WORLD_SCHEMA_VERSION = 9;

export interface WorldConfig {
  /** Sandbox: everything free. Standard: studio budget, costs and server caps. */
  gameMode: GameMode;
  worldType: WorldType;
  difficulty: Difficulty;
  seed: number;
  startingGold: number;
  /** Stored now, consumed by the NPC system (Phase 2). */
  initialNpcCount: number;
  /** Stored now, consumed by the player simulation (Phase 4). */
  initialPlayerCount: number;
  /** 'ready': generated starter settlement. 'empty': build everything yourself (more money). */
  startMode?: StartMode;
  /** Empty start: servers open (queued players log in) once a spawn point exists. */
  launched?: boolean;
}

export type StartMode = 'ready' | 'empty';

export interface WorldClockState {
  /** Total in-game minutes since world creation. */
  totalMinutes: number;
}

export interface CameraState { x: number; y: number; zoom: number }

/** Map payload in a save: tiles are RLE-encoded to keep saves small. */
export interface SerializedMap {
  width: number;
  height: number;
  tilesRle: string;
  /** Painted zones (town, safe, monsters, PvP), same RLE format. */
  zonesRle?: string;
}

/** Full, serializable world snapshot. Everything a world needs to be restored. */
export interface WorldSave {
  schemaVersion: number;
  id: EntityId;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: WorldConfig;
  map: SerializedMap;
  clock: WorldClockState;
  camera?: CameraState;
  /** Objects, regions, NPCs, creatures (schema v2+). */
  entities: WorldEntities;
  /** Economy & progression rules (schema v3+). */
  rpg: RpgConfig;
  /** Simulated players & popularity (schema v4+). */
  sim: SimState;
  /** Studio finances and servers (schema v4+). */
  studio: StudioState;
}

/** Lightweight listing record (no map data) for menus. */
export interface WorldMeta {
  id: EntityId;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  worldType: WorldType;
  difficulty: Difficulty;
  totalMinutes: number;
  /** Small PNG data URL of the map for the world list. */
  thumbnail?: string;
}

export interface SaveSlotRecord {
  /** `${worldId}:${slotKey}` */
  key: string;
  worldId: EntityId;
  slot: SaveSlotKey;
  savedAt: number;
  label: string;
  data: WorldSave;
}

export type SaveSlotKey = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SAVE_SLOTS: { key: SaveSlotKey; label: string }[] = [
  { key: 'auto', label: 'Autosave' },
  { key: 'slot1', label: 'Slot 1' },
  { key: 'slot2', label: 'Slot 2' },
  { key: 'slot3', label: 'Slot 3' },
];
