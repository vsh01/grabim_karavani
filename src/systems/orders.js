// Задания трёх фракций.
//
// За стражу приказы выдаёт командир, и их надо слушаться.
// За эльфов задания даёт старейшина.
// За Злодея приказов нет вовсе — игрок сам командир и сам ставит себе цель,
// а войском командует через военный стол.
import * as THREE from 'three';
import { FACTION } from './factions.js';
import { ZONE, ZONE_BY_ID } from '../world/zones.js';
import { STATE } from '../entities/npc.js';

export const ORDER = {
  PATROL: 'patrol',
  RAID: 'raid',
  ROB: 'rob',
  DEFEND: 'defend',
  ASSAULT: 'assault',
  HUNT: 'hunt',
};

let orderSeq = 1;

function makeOrder(data) {
  return {
    id: `order_${orderSeq++}`,
    progress: 0,
    goal: 1,
    done: false,
    failed: false,
    ...data,
  };
}

/** Наборы заданий по фракциям. */
const GENERATORS = {
  [FACTION.EMPIRE]: [
    () =>
      makeOrder({
        type: ORDER.PATROL,
        title: 'Держать пост на перекрёстке',
        text: 'Командир Ратибор велел дойти до Большого Перекрёстка и продержаться там минуту. Дороги должны быть под присмотром.',
        zone: ZONE.HUMANS,
        point: { x: 0, z: 0 },
        holdTime: 60,
        reward: { gold: 90, xp: 60, rep: { empire: 6 } },
      }),
    () =>
      makeOrder({
        type: ORDER.RAID,
        title: 'Набег на лес эльфов',
        text: 'Приказ: идти в лес эльфов и положить пятерых партизан. Император устал от засад на дорогах.',
        zone: ZONE.ELVES,
        targetFaction: FACTION.ELVES,
        goal: 5,
        reward: { gold: 180, xp: 140, rep: { empire: 10, elves: -14 } },
      }),
    () =>
      makeOrder({
        type: ORDER.RAID,
        title: 'Набег на старый форт',
        text: 'Приказ: подняться в горы и вырезать четверых людей Злодея у старого форта.',
        zone: ZONE.VILLAIN,
        targetFaction: FACTION.VILLAIN,
        goal: 4,
        reward: { gold: 220, xp: 160, rep: { empire: 12, villain: -16 } },
      }),
    () =>
      makeOrder({
        type: ORDER.HUNT,
        title: 'Поймать эльфийского шпиона',
        text: 'У дворца видели чужака в плаще следопыта. Найти и убить, пока он не унёс планы караулов.',
        zone: ZONE.EMPIRE,
        targetFaction: FACTION.ELVES,
        goal: 1,
        spawnSpy: true,
        reward: { gold: 150, xp: 110, rep: { empire: 9, elves: -8 } },
      }),
    () =>
      makeOrder({
        type: ORDER.DEFEND,
        title: 'Оборона дворца',
        text: 'Злодей послал отряд на дворец. Приказ прост: никого не пропустить.',
        zone: ZONE.EMPIRE,
        point: null, // подставится позиция дворца
        goal: 6,
        wave: { faction: FACTION.VILLAIN, count: 6 },
        reward: { gold: 260, xp: 200, rep: { empire: 16, villain: -12 } },
      }),
  ],

  [FACTION.ELVES]: [
    () =>
      makeOrder({
        type: ORDER.ROB,
        title: 'Взять корован на дороге',
        text: 'Старейшина Ветвеслав: «Лес кормит, но железа он не родит. Останови корован на дороге и возьми, что везут».',
        goal: 1,
        reward: { gold: 60, xp: 120, rep: { elves: 10, humans: -10 } },
      }),
    () =>
      makeOrder({
        type: ORDER.RAID,
        title: 'Проредить дворцовую стражу',
        text: 'Солдаты дворца снова ходили по нашим тропам. Убей четверых — пусть считают потери, а не тропы.',
        zone: ZONE.EMPIRE,
        targetFaction: FACTION.EMPIRE,
        goal: 4,
        reward: { gold: 160, xp: 150, rep: { elves: 12, empire: -15 } },
      }),
    () =>
      makeOrder({
        type: ORDER.DEFEND,
        title: 'Набег на Древогорье',
        text: 'На деревню идут чужаки. Домики деревянные, горят хорошо — не дай им дойти.',
        zone: ZONE.ELVES,
        goal: 5,
        wave: { faction: FACTION.EMPIRE, count: 5 },
        reward: { gold: 140, xp: 170, rep: { elves: 16, empire: -10 } },
      }),
    () =>
      makeOrder({
        type: ORDER.RAID,
        title: 'Разведка боем в горах',
        text: 'Злодей копит войско. Поднимись к форту и убей троих — заодно посчитаешь, сколько их там.',
        zone: ZONE.VILLAIN,
        targetFaction: FACTION.VILLAIN,
        goal: 3,
        reward: { gold: 170, xp: 150, rep: { elves: 10, villain: -14 } },
      }),
    () =>
      makeOrder({
        type: ORDER.ASSAULT,
        title: 'Партизанская вылазка ко дворцу',
        text: 'Подобраться к самому дворцу и положить шестерых стражников внутри стен. Уходить лесом.',
        zone: ZONE.EMPIRE,
        targetFaction: FACTION.EMPIRE,
        goal: 6,
        reward: { gold: 320, xp: 260, rep: { elves: 20, empire: -25 } },
      }),
  ],

  [FACTION.VILLAIN]: [
    () =>
      makeOrder({
        type: ORDER.ASSAULT,
        title: 'Штурм дворца',
        text: 'Ты сам себе командир. Собери войско у военного стола, веди его к дворцу и вырежи восьмерых стражников.',
        zone: ZONE.EMPIRE,
        targetFaction: FACTION.EMPIRE,
        goal: 8,
        reward: { gold: 500, xp: 400, rep: { villain: 22, empire: -30 } },
      }),
    () =>
      makeOrder({
        type: ORDER.DEFEND,
        title: 'Эльфы в горах',
        text: 'Эльфийские шпионы повадились ходить к форту. Перебей пятерых — пусть лес запомнит дорогу обратно.',
        zone: ZONE.VILLAIN,
        goal: 5,
        wave: { faction: FACTION.ELVES, count: 5 },
        reward: { gold: 200, xp: 180, rep: { villain: 14, elves: -16 } },
      }),
    () =>
      makeOrder({
        type: ORDER.ROB,
        title: 'Обобрать корован',
        text: 'Казна форта пуста. На дорогах ходят корованы — это твоя казна, просто она пока едет.',
        goal: 1,
        reward: { gold: 80, xp: 130, rep: { villain: 10, humans: -12 } },
      }),
    () =>
      makeOrder({
        type: ORDER.RAID,
        title: 'Выжечь лес',
        text: 'Эльфы мешают. Убей пятерых в их лесу, чтобы больше не мешали.',
        zone: ZONE.ELVES,
        targetFaction: FACTION.ELVES,
        goal: 5,
        reward: { gold: 210, xp: 190, rep: { villain: 12, elves: -20 } },
      }),
  ],
};

