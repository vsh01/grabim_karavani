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
import { ZONE, ZONE_BY_ID } from './world/zones.js';
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
    this._pendingWave = null;
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

  update(dt) {
    if (!this.running || !this.world) return;
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
      this.handleInteraction();
      this.handleHotkeys();
    }

    if (this.player) {
      this.world.update(dt, this.player.position, this.time);
      this.hud.update(this);
      this.hud.setObjective(this.orders.describe());
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
    if (input.hit('KeyI')) this.screens.showInventory();
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
      if (ev.target === this.player) return;
      this.log(`${ev.target.name}: голова с плеч.`, 'gore');
      return;
    }
    if (ev.type !== 'hit') return;

    if (ev.target === this.player) {
      if (ev.severed) {
        this.log(`Тебе отрубили ${LIMB_ACCUSATIVE[ev.severed]}! Перевяжись бинтом (B), иначе умрёшь.`, 'gore');
      }
      if (ev.eye) {
        this.log('Тебе выбили глаз. Полэкрана больше не видно — нужен стеклянный глаз.', 'gore');
      }
      return;
    }
    if (ev.attacker === this.player) {
      if (ev.severed) this.log(`${ev.target.name} лишился ${LIMB_GENITIVE[ev.severed]}.`, 'gore');
      else if (ev.eye) this.log(`${ev.target.name} лишился глаза.`, 'gore');
    }
  }

  onNpcDeath(npc, cause) {
    if (npc.lastAttacker === this.player || (this.player && npc.target === this.player && cause === 'bleedout')) {
      const xp = Math.round(npc.maxHealth * 0.6);
      const levels = this.player.addXp(xp);
      this.player.gold += npc.loot;
      this.log(`${npc.name} убит. +${xp} опыта, +${npc.loot} ✦.`, 'good');
      if (levels > 0) this.log(`Новый уровень: ${this.player.level}!`, 'good');

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
