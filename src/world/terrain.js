// Процедурный ландшафт.
//
// Высоты считаются один раз в сетку, а меш строится из неё же. Благодаря этому
// игрок стоит ровно на видимой поверхности: и физика, и графика читают один массив.
import * as THREE from 'three';
import { fbm, clamp, lerp, smoothstep, invLerp } from '../core/utils.js';
import { WORLD_SIZE, WORLD_HALF, ZONE, zoneWeights, distanceToRoad, ROAD_WIDTH } from './zones.js';
import { groundDetail } from './textures.js';

export const GRID = 257; // вершин по стороне
const CELL = WORLD_SIZE / (GRID - 1);

const COLOR_GRASS = new THREE.Color(0x6f9448);
const COLOR_FOREST = new THREE.Color(0x3c5c2c);
const COLOR_ROCK = new THREE.Color(0x6a6560);
const COLOR_SNOW = new THREE.Color(0xd8dde4);
const COLOR_ROAD = new THREE.Color(0x8b7a5c);
const COLOR_FIELD = new THREE.Color(0x86994b);
const COLOR_DARK = new THREE.Color(0x4a4a3f);

export class Terrain {
  constructor() {
    this.heights = new Float32Array(GRID * GRID);
    this.colors = new Float32Array(GRID * GRID * 3);
    this._build();
    this.mesh = this._makeMesh();
  }

  /** Сырая функция высоты до сглаживания дорогами. */
  _rawHeight(x, z) {
    const w = zoneWeights(x, z);

    // Общий холмистый рельеф.
    let h = (fbm(x * 0.0016, z * 0.0016, 4) - 0.5) * 30;
    h += (fbm(x * 0.0068, z * 0.0068, 3) - 0.5) * 7;

    // Горы Злодея: резкие хребты, тем выше, чем глубже в зону.
    const mtn = w[ZONE.VILLAIN];
    if (mtn > 0.02) {
      const ridge = 1 - Math.abs(fbm(x * 0.0022, z * 0.0022, 5) - 0.5) * 2;
      const peaks = Math.pow(ridge, 2.1) * 165;
      h += peaks * Math.pow(mtn, 1.35);
      h += (fbm(x * 0.011, z * 0.011, 3) - 0.5) * 12 * mtn;
    }

    // Дворец стоит на ровном плато — иначе стены встанут криво.
    const emp = w[ZONE.EMPIRE];
    if (emp > 0.02) h = lerp(h, 16, Math.pow(emp, 1.5) * 0.85);

    // Земли людей — пологие поля.
    const hum = w[ZONE.HUMANS];
    if (hum > 0.02) h = lerp(h, 6 + (fbm(x * 0.004, z * 0.004, 2) - 0.5) * 9, Math.pow(hum, 1.4) * 0.8);

    // Лес эльфов — мягкие всхолмления.
    const elv = w[ZONE.ELVES];
    if (elv > 0.02) h = lerp(h, 10 + (fbm(x * 0.005, z * 0.005, 3) - 0.5) * 16, Math.pow(elv, 1.3) * 0.7);

    // Край карты приподнят валом, чтобы мир выглядел замкнутым.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    if (edge > 0.86) h += Math.pow(invLerp(0.86, 1.0, edge), 2) * 120;

    return h;
  }

  _build() {
    const raw = new Float32Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) {
      const z = -WORLD_HALF + j * CELL;
      for (let i = 0; i < GRID; i++) {
        const x = -WORLD_HALF + i * CELL;
        raw[j * GRID + i] = this._rawHeight(x, z);
      }
    }

    // Дороги: выравниваем полосу под ними к локальной средней высоте.
    for (let j = 0; j < GRID; j++) {
      const z = -WORLD_HALF + j * CELL;
      for (let i = 0; i < GRID; i++) {
        const x = -WORLD_HALF + i * CELL;
        const idx = j * GRID + i;
        const d = distanceToRoad(x, z);
        if (d < ROAD_WIDTH * 3.2) {
          // Средняя высота окрестности — дорога идёт плавно, без ступеней.
          let sum = 0;
          let n = 0;
          for (let dj = -2; dj <= 2; dj++) {
            for (let di = -2; di <= 2; di++) {
              const jj = clamp(j + dj, 0, GRID - 1);
              const ii = clamp(i + di, 0, GRID - 1);
              sum += raw[jj * GRID + ii];
              n++;
            }
          }
          const flat = sum / n;
          const t = 1 - smoothstep(clamp(d / (ROAD_WIDTH * 3.2), 0, 1));
          raw[idx] = lerp(raw[idx], flat, t * 0.9);
        }
      }
    }

