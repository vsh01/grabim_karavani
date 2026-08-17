// Отдача боя: то, из-за чего удар «чувствуется», а не просто меняет число.
//
// Здесь собрано четыре приёма, которые вместе дают вес попаданию:
//   • hitstop — мир замирает на несколько кадров в момент касания;
//   • тряска камеры;
//   • вспышка на теле того, кого ударили;
//   • брызги крови и всплывающие цифры урона.
import * as THREE from 'three';

const MAX_PARTICLES = 260;

export class Feedback {
  constructor(engine) {
    this.engine = engine;

    // ── замирание и тряска ──
    this.hitstop = 0;
    this.shake = 0;
    this.shakeOffset = new THREE.Vector3();

    // ── частицы крови ──
    this.particles = [];
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: 0xa8221c,
      size: 0.23,
      sizeAttenuation: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    engine.scene.add(this.points);

    // ── всплывающие цифры ──
    this.popupLayer = document.getElementById('damage-popups');
    this.popups = [];
    this._projected = new THREE.Vector3();
  }

  /** Короткая остановка времени на сильном ударе. */
  requestHitstop(seconds) {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * Масштаб времени для этого кадра. Пока идёт hitstop, мир почти стоит.
   * @returns {number} множитель dt
   */
  consumeTimeScale(dt) {
    if (this.hitstop <= 0) return 1;
    this.hitstop -= dt;
    return 0.08;
  }

  /** Брызги крови из точки попадания. */
  spawnBlood(position, count = 12, power = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const up = 1.6 + Math.random() * 3.2;
      const out = (0.8 + Math.random() * 2.6) * power;
      this.particles.push({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: Math.cos(a) * out,
        vy: up,
        vz: Math.sin(a) * out,
        life: 0.5 + Math.random() * 0.5,
      });
    }
  }

  /** Всплывающее число урона в мировой точке. */
  spawnPopup(position, text, kind = '') {
    if (!this.popupLayer) return;
    const el = document.createElement('div');
    el.className = `dmg-popup ${kind}`;
    el.textContent = text;
    this.popupLayer.appendChild(el);
    this.popups.push({ el, position: position.clone(), life: 0, ttl: kind === 'big' ? 1.5 : 1.0 });
    // Больше двух десятков цифр на экране — уже каша.
    while (this.popups.length > 22) {
      const old = this.popups.shift();
      old.el.remove();
    }
  }

  update(dt, camera) {
    // Тряска затухает быстро, иначе картинку укачивает.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.4);
      const s = this.shake * this.shake * 0.42;
      this.shakeOffset.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // Частицы.
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (const p of this.particles) {
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.getAttribute('position').needsUpdate = true;

    // Цифры урона: проецируем мировую точку на экран и поднимаем вверх.
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life += dt;
      if (pop.life >= pop.ttl) {
        pop.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      const t = pop.life / pop.ttl;
      this._projected.copy(pop.position);
      this._projected.y += 0.4 + t * 1.3;
      this._projected.project(camera);
      if (this._projected.z > 1) {
        pop.el.style.display = 'none';
        continue;
      }
      pop.el.style.display = '';
      pop.el.style.left = `${(this._projected.x * 0.5 + 0.5) * innerWidth}px`;
      pop.el.style.top = `${(-this._projected.y * 0.5 + 0.5) * innerHeight}px`;
      pop.el.style.opacity = String(1 - t * t);
    }
  }

  clear() {
    this.particles.length = 0;
    this.points.geometry.setDrawRange(0, 0);
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    this.shake = 0;
    this.hitstop = 0;
  }
}

/**
 * Вспышка на теле того, кого ударили. Работает через собственный материал
 * актёра: у каждого он свой, поэтому подсветить одного можно, не задев прочих.
 */
export function flashActor(actor, color = 0xff3020, strength = 1) {
  const mat = actor.model?.material;
  if (!mat) return;
  actor._flash = Math.max(actor._flash || 0, 0.16 * strength);
  mat.emissive.setHex(color);
  mat.emissiveIntensity = 1;
}

/** Гасит вспышку. Вызывается каждый кадр из Actor.update. */
export function updateFlash(actor, dt) {
  if (!actor._flash) return;
  actor._flash -= dt;
  const mat = actor.model?.material;
  if (!mat) return;
  if (actor._flash <= 0) {
    actor._flash = 0;
    mat.emissive.setHex(0x000000);
  } else {
    mat.emissiveIntensity = Math.min(1, actor._flash * 6);
  }
}
