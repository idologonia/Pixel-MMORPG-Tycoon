import { BIOMES } from '@/data/biomes';
import { ZONES } from '@/data/zones';
import { CAMPAIGNS, FEATURES, STAFF } from '@/data/progression';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AGGRESSIONS, CREATURE_TYPES } from '@/data/creatureTypes';
import { NPC_BEHAVIORS, NPC_TYPES } from '@/data/npcTypes';
import { OBJECT_CATEGORIES, OBJECTS } from '@/data/objects';
import { PVP_LABEL, REGION_TYPES } from '@/data/regionTypes';
import { TERRAINS } from '@/data/terrain';
import { DIFFICULTIES, MAP_SIZES, WORLD_TYPES } from '@/data/worldPresets';
import { SAVE_SLOTS } from '@/models/world';
import { BEHAVIORS, FACTORS } from '@/data/playerTypes';
import { SERVER_TIERS, SHOP_MODELS } from '@/data/studio';
import { ACTIVITY_LABEL } from '@/simulation/players/PlayerBrain';
import { FACTOR_HINT } from '@/ui/sim/feedback';
import { BOSS_PRESETS } from '@/data/bossTypes';
import { QUEST_TEMPLATES } from '@/systems/rpg/questTemplates';
import { LEAGUES } from '@/simulation/liveops/SeasonService';
import { FURNITURE } from '@/data/furniture';
import { BUILDING_ROLE, NPC_HOUSED_HINT, NPC_STREET_HINT } from '@/data/buildings';
import { CHAT } from '@/data/chatLines';
import { CLAN_STYLES } from '@/data/clanData';
import { EVENT_METRICS, EVENT_TYPES, TRIGGER_KINDS } from '@/data/eventTypes';
import { ANTI_CHEAT, BANNED_INNOCENT_REVIEW, CHEAT_KINDS, REVIEW_OPENERS, REVIEW_PHRASES, STREAMER_REVIEW_BAD, STREAMER_REVIEW_GOOD } from '@/data/community';
import { CLASS_SOURCE, DEFAULT_ECONOMY, DEFAULT_ITEMS, EQUIP_SLOTS, ITEM_CATEGORIES, OBJECTIVE_TYPES, RARITIES, STAT_KEYS } from '@/data/rpgDefaults';

/** Every string literal passed to t()/tr() anywhere in src. */
export function sourceKeys(dir = join(__dirname, '../src')): Set<string> {
  const keys = new Set<string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !p.includes('/i18n/')) {
        const src = readFileSync(p, 'utf8');
        const re = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) keys.add(m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"'));
      }
    }
  };
  walk(dir);
  return keys;
}

