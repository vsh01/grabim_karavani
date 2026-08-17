// Игрок: управление, камера, атака, взаимодействие.
import * as THREE from 'three';
import { Actor } from './actor.js';
import { LOOKS } from './humanoid.js';
import { FACTIONS } from '../systems/factions.js';
import { MOBILITY } from '../systems/injury.js';
import { startingKit, ITEMS } from '../systems/items.js';
import { clamp, damp } from '../core/utils.js';

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

export class Player extends Actor {
  constructor(world, factionId, position) {
    const faction = FACTIONS[factionId];
    const kit = startingKit(factionId);
    super(world, {
      faction: factionId,
      look: faction.look,
      isPlayer: true,
      name: 'Ты',
      position,
      maxHealth: factionId === 'villain' ? 130 : factionId === 'empire' ? 115 : 100,
      speed: factionId === 'elves' ? 6.1 : factionId === 'empire' ? 5.1 : 5.5,
      items: kit.items,
    });

    this.gold = kit.gold;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 100;

    this.yaw = 0;
    this.pitch = 0;
    this.cameraDistance = 4.6;
    this.firstPerson = false;
    this._camDist = this.cameraDistance;

    this.blocking = false;
    this.sprinting = false;
    this._stepDistance = 0;
    this._wasOnGround = true;
    this.interactTarget = null;
    this.rangedCooldown = 0;

    // В третьем лице модель видна; в первом её прячем, чтобы не мешала.
    this.object.visible = true;
  }

  get faceLook() {
    return LOOKS[FACTIONS[this.faction].look];
  }

