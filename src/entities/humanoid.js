// Процедурная 3D-модель человека/эльфа/злодейского бойца.
//
// Конечности собраны отдельными узлами на шарнирах. Это сделано ради главного:
// руку, ногу или голову можно снять с модели и уронить на землю — именно так
// работает отрубание конечностей.
import * as THREE from 'three';
import { mergeParts, trs } from '../world/geo.js';

export const PART = {
  HEAD: 'head',
  TORSO: 'torso',
  ARM_L: 'armL',
  ARM_R: 'armR',
  LEG_L: 'legL',
  LEG_R: 'legR',
};

/** Части, которые можно отрубить (торс — нет, это смерть). */
export const SEVERABLE = [PART.ARM_L, PART.ARM_R, PART.LEG_L, PART.LEG_R];

export const HEIGHT = 1.85;
const HIP_Y = 0.95;
const SHOULDER_Y = 1.45;

let sharedMaterial = null;
function bodyMaterial() {
  if (!sharedMaterial) sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  return sharedMaterial;
}

/** Готовые «внешности» для фракций. */
export const LOOKS = {
  elf: {
    skin: 0xe6c9a8,
    cloth: 0x3f6b35,
    cloth2: 0x6b5333,
    metal: 0x8a8f7a,
    hair: 0xd8c07a,
    ears: true,
    helm: 'hood',
    cape: 0x2f5228,
    build: 0.9,
  },
  guard: {
    skin: 0xdcae86,
    cloth: 0x9b2f2f,
    cloth2: 0x4a4a52,
    metal: 0xa8adb8,
    hair: 0x4a3a2a,
    ears: false,
    helm: 'guard',
    cape: 0x8f2626,
    build: 1.08,
  },
  villain: {
    skin: 0xb59a83,
    cloth: 0x2e2733,
    cloth2: 0x1d1a22,
    metal: 0x5c5560,
    hair: 0x1a1a1a,
    ears: false,
    helm: 'horned',
    cape: 0x241d2b,
    build: 1.12,
  },
  human: {
    skin: 0xe0b48c,
    cloth: 0x8b7355,
    cloth2: 0x6b5a45,
    metal: 0x8a8a8a,
    hair: 0x5a4028,
    ears: false,
    helm: 'none',
    cape: null,
    build: 1.0,
  },
};

function limbGeometry(parts) {
  return mergeParts(parts);
}

/**
 * Собирает модель.
 * @returns {{root: THREE.Group, joints: Object, parts: Object, weaponSlot: THREE.Object3D}}
 */
