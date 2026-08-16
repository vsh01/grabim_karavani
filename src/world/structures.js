// Постройки всех четырёх зон.
//
// Каждое поселение собирается в несколько «корзин» по материалу (камень, дерево,
// крыша, ткань) и склеивается в один меш на корзину — так целая деревня рисуется
// четырьмя вызовами отрисовки вместо сотни.
import * as THREE from 'three';
import { mergeParts, trs } from './geo.js';
import { makeRng } from '../core/utils.js';
import { stoneBlocks, woodPlanks, thatch, cloth, bark } from './textures.js';
import { ZONE_BY_ID, ZONE, CROSSROADS } from './zones.js';

/** Накопитель геометрии, разложенной по материалам. */
class Builder {
  constructor() {
    this.buckets = new Map();
    this.colliders = [];
    this.interactables = [];
    this._frame = null;
  }

  /** Все детали, добавленные до popFrame, попадают в локальную систему координат. */
  pushFrame(matrix) {
    this._frame = matrix;
  }

  popFrame() {
    this._frame = null;
  }

  add(bucket, geo, matrix, color, uvScale = 1) {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, []);
    const m = this._frame ? this._frame.clone().multiply(matrix) : matrix;
    this.buckets.get(bucket).push({ geo, matrix: m, color, uvScale });
  }

  /** Коробка, заданная центром основания (y — уровень пола). */
  box(bucket, w, h, d, x, y, z, color, ry = 0, uvScale = null) {
    this.add(
      bucket,
      new THREE.BoxGeometry(w, h, d),
      trs(x, y + h / 2, z, 0, ry, 0),
      color,
      uvScale ?? Math.max(1, Math.round(Math.max(w, d) / 5)),
    );
  }

  cyl(bucket, rTop, rBot, h, seg, x, y, z, color) {
    this.add(bucket, new THREE.CylinderGeometry(rTop, rBot, h, seg), trs(x, y + h / 2, z), color);
  }

  /** Наклонная балка/ветка: цилиндр с произвольным поворотом. */
  beam(bucket, r, len, x, y, z, rx, ry, rz, color) {
    this.add(bucket, new THREE.CylinderGeometry(r, r, len, 6), trs(x, y, z, rx, ry, rz), color);
  }

  cone(bucket, r, h, seg, x, y, z, color, ry = 0) {
    this.add(bucket, new THREE.ConeGeometry(r, h, seg), trs(x, y + h / 2, z, 0, ry, 0), color);
  }

  /** Двускатная крыша: два наклонных ската, конёк вдоль оси X. */
  gable(bucket, w, d, h, x, y, z, color) {
    const half = d / 2;
    const slope = Math.hypot(half, h);
    const angle = Math.atan2(h, half);
    const thick = 0.35;
    for (const sign of [1, -1]) {
      this.add(
        bucket,
        new THREE.BoxGeometry(w, thick, slope),
        trs(x, y + h / 2, z + (sign * d) / 4, sign * -angle, 0, 0),
        color,
        Math.max(1, Math.round(w / 4)),
      );
    }
    // Треугольные фронтоны с торцов.
    for (const sign of [1, -1]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([-half, 0, 0, half, 0, 0, 0, h, 0], 3),
      );
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      tri.computeVertexNormals();
      this.add(bucket, tri, trs(x + (sign * w) / 2, y, z, 0, Math.PI / 2, 0), color);
    }
  }

  /** Прямоугольная преграда. top — высота, выше которой её можно перепрыгнуть. */
  blockBox(x, z, w, d, top, baseY) {
    this.colliders.push({
      type: 'box',
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      top: baseY + top,
    });
  }

  blockCircle(x, z, r, top, baseY) {
    this.colliders.push({ type: 'circle', x, z, r, top: baseY + top });
  }

  interact(opts) {
    this.interactables.push(opts);
  }

  build() {
    const mats = materials();
    const group = new THREE.Group();
    for (const [name, parts] of this.buckets) {
      if (!parts.length) continue;
      const geo = mergeParts(parts);
      const mesh = new THREE.Mesh(geo, mats[name] || mats.stone);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** Материалы общие для всех поселений — создаются один раз. */
let MATERIALS = null;
function materials() {
  if (MATERIALS) return MATERIALS;
  const mk = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  MATERIALS = {
    stone: mk(stoneBlocks()),
    wood: mk(woodPlanks()),
    roof: mk(thatch()),
    log: mk(bark()),
    cloth: mk(cloth('#ffffff', 'base')),
  };
  return MATERIALS;
}

const STONE = 0xbdb7a9;
const STONE_DARK = 0x8b8578;
const STONE_RUIN = 0x77706a;
const WOOD = 0xc7a06a;
const WOOD_DARK = 0x8f6f45;
const ROOF_STRAW = 0xd8bd6e;
const GOLD = 0xe8c65a;

// ─────────────────────────────── дворец императора ───────────────────────────────

export function buildPalace(terrain) {
  const zone = ZONE_BY_ID[ZONE.EMPIRE];
  const cx = zone.hub.x;
  const cz = zone.hub.z;
  const y = terrain.flatten(cx, cz, 130, 50);

  const b = new Builder();
  const R = 96; // половина стороны крепостной стены
  const WALL_H = 13;
  const WALL_T = 4;
  const GATE_W = 18; // проём в южной стене

  // Крепостная стена. Южная сторона разрывается воротами.
  const wall = (x, z, w, d) => {
    b.box('stone', w, WALL_H, d, x, y, z, STONE);
    b.box('stone', w + 0.6, 1.2, d + 0.6, x, y + WALL_H, z, STONE_DARK); // парапет
    b.blockBox(x, z, w, d, WALL_H, y);
  };
  wall(cx, cz - R, R * 2 + WALL_T, WALL_T); // север
  wall(cx - R, cz, WALL_T, R * 2 + WALL_T); // запад
  wall(cx + R, cz, WALL_T, R * 2 + WALL_T); // восток
  const sideW = R - GATE_W / 2;
  wall(cx - R + sideW / 2 - WALL_T / 2 + WALL_T / 2, cz + R, sideW + WALL_T, WALL_T);
  wall(cx + R - sideW / 2 + WALL_T / 2 - WALL_T / 2, cz + R, sideW + WALL_T, WALL_T);

  // Зубцы поверх стен.
  for (let i = -R; i <= R; i += 6) {
    b.box('stone', 2.4, 2.2, 2.4, cx + i, y + WALL_H + 1.2, cz - R, STONE);
    b.box('stone', 2.4, 2.2, 2.4, cx - R, y + WALL_H + 1.2, cz + i, STONE);
    b.box('stone', 2.4, 2.2, 2.4, cx + R, y + WALL_H + 1.2, cz + i, STONE);
    if (Math.abs(i) > GATE_W / 2 + 2) {
      b.box('stone', 2.4, 2.2, 2.4, cx + i, y + WALL_H + 1.2, cz + R, STONE);
    }
  }

  // Угловые башни.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tx = cx + sx * R;
      const tz = cz + sz * R;
      b.cyl('stone', 8, 9, 21, 10, tx, y, tz, STONE);
      b.cyl('stone', 9.4, 9.4, 1.6, 10, tx, y + 21, tz, STONE_DARK);
      b.cone('roof', 10, 9, 10, tx, y + 22.6, tz, 0x8a3f3f);
      b.blockCircle(tx, tz, 9, 21, y);
    }
  }

  // Надвратные башни.
  for (const sx of [-1, 1]) {
    const tx = cx + sx * (GATE_W / 2 + 3);
    b.cyl('stone', 5, 5.6, 18, 8, tx, y, cz + R, STONE);
    b.cone('roof', 6.4, 7, 8, tx, y + 18, cz + R, 0x8a3f3f);
    b.blockCircle(tx, cz + R, 5.6, 18, y);
  }
  // Перемычка над воротами — проход остаётся свободным.
  b.box('stone', GATE_W, 4, WALL_T, cx, y + WALL_H - 1, cz + R, STONE_DARK);

  // Главное здание дворца — три уступа с золотыми крышами.
  b.box('stone', 56, 3, 40, cx, y, cz - 12, STONE_DARK); // стилобат
  b.box('stone', 48, 16, 32, cx, y + 3, cz - 12, STONE);
  b.box('stone', 34, 12, 22, cx, y + 19, cz - 12, STONE);
  b.box('stone', 14, 16, 14, cx, y + 31, cz - 12, STONE);
  b.cone('cloth', 12, 12, 4, cx, y + 47, cz - 12, GOLD, Math.PI / 4);
  b.cone('cloth', 22, 7, 4, cx, y + 31, cz - 12, GOLD, Math.PI / 4);
  b.cone('cloth', 30, 6, 4, cx, y + 19, cz - 12, GOLD, Math.PI / 4);
  b.blockBox(cx, cz - 12, 48, 32, 19, y);

  // Колонны и лестница у входа.
  for (let i = -2; i <= 2; i++) {
    b.cyl('stone', 1.5, 1.7, 16, 8, cx + i * 9, y + 3, cz + 5, STONE);
  }
  for (let s = 0; s < 4; s++) {
    b.box('stone', 30 - s * 1.5, 0.9, 8 - s * 1.6, cx, y + s * 0.9, cz + 10 - s * 0.8, STONE_DARK);
  }

  // Казармы стражи.
  for (const sx of [-1, 1]) {
    const bx = cx + sx * 62;
    const bz = cz + 34;
    b.box('stone', 26, 7, 14, bx, y, bz, STONE_DARK);
    b.box('wood', 26, 4, 14, bx, y + 7, bz, WOOD);
    b.gable('roof', 26.5, 14.5, 5, bx, y + 11, bz, 0x9a4a3a);
    b.blockBox(bx, bz, 26, 14, 11, y);
  }

  // Тренировочные чучела во дворе.
  for (let i = 0; i < 4; i++) {
    const dx = cx - 55 + i * 10;
    const dz = cz - 48;
    b.cyl('log', 0.5, 0.6, 4, 6, dx, y, dz, WOOD_DARK);
    b.box('cloth', 2.4, 0.6, 0.6, dx, y + 3, dz, 0x9c8f70);
    b.blockCircle(dx, dz, 0.8, 4, y);
  }

  // Знамёна на флагштоках вдоль подъезда.
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 === 0 ? -1 : 1;
    const fz = cz + R + 14 + Math.floor(i / 2) * 22;
    const fx = cx + sx * 13;
    b.cyl('log', 0.28, 0.28, 12, 6, fx, y, fz, WOOD_DARK);
    b.box('cloth', 0.2, 6, 4.5, fx, y + 5, fz + 2.2, 0xc8a12e);
  }

  b.interact({
    kind: 'commander',
    x: cx,
    z: cz + 16,
    y,
    radius: 5,
    label: 'Командир стражи Ратибор',
    hint: 'получить приказ',
  });
  b.interact({
    kind: 'shop',
    shop: 'palace_armory',
    x: cx - 62,
    z: cz + 44,
    y,
    radius: 5,
    label: 'Дворцовая оружейная',
    hint: 'торговать',
  });
  b.interact({
    kind: 'healer',
    x: cx + 62,
    z: cz + 44,
    y,
    radius: 5,
    label: 'Придворный лекарь',
    hint: 'лечиться',
  });
  b.interact({
    kind: 'rest',
    x: cx + 40,
    z: cz - 40,
    y,
    radius: 5,
    label: 'Казарменная койка',
    hint: 'отдохнуть и сохраниться',
  });

  const group = b.build();
  group.name = 'palace';
  return {
    group,
    colliders: b.colliders,
    interactables: b.interactables,
    exclusion: { x: cx, z: cz, r: 140 },
    spawn: { x: cx, z: cz + R + 26, y },
    gate: { x: cx, z: cz + R },
  };
}

