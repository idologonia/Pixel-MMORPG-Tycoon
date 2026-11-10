import { hash2 } from '@/core/random';
import { TERRAINS, TerrainId, TILE_SIZE, TILE_VARIANTS } from '@/data/terrain';

/**
 * Procedural pixel-art tileset. Each 32×32 tile is drawn on a 16×16 "art pixel"
 * grid (2×2 screen pixels per art pixel) for a chunky retro look.
 * Layout: one row per terrain, one column per variant → index = terrain * VARIANTS + variant.
 */
const ART = 16;
const PX = TILE_SIZE / ART;

export const TILESET_COLUMNS = TILE_VARIANTS;
/** Each tile is extruded by 1px on every side to prevent seams at fractional zoom. */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;
const CELL = TILE_SIZE + TILE_SPACING;
export const ANIMATED_TERRAINS = [TerrainId.Water, TerrainId.Lava];
export const ANIMATION_FRAMES = 4;

type Plot = (x: number, y: number, color: string) => void;

export function tilesetSize() {
  return { width: TILESET_COLUMNS * CELL, height: TERRAINS.length * CELL };
}

export function paintTileset(ctx: CanvasRenderingContext2D, frame = 0): void {
  for (const t of TERRAINS) paintTerrainRow(ctx, t.id, frame);
}

export function paintTerrainRow(ctx: CanvasRenderingContext2D, terrain: TerrainId, frame: number): void {
  for (let v = 0; v < TILE_VARIANTS; v++) {
    const ox = v * CELL + TILE_MARGIN;
    const oy = terrain * CELL + TILE_MARGIN;
    const plot: Plot = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(ox + (((x % ART) + ART) % ART) * PX, oy + (((y % ART) + ART) % ART) * PX, PX, PX);
    };
    paintTile(plot, terrain, v, frame);
    extrude(ctx, ox, oy);
  }
}

/** Copy each edge row/column of a tile one pixel outward. */
function extrude(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const c = ctx.canvas;
  const S = TILE_SIZE;
  ctx.drawImage(c, ox, oy, S, 1, ox, oy - 1, S, 1);
  ctx.drawImage(c, ox, oy + S - 1, S, 1, ox, oy + S, S, 1);
  ctx.drawImage(c, ox, oy - 1, 1, S + 2, ox - 1, oy - 1, 1, S + 2);
  ctx.drawImage(c, ox + S - 1, oy - 1, 1, S + 2, ox + S, oy - 1, 1, S + 2);
}

