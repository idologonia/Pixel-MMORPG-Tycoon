import { useState } from 'react';
import { t as tr } from '@/i18n';
import { CREATURE_TYPES, type CreatureType } from '@/data/creatureTypes';
import { NPC_TYPES } from '@/data/npcTypes';
import { OBJECT_CATEGORIES, OBJECTS, type ObjectCategory } from '@/data/objects';
import { getRegionType, REGION_TYPES, PVP_LABEL } from '@/data/regionTypes';
import { TERRAINS } from '@/data/terrain';
import type { GameSession } from '@/session/GameSession';
import { MAX_BRUSH, useEditorStore, type EditorTool, type LeftSection } from '@/stores/editorStore';
import { PixelIcon, type IconName } from '../components/PixelIcon';
import { SpritePreview } from '../components/SpritePreview';
import { TerrainSwatch } from '../components/TilePreview';
import { useEntityList } from '../hooks/useEntities';
import { LAIR_BASE_COST, LAIR_COST_PER_RAIDER, MONSTER_SLOT_COST, NPC_HIRE_COST, NPC_UPKEEP_PER_DAY, OBJECT_COST } from '@/data/studio';
import { BOSS_PRESETS } from '@/data/bossTypes';
import { BIOMES } from '@/data/biomes';
import { getZone, ZONES } from '@/data/zones';

const SECTIONS: { key: LeftSection; label: string }[] = [
  { key: 'terrain', label: 'Terrain' },
  { key: 'objects', label: 'Objects' },
  { key: 'regions', label: 'Regions' },
  { key: 'zones', label: 'Zones' },
  { key: 'npc', label: 'NPC' },
  { key: 'creatures', label: 'Creatures' },
  { key: 'spawns', label: 'Spawns' },
];

const TERRAIN_TOOLS: { key: EditorTool; label: string; icon: IconName; hotkey: string; hint: string }[] = [
  { key: 'brush', label: 'Brush', icon: 'brush', hotkey: 'B', hint: 'Click & drag to paint terrain.' },
  { key: 'fill', label: 'Fill', icon: 'fill', hotkey: 'F', hint: 'Flood-fill a connected area of the same terrain.' },
  { key: 'rect', label: 'Rectangle', icon: 'rect', hotkey: 'R', hint: 'Drag to paint a rectangle.' },
  { key: 'picker', label: 'Picker', icon: 'picker', hotkey: 'I', hint: 'Click a tile to pick its terrain.' },
];