// ─────────────────────────────── деревня эльфов ───────────────────────────────

/** Деревянный домик на сваях: то самое «домики деревяные» из ТЗ. */
function elfHut(b, x, y, z, rot, rng, scale = 1) {
  const stiltH = 2.6 + rng() * 2.2;
  const w = (6 + rng() * 2.5) * scale;
  const d = (5 + rng() * 2) * scale;
  const h = 4 + rng() * 1.4;

  b.pushFrame(trs(x, 0, z, 0, rot, 0));

  // Сваи поднимают дом над влажной лесной землёй.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl('log', 0.35, 0.45, stiltH, 6, (sx * w) / 2.6, y, (sz * d) / 2.6, WOOD_DARK);
    }
  }
  b.box('wood', w + 1.2, 0.5, d + 1.2, 0, y + stiltH, 0, WOOD_DARK); // помост
  b.box('wood', w, h, d, 0, y + stiltH + 0.5, 0, WOOD);
  // Брёвна по углам сруба.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl('log', 0.4, 0.4, h, 6, (sx * w) / 2, y + stiltH + 0.5, (sz * d) / 2, WOOD_DARK);
    }
  }
  b.gable('roof', w + 1.6, d + 1.6, 3.2 + rng(), 0, y + stiltH + 0.5 + h, 0, ROOF_STRAW);

  // Окно и дверь — тёмные проёмы, дом сразу читается как жилой.
  b.box('wood', 1.6, 1.6, 0.3, -w / 4, y + stiltH + 2.2, d / 2, 0x2b2118);
  b.box('wood', 1.8, 2.8, 0.3, w / 4, y + stiltH + 0.7, d / 2, 0x3a2c1d);

  // Лестница на помост.
  for (let s = 0; s < 5; s++) {
    b.box('wood', 2, 0.24, 0.7, 0, y + s * (stiltH / 5), d / 2 + 1.6 + s * 0.3, WOOD_DARK);
  }
  b.popFrame();

  b.blockCircle(x, z, Math.max(w, d) / 2, y + stiltH + 0.5, 0);
}

