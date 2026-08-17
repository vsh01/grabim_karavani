// Игровой HUD: полосы, золото, задача, подсказки, журнал, компас, повязка на глазу.
import { MOBILITY } from '../systems/injury.js';
import { formatTime, clamp, angleDelta } from '../core/utils.js';

/** Компас показывает сектор в ±90° от направления взгляда. */
const COMPASS_HALF_ANGLE = Math.PI / 2;
const CARDINALS = [
  { label: 'С', bearing: 0 },
  { label: 'СВ', bearing: Math.PI / 4 },
  { label: 'В', bearing: Math.PI / 2 },
  { label: 'ЮВ', bearing: (Math.PI * 3) / 4 },
  { label: 'Ю', bearing: Math.PI },
  { label: 'ЮЗ', bearing: -(Math.PI * 3) / 4 },
  { label: 'З', bearing: -Math.PI / 2 },
  { label: 'СЗ', bearing: -Math.PI / 4 },
];

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.barHp = document.getElementById('bar-hp');
    this.barStam = document.getElementById('bar-stam');
    this.gold = document.getElementById('gold-value');
    this.zone = document.getElementById('zone-line');
    this.factionLine = document.getElementById('faction-line');
    this.status = document.getElementById('status-icons');
    this.objectiveTitle = document.getElementById('objective-title');
    this.objectiveText = document.getElementById('objective-text');
    this.hint = document.getElementById('hint');
    this.log = document.getElementById('log');
    this.weaponLine = document.getElementById('weapon-line');
    this.eyePatch = document.getElementById('eye-patch');
    this.vignette = document.getElementById('blood-vignette');
    this.hitFlash = document.getElementById('hit-flash');
    this.fade = document.getElementById('fade');
    this.crosshair = document.getElementById('crosshair');
    this.compassStrip = document.getElementById('compass-strip');
    this.danger = document.getElementById('danger');

    this._logLines = [];
    this._lastStatus = '';
    this._lastMask = '';
    this._hitFlash = 0;
    /** Пул элементов компаса: пересоздавать их каждый кадр было бы расточительно. */
    this._compassMarks = [];
  }

  /** Красная вспышка по краям, когда достаётся игроку. */
  flashHit(strength = 1) {
    this._hitFlash = Math.min(1, this._hitFlash + strength);
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  /** Сообщение в журнал. kind: '' | 'good' | 'bad' | 'gore' | 'gold' */
  addLog(text, kind = '') {
    const el = document.createElement('div');
    el.className = `log-line ${kind}`;
    el.textContent = text;
    this.log.prepend(el);
    this._logLines.push(el);
    // Строки живут 8 секунд, больше шести на экране не держим.
    setTimeout(() => {
      el.style.transition = 'opacity 0.6s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 600);
    }, 8000);
    while (this._logLines.length > 6) {
      const old = this._logLines.shift();
      old.remove();
    }
  }

  setHint(text) {
    if (text) {
      this.hint.innerHTML = text;
      this.hint.classList.add('on');
    } else {
      this.hint.classList.remove('on');
    }
  }

  setObjective(objective) {
    if (!objective) {
      this.objectiveTitle.textContent = 'ВОЛЬНАЯ ОХОТА';
      this.objectiveText.textContent =
        'Задания нет. Иди к своему командиру или грабь корованы на дорогах.';
      return;
    }
    this.objectiveTitle.textContent = objective.progress
      ? `ЗАДАЧА · ${objective.progress}`
      : 'ЗАДАЧА';
    this.objectiveText.textContent = objective.title;
  }

  fadeOut(on) {
    this.fade.classList.toggle('hidden', false);
    this.fade.classList.toggle('on', on);
  }

  /**
   * Компас: стороны света плюс отметки цели, ближайшего корована и дома.
   * Без него игрок просто не знает, куда идти, и мир кажется пустым.
   */
  updateCompass(game) {
    const p = game.player;
    if (!p || !this.compassStrip) return;

    const width = this.compassStrip.clientWidth || 420;
    const heading = -p.yaw; // 0 — на север (-Z), по часовой стрелке
    const marks = [];

    for (const c of CARDINALS) {
      marks.push({ label: c.label, bearing: c.bearing, cls: 'card' });
    }

    const bearingTo = (x, z) => Math.atan2(x - p.position.x, -(z - p.position.z));
    const distTo = (x, z) => Math.round(Math.hypot(x - p.position.x, z - p.position.z));

    // Ближайший корован — главная приманка игры, он должен быть видно всегда.
    const near = game.caravans.nearest(p.position);
    if (near) {
      const c = near.caravan;
      marks.push({
        label: `корован ${distTo(c.position.x, c.position.z)}м`,
        bearing: bearingTo(c.position.x, c.position.z),
        cls: 'caravan',
      });
    }

    // Точка текущего задания.
    const goal = game.objectivePoint();
    if (goal) {
      marks.push({
        label: `цель ${distTo(goal.x, goal.z)}м`,
        bearing: bearingTo(goal.x, goal.z),
        cls: 'goal',
      });
    }

    // Родное поселение.
    const home = game.homePoint();
    if (home) {
      marks.push({
        label: `дом ${distTo(home.x, home.z)}м`,
        bearing: bearingTo(home.x, home.z),
        cls: 'home',
      });
    }

    // Показываем только то, что попадает в сектор компаса.
    const visible = [];
    for (const m of marks) {
      const delta = angleDelta(heading, m.bearing);
      if (Math.abs(delta) > COMPASS_HALF_ANGLE) continue;
      visible.push({ ...m, x: width / 2 + (delta / COMPASS_HALF_ANGLE) * (width / 2) });
    }

    while (this._compassMarks.length < visible.length) {
      const el = document.createElement('div');
      el.className = 'compass-mark';
      this.compassStrip.appendChild(el);
      this._compassMarks.push(el);
    }
    for (let i = 0; i < this._compassMarks.length; i++) {
      const el = this._compassMarks[i];
      const m = visible[i];
      if (!m) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.className = `compass-mark ${m.cls}`;
      el.textContent = m.label;
      el.style.left = `${m.x}px`;
    }
  }

  update(game, dt = 0) {
    const p = game.player;
    if (!p) return;

    // Вспышка от полученного удара гаснет сама.
    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - dt * 3.2);
      this.hitFlash.style.opacity = String(this._hitFlash * 0.75);
    } else if (this.hitFlash.style.opacity !== '0') {
      this.hitFlash.style.opacity = '0';
    }

    this.updateCompass(game);
    this.danger.classList.toggle('on', game.inCombat);

    this.barHp.style.width = `${clamp((p.health / p.maxHealth) * 100, 0, 100)}%`;
    this.barStam.style.width = `${clamp((p.stamina / p.maxStamina) * 100, 0, 100)}%`;
    this.gold.textContent = Math.floor(p.gold);

    const zone = game.world.currentZone;
    this.zone.textContent = `${zone.index}. ${zone.name}`;
    this.factionLine.textContent = `${game.factionName} · ур. ${p.level}`;

    // Красная рамка при низком здоровье и при кровотечении.
    const hurt = 1 - p.health / p.maxHealth;
    const bleedPulse = p.injuries.isBleeding ? 0.25 + Math.sin(performance.now() / 260) * 0.12 : 0;
    this.vignette.style.opacity = String(clamp(Math.max(hurt > 0.5 ? (hurt - 0.5) * 1.6 : 0, bleedPulse), 0, 0.95));

    // Полэкрана не видно, если выбит глаз.
    const mask = p.injuries.visionMask;
    if (mask !== this._lastMask) {
      this._lastMask = mask;
      this.eyePatch.className = mask === 'none' ? 'hidden' : mask;
    }

    this._updateStatus(p);
    this._updateWeapon(p);
    this.crosshair.style.opacity = p.firstPerson ? '0.8' : '0.45';
  }

  _updateStatus(p) {
    const chips = [];
    if (p.injuries.isBleeding) {
      chips.push({
        text: `КРОВЬ · ${formatTime(p.injuries.bleedTimer)}`,
        danger: true,
      });
    }
    for (const line of p.injuries.describe()) {
      if (line === 'кровотечение!') continue;
      chips.push({ text: line, danger: line.startsWith('нет ') });
    }
    if (p.injuries.mobility === MOBILITY.CRAWL) chips.push({ text: 'ползком', danger: true });

    const key = chips.map((c) => c.text).join('|');
    if (key === this._lastStatus) return;
    this._lastStatus = key;

    this.status.innerHTML = '';
    for (const chip of chips) {
      const el = document.createElement('div');
      el.className = `status-chip${chip.danger ? ' danger' : ''}`;
      el.textContent = chip.text;
      this.status.appendChild(el);
    }
  }

  _updateWeapon(p) {
    const w = p.weapon;
    const arrows = p.inventory.count('arrows');
    let line = w.name;
    let sub = '';
    if (w.ranged) sub = `стрел: ${arrows}`;
    else sub = `урон ${w.damage} · шанс отрубить ${(w.sever * 100).toFixed(0)}%`;
    if (!p.injuries.canAttack) {
      line = 'нечем бить';
      sub = 'обеих рук нет';
    } else if (w.twoHanded && p.injuries.armsWorking < 2) {
      line = `${w.name} (не поднять)`;
      sub = 'для двуручника нужны обе руки';
    }
    const armor = p.inventory.armor;
    this.weaponLine.innerHTML = `${line}<small>${sub}</small><small>${armor ? armor.name : 'без брони'}</small>`;
  }
}
