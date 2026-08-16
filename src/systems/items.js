// Предметы, торговля и лавки — покупки «как в Daggerfall».
import { PART } from '../entities/humanoid.js';

export const SLOT = {
  WEAPON: 'weapon',
  ARMOR: 'armor',
  USE: 'use',
  PROSTHETIC: 'prosthetic',
  LOOT: 'loot',
};

/**
 * Реестр предметов. reach — дальность удара в метрах, ranged — оружие дальнего боя.
 */
export const ITEMS = {
  // ── оружие ближнего боя ──
  dagger: { id: 'dagger', name: 'Кинжал', slot: SLOT.WEAPON, price: 35, damage: 12, reach: 1.7, speed: 0.42, sever: 0.1, desc: 'Быстрый, но короткий.' },
  sword: { id: 'sword', name: 'Меч', slot: SLOT.WEAPON, price: 140, damage: 24, reach: 2.3, speed: 0.62, sever: 0.18, desc: 'Надёжный клинок на все случаи.' },
  axe: { id: 'axe', name: 'Секира', slot: SLOT.WEAPON, price: 210, damage: 34, reach: 2.4, speed: 0.85, sever: 0.34, desc: 'Тяжёлая. Отрубает руки и ноги куда чаще прочего.' },
  greatsword: { id: 'greatsword', name: 'Двуручник', slot: SLOT.WEAPON, price: 420, damage: 46, reach: 2.9, speed: 1.05, sever: 0.3, twoHanded: true, desc: 'Нужны обе руки. Бьёт страшно.' },
  elfblade: { id: 'elfblade', name: 'Эльфийский клинок', slot: SLOT.WEAPON, price: 560, damage: 32, reach: 2.5, speed: 0.5, sever: 0.24, desc: 'Лёгкий и злой, как весь этот лес.' },
  darkaxe: { id: 'darkaxe', name: 'Секира Злодея', slot: SLOT.WEAPON, price: 700, damage: 52, reach: 2.6, speed: 0.9, sever: 0.45, desc: 'Рубит доспех вместе с тем, кто в нём.' },

  // ── дальний бой ──
  shortbow: { id: 'shortbow', name: 'Короткий лук', slot: SLOT.WEAPON, price: 120, damage: 20, ranged: true, speed: 0.8, sever: 0.06, desc: 'Стреляет тем, что в колчане.' },
  longbow: { id: 'longbow', name: 'Длинный лук эльфов', slot: SLOT.WEAPON, price: 380, damage: 34, ranged: true, speed: 0.95, sever: 0.12, desc: 'Бьёт далеко и точно.' },
  crossbow: { id: 'crossbow', name: 'Арбалет', slot: SLOT.WEAPON, price: 300, damage: 40, ranged: true, speed: 1.5, sever: 0.1, desc: 'Долго взводить, зато пробивает броню.' },
  arrows: { id: 'arrows', name: 'Стрелы', slot: SLOT.USE, price: 2, stack: true, desc: 'Без них лук — просто палка.' },

  // ── броня ──
  leather: { id: 'leather', name: 'Кожаный доспех', slot: SLOT.ARMOR, price: 90, armor: 6, weight: 0.03, desc: 'Лёгкий, почти не мешает.' },
  chain: { id: 'chain', name: 'Кольчуга', slot: SLOT.ARMOR, price: 260, armor: 14, weight: 0.12, desc: 'Разумный размен защиты на прыть.' },
  plate: { id: 'plate', name: 'Латы стражи', slot: SLOT.ARMOR, price: 620, armor: 26, weight: 0.24, desc: 'Дворцовый доспех. Тяжёлый.' },
  elfcloak: { id: 'elfcloak', name: 'Плащ следопыта', slot: SLOT.ARMOR, price: 340, armor: 10, weight: 0.0, stealth: 0.35, desc: 'В лесу тебя замечают позже.' },
  darkmail: { id: 'darkmail', name: 'Чёрная броня', slot: SLOT.ARMOR, price: 700, armor: 30, weight: 0.2, desc: 'Броня форта. В ней не убегают — в ней наступают.' },

  // ── расходники ──
  bandage: { id: 'bandage', name: 'Бинт', slot: SLOT.USE, price: 25, stack: true, desc: 'ОСТАНАВЛИВАЕТ КРОВЬ. Без него отрубленная рука убьёт.' },
  potion: { id: 'potion', name: 'Зелье лечения', slot: SLOT.USE, price: 60, stack: true, heal: 45, desc: 'Возвращает здоровье, но не конечности.' },
  bigpotion: { id: 'bigpotion', name: 'Большое зелье', slot: SLOT.USE, price: 150, stack: true, heal: 120, desc: 'На тяжёлый случай.' },
  food: { id: 'food', name: 'Походная снедь', slot: SLOT.USE, price: 12, stack: true, heal: 12, desc: 'Немного здоровья и сил.' },

  // ── протезы ──
  wood_arm: { id: 'wood_arm', name: 'Деревянная рука', slot: SLOT.PROSTHETIC, part: 'arm', price: 180, quality: 0.7, desc: 'Держать оружие можно. Плохо, но можно.' },
  steel_arm: { id: 'steel_arm', name: 'Стальная рука', slot: SLOT.PROSTHETIC, part: 'arm', price: 520, quality: 1.0, desc: 'Почти как своя.' },
  wood_leg: { id: 'wood_leg', name: 'Деревянная нога', slot: SLOT.PROSTHETIC, part: 'leg', price: 200, quality: 0.7, desc: 'Ходить — да. Бегать — не очень.' },
  steel_leg: { id: 'steel_leg', name: 'Стальная нога', slot: SLOT.PROSTHETIC, part: 'leg', price: 580, quality: 1.0, desc: 'Лучшее, что бывает после потери ноги.' },
  glass_eye: { id: 'glass_eye', name: 'Стеклянный глаз', slot: SLOT.PROSTHETIC, part: 'eye', price: 260, quality: 1.0, desc: 'Возвращает обзор: экран снова видно целиком.' },
  wheelchair: { id: 'wheelchair', name: 'Коляска', slot: SLOT.PROSTHETIC, part: 'wheelchair', price: 300, desc: 'Если ног нет, а ползать надоело.' },

  // ── добыча с корованов ──
  silk: { id: 'silk', name: 'Тюк шёлка', slot: SLOT.LOOT, price: 110, stack: true, desc: 'Корованный товар. Купцы берут охотно.' },
  spice: { id: 'spice', name: 'Мешок пряностей', slot: SLOT.LOOT, price: 85, stack: true, desc: 'Пахнет дорого.' },
  ore: { id: 'ore', name: 'Ящик руды', slot: SLOT.LOOT, price: 55, stack: true, desc: 'Тяжёлый, но берут везде.' },
  relic: { id: 'relic', name: 'Императорская реликвия', slot: SLOT.LOOT, price: 400, stack: true, desc: 'За такое ищут. И находят.' },
};

