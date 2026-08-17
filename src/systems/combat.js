// Бой: удары ближнего боя, стрельба, попадание по частям тела и отрубание.
import * as THREE from 'three';
import { PART, HEIGHT } from '../entities/humanoid.js';
import { makeArrowMesh, makeBloodDecal } from '../entities/props.js';
import { clamp } from '../core/utils.js';

/** Множители урона по зонам попадания. */
const PART_DAMAGE = {
  [PART.HEAD]: 2.3,
  [PART.TORSO]: 1.0,
  [PART.ARM_L]: 0.7,
  [PART.ARM_R]: 0.7,
  [PART.LEG_L]: 0.78,
  [PART.LEG_R]: 0.78,
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Куда пришёлся удар — определяется по высоте точки попадания.
 * Целишься в ноги — отрубаешь ноги. Целишься в голову — можно выбить глаз.
 */
export function partFromHeight(rel, rand) {
  if (rel > 0.84) {
    const eye = rand() < 0.4 ? (rand() < 0.5 ? 'left' : 'right') : null;
    return { part: PART.HEAD, eye };
  }
  if (rel > 0.52) {
    if (rand() < 0.32) return { part: rand() < 0.5 ? PART.ARM_L : PART.ARM_R, eye: null };
    return { part: PART.TORSO, eye: null };
  }
  return { part: rand() < 0.5 ? PART.LEG_L : PART.LEG_R, eye: null };
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.rand = Math.random;
  }

  get actors() {
    return this.game.actors;
  }

  /**
   * Удар ближнего боя. Цель ищется в конусе перед атакующим.
   * @param {import('../entities/actor.js').Actor} attacker
   * @param {THREE.Vector3} forward направление взгляда (нормализованное)
   * @returns {Array} список результатов попаданий
   */
  melee(attacker, forward) {
    const weapon = attacker.weapon;
    const reach = (weapon.reach || 2) + 0.3;
    const results = [];
    const origin = _v.copy(attacker.position);
    origin.y += attacker.eyeHeight * 0.8;

    for (const target of this.actors) {
      if (target === attacker || !target.alive) continue;
      if (!this.game.areEnemies(attacker, target)) continue;

      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach) continue;

      // Только то, что перед нами.
      const dot = (dx / (dist || 1)) * forward.x + (dz / (dist || 1)) * forward.z;
      if (dot < 0.35) continue;

      // Высота удара берётся из наклона взгляда.
      const targetHeight = HEIGHT * (target.model.root.scale.x || 1);
      const aimY = origin.y + forward.y * reach;
      const rel = clamp((aimY - target.position.y) / targetHeight, 0, 1);
      const { part, eye } = partFromHeight(rel, this.rand);

      results.push(this.resolveHit(attacker, target, weapon, part, eye, 1));
      break; // один взмах — одна цель
    }
    return results;
  }

  /** Свист оружия в момент замаха. */
  playSwing(attacker) {
    this.game.audio.play('swoosh', {
      position: attacker.isPlayer ? undefined : attacker.position,
      volume: attacker.isPlayer ? 0.55 : 0.45,
      rate: 0.85 + Math.random() * 0.3,
    });
  }

  /** Общая часть для ближнего и дальнего боя. */
  resolveHit(attacker, target, weapon, part, eye, powerScale = 1) {
    const base = weapon.damage * powerScale * (attacker.injuries?.damageMultiplier ?? 1);
    const damage = base * (PART_DAMAGE[part] || 1) * (0.85 + this.rand() * 0.3);

    // Шанс отсечения растёт, когда цель уже потрёпана.
    const wounded = 1 + (1 - target.health / target.maxHealth) * 1.4;
    const severChance = (weapon.sever || 0) * wounded * (PART_DAMAGE[part] >= 2 ? 0.7 : 1);
    const canSever = part !== PART.TORSO;
    const sever = canSever && this.rand() < severChance;

    // Отрубленная голова — это сразу смерть, а не увечье.
    if (sever && part === PART.HEAD) {
      target.dropLimb(PART.HEAD);
      this.spawnBlood(target.position, 2.2);
      target.applyDamage(9999, { cause: 'decapitated' });
      this.game.onCombatEvent?.({ type: 'decapitated', attacker, target });
      return { target, part, damage: 9999, severed: PART.HEAD, died: true, eye: null };
    }

    const res = target.applyDamage(damage, {
      part,
      sever: sever && part !== PART.HEAD,
      eye: part === PART.HEAD ? eye : null,
      cause: 'wound',
      from: attacker,
    });

    if (res.severed) this.spawnBlood(target.position, 1.8);
    if (res.died) this.spawnBlood(target.position, 2.4);

    target.lastAttacker = attacker;
    if (target.onAttacked) target.onAttacked(attacker);

    // Отбрасывание: без него удар выглядит так, будто цель его не заметила.
    if (target.alive && target.velocity) {
      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const push = Math.min(6, 1.6 + damage * 0.075);
      target.velocity.x += (dx / d) * push;
      target.velocity.z += (dz / d) * push;
    }

    this.game.onCombatEvent?.({ type: 'hit', attacker, target, ...res, part });
    return { target, part, ...res };
  }

  /** Выстрел из лука или арбалета. */
  shoot(attacker, origin, direction, spread = 0) {
    const weapon = attacker.weapon;
    const dir = direction.clone().normalize();
    if (spread > 0) {
      dir.x += (this.rand() - 0.5) * spread * 0.12;
      dir.y += (this.rand() - 0.5) * spread * 0.12;
      dir.z += (this.rand() - 0.5) * spread * 0.12;
      dir.normalize();
    }
    const mesh = makeArrowMesh();
    mesh.position.copy(origin);
    this.game.world.group.add(mesh);
    this.game.audio.play('bow', {
      position: attacker.isPlayer ? undefined : attacker.position,
      volume: attacker.isPlayer ? 0.7 : 0.5,
      rate: 0.9 + Math.random() * 0.2,
    });

    this.projectiles.push({
      mesh,
      position: origin.clone(),
      velocity: dir.multiplyScalar(58),
      owner: attacker,
      weapon,
      life: 0,
    });
  }

  spawnBlood(position, size) {
    const decal = makeBloodDecal(size);
    const y = this.game.world.groundHeight(position.x, position.z);
    decal.position.set(position.x, y + 0.04, position.z);
    decal.rotation.y = this.rand() * Math.PI * 2;
    this.game.world.group.add(decal);
    this.game.decals.push(decal);
    // Не даём лужам крови копиться бесконечно.
    if (this.game.decals.length > 80) {
      const old = this.game.decals.shift();
      old.parent?.remove(old);
    }
  }

  update(dt) {
    const world = this.game.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.velocity.y -= 11 * dt;

      const step = _v.copy(p.velocity).multiplyScalar(dt);
      const next = _v2.copy(p.position).add(step);

      let consumed = false;

      // Попадание в актёра: проверяем отрезок пути на пересечение с цилиндром цели.
      for (const target of this.actors) {
        if (!target.alive || target === p.owner) continue;
        if (!this.game.areEnemies(p.owner, target)) continue;

        const targetHeight = HEIGHT * (target.model.root.scale.x || 1);
        const closest = closestPointOnSegment(p.position, next, target.position, targetHeight);
        if (!closest) continue;
        const dx = closest.x - target.position.x;
        const dz = closest.z - target.position.z;
        if (dx * dx + dz * dz > 0.36) continue;

        const rel = clamp((closest.y - target.position.y) / targetHeight, 0, 1);
        const { part, eye } = partFromHeight(rel, this.rand);
        this.game.audio.play('tick', { position: closest, volume: 0.8 });
        this.resolveHit(p.owner, target, p.weapon, part, eye, 1);
        consumed = true;
        break;
      }

      if (!consumed) {
        const ground = world.groundHeight(next.x, next.z);
        if (next.y <= ground || p.life > 6 || Math.abs(next.x) > world.bounds || Math.abs(next.z) > world.bounds) {
          consumed = true;
        }
      }

      if (consumed) {
        p.mesh.parent?.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      p.position.copy(next);
      p.mesh.position.copy(next);
      p.mesh.lookAt(_v.copy(next).add(p.velocity));
    }
  }
}

/**
 * Ближайшая точка отрезка к оси цели, если она вообще попадает в её высоту.
 * Возвращает точку или null.
 */
const _closest = new THREE.Vector3();
function closestPointOnSegment(a, b, center, height) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 1e-9) return null;
  // Проекция оси цели (вертикальный отрезок) — берём по горизонтали.
  const t = clamp(((center.x - a.x) * abx + (center.z - a.z) * abz) / (abx * abx + abz * abz || 1e-9), 0, 1);
  _closest.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  if (_closest.y < center.y - 0.2 || _closest.y > center.y + height + 0.2) return null;
  return _closest;
}