export function buildElfVillage(terrain, seed = 733) {
  const zone = ZONE_BY_ID[ZONE.ELVES];
  const cx = zone.hub.x;
  const cz = zone.hub.z;
  const rng = makeRng(seed);
  // Поляну делаем небольшой: вокруг должен остаться густой лес.
  const y = terrain.flatten(cx, cz, 48, 34);

  const b = new Builder();

  // Древо Совета — огромный ствол в центре поляны.
  b.cyl('log', 2.4, 4.6, 26, 12, cx, y, cz, 0x5a4128);
  b.blockCircle(cx, cz, 4.2, 26, y);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add(
      'log',
      new THREE.CylinderGeometry(0.5, 0.9, 12, 6),
      trs(cx + Math.cos(a) * 4, y + 20, cz + Math.sin(a) * 4, Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75),
      0x5a4128,
    );
  }
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const dd = 3 + rng() * 7;
    b.add(
      'wood',
      new THREE.SphereGeometry(4.5 + rng() * 2.5, 8, 6),
      trs(cx + Math.cos(a) * dd, y + 24 + rng() * 5, cz + Math.sin(a) * dd),
      0x3f6f2b,
    );
  }
  // Круговой помост вокруг ствола — место собраний.
  b.cyl('wood', 9, 9, 0.6, 14, cx, y + 8.5, cz, WOOD);

  // Домики кольцом вокруг древа.
  const hutCount = 9;
  for (let i = 0; i < hutCount; i++) {
    const a = (i / hutCount) * Math.PI * 2 + rng() * 0.25;
    const dist = 20 + rng() * 16;
    const hx = cx + Math.cos(a) * dist;
    const hz = cz + Math.sin(a) * dist;
    elfHut(b, hx, terrain.heightAt(hx, hz), hz, -a + Math.PI / 2, rng);
  }

  // Костровище и брёвна вокруг него.
  b.cyl('stone', 2.2, 2.4, 0.5, 10, cx + 14, y, cz + 12, 0x6b6560);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.beam('log', 0.35, 3.2, cx + 14 + Math.cos(a) * 1.1, y + 1.4, cz + 12 + Math.sin(a) * 1.1,
      Math.cos(a) * 1.1, 0, -Math.sin(a) * 1.1, 0x4a3a26);
  }

  // Стойки для стрельбы из лука.
  for (let i = 0; i < 3; i++) {
    const tx = cx - 26 + i * 7;
    const tz = cz - 26;
    b.cyl('log', 0.25, 0.3, 3, 6, tx, terrain.heightAt(tx, tz), tz, WOOD_DARK);
    b.cyl('cloth', 1.1, 1.1, 0.25, 12, tx, terrain.heightAt(tx, tz) + 3, tz, 0xd8cdb0);
  }

  b.interact({
    kind: 'elder',
    x: cx + 8,
    z: cz + 8,
    y,
    radius: 5,
    label: 'Старейшина Ветвеслав',
    hint: 'получить задание',
  });
  b.interact({
    kind: 'shop',
    shop: 'elf_bowyer',
    x: cx - 16,
    z: cz + 14,
    y: terrain.heightAt(cx - 16, cz + 14),
    radius: 5,
    label: 'Лучных дел мастер',
    hint: 'торговать',
  });
  b.interact({
    kind: 'healer',
    x: cx + 18,
    z: cz - 12,
    y: terrain.heightAt(cx + 18, cz - 12),
    radius: 5,
    label: 'Травница Листвяна',
    hint: 'лечиться',
  });
  b.interact({
    kind: 'rest',
    x: cx - 8,
    z: cz - 16,
    y: terrain.heightAt(cx - 8, cz - 16),
    radius: 5,
    label: 'Лежанка в домике',
    hint: 'отдохнуть и сохраниться',
  });

  const group = b.build();
  group.name = 'elf-village';
  return {
    group,
    colliders: b.colliders,
    interactables: b.interactables,
    exclusion: { x: cx, z: cz, r: 46 },
    spawn: { x: cx + 6, z: cz + 13, y },
  };
}

