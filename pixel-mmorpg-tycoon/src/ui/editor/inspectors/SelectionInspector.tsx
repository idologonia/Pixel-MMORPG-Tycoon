import { areaSize } from '@/simulation/spawnShape';
import { DUNGEON_KINDS } from '@/simulation/social/DungeonService';
import { BUILDING_ROLE, NPC_HOUSED_HINT, NPC_STREET_HINT, SERVICE_BUILDING, serviceBuilding } from '@/data/buildings';
import { ENTERABLE } from '@/data/furniture';
import { getObjectDef } from '@/data/objects';
import { t } from '@/i18n';
import { getRegionType, PVP_LABEL, REGION_TYPES } from '@/data/regionTypes';
import type { GameSession } from '@/session/GameSession';
import { BudgetError, populateRegion } from '@/systems/generation/Populate';
import { confirmDialog } from '@/stores/dialogStore';
import { useEditorStore } from '@/stores/editorStore';
import { log } from '@/stores/logStore';
import { toast } from '@/stores/toastStore';
import { Field, NumberInput, Select, TextInput } from '../../components/Fields';
import { SpritePreview } from '../../components/SpritePreview';
import { useEntity, useEntityList, useLiveCounts } from '../../hooks/useEntities';
import { NpcForm } from './NpcForm';

/** Properties / actions for whatever is selected on the map. */
export function SelectionInspector({ session }: { session: GameSession }) {
  const sel = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  if (!sel) return <div className="hint">{t('Nothing selected. Use the Select tool (V) to pick objects, NPCs, regions or spawn areas.')}</div>;

  const del = () => {
    const n = session.entities.remove(sel.col, sel.ids);
    select(null);
    if (n) toast(t('Deleted: {n}', { n: sel.ids.length }), 'success');
  };
  const actions = (
    <div className="chip-row">
      {sel.col === 'objects' && <button className="btn small" onClick={() => { const ids = session.entities.duplicateObjects(sel.ids, 1, 1); if (ids.length) select({ col: 'objects', ids }); else toast(t('No room for the copy'), 'error'); }}>{t('Duplicate')} (Ctrl+D)</button>}
      {sel.col === 'npcs' && <button className="btn small" onClick={() => { const n = session.entities.duplicateNpc(sel.ids[0]); if (n) select({ col: 'npcs', ids: [n.id] }); }}>{t('Duplicate')}</button>}
      <button className="btn small danger" onClick={del}>{t('Delete')} (Del)</button>
    </div>
  );

  switch (sel.col) {
    case 'objects':
      return sel.ids.length === 1 ? <ObjectInspector session={session} id={sel.ids[0]} actions={actions} /> : (
        <div className="form">
          <div className="inspect-title">{t('Objects selected: {n}', { n: sel.ids.length })}</div>
          <div className="hint">{t('Drag to move them together. Ctrl+C / Ctrl+V copies to the cursor.')}</div>
          {actions}
        </div>
      );
    case 'npcs':
      return <NpcInspector session={session} id={sel.ids[0]} actions={actions} />;
    case 'regions':
      return <RegionInspector session={session} id={sel.ids[0]} actions={actions} />;
    case 'spawnAreas':
      return <SpawnAreaInspector session={session} id={sel.ids[0]} actions={actions} />;
  }
}

