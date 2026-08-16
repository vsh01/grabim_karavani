// Неигровые персонажи: стража, эльфы-партизаны, бойцы Злодея, мирные жители.
//
// Поведение — простой конечный автомат. Он должен читаться игроком:
// заметил → пошёл → ударил → добежал обратно на пост.
import * as THREE from 'three';
import { Actor } from './actor.js';
import { FACTIONS } from '../systems/factions.js';

export const STATE = {
  IDLE: 'idle',
  PATROL: 'patrol',
  CHASE: 'chase',
  FIGHT: 'fight',
  FLEE: 'flee',
  FOLLOW: 'follow',
  GOTO: 'goto',
};

/** Заготовки бойцов по фракциям. */
const ARCHETYPES = {
  elves: [
    { kind: 'scout', name: 'Эльф-следопыт', health: 75, speed: 6.3, items: { shortbow: 1, arrows: 30, dagger: 1, leather: 1 }, ranged: true },
    { kind: 'partisan', name: 'Эльф-партизан', health: 90, speed: 6.0, items: { elfblade: 1, elfcloak: 1 } },
    { kind: 'archer', name: 'Лучник эльфов', health: 80, speed: 5.9, items: { longbow: 1, arrows: 40, leather: 1 }, ranged: true },
  ],
  empire: [
    { kind: 'guard', name: 'Стражник', health: 110, speed: 4.9, items: { sword: 1, chain: 1 } },
    { kind: 'veteran', name: 'Ветеран стражи', health: 140, speed: 4.6, items: { greatsword: 1, plate: 1 } },
    { kind: 'crossbow', name: 'Арбалетчик', health: 95, speed: 4.8, items: { crossbow: 1, arrows: 30, chain: 1 }, ranged: true },
  ],
  villain: [
    { kind: 'brute', name: 'Головорез', health: 130, speed: 5.0, items: { axe: 1, chain: 1 } },
    { kind: 'darkguard', name: 'Чёрный латник', health: 160, speed: 4.5, items: { darkaxe: 1, darkmail: 1 } },
    { kind: 'raider', name: 'Разбойник', health: 95, speed: 5.6, items: { sword: 1, leather: 1 } },
  ],
  humans: [
    { kind: 'peasant', name: 'Крестьянин', health: 55, speed: 4.4, items: { dagger: 1 }, timid: true },
    { kind: 'merchant', name: 'Купец', health: 60, speed: 4.2, items: {}, timid: true },
    { kind: 'guardsman', name: 'Наёмник охраны', health: 100, speed: 4.9, items: { sword: 1, leather: 1 } },
  ],
};

const _dir = new THREE.Vector3();

export class Npc extends Actor {
  constructor(world, factionId, position, options = {}) {
    const pool = ARCHETYPES[factionId] || ARCHETYPES.humans;
    const arch = options.archetype
      ? pool.find((a) => a.kind === options.archetype) || pool[0]
      : pool[Math.floor(Math.random() * pool.length)];

    super(world, {
      faction: factionId,
      look: FACTIONS[factionId].look,
      name: arch.name,
      kind: arch.kind,
      position,
      maxHealth: arch.health,
      speed: arch.speed,
      items: arch.items,
    });

    this.archetype = arch;
    this.isRanged = !!arch.ranged;
    this.timid = !!arch.timid;
    this.state = options.state || STATE.IDLE;
    this.home = new THREE.Vector3().copy(position);
    this.target = null;
    this.leader = options.leader || null;
    this.patrolRadius = options.patrolRadius ?? 18;
    this.sightRange = options.sightRange ?? (this.isRanged ? 46 : 34);
    this.attackRange = this.isRanged ? 34 : (this.weapon.reach || 2) - 0.35;
    this.thinkTimer = Math.random();
    this.wanderPoint = this.home.clone();
    this.gotoPoint = null;
    this.shootCooldown = Math.random();
    this.loot = options.loot ?? Math.floor(10 + Math.random() * 40);
    this.aggressive = options.aggressive ?? true;
  }

  onAttacked(attacker) {
    if (!this.alive) return;
    // Даже мирный житель запомнит обидчика — но убегать будет, а не драться.
    this.target = attacker;
    this.state = this.timid ? STATE.FLEE : STATE.CHASE;
  }

  /** Приказ от командира: идти в точку. */
  orderGoto(point) {
    this.gotoPoint = point.clone();
    this.state = STATE.GOTO;
  }

  orderFollow(leader) {
    this.leader = leader;
    this.state = STATE.FOLLOW;
  }

  update(dt, game) {
    if (!this.alive) {
      super.update(dt);
      return;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.25 + Math.random() * 0.25;
      this.think(game);
    }

    let moveDir = null;
    let wantJump = false;

    switch (this.state) {
      case STATE.CHASE:
      case STATE.FIGHT:
        moveDir = this.combatStep(dt, game);
        break;
      case STATE.FLEE:
        moveDir = this.fleeStep();
        break;
      case STATE.FOLLOW:
        moveDir = this.followStep();
        break;
      case STATE.GOTO:
        moveDir = this.gotoStep();
        break;
      case STATE.PATROL:
        moveDir = this.patrolStep();
        break;
      default:
        moveDir = null;
    }

    // Застрял у препятствия — попробуем перепрыгнуть.
    if (moveDir && this.onGround) {
      const moved = Math.hypot(this.velocity.x, this.velocity.z);
      this._stuck = moved < 0.6 ? (this._stuck || 0) + dt : 0;
      if (this._stuck > 0.7) {
        wantJump = true;
        this._stuck = 0;
      }
    }

    this.stepPhysics(dt, moveDir, wantJump);

    if (moveDir) this.faceTowards(Math.atan2(moveDir.x, moveDir.z), dt, 7);
    else if (this.target && this.target.alive) {
      const dx = this.target.position.x - this.position.x;
      const dz = this.target.position.z - this.position.z;
      this.faceTowards(Math.atan2(dx, dz), dt, 7);
    }

    // Момент касания в анимации замаха.
    if (this.attacking && !this.attackHitDone && this.attackProgress > 0.42) {
      this.attackHitDone = true;
      _dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      game.combat.melee(this, _dir);
    }

    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    super.update(dt);
  }

