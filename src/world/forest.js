// Лес с переключением уровня детализации.
//
// Это та самая фича из ТЗ: «вдали деревья картинкой, когда подходишь они
// преобразовываются в 3-хмерные деревья».
//
// Как это устроено:
//  1. Для каждой породы строится настоящая 3D-модель (ствол + крона).
//  2. Эта же модель один раз рендерится ортографической камерой в текстуру —
//     получается импостор. Картинка гарантированно совпадает с моделью,
//     потому что она из неё и сделана.
//  3. Дальние деревья рисуются инстансированными билбордами с этой текстурой:
//     весь дальний лес — один вызов отрисовки на породу.
//  4. Ближние деревья — инстансированные настоящие модели.
//  5. Переход: билборд растворяется упорядоченным дизерингом (screen-door).
//     Дизеринг вместо прозрачности выбран специально — он не требует сортировки
//     и не даёт «призраков» поверх уже подставленной 3D-модели.
import * as THREE from 'three';
import { mergeParts, trs } from './geo.js';
import { makeRng } from '../core/utils.js';
import { WORLD_HALF, ZONE, zoneWeights, distanceToRoad, ROAD_WIDTH } from './zones.js';

const IMPOSTOR_SIZE = 256;
const NEAR_CAPACITY = 700; // максимум 3D-деревьев одной породы одновременно

// ─────────────────────────────── модели деревьев ───────────────────────────────

const SPECIES = {
  // Ель: высокая, тёмная, ярусами. Основа густого эльфийского леса.
  pine: {
    trunk: 0x4b3a25,
    build(rng) {
      const parts = [];
      const h = 13 + rng() * 7;
      parts.push({
        geo: new THREE.CylinderGeometry(0.28, 0.62, h, 7),
        matrix: trs(0, h / 2, 0),
        color: 0x4b3a25,
      });
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const y = h * (0.28 + t * 0.66);
        const r = 3.5 * (1 - t * 0.72);
        const ch = 3.6 * (1 - t * 0.4);
        const green = new THREE.Color(0x2f5a24).offsetHSL(0, 0, (rng() - 0.5) * 0.06 + t * 0.05);
        parts.push({ geo: new THREE.ConeGeometry(r, ch, 8), matrix: trs(0, y, 0), color: green });
      }
      return parts;
    },
  },

  // Дуб: толстый ствол, широкая шапка из нескольких сфер.
  oak: {
    trunk: 0x5a4128,
    build(rng) {
      const parts = [];
      const h = 8 + rng() * 4;
      parts.push({
        geo: new THREE.CylinderGeometry(0.5, 0.85, h, 8),
        matrix: trs(0, h / 2, 0),
        color: 0x5a4128,
      });
      // Пара расходящихся веток — силуэт становится узнаваемым.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng();
        parts.push({
          geo: new THREE.CylinderGeometry(0.16, 0.3, 4.2, 5),
          matrix: trs(Math.cos(a) * 1.2, h * 0.82, Math.sin(a) * 1.2, Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55),
          color: 0x543d26,
        });
      }
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + rng() * 0.8;
        const d = i === 0 ? 0 : 2.1 + rng() * 1.3;
        const r = i === 0 ? 3.9 : 2.5 + rng() * 1.2;
        const green = new THREE.Color(0x4a7a2e).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.09);
        parts.push({
          geo: new THREE.SphereGeometry(r, 8, 6),
          matrix: trs(Math.cos(a) * d, h + 1.4 + (rng() - 0.5) * 1.6, Math.sin(a) * d),
          color: green,
        });
      }
      return parts;
    },
  },

  // Берёза: тонкий светлый ствол, лёгкая крона.
  birch: {
    trunk: 0xd8d4c6,
    build(rng) {
      const parts = [];
      const h = 9 + rng() * 4;
      parts.push({
        geo: new THREE.CylinderGeometry(0.3, 0.46, h, 7),
        matrix: trs(0, h / 2, 0),
        color: 0xd8d4c6,
      });
      // Чёрные чёрточки коры.
      for (let i = 0; i < 5; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.5, 0.16, 0.12),
          matrix: trs(0, h * (0.2 + rng() * 0.6), 0.3, 0, rng() * Math.PI * 2, 0),
          color: 0x2a2a28,
        });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + rng();
        const d = i === 0 ? 0 : 1.4 + rng();
        const green = new THREE.Color(0x76a83c).offsetHSL(0, 0, (rng() - 0.5) * 0.1);
        parts.push({
          geo: new THREE.SphereGeometry(i === 0 ? 2.7 : 1.9 + rng(), 8, 6),
          matrix: trs(Math.cos(a) * d, h + 0.9 + rng() * 1.4, Math.sin(a) * d, 0, 0, 0, 1, 1.25, 1),
          color: green,
        });
      }
      return parts;
    },
  },

  // Сухостой: голые ветки. Растёт в горах Злодея.
  dead: {
    trunk: 0x584c40,
    build(rng) {
      const parts = [];
      const h = 7 + rng() * 5;
      parts.push({
        geo: new THREE.CylinderGeometry(0.22, 0.55, h, 6),
        matrix: trs(0, h / 2, 0),
        color: 0x584c40,
      });
      const branches = 6 + Math.floor(rng() * 4);
      for (let i = 0; i < branches; i++) {
        const a = rng() * Math.PI * 2;
        const y = h * (0.42 + rng() * 0.55);
        const len = 2 + rng() * 3;
        const tiltX = Math.cos(a) * (0.5 + rng() * 0.5);
        const tiltZ = -Math.sin(a) * (0.5 + rng() * 0.5);
        parts.push({
          geo: new THREE.CylinderGeometry(0.07, 0.19, len, 5),
          matrix: trs(Math.cos(a) * len * 0.28, y, Math.sin(a) * len * 0.28, tiltX, 0, tiltZ),
          color: 0x4f453b,
        });
      }
      return parts;
    },
  },
};

