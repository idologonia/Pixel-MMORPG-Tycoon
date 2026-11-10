import Phaser from 'phaser';
import { TILE_SIZE } from '@/data/terrain';
import type { TileGrid } from '@/models/TileGrid';
import type { GameSession } from '@/session/GameSession';
import { darkness } from '@/simulation/time';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CameraController } from '../input/CameraController';
import { MapTools } from '../input/MapTools';
import { EntityRenderer } from '../render/EntityRenderer';
import { LightRenderer } from '../render/LightRenderer';
import { DEPTH } from '../render/depth';
import {
  ANIMATED_TERRAINS,
  ANIMATION_FRAMES,
  paintTerrainRow,
  paintTileset,
  TILE_MARGIN,
  TILE_SPACING,
  tileIndexFor,
  tileLook,
  tilesetSize,
} from '../textures/TilesetPainter';

const TILESET_KEY = 'terrain-tiles';
const ANIM_INTERVAL_MS = 450;

/**
 * Renders the world tilemap and translates pointer input into editor actions.
 * Holds no world state itself: everything is read from / written to the session.
 */
export class WorldScene extends Phaser.Scene {
  private session!: GameSession;
  private map?: Phaser.Tilemaps.Tilemap;
  private layer?: Phaser.Tilemaps.TilemapLayer;
  private tilesetTex!: Phaser.Textures.CanvasTexture;
  private camCtl!: CameraController;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private borderGfx!: Phaser.GameObjects.Graphics;
  private night!: Phaser.GameObjects.Rectangle;
  private animFrame = 0;
  private animTimer = 0;
  private entities!: EntityRenderer;
  private lightFx!: LightRenderer;
  private tools!: MapTools;
  private lastCamKey = '';
  private fpsTimer = 0;
  private unsubs: (() => void)[] = [];

  constructor() {
    super('WorldScene');
  }

  init(data: { session: GameSession }): void {
    this.session = data.session;
  }

  create(): void {
    const { width, height } = tilesetSize();
    this.tilesetTex = this.textures.createCanvas(TILESET_KEY, width, height)!;
    paintTileset(this.tilesetTex.context, 0);
    this.tilesetTex.refresh();

    this.cameras.main.setBackgroundColor('#0d0b14');
    this.input.mouse?.disableContextMenu();

    this.borderGfx = this.add.graphics().setDepth(DEPTH.FLAT_OBJECTS - 1);
    this.gridGfx = this.add.graphics().setDepth(DEPTH.GRID);
    this.night = this.add.rectangle(0, 0, 1, 1, 0x0a0f2e, 0).setOrigin(0).setDepth(DEPTH.NIGHT);

    this.buildTilemap(this.session.runtime.grid);

    this.camCtl = new CameraController(this, this.cameras.main, () => this.mapPixelSize());
    const saved = this.session.runtime.camera;
    if (saved) {
      this.camCtl.setZoomImmediate(saved.zoom);
      this.camCtl.centerOn(saved.x * TILE_SIZE, saved.y * TILE_SIZE);
    } else {
      this.camCtl.fit();
      this.camCtl.setZoomImmediate(Math.max(1, this.cameras.main.zoom));
      const g = this.session.runtime.grid;
      this.camCtl.centerOn((g.width * TILE_SIZE) / 2, (g.height * TILE_SIZE) / 2);
    }

    this.entities = new EntityRenderer(this, this.session);
    this.lightFx = new LightRenderer(this, this.session);
    this.tools = new MapTools(this, this.session, this.entities, this.camCtl);
    this.bindSession();

    this.scale.on('resize', () => this.camCtl.clamp());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  private mapPixelSize() {
    const g = this.session.runtime.grid;
    return { w: g.width * TILE_SIZE, h: g.height * TILE_SIZE };
  }

  // ---------------------------------------------------------------- tilemap
  private buildTilemap(grid: TileGrid): void {
    this.layer?.destroy();
    this.map?.destroy();
    const data: number[][] = new Array(grid.height);
    for (let y = 0; y < grid.height; y++) {
      const row = new Array<number>(grid.width);
      for (let x = 0; x < grid.width; x++) row[x] = tileIndexFor(grid.tiles[y * grid.width + x], x, y);
      data[y] = row;
    }
    this.map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = this.map.addTilesetImage('terrain', TILESET_KEY, TILE_SIZE, TILE_SIZE, TILE_MARGIN, TILE_SPACING)!;
    this.layer = this.map.createLayer(0, tileset, 0, 0)!;
    this.layer.setDepth(0);
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) this.styleTile(this.layer.getTileAt(x, y), grid.tiles[y * grid.width + x], x, y);

    const { w, h } = this.mapPixelSize();
    this.night.setSize(w, h);
    this.borderGfx.clear();
    this.borderGfx.lineStyle(4, 0x000000, 0.6).strokeRect(-2, -2, w + 4, h + 4);
    this.borderGfx.lineStyle(2, 0xd4a64a, 0.9).strokeRect(-3, -3, w + 6, h + 6);
    this.lastCamKey = '';
  }

