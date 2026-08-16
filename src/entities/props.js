// Мелкие объекты: оружие в руке, стрелы, лужи крови, повозки корованов.
import * as THREE from 'three';
import { mergeParts, trs } from '../world/geo.js';
import { bloodSplat, woodPlanks, cloth } from '../world/textures.js';

let propMaterial = null;
function propMat() {
  if (!propMaterial) propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  return propMaterial;
}

const weaponCache = new Map();

/**
 * Модель оружия для руки. Клинок уходит вниз от кисти — при замахе рука
 * заносит его над головой, а при ударе он идёт вперёд и вниз.
 */
export function makeWeaponMesh(id) {
  if (weaponCache.has(id)) return weaponCache.get(id).clone();

  const parts = [];
  const STEEL = 0xc9ced8;
  const DARK_STEEL = 0x6e6a72;
  const WOOD = 0x6b4f2f;
  const GOLD = 0xc8a12e;

  const bladeSword = (len, width, color) => {
    parts.push({ geo: new THREE.BoxGeometry(0.06, 0.16, 0.1), matrix: trs(0, -0.06, 0), color: WOOD });
    parts.push({ geo: new THREE.BoxGeometry(0.26, 0.05, 0.09), matrix: trs(0, -0.16, 0), color: GOLD });
    parts.push({ geo: new THREE.BoxGeometry(width, len, 0.035), matrix: trs(0, -0.18 - len / 2, 0), color });
    parts.push({
      geo: new THREE.ConeGeometry(width * 0.72, 0.16, 4),
      matrix: trs(0, -0.18 - len - 0.06, 0, Math.PI, 0, 0),
      color,
    });
  };

  const bladeAxe = (color) => {
    parts.push({ geo: new THREE.CylinderGeometry(0.035, 0.04, 0.95, 6), matrix: trs(0, -0.42, 0), color: WOOD });
    parts.push({ geo: new THREE.BoxGeometry(0.05, 0.3, 0.26), matrix: trs(0, -0.78, 0.1), color });
    parts.push({
      geo: new THREE.ConeGeometry(0.17, 0.3, 3),
      matrix: trs(0, -0.78, 0.26, Math.PI / 2, 0, Math.PI / 2),
      color,
    });
  };

  const bow = (size, color) => {
    // Дуга лука из нескольких сегментов + тетива.
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      const t = i / (seg - 1) - 0.5;
      const a = t * 2.1;
      parts.push({
        geo: new THREE.BoxGeometry(0.05, size / seg + 0.03, 0.05),
        matrix: trs(0, -0.35 + t * size, Math.cos(a) * 0.16 - 0.16, a * 0.5, 0, 0),
        color,
      });
    }
    parts.push({ geo: new THREE.BoxGeometry(0.015, size * 0.98, 0.015), matrix: trs(0, -0.35, 0.02), color: 0xe8e2d0 });
  };

  switch (id) {
    case 'dagger':
      bladeSword(0.34, 0.07, STEEL);
      break;
    case 'sword':
      bladeSword(0.78, 0.09, STEEL);
      break;
    case 'elfblade':
      bladeSword(0.82, 0.075, 0xd8e8d0);
      break;
    case 'greatsword':
      bladeSword(1.12, 0.13, STEEL);
      break;
    case 'axe':
      bladeAxe(STEEL);
      break;
    case 'darkaxe':
      bladeAxe(DARK_STEEL);
      break;
    case 'shortbow':
      bow(1.0, 0x7a5a34);
      break;
    case 'longbow':
      bow(1.35, 0x9b8a5a);
      break;
    case 'crossbow':
      parts.push({ geo: new THREE.BoxGeometry(0.1, 0.62, 0.09), matrix: trs(0, -0.42, 0), color: WOOD });
      parts.push({ geo: new THREE.BoxGeometry(0.8, 0.06, 0.06), matrix: trs(0, -0.62, 0.05), color: DARK_STEEL });
      parts.push({ geo: new THREE.BoxGeometry(0.78, 0.015, 0.015), matrix: trs(0, -0.5, 0.05), color: 0xe8e2d0 });
      break;
    default:
      return null;
  }

  const mesh = new THREE.Mesh(mergeParts(parts), propMat());
  mesh.castShadow = true;
  weaponCache.set(id, mesh);
  return mesh.clone();
}

