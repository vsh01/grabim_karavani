// Игровой HUD: полосы, золото, задача, подсказки, журнал, повязка на глазу.
import { MOBILITY } from '../systems/injury.js';
import { formatTime, clamp } from '../core/utils.js';

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
    this.fade = document.getElementById('fade');
    this.crosshair = document.getElementById('crosshair');

    this._logLines = [];
    this._lastStatus = '';
    this._lastMask = '';
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

  update(game) {
    const p = game.player;
    if (!p) return;

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
