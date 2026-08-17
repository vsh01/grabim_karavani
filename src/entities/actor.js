// Базовый персонаж: модель, физика, здоровье, увечья, смерть.
import * as THREE from 'three';
import {
  createHumanoid,
  animateHumanoid,
  detachLimb,
  hasLimb,
  attachProstheticLimb,
  LOOKS,
  PART,
  HEIGHT,
} from './humanoid.js';
import { Injuries, MOBILITY } from '../systems/injury.js';
import { Inventory, ITEMS } from '../systems/items.js';
import { clamp, lerp, turnTowards } from '../core/utils.js';
import { makeWeaponMesh } from './props.js';
import { updateFlash } from '../systems/feedback.js';

export const GRAVITY = 24;
export const JUMP_SPEED = 8.2;

export class Actor {
  constructor(world, opts = {}) {
    this.world = world;
    this.faction = opts.faction || 'humans';
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || 'Некто';
    this.kind = opts.kind || 'warrior';

    this.maxHealth = opts.maxHealth ?? 100;
    this.health = this.maxHealth;
    this.maxStamina = 100;
    this.stamina = this.maxStamina;
    this.baseSpeed = opts.speed ?? 5.2;

    this.injuries = new Injuries();
    this.inventory = new Inventory();
    if (opts.items) for (const [id, n] of Object.entries(opts.items)) this.inventory.add(id, n);
    this.inventory.autoEquip();

    this.model = createHumanoid(LOOKS[opts.look || 'human']);
    this.object = this.model.root;
    this.object.userData.actor = this;

    this.position = this.object.position;
    if (opts.position) this.position.copy(opts.position);
    this.velocity = new THREE.Vector3();
    this.onGround = true;
    this.facing = opts.facing ?? 0;
    this.headPitch = 0;

    this.alive = true;
    this.blocking = false;
    this.attackTimer = 0;
    this.attackProgress = 0;
    this.attacking = false;
    this.attackHitDone = false;
    this.animTime = Math.random() * 10;
    this.radius = 0.42;

    this._weaponMesh = null;
    this.refreshWeaponMesh();

    world.group.add(this.object);
  }

  // ── снаряжение ──

  get weapon() {
    return this.inventory.weapon || ITEMS.dagger;
  }

  refreshWeaponMesh() {
    if (this._weaponMesh) {
      this._weaponMesh.parent?.remove(this._weaponMesh);
      this._weaponMesh = null;
    }
    const slot = this.model.weaponSlot;
    // Оружие держат правой рукой: нет руки — нет и оружия в кадре.
    if (!slot || !slot.parent || !hasLimb(this.model, PART.ARM_R)) return;
    const mesh = makeWeaponMesh(this.weapon.id);
    if (mesh) {
      slot.add(mesh);
      this._weaponMesh = mesh;
    }
  }

  // ── скорость с учётом всех штрафов ──

  get moveSpeed() {
    let s = this.baseSpeed * this.injuries.speedMultiplier;
    s *= 1 - clamp(this.inventory.weightPenalty, 0, 0.5);
    if (this.health < this.maxHealth * 0.3) s *= 0.85; // тяжело раненный бежит хуже
    return s;
  }

  get eyeHeight() {
    const m = this.injuries.mobility;
    if (m === MOBILITY.CRAWL) return 0.55;
    if (m === MOBILITY.WHEELCHAIR) return 1.15;
    return 1.66;
  }

  // ── физика ──

  /**
   * Двигает актёра. moveDir — желаемое направление в мировых осях (без Y).
   * speedMul нужен для бега: базовая скорость уже учитывает увечья и броню.
   */
  stepPhysics(dt, moveDir, wantJump, speedMul = 1) {
    const speed = this.moveSpeed * speedMul;

    if (moveDir && (moveDir.x !== 0 || moveDir.z !== 0)) {
      this.velocity.x = moveDir.x * speed;
      this.velocity.z = moveDir.z * speed;
    } else {
      this.velocity.x *= Math.exp(-14 * dt);
      this.velocity.z *= Math.exp(-14 * dt);
    }

    if (wantJump && this.onGround && this.injuries.canJump && this.stamina > 12) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
      this.stamina -= 12;
    }

    this.velocity.y -= GRAVITY * dt;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Столкновения: сначала выталкиваем в плоскости, потом ставим на опору.
    const standTop = this.world.resolveCollision(this.position, this.radius, this.position.y);
    const ground = this.world.supportHeight(this.position.x, this.position.z, this.position.y);
    const floor = standTop !== null ? Math.max(ground, standTop) : ground;

    if (this.position.y <= floor) {
      this.position.y = floor;
      if (this.velocity.y < 0) {
        // Падение с высоты калечит.
        const impact = -this.velocity.y;
        if (impact > 16 && this.alive) this.takeFallDamage(impact);
        this.velocity.y = 0;
      }
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.speedNow = Math.hypot(this.velocity.x, this.velocity.z);
  }

  takeFallDamage(impact) {
    const dmg = (impact - 16) * 4.5;
    if (dmg > 1) this.applyDamage(dmg, { cause: 'fall' });
  }

  /** Плавный доворот корпуса к направлению движения или к цели. */
  faceTowards(angle, dt, rate = 9) {
    this.facing = turnTowards(this.facing, angle, rate * dt);
    this.object.rotation.y = this.facing;
  }

  // ── бой ──

  get attackDuration() {
    return this.weapon.speed / (this.injuries.armsWorking >= 2 ? 1 : 0.75);
  }

  canStartAttack() {
    if (!this.alive || this.attacking || this.attackTimer > 0) return false;
    if (!this.injuries.canAttack) return false;
    if (this.weapon.twoHanded && this.injuries.armsWorking < 2) return false;
    return true;
  }