// ─────────────────────────────── старый форт злодея ───────────────────────────────

export function buildOldFort(terrain, seed = 913) {
  const zone = ZONE_BY_ID[ZONE.VILLAIN];
  const cx = zone.hub.x;
  const cz = zone.hub.z;
  const rng = makeRng(seed);
  const y = terrain.flatten(cx, cz, 100, 55);

  const b = new Builder();
  const R = 62;

  // Полуразрушенная стена: сегменты разной высоты, местами проломы.
  const segs = 30;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    if (rng() < 0.16) continue; // пролом
    const px = cx + Math.cos(a) * R;
    const pz = cz + Math.sin(a) * R;
    const h = 6 + rng() * 8;
    const w = (Math.PI * 2 * R) / segs + 1.5;
    b.add(
      'stone',
      new THREE.BoxGeometry(w, h, 4),
      trs(px, terrain.heightAt(px, pz) + h / 2, pz, 0, -a, 0),
      STONE_RUIN,
      2,
    );
    b.blockCircle(px, pz, w / 2, h, terrain.heightAt(px, pz));
  }

  // Обломки у подножия стен.
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const d = R - 6 + rng() * 14;
    const px = cx + Math.cos(a) * d;
    const pz = cz + Math.sin(a) * d;
    const s = 0.8 + rng() * 2.2;
    b.add(
      'stone',
      new THREE.BoxGeometry(s, s * 0.7, s * 1.2),
      trs(px, terrain.heightAt(px, pz) + s * 0.3, pz, rng(), rng() * 3, rng()),
      STONE_RUIN,
    );
  }

  // Донжон — квадратная башня со сколотым углом.
  b.box('stone', 30, 26, 26, cx, y, cz - 6, STONE_RUIN);
  b.box('stone', 22, 8, 20, cx, y + 26, cz - 6, STONE_RUIN);
  b.blockBox(cx, cz - 6, 30, 26, 26, y);
  // Зубцы, часть выбита.
  for (let i = -3; i <= 3; i++) {
    if (rng() < 0.3) continue;
    b.box('stone', 2.6, 3, 2.6, cx + i * 4, y + 34, cz - 16, STONE_RUIN);
    b.box('stone', 2.6, 3, 2.6, cx + i * 4, y + 34, cz + 4, STONE_RUIN);
  }
  // Вход в донжон.
  b.box('wood', 5, 7, 0.6, cx, y, cz + 7.2, 0x2a2018);

  // Чёрные знамёна Злодея.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = cx + Math.cos(a) * (R - 12);
    const pz = cz + Math.sin(a) * (R - 12);
    const py = terrain.heightAt(px, pz);
    b.cyl('log', 0.25, 0.25, 11, 6, px, py, pz, 0x3a332c);
    b.box('cloth', 0.2, 5.5, 3.6, px, py + 4.6, pz + 1.9, 0x2b1e2e);
  }

  // Жаровни: светятся сами, отдельным материалом с самосвечением.
  const braziers = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const px = cx + Math.cos(a) * 26;
    const pz = cz + Math.sin(a) * 26;
    const py = terrain.heightAt(px, pz);
    b.cyl('stone', 1.5, 1.0, 3, 8, px, py, pz, 0x50483f);
    braziers.push({ x: px, y: py + 3, z: pz });
    b.blockCircle(px, pz, 1.5, 3, py);
  }

  // Шатры войска.
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const d = 34 + rng() * 16;
    const px = cx + Math.cos(a) * d;
    const pz = cz + Math.sin(a) * d;
    const py = terrain.heightAt(px, pz);
    b.cone('cloth', 4 + rng(), 5, 7, px, py, pz, 0x4a4038);
    b.blockCircle(px, pz, 3.4, 5, py);
  }

  b.interact({
    kind: 'wartable',
    x: cx,
    z: cz + 14,
    y,
    radius: 6,
    label: 'Военный стол',
    hint: 'командовать войском',
  });
  b.interact({
    kind: 'shop',
    shop: 'fort_smith',
    x: cx - 24,
    z: cz + 18,
    y: terrain.heightAt(cx - 24, cz + 18),
    radius: 5,
    label: 'Кузнец-отступник',
    hint: 'торговать',
  });
  b.interact({
    kind: 'prosthetist',
    x: cx + 24,
    z: cz + 18,
    y: terrain.heightAt(cx + 24, cz + 18),
    radius: 5,
    label: 'Костоправ Гнилозуб',
    hint: 'протезы и лечение',
  });
  b.interact({
    kind: 'rest',
    x: cx - 14,
    z: cz - 22,
    y: terrain.heightAt(cx - 14, cz - 22),
    radius: 5,
    label: 'Лежанка в донжоне',
    hint: 'отдохнуть и сохраниться',
  });

  const group = b.build();
  group.name = 'old-fort';

  // Огонь в жаровнях — отдельные светящиеся меши поверх геометрии форта.
  const fireGeo = new THREE.SphereGeometry(1.1, 8, 6);
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  for (const br of braziers) {
    const fire = new THREE.Mesh(fireGeo, fireMat);
    fire.position.set(br.x, br.y, br.z);
    fire.userData.flicker = Math.random() * 10;
    group.add(fire);
    const light = new THREE.PointLight(0xff7326, 12, 34, 2);
    light.position.set(br.x, br.y + 1, br.z);
    group.add(light);
  }

  return {
    group,
    colliders: b.colliders,
    interactables: b.interactables,
    exclusion: { x: cx, z: cz, r: 105 },
    spawn: { x: cx + 6, z: cz + 26, y },
    braziers,
  };
}