export const SPECIES_NAMES = Object.keys(SPECIES);

// ─────────────────────────────── выпекание импостора ───────────────────────────────

/**
 * Рендерит модель дерева ортографической камерой в текстуру.
 * Прозрачный фон заливается зеленоватым цветом, а не чёрным: при линейной
 * фильтрации по краям кроны иначе появляется тёмная кайма.
 */
function bakeImpostor(renderer, geometry, size) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  // Анизотропия заметно чистит кроны, разглядываемые под острым углом.
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, mat);
  scene.add(mesh);

  // Освещение бэйка повторяет сцену, чтобы картинка не отличалась от модели.
  scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x5d7346, 1.85));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.0);
  sun.position.set(0.6, 1.0, 0.8).multiplyScalar(100);
  scene.add(sun);

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const height = bb.max.y;
  const width = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * 2;
  const side = Math.max(height, width) * 1.04; // небольшой запас по краям

  const cam = new THREE.OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0.1, side * 4);
  cam.position.set(0, height / 2, side * 1.5);
  cam.lookAt(0, height / 2, 0);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x4a6b30, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  mat.dispose();
  return { texture: rt.texture, side, height };
}

// ─────────────────────────────── шейдер билборда ───────────────────────────────

const BILLBOARD_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  varying vec2 vUv;
  varying float vDist;
  varying float vShade;

  void main() {
    vUv = uv;

    // Позиция и масштаб инстанса достаём прямо из матрицы инстансирования.
    vec3 instPos = instanceMatrix[3].xyz;
    float scale = length(instanceMatrix[0].xyz);

    // Ось билборда — только Y: дерево поворачивается к камере вокруг ствола,
    // но не заваливается, когда игрок смотрит вверх.
    vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));

    float sway = sin(uTime * 0.9 + instPos.x * 0.3 + instPos.z * 0.21) * uSway * uv.y * uv.y;

    vec3 worldPos = instPos
      + camRight * (position.x * scale + sway)
      + vec3(0.0, position.y * scale, 0.0);

    vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
    vDist = -mvPosition.z;
    // Дальние деревья чуть темнее — имитация воздушной перспективы под кроной.
    vShade = 1.0;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BILLBOARD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uLodNear;
  uniform float uLodFade;
  varying vec2 vUv;
  varying float vDist;
  varying float vShade;

  // Упорядоченный дизеринг 4x4 (рекурсивная форма матрицы Байера).
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    vec4 texel = texture2D(uMap, vUv);

    // Мип-уровни усредняют альфу, и вдали крона рассыпалась бы в отдельные точки.
    // Поэтому порог отсечения снижается с расстоянием: силуэт остаётся плотным.
    float cutoff = mix(0.45, 0.12, smoothstep(60.0, 320.0, vDist));
    if (texel.a < cutoff) discard;

    // Растворение вблизи: тут билборд уступает место настоящей 3D-модели.
    float appear = smoothstep(uLodNear, uLodNear + uLodFade, vDist);
    if (appear < 0.999 && appear < bayer4(gl_FragCoord.xy)) discard;

    vec3 color = texel.rgb * vShade;
    float fogFactor = smoothstep(uFogNear, uFogFar, vDist);
    gl_FragColor = vec4(mix(color, uFogColor, fogFactor), 1.0);
  }
