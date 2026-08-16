// Фракции, отношение к игроку и правила вражды.
import { ZONE } from '../world/zones.js';

export const FACTION = {
  ELVES: 'elves',
  EMPIRE: 'empire',
  VILLAIN: 'villain',
  HUMANS: 'humans',
};

export const FACTIONS = {
  [FACTION.ELVES]: {
    id: FACTION.ELVES,
    name: 'Лесные эльфы',
    short: 'Эльфы',
    color: 0x4a8f3a,
    cssColor: '#6fc25a',
    look: 'elf',
    home: ZONE.ELVES,
    playable: true,
    tagline: 'Партизанская война из густого леса',
    description:
      'Ты живёшь в чаще, в деревянных домиках на сваях. На вас набегают солдаты дворца и люди Злодея. ' +
      'Отвечай засадами, бей корованы на дорогах и уходи обратно в лес, где чужаку не видно дальше своего носа.',
    perks: ['Быстрее всех передвигается', 'Лучший лук в игре', 'В своём лесу видит дальше врагов'],
  },
  [FACTION.EMPIRE]: {
    id: FACTION.EMPIRE,
    name: 'Охрана дворца',
    short: 'Стража',
    color: 0xb03a3a,
    cssColor: '#e06a6a',
    look: 'guard',
    home: ZONE.EMPIRE,
    playable: true,
    tagline: 'Служба, приказы и оборона дворца',
    description:
      'Ты в имперской страже. Надо слушаться командира: держать посты, ловить эльфийских шпионов и партизан, ' +
      'отбивать штурмы Злодея и ходить в набеги на его форт или на лес.',
    perks: ['Крепкая броня и жалованье', 'Лекарь и оружейная во дворце', 'За приказы платят и повышают'],
  },
  [FACTION.VILLAIN]: {
    id: FACTION.VILLAIN,
    name: 'Злодей',
    short: 'Злодей',
    color: 0x6a3a8f,
    cssColor: '#a97ad0',
    look: 'villain',
    home: ZONE.VILLAIN,
    playable: true,
    tagline: 'Сам себе командир, своё войско и штурм дворца',
    description:
      'Ты хозяин старого форта в горах. Приказов нет — ты сам командир. Собирай войско, води его на дворец, ' +
      'отбивайся от эльфийских шпионов и партизан, которые повадились ходить к тебе в горы.',
    perks: ['Командует собственным отрядом', 'Самый сильный в ближнем бою', 'Костоправ в форте ставит протезы'],
  },
  [FACTION.HUMANS]: {
    id: FACTION.HUMANS,
    name: 'Люди',
    short: 'Люди',
    color: 0xb0893a,
    cssColor: '#d8b268',
    look: 'human',
    home: ZONE.HUMANS,
    playable: false,
    tagline: 'Нейтральные торговцы',
    description: 'Живут между всеми, торгуют со всеми и водят корованы.',
    perks: [],
  },
};

export const PLAYABLE_FACTIONS = Object.values(FACTIONS).filter((f) => f.playable);

/** Базовое отношение фракций друг к другу: -100 враги, 0 нейтралитет. */
const BASE_RELATIONS = {
  [FACTION.ELVES]: { [FACTION.EMPIRE]: -70, [FACTION.VILLAIN]: -60, [FACTION.HUMANS]: 10 },
  [FACTION.EMPIRE]: { [FACTION.ELVES]: -70, [FACTION.VILLAIN]: -85, [FACTION.HUMANS]: 25 },
  [FACTION.VILLAIN]: { [FACTION.ELVES]: -60, [FACTION.EMPIRE]: -85, [FACTION.HUMANS]: -20 },
  [FACTION.HUMANS]: { [FACTION.ELVES]: 10, [FACTION.EMPIRE]: 25, [FACTION.VILLAIN]: -20 },
};

export const HOSTILE_THRESHOLD = -30;

export class Reputation {
  constructor(playerFaction) {
    this.playerFaction = playerFaction;
    this.values = {};
    for (const id of Object.keys(FACTIONS)) {
      this.values[id] = id === playerFaction ? 60 : (BASE_RELATIONS[playerFaction]?.[id] ?? 0);
    }
  }

  get(id) {
    return this.values[id] ?? 0;
  }

  change(id, delta) {
    if (!(id in this.values)) return 0;
    const before = this.values[id];
    this.values[id] = Math.max(-100, Math.min(100, before + delta));
    return this.values[id] - before;
  }

  isHostile(id) {
    if (id === this.playerFaction) return this.values[id] <= HOSTILE_THRESHOLD;
    return this.get(id) <= HOSTILE_THRESHOLD;
  }

  label(id) {
    const v = this.get(id);
    if (v <= -70) return 'смертельный враг';
    if (v <= HOSTILE_THRESHOLD) return 'враг';
    if (v < 15) return 'настороженно';
    if (v < 50) return 'дружелюбно';
    return 'свои';
  }

  serialize() {
    return { playerFaction: this.playerFaction, values: { ...this.values } };
  }

  static deserialize(data) {
    const rep = new Reputation(data?.playerFaction || FACTION.ELVES);
    if (data?.values) Object.assign(rep.values, data.values);
    return rep;
  }
}

/** Враждуют ли две фракции между собой (для стычек ИИ без участия игрока). */
export function factionsHostile(a, b) {
  if (a === b) return false;
  return (BASE_RELATIONS[a]?.[b] ?? 0) <= HOSTILE_THRESHOLD;
}