// ─────────────────────────────── деревня людей ───────────────────────────────

function humanHouse(b, x, y, z, rot, rng) {
  const w = 8 + rng() * 3;
  const d = 6 + rng() * 2.5;
  b.pushFrame(trs(x, 0, z, 0, rot, 0));
  b.box('stone', w, 3, d, 0, y, 0, 0xa8a294);
  b.box('wood', w, 4.2, d, 0, y + 3, 0, WOOD);
  // Фахверк: тёмные балки по фасаду.
  for (let i = -1; i <= 1; i++) {
    b.box('log', 0.4, 4.2, 0.4, (i * w) / 3, y + 3, d / 2, 0x5a4128);
  }
  b.gable('roof', w + 1.2, d + 1.2, 3.4, 0, y + 7.2, 0, ROOF_STRAW);
  b.box('wood', 1.8, 2.8, 0.3, 0, y + 3, d / 2 + 0.1, 0x3a2c1d); // дверь
  b.box('wood', 1.4, 1.4, 0.3, -w / 3, y + 4.6, d / 2 + 0.1, 0x2b2118); // окно
  b.cyl('stone', 0.7, 0.8, 4, 6, w / 3, y + 7, -d / 4, 0x8f8578); // труба
  b.popFrame();
  b.blockCircle(x, z, Math.max(w, d) / 2 - 0.4, y + 7.2, 0);
}