/** Ассортимент лавок. Наценка — во сколько раз дороже базовой цены. */
export const SHOPS = {
  palace_armory: {
    name: 'Дворцовая оружейная',
    markup: 1.1,
    buyback: 0.45,
    stock: ['sword', 'axe', 'greatsword', 'crossbow', 'chain', 'plate', 'bandage', 'potion', 'arrows'],
  },
  elf_bowyer: {
    name: 'Лучных дел мастер',
    markup: 1.0,
    buyback: 0.5,
    stock: ['shortbow', 'longbow', 'elfblade', 'dagger', 'leather', 'elfcloak', 'arrows', 'bandage', 'potion'],
  },
  fort_smith: {
    name: 'Кузнец-отступник',
    markup: 1.2,
    buyback: 0.4,
    stock: ['axe', 'darkaxe', 'greatsword', 'darkmail', 'chain', 'bandage', 'bigpotion'],
  },
  human_general: {
    name: 'Лавка «Всё для похода»',
    markup: 1.25,
    buyback: 0.55,
    stock: ['dagger', 'sword', 'shortbow', 'arrows', 'leather', 'bandage', 'potion', 'bigpotion', 'food'],
  },
  prosthetist: {
    name: 'Протезная мастерская',
    markup: 1.0,
    buyback: 0.3,
    stock: ['wood_arm', 'steel_arm', 'wood_leg', 'steel_leg', 'glass_eye', 'wheelchair', 'bandage', 'bigpotion'],
  },
};