export function LeftPanel({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  return (
    <div className="side-panel panel scroll">
      <div className="panel-header">{tr('World Tools')}</div>
      <div className="section">
        <div className="tool-grid">
          <button className={`btn tool-btn ${ed.tool === 'select' ? 'active' : ''}`} title={tr('Select / move (V). Drag empty space to box-select objects.')} onClick={() => ed.setTool('select')}>
            <PixelIcon name="select" size={20} /><span>{tr('Select')}</span>
          </button>
          <button className={`btn tool-btn ${ed.tool === 'erase-object' ? 'active' : ''}`} title={tr('Erase objects (E)')} onClick={() => ed.setTool('erase-object')}>
            <PixelIcon name="trash" size={20} /><span>{tr('Erase')}</span>
          </button>
        </div>
      </div>
      <div className="section-tabs">
        {SECTIONS.map((s) => (
          <button key={s.key} className={`stab ${ed.section === s.key ? 'active' : ''}`} onClick={() => ed.setSection(s.key)}>{tr(s.label)}</button>
        ))}
      </div>
      {ed.section === 'terrain' && <TerrainSection />}
      {ed.section === 'objects' && <ObjectsSection standard={session.studio.standard} />}
      {ed.section === 'regions' && <RegionsSection session={session} />}
      {ed.section === 'zones' && <ZonesSection session={session} />}
      {ed.section === 'npc' && <NpcSection session={session} />}
      {ed.section === 'creatures' && <CreaturesSection session={session} />}
      {ed.section === 'spawns' && <SpawnsSection session={session} />}
    </div>
  );
}

function TerrainSection() {
  const ed = useEditorStore();
  const active = TERRAIN_TOOLS.find((t) => t.key === ed.tool);
  return (
    <div className="section">
      <div className="tool-grid">
        {TERRAIN_TOOLS.map((t) => (
          <button key={t.key} className={`btn tool-btn ${ed.tool === t.key ? 'active' : ''}`} title={`${tr(t.label)} (${t.hotkey})`} onClick={() => ed.setTool(t.key)}>
            <PixelIcon name={t.icon} size={20} /><span>{tr(t.label)}</span>
          </button>
        ))}
      </div>
      {active && <div className="hint">{tr(active.hint)}</div>}
      {ed.tool === 'brush' && <BrushControls />}
      {ed.tool === 'rect' && <label className="check"><input type="checkbox" checked={ed.rectOutline} onChange={(e) => ed.setRectOutline(e.target.checked)} /> {tr('Outline only')}</label>}
      <div className="terrain-list">
        {TERRAINS.map((t) => (
          <button key={t.id} className={`terrain-btn ${ed.terrain === t.id ? 'active' : ''}`} onClick={() => { ed.setTerrain(t.id); if (!['brush', 'fill', 'rect'].includes(ed.tool)) ed.setTool('brush'); }} title={`${tr(t.name)} (${t.hotkey})`}>
            <TerrainSwatch terrain={t.id} size={28} />
            <span className="grow">{tr(t.name)}</span>
            {!t.walkable && <span className="badge" title={tr('Not walkable')}>{tr('BLOCK')}</span>}
            <span className="hotkey">{t.hotkey}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ObjectsSection({ standard }: { standard: boolean }) {
  const ed = useEditorStore();
  const [cat, setCat] = useState<ObjectCategory>('trees');
  const items = OBJECTS.filter((o) => o.category === cat);
  return (
    <div className="section">
      <div className="el-title">{tr('Landscape brush')}</div>
      <div className="hint">{tr('Paint a whole forest, mountains or a graveyard at once: the brush scatters a mix of fitting objects.')}</div>
      <div className="region-types">
        {BIOMES.map((b) => (
          <button key={b.key} className={`btn small ${ed.tool === 'scatter' && ed.biome === b.key ? 'active' : ''}`} onClick={() => ed.setBiome(b.key)}>{tr(b.name)}</button>
        ))}
      </div>
      {ed.tool === 'scatter' && (
        <>
          <BrushControls />
          <div className="field">
            <label>{tr('Density')}: {Math.round(ed.density * 100)}%</label>
            <input type="range" min={5} max={70} value={Math.round(ed.density * 100)} onChange={(e) => ed.setDensity(+e.target.value / 100)} />
          </div>
          <label className="check"><input type="checkbox" checked={ed.biomeGround} onChange={(e) => ed.setBiomeGround(e.target.checked)} /> {tr('Paint the ground too')}</label>
          {standard && <div className="hint cost-line">{tr('Every object costs money, as if placed by hand.')}</div>}
        </>
      )}
      <div className="el-title">{tr('Single objects')}</div>
      <div className="chip-row">
        {OBJECT_CATEGORIES.map((c) => (
          <button key={c.key} className={`btn small ${cat === c.key ? 'active' : ''}`} onClick={() => setCat(c.key)}>{tr(c.label)}</button>
        ))}
      </div>
      <div className="sprite-grid">
        {items.map((o) => (
          <button key={o.key} className={`sprite-btn ${ed.tool === 'place-object' && ed.objectKind === o.key ? 'active' : ''}`} title={`${tr(o.name)} · ${o.w}×${o.h}${o.blocks ? ' · ' + tr('blocks movement') : ''}`} onClick={() => ed.setObjectKind(o.key)}>
            <SpritePreview frame={`obj:${o.key}`} box={40} />
            <span>{tr(o.name)}</span>
            {standard && <span className="cost">${OBJECT_COST[o.category]}</span>}
          </button>
        ))}
      </div>
      <div className="hint">{tr('Click to place; drag to paint 1×1 objects (roads, fences, trees). Red ghost = blocked spot.')}</div>
    </div>
  );
}

function RegionsSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const regions = useEntityList(session, 'regions');
  return (
    <div className="section">
      <div className="hint">{tr('Pick a type, then drag on the map to draw the region.')}</div>
      <div className="region-types">
        {REGION_TYPES.filter((t) => t.key !== 'wilderness').map((t) => (
          <button key={t.key} title={tr(t.description)} className={`btn small ${ed.tool === 'region' && ed.regionType === t.key ? 'active' : ''}`} onClick={() => ed.setRegionType(t.key)}>
            <span className="swatch" style={{ background: `#${t.color.toString(16).padStart(6, '0')}` }} /> {tr(t.name)}
          </button>
        ))}
      </div>
      <div className="hint region-desc">
        <b>{tr(getRegionType(ed.regionType).name)}:</b> {tr(getRegionType(ed.regionType).description)}
        {' '}<span className={getRegionType(ed.regionType).pvp === 'none' ? 'good-text' : 'bad-text'}>{tr(PVP_LABEL[getRegionType(ed.regionType).pvp])}</span>
      </div>
      <EntityList
        title={`${tr('Regions')} (${regions.length})`}
        items={regions.map((r) => ({ id: r.id, label: r.name, sub: `${tr(getRegionType(r.type).name)} · ${r.w}×${r.h}`, x: r.x + r.w / 2, y: r.y + r.h / 2 }))}
        col="regions"
        session={session}
      />
    </div>
  );
}

/** Brush size + shape, shared by the terrain, landscape and zone brushes. */
function BrushControls() {
  const ed = useEditorStore();
  return (
    <>
      <div className="field">
        <label>{tr('Brush size')}: {ed.brushSize} <span className="hint">([ / ])</span></label>
        <input type="range" min={1} max={MAX_BRUSH} value={ed.brushSize} onChange={(e) => ed.setBrushSize(+e.target.value)} />
      </div>
      <div className="chip-row">
        <button className={`btn small ${ed.brushShape === 'square' ? 'active' : ''}`} onClick={() => ed.setBrushShape('square')}>{tr('Square')}</button>
        <button className={`btn small ${ed.brushShape === 'circle' ? 'active' : ''}`} onClick={() => ed.setBrushShape('circle')}>{tr('Circle')}</button>
      </div>
    </>
  );
}

function ZonesSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const templates = useEntityList(session, 'creatureTemplates').filter((c) => !c.boss);
  const cur = getZone(ed.zone);
  return (
    <div className="section">
      <div className="hint">{tr('Paint zones on the map like terrain. Painted zones work on top of regions.')}</div>
      <div className="region-types">
        {ZONES.map((z) => (
          <button key={z.id} title={tr(z.hint)} className={`btn small ${ed.tool === 'zone' && ed.zone === z.id ? 'active' : ''}`} onClick={() => ed.setZone(z.id)}>
            <span className="swatch" style={{ background: `#${z.color.toString(16).padStart(6, '0')}` }} /> {tr(z.name)}
          </button>
        ))}
        <button className={`btn small ${ed.tool === 'zone' && ed.zone === 0 ? 'active' : ''}`} onClick={() => ed.setZone(0)}>✕ {tr('Erase zone')}</button>
      </div>
      <div className="hint region-desc">{cur ? <><b>{tr(cur.name)}:</b> {tr(cur.hint)}</> : tr('Removes painted zones (and the monsters of erased monster zones).')}</div>
      <BrushControls />
      {ed.zone === 3 && (
        <div className="field">
          <label>{tr('Monster')}</label>
          <select className="input" value={ed.zoneTemplate ?? ''} onChange={(e) => ed.setZoneTemplate(e.target.value || null)}>
            <option value="">{tr('Automatic: tougher farther from the spawn')}</option>
            {templates.map((c) => <option key={c.id} value={c.id}>{c.name} · {tr('Lv')} {c.level}</option>)}
          </select>
          {session.studio.standard && <div className="hint cost-line">{tr('Each 8×8 piece of the zone gets 3 monsters')} · ${3 * MONSTER_SLOT_COST}</div>}
        </div>
      )}
    </div>
  );
}

function NpcSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const npcs = useEntityList(session, 'npcs');
  return (
    <div className="section">
      <div className="hint">{tr('Pick a type, then click a walkable tile to place an NPC.')}</div>
      {session.studio.standard && <div className="hint cost-line">{tr('Hire an NPC')}: ${NPC_HIRE_COST} + ${NPC_UPKEEP_PER_DAY}/{tr('day')}</div>}
      <div className="sprite-grid">
        {NPC_TYPES.map((t) => (
          <button key={t.key} className={`sprite-btn ${ed.tool === 'npc' && ed.npcType === t.key ? 'active' : ''}`} onClick={() => ed.setNpcType(t.key)} title={tr(t.name)}>
            <SpritePreview frame={`npc:${t.key}:0`} box={32} />
            <span>{tr(t.name)} <b className="count">{npcs.filter((n) => n.type === t.key).length}</b></span>
          </button>
        ))}
      </div>
      <button className="btn small" onClick={() => ed.setTab('npc')}>{tr('Open NPC editor')} ({npcs.length})</button>
    </div>
  );
}

function CreaturesSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const templates = useEntityList(session, 'creatureTemplates');
  const [newType, setNewType] = useState<CreatureType>('slime');
  return (
    <div className="section">
      <div className="hint">{tr('Pick a creature, then drag on the map to draw its spawn area.')}</div>
      {session.studio.standard && <div className="hint cost-line">{tr('Monster slot')}: ${MONSTER_SLOT_COST}</div>}
      {templates.length === 0 && <div className="hint">{tr('No creatures yet — create one below.')}</div>}
      <div className="sprite-grid">
        {templates.map((t) => (
          <button key={t.id} className={`sprite-btn ${ed.tool === 'spawn-area' && ed.templateId === t.id ? 'active' : ''}`} onClick={() => { ed.setTemplateId(t.id); ed.setTool('spawn-area'); }} title={`${t.name} · ${tr('Lv')} ${t.level}`}>
            <SpritePreview frame={`cr:${t.type}:0`} box={32} />
            <span>{t.name} <b className="count">{tr('Lv')}{t.level}</b></span>
          </button>
        ))}
      </div>
      <div className="row">
        <select className="input grow" value={newType} onChange={(e) => setNewType(e.target.value as CreatureType)}>
          {CREATURE_TYPES.map((t) => <option key={t.key} value={t.key}>{tr(t.name)}</option>)}
        </select>
        <button className="btn small" onClick={() => { const t = session.entities.addTemplate(newType); ed.setTemplateId(t.id); ed.setTool('spawn-area'); }}>+ {tr('New')}</button>
      </div>
      <button className="btn small" onClick={() => ed.setTab('creatures')}>{tr('Open creature editor')}</button>
      <BossLairSection session={session} />
    </div>
  );
}

function BossLairSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const areas = useEntityList(session, 'spawnAreas');
  const lairs = areas.filter((a) => a.lair);
  return (
    <div className="lair-section">
      <div className="el-title">{tr('Boss lairs')}</div>
      <div className="hint">{tr('Pick a boss, then click the map. Bosses guard their lair, hit everyone nearby and need a raid of several players.')}</div>
      <div className="sprite-grid">
        {BOSS_PRESETS.map((b) => (
          <button key={b.key} className={`sprite-btn ${ed.tool === 'lair' && ed.bossPreset === b.key ? 'active' : ''}`} onClick={() => ed.setBossPreset(b.key)} title={`${tr(b.name)} — ${tr(b.description)}`}>
            <SpritePreview frame={`cr:${b.type}:0`} box={32} />
            <span>{tr(b.name)} <b className="count">{tr('Lv')}{b.level}</b></span>
            <span className="sub">{tr('Raid {n}+', { n: b.minRaid })}{session.studio.standard ? ` · $${LAIR_BASE_COST + b.minRaid * LAIR_COST_PER_RAIDER}` : ''}</span>
          </button>
        ))}
      </div>
      <EntityList title={`${tr('Lairs on the map')} (${lairs.length})`} col="spawnAreas" session={session} items={lairs.map((a) => ({ id: a.id, label: a.name, sub: `${tr('Raid {n}+', { n: a.lair!.minRaid })} · ${tr('respawn {h} h', { h: a.lair!.respawnHours })}`, x: a.x + a.w / 2, y: a.y + a.h / 2 }))} />
    </div>
  );
}

function SpawnsSection({ session }: { session: GameSession }) {
  const ed = useEditorStore();
  const objects = useEntityList(session, 'objects');
  const spawns = objects.filter((o) => o.kind === 'player_spawn');
  const areas = useEntityList(session, 'spawnAreas');
  return (
    <div className="section">
      <button className={`sprite-btn wide ${ed.tool === 'place-object' && ed.objectKind === 'player_spawn' ? 'active' : ''}`} onClick={() => ed.setObjectKind('player_spawn')}>
        <SpritePreview frame="obj:player_spawn" box={32} />
        <span>{tr('Place player spawn point')}</span>
      </button>
      <div className="hint">{tr('Simulated players (Phase 4) will enter the world at these points.')}</div>
      <EntityList title={`${tr('Player spawns')} (${spawns.length})`} col="objects" session={session} items={spawns.map((s, i) => ({ id: s.id, label: s.name ?? `${tr('Spawn')} ${i + 1}`, sub: `(${s.x}, ${s.y})`, x: s.x, y: s.y }))} />
      <EntityList title={`${tr('Creature spawn areas')} (${areas.length})`} col="spawnAreas" session={session} items={areas.map((a) => ({ id: a.id, label: a.name, sub: `×${a.maxCount} · ${a.w}×${a.h}`, x: a.x + a.w / 2, y: a.y + a.h / 2 }))} />
    </div>
  );
}

/** Clickable list: selects the entity and centres the camera on it. */
export function EntityList({ title, items, col, session }: { title: string; items: { id: string; label: string; sub: string; x: number; y: number }[]; col: 'regions' | 'objects' | 'spawnAreas' | 'npcs'; session: GameSession }) {
  const sel = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const setTool = useEditorStore((s) => s.setTool);
  return (
    <div className="entity-list">
      <div className="el-title">{title}</div>
      {items.length === 0 && <div className="hint">{tr('None yet.')}</div>}
      {items.map((it) => (
        <button
          key={it.id}
          className={`el-row ${sel?.col === col && sel.ids.includes(it.id) ? 'active' : ''}`}
          onClick={() => { select({ col, ids: [it.id] }); setTool('select'); session.bridge.emit('camera:centerTile', { x: it.x, y: it.y }); }}
        >
          <span className="grow">{it.label}</span>
          <span className="hint">{it.sub}</span>
        </button>
      ))}
    </div>
  );
}