export function buildHumanVillage(terrain, seed = 311) {
  const zone = ZONE_BY_ID[ZONE.HUMANS];
  const cx = zone.hub.x;
  const cz = zone.hub.z;
  const rng = makeRng(seed);
  const y = terrain.flatten(cx, cz, 85, 40);

  const b = new Builder();

  // Колодец на площади.
  b.cyl('stone', 2.4, 2.6, 1.6, 12, cx, y, cz, 0x9a948a);
  b.blockCircle(cx, cz, 2.6, 1.6, y);
  for (const sx of [-1, 1]) b.cyl('log', 0.2, 0.2, 4, 6, cx + sx * 2, y + 1.6, cz, WOOD_DARK);
  b.box('roof', 6, 0.4, 3, cx, y + 5.4, cz, ROOF_STRAW);

  // Дома по кругу.
  const houses = 11;
  for (let i = 0; i < houses; i++) {
    const a = (i / houses) * Math.PI * 2 + rng() * 0.2;
    const dist = 24 + rng() * 22;
    const hx = cx + Math.cos(a) * dist;
    const hz = cz + Math.sin(a) * dist;
    humanHouse(b, hx, terrain.heightAt(hx, hz), hz, -a + Math.PI / 2, rng);
  }

  // Рыночные прилавки с полосатыми тентами.
  const stallColors = [0xc0392b, 0x2f7bbf, 0xd8a02e, 0x5a9e4a];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = cx + Math.cos(a) * 12;
    const sz = cz + Math.sin(a) * 12;
    const sy = terrain.heightAt(sx, sz);
    b.box('wood', 4, 1.1, 2.2, sx, sy + 0.9, sz, WOOD);
    for (const ox of [-1.8, 1.8]) {
      for (const oz of [-1, 1]) {
        b.cyl('log', 0.12, 0.12, 3.2, 5, sx + ox, sy, sz + oz, WOOD_DARK);
      }
    }
    b.box('cloth', 5, 0.2, 3.4, sx, sy + 3.2, sz, stallColors[i % stallColors.length]);
  }

  // Ограды огородов.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const d = 52 + rng() * 20;
    const px = cx + Math.cos(a) * d;
    const pz = cz + Math.sin(a) * d;
    b.cyl('log', 0.1, 0.12, 1.5, 4, px, terrain.heightAt(px, pz), pz, WOOD_DARK);
  }

  b.interact({
    kind: 'shop',
    shop: 'human_general',
    x: cx + 12,
    z: cz + 4,
    y: terrain.heightAt(cx + 12, cz + 4),
    radius: 5,
    label: 'Лавка «Всё для похода»',
    hint: 'торговать',
  });
  b.interact({
    kind: 'prosthetist',
    x: cx - 14,
    z: cz + 10,
    y: terrain.heightAt(cx - 14, cz + 10),
    radius: 5,
    label: 'Протезная мастерская Кулибина',
    hint: 'протезы, коляска, лечение',
  });
  b.interact({
    kind: 'healer',
    x: cx - 4,
    z: cz - 14,
    y: terrain.heightAt(cx - 4, cz - 14),
    radius: 5,
    label: 'Знахарь',
    hint: 'лечиться',
  });
  b.interact({
    kind: 'rest',
    x: cx + 16,
    z: cz - 12,
    y: terrain.heightAt(cx + 16, cz - 12),
    radius: 5,
    label: 'Трактир «Гружёный воз»',
    hint: 'отдохнуть и сохраниться',
  });
  b.interact({
    kind: 'caravanmaster',
    x: cx - 2,
    z: cz + 18,
    y: terrain.heightAt(cx - 2, cz + 18),
    radius: 6,
    label: 'Караванщик Прохор',
    hint: 'узнать про корованы',
  });

  const group = b.build();
  group.name = 'human-village';
  return {
    group,
    colliders: b.colliders,
    interactables: b.interactables,
    exclusion: { x: cx, z: cz, r: 88 },
    spawn: { x: cx, z: cz + 18, y },
  };
}