export function priceFor(itemId, shop, selling = false) {
  const item = ITEMS[itemId];
  if (!item) return 0;
  const s = SHOPS[shop];
  if (!s) return item.price;
  return Math.max(1, Math.round(item.price * (selling ? s.buyback : s.markup)));
}

/** Какому увечью соответствует протез. */
export function prostheticTarget(itemId, injuries) {
  const item = ITEMS[itemId];
  if (!item || item.slot !== SLOT.PROSTHETIC) return null;
  if (item.part === 'eye') return injuries.eyesLost > 0 ? 'eye' : null;
  if (item.part === 'wheelchair') return 'wheelchair';
  const candidates =
    item.part === 'arm' ? [PART.ARM_R, PART.ARM_L] : [PART.LEG_R, PART.LEG_L];
  for (const p of candidates) {
    if (injuries.missing[p] && !injuries.prosthetic[p]) return p;
  }
  return null;
}

/** Инвентарь: стопки расходников и отдельные вещи. */
export class Inventory {
  constructor() {
    this.items = {}; // id -> количество
    this.equippedWeapon = null;
    this.equippedArmor = null;
  }

  add(id, count = 1) {
    if (!ITEMS[id]) return;
    this.items[id] = (this.items[id] || 0) + count;
  }

  remove(id, count = 1) {
    if (!this.items[id]) return false;
    this.items[id] -= count;
    if (this.items[id] <= 0) delete this.items[id];
    if (this.equippedWeapon === id && !this.items[id]) this.equippedWeapon = null;
    if (this.equippedArmor === id && !this.items[id]) this.equippedArmor = null;
    return true;
  }

  has(id, count = 1) {
    return (this.items[id] || 0) >= count;
  }

  count(id) {
    return this.items[id] || 0;
  }

  list() {
    return Object.keys(this.items).map((id) => ({ ...ITEMS[id], count: this.items[id] }));
  }

  get weapon() {
    return this.equippedWeapon ? ITEMS[this.equippedWeapon] : null;
  }

  get armor() {
    return this.equippedArmor ? ITEMS[this.equippedArmor] : null;
  }

  get armorValue() {
    return this.armor?.armor || 0;
  }

  /** Тяжёлая броня замедляет — это важно при погоне за корованом. */
  get weightPenalty() {
    return this.armor?.weight || 0;
  }

  equip(id) {
    const item = ITEMS[id];
    if (!item || !this.has(id)) return false;
    if (item.slot === SLOT.WEAPON) this.equippedWeapon = id;
    else if (item.slot === SLOT.ARMOR) this.equippedArmor = id;
    else return false;
    return true;
  }

  /** Автоматически надеть лучшее из имеющегося — после покупки или загрузки. */
  autoEquip() {
    let bestW = null;
    let bestA = null;
    for (const id of Object.keys(this.items)) {
      const it = ITEMS[id];
      if (it.slot === SLOT.WEAPON && (!bestW || it.damage > ITEMS[bestW].damage)) bestW = id;
      if (it.slot === SLOT.ARMOR && (!bestA || it.armor > ITEMS[bestA].armor)) bestA = id;
    }
    if (!this.equippedWeapon) this.equippedWeapon = bestW;
    if (!this.equippedArmor) this.equippedArmor = bestA;
  }

  serialize() {
    return {
      items: { ...this.items },
      equippedWeapon: this.equippedWeapon,
      equippedArmor: this.equippedArmor,
    };
  }

  static deserialize(data) {
    const inv = new Inventory();
    if (!data) return inv;
    Object.assign(inv.items, data.items || {});
    inv.equippedWeapon = data.equippedWeapon || null;
    inv.equippedArmor = data.equippedArmor || null;
    return inv;
  }
}

/** Стартовое снаряжение фракции. */
export function startingKit(factionId) {
  const kits = {
    elves: { gold: 120, items: { shortbow: 1, arrows: 24, dagger: 1, leather: 1, bandage: 3, potion: 1 } },
    empire: { gold: 90, items: { sword: 1, chain: 1, bandage: 2, potion: 2, food: 2 } },
    villain: { gold: 200, items: { axe: 1, chain: 1, bandage: 2, bigpotion: 1 } },
  };
  return kits[factionId] || kits.elves;
}