  private updateTiles(indices: ArrayLike<number>): void {
    const layer = this.layer;
    if (!layer) return;
    const grid = this.session.runtime.grid;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const x = idx % grid.width;
      const y = (idx - x) / grid.width;
      this.styleTile(layer.putTileAt(tileIndexFor(grid.tiles[idx], x, y), x, y), grid.tiles[idx], x, y);
    }
  }

  /** Random mirroring/rotation + big soft light patches (see tileLook). */
  private styleTile(tile: Phaser.Tilemaps.Tile | null, terrain: number, x: number, y: number): void {
    if (!tile) return;
    const l = tileLook(terrain, x, y);
    tile.flipX = l.flipX;
    tile.flipY = l.flipY;
    tile.rotation = l.rotation;
    tile.tint = l.tint;
  }

  // ---------------------------------------------------------------- session
  private bindSession(): void {
    const rt = this.session.runtime;
    const bridge = this.session.bridge;
    this.unsubs.push(
      rt.events.on('tiles:changed', ({ indices }) => this.updateTiles(indices)),
      rt.events.on('map:replaced', ({ grid }) => {
        this.buildTilemap(grid);
        this.camCtl.clamp();
      }),
      bridge.on('camera:centerTile', ({ x, y }) => this.camCtl.centerOn(x * TILE_SIZE, y * TILE_SIZE)),
      bridge.on('camera:fit', () => this.camCtl.fit()),
      bridge.on('camera:zoomBy', ({ factor }) => this.camCtl.zoomAt(factor)),
      useEditorStore.subscribe((s, prev) => {
        if (s.tool !== prev.tool || s.brushSize !== prev.brushSize || s.brushShape !== prev.brushShape || s.tab !== prev.tab || s.objectKind !== prev.objectKind || s.npcType !== prev.npcType) {
          this.tools.drawCursor();
        }
      }),
    );
  }

  // ----------------------------------------------------------------- frame
  update(_time: number, delta: number): void {
    this.camCtl.update(delta);
    this.entities.update(delta);
    // Follow the focused player.
    const ed = useEditorStore.getState();
    if (ed.followPlayer && ed.focusPlayer) {
      const pos = this.entities.actorScreenPos(ed.focusPlayer);
      if (pos) {
        const cam = this.cameras.main;
        const k = Math.min(1, delta / 200);
        cam.centerOn(cam.midPoint.x + (pos.x * TILE_SIZE - cam.midPoint.x) * k, cam.midPoint.y + (pos.y * TILE_SIZE - cam.midPoint.y) * k);
      }
    }
    const settings = useSettingsStore.getState();
    const cam = this.cameras.main;

    // Animated water & lava: repaint only those rows of the tileset texture.
    if (settings.animateTiles) {
      this.animTimer += delta;
      if (this.animTimer >= ANIM_INTERVAL_MS) {
        this.animTimer = 0;
        this.animFrame = (this.animFrame + 1) % ANIMATION_FRAMES;
        for (const t of ANIMATED_TERRAINS) paintTerrainRow(this.tilesetTex.context, t, this.animFrame);
        this.tilesetTex.refresh();
      }
    }

    // Day / night tint from the simulation clock.
    const dark = settings.dayNightTint ? darkness(this.session.runtime.clock.totalMinutes) : 0;
    this.night.setFillStyle(0x0a0f2e, dark * 0.5);
    this.lightFx.update(delta, dark);

    // Grid + camera broadcast only when the view actually changed.
    const camKey = `${cam.scrollX.toFixed(1)}|${cam.scrollY.toFixed(1)}|${cam.zoom.toFixed(3)}|${cam.width}|${cam.height}|${settings.showGrid}`;
    if (camKey !== this.lastCamKey) {
      this.lastCamKey = camKey;
      this.drawGrid(settings.showGrid);
      const v = cam.worldView;
      const S = TILE_SIZE;
      this.session.bridge.emit('camera:moved', { x: v.x / S, y: v.y / S, w: v.width / S, h: v.height / S, zoom: cam.zoom });
      this.session.runtime.camera = { x: cam.midPoint.x / S, y: cam.midPoint.y / S, zoom: cam.zoom };
      if (Math.abs(useEditorStore.getState().zoom - cam.zoom) > 0.001) useEditorStore.getState().setZoom(cam.zoom);
    }

    this.fpsTimer += delta;
    if (this.fpsTimer > 500) {
      this.fpsTimer = 0;
      this.session.bridge.emit('scene:fps', { fps: Math.round(this.game.loop.actualFps) });
    }
  }

  /** Grid lines for the visible area only (cheap at any map size). */
  private drawGrid(show: boolean): void {
    const g = this.gridGfx;
    g.clear();
    const cam = this.cameras.main;
    // The grid helps when zoomed in to edit; zoomed out it turns the map into graph paper.
    if (!show || cam.zoom < 0.9) return;
    const grid = this.session.runtime.grid;
    const S = TILE_SIZE;
    const v = cam.worldView;
    const x0 = Math.max(0, Math.floor(v.x / S));
    const y0 = Math.max(0, Math.floor(v.y / S));
    const x1 = Math.min(grid.width, Math.ceil(v.right / S));
    const y1 = Math.min(grid.height, Math.ceil(v.bottom / S));
    g.lineStyle(1 / cam.zoom, 0x000000, Math.min(0.25, 0.1 + (cam.zoom - 0.9) * 0.25));
    for (let x = x0; x <= x1; x++) g.lineBetween(x * S, y0 * S, x * S, y1 * S);
    for (let y = y0; y <= y1; y++) g.lineBetween(x0 * S, y * S, x1 * S, y * S);
  }

  private cleanup(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.camCtl?.destroy();
    this.entities?.destroy();
    this.tools?.destroy();
  }
}