/** Strings that reach t() indirectly (registries, enums, labels arrays). */
export function dynamicKeys(): Set<string> {
  const k = new Set<string>();
  TERRAINS.forEach((x) => k.add(x.name));
  BIOMES.forEach((x) => k.add(x.name));
  ZONES.forEach((x) => { k.add(x.name); k.add(x.hint); });
  k.add('Zones');
  FEATURES.forEach((x) => { k.add(x.name); k.add(x.hint); });
  Object.values(STAFF).forEach((x) => { k.add(x.name); k.add(x.hint); });
  CAMPAIGNS.forEach((x) => k.add(x.name));
  OBJECTS.forEach((x) => k.add(x.name));
  OBJECT_CATEGORIES.forEach((x) => k.add(x.label));
  NPC_TYPES.forEach((x) => k.add(x.name));
  NPC_BEHAVIORS.forEach((x) => { k.add(x.label); k.add(x.hint); k.add(x.key); });
  CREATURE_TYPES.forEach((x) => k.add(x.name));
  AGGRESSIONS.forEach((x) => { k.add(x.label); k.add(x.hint); k.add(x.key); });
  REGION_TYPES.forEach((x) => k.add(x.name));
  WORLD_TYPES.forEach((x) => { k.add(x.label); k.add(x.description); });
  DIFFICULTIES.forEach((x) => { k.add(x.label); k.add(x.description); });
  MAP_SIZES.forEach((x) => k.add(x.label));
  SAVE_SLOTS.forEach((x) => k.add(x.label));
  ['idle', 'walk', 'chase', 'attack', 'flee', 'return', 'rest', 'dead'].forEach((s) => k.add(s));
  ['night', 'dawn', 'day', 'dusk'].forEach((s) => k.add(s));
  ['Terrain', 'Objects', 'Regions', 'NPC', 'Creatures', 'Spawns'].forEach((s) => k.add(s));
  ['Brush', 'Fill', 'Rectangle', 'Picker', 'Click & drag to paint terrain.', 'Flood-fill a connected area of the same terrain.', 'Drag to paint a rectangle.', 'Click a tile to pick its terrain.'].forEach((s) => k.add(s));
  ['All', 'Events', 'Simulation', 'System'].forEach((s) => k.add(s));
  ['Map', 'NPC', 'Creatures', 'Economy', 'Items', 'Quests', 'Progression', 'Players', 'Events', 'Analytics', 'Settings'].forEach((s) => k.add(s));
  DEFAULT_ITEMS.forEach((x) => { k.add(x.name); k.add(x.description); k.add(x.category); });
  ITEM_CATEGORIES.forEach((x) => k.add(x.label));
  RARITIES.forEach((x) => k.add(x.label));
  EQUIP_SLOTS.forEach((x) => k.add(x.label));
  STAT_KEYS.forEach((x) => k.add(x.label));
  OBJECTIVE_TYPES.forEach((x) => { k.add(x.label); k.add(x.hint); });
  CLASS_SOURCE.forEach((c) => { k.add(c.name); k.add(c.description); c.skills.forEach((s) => k.add(s[0])); });
  k.add(DEFAULT_ECONOMY.currencyName);
  ['sale', 'purchase', 'restock', 'loot', 'harvest', 'attack', 'heal', 'buff'].forEach((s) => k.add(s));
  ['HP', 'Mana', 'Attack', 'Defense', 'STR', 'AGI', 'INT', 'VIT'].forEach((s) => k.add(s));
  ['Economy', 'Items', 'Quests', 'Progression'].forEach((s) => k.add(s));
  BEHAVIORS.forEach((b) => { k.add(b.name); k.add(b.description); });
  Object.values(FACTORS).forEach((f) => k.add(f.label));
  Object.values(FACTOR_HINT).forEach((h) => k.add(h!));
  Object.values(ACTIVITY_LABEL).forEach((a) => k.add(a));
  SERVER_TIERS.forEach((s) => k.add(s.name));
  ['Players', 'Studio', 'Community', 'Positive', 'Negative', 'Streamers'].forEach((s) => k.add(s));
  Object.values(REVIEW_PHRASES).forEach((l) => l!.forEach((s) => k.add(s)));
  Object.values(REVIEW_OPENERS).forEach((l) => l.forEach((s) => k.add(s)));
  [BANNED_INNOCENT_REVIEW, STREAMER_REVIEW_GOOD, STREAMER_REVIEW_BAD].forEach((s) => k.add(s));
  EVENT_TYPES.forEach((e) => { k.add(e.name); k.add(e.description); });
  EVENT_METRICS.forEach((m) => k.add(m.label));
  TRIGGER_KINDS.forEach((x) => { k.add(x.label); k.add(x.hint); });
  ['Events', 'Analytics'].forEach((s) => k.add(s));
  CHEAT_KINDS.forEach((c) => { k.add(c.label); k.add(c.hint); });
  ANTI_CHEAT.forEach((a) => { k.add(a.name); k.add(a.description); });
  LEAGUES.forEach((l) => k.add(l.label));
  [BUILDING_ROLE, NPC_HOUSED_HINT, NPC_STREET_HINT].forEach((m) => Object.values(m).forEach((x) => k.add(x!)));
  REGION_TYPES.forEach((r) => k.add(r.description));
  Object.values(PVP_LABEL).forEach((x) => k.add(x));
  ['Red', 'Blue'].forEach((x) => k.add(x));
  FURNITURE.forEach((f) => { k.add(f.name); if (f.hint) k.add(f.hint); });
  Object.values(CHAT).forEach((l) => l.forEach((x) => k.add(x)));
  ['Runner-up', 'Third place', 'Auction', 'Seasons', 'Patches', 'Slower', 'Faster', 'Unchanged'].forEach((s) => k.add(s));
  const meetupSrc = readFileSync(join(__dirname, '../src/simulation/social/MeetupService.ts'), 'utf8');
  for (const m of meetupSrc.matchAll(/outcome = '((?:\\.|[^'])*)'/g)) k.add(m[1].replace(/\\'/g, "'"));
  for (const m of meetupSrc.matchAll(/let outcome = '((?:\\.|[^'])*)'/g)) k.add(m[1]);
  const patchSrc = readFileSync(join(__dirname, '../src/simulation/liveops/PatchService.ts'), 'utf8');
  for (const m of patchSrc.matchAll(/(?:key|label): '([A-Z{](?:\\.|[^'])*)'/g)) k.add(m[1].replace(/\\'/g, "'"));
  for (const m of patchSrc.matchAll(/'((?:Faster|Slower) levelling[^']*)'/g)) k.add(m[1]);
  QUEST_TEMPLATES.forEach((q) => { k.add(q.name); k.add(q.hint); });
  Object.values(SHOP_MODELS).forEach((m) => { k.add(m.label); k.add(m.hint); });
  ['Subscriptions', 'Cash shop', 'Sponsors'].forEach((s) => k.add(s));
  BOSS_PRESETS.forEach((b) => { k.add(b.name); k.add(b.description); });
  Object.values(CLAN_STYLES).forEach((c) => { k.add(c.label); k.add(c.hint); });
  ['Clans', 'Victory', 'Wipe', 'Gave up', 'gathering', 'fighting'].forEach((s) => k.add(s));
  // Quest validation messages (validateQuest returns English keys; the UI translates them).
  const questSrc = readFileSync(join(__dirname, '../src/systems/rpg/quests.ts'), 'utf8');
  for (const m of questSrc.matchAll(/(?:err|warn)\(\s*'((?:\\.|[^'])*)'/g)) k.add(m[1].replace(/\\'/g, "'"));
  return k;
}
