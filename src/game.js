// Ядро игры: мир, игрок, население, бой, корованы, задания, интерфейс, сохранения.
import * as THREE from 'three';
import { World } from './world/world.js';
import { Player } from './entities/player.js';
import { Npc, STATE, spawnVillager } from './entities/npc.js';
import { CaravanManager } from './entities/caravan.js';
import { Combat } from './systems/combat.js';
import { Reputation, FACTIONS, FACTION, factionsHostile } from './systems/factions.js';
import { OrderSystem, Squad } from './systems/orders.js';
import { Injuries, LIMB_LABEL, LIMB_ACCUSATIVE, LIMB_GENITIVE } from './systems/injury.js';
import { Inventory, ITEMS, SLOT, priceFor, prostheticTarget } from './systems/items.js';
import { ZONE, ZONE_BY_ID, CROSSROADS, ROADS } from './world/zones.js';
import { Audio } from './core/audio.js';
import { Feedback, flashActor } from './systems/feedback.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { saveGame, loadGame } from './core/save.js';

const AUTOSAVE_INTERVAL = 120; // секунд

/** Сколько бойцов держит гарнизон каждой зоны. */
const GARRISON = {
  [ZONE.EMPIRE]: { faction: FACTION.EMPIRE, count: 18, radius: 95 },
  [ZONE.ELVES]: { faction: FACTION.ELVES, count: 14, radius: 70 },
  [ZONE.VILLAIN]: { faction: FACTION.VILLAIN, count: 16, radius: 75 },
  [ZONE.HUMANS]: { faction: FACTION.HUMANS, count: 12, radius: 70 },
};

export class Game {
  constructor(engine, input) {
    this.engine = engine;
    this.input = input;
    this.world = null;
    this.player = null;
    this.actors = [];
    this.decals = [];
    this.debris = [];
    this.combat = new Combat(this);
    this.caravans = new CaravanManager(this);
    this.audio = new Audio();
    this.feedback = new Feedback(engine);
    this.orders = new OrderSystem(this);
    this.reputation = null;
    this.squad = null;
    this.hud = new Hud();
    this.screens = new Screens(this);
    this.running = false;
    this.playtime = 0;
    this.autosaveTimer = AUTOSAVE_INTERVAL;
    this.time = 0;
    this._respawnTimer = 20;
    this._patrolTimer = 25;
  }

  // ─────────────────────────── создание мира ───────────────────────────

  async buildWorld(onProgress) {
    this.world = new World(this.engine);
    await this.world.build(onProgress);
    this.world.debris = this.debris;
  }

  get factionName() {
    return FACTIONS[this.player?.faction]?.name || '—';
  }

  /** Точка текущего задания — её показывает компас. */
  objectivePoint() {
    const o = this.orders.current;
    if (!o || o.done) return null;
    if (o.point) return o.point;
    if (o.zone) return ZONE_BY_ID[o.zone]?.hub || null;
    return null;
  }

  /** Родное поселение игрока. */
  homePoint() {
    const zoneId = FACTIONS[this.player?.faction]?.home;
    return zoneId ? ZONE_BY_ID[zoneId].hub : null;
  }

  /** Идёт ли бой прямо сейчас — по этому HUD зажигает надпись «В БОЮ». */
  get inCombat() {
    if (!this.player?.alive) return false;
    for (const a of this.actors) {
      if (a === this.player || !a.alive) continue;
      if (a.target === this.player && a.distanceTo?.(this.player) < 45) return true;
    }
    return false;
  }

  startNewGame(factionId) {
    this.screens.close();
    this.reset();

    const spawn = this.world.spawnFor(factionId);
    this.player = new Player(this.world, factionId, spawn);
    this.player.onMessage = (m) => this.log(m);
    this.player.onDeath = (cause) => this.onPlayerDeath(cause);
    this.reputation = new Reputation(factionId);
    this.actors.push(this.player);

    this.populate();

    if (factionId === FACTION.VILLAIN) {
      this.squad = new Squad(this);
      this.recruitInitialSquad();
    }

    this.orders.offer(factionId);
    this.begin();

    const f = FACTIONS[factionId];
    this.log(`Ты играешь за «${f.name}».`, 'good');
    if (factionId === FACTION.EMPIRE) {
      this.log('Иди к командиру Ратибору во дворе дворца за приказом. Клавиша E.');
    } else if (factionId === FACTION.ELVES) {
      this.log('Старейшина Ветвеслав ждёт у Древа Совета. Клавиша E.');
    } else {
      this.log('Военный стол в форте — там собирают войско. Клавиша E.');
    }
    this.log('Корованы ходят по дорогам. Их можно грабить.', 'gold');
  }