export function createHumanoid(look) {
  const L = look;
  const mat = bodyMaterial();
  const root = new THREE.Group();
  const joints = {};
  const parts = {};

  const mesh = (geo) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // ── торс ──
  const torsoParts = [
    { geo: new THREE.BoxGeometry(0.54, 0.58, 0.3), matrix: trs(0, 1.24, 0), color: L.cloth },
    { geo: new THREE.BoxGeometry(0.58, 0.16, 0.34), matrix: trs(0, 1.46, 0), color: L.metal }, // наплечники
    { geo: new THREE.BoxGeometry(0.5, 0.2, 0.32), matrix: trs(0, 0.98, 0), color: L.cloth2 }, // пояс
    { geo: new THREE.BoxGeometry(0.14, 0.4, 0.32), matrix: trs(0, 1.24, 0.01), color: L.cloth2 }, // застёжка
  ];
  if (L.cape) {
    torsoParts.push({
      geo: new THREE.BoxGeometry(0.5, 0.72, 0.06),
      matrix: trs(0, 1.16, -0.19),
      color: L.cape,
    });
  }
  const torso = mesh(limbGeometry(torsoParts));
  torso.name = PART.TORSO;
  root.add(torso);
  parts[PART.TORSO] = torso;
  joints[PART.TORSO] = root;

  // ── голова на шейном шарнире ──
  const neck = new THREE.Group();
  neck.position.set(0, SHOULDER_Y + 0.06, 0);
  const headParts = [
    { geo: new THREE.BoxGeometry(0.1, 0.12, 0.1), matrix: trs(0, 0.04, 0), color: L.skin },
    { geo: new THREE.BoxGeometry(0.26, 0.28, 0.26), matrix: trs(0, 0.24, 0), color: L.skin },
    { geo: new THREE.BoxGeometry(0.27, 0.1, 0.27), matrix: trs(0, 0.36, 0), color: L.hair },
    // глаза — по ним видно, куда смотрит противник
    { geo: new THREE.BoxGeometry(0.05, 0.05, 0.03), matrix: trs(-0.07, 0.26, 0.14), color: 0x2a2a2a },
    { geo: new THREE.BoxGeometry(0.05, 0.05, 0.03), matrix: trs(0.07, 0.26, 0.14), color: 0x2a2a2a },
  ];
  if (L.ears) {
    for (const s of [-1, 1]) {
      headParts.push({
        geo: new THREE.ConeGeometry(0.05, 0.22, 4),
        matrix: trs(s * 0.15, 0.3, -0.02, 0, 0, -s * 0.5),
        color: L.skin,
      });
    }
  }
  if (L.helm === 'guard') {
    headParts.push({ geo: new THREE.BoxGeometry(0.3, 0.2, 0.3), matrix: trs(0, 0.34, 0), color: L.metal });
    headParts.push({ geo: new THREE.BoxGeometry(0.06, 0.22, 0.06), matrix: trs(0, 0.26, 0.15), color: L.metal });
    headParts.push({ geo: new THREE.ConeGeometry(0.09, 0.18, 6), matrix: trs(0, 0.51, 0), color: 0xc8a12e });
  } else if (L.helm === 'horned') {
    headParts.push({ geo: new THREE.BoxGeometry(0.31, 0.24, 0.31), matrix: trs(0, 0.32, 0), color: L.metal });
    for (const s of [-1, 1]) {
      headParts.push({
        geo: new THREE.ConeGeometry(0.06, 0.3, 5),
        matrix: trs(s * 0.17, 0.42, 0, 0, 0, s * 0.9),
        color: 0xd8d0c0,
      });
    }
  } else if (L.helm === 'hood') {
    headParts.push({ geo: new THREE.BoxGeometry(0.32, 0.24, 0.3), matrix: trs(0, 0.34, -0.02), color: L.cloth });
    headParts.push({ geo: new THREE.BoxGeometry(0.3, 0.2, 0.1), matrix: trs(0, 0.2, -0.16), color: L.cloth });
  }
  const head = mesh(limbGeometry(headParts));
  head.name = PART.HEAD;
  neck.add(head);
  root.add(neck);
  joints[PART.HEAD] = neck;
  parts[PART.HEAD] = head;

  // ── руки ──
  let weaponSlot = null;
  for (const side of [-1, 1]) {
    const key = side < 0 ? PART.ARM_L : PART.ARM_R;
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.35, SHOULDER_Y, 0);
    const armParts = [
      { geo: new THREE.BoxGeometry(0.16, 0.36, 0.18), matrix: trs(0, -0.18, 0), color: L.cloth },
      { geo: new THREE.BoxGeometry(0.14, 0.34, 0.16), matrix: trs(0, -0.53, 0), color: L.skin },
      { geo: new THREE.BoxGeometry(0.17, 0.1, 0.19), matrix: trs(0, -0.7, 0), color: L.cloth2 }, // кисть
    ];
    const arm = mesh(limbGeometry(armParts));
    arm.name = key;
    pivot.add(arm);
    root.add(pivot);
    joints[key] = pivot;
    parts[key] = arm;

    if (side > 0) {
      weaponSlot = new THREE.Object3D();
      weaponSlot.position.set(0, -0.72, 0.06);
      pivot.add(weaponSlot);
    }
  }

  // ── ноги ──
  for (const side of [-1, 1]) {
    const key = side < 0 ? PART.LEG_L : PART.LEG_R;
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.15, HIP_Y, 0);
    const legParts = [
      { geo: new THREE.BoxGeometry(0.2, 0.48, 0.22), matrix: trs(0, -0.24, 0), color: L.cloth2 },
      { geo: new THREE.BoxGeometry(0.18, 0.4, 0.2), matrix: trs(0, -0.68, 0), color: L.cloth2 },
      { geo: new THREE.BoxGeometry(0.2, 0.1, 0.3), matrix: trs(0, -0.9, 0.05), color: 0x3a2c1d }, // сапог
    ];
    const leg = mesh(limbGeometry(legParts));
    leg.name = key;
    pivot.add(leg);
    root.add(pivot);
    joints[key] = pivot;
    parts[key] = leg;
  }

  root.scale.setScalar(L.build ?? 1);
  return { root, joints, parts, weaponSlot };
}