  /** Перевыбор цели и состояния — раз в несколько кадров, не каждый. */
  think(game) {
    if (this.state === STATE.GOTO && this.gotoPoint) {
      const d = Math.hypot(this.gotoPoint.x - this.position.x, this.gotoPoint.z - this.position.z);
      if (d < 3) {
        this.gotoPoint = null;
        this.state = this.leader ? STATE.FOLLOW : STATE.PATROL;
      }
    }

    // Цель мертва или сбежала — сбрасываем.
    if (this.target && (!this.target.alive || this.distanceTo(this.target) > this.sightRange * 1.6)) {
      this.target = null;
      if (this.state === STATE.CHASE || this.state === STATE.FIGHT) {
        this.state = this.leader ? STATE.FOLLOW : STATE.PATROL;
      }
    }

    if (this.state === STATE.FLEE) {
      if (!this.target || this.distanceTo(this.target) > 45) {
        this.target = null;
        this.state = STATE.PATROL;
      }
      return;
    }

    if (!this.aggressive) return;

    // Ищем ближайшего врага в поле зрения.
    if (!this.target) {
      let best = null;
      let bestD = this.sightRange;
      for (const other of game.actors) {
        if (other === this || !other.alive) continue;
        if (!game.areEnemies(this, other)) continue;
        const d = this.distanceTo(other);
        if (d >= bestD) continue;
        // Плащ следопыта позволяет подойти ближе незамеченным.
        const stealth = other.inventory?.armor?.stealth || 0;
        if (d > this.sightRange * (1 - stealth)) continue;
        bestD = d;
        best = other;
      }
      if (best) {
        this.target = best;
        this.state = this.timid ? STATE.FLEE : STATE.CHASE;
        if (this.timid) return;
      }
    }

    if (this.target) {
      // Раненый и трусоватый — бежит.
      if (this.health < this.maxHealth * 0.22 && Math.random() < 0.4 && !this.leader) {
        this.state = STATE.FLEE;
        return;
      }
      const d = this.distanceTo(this.target);
      this.state = d <= this.attackRange ? STATE.FIGHT : STATE.CHASE;
    } else if (this.state === STATE.IDLE && Math.random() < 0.25) {
      this.state = STATE.PATROL;
    }
  }

  combatStep(dt, game) {
    const target = this.target;
    if (!target || !target.alive) return null;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.hypot(dx, dz) || 1e-4;

    if (this.isRanged) {
      // Стрелок держит дистанцию и стреляет с паузами.
      if (dist < 12) return { x: -dx / dist, z: -dz / dist };
      if (dist <= this.attackRange) {
        if (this.shootCooldown <= 0 && this.inventory.has('arrows') && this.injuries.canAttack) {
          this.shootCooldown = this.weapon.speed + 0.6 + Math.random() * 0.8;
          this.inventory.remove('arrows', 1);
          const origin = new THREE.Vector3(this.position.x, this.position.y + this.eyeHeight, this.position.z);
          const aim = new THREE.Vector3(
            target.position.x - origin.x,
            target.position.y + 1.1 - origin.y + dist * 0.045, // упреждение на падение стрелы
            target.position.z - origin.z,
          );
          game.combat.shoot(this, origin, aim, 0.9 + this.injuries.aimPenalty);
        }
        return null;
      }
      return { x: dx / dist, z: dz / dist };
    }

    if (dist > this.attackRange) return { x: dx / dist, z: dz / dist };
    this.startAttack();
    return null;
  }

  fleeStep() {
    const from = this.target || this.leader;
    if (!from) return null;
    const dx = this.position.x - from.position.x;
    const dz = this.position.z - from.position.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    return { x: dx / d, z: dz / d };
  }

  followStep() {
    if (!this.leader || !this.leader.alive) {
      this.leader = null;
      this.state = STATE.PATROL;
      return null;
    }
    const dx = this.leader.position.x - this.position.x;
    const dz = this.leader.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 5) return null; // не толпимся вплотную к командиру
    return { x: dx / d, z: dz / d };
  }

  gotoStep() {
    if (!this.gotoPoint) return null;
    const dx = this.gotoPoint.x - this.position.x;
    const dz = this.gotoPoint.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    if (d < 2.5) return null;
    return { x: dx / d, z: dz / d };
  }

  patrolStep() {
    const dx = this.wanderPoint.x - this.position.x;
    const dz = this.wanderPoint.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.5) {
      // Новая точка в пределах своего участка.
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.patrolRadius;
      this.wanderPoint.set(
        this.home.x + Math.cos(a) * r,
        0,
        this.home.z + Math.sin(a) * r,
      );
      return null;
    }
    return { x: dx / d, z: dz / d };
  }

  distanceTo(other) {
    return Math.hypot(other.position.x - this.position.x, other.position.z - this.position.z);
  }
}

/** Мирный житель, который просто ходит по деревне и не лезет в драку. */
export function spawnVillager(world, position) {
  return new Npc(world, 'humans', position, {
    archetype: Math.random() < 0.5 ? 'peasant' : 'merchant',
    state: STATE.PATROL,
    patrolRadius: 14,
    aggressive: false,
  });
}
