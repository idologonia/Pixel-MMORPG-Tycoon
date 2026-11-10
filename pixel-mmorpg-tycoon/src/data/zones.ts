/** Painted zones: a per-tile layer the designer draws with the zone brush. */
export const enum ZoneId { None = 0, Town = 1, Safe = 2, Monsters = 3, Pvp = 4 }

export interface ZoneDef { id: ZoneId; key: string; name: string; color: number; hint: string }

export const ZONES: ZoneDef[] = [
  { id: ZoneId.Town, key: 'town', name: 'Town', color: 0xffa94d, hint: 'Safe: no PvP, monsters never come in. Players rest, trade and hang out here.' },
  { id: ZoneId.Safe, key: 'safe', name: 'Safe Zone', color: 0x9cf0c0, hint: 'Nobody can attack players here, monsters give up the chase at the border. Good for roads.' },
  { id: ZoneId.Monsters, key: 'monsters', name: 'Monster zone', color: 0xe2574c, hint: 'Monsters live here: groups of the chosen monster appear wherever you paint.' },
  { id: ZoneId.Pvp, key: 'pvp', name: 'PvP Zone', color: 0xb56cff, hint: 'Battleground: everyone inside fights everyone.' },
];

export const getZone = (id: number): ZoneDef | undefined => ZONES.find((z) => z.id === id);
/** Monster zones are filled with spawn areas of this size (tiles). */
export const ZONE_CHUNK = 8;