/** Простая процедурная анимация: ходьба, покой, замах, ползание. */
export function animateHumanoid(model, state, dt) {
  const { joints } = model;
  const t = state.animTime;

  const swing = (key, angle) => {
    const j = joints[key];
    if (j && j.parent) j.rotation.x = angle;
  };

  if (state.crawling) {
    // Ползком: корпус завален вперёд, руки подтягивают тело.
    model.root.rotation.x = -1.15;
    model.root.position.y = state.groundY + 0.35;
    const c = Math.sin(t * 6) * 0.7;
    swing(PART.ARM_L, c - 0.9);
    swing(PART.ARM_R, -c - 0.9);
    swing(PART.LEG_L, 0.25);
    swing(PART.LEG_R, 0.25);
    return;
  }

  model.root.rotation.x = 0;

  if (state.speed > 0.4) {
    const freq = state.wheelchair ? 5 : 8.5;
    const amp = Math.min(0.65, 0.22 + state.speed * 0.07);
    const s = Math.sin(t * freq) * amp;
    if (!state.wheelchair) {
      swing(PART.LEG_L, s);
      swing(PART.LEG_R, -s);
    } else {
      swing(PART.LEG_L, -1.35);
      swing(PART.LEG_R, -1.35);
    }
    if (!state.attacking) {
      swing(PART.ARM_L, -s * 0.75);
      swing(PART.ARM_R, s * 0.75);
    }
    // Лёгкое покачивание при ходьбе.
    model.root.rotation.z = Math.sin(t * freq) * 0.03;
  } else {
    const idle = Math.sin(t * 1.6) * 0.05;
    swing(PART.LEG_L, 0);
    swing(PART.LEG_R, 0);
    if (!state.attacking) {
      swing(PART.ARM_L, idle);
      swing(PART.ARM_R, -idle);
    }
    model.root.rotation.z = 0;
  }

  // Замах перекрывает обычную анимацию правой руки.
  // Модель смотрит в +Z, поэтому положительный поворот плеча уводит руку назад
  // (замах), а отрицательный — вперёд и вниз (сам удар).
  if (state.attacking) {
    const p = state.attackProgress; // 0..1
    const a = p < 0.35 ? 2.2 * (p / 0.35) : 2.2 - 3.4 * ((p - 0.35) / 0.65);
    swing(PART.ARM_R, a);
    swing(PART.ARM_L, -0.3);
  }

  if (joints[PART.HEAD]) joints[PART.HEAD].rotation.x = state.headPitch || 0;
}

/**
 * Снимает конечность с модели и возвращает её как самостоятельный объект,
 * который можно уронить на землю.
 */
export function detachLimb(model, partKey) {
  const joint = model.joints[partKey];
  if (!joint || !joint.parent) return null;
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  joint.getWorldPosition(worldPos);
  joint.getWorldQuaternion(worldQuat);

  joint.parent.remove(joint);

  const holder = new THREE.Group();
  holder.position.copy(worldPos);
  holder.quaternion.copy(worldQuat);
  holder.scale.copy(model.root.scale);
  joint.position.set(0, 0, 0);
  joint.rotation.set(0, 0, 0);
  holder.add(joint);
  return holder;
}

