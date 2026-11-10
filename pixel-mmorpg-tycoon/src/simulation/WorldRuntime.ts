import { EventBus } from '@/core/EventBus';
import type { EntityId } from '@/core/ids';
import { TileGrid } from '@/models/TileGrid';
import type { CameraState, WorldClockState, WorldConfig, WorldSave } from '@/models/world';
import { WORLD_SCHEMA_VERSION } from '@/models/world';
import type { RpgConfig } from '@/models/rpg';
import type { SimState, StudioState } from '@/models/sim';
import { EntityStore } from './EntityStore';
import { ObjectIndex } from '@/systems/world/ObjectIndex';
import { NavGrid } from './nav/NavGrid';

export type RuntimeEvents = {
  /** Specific tiles changed (indices into the grid). */
  'tiles:changed': { indices: ArrayLike<number> };
  /** Whole map replaced (load, resize, regenerate). Renderers must rebuild. */
  'map:replaced': { grid: TileGrid };
  'meta:changed': { name: string };
  'dirty:changed': { dirty: boolean };
  /** Economy or progression rules changed. */
  'rpg:changed': undefined;
  /** Studio funds/tier/settings changed. */
  'studio:changed': undefined;
  'zones:changed': undefined;
  'studio:released': { key: string };
};

/**
 * The single live world instance. Owns all world state that is too large or
 * too hot for React state (the tile grid, the clock). Phaser renders from it,
 * editor systems mutate it, the simulation advances it, persistence snapshots it.
 */
/** Region types where nobody may be attacked. */
const SAFE_REGIONS = new Set(['village', 'town', 'city', 'safezone']);

export class WorldRuntime {
  readonly events = new EventBus<RuntimeEvents>();
  id: EntityId;
  name: string;
  createdAt: number;
  config: WorldConfig;
  grid: TileGrid;
  /** Painted zone layer (see data/zones). */
  zones: TileGrid;
  clock: WorldClockState;
  camera?: CameraState;
  readonly entities: EntityStore;
  /** Economy & progression rules. Mutated in place by the editor and the economy simulation. */
  rpg: RpgConfig;
  /** Simulated players & popularity; mutated by the player simulation. */
  sim: SimState;
  /** Studio money & servers; mutated by the studio system. */
  studio: StudioState;
  readonly objectIndex: ObjectIndex;
  readonly nav: NavGrid;
  private _dirty = false;

  /** Is a gradual-unlock feature available (always true outside progression mode)? */
  feature(key: string): boolean {
    const pr = this.studio.progression;
    return !pr || this.config.gameMode !== 'standard' || pr.unlocked.includes(key);
  }

  constructor(save: WorldSave) {
    this.id = save.id;
    this.name = save.name;
    this.createdAt = save.createdAt;
    this.config = { ...save.config };
    this.grid = TileGrid.fromRle(save.map.width, save.map.height, save.map.tilesRle);
    this.zones = save.map.zonesRle ? TileGrid.fromRle(save.map.width, save.map.height, save.map.zonesRle) : new TileGrid(save.map.width, save.map.height);
    this.clock = { ...save.clock };
    this.camera = save.camera ? { ...save.camera } : undefined;
    this.entities = new EntityStore(save.entities);
    this.rpg = structuredClone(save.rpg);
    this.sim = structuredClone(save.sim);
    this.studio = structuredClone(save.studio);
    this.objectIndex = new ObjectIndex(this);
    this.nav = new NavGrid(this);
    this.entities.events.on('changed', ({ col }) => {
      if (col === 'objects') {
        this.objectIndex.invalidate();
        this.nav.invalidate();
      }
      this.markDirty();
    });
    this.events.on('tiles:changed', () => { this.nav.invalidate(); this.zoneCache.clear(); });
    this.events.on('map:replaced', () => {
      this.objectIndex.invalidate();
      this.nav.invalidate();
    });
  }

  get dirty(): boolean {
    return this._dirty;
  }

  markDirty(): void {
    if (!this._dirty) {
      this._dirty = true;
      this.events.emit('dirty:changed', { dirty: true });
    }
  }

  markClean(): void {
    if (this._dirty) {
      this._dirty = false;
      this.events.emit('dirty:changed', { dirty: false });
    }
  }

  setTiles(indices: ArrayLike<number>, values: ArrayLike<number>): void {
    const tiles = this.grid.tiles;
    for (let i = 0; i < indices.length; i++) tiles[indices[i]] = values[i];
    if (indices.length > 0) {
      this.events.emit('tiles:changed', { indices });
      this.markDirty();
    }
  }

  /** Paint zones (undoable via ZoneEditCommand). */
  setZones(indices: ArrayLike<number>, values: ArrayLike<number>): void {
    const z = this.zones.tiles;
    for (let i = 0; i < indices.length; i++) z[indices[i]] = values[i];
    if (indices.length > 0) {
      this.zoneCache.clear();
      this.events.emit('zones:changed', undefined);
      this.markDirty();
    }
  }

  private zoneCache = new Map<number, { x: number; y: number }[]>();
  /** Walkable tiles of a painted zone (sampled every 2 tiles), cached until zones change. */
  zoneTiles(id: number): { x: number; y: number }[] {
    let out = this.zoneCache.get(id);
    if (!out) {
      out = [];
      const z = this.zones;
      for (let y = 0; y < z.height; y += 2) for (let x = 0; x < z.width; x += 2) if (z.tiles[z.index(x, y)] === id && this.nav.isWalkable(x, y)) out.push({ x, y });
      this.zoneCache.set(id, out);
    }
    return out;
  }

  zoneAt(x: number, y: number): number {
    return this.zones.inBounds(x, y) ? this.zones.tiles[this.zones.index(x, y)] : 0;
  }

  /** Nobody may attack players here and monsters don't follow: towns and safe zones (painted or regions). */
  safeAt(x: number, y: number): boolean {
    const z = this.zoneAt(x, y);
    if (z === 1 || z === 2) return true;
    if (z === 4) return false;
    for (const r of this.entities.list('regions')) if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && SAFE_REGIONS.has(r.type)) return true;
    return false;
  }

  replaceGrid(grid: TileGrid): void {
    this.grid = grid;
    if (this.zones.width !== grid.width || this.zones.height !== grid.height) { this.zones = new TileGrid(grid.width, grid.height); this.events.emit('zones:changed', undefined); }
    this.events.emit('map:replaced', { grid });
    this.markDirty();
  }

  rename(name: string): void {
    this.name = name.trim() || this.name;
    this.events.emit('meta:changed', { name: this.name });
    this.markDirty();
  }

  toSave(): WorldSave {
    return {
      schemaVersion: WORLD_SCHEMA_VERSION,
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      config: { ...this.config },
      map: { width: this.grid.width, height: this.grid.height, tilesRle: this.grid.toRle(), ...(this.zones.tiles.some((v) => v) ? { zonesRle: this.zones.toRle() } : {}) },
      clock: { ...this.clock },
      camera: this.camera ? { ...this.camera } : undefined,
      entities: this.entities.toJSON(),
      rpg: structuredClone(this.rpg),
      sim: structuredClone(this.sim),
      studio: structuredClone(this.studio),
    };
  }

  dispose(): void {
    this.events.clear();
    this.entities.events.clear();
  }
}