`;

// ─────────────────────────────── лес ───────────────────────────────

export class Forest {
  /**
   * @param {THREE.WebGLRenderer} renderer нужен для выпекания импосторов
   * @param {import('./terrain.js').Terrain} terrain
   * @param {Array<{x:number,z:number,r:number}>} exclusions поляны под постройки
   */
  constructor(renderer, terrain, exclusions = [], seed = 20240) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'forest';
    this.lodNear = 62;
    this.lodFade = 16;

    const rng = makeRng(seed);
    this.trees = this._scatter(rng, exclusions);
    this._buildGrid();
    this._buildMeshes(renderer, rng);

    this._lastUpdatePos = new THREE.Vector3(1e9, 0, 1e9);
    this._scratch = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /** Раскидывает деревья по миру с учётом зон, склонов, дорог и полян. */
  _scatter(rng, exclusions) {
    const trees = [];
    const step = 7.5; // шаг сетки посадки; внутри клетки позиция дрожит
    const limit = WORLD_HALF - 30;

    for (let z = -limit; z < limit; z += step) {
      for (let x = -limit; x < limit; x += step) {
        const px = x + (rng() - 0.5) * step * 1.6;
        const pz = z + (rng() - 0.5) * step * 1.6;

        const w = zoneWeights(px, pz);
        // Густота: у эльфов лес стеной, в остальных зонах — редколесье.
        const density =
          w[ZONE.ELVES] * 1.0 + w[ZONE.HUMANS] * 0.16 + w[ZONE.EMPIRE] * 0.12 + w[ZONE.VILLAIN] * 0.2;
        if (rng() > density) continue;

        if (distanceToRoad(px, pz) < ROAD_WIDTH * 1.5) continue;

        const y = this.terrain.heightAt(px, pz);
        if (y > 128) continue; // выше границы леса ничего не растёт
        if (this.terrain.steepnessAt(px, pz) > 0.55) continue;

        let blocked = false;
        for (const ex of exclusions) {
          if ((px - ex.x) ** 2 + (pz - ex.z) ** 2 < ex.r * ex.r) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        trees.push({
          x: px,
          y,
          z: pz,
          species: this._pickSpecies(w, rng),
          scale: 0.75 + rng() * 0.6,
          rot: rng() * Math.PI * 2,
        });
      }
    }
    return trees;
  }

  _pickSpecies(w, rng) {
    const r = rng();
    if (w[ZONE.VILLAIN] > 0.45) return r < 0.72 ? 'dead' : 'pine';
    if (w[ZONE.ELVES] > 0.35) return r < 0.46 ? 'pine' : r < 0.8 ? 'oak' : 'birch';
    if (w[ZONE.EMPIRE] > 0.35) return r < 0.45 ? 'oak' : r < 0.86 ? 'birch' : 'pine';
    return r < 0.55 ? 'oak' : r < 0.9 ? 'birch' : 'pine';
  }

  /** Пространственная сетка: без неё поиск ближних деревьев был бы перебором. */
  _buildGrid() {
    this.cellSize = 40;
    this.grid = new Map();
    this.trees.forEach((t, i) => {
      const key = this._cellKey(t.x, t.z);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    });
  }

  _cellKey(x, z) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  _buildMeshes(renderer, rng) {
    this.species = {};

    for (const name of SPECIES_NAMES) {
      const list = this.trees.filter((t) => t.species === name);
      if (list.length === 0) continue;

      // Одна эталонная модель на породу: разнообразие даёт масштаб и поворот.
      const geometry = mergeParts(SPECIES[name].build(makeRng(name.length * 7919 + 13)));
      const impostor = bakeImpostor(renderer, geometry, IMPOSTOR_SIZE);

      // ── дальний уровень: инстансированные билборды ──
      const quad = new THREE.PlaneGeometry(impostor.side, impostor.side);
      quad.translate(0, impostor.height / 2, 0); // основание квадрата — на земле
      const farMat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: impostor.texture },
          uTime: { value: 0 },
          uSway: { value: name === 'dead' ? 0.04 : 0.16 },
          uFogColor: { value: new THREE.Color(0x8fb3d9) },
          uFogNear: { value: 300 },
          uFogFar: { value: 900 },
          uLodNear: { value: this.lodNear },
          uLodFade: { value: this.lodFade },
        },
        vertexShader: BILLBOARD_VERT,
        fragmentShader: BILLBOARD_FRAG,
        side: THREE.DoubleSide,
      });
      const farMesh = new THREE.InstancedMesh(quad, farMat, list.length);
      farMesh.frustumCulled = false; // билборды двигаются в шейдере
      farMesh.castShadow = false;
      farMesh.receiveShadow = false;

      // ── ближний уровень: настоящие 3D-деревья ──
      const nearMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const nearMesh = new THREE.InstancedMesh(geometry, nearMat, NEAR_CAPACITY);
      nearMesh.frustumCulled = false;
      nearMesh.castShadow = true;
      nearMesh.receiveShadow = true;
      nearMesh.count = 0;
      nearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const m = new THREE.Matrix4();
      list.forEach((tree, i) => {
        m.compose(
          new THREE.Vector3(tree.x, tree.y, tree.z),
          new THREE.Quaternion(),
          new THREE.Vector3(tree.scale, tree.scale, tree.scale),
        );
        farMesh.setMatrixAt(i, m);
      });
      farMesh.instanceMatrix.needsUpdate = true;

      this.group.add(farMesh, nearMesh);
      this.species[name] = { farMesh, nearMesh, geometry, list };
    }
  }

  setLodDistance(near) {
    this.lodNear = near;
    for (const name of Object.keys(this.species)) {
      this.species[name].farMesh.material.uniforms.uLodNear.value = near;
    }
    this._lastUpdatePos.set(1e9, 0, 1e9); // заставляем пересобрать ближний список
  }

  /** Синхронизирует туман билбордов с туманом сцены. */
  syncFog(fog) {
    for (const name of Object.keys(this.species)) {
      const u = this.species[name].farMesh.material.uniforms;
      u.uFogColor.value.copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    }
  }

  /**
   * Пересобирает набор ближних 3D-деревьев. Вызывается не каждый кадр,
   * а когда игрок заметно сместился — список меняется медленно.
   */
  update(playerPos, time) {
    for (const name of Object.keys(this.species)) {
      this.species[name].farMesh.material.uniforms.uTime.value = time;
    }

    if (playerPos.distanceToSquared(this._lastUpdatePos) < 4) return;
    this._lastUpdatePos.copy(playerPos);

    const radius = this.lodNear + this.lodFade;
    const radiusSq = radius * radius;
    const counts = {};
    for (const name of Object.keys(this.species)) counts[name] = 0;

    const c0x = Math.floor((playerPos.x - radius) / this.cellSize);
    const c1x = Math.floor((playerPos.x + radius) / this.cellSize);
    const c0z = Math.floor((playerPos.z - radius) / this.cellSize);
    const c1z = Math.floor((playerPos.z + radius) / this.cellSize);

    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const bucket = this.grid.get(`${cx},${cz}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const t = this.trees[idx];
          const dx = t.x - playerPos.x;
          const dz = t.z - playerPos.z;
          if (dx * dx + dz * dz > radiusSq) continue;

          const entry = this.species[t.species];
          const n = counts[t.species];
          if (n >= NEAR_CAPACITY) continue;

          this._v.set(t.x, t.y, t.z);
          this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
          this._s.set(t.scale, t.scale, t.scale);
          this._scratch.compose(this._v, this._q, this._s);
          entry.nearMesh.setMatrixAt(n, this._scratch);
          counts[t.species] = n + 1;
        }
      }
    }

    for (const name of Object.keys(this.species)) {
      const mesh = this.species[name].nearMesh;
      mesh.count = counts[name];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Отталкивает точку от стволов поблизости.
   * @returns {boolean} двигали ли позицию
   */
  collide(pos, radius) {
    const reach = 12;
    let moved = false;
    const c0x = Math.floor((pos.x - reach) / this.cellSize);
    const c1x = Math.floor((pos.x + reach) / this.cellSize);
    const c0z = Math.floor((pos.z - reach) / this.cellSize);
    const c1z = Math.floor((pos.z + reach) / this.cellSize);

    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const bucket = this.grid.get(`${cx},${cz}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const t = this.trees[idx];
          const trunk = (t.species === 'oak' ? 0.9 : t.species === 'pine' ? 0.65 : 0.45) * t.scale;
          const min = trunk + radius;
          const dx = pos.x - t.x;
          const dz = pos.z - t.z;
          const dSq = dx * dx + dz * dz;
          if (dSq >= min * min || dSq < 1e-6) continue;
          const d = Math.sqrt(dSq);
          pos.x = t.x + (dx / d) * min;
          pos.z = t.z + (dz / d) * min;
          moved = true;
        }
      }
    }
    return moved;
  }

  get treeCount() {
    return this.trees.length;
  }

  /** Сколько 3D-деревьев отрисовано прямо сейчас — показываем в отладке. */
  get nearCount() {
    let n = 0;
    for (const name of Object.keys(this.species)) n += this.species[name].nearMesh.count;
    return n;
  }
}