// ─────────────────────────────── перекрёсток ───────────────────────────────

export function buildCrossroads(terrain) {
  const cx = CROSSROADS.x;
  const cz = CROSSROADS.z;
  const y = terrain.flatten(cx, cz, 22, 18);
  const b = new Builder();

  b.cyl('log', 0.35, 0.4, 7, 6, cx, y, cz, WOOD_DARK);
  b.blockCircle(cx, cz, 0.6, 7, y);
  // Указатели в стороны четырёх зон.
  const signs = [
    { a: Math.atan2(-470, 470), color: 0xc8a12e },
    { a: Math.atan2(430, 430), color: 0x5a9e4a },
    { a: Math.atan2(440, -450), color: 0x3f7f3a },
    { a: Math.atan2(-480, -480), color: 0x5a4a5a },
  ];
  signs.forEach((s, i) => {
    b.add(
      'wood',
      new THREE.BoxGeometry(3.6, 0.7, 0.2),
      trs(cx + Math.cos(s.a) * 1.6, y + 6 - i * 0.9, cz + Math.sin(s.a) * 1.6, 0, -s.a, 0),
      s.color,
    );
  });

  // Кострище и телега на обочине — тут отдыхают корованы.
  b.cyl('stone', 1.4, 1.6, 0.4, 8, cx + 9, y, cz + 7, 0x6b6560);
  b.box('wood', 4.5, 1.2, 2.4, cx + 13, y + 1, cz + 9, WOOD, 0.5);
  for (const ox of [-1.6, 1.6]) {
    b.cyl('log', 1.1, 1.1, 0.35, 10, cx + 13 + ox, y + 1, cz + 9, WOOD_DARK);
  }
  b.blockCircle(cx + 13, cz + 9, 2.6, 2.2, y);

  const group = b.build();
  group.name = 'crossroads';
  return {
    group,
    colliders: b.colliders,
    interactables: b.interactables,
    exclusion: { x: cx, z: cz, r: 24 },
  };
}
