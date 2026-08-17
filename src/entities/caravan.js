// Корованы: повозка, вол, купец и охрана. Ходят по дорогам между зонами.
// Их можно грабить — ради этого всё и затевалось.
import * as THREE from 'three';
import { Npc, STATE } from './npc.js';
import { makeCartMesh, makeOxMesh } from './props.js';
import { CROSSROADS, ZONE_BY_ID, ZONES } from '../world/zones.js';
import { makeRng } from '../core/utils.js';

const CARGO_TABLE = ['silk', 'spice', 'ore', 'silk', 'spice'];
const TENT_COLOR = {
  humans: 0xd8c9a8,
  empire: 0xb84a3a,
  elves: 0x5a8f4a,
  villain: 0x4a3f52,
};

let caravanSeed = 6001;

export class Caravan {
  /**
   * @param {string} owner фракция-владелец
   * @param {string} fromZone id зоны отправления
   * @param {string} toZone id зоны назначения
   */
  constructor(game, owner, fromZone, toZone) {
    this.game = game;
    this.world = game.world;
    this.owner = owner;
    this.fromZone = fromZone;
    this.toZone = toZone;
    this.id = `caravan_${caravanSeed++}`;
    this.robbed = false;
    this.finished = false;
    this.halted = false;
    this.speed = 3.1;

    const rng = makeRng(caravanSeed * 977);

    // Маршрут: от родного посёлка через перекрёсток к цели.
    const a = ZONE_BY_ID[fromZone].hub;
    const b = ZONE_BY_ID[toZone].hub;
    this.path = [
      new THREE.Vector3(a.x, 0, a.z),
      new THREE.Vector3(CROSSROADS.x, 0, CROSSROADS.z),
      new THREE.Vector3(b.x, 0, b.z),
    ];
    this.leg = 0;
    this.legT = 0;

    this.position = this.path[0].clone();
    this.position.y = this.world.groundHeight(this.position.x, this.position.z);

    // Груз: то, ради чего корован и грабят.
    this.gold = Math.round(120 + rng() * 380);
    this.cargo = {};
    const cargoCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < cargoCount; i++) {
      const id = CARGO_TABLE[Math.floor(rng() * CARGO_TABLE.length)];
      this.cargo[id] = (this.cargo[id] || 0) + 1 + Math.floor(rng() * 2);
    }
    if (owner === 'empire' && rng() < 0.35) this.cargo.relic = 1;

    // ── видимая часть ──
    this.group = new THREE.Group();
    this.cart = makeCartMesh(TENT_COLOR[owner] || 0xd8c9a8);
    this.group.add(this.cart);
    this.ox = makeOxMesh();
    this.ox.position.set(0, 0, 4.6);
    this.group.add(this.ox);
    this.world.group.add(this.group);

    // ── люди ──
    this.escort = [];
    this.merchant = new Npc(this.world, 'humans', this.position.clone(), {
      archetype: 'merchant',
      aggressive: false,
      state: STATE.IDLE,
    });
    this.merchant.caravan = this;
    game.actors.push(this.merchant);
    this.escort.push(this.merchant);

    const guardCount = 2 + Math.floor(rng() * 3);
    const guardFaction = owner === 'humans' ? (rng() < 0.5 ? 'humans' : 'empire') : owner;
    for (let i = 0; i < guardCount; i++) {
      const g = new Npc(this.world, guardFaction, this.position.clone(), {
        archetype: guardFaction === 'humans' ? 'guardsman' : undefined,
        state: STATE.IDLE,
        sightRange: 30,
      });
      g.caravan = this;
      g.escortOffset = new THREE.Vector3(
        (i % 2 === 0 ? -1 : 1) * (2.6 + rng() * 1.4),
        0,
        -3 + (i % 3) * 3.4,
      );
      game.actors.push(g);
      this.escort.push(g);
    }
    this.merchant.escortOffset = new THREE.Vector3(2.2, 0, 3.0);