export class OrderSystem {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.completed = 0;
    this.holdTimer = 0;
    this.available = null;
    this.disobeyWarnings = 0;
  }

  /** Предлагает задание. За Злодея игрок выбирает сам — приказов ему никто не даёт. */
  offer(factionId) {
    const gens = GENERATORS[factionId];
    if (!gens || !gens.length) return null;
    if (this.current && !this.current.done) return this.current;

    const order = gens[Math.floor(Math.random() * gens.length)]();
    if (order.type === ORDER.DEFEND && !order.point) {
      const hub = ZONE_BY_ID[order.zone]?.hub;
      if (hub) order.point = { x: hub.x, z: hub.z };
    }
    this.available = order;
    return order;
  }

  accept(order) {
    this.current = order;
    this.available = null;
    this.holdTimer = order.holdTime || 0;
    this.game.onOrderAccepted?.(order);
    return order;
  }

  abandon() {
    if (!this.current) return null;
    const order = this.current;
    this.current = null;
    // Стража за брошенный приказ теряет доверие — за неподчинение положено.
    if (this.game.player?.faction === FACTION.EMPIRE) {
      this.game.reputation.change(FACTION.EMPIRE, -12);
      this.game.log('Ты бросил приказ. Командир этого не забудет.', 'bad');
    }
    return order;
  }

  /** Учёт убийства для заданий вида «убей N». */
  notifyKill(victim) {
    const o = this.current;
    if (!o || o.done) return;
    const counts =
      (o.type === ORDER.RAID || o.type === ORDER.ASSAULT || o.type === ORDER.HUNT || o.type === ORDER.DEFEND);
    if (!counts) return;
    const wanted = o.targetFaction || o.wave?.faction;
    if (wanted && victim.faction !== wanted) return;
    if (o.zone && this.game.world.zoneAt(victim.position.x, victim.position.z).id !== o.zone) return;
    o.progress++;
    this.game.onOrderProgress?.(o);
    if (o.progress >= o.goal) this.complete();
  }

  notifyRob() {
    const o = this.current;
    if (!o || o.done || o.type !== ORDER.ROB) return;
    o.progress++;
    if (o.progress >= o.goal) this.complete();
    else this.game.onOrderProgress?.(o);
  }

  complete() {
    const o = this.current;
    if (!o || o.done) return;
    o.done = true;
    this.completed++;
    const player = this.game.player;
    if (o.reward) {
      player.gold += o.reward.gold || 0;
      const levels = player.addXp(o.reward.xp || 0);
      for (const [fid, delta] of Object.entries(o.reward.rep || {})) {
        this.game.reputation.change(fid, delta);
      }
      if (levels > 0) this.game.log(`Новый уровень: ${player.level}!`, 'good');
    }
    this.game.onOrderComplete?.(o);
    this.current = null;
  }

  update(dt) {
    const o = this.current;
    if (!o || o.done) return;

    // Задание «держать пост»: надо стоять рядом с точкой заданное время.
    if (o.type === ORDER.PATROL && o.point) {
      const p = this.game.player.position;
      const d = Math.hypot(p.x - o.point.x, p.z - o.point.z);
      if (d < 22) {
        this.holdTimer -= dt;
        o.progress = 1 - this.holdTimer / o.holdTime;
        if (this.holdTimer <= 0) this.complete();
      }
    }
  }

  /** Строка задачи для интерфейса. */
  describe() {
    const o = this.current;
    if (!o) return null;
    let progress = '';
    if (o.type === ORDER.PATROL) {
      progress = `осталось ${Math.max(0, Math.ceil(this.holdTimer))} с`;
    } else if (o.goal > 1) {
      progress = `${o.progress} / ${o.goal}`;
    }
    return { title: o.title, text: o.text, progress };
  }

  serialize() {
    return { current: this.current, completed: this.completed, holdTimer: this.holdTimer };
  }

  load(data) {
    if (!data) return;
    this.current = data.current || null;
    this.completed = data.completed || 0;
    this.holdTimer = data.holdTimer || 0;
  }
}