    this.heights.set(raw);
    this._paint();
  }

  /** Раскраска вершин: трава, лес, камень, снег, дороги. */
  _paint() {
    const c = new THREE.Color();
    for (let j = 0; j < GRID; j++) {
      const z = -WORLD_HALF + j * CELL;
      for (let i = 0; i < GRID; i++) {
        const x = -WORLD_HALF + i * CELL;
        const idx = j * GRID + i;
        const h = this.heights[idx];
        const w = zoneWeights(x, z);

        c.copy(COLOR_GRASS);
        c.lerp(COLOR_FOREST, clamp(w[ZONE.ELVES] * 1.5, 0, 1));
        c.lerp(COLOR_FIELD, clamp(w[ZONE.HUMANS] * 0.9, 0, 1));
        c.lerp(COLOR_DARK, clamp(w[ZONE.VILLAIN] * 0.75, 0, 1));

        // Камень на крутых склонах и на высоте.
        const slope = this._slopeAt(i, j);
        c.lerp(COLOR_ROCK, clamp(slope * 2.6, 0, 0.92));
        if (h > 95) c.lerp(COLOR_ROCK, invLerp(95, 130, h) * 0.8);
        if (h > 138) c.lerp(COLOR_SNOW, invLerp(138, 175, h));

        // Дорога поверх всего.
        const d = distanceToRoad(x, z);
        if (d < ROAD_WIDTH) {
          c.lerp(COLOR_ROAD, 1 - smoothstep(clamp(d / ROAD_WIDTH, 0, 1)) * 0.35);
        }

        // Лёгкая рябь, чтобы большие полигоны не выглядели пластиковыми.
        const n = 0.9 + fbm(x * 0.03, z * 0.03, 2) * 0.2;
        this.colors[idx * 3] = c.r * n;
        this.colors[idx * 3 + 1] = c.g * n;
        this.colors[idx * 3 + 2] = c.b * n;
      }
    }
  }

  _slopeAt(i, j) {
    const i0 = clamp(i - 1, 0, GRID - 1);
    const i1 = clamp(i + 1, 0, GRID - 1);
    const j0 = clamp(j - 1, 0, GRID - 1);
    const j1 = clamp(j + 1, 0, GRID - 1);
    const dx = (this.heights[j * GRID + i1] - this.heights[j * GRID + i0]) / (2 * CELL);
    const dz = (this.heights[j1 * GRID + i] - this.heights[j0 * GRID + i]) / (2 * CELL);
    return Math.hypot(dx, dz);
  }

  _makeMesh() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2); // из XY-плоскости в XZ
    const pos = geo.getAttribute('position');
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        pos.setY(j * GRID + i, this.heights[j * GRID + i]);
      }
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.computeVertexNormals();

    const detail = groundDetail();
    detail.repeat.set(160, 160);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** Высота поверхности в мировых координатах (билинейная выборка сетки). */
  heightAt(x, z) {
    const fx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 1.001);
    const fz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.heights[j * GRID + i];
    const h10 = this.heights[j * GRID + i + 1];
    const h01 = this.heights[(j + 1) * GRID + i];
    const h11 = this.heights[(j + 1) * GRID + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Нормаль поверхности — по ней ограничиваем подъём на крутые склоны. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = CELL * 0.5;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Крутизна склона от 0 (плоско) до 1 (стена). */
  steepnessAt(x, z) {
    const n = this.normalAt(x, z);
    return 1 - clamp(n.y, 0, 1);
  }

  /** Плоская ли площадка — проверка перед постановкой постройки. */
  isFlatArea(x, z, radius, tolerance = 3.5) {
    const h = this.heightAt(x, z);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const hh = this.heightAt(x + Math.cos(ang) * radius, z + Math.sin(ang) * radius);
      if (Math.abs(hh - h) > tolerance) return false;
    }
    return true;
  }

  /**
   * Продавливает ровную площадку под постройку и перестраивает меш.
   * Вызывается до создания зданий, поэтому меш обновляется один раз пакетно.
   */
  flatten(x, z, radius, feather = 12) {
    const h = this.heightAt(x, z);
    const i0 = Math.max(0, Math.floor((x - radius - feather + WORLD_HALF) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((x + radius + feather + WORLD_HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius - feather + WORLD_HALF) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((z + radius + feather + WORLD_HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      const wz = -WORLD_HALF + j * CELL;
      for (let i = i0; i <= i1; i++) {
        const wx = -WORLD_HALF + i * CELL;
        const d = Math.hypot(wx - x, wz - z);
        if (d > radius + feather) continue;
        const t = d <= radius ? 1 : 1 - smoothstep(invLerp(radius, radius + feather, d));
        const idx = j * GRID + i;
        this.heights[idx] = lerp(this.heights[idx], h, t);
      }
    }
    return h;
  }

  /** Применяет накопленные правки высот к геометрии и цветам. */
  refresh() {
    this._paint();
    const pos = this.mesh.geometry.getAttribute('position');
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) pos.setY(j * GRID + i, this.heights[j * GRID + i]);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.getAttribute('color').needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}
