// Сборка мира: ландшафт, поселения, лес и столкновения со всем этим.
import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Forest } from './forest.js';
import { buildPalace, buildElfVillage, buildOldFort, buildHumanVillage, buildCrossroads } from './structures.js';
import { zoneAt, ZONES, ZONE_BY_ID, clampToWorld, WORLD_HALF } from './zones.js';
import { skyTexture } from './textures.js';
import { damp } from '../core/utils.js';

/** Пауза до следующего кадра: даёт браузеру перерисовать экран загрузки. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const _targetSky = new THREE.Color();
const _white = new THREE.Color(0xffffff);

export class World {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    engine.scene.add(this.group);
  }

  /** Генерация мира по шагам, с паузами между этапами ради живого прогресса. */
  async build(onProgress = () => {}) {
    onProgress('Поднимаем горы и раскладываем дороги…');
    await nextFrame();
    this.terrain = new Terrain();

    onProgress('Строим дворец, форт и деревни…');
    await nextFrame();
    this.sites = {
      palace: buildPalace(this.terrain),
      elves: buildElfVillage(this.terrain),
      fort: buildOldFort(this.terrain),
      humans: buildHumanVillage(this.terrain),
      crossroads: buildCrossroads(this.terrain),
    };
    // Постройки продавили площадки — пересобираем ландшафт под них.
    this.terrain.refresh();
    this.group.add(this.terrain.mesh);

    this.colliders = [];
    this.interactables = [];
    const exclusions = [];
    for (const key of Object.keys(this.sites)) {
      const site = this.sites[key];
      this.group.add(site.group);
      this.colliders.push(...site.colliders);
      this.interactables.push(...site.interactables);
      if (site.exclusion) exclusions.push(site.exclusion);
    }

    onProgress('Сажаем густой лес и печём импосторы деревьев…');
    await nextFrame();
    this.forest = new Forest(this.engine.renderer, this.terrain, exclusions);
    this.group.add(this.forest.group);

    // Небо-градиент вместо плоской заливки.
    this.engine.scene.background = skyTexture('#6f9fd8', '#cfe0ef');

    this._buildColliderGrid();
    this._currentZone = ZONES[0];
    this._sky = new THREE.Color(0x9dc0e6);
    this._fogNear = 340;
    this._fogFar = 900;

    onProgress(`Готово. Деревьев в мире: ${this.forest.treeCount}.`);
    await nextFrame();
    return this;
  }

  /** Разрежаем препятствия по сетке — иначе каждый шаг проверял бы весь мир. */
  _buildColliderGrid() {
    this.colliderCell = 32;
    this.colliderGrid = new Map();
    const put = (cx, cz, item) => {
      const key = `${cx},${cz}`;
      let arr = this.colliderGrid.get(key);
      if (!arr) this.colliderGrid.set(key, (arr = []));
      arr.push(item);
    };
    for (const c of this.colliders) {
      const minX = c.type === 'box' ? c.minX : c.x - c.r;
      const maxX = c.type === 'box' ? c.maxX : c.x + c.r;
      const minZ = c.type === 'box' ? c.minZ : c.z - c.r;
      const maxZ = c.type === 'box' ? c.maxZ : c.z + c.r;
      for (let cz = Math.floor(minZ / this.colliderCell); cz <= Math.floor(maxZ / this.colliderCell); cz++) {
        for (let cx = Math.floor(minX / this.colliderCell); cx <= Math.floor(maxX / this.colliderCell); cx++) {
          put(cx, cz, c);
        }
      }
    }
  }

  groundHeight(x, z) {
    return this.terrain.heightAt(x, z);
  }

  zoneAt(x, z) {
    return zoneAt(x, z);
  }

  /**
   * Выталкивает точку из построек и стволов.
   * Препятствия ниже уровня ног игнорируются — на них можно запрыгнуть.
   */
  resolveCollision(pos, radius, feetY) {
    clampToWorld(pos);
    this.forest.collide(pos, radius);

    const cx0 = Math.floor((pos.x - radius) / this.colliderCell);
    const cx1 = Math.floor((pos.x + radius) / this.colliderCell);
    const cz0 = Math.floor((pos.z - radius) / this.colliderCell);
    const cz1 = Math.floor((pos.z + radius) / this.colliderCell);
    let standTop = null;

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.colliderGrid.get(`${cx},${cz}`);
        if (!bucket) continue;
        for (const c of bucket) {
          // Игрок уже выше препятствия — значит стоит на нём, а не упирается.
          if (feetY >= c.top - 0.35) {
            const inside =
              c.type === 'box'
                ? pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ
                : (pos.x - c.x) ** 2 + (pos.z - c.z) ** 2 < c.r * c.r;
            if (inside && (standTop === null || c.top > standTop)) standTop = c.top;
            continue;
          }
          if (c.type === 'box') {
            const closestX = Math.max(c.minX, Math.min(pos.x, c.maxX));
            const closestZ = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
            const dx = pos.x - closestX;
            const dz = pos.z - closestZ;
            const dSq = dx * dx + dz * dz;
            if (dSq > radius * radius) continue;
            if (dSq > 1e-8) {
              const d = Math.sqrt(dSq);
              pos.x = closestX + (dx / d) * radius;
              pos.z = closestZ + (dz / d) * radius;
            } else {
              // Центр внутри коробки: выталкиваем по ближайшей грани.
              const toLeft = pos.x - c.minX;
              const toRight = c.maxX - pos.x;
              const toBack = pos.z - c.minZ;
              const toFront = c.maxZ - pos.z;
              const m = Math.min(toLeft, toRight, toBack, toFront);
              if (m === toLeft) pos.x = c.minX - radius;
              else if (m === toRight) pos.x = c.maxX + radius;
              else if (m === toBack) pos.z = c.minZ - radius;
              else pos.z = c.maxZ + radius;
            }
          } else {
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const min = c.r + radius;
            const dSq = dx * dx + dz * dz;
            if (dSq >= min * min) continue;
            const d = Math.sqrt(dSq) || 1e-4;
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
          }
        }
      }
    }
    return standTop;
  }

  /** Поверхность, на которой стоит актёр: земля или крыша/стена под ним. */
  supportHeight(x, z, feetY) {
    let best = this.terrain.heightAt(x, z);
    const cx = Math.floor(x / this.colliderCell);
    const cz = Math.floor(z / this.colliderCell);
    const bucket = this.colliderGrid.get(`${cx},${cz}`);
    if (bucket) {
      for (const c of bucket) {
        const inside =
          c.type === 'box'
            ? x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ
            : (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r;
        if (inside && c.top <= feetY + 0.6 && c.top > best) best = c.top;
      }
    }
    return best;
  }

  /**
   * Насколько далеко можно отодвинуть камеру, не влезая в землю и постройки.
   * Идём по лучу от глаз игрока и останавливаемся перед первой преградой.
   */
  clampCameraDistance(ox, oy, oz, dx, dy, dz, maxDist) {
    const steps = 12;
    const stepLen = maxDist / steps;
    for (let i = 1; i <= steps; i++) {
      const t = i * stepLen;
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      if (y < this.terrain.heightAt(x, z) + 0.7) return Math.max(0.4, t - stepLen);
      const bucket = this.colliderGrid.get(
        `${Math.floor(x / this.colliderCell)},${Math.floor(z / this.colliderCell)}`,
      );
      if (!bucket) continue;
      for (const c of bucket) {
        const inside =
          c.type === 'box'
            ? x > c.minX - 0.4 && x < c.maxX + 0.4 && z > c.minZ - 0.4 && z < c.maxZ + 0.4
            : (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.4) ** 2;
        if (inside && y < c.top) return Math.max(0.4, t - stepLen);
      }
    }
    return maxDist;
  }

  /** Ближайший объект взаимодействия к игроку. */
  nearestInteractable(pos, maxDist = 6) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const it of this.interactables) {
      const d = (it.x - pos.x) ** 2 + (it.z - pos.z) ** 2;
      const r = (it.radius || 4) ** 2;
      if (d < Math.max(r, bestD) && d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  /** Плавный переход неба и тумана при смене зоны. */
  update(dt, playerPos, time) {
    const zone = zoneAt(playerPos.x, playerPos.z);
    this._currentZone = zone;

    _targetSky.set(zone.sky);
    this._sky.lerp(_targetSky, 1 - Math.exp(-0.7 * dt));
    this._fogNear = damp(this._fogNear, zone.fog[0], 0.7, dt);
    this._fogFar = damp(this._fogFar, zone.fog[1], 0.7, dt);

    const fog = this.engine.scene.fog;
    fog.color.copy(this._sky);
    fog.near = this._fogNear;
    fog.far = this._fogFar;
    this.engine.hemi.color.copy(this._sky).lerp(_white, 0.55);

    this.forest.syncFog(fog);
    this.forest.update(playerPos, time);
    this.engine.followSun(playerPos);

    // Мерцание огня в жаровнях форта.
    const fort = this.sites.fort.group;
    for (const child of fort.children) {
      if (child.userData.flicker !== undefined) {
        const s = 0.85 + Math.sin(time * 7 + child.userData.flicker) * 0.12 + Math.sin(time * 13.7) * 0.05;
        child.scale.setScalar(s);
      }
    }
  }

  get currentZone() {
    return this._currentZone;
  }

  /** Точка появления игрока за выбранную фракцию. */
  spawnFor(factionId) {
    const map = {
      elves: this.sites.elves.spawn,
      empire: this.sites.palace.spawn,
      villain: this.sites.fort.spawn,
    };
    const s = map[factionId] || this.sites.humans.spawn;
    return new THREE.Vector3(s.x, this.terrain.heightAt(s.x, s.z), s.z);
  }

  hubPosition(zoneId) {
    const zone = ZONE_BY_ID[zoneId];
    return new THREE.Vector3(zone.hub.x, this.terrain.heightAt(zone.hub.x, zone.hub.z), zone.hub.z);
  }

  get bounds() {
    return WORLD_HALF;
  }
}