  reset() {
    for (const a of this.actors) a.dispose();
    this.actors.length = 0;
    for (const d of this.decals) d.parent?.remove(d);
    this.decals.length = 0;
    for (const d of this.debris) d.object.parent?.remove(d.object);
    this.debris.length = 0;
    this.caravans.clear();
    this.feedback.clear();
    this.caravans.robbedCount = 0;
    this.caravans.totalLooted = 0;
    this.orders = new OrderSystem(this);
    this.squad = null;
    this.player = null;
    this.playtime = 0;
    this.autosaveTimer = AUTOSAVE_INTERVAL;
  }

  begin() {
    this.running = true;
    this.hud.show();
    this.hud.fadeOut(false);
    this.input.enabled = true;
    this.input.requestLock();
  }

  /** Расселяет гарнизоны по зонам. */
  populate() {
    for (const [zoneId, cfg] of Object.entries(GARRISON)) {
      const hub = ZONE_BY_ID[zoneId].hub;
      for (let i = 0; i < cfg.count; i++) {
        this.spawnGarrisonNpc(cfg.faction, hub, cfg.radius);
      }
    }
    // Мирные жители в деревне людей.
    const humanHub = ZONE_BY_ID[ZONE.HUMANS].hub;
    for (let i = 0; i < 6; i++) {
      const pos = this.randomPointNear(humanHub, 40);
      const npc = spawnVillager(this.world, pos);
      this.registerNpc(npc);
    }
  }

  spawnGarrisonNpc(faction, hub, radius, options = {}) {
    const pos = this.randomPointNear(hub, radius);
    const npc = new Npc(this.world, faction, pos, {
      state: STATE.PATROL,
      patrolRadius: 20,
      ...options,
    });
    this.registerNpc(npc);
    return npc;
  }

  registerNpc(npc) {
    npc.onDeath = (cause) => this.onNpcDeath(npc, cause);
    this.actors.push(npc);
    return npc;
  }