function ObjectInspector({ session, id, actions }: { session: GameSession; id: string; actions: JSX.Element }) {
  const o = useEntity(session, 'objects', id);
  const all = useEntityList(session, 'objects');
  if (!o) return null;
  const def = getObjectDef(o.kind);
  const portals = all.filter((p) => p.kind === 'portal' && p.id !== o.id);
  return (
    <div className="form">
      <div className="row">
        <SpritePreview frame={`obj:${o.kind}`} box={44} />
        <div className="grow">
          <div className="inspect-title">{o.name ?? t(def?.name ?? '')}</div>
          <div className="hint">{t(def?.name ?? '')} · ({o.x}, {o.y}) · {def?.w}×{def?.h}{def?.blocks ? ' · ' + t('solid') : ''}</div>
        </div>
      </div>
      <Field label={t('Label')}><TextInput value={o.name ?? ''} onChange={(name) => session.entities.update('objects', o.id, { name }, t('Rename object'))} /></Field>
      {ENTERABLE.has(o.kind) && (
        <>
          <button className="btn primary" onClick={() => useEditorStore.getState().setInterior(o.id)}>{t('Enter building')}</button>
          <div className="hint">
            {o.interior?.furniture.some((f) => f.kind === 'spawn') ? '★ ' + t('Players spawn here') + ' · ' : ''}
            {t('Furniture: {n}', { n: o.interior?.furniture.length ?? 0 })} · {t('Double-click the building on the map to go inside.')}
          </div>
        </>
      )}
      {o.kind === 'portal' && (
        <Field label={t('Destination portal')} hint={portals.length ? t('Players will travel between linked portals (Phase 4).') : t('Place a second portal to link to.')}>
          <select className="input" value={o.linkId ?? ''} onChange={(e) => {
            const target = e.target.value || undefined;
            session.entities.update('objects', o.id, { linkId: target }, t('Link portal'));
            if (target) session.entities.update('objects', target, { linkId: o.id }, t('Link portal'));
          }}>
            <option value="">— {t('not linked')} —</option>
            {portals.map((p) => <option key={p.id} value={p.id}>{p.name ?? t('Portal')} ({p.x}, {p.y})</option>)}
          </select>
        </Field>
      )}
      {BUILDING_ROLE[o.kind] && <div className="feedback good"><div className="hint">{t(BUILDING_ROLE[o.kind])}</div></div>}
      {DUNGEON_KINDS.has(o.kind) && (() => {
        const st = session.runtime.sim.dungeonStats?.[o.id] ?? { runs: 0, clears: 0, wipes: 0 };
        const lv = session.dungeons.levelOf(o);
        return (
          <div className="feedback good">
            <b>{t('Group dungeon')}</b>
            <div className="hint">{t('Parties of 3–5 players of about this level go inside for a while and come back with XP, gold and gear. A tank (warrior/paladin) and a healer (paladin) make it much safer.')}</div>
            <div className="two-col">
              <Field label={t('Dungeon level')}><NumberInput value={lv} min={1} max={100} onChange={(level) => session.entities.update('objects', o.id, { dungeon: { ...o.dungeon, level } }, t('Edit dungeon'))} /></Field>
              <Field label={t('Dungeon name')}><TextInput value={o.dungeon?.name ?? ''} onChange={(name) => session.entities.update('objects', o.id, { dungeon: { level: lv, ...o.dungeon, name } }, t('Edit dungeon'))} /></Field>
            </div>
            <div className="kv"><span>{t('Runs / cleared / wiped')}</span><span>{st.runs} / {st.clears} / {st.wipes}</span></div>
            <button className="btn primary" onClick={() => useEditorStore.getState().setDungeon(o.id)}>{t('Look inside')}</button>
          </div>
        );
      })()}
      {actions}
    </div>
  );
}

function NpcInspector({ session, id, actions }: { session: GameSession; id: string; actions: JSX.Element }) {
  const npc = useEntity(session, 'npcs', id);
  const setTab = useEditorStore((s) => s.setTab);
  useEntityList(session, 'objects');
  useLiveCounts(session);
  if (!npc) return null;
  const needs = SERVICE_BUILDING[npc.type];
  const given = session.runtime.entities.list('quests').filter((q) => q.giverId === npc.id);
  const qs = session.runtime.sim.questStats ?? {};
  const taken = given.reduce((n, q) => n + (qs[q.id]?.taken ?? 0), 0);
  const done = given.reduce((n, q) => n + (qs[q.id]?.done ?? 0), 0);
  const housed = needs ? serviceBuilding(session.runtime, npc) : undefined;
  return (
    <div className="form">
      {given.length > 0 && (
        <div className="feedback good">
          <b>{t('Quest giver')}</b>
          <div className="kv"><span>{t('Quests offered')}</span><span>{given.length}</span></div>
          <div className="kv"><span>{t('Times taken')}</span><span>{taken}</span></div>
          <div className="kv"><span>{t('Times completed')}</span><span>{done}{taken ? ` (${Math.round((done / taken) * 100)}%)` : ''}</span></div>
          {given.slice(0, 6).map((q) => <div key={q.id} className="kv hint"><span>{q.name}</span><span>{qs[q.id]?.taken ?? 0} / {qs[q.id]?.done ?? 0}</span></div>)}
        </div>
      )}
      {needs && (
        <div className={`feedback ${housed ? 'good' : 'bad'}`}>
          <b>{housed ? t('Works from a {b}', { b: t(getObjectDef(needs)?.name ?? needs) }) : t('No {b} nearby', { b: t(getObjectDef(needs)?.name ?? needs) })}</b>
          <div className="hint">{t(housed ? NPC_HOUSED_HINT[npc.type]! : NPC_STREET_HINT[npc.type]!)}</div>
        </div>
      )}
      <NpcForm session={session} npc={npc} compact />
      <div className="chip-row">
        <button className="btn small" onClick={() => setTab('npc')}>{t('Inventory & shop…')}</button>
      </div>
      {actions}
    </div>
  );
}