    this.guards = this.escort.filter((e) => e !== this.merchant);
  }

  get livingGuards() {
    return this.guards.filter((g) => g.alive);
  }

  /** Есть ли рядом живая охрана, готовая помешать грабежу. */
  get defended() {
    return this.livingGuards.some(
      (g) => g.state !== STATE.FLEE && this.distanceToActor(g) < 16,
    );
  }

  get lootValue() {
    let v = this.gold;
    for (const [id, n] of Object.entries(this.cargo)) {
      v += (this.game.itemPrice(id) || 0) * n;
    }
    return v;
  }

  distanceToActor(actor) {
    return Math.hypot(actor.position.x - this.position.x, actor.position.z - this.position.z);
  }

  update(dt) {
    if (this.finished) return;

    // Корован останавливается, если охрана ввязалась в бой.
    const fighting = this.escort.some(
      (e) => e.alive && (e.state === STATE.CHASE || e.state === STATE.FIGHT || e.state === STATE.FLEE),
    );
    this.halted = fighting || !this.merchant.alive;

    if (!this.halted) this.advance(dt);

    // Ставим повозку на землю и разворачиваем по ходу движения.
    const y = this.world.groundHeight(this.position.x, this.position.z);
    this.group.position.set(this.position.x, y, this.position.z);
    const dir = this.currentDirection();
    this.group.rotation.y = Math.atan2(dir.x, dir.z);

    // Сопровождение держится своих мест, пока не занято дракой.
    for (const member of this.escort) {
      if (!member.alive || !member.escortOffset) continue;
      if (member.target) continue;
      const offset = member.escortOffset;
      const cos = Math.cos(this.group.rotation.y);
      const sin = Math.sin(this.group.rotation.y);
      const wx = this.position.x + offset.x * cos + offset.z * sin;
      const wz = this.position.z - offset.x * sin + offset.z * cos;
      if (!member.gotoPoint) member.gotoPoint = new THREE.Vector3();
      member.gotoPoint.set(wx, 0, wz);
      member.state = STATE.GOTO;
    }
  }

  advance(dt) {
    const from = this.path[this.leg];
    const to = this.path[this.leg + 1];
    if (!to) {
      this.finish();
      return;
    }
    const segLen = Math.hypot(to.x - from.x, to.z - from.z);
    this.legT += (this.speed * dt) / segLen;
    if (this.legT >= 1) {
      this.legT = 0;
      this.leg++;
      if (this.leg >= this.path.length - 1) {
        this.finish();
        return;
      }
    }
    const a = this.path[this.leg];
    const bb = this.path[this.leg + 1];
    if (!bb) {
      this.finish();
      return;
    }
    this.position.x = a.x + (bb.x - a.x) * this.legT;
    this.position.z = a.z + (bb.z - a.z) * this.legT;
  }

  currentDirection() {
    const a = this.path[this.leg];
    const b = this.path[Math.min(this.leg + 1, this.path.length - 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }

  /**
   * Собственно грабёж.
   * @returns {{ok:boolean, message:string, gold?:number, cargo?:Object}}
   */
  rob(player) {
    if (this.robbed) return { ok: false, message: 'Тут уже всё вынесли.' };
    if (this.defended) {
      return { ok: false, message: 'Охрана рядом — сначала разберись с ней.' };
    }
    this.robbed = true;
    const gold = this.gold;
    const cargo = { ...this.cargo };
    this.gold = 0;
    this.cargo = {};

    player.gold += gold;
    for (const [id, n] of Object.entries(cargo)) player.inventory.add(id, n);

    // Тент снимаем — сразу видно, что корован уже обчистили.
    const tent = this.cart.children[2];
    if (tent) tent.visible = false;

    return { ok: true, message: 'Корован ограблен!', gold, cargo };
  }

  finish() {
    this.finished = true;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const member of this.escort) {
      const idx = this.game.actors.indexOf(member);
      if (idx >= 0) this.game.actors.splice(idx, 1);
      member.dispose();
    }
  }
}

/** Управляет появлением корованов на дорогах. */
export class CaravanManager {
  constructor(game) {
    this.game = game;
    this.caravans = [];
    // Корован — главная приманка игры, поэтому их должно быть видно часто.
    this.spawnTimer = 3;
    this.maxActive = 5;
    this.robbedCount = 0;
    this.totalLooted = 0;
  }

  update(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 14 + Math.random() * 18;
      if (this.caravans.length < this.maxActive) this.spawn();
    }

    for (let i = this.caravans.length - 1; i >= 0; i--) {
      const c = this.caravans[i];
      c.update(dt);
      // Дошёл до места или его давно ограбили — убираем.
      const far = this.game.player
        ? c.distanceToActor(this.game.player) > 700
        : false;
      if ((c.finished && far) || (c.robbed && c.finished)) {
        c.dispose();
        this.caravans.splice(i, 1);
      }
    }
  }

  spawn() {
    // Маршруты между разными зонами; чаще всего возят люди.
    const zones = ZONES.map((z) => z.id);
    const from = zones[Math.floor(Math.random() * zones.length)];
    let to = zones[Math.floor(Math.random() * zones.length)];
    let guard = 0;
    while (to === from && guard++ < 10) to = zones[Math.floor(Math.random() * zones.length)];
    if (to === from) return null;

    const owner = Math.random() < 0.55 ? 'humans' : from;
    const caravan = new Caravan(this.game, owner, from, to);
    this.caravans.push(caravan);
    return caravan;
  }

  /** Ближайший к игроку корован — для подсказок и заданий. */
  nearest(position) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.caravans) {
      if (c.robbed || c.finished) continue;
      const d = Math.hypot(c.position.x - position.x, c.position.z - position.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { caravan: best, distance: bestD } : null;
  }

  /** Корован в радиусе, который можно обыскать. */
  robbableAt(position, radius = 6) {
    for (const c of this.caravans) {
      if (c.robbed) continue;
      if (Math.hypot(c.position.x - position.x, c.position.z - position.z) <= radius) return c;
    }
    return null;
  }

  clear() {
    for (const c of this.caravans) c.dispose();
    this.caravans.length = 0;
  }
}