function paintTile(plot: Plot, terrain: TerrainId, variant: number, frame: number): void {
  const [base, dark, light, accent] = TERRAINS[terrain].palette;
  const seed = terrain * 97 + variant * 13 + 1;
  // 8 variants share 4 detail levels, each with its own random layout.
  variant %= 4;
  const r = (x: number, y: number, k = 0) => hash2(x, y, seed + k) / 4294967295;
  for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) plot(x, y, base);

  switch (terrain) {
    case TerrainId.Grass: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.12) plot(x, y, dark);
        else if (n > 0.9) plot(x, y, light);
      }
      // grass tufts
      const tufts = 3 + variant;
      for (let i = 0; i < tufts; i++) {
        const x = Math.floor(r(i, 1, 5) * ART);
        const y = Math.floor(r(i, 2, 5) * (ART - 2)) + 1;
        plot(x, y, light);
        plot(x, y + 1, dark);
        plot(x - 1, y + 1, light);
        plot(x + 1, y + 1, light);
      }
      if (variant === 3) {
        // flowers
        for (let i = 0; i < 3; i++) {
          const x = Math.floor(r(i, 7, 9) * ART);
          const y = Math.floor(r(i, 8, 9) * ART);
          plot(x, y, i % 2 ? '#f6e05e' : '#f5f5f5');
          plot(x, y + 1, dark);
        }
      }
      break;
    }
    case TerrainId.Dirt: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.14) plot(x, y, dark);
        else if (n > 0.92) plot(x, y, light);
      }
      for (let i = 0; i < 2 + variant; i++) {
        const x = Math.floor(r(i, 3, 2) * ART);
        const y = Math.floor(r(i, 4, 2) * ART);
        plot(x, y, accent);
        plot(x + 1, y, dark);
        plot(x, y - 1, light);
      }
      break;
    }
    case TerrainId.Sand: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.08) plot(x, y, dark);
        else if (n > 0.93) plot(x, y, light);
      }
      // dune ripples
      for (let row = 2 + variant; row < ART; row += 5) {
        for (let x = 0; x < ART; x++) {
          const yy = row + Math.round(Math.sin((x + variant * 3) * 0.6));
          if ((x + row) % 7 < 4) plot(x, yy, light);
          if ((x + row) % 7 < 4) plot(x, yy + 1, dark);
        }
      }
      break;
    }
    case TerrainId.Stone: {
      // cobblestones: staggered rows of blocks with outlines
      const rows = [0, 5, 10];
      rows.forEach((y0, ri) => {
        const h = ri === 2 ? 6 : 5;
        const shift = (ri + variant) % 2 ? 4 : 0;
        for (let bx = -8; bx < ART; bx += 8) {
          const x0 = bx + shift;
          const w = 8;
          for (let x = x0; x < x0 + w; x++) {
            plot(x, y0, dark);
            plot(x, y0 + 1, light);
          }
          for (let y = y0; y < y0 + h; y++) plot(x0, y, dark);
          for (let y = y0 + 1; y < y0 + h; y++) plot(x0 + 1, y, light);
        }
      });
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) if (r(x, y, 3) < 0.05) plot(x, y, accent);
      break;
    }
    case TerrainId.Water: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) if (r(x, y) < 0.18) plot(x, y, dark);
      // waves drift right over animation frames
      for (let i = 0; i < 4; i++) {
        const y = (Math.floor(r(i, 1, 4) * ART) + i * 4) % ART;
        const x = Math.floor(r(i, 2, 4) * ART) + frame * 2 + (i % 2 ? frame : 0);
        plot(x, y, light);
        plot(x + 1, y, light);
        plot(x + 2, y, light);
        plot(x + 1, y + 1, dark);
      }
      if ((frame + variant) % ANIMATION_FRAMES === 0) {
        plot(Math.floor(r(9, 9) * ART), Math.floor(r(8, 8) * ART), accent);
      }
      break;
    }
    case TerrainId.Snow: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.1) plot(x, y, dark);
        else if (n > 0.95) plot(x, y, accent);
      }
      for (let i = 0; i < 2 + variant; i++) {
        const x = Math.floor(r(i, 5, 1) * ART);
        const y = Math.floor(r(i, 6, 1) * ART);
        plot(x, y, light);
        plot(x + 1, y, dark);
        plot(x, y + 1, dark);
      }
      break;
    }
    case TerrainId.Swamp: {
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.16) plot(x, y, dark);
        else if (n > 0.9) plot(x, y, light);
      }
      // murky puddle
      const cx = 4 + Math.floor(r(1, 1, 6) * 8);
      const cy = 4 + Math.floor(r(2, 2, 6) * 8);
      const rad = 2 + (variant % 3);
      for (let y = -rad; y <= rad; y++) for (let x = -rad - 1; x <= rad + 1; x++) {
        if ((x * x) / ((rad + 1) * (rad + 1)) + (y * y) / (rad * rad) <= 1) plot(cx + x, cy + y, accent);
      }
      plot(cx - 1, cy - 1, '#5f8f7c');
      // reeds
      for (let i = 0; i < 2; i++) {
        const x = Math.floor(r(i, 3, 8) * ART);
        const y = Math.floor(r(i, 4, 8) * (ART - 3));
        plot(x, y, '#8a7a3a');
        plot(x, y + 1, light);
        plot(x, y + 2, light);
      }
      break;
    }
    case TerrainId.Lava: {
      // dark crust plates with glowing cracks that pulse over frames
      for (let y = 0; y < ART; y++) for (let x = 0; x < ART; x++) {
        const n = r(x, y);
        if (n < 0.25) plot(x, y, dark);
      }
      const glow = frame % 2 === 0 ? accent : light;
      for (let i = 0; i < 3; i++) {
        let x = Math.floor(r(i, 1, 7) * ART);
        let y = Math.floor(r(i, 2, 7) * ART);
        for (let s = 0; s < 6; s++) {
          plot(x, y, glow);
          x += r(i, s, 11) > 0.5 ? 1 : 0;
          y += r(i, s, 12) > 0.4 ? 1 : 0;
        }
      }
      const bx = (Math.floor(r(4, 4) * ART) + frame) % ART;
      plot(bx, Math.floor(r(5, 5) * ART), '#fff3b0');
      break;
    }
  }
}

/**
 * Pick a variant for a map cell. Variants 0/1 are common, 2/3 rarer,
 * so the map has texture without looking noisy.
 */
export function variantFor(x: number, y: number): number {
  const h = hash2(x, y, 4242) % 100;
  const odd = hash2(x, y, 999) & 1 ? 4 : 0;
  if (h < 40) return odd;
  if (h < 78) return 1 + odd;
  if (h < 92) return 2 + odd;
  return 3 + odd;
}

/** Smooth value noise in 0..1 (cells of `size` tiles). */
function noise(x: number, y: number, size: number, seed: number): number {
  const gx = x / size, gy = y / size;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash2(a, b, seed) / 4294967295;
  const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return top + (bot - top) * sy;
}

/** Organic ground can be rotated freely; patterned ground (bricks, waves) only mirrored. */
const ROTATES = new Set<number>([TerrainId.Grass, TerrainId.Dirt, TerrainId.Sand, TerrainId.Snow, TerrainId.Swamp]);

/**
 * How a map cell is drawn on top of its variant: random mirroring/rotation so the
 * same tiles don't line up, and a soft light/dark tint in big patches so the map
 * looks natural from far away instead of like a repeated grid.
 */
export function tileLook(terrain: number, x: number, y: number): { flipX: boolean; flipY: boolean; rotation: number; tint: number } {
  const h = hash2(x, y, 7777);
  const rot = ROTATES.has(terrain);
  const n = 0.6 * noise(x, y, 9, 31) + 0.4 * noise(x, y, 3.5, 57);
  const range = terrain === TerrainId.Water || terrain === TerrainId.Lava ? 0.08 : 0.2;
  const c = Math.round(255 * (1 - range + range * n));
  return { flipX: (h & 1) === 1, flipY: rot && (h & 2) === 2, rotation: rot ? ((h >> 2) & 3) * (Math.PI / 2) : 0, tint: (c << 16) | (c << 8) | c };
}

export function tileIndexFor(terrain: number, x: number, y: number): number {
  return terrain * TILE_VARIANTS + variantFor(x, y);
}
