import { getBiome } from '@/data/biomes';
import { create } from 'zustand';
import type { EntityId } from '@/core/ids';
import type { NpcType } from '@/data/npcTypes';
import type { RegionType } from '@/data/regionTypes';
import { TerrainId } from '@/data/terrain';
import type { Selection } from '@/systems/editor/EntityEditor';
import type { BrushShape } from '@/systems/editor/shapes';

export type EditorTab = 'map' | 'npc' | 'creatures' | 'economy' | 'items' | 'quests' | 'progression' | 'players' | 'studio' | 'community' | 'clans' | 'auction' | 'seasons' | 'patches' | 'events' | 'analytics' | 'settings';

/** Terrain tools + entity tools. */
export type EditorTool =
  | 'brush' | 'fill' | 'rect' | 'picker'
  | 'select' | 'place-object' | 'erase-object'
  | 'region' | 'npc' | 'spawn-area' | 'waypoint' | 'lair' | 'scatter' | 'zone';

export type LeftSection = 'terrain' | 'objects' | 'regions' | 'npc' | 'creatures' | 'spawns' | 'zones';

export interface HoverInfo { x: number; y: number; terrain: number }

interface EditorState {
  tab: EditorTab;
  section: LeftSection;
  tool: EditorTool;
  terrain: TerrainId;
  brushSize: number;
  brushShape: BrushShape;
  rectOutline: boolean;
  objectKind: string;
  regionType: RegionType;
  npcType: NpcType;
  templateId: EntityId | null;
  /** Building whose interior is open. */
  interiorId: string | null;
  dungeonId: string | null;
  setDungeon: (id: string | null) => void;
  setInterior: (id: string | null) => void;
  /** Boss preset placed by the lair tool. */
  bossPreset: string;
  /** Scatter brush: biome, share of tiles that get an object, paint the ground too. */
  biome: string;
  density: number;
  biomeGround: boolean;
  /** Zone brush: zone id (0 = erase) and the monster for monster zones (null = by distance). */
  zone: number;
  zoneTemplate: EntityId | null;
  /** Spawn brush erases instead of painting. */
  spawnErase: boolean;
  setSpawnErase: (v: boolean) => void;
  setBiome: (k: string) => void;
  setDensity: (d: number) => void;
  setBiomeGround: (v: boolean) => void;
  setZone: (z: number) => void;
  setZoneTemplate: (id: EntityId | null) => void;
  selection: Selection | null;
  /** Simulated player shown in the inspector (and followed by the camera). */
  focusPlayer: string | null;
  followPlayer: boolean;
  hover: HoverInfo | null;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  setTab: (tab: EditorTab) => void;
  setSection: (s: LeftSection) => void;
  setTool: (tool: EditorTool) => void;
  setTerrain: (t: TerrainId) => void;
  setBrushSize: (n: number) => void;
  setBrushShape: (s: BrushShape) => void;
  setRectOutline: (v: boolean) => void;
  setObjectKind: (k: string) => void;
  setRegionType: (t: RegionType) => void;
  setNpcType: (t: NpcType) => void;
  setTemplateId: (id: EntityId | null) => void;
  setBossPreset: (key: string) => void;
  select: (s: Selection | null) => void;
  setFocusPlayer: (id: string | null) => void;
  setFollowPlayer: (v: boolean) => void;
  setHover: (h: HoverInfo | null) => void;
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void;
  setZoom: (z: number) => void;
  reset: () => void;
}

export const MAX_BRUSH = 15;
export const TERRAIN_TOOLS: EditorTool[] = ['brush', 'fill', 'rect', 'picker'];

const initial = {
  tab: 'map' as EditorTab,
  section: 'terrain' as LeftSection,
  tool: 'brush' as EditorTool,
  terrain: TerrainId.Grass,
  brushSize: 1,
  brushShape: 'square' as BrushShape,
  rectOutline: false,
  objectKind: 'tree_oak',
  regionType: 'village' as RegionType,
  npcType: 'villager' as NpcType,
  templateId: null,
  bossPreset: 'goblin_king',
  biome: 'forest',
  density: 0.35,
  biomeGround: true,
  zone: 1,
  zoneTemplate: null,
  spawnErase: false,
  interiorId: null,
  dungeonId: null,
  selection: null,
  focusPlayer: null,
  followPlayer: false,
  hover: null,
  canUndo: false,
  canRedo: false,
  zoom: 1,
};

export const useEditorStore = create<EditorState>((set) => ({
  ...initial,
  setTab: (tab) => set({ tab }),
  setSection: (section) => set({ section }),
  setTool: (tool) => set({ tool }),
  setTerrain: (terrain) => set({ terrain }),
  setBrushSize: (n) => set({ brushSize: Math.max(1, Math.min(MAX_BRUSH, Math.round(n))) }),
  setBrushShape: (brushShape) => set({ brushShape }),
  setRectOutline: (rectOutline) => set({ rectOutline }),
  setObjectKind: (objectKind) => set({ objectKind, tool: 'place-object' }),
  setRegionType: (regionType) => set({ regionType, tool: 'region' }),
  setNpcType: (npcType) => set({ npcType, tool: 'npc' }),
  setTemplateId: (templateId) => set({ templateId, spawnErase: false }),
  setBossPreset: (bossPreset) => set({ bossPreset, tool: 'lair' }),
  setInterior: (interiorId) => set({ interiorId }),
  setDungeon: (dungeonId) => set({ dungeonId }),
  setBiome: (biome) => set({ biome, density: getBiome(biome).density, tool: 'scatter' }),
  setDensity: (density) => set({ density }),
  setBiomeGround: (biomeGround) => set({ biomeGround }),
  setZone: (zone) => set({ zone, tool: 'zone' }),
  setZoneTemplate: (zoneTemplate) => set({ zoneTemplate }),
  setSpawnErase: (spawnErase) => set({ spawnErase, tool: 'spawn-area' }),
  select: (selection) => set(selection && selection.ids.length ? { selection, focusPlayer: null, followPlayer: false } : { selection: null }),
  setFocusPlayer: (focusPlayer) => set(focusPlayer ? { focusPlayer, selection: null } : { focusPlayer: null, followPlayer: false }),
  setFollowPlayer: (followPlayer) => set({ followPlayer }),
  setHover: (hover) => set({ hover }),
  setHistoryFlags: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setZoom: (zoom) => set({ zoom }),
  reset: () => set(initial),
}));