  startAttack() {
    if (!this.canStartAttack()) return false;
    this.attacking = true;
    this.attackProgress = 0;
    this.attackHitDone = false;
    this.stamina = Math.max(0, this.stamina - 8);
    return true;
  }

  /**
   * Наносит урон. part — куда пришёлся удар, sever — было ли отсечение.
   * @returns {{damage:number, died:boolean, severed:?string, eye:?string}}
   */
  applyDamage(amount, opts = {}) {
    if (!this.alive) return { damage: 0, died: false, severed: null, eye: null };

    const armor = this.inventory.armorValue;
    let mitigated = Math.max(amount * 0.25, amount - armor * 0.6);
    let severed = null;
    let eye = null;

    // Блок съедает большую часть удара и не даёт отрубить конечность.
    if (this.blocking && opts.cause !== 'fall' && opts.cause !== 'bleedout') {
      mitigated *= 0.28;
      this.stamina = Math.max(0, this.stamina - 14);
      opts = { ...opts, sever: false };
    }

    if (opts.sever && opts.part && this.injuries.missing[opts.part] === false) {
      const res = this.injuries.sever(opts.part);
      if (res.ok) {
        severed = opts.part;
        this.dropLimb(opts.part);
        this.refreshWeaponMesh();
      }
    }
    if (opts.eye) {
      const res = this.injuries.loseEye(opts.eye);
      if (res.ok) eye = opts.eye;
    }

    this.health -= mitigated;
    this.lastHitTime = performance.now();

    if (this.health <= 0) {
      this.health = 0;
      this.die(opts.cause || 'wound');
      return { damage: mitigated, died: true, severed, eye };
    }
    return { damage: mitigated, died: false, severed, eye };
  }

  /** Снимает конечность с модели и роняет её на землю отдельным объектом. */
  dropLimb(part) {
    const holder = detachLimb(this.model, part);
    if (!holder) return;
    this.world.group.add(holder);
    const dir = Math.random() * Math.PI * 2;
    this.world.debris?.push({
      object: holder,
      velocity: new THREE.Vector3(Math.cos(dir) * 2.4, 3.2, Math.sin(dir) * 2.4),
      spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
      life: 0,
    });
  }

  /** Навешивает видимый протез на место отрубленной конечности. */
  showProsthetic(part, quality = 1) {
    // Культя может ещё висеть на модели, если увечье пришло не из боя
    // (загрузка, отладка). Протезу нужно пустое место.
    if (hasLimb(this.model, part)) {
      const joint = this.model.joints[part];
      joint.parent?.remove(joint);
    }
    attachProstheticLimb(this.model, part, quality);
    this.refreshWeaponMesh();
  }

  /** После загрузки приводит модель в соответствие с сохранёнными увечьями. */
  syncBodyToInjuries(quality = 1) {
    for (const part of Object.keys(this.injuries.missing)) {
      if (!this.injuries.missing[part]) continue;
      if (hasLimb(this.model, part)) {
        const joint = this.model.joints[part];
        joint.parent?.remove(joint);
      }
      if (this.injuries.prosthetic[part]) attachProstheticLimb(this.model, part, quality);
    }
    this.refreshWeaponMesh();
  }

  die(cause = 'wound') {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.velocity.set(0, 0, 0);
    this.attacking = false;
    this.onDeath?.(cause);
  }

  // ── обновление ──

  update(dt) {
    this.animTime += dt;
    updateFlash(this, dt);

    if (!this.alive) {
      this.updateCorpse(dt);
      return;
    }

    // Кровотечение из культи: если не перевязать — смерть.
    const bleed = this.injuries.tick(dt);
    if (bleed.died) {
      this.die('bleedout');
      return;
    }
    if (bleed.damage > 0) {
      this.health = Math.max(0, this.health - bleed.damage);
      if (this.health <= 0) {
        this.die('bleedout');
        return;
      }
    }

    // Выносливость восстанавливается в покое.
    const resting = (this.speedNow || 0) < 0.5;
    this.stamina = clamp(this.stamina + (resting ? 16 : 4) * dt, 0, this.maxStamina);

    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.attacking) {
      this.attackProgress += dt / this.attackDuration;
      if (this.attackProgress >= 1) {
        this.attacking = false;
        this.attackProgress = 0;
        this.attackTimer = 0.12;
      }
    }

    animateHumanoid(this.model, {
      animTime: this.animTime,
      speed: this.speedNow || 0,
      attacking: this.attacking,
      attackProgress: this.attackProgress,
      crawling: this.injuries.mobility === MOBILITY.CRAWL,
      wheelchair: this.injuries.mobility === MOBILITY.WHEELCHAIR,
      groundY: this.position.y,
      headPitch: this.headPitch,
    });
  }

  /** Труп остаётся в мире трёхмерным: модель заваливается набок. */
  updateCorpse(dt) {
    this.corpseTime = (this.corpseTime || 0) + dt;
    const t = Math.min(1, this.corpseTime / 0.7);
    const ease = 1 - Math.pow(1 - t, 3);
    this.object.rotation.x = -Math.PI / 2 * ease * 0.92;
    this.object.position.y = this.world.groundHeight(this.position.x, this.position.z) + 0.18 * ease;
    // Конечности расслабляются.
    for (const key of [PART.ARM_L, PART.ARM_R, PART.LEG_L, PART.LEG_R]) {
      const j = this.model.joints[key];
      if (j && j.parent) j.rotation.x = lerp(j.rotation.x, key.startsWith('arm') ? 0.5 : -0.15, ease * 0.2);
    }
  }

  get topY() {
    return this.position.y + HEIGHT * (this.model.root.scale.x || 1);
  }

  dispose() {
    this.object.parent?.remove(this.object);
  }
}