function RegionInspector({ session, id, actions }: { session: GameSession; id: string; actions: JSX.Element }) {
  const r = useEntity(session, 'regions', id);
  if (!r) return null;
  const up = (patch: Partial<typeof r>, label = t('Edit region')) => session.entities.update('regions', r.id, patch, label);
  const rt = getRegionType(r.type);
  const populate = async () => {
    const ok = await confirmDialog({ title: t('Populate {name}', { name: r.name }), message: t('Generate "{type}" content inside this region?\nExisting objects stay; new ones fill free space. Undo with Ctrl+Z.', { type: t(rt.name) }), confirmLabel: t('Populate') });
    if (!ok) return;
    let summary: string;
    try {
      summary = populateRegion(session.runtime, session.history, r, Date.now(), undefined, session.studio);
    } catch (e) {
      if (e instanceof BudgetError) { toast(e.message, 'error'); return; }
      throw e;
    }
    log.event(t('{name} populated: {summary}.', { name: r.name, summary }), 'success', session.runtime.clock.totalMinutes);
    toast(t('Populated: {summary}', { summary }), 'success');
  };
  return (
    <div className="form">
      <Field label={t('Name')}><TextInput value={r.name} onChange={(name) => up({ name }, t('Rename region'))} /></Field>
      <Field label={t('Type')}><Select value={r.type} options={REGION_TYPES.map((x) => ({ key: x.key, label: t(x.name) }))} onChange={(type) => up({ type })} /></Field>
      <div className="hint">{t(rt.description)} <span className={rt.pvp === 'none' ? 'good-text' : 'bad-text'}>{t(PVP_LABEL[rt.pvp])}</span></div>
      <div className="two-col">
        <Field label={t('Min level')}><NumberInput value={r.minLevel} min={1} max={100} onChange={(minLevel) => up({ minLevel, maxLevel: Math.max(minLevel, r.maxLevel) })} /></Field>
        <Field label={t('Max level')}><NumberInput value={r.maxLevel} min={1} max={100} onChange={(maxLevel) => up({ maxLevel, minLevel: Math.min(maxLevel, r.minLevel) })} /></Field>
        <Field label={t('Width')}><NumberInput value={r.w} min={2} max={session.runtime.grid.width - r.x} onChange={(w) => up({ w }, t('Resize region'))} /></Field>
        <Field label={t('Height')}><NumberInput value={r.h} min={2} max={session.runtime.grid.height - r.y} onChange={(h) => up({ h }, t('Resize region'))} /></Field>
      </div>
      <div className="hint">{rt.safe ? t('Safe zone: players can rest here.') : t('Hostile zone.')} {t('Drag the region with Select to move it.')}</div>
      {rt.populate && <button className="btn primary" onClick={populate}>{t('Populate as {type}', { type: t(rt.name) })}</button>}
      {actions}
    </div>
  );
}

function SpawnAreaInspector({ session, id, actions }: { session: GameSession; id: string; actions: JSX.Element }) {
  const a = useEntity(session, 'spawnAreas', id);
  const templates = useEntityList(session, 'creatureTemplates');
  useLiveCounts(session);
  if (!a) return null;
  const up = (patch: Partial<typeof a>, label = t('Edit spawn area')) => session.entities.update('spawnAreas', a.id, patch, label);
  const members = [...session.actors.actors.values()].filter((m) => m.spawnAreaId === a.id);
  const alive = members.filter((m) => m.state !== 'dead').length;
  if (a.lair) return <LairInspector session={session} id={id} actions={actions} />;
  return (
    <div className="form">
      <Field label={t('Name')}><TextInput value={a.name} onChange={(name) => up({ name }, t('Rename spawn area'))} /></Field>
      <Field label={t('Creature')}>
        <Select value={a.templateId} options={templates.map((x) => ({ key: x.id, label: `${x.name} (${t('Lv')} ${x.level})` }))} onChange={(templateId) => up({ templateId }, t('Change spawn creature'))} />
      </Field>
      <div className="two-col">
        <Field label={t('Max alive')}><NumberInput value={a.maxCount} min={0} max={50} onChange={(maxCount) => up({ maxCount })} /></Field>
        <Field label={t('Tiles')}><div className="kv"><span>{areaSize(a)}</span></div></Field>
      </div>
      <button className="btn small primary" onClick={() => { const st = useEditorStore.getState(); st.setSection('creatures'); st.setTemplateId(a.templateId); st.setTool('spawn-area'); }}>{t('Edit with the brush')}</button>
      <div className="kv"><span>{t('Alive now')}</span><span>{alive} / {members.length}</span></div>
      <div className="kv"><span>{t('Waiting to respawn')}</span><span>{members.length - alive}</span></div>
      {actions}
    </div>
  );
}

