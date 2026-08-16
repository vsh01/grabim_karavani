// Карта мира: четыре зоны и дороги между ними.
// Оси: +X — восток, -Z — север, +Z — юг. Мир квадратный, центр в (0,0).
import { clamp, distToSegment } from '../core/utils.js';

export const WORLD_SIZE = 2000;
export const WORLD_HALF = WORLD_SIZE / 2;

export const ZONE = {
  HUMANS: 'humans',
  EMPIRE: 'empire',
  ELVES: 'elves',
  VILLAIN: 'villain',
};

/**
 * Четыре зоны, как просил Кирилл:
 * 1 — люди (нейтралы), 2 — император (дворец), 3 — эльфы (лес), 4 — злодей (горы, форт).
 */
export const ZONES = [
  {
    id: ZONE.HUMANS,
    index: 1,
    name: 'Земли людей',
    subtitle: 'нейтральная торговая округа',
    center: { x: 430, z: 430 },
    radius: 560,
    sky: 0x9dc0e6,
    ground: 0x6f8f45,
    fog: [340, 900],
    treeDensity: 0.18,
    hub: { x: 430, z: 430, name: 'Село Тележное' },
  },
  {
    id: ZONE.EMPIRE,
    index: 2,
    name: 'Земли императора',
    subtitle: 'дворец и казармы стражи',
    center: { x: 470, z: -470 },
    radius: 560,
    sky: 0xb2cdea,
    ground: 0x7d9450,
    fog: [380, 940],
    treeDensity: 0.12,
    hub: { x: 470, z: -470, name: 'Дворец Императора' },
  },
  {
    id: ZONE.ELVES,
    index: 3,
    name: 'Лес эльфов',
    subtitle: 'густой лес, деревянные домики',
    center: { x: -450, z: 440 },
    radius: 580,
    sky: 0x8fb488,
    ground: 0x476b36,
    fog: [150, 560], // в чаще видно недалеко — лес и должен быть густой
    treeDensity: 1.0,
    hub: { x: -450, z: 440, name: 'Древогорье' },
  },
  {
    id: ZONE.VILLAIN,
    index: 4,
    name: 'Горы Злодея',
    subtitle: 'старый форт среди скал',
    center: { x: -480, z: -480 },
    radius: 580,
    sky: 0x6b6270,
    ground: 0x5d5750,
    fog: [260, 780],
    treeDensity: 0.22,
    hub: { x: -480, z: -480, name: 'Старый Форт' },
  },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

/** Перекрёсток в центре карты: сюда сходятся все дороги, тут ходят корованы. */
export const CROSSROADS = { x: 0, z: 0, name: 'Большой Перекрёсток' };

/** Дороги: от каждого центра зоны к перекрёстку. */
export const ROADS = ZONES.map((z) => ({
  zone: z.id,
  a: { x: z.hub.x, z: z.hub.z },
  b: { x: CROSSROADS.x, z: CROSSROADS.z },
}));

export const ROAD_WIDTH = 11;

/** Расстояние до ближайшей дороги — нужно для ландшафта, леса и построек. */
export function distanceToRoad(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    const d = distToSegment(x, z, r.a.x, r.a.z, r.b.x, r.b.z);
    if (d < best) best = d;
  }
  return best;
}

/** Влияние каждой зоны в точке — нормированные веса для плавных переходов. */
const _weights = {};
export function zoneWeights(x, z) {
  let total = 0;
  for (const zone of ZONES) {
    const d = Math.hypot(x - zone.center.x, z - zone.center.z);
    // Гладкое спадание: в центре 1, на границе радиуса 0.
    const w = Math.pow(clamp(1 - d / (zone.radius * 1.65), 0, 1), 2) + 0.0001;
    _weights[zone.id] = w;
    total += w;
  }
  for (const zone of ZONES) _weights[zone.id] /= total;
  return _weights;
}

/** Зона, которой принадлежит точка (по ближайшему центру). */
export function zoneAt(x, z) {
  let best = ZONES[0];
  let bestD = Infinity;
  for (const zone of ZONES) {
    const d = (x - zone.center.x) ** 2 + (z - zone.center.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = zone;
    }
  }
  return best;
}

export function inWorld(x, z) {
  return Math.abs(x) < WORLD_HALF - 4 && Math.abs(z) < WORLD_HALF - 4;
}

/** Прижимает координаты к границам мира. */
export function clampToWorld(v) {
  const lim = WORLD_HALF - 8;
  v.x = clamp(v.x, -lim, lim);
  v.z = clamp(v.z, -lim, lim);
  return v;
}