// ─────────────────────────────── войско Злодея ───────────────────────────────

/**
 * Отряд под личным командованием игрока. Доступен Злодею через военный стол:
 * «приказ своим войскам с ним самим напасть на дворец» — как в задании.
 */
export class Squad {
  constructor(game) {
    this.game = game;
    this.members = [];
    this.command = 'hold';
  }

  add(npc) {
    npc.squad = this;
    this.members.push(npc);
  }

  get alive() {
    return this.members.filter((m) => m.alive);
  }

  /** @param {'follow'|'hold'|'attack'} command */
  issue(command, point = null) {
    this.command = command;
    for (const m of this.alive) {
      switch (command) {
        case 'follow':
          m.orderFollow(this.game.player);
          m.sightRange = 40;
          break;
        case 'attack':
          if (point) m.orderGoto(new THREE.Vector3(point.x, 0, point.z));
          m.sightRange = 55;
          m.leader = null;
          break;
        case 'hold':
        default:
          m.leader = null;
          m.state = STATE.PATROL;
          m.home.copy(m.position);
          m.sightRange = 34;
          break;
      }
    }
  }

  update() {
    // Убитых убираем из списка, чтобы счётчик в интерфейсе был честным.
    for (let i = this.members.length - 1; i >= 0; i--) {
      if (!this.members[i].alive) this.members.splice(i, 1);
    }
  }
}