  addXp(amount) {
    this.xp += amount;
    let levelled = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      levelled++;
      this.xpToNext = Math.round(this.xpToNext * 1.45);
      this.maxHealth += 12;
      this.health = this.maxHealth;
    }
    return levelled;
  }

  /**
   * Основной шаг игрока.
   * @param {import('../core/input.js').Input} input
   * @param {import('../systems/combat.js').Combat} combat
   */
  update(dt, input, combat, camera) {
    if (!this.alive) {
      super.update(dt);
      this.updateCamera(camera, dt);
      return;
    }

    // ── обзор ──
    if (input.locked && input.enabled) {
      this.yaw -= input.mouseDX * MOUSE_SENSITIVITY;
      this.pitch -= input.mouseDY * MOUSE_SENSITIVITY;
      this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }

    // ── перемещение ──
    const axis = input.moveAxis();
    const mobility = this.injuries.mobility;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Вперёд по камере: -Z в мировых координатах при yaw = 0.
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    const moveDir = {
      x: forwardX * axis.y + rightX * axis.x,
      z: forwardZ * axis.y + rightZ * axis.x,
    };
    const len = Math.hypot(moveDir.x, moveDir.z);
    if (len > 0) {
      moveDir.x /= len;
      moveDir.z /= len;
    }

    this.sprinting =
      input.down('ShiftLeft') && this.stamina > 5 && len > 0 && mobility !== MOBILITY.CRAWL;
    const sprintMul = this.sprinting ? 1.55 : 1;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - 14 * dt);

    this.stepPhysics(dt, len > 0 ? moveDir : null, input.hit('Space'), sprintMul);

    // Корпус смотрит туда же, куда камера — так проще целиться.
    this.facing = this.yaw;
    this.object.rotation.y = this.yaw;
    this.headPitch = -this.pitch * 0.5;

    // ── бой ──
    this.blocking = input.mouseDown(2) && this.injuries.armsWorking > 0 && this.stamina > 0;
    if (this.blocking) this.stamina = Math.max(0, this.stamina - 9 * dt);

    if (this.rangedCooldown > 0) this.rangedCooldown -= dt;

    const weapon = this.weapon;
    if (input.mouseHit(0) && !this.blocking) {
      if (weapon.ranged) this.tryShoot(combat, camera);
      else if (this.startAttack()) combat.playSwing(this);
    }

    this._updateFootsteps(dt, combat.game.audio);

    // Момент касания в анимации замаха — тогда и наносится урон.
    if (this.attacking && !this.attackHitDone && this.attackProgress > 0.42) {
      this.attackHitDone = true;
      const forward = new THREE.Vector3(forwardX, Math.sin(this.pitch), forwardZ).normalize();
      combat.melee(this, forward);
    }

    super.update(dt);
    this.updateCamera(camera, dt);
  }

  /** Шаги отмеряются пройденным расстоянием, а не таймером — иначе они «плывут». */
  _updateFootsteps(dt, audio) {
    const speed = this.speedNow || 0;
    if (this.onGround && speed > 0.6) {
      this._stepDistance += speed * dt;
      const stride = this.injuries.mobility === 'crawl' ? 1.1 : this.sprinting ? 2.6 : 2.0;
      if (this._stepDistance >= stride) {
        this._stepDistance = 0;
        audio.play('step', { volume: 0.5, rate: 0.85 + Math.random() * 0.35 });
      }
    } else if (!this.onGround) {
      this._stepDistance = 0;
    }

    if (this.onGround && !this._wasOnGround) {
      audio.play('land', { volume: 0.55, rate: 0.9 + Math.random() * 0.2 });
    }
    this._wasOnGround = this.onGround;
  }

  tryShoot(combat, camera) {
    if (this.rangedCooldown > 0) return false;
    if (!this.injuries.canAttack) return false;
    if (!this.inventory.has('arrows')) {
      this.onMessage?.('Стрелы кончились.');
      return false;
    }
    this.inventory.remove('arrows', 1);
    this.rangedCooldown = this.weapon.speed;

    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Стрела вылетает чуть впереди камеры, иначе она задевает самого стрелка.
    origin.addScaledVector(dir, 1.2);
    combat.shoot(this, origin, dir, this.injuries.aimPenalty);
    this.stamina = Math.max(0, this.stamina - 5);
    return true;
  }

  /** Камера от третьего лица с уходом в первое по клавише V. */
  updateCamera(camera, dt) {
    const eyeY = this.position.y + this.eyeHeight;

    if (this.firstPerson) {
      this._camDist = damp(this._camDist, 0, 14, dt);
      camera.position.set(this.position.x, eyeY, this.position.z);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.object.visible = this._camDist > 0.6;
      return;
    }

    this._camDist = damp(this._camDist, this.cameraDistance, 10, dt);

    // Луч от глаз назад — вдоль него и стоит камера.
    const cosP = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosP;
    const dirY = -Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosP;

    // Стена или склон за спиной подтягивают камеру ближе, а не пропускают её насквозь.
    const allowed = this.world.clampCameraDistance(
      this.position.x, eyeY, this.position.z, dirX, dirY, dirZ, this._camDist,
    );

    camera.position.set(
      this.position.x + dirX * allowed,
      eyeY + dirY * allowed,
      this.position.z + dirZ * allowed,
    );
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // Когда камера прижата вплотную, модель прячем — иначе смотрим изнутри головы.
    this.object.visible = allowed > 1.3;
  }

  toggleView() {
    this.firstPerson = !this.firstPerson;
    return this.firstPerson;
  }

  // ── лечение и предметы ──

  useItem(id) {
    const item = ITEMS[id];
    if (!item || !this.inventory.has(id)) return { ok: false, message: 'Нечего использовать.' };

    if (id === 'bandage') {
      if (!this.injuries.isBleeding) return { ok: false, message: 'Кровь и так не идёт.' };
      this.injuries.stopBleeding();
      this.inventory.remove(id, 1);
      return { ok: true, message: 'Ты перевязал культю. Кровь остановлена.' };
    }
    if (item.heal) {
      if (this.health >= this.maxHealth) return { ok: false, message: 'Здоровье и так полное.' };
      this.health = Math.min(this.maxHealth, this.health + item.heal);
      this.inventory.remove(id, 1);
      return { ok: true, message: `${item.name}: +${item.heal} здоровья.` };
    }
    return { ok: false, message: 'Это не используется напрямую.' };
  }

  fullHeal() {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.injuries.stopBleeding();
  }

  serialize() {
    return {
      faction: this.faction,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      maxHealth: this.maxHealth,
      stamina: this.stamina,
      gold: this.gold,
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      injuries: this.injuries.serialize(),
      inventory: this.inventory.serialize(),
      firstPerson: this.firstPerson,
    };
  }
}