let arrowGeo = null;
let arrowMat = null;
/** Летящая стрела. */
export function makeArrowMesh() {
  if (!arrowGeo) {
    arrowGeo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.014, 0.014, 0.75, 5), matrix: trs(0, 0, 0), color: 0x8a6a3a },
      { geo: new THREE.ConeGeometry(0.035, 0.11, 5), matrix: trs(0, 0.4, 0), color: 0xb8bcc4 },
      { geo: new THREE.BoxGeometry(0.005, 0.14, 0.09), matrix: trs(0, -0.3, 0), color: 0xe8e2d0 },
      { geo: new THREE.BoxGeometry(0.09, 0.14, 0.005), matrix: trs(0, -0.3, 0), color: 0xe8e2d0 },
    ]);
    // Геометрия строится вдоль Y, а летит стрела вдоль своей оси Z.
    arrowGeo.rotateX(Math.PI / 2);
    arrowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  const m = new THREE.Mesh(arrowGeo, arrowMat);
  m.castShadow = true;
  return m;
}

let decalGeo = null;
let decalMat = null;
/** Пятно крови на земле — кладётся плоско под трупом или культёй. */
export function makeBloodDecal(size = 1.6) {
  if (!decalGeo) {
    decalGeo = new THREE.PlaneGeometry(1, 1);
    decalGeo.rotateX(-Math.PI / 2);
    decalMat = new THREE.MeshBasicMaterial({
      map: bloodSplat(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
  }
  const m = new THREE.Mesh(decalGeo, decalMat);
  m.scale.setScalar(size);
  m.renderOrder = 2;
  return m;
}

let cartMaterials = null;
/**
 * Повозка корована: короб, тент, колёса.
 * @param {number} tentColor цвет тента — по нему видно, чей это корован
 */
export function makeCartMesh(tentColor) {
  if (!cartMaterials) {
    cartMaterials = {
      wood: new THREE.MeshLambertMaterial({ map: woodPlanks(), vertexColors: true }),
      cloth: new THREE.MeshLambertMaterial({ map: cloth('#ffffff', 'cart'), vertexColors: true }),
    };
  }
  const group = new THREE.Group();

  const wood = mergeParts([
    { geo: new THREE.BoxGeometry(2.2, 0.9, 4.2), matrix: trs(0, 1.0, 0), color: 0xa8834f, uvScale: 2 },
    { geo: new THREE.BoxGeometry(0.25, 0.25, 3.0), matrix: trs(0, 0.55, 2.9), color: 0x6b4f2f }, // дышло
    { geo: new THREE.BoxGeometry(2.4, 0.2, 0.25), matrix: trs(0, 0.55, 4.2), color: 0x6b4f2f },
  ]);
  const woodMesh = new THREE.Mesh(wood, cartMaterials.wood);
  woodMesh.castShadow = true;
  group.add(woodMesh);

  // Колёса.
  const wheelParts = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheelParts.push({
        geo: new THREE.CylinderGeometry(0.62, 0.62, 0.16, 12),
        matrix: trs(sx * 1.2, 0.62, sz * 1.4, 0, 0, Math.PI / 2),
        color: 0x5a4128,
      });
    }
  }
  const wheels = new THREE.Mesh(mergeParts(wheelParts), cartMaterials.wood);
  wheels.castShadow = true;
  group.add(wheels);

  // Тент дугами.
  const tentParts = [];
  for (let i = 0; i < 5; i++) {
    const z = -1.7 + i * 0.85;
    for (let a = 0; a <= 6; a++) {
      const ang = (a / 6) * Math.PI;
      tentParts.push({
        geo: new THREE.BoxGeometry(0.34, 0.16, 0.9),
        matrix: trs(Math.cos(ang) * 1.05, 1.45 + Math.sin(ang) * 1.05, z, 0, 0, -ang),
        color: tentColor,
      });
    }
  }
  const tent = new THREE.Mesh(mergeParts(tentParts), cartMaterials.cloth);
  tent.castShadow = true;
  group.add(tent);

  return group;
}

/** Вьючный вол, который тянет повозку. */
export function makeOxMesh() {
  const parts = [
    { geo: new THREE.BoxGeometry(0.9, 0.95, 2.0), matrix: trs(0, 1.05, 0), color: 0x6b5340 },
    { geo: new THREE.BoxGeometry(0.62, 0.6, 0.7), matrix: trs(0, 1.15, 1.25), color: 0x5a4638 },
    { geo: new THREE.ConeGeometry(0.08, 0.34, 5), matrix: trs(-0.26, 1.5, 1.25, 0, 0, 0.8), color: 0xd8d0c0 },
    { geo: new THREE.ConeGeometry(0.08, 0.34, 5), matrix: trs(0.26, 1.5, 1.25, 0, 0, -0.8), color: 0xd8d0c0 },
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geo: new THREE.BoxGeometry(0.22, 1.0, 0.22),
        matrix: trs(sx * 0.32, 0.5, sz * 0.7),
        color: 0x4a3a2e,
      });
    }
  }
  const mesh = new THREE.Mesh(mergeParts(parts), propMat());
  mesh.castShadow = true;
  return mesh;
}