/**
 * Есть ли конечность на модели.
 * Проверяем именно принадлежность корню: отрубленная рука остаётся объектом
 * с родителем — но родитель у неё уже падающий обломок, а не тело.
 */
export function hasLimb(model, partKey) {
  const j = model.joints[partKey];
  if (!j) return false;
  for (let node = j.parent; node; node = node.parent) {
    if (node === model.root) return true;
  }
  return false;
}

/**
 * Ставит протез на место отрубленной конечности.
 * Деревянный — грубая култышка, стальной — аккуратный механизм.
 * @returns {?THREE.Object3D} новый шарнир конечности
 */
export function attachProstheticLimb(model, partKey, quality = 1) {
  if (hasLimb(model, partKey)) return null;
  const steel = quality >= 1;
  const metal = steel ? 0xb0b6c0 : 0x8a6b45;
  const strap = 0x4a3a28;

  const pivot = new THREE.Group();
  const isArm = partKey === PART.ARM_L || partKey === PART.ARM_R;
  const side = partKey === PART.ARM_L || partKey === PART.LEG_L ? -1 : 1;

  const parts = [];
  if (isArm) {
    pivot.position.set(side * 0.35, SHOULDER_Y, 0);
    parts.push({ geo: new THREE.BoxGeometry(0.17, 0.14, 0.19), matrix: trs(0, -0.06, 0), color: strap });
    parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.09, 0.55, 8), matrix: trs(0, -0.4, 0), color: metal });
    if (steel) {
      // Стальная кисть-клешня: ею можно держать оружие.
      parts.push({ geo: new THREE.BoxGeometry(0.15, 0.12, 0.17), matrix: trs(0, -0.71, 0), color: metal });
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.16, 0.05), matrix: trs(-0.05, -0.8, 0.04), color: metal });
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.16, 0.05), matrix: trs(0.05, -0.8, 0.04), color: metal });
    } else {
      // Деревянный — просто крюк.
      parts.push({ geo: new THREE.TorusGeometry(0.09, 0.025, 6, 10, Math.PI * 1.4), matrix: trs(0, -0.76, 0, Math.PI / 2, 0, 0), color: 0x9aa0aa });
    }
  } else {
    pivot.position.set(side * 0.15, HIP_Y, 0);
    parts.push({ geo: new THREE.BoxGeometry(0.21, 0.16, 0.23), matrix: trs(0, -0.08, 0), color: strap });
    if (steel) {
      parts.push({ geo: new THREE.CylinderGeometry(0.08, 0.07, 0.44, 8), matrix: trs(0, -0.38, 0), color: metal });
      parts.push({ geo: new THREE.SphereGeometry(0.09, 8, 6), matrix: trs(0, -0.6, 0), color: 0x6a707a });
      parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.06, 0.34, 8), matrix: trs(0, -0.78, 0), color: metal });
      parts.push({ geo: new THREE.BoxGeometry(0.19, 0.09, 0.3), matrix: trs(0, -0.95, 0.05), color: 0x3a2c1d });
    } else {
      // Деревянная нога-колышек.
      parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.055, 0.86, 8), matrix: trs(0, -0.52, 0), color: metal });
      parts.push({ geo: new THREE.CylinderGeometry(0.13, 0.13, 0.08, 8), matrix: trs(0, -0.94, 0), color: 0x5a4128 });
    }
  }

  const mesh = new THREE.Mesh(limbGeometry(parts), bodyMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `${partKey}_prosthetic`;
  pivot.add(mesh);
  model.root.add(pivot);
  model.joints[partKey] = pivot;
  model.parts[partKey] = mesh;

  // На правой руке заново создаём гнездо для оружия.
  if (partKey === PART.ARM_R) {
    const slot = new THREE.Object3D();
    slot.position.set(0, -0.72, 0.06);
    pivot.add(slot);
    model.weaponSlot = slot;
  }
  return pivot;
}
