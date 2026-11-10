/**
 * Terrain registry. The numeric id is what gets stored in the tile grid,
 * so ids must stay stable once worlds are saved. New terrains append at the end.
 */
export enum TerrainId {
  Grass = 0,
  Dirt = 1,
  Sand = 2,
  Stone = 3,
  Water = 4,
  Snow = 5,
  Swamp = 6,
  Lava = 7,
}

export interface TerrainDef {
  id: TerrainId;
  key: string;
  name: string;
  /** Palette used by the procedural pixel-art generator: [base, dark, light, accent]. */
  palette: [string, string, string, string];
  walkable: boolean;
  /** Movement cost multiplier for future pathfinding (Phase 4). */
  moveCost: number;
  hotkey: string;
}

export const TERRAINS: readonly TerrainDef[] = [
  { id: TerrainId.Grass, key: 'grass', name: 'Grass', palette: ['#4f9a3a', '#3b7d2c', '#6cb84a', '#8fd468'], walkable: true, moveCost: 1, hotkey: '1' },
  { id: TerrainId.Dirt, key: 'dirt', name: 'Dirt', palette: ['#8a5a34', '#6e4426', '#a36f45', '#5a361d'], walkable: true, moveCost: 1, hotkey: '2' },
  { id: TerrainId.Sand, key: 'sand', name: 'Sand', palette: ['#dcc27a', '#c4a862', '#ecd894', '#b8995a'], walkable: true, moveCost: 1.3, hotkey: '3' },
  { id: TerrainId.Stone, key: 'stone', name: 'Stone', palette: ['#7d7f86', '#61636a', '#9a9ca3', '#4c4e55'], walkable: true, moveCost: 1.1, hotkey: '4' },
  { id: TerrainId.Water, key: 'water', name: 'Water', palette: ['#2f6fb8', '#24589a', '#4a8ed4', '#9cc8f0'], walkable: false, moveCost: Infinity, hotkey: '5' },
  { id: TerrainId.Snow, key: 'snow', name: 'Snow', palette: ['#e6eef5', '#c8d6e3', '#ffffff', '#a9bccd'], walkable: true, moveCost: 1.5, hotkey: '6' },
  { id: TerrainId.Swamp, key: 'swamp', name: 'Swamp', palette: ['#4d5b31', '#3a4624', '#647440', '#2f5a4a'], walkable: true, moveCost: 2, hotkey: '7' },
  { id: TerrainId.Lava, key: 'lava', name: 'Lava', palette: ['#d9471c', '#a8300f', '#ff7a2a', '#ffd04a'], walkable: false, moveCost: Infinity, hotkey: '8' },
];

export const TERRAIN_COUNT = TERRAINS.length;
export const TILE_SIZE = 32;
/** Visual variants per terrain in the generated tileset (breaks up repetition). */
export const TILE_VARIANTS = 8;

export function getTerrain(id: number): TerrainDef {
  return TERRAINS[id] ?? TERRAINS[0];
}
