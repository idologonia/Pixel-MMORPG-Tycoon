import { TerrainId } from './terrain';

/** Scatter brush: paints a whole landscape (a mix of objects, optionally its ground) at once. */
export interface BiomeDef {
  key: string;
  name: string;
  /** Object kinds with weights. */
  objects: [string, number][];
  /** Ground painted under the brush (if "paint ground" is on). */
  terrain: TerrainId;
  /** Default share of tiles that get an object. */
  density: number;
}

export const BIOMES: BiomeDef[] = [
  { key: 'forest', name: 'Forest', objects: [['tree_oak', 6], ['tree_pine', 3], ['bush', 2], ['berry_bush', 1], ['stump', 1], ['mushrooms', 1], ['flowers', 1]], terrain: TerrainId.Grass, density: 0.35 },
  { key: 'pines', name: 'Pine forest', objects: [['tree_pine', 8], ['rock', 1], ['stump', 1], ['bush', 1]], terrain: TerrainId.Grass, density: 0.4 },
  { key: 'mountains', name: 'Mountains', objects: [['boulder', 5], ['rock', 5], ['ore_rock', 1], ['tree_pine', 1]], terrain: TerrainId.Stone, density: 0.3 },
  { key: 'meadow', name: 'Meadow', objects: [['flowers', 5], ['bush', 2], ['berry_bush', 1], ['tree_oak', 1]], terrain: TerrainId.Grass, density: 0.15 },
  { key: 'snow', name: 'Snowy forest', objects: [['tree_snow', 6], ['rock', 1], ['boulder', 1]], terrain: TerrainId.Snow, density: 0.3 },
  { key: 'swamp', name: 'Dead swamp', objects: [['tree_dead', 4], ['mushrooms', 3], ['bones', 1], ['stump', 2]], terrain: TerrainId.Swamp, density: 0.22 },
  { key: 'desert', name: 'Desert', objects: [['tree_palm', 2], ['rock', 3], ['bones', 1], ['boulder', 1]], terrain: TerrainId.Sand, density: 0.08 },
  { key: 'graveyard', name: 'Graveyard', objects: [['gravestone', 6], ['tree_dead', 2], ['bones', 1], ['torch', 1]], terrain: TerrainId.Dirt, density: 0.2 },
];

export const getBiome = (k: string): BiomeDef => BIOMES.find((b) => b.key === k) ?? BIOMES[0];

/** Weighted random pick. */
export function pickObject(b: BiomeDef, r: number): string {
  const total = b.objects.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [k, w] of b.objects) { x -= w; if (x < 0) return k; }
  return b.objects[0][0];
}