function LairInspector({ session, id, actions }: { session: GameSession; id: string; actions: JSX.Element }) {
  const a = useEntity(session, 'spawnAreas', id);
  const templates = useEntityList(session, 'creatureTemplates');
  const setTab = useEditorStore((s) => s.setTab);
  useLiveCounts(session);
  if (!a?.lair) return null;
  const lair = a.lair;
  const tpl = templates.find((x) => x.id === a.templateId);
  const up = (patch: Partial<typeof a>, label = t('Edit boss lair')) => session.entities.update('spawnAreas', a.id, patch, label);
  const boss = session.clans.bossOf(a.id);
  const stats = session.clans.lairStats(a.id);
  const raid = session.runtime.sim.raids.find((r) => r.lairId === a.id);
  const clan = raid && session.clans.get(raid.clanId);
  const now = session.runtime.clock.totalMinutes;
  let status: string;
  if (!boss) status = t('No boss');
  else if (boss.state === 'dead') status = t('Dead — respawns in {h} h {m} min', { h: Math.floor(Math.max(0, boss.respawnAt - now) / 60), m: Math.floor(Math.max(0, boss.respawnAt - now) % 60) });
  else status = `${boss.hp} / ${boss.maxHp} ${t('HP')}${boss.enraged ? ' · ' + t('ENRAGED') : ''}${boss.targetId ? ' · ' + t('in combat') : ''}`;
  return (
    <div className="form">
      <div className="row">
        {tpl && <SpritePreview frame={`cr:${tpl.type}:0`} box={44} />}
        <div className="grow">
          <div className="inspect-title">{a.name}</div>
          <div className="hint">{tpl ? `${tpl.name} · ${t('Lv')} ${tpl.level} · ${tpl.maxHp} ${t('HP')} · ${t('Damage')} ${tpl.damage}` : ''}</div>
        </div>
      </div>
      <Field label={t('Name')}><TextInput value={a.name} onChange={(name) => up({ name }, t('Rename boss lair'))} /></Field>
      <Field label={t('Boss')}>
        <Select value={a.templateId} options={templates.filter((x) => x.boss).map((x) => ({ key: x.id, label: `${x.name} (${t('Lv')} ${x.level})` }))} onChange={(templateId) => up({ templateId }, t('Change boss'))} />
      </Field>
      <div className="two-col">
        <Field label={t('Respawn (game hours)')}><NumberInput value={lair.respawnHours} min={1} max={168} onChange={(respawnHours) => up({ lair: { ...lair, respawnHours } })} /></Field>
        <Field label={t('Recommended raid size')} hint={session.studio.standard ? t('Bigger raids cost more to build.') : undefined}><NumberInput value={lair.minRaid} min={2} max={20} onChange={(minRaid) => up({ lair: { ...lair, minRaid } })} /></Field>
      </div>
      <div className="kv"><span>{t('Boss')}</span><span>{status}</span></div>
      <div className="kv"><span>{t('Raid now')}</span><span>{raid ? `${clan ? `[${clan.tag}] ${clan.name}` : t('Pick-up group')} · ${t(raid.phase === 'gathering' ? 'gathering' : 'fighting')} · ${raid.members.length} ${t('players')} · ${t('attempt {n}', { n: raid.attempt })}` : '—'}</span></div>
      <div className="kv"><span>{t('Kills / wipes')}</span><span>{stats.kills} / {stats.wipes}</span></div>
      <div className="kv"><span>{t('World first')}</span><span>{stats.firstKill ? (stats.firstKill.clanName || t('A pick-up group')) : t('not yet')}</span></div>
      <button className="btn small" onClick={() => { if (tpl) { useEditorStore.getState().setTemplateId(tpl.id); setTab('creatures'); } }}>{t('Edit boss stats & loot')}</button>
      {actions}
    </div>
  );
}