  randomPointNear(center, radius) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    return new THREE.Vector3(x, this.world.groundHeight(x, z), z);
  }

  recruitInitialSquad() {
    const hub = ZONE_BY_ID[ZONE.VILLAIN].hub;
    for (let i = 0; i < 4; i++) {
      const npc = this.spawnGarrisonNpc(FACTION.VILLAIN, hub, 26);
      this.squad.add(npc);
    }
  }

  // ─────────────────────────── вражда ───────────────────────────

  /** Враги ли двое. Для игрока решает репутация, для ИИ — базовые отношения. */
  areEnemies(a, b) {
    if (!a || !b || a === b) return false;
    if (a.faction === b.faction) return false;
    if (a.isPlayer || b.isPlayer) {
      const other = a.isPlayer ? b : a;
      return this.reputation.isHostile(other.faction);
    }
    return factionsHostile(a.faction, b.faction);
  }

  // ─────────────────────────── игровой цикл ───────────────────────────

  update(dtReal) {
    if (!this.running || !this.world) return;

    // В момент попадания мир на несколько кадров почти замирает — от этого
    // удар ощущается весомым. Интерфейс и камера при этом живут в реальном времени.
    const dt = dtReal * this.feedback.consumeTimeScale(dtReal);
    this.time += dt;

    const paused = this.screens.isOpen;
    if (!paused) {
      this.playtime += dt;
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = AUTOSAVE_INTERVAL;
        this.saveToSlot('auto', true);
      }

      if (this.player) {
        this.player.update(dt, this.input, this.combat, this.engine.camera);
      }

      for (const actor of this.actors) {
        if (actor === this.player) continue;
        actor.update(dt, this);
      }

      this.combat.update(dt);
      this.caravans.update(dt);
      this.orders.update(dt);
      this.squad?.update();
      this.updateDebris(dt);
      this.updateRespawn(dt);
      this.updateRoadPatrols(dt);
      this.handleInteraction();
      this.handleHotkeys();
    }

    if (this.player) {
      this.world.update(dt, this.player.position, this.time);
      // Слушатель звука — это камера: так шаги врага слышно с правильной стороны.
      this.audio.setListener(this.engine.camera.position, this.player.yaw);
      this.audio.updateAmbient(this.world.currentZone.id, dtReal);
      this.feedback.update(dtReal, this.engine.camera);
      // Тряску добавляем поверх уже посчитанной позиции камеры.
      this.engine.camera.position.add(this.feedback.shakeOffset);
      this.hud.update(this, dtReal);
      this.hud.setObjective(this.orders.describe());
    }
  }

  /**
   * Бродячие отряды на дорогах.
   * Без них дорога между зонами — просто долгая прогулка: гарнизоны сидят
   * по своим углам и на игрока никто не выходит.
   */
  updateRoadPatrols(dt) {
    this._patrolTimer -= dt;
    if (this._patrolTimer > 0 || !this.player) return;
    this._patrolTimer = 30 + Math.random() * 40;

    // Отряды нужны только вокруг игрока и только враждебные ему.
    const hostiles = Object.values(FACTION).filter(
      (f) => f !== this.player.faction && this.reputation.isHostile(f),
    );
    if (!hostiles.length) return;

    // Ищем точку на дороге в 90–190 метрах — далеко, но дойти можно быстро.
    const road = ROADS[Math.floor(Math.random() * ROADS.length)];
    const t = Math.random();
    const rx = road.a.x + (road.b.x - road.a.x) * t;
    const rz = road.a.z + (road.b.z - road.a.z) * t;
    const dist = Math.hypot(rx - this.player.position.x, rz - this.player.position.z);
    if (dist < 90 || dist > 190) return;

    const faction = hostiles[Math.floor(Math.random() * hostiles.length)];
    const size = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < size; i++) {
      const pos = this.randomPointNear({ x: rx, z: rz }, 7);
      const npc = new Npc(this.world, faction, pos, { sightRange: 42, patrolRadius: 26 });
      // Отряд идёт по дороге к перекрёстку, а не топчется на месте.
      npc.orderGoto(new THREE.Vector3(CROSSROADS.x, 0, CROSSROADS.z));
      this.registerNpc(npc);
    }
  }

  /** Отрубленные конечности падают на землю и там остаются. */
  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      if (d.settled) continue;
      d.velocity.y -= 22 * dt;
      d.object.position.addScaledVector(d.velocity, dt);
      d.object.rotation.x += d.spin.x * dt;
      d.object.rotation.y += d.spin.y * dt;
      d.object.rotation.z += d.spin.z * dt;

      const ground = this.world.groundHeight(d.object.position.x, d.object.position.z);
      if (d.object.position.y <= ground + 0.12) {
        d.object.position.y = ground + 0.12;
        d.settled = true;
        this.combat.spawnBlood(d.object.position, 1.1);
      }
    }
    // Старые куски убираем, чтобы сцена не разрасталась.
    while (this.debris.length > 40) {
      const old = this.debris.shift();
      old.object.parent?.remove(old.object);
    }
  }

  /** Поддерживает население зон, иначе после набегов мир опустеет. */
  updateRespawn(dt) {
    this._respawnTimer -= dt;
    if (this._respawnTimer > 0) return;
    this._respawnTimer = 12;

    for (const [zoneId, cfg] of Object.entries(GARRISON)) {
      const hub = ZONE_BY_ID[zoneId].hub;
      const alive = this.actors.filter(
        (a) => a.alive && a !== this.player && a.faction === cfg.faction &&
          Math.hypot(a.position.x - hub.x, a.position.z - hub.z) < cfg.radius * 2.2,
      ).length;
      if (alive >= cfg.count) continue;
      // Не подсовываем подкрепление прямо под нос игроку.
      const distToPlayer = this.player
        ? Math.hypot(this.player.position.x - hub.x, this.player.position.z - hub.z)
        : Infinity;
      if (distToPlayer < 60) continue;
      this.spawnGarrisonNpc(cfg.faction, hub, cfg.radius);
    }

    // Убираем трупы, до которых игроку уже нет дела.
    let corpses = 0;
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      if (a.alive || a === this.player) continue;
      corpses++;
      const far = this.player ? a.position.distanceTo(this.player.position) > 220 : true;
      if (corpses > 25 && far) {
        a.dispose();
        this.actors.splice(i, 1);
      }
    }
  }

  // ─────────────────────────── взаимодействие ───────────────────────────

  handleInteraction() {
    if (!this.player || !this.player.alive) return;
    const pos = this.player.position;

    // Корован рядом важнее разговоров.
    const caravan = this.caravans.robbableAt(pos, 7);
    if (caravan) {
      if (caravan.defended) {
        this.hud.setHint('Корован под охраной — сначала разберись с охраной');
      } else {
        this.hud.setHint(`<b>E</b> — ограбить корован (добра на ~${caravan.lootValue} ✦)`);
        if (this.input.hit('KeyE')) this.robCaravan(caravan);
      }
      return;
    }

    const it = this.world.nearestInteractable(pos, 6);
    if (!it) {
      this.hud.setHint('');
      this.player.interactTarget = null;
      return;
    }

    this.player.interactTarget = it;
    this.hud.setHint(`<b>E</b> — ${it.label}: ${it.hint}`);
    if (this.input.hit('KeyE')) this.openInteractable(it);
  }

  openInteractable(it) {
    switch (it.kind) {
      case 'shop':
        this.screens.showShop(it.shop);
        break;
      case 'prosthetist':
        this.screens.showProsthetist();
        break;
      case 'healer':
        this.screens.showHealer();
        break;
      case 'rest':
        this.screens.showRest();
        break;
      case 'commander':
      case 'elder':
        if (this.player.faction === FACTION.VILLAIN) {
          this.log('Тебе тут приказывать некому — ты сам командир.');
          return;
        }
        if (
          (it.kind === 'commander' && this.player.faction !== FACTION.EMPIRE) ||
          (it.kind === 'elder' && this.player.faction !== FACTION.ELVES)
        ) {
          this.log(`${it.label} с тобой разговаривать не станет.`, 'bad');
          return;
        }
        this.screens.showCommander();
        break;
      case 'wartable':
        if (this.player.faction !== FACTION.VILLAIN) {
          this.log('Чужие карты и чужое войско. Тебе тут не рады.', 'bad');
          return;
        }
        this.screens.showWarTable();
        break;
      case 'caravanmaster':
        this.screens.showCaravanMaster();
        break;
      default:
        break;
    }
  }

  robCaravan(caravan) {
    const res = caravan.rob(this.player);
    if (!res.ok) {
      this.log(res.message, 'bad');
      return;
    }
    this.caravans.robbedCount++;
    this.audio.play('coin', { volume: 1 });
    this.audio.play('levelup', { volume: 0.35, rate: 0.8 });
    const value = res.gold + Object.entries(res.cargo).reduce(
      (sum, [id, n]) => sum + (ITEMS[id]?.price || 0) * n, 0,
    );
    this.caravans.totalLooted += value;

    const goods = Object.entries(res.cargo)
      .map(([id, n]) => `${ITEMS[id].name} ×${n}`)
      .join(', ');
    this.log(`Корован ограблен! ${res.gold} ✦${goods ? ` и ${goods}` : ''}.`, 'gold');

    // За разбой на дороге платят репутацией.
    this.reputation.change(caravan.owner, -18);
    this.reputation.change(FACTION.HUMANS, -8);
    if (this.player.faction !== caravan.owner) {
      this.reputation.change(this.player.faction, 5);
    }
    this.player.addXp(70);
    this.orders.notifyRob();
    caravan.finish();
  }

  handleHotkeys() {
    const input = this.input;
    if (input.hit('KeyN')) {
      const on = this.audio.toggle();
      this.log(on ? 'Звук включён.' : 'Звук выключен.');
    } else if (input.hit('KeyI')) this.screens.showInventory();
    else if (input.hit('KeyM')) this.screens.showMap();
    else if (input.hit('KeyV')) {
      const fp = this.player.toggleView();
      this.log(fp ? 'Вид от первого лица.' : 'Вид от третьего лица.');
    } else if (input.hit('KeyB')) {
      const r = this.player.useItem('bandage');
      this.log(r.message, r.ok ? 'good' : 'bad');
    } else if (input.hit('KeyH')) {
      const id = this.player.inventory.has('potion')
        ? 'potion'
        : this.player.inventory.has('bigpotion')
          ? 'bigpotion'
          : 'food';
      const r = this.player.useItem(id);
      this.log(r.message, r.ok ? 'good' : 'bad');
    }
  }

  // ─────────────────────────── события боя ───────────────────────────

  onCombatEvent(ev) {
    if (ev.type === 'decapitated') {
      this.audio.play('sever', { position: ev.target.position, volume: 1.1 });
      this.feedback.spawnBlood(this._chestOf(ev.target), 30, 1.6);
      this.feedback.requestHitstop(0.1);
      this.feedback.addShake(0.55);
      if (ev.target === this.player) return;
      this.feedback.spawnPopup(this._chestOf(ev.target), 'ГОЛОВА С ПЛЕЧ', 'gore');
      this.log(`${ev.target.name}: голова с плеч.`, 'gore');
      return;
    }
    if (ev.type !== 'hit') return;

    const at = this._chestOf(ev.target);
    const armored = (ev.target.inventory?.armorValue || 0) > 12;

    // Звук удара зависит от того, во что попали.
    if (ev.severed) {
      this.audio.play('sever', { position: ev.target.position, volume: 1.0 });
    } else {
      this.audio.play(armored ? 'clang' : 'thud', {
        position: ev.target.position,
        rate: 0.9 + Math.random() * 0.25,
      });
    }

    flashActor(ev.target, ev.severed ? 0xff2010 : 0xff5533, ev.severed ? 1.4 : 1);
    this.feedback.spawnBlood(at, ev.severed ? 26 : 9, ev.severed ? 1.5 : 1);

    if (ev.target === this.player) {
      // По игроку бьют — трясём камеру и заливаем края красным.
      this.feedback.addShake(0.5 + Math.min(0.5, ev.damage / 60));
      this.hud.flashHit(0.5 + Math.min(0.5, ev.damage / 50));
      this.audio.play('hurt', { volume: 0.9 });
      this.feedback.spawnPopup(at, `-${Math.round(ev.damage)}`, 'taken');
      if (ev.severed) {
        this.feedback.requestHitstop(0.12);
        this.log(`Тебе отрубили ${LIMB_ACCUSATIVE[ev.severed]}! Перевяжись бинтом (B), иначе умрёшь.`, 'gore');
      }
      if (ev.eye) {
        this.log('Тебе выбили глаз. Полэкрана больше не видно — нужен стеклянный глаз.', 'gore');
      }
      return;
    }

    if (ev.attacker === this.player) {
      // Удар игрока: замирание тем длиннее, чем весомее попадание.
      const heavy = ev.severed || ev.part === 'head' || ev.damage > 34;
      this.feedback.requestHitstop(heavy ? 0.075 : 0.035);
      this.feedback.addShake(heavy ? 0.42 : 0.2);
      this.feedback.spawnPopup(
        at,
        ev.severed ? LIMB_ACCUSATIVE[ev.severed].toUpperCase() : `${Math.round(ev.damage)}`,
        ev.severed ? 'gore' : ev.part === 'head' ? 'crit' : '',
      );
      if (ev.severed) this.log(`${ev.target.name} лишился ${LIMB_GENITIVE[ev.severed]}.`, 'gore');
      else if (ev.eye) this.log(`${ev.target.name} лишился глаза.`, 'gore');
    }
  }

  /** Точка на уровне груди — туда бьют брызги и оттуда всплывают цифры. */
  _chestOf(actor) {
    return new THREE.Vector3(actor.position.x, actor.position.y + 1.15, actor.position.z);
  }

  onNpcDeath(npc, cause) {
    this.audio.play('death', { position: npc.position, rate: 0.85 + Math.random() * 0.3 });
    if (npc.lastAttacker === this.player || (this.player && npc.target === this.player && cause === 'bleedout')) {
      const xp = Math.round(npc.maxHealth * 0.6);
      const levels = this.player.addXp(xp);
      this.player.gold += npc.loot;
      this.audio.play('coin', { volume: 0.7 });
      this.feedback.spawnPopup(this._chestOf(npc), `+${npc.loot} ✦`, 'big');
      this.log(`${npc.name} убит. +${xp} опыта, +${npc.loot} ✦.`, 'good');
      if (levels > 0) {
        this.audio.play('levelup', { volume: 0.9 });
        this.log(`Новый уровень: ${this.player.level}!`, 'good');
      }

      // Убийство своих бьёт по репутации сильнее всего.
      if (npc.faction === this.player.faction) {
        this.reputation.change(this.player.faction, -20);
        this.log('Ты убил своего. Свои этого не забудут.', 'bad');
      } else {
        this.reputation.change(npc.faction, -5);
      }
      this.orders.notifyKill(npc);
    }
  }

  onPlayerDeath(cause) {
    this.input.releaseLock();
    this.input.enabled = false;
    this.hud.setHint('');
    if (cause === 'bleedout') {
      this.log('Ты истёк кровью.', 'gore');
    }
    setTimeout(() => this.screens.showDeath(cause), 900);
  }

  respawnPlayer() {
    const p = this.player;
    p.alive = true;
    p.health = p.maxHealth * 0.6;
    p.stamina = p.maxStamina;
    p.injuries.stopBleeding();
    p.gold = Math.floor(p.gold / 2);
    p.corpseTime = 0;
    p.object.rotation.set(0, p.facing, 0);
    const spawn = this.world.spawnFor(p.faction);
    p.position.copy(spawn);
    p.velocity.set(0, 0, 0);
    this.screens.close();
    this.begin();
    this.log('Тебя выходили свои. Половина золота ушла лекарю.', 'bad');
  }

  // ─────────────────────────── торговля и лечение ───────────────────────────

  itemPrice(id) {
    return ITEMS[id]?.price || 0;
  }

  healPrice() {
    const p = this.player;
    const missing = Math.ceil(p.maxHealth - p.health);
    return Math.max(15, Math.round(missing * 1.2) + (p.injuries.isBleeding ? 60 : 0));
  }

  buyItem(id, shopId) {
    const price = priceFor(id, shopId);
    if (this.player.gold < price) {
      this.log('Не хватает золота.', 'bad');
      return false;
    }
    this.player.gold -= price;
    this.player.inventory.add(id, 1);
    const item = ITEMS[id];
    // Новое оружие или броня надеваются, если они лучше.
    if (item.slot === SLOT.WEAPON && (!this.player.inventory.weapon || item.damage > this.player.inventory.weapon.damage)) {
      this.player.inventory.equip(id);
      this.player.refreshWeaponMesh();
    }
    if (item.slot === SLOT.ARMOR && (!this.player.inventory.armor || item.armor > this.player.inventory.armor.armor)) {
      this.player.inventory.equip(id);
    }
    this.log(`Куплено: ${item.name} за ${price} ✦.`, 'gold');
    return true;
  }

  sellItem(id, shopId) {
    if (!this.player.inventory.has(id)) return false;
    const price = priceFor(id, shopId, true);
    this.player.inventory.remove(id, 1);
    this.player.gold += price;
    this.player.refreshWeaponMesh();
    this.log(`Продано: ${ITEMS[id].name} за ${price} ✦.`, 'gold');
    return true;
  }

  buyProsthetic(id) {
    const item = ITEMS[id];
    const price = priceFor(id, 'prosthetist');
    if (this.player.gold < price) {
      this.log('Не хватает золота.', 'bad');
      return false;
    }
    const inj = this.player.injuries;

    if (item.slot !== SLOT.PROSTHETIC) return this.buyItem(id, 'prosthetist');

    if (item.part === 'wheelchair') {
      if (inj.hasWheelchair) return false;
      inj.hasWheelchair = true;
      if (inj.legsLost > 0) inj.usesWheelchair = true;
      this.player.gold -= price;
      this.log('Куплена коляска. Теперь можно кататься, а не ползать.', 'good');
      return true;
    }

    const target = prostheticTarget(id, inj);
    if (!target) {
      this.log('Ставить некуда.', 'bad');
      return false;
    }
    if (target === 'eye') {
      inj.attachEyeProsthetic();
      this.player.gold -= price;
      this.log('Стеклянный глаз на месте. Экран снова видно целиком.', 'good');
      return true;
    }
    if (!inj.attachProsthetic(target)) return false;
    this.player.gold -= price;
    inj.usesWheelchair = false;
    // Протез становится видно на модели: деревянная култышка или стальной механизм.
    this.player.showProsthetic(target, item.quality ?? 1);
    this.log(`Протез на месте: ${LIMB_LABEL[target]}. Можно жить дальше.`, 'good');
    return true;
  }

  payForHealing() {
    const price = this.healPrice();
    if (this.player.gold < price) {
      this.log('Не хватает золота на лечение.', 'bad');
      return false;
    }
    this.player.gold -= price;
    this.player.fullHeal();
    this.log('Тебя подлатали и перевязали.', 'good');
    return true;
  }

  toggleWheelchair() {
    const inj = this.player.injuries;
    if (!inj.hasWheelchair) return;
    inj.usesWheelchair = !inj.usesWheelchair;
    this.log(inj.usesWheelchair ? 'Ты сел в коляску.' : 'Ты слез с коляски.');
  }

  useOrEquip(id) {
    const item = ITEMS[id];
    if (!item) return;
    if (item.slot === SLOT.WEAPON || item.slot === SLOT.ARMOR) {
      this.player.inventory.equip(id);
      this.player.refreshWeaponMesh();
      this.log(`Надето: ${item.name}.`);
      return;
    }
    const r = this.player.useItem(id);
    this.log(r.message, r.ok ? 'good' : 'bad');
  }

  sleep() {
    this.player.fullHeal();
    this.log('Ты выспался. Здоровье и силы восстановлены.', 'good');
    this.saveToSlot('auto', true);
    this.screens.close();
  }

  // ─────────────────────────── задания и войско ───────────────────────────

  acceptOffer() {
    const offer = this.orders.available || this.orders.offer(this.player.faction);
    if (!offer) return;
    this.orders.accept(offer);
    this.log(`Задание принято: ${offer.title}`, 'good');
    if (offer.wave) this.spawnWave(offer);
  }

  onOrderComplete(order) {
    this.log(`Задание выполнено: ${order.title}. +${order.reward.gold} ✦`, 'good');
    this.orders.offer(this.player.faction);
  }

  onOrderProgress(order) {
    if (order.goal > 1) this.log(`${order.title}: ${order.progress} из ${order.goal}.`);
  }

  /** Волна нападения для заданий на оборону. */
  spawnWave(order) {
    const point = order.point || ZONE_BY_ID[order.zone].hub;
    const attackerFaction = order.wave.faction;
    for (let i = 0; i < order.wave.count; i++) {
      // Появляются поодаль и идут к точке — видно, как они приближаются.
      const a = Math.random() * Math.PI * 2;
      const dist = 150 + Math.random() * 60;
      const x = point.x + Math.cos(a) * dist;
      const z = point.z + Math.sin(a) * dist;
      const pos = new THREE.Vector3(x, this.world.groundHeight(x, z), z);
      const npc = new Npc(this.world, attackerFaction, pos, { sightRange: 45 });
      npc.orderGoto(new THREE.Vector3(point.x, 0, point.z));
      this.registerNpc(npc);
    }
    this.log('Враг приближается. Готовься.', 'bad');
  }

  recruitCost() {
    return 120 + (this.squad?.members.length || 0) * 40;
  }

  recruitSoldier() {
    if (!this.squad) return false;
    const cost = this.recruitCost();
    if (this.player.gold < cost) {
      this.log('Не хватает золота на найм.', 'bad');
      return false;
    }
    this.player.gold -= cost;
    const pos = this.randomPointNear(this.player.position, 8);
    const npc = new Npc(this.world, FACTION.VILLAIN, pos, { state: STATE.PATROL });
    this.registerNpc(npc);
    this.squad.add(npc);
    npc.orderFollow(this.player);
    this.log(`Нанят боец. В отряде ${this.squad.alive.length}.`, 'good');
    return true;
  }

  commandSquad(command) {
    if (!this.squad) return;
    const palace = ZONE_BY_ID[ZONE.EMPIRE].hub;
    this.squad.issue(command, command === 'attack' ? palace : null);
    const text = {
      follow: 'Отряд идёт за тобой.',
      attack: 'Отряд пошёл на дворец!',
      hold: 'Отряд держит позиции.',
    };
    this.log(text[command] || 'Приказ отдан.', 'good');
  }

  // ─────────────────────────── интерфейс ───────────────────────────

  log(text, kind = '') {
    this.hud.addLog(text, kind);
  }

  onScreenOpened() {
    this.input.enabled = false;
    this.input.releaseLock();
  }

  onScreenClosed() {
    if (this.running && this.player?.alive) {
      this.input.enabled = true;
      this.input.requestLock();
    }
  }

  togglePause() {
    if (this.screens.isOpen) this.screens.close();
    else this.screens.showPause();
  }

  quitToMenu() {
    this.running = false;
    this.reset();
    this.hud.hide();
    this.input.enabled = false;
    this.input.releaseLock();
    this.screens.showMainMenu();
  }

  // ─────────────────────────── сохранения ───────────────────────────

  serialize() {
    return {
      faction: this.player.faction,
      zoneName: this.world.currentZone.name,
      playtime: this.playtime,
      player: this.player.serialize(),
      reputation: this.reputation.serialize(),
      orders: this.orders.serialize(),
      caravans: {
        robbedCount: this.caravans.robbedCount,
        totalLooted: this.caravans.totalLooted,
      },
      squadSize: this.squad ? this.squad.alive.length : 0,
    };
  }

  saveToSlot(slot, silent = false) {
    if (!this.player) return false;
    const res = saveGame(slot, this.serialize());
    if (!silent) {
      this.log(res.ok ? `Игра сохранена (слот ${slot}).` : 'Не удалось сохранить.', res.ok ? 'good' : 'bad');
    }
    return res.ok;
  }

  loadFromSlot(slot) {
    const record = loadGame(slot);
    if (!record) {
      this.log('Сохранение не читается.', 'bad');
      return false;
    }
    const d = record.data;
    this.screens.close();
    this.reset();

    const spawn = new THREE.Vector3(d.player.position.x, d.player.position.y, d.player.position.z);
    this.player = new Player(this.world, d.faction, spawn);
    this.player.onMessage = (m) => this.log(m);
    this.player.onDeath = (cause) => this.onPlayerDeath(cause);
    this.actors.push(this.player);

    // Восстанавливаем состояние героя.
    const p = this.player;
    p.yaw = d.player.yaw ?? 0;
    p.pitch = d.player.pitch ?? 0;
    p.health = d.player.health;
    p.maxHealth = d.player.maxHealth;
    p.stamina = d.player.stamina;
    p.gold = d.player.gold;
    p.level = d.player.level;
    p.xp = d.player.xp;
    p.xpToNext = d.player.xpToNext;
    p.firstPerson = !!d.player.firstPerson;
    p.injuries = Injuries.deserialize(d.player.injuries);
    p.inventory = Inventory.deserialize(d.player.inventory);

    // Приводим модель в соответствие: снимаем потерянное, ставим купленные протезы.
    p.syncBodyToInjuries();

    this.reputation = Reputation.deserialize(d.reputation);
    this.orders.load(d.orders);
    this.playtime = d.playtime || 0;
    this.caravans.robbedCount = d.caravans?.robbedCount || 0;
    this.caravans.totalLooted = d.caravans?.totalLooted || 0;

    this.populate();
    if (d.faction === FACTION.VILLAIN) {
      this.squad = new Squad(this);
      const n = Math.max(2, d.squadSize || 4);
      const hub = ZONE_BY_ID[ZONE.VILLAIN].hub;
      for (let i = 0; i < n; i++) this.squad.add(this.spawnGarrisonNpc(FACTION.VILLAIN, hub, 26));
    }

    this.begin();
    this.log('Игра загружена.', 'good');
    return true;
  }
}
