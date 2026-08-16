// Увечья: отрубленные руки и ноги, выбитые глаза, протезы, кровотечение.
//
// Правила ровно те, что в задании:
//   • рука — если не вылечат, персонаж умирает от кровопотери;
//   • глаз — не смертельно, но половина экрана не видна; спасает протез;
//   • нога — либо смерть, либо ползаешь, либо катаешься в коляске, либо протез.
import { PART } from '../entities/humanoid.js';

export const LIMB_LABEL = {
  [PART.ARM_L]: 'левая рука',
  [PART.ARM_R]: 'правая рука',
  [PART.LEG_L]: 'левая нога',
  [PART.LEG_R]: 'правая нога',
  [PART.HEAD]: 'голова',
};

/** Винительный падеж: «отрубил правую руку», а не «отрубил правая рука». */
export const LIMB_ACCUSATIVE = {
  [PART.ARM_L]: 'левую руку',
  [PART.ARM_R]: 'правую руку',
  [PART.LEG_L]: 'левую ногу',
  [PART.LEG_R]: 'правую ногу',
  [PART.HEAD]: 'голову',
};

/** Родительный падеж: «нет левой руки». */
export const LIMB_GENITIVE = {
  [PART.ARM_L]: 'левой руки',
  [PART.ARM_R]: 'правой руки',
  [PART.LEG_L]: 'левой ноги',
  [PART.LEG_R]: 'правой ноги',
  [PART.HEAD]: 'головы',
};

/** Сколько секунд есть на то, чтобы остановить кровь. */
export const BLEEDOUT_SECONDS = 75;

export const MOBILITY = {
  NORMAL: 'normal',
  PROSTHETIC: 'prosthetic',
  WHEELCHAIR: 'wheelchair',
  CRAWL: 'crawl',
};

export class Injuries {
  constructor() {
    this.missing = { [PART.ARM_L]: false, [PART.ARM_R]: false, [PART.LEG_L]: false, [PART.LEG_R]: false };
    this.prosthetic = { [PART.ARM_L]: false, [PART.ARM_R]: false, [PART.LEG_L]: false, [PART.LEG_R]: false };
    /** 'ok' | 'lost' | 'prosthetic' */
    this.eyeL = 'ok';
    this.eyeR = 'ok';
    /** Незалеченных кровоточащих культей. */
    this.bleedingWounds = 0;
    this.bleedTimer = 0;
    this.usesWheelchair = false;
    this.hasWheelchair = false;
  }

  get anyMissing() {
    return Object.values(this.missing).some(Boolean);
  }

  get isBleeding() {
    return this.bleedingWounds > 0;
  }

  get legsLost() {
    return (this.missing[PART.LEG_L] ? 1 : 0) + (this.missing[PART.LEG_R] ? 1 : 0);
  }

  get armsLost() {
    return (this.missing[PART.ARM_L] ? 1 : 0) + (this.missing[PART.ARM_R] ? 1 : 0);
  }

  get legsWorking() {
    let n = 0;
    for (const k of [PART.LEG_L, PART.LEG_R]) {
      if (!this.missing[k] || this.prosthetic[k]) n++;
    }
    return n;
  }

  get armsWorking() {
    let n = 0;
    for (const k of [PART.ARM_L, PART.ARM_R]) {
      if (!this.missing[k] || this.prosthetic[k]) n++;
    }
    return n;
  }

  get eyesLost() {
    return (this.eyeL === 'lost' ? 1 : 0) + (this.eyeR === 'lost' ? 1 : 0);
  }

  /** Как персонаж передвигается — от этого зависят скорость и прыжок. */
  get mobility() {
    if (this.legsLost === 0) return MOBILITY.NORMAL;
    if (this.usesWheelchair && this.hasWheelchair) return MOBILITY.WHEELCHAIR;
    if (this.legsWorking === 2) return MOBILITY.PROSTHETIC; // обе ноги на месте или протезированы
    if (this.legsWorking === 1 && this.legsLost === 1 && this.prosthetic[PART.LEG_L] === false && this.prosthetic[PART.LEG_R] === false) {
      return MOBILITY.CRAWL;
    }
    if (this.legsWorking >= 1 && (this.prosthetic[PART.LEG_L] || this.prosthetic[PART.LEG_R])) {
      return MOBILITY.PROSTHETIC;
    }
    return MOBILITY.CRAWL;
  }

  get speedMultiplier() {
    switch (this.mobility) {
      case MOBILITY.NORMAL:
        return 1;
      case MOBILITY.PROSTHETIC:
        return this.legsLost === 2 ? 0.66 : 0.82;
      case MOBILITY.WHEELCHAIR:
        return 0.6;
      case MOBILITY.CRAWL:
        return 0.22;
      default:
        return 1;
    }
  }

  get canJump() {
    return this.mobility === MOBILITY.NORMAL || this.mobility === MOBILITY.PROSTHETIC;
  }

  get canAttack() {
    return this.armsWorking > 0;
  }

  /** Урон падает, если бьёшь протезом или единственной оставшейся рукой. */
  get damageMultiplier() {
    if (this.armsWorking === 0) return 0;
    let m = this.armsWorking === 1 ? 0.7 : 1;
    if (this.prosthetic[PART.ARM_R] && this.missing[PART.ARM_R]) m *= 0.85;
    return m;
  }

  /** Разброс прицела: одним глазом хуже видно расстояние. */
  get aimPenalty() {
    const lost = this.eyesLost;
    if (lost === 0) return 0;
    return lost === 1 ? 0.35 : 1.2;
  }

  /** Какую половину экрана закрывать: 'none' | 'left' | 'right' | 'both'. */
  get visionMask() {
    const l = this.eyeL === 'lost';
    const r = this.eyeR === 'lost';
    if (l && r) return 'both';
    if (l) return 'left';
    if (r) return 'right';
    return 'none';
  }

  /**
   * Отрубает конечность.
   * @returns {{ok: boolean, reason?: string}}
   */
  sever(part) {
    if (!(part in this.missing) || this.missing[part]) return { ok: false };
    this.missing[part] = true;
    this.prosthetic[part] = false;
    this.bleedingWounds++;
    if (this.bleedTimer <= 0) this.bleedTimer = BLEEDOUT_SECONDS;
    else this.bleedTimer = Math.min(this.bleedTimer, BLEEDOUT_SECONDS * 0.6); // вторая рана торопит
    return { ok: true };
  }

  /** Выбивает глаз. Не смертельно — просто полэкрана не видно. */
  loseEye(side) {
    const key = side === 'left' ? 'eyeL' : 'eyeR';
    if (this[key] !== 'ok') return { ok: false };
    this[key] = 'lost';
    return { ok: true };
  }

  /** Перевязка: останавливает кровь, но конечность не возвращает. */
  stopBleeding() {
    if (this.bleedingWounds === 0) return false;
    this.bleedingWounds = 0;
    this.bleedTimer = 0;
    return true;
  }

  attachProsthetic(part) {
    if (!(part in this.missing)) return false;
    if (!this.missing[part] || this.prosthetic[part]) return false;
    this.prosthetic[part] = true;
    return true;
  }

  attachEyeProsthetic() {
    let done = false;
    if (this.eyeL === 'lost') {
      this.eyeL = 'prosthetic';
      done = true;
    } else if (this.eyeR === 'lost') {
      this.eyeR = 'prosthetic';
      done = true;
    }
    return done;
  }

  /**
   * Ход времени. Возвращает урон от кровопотери за этот кадр.
   * Когда таймер выходит — персонаж умирает, как и написано в ТЗ.
   */
  tick(dt) {
    if (this.bleedingWounds <= 0) return { damage: 0, died: false };
    this.bleedTimer -= dt;
    if (this.bleedTimer <= 0) {
      this.bleedTimer = 0;
      return { damage: 0, died: true };
    }
    // Кровь понемногу отнимает здоровье, чтобы игрок чувствовал угрозу.
    return { damage: dt * 0.55 * this.bleedingWounds, died: false };
  }

  /** Короткое перечисление увечий для интерфейса. */
  describe() {
    const out = [];
    for (const part of [PART.ARM_L, PART.ARM_R, PART.LEG_L, PART.LEG_R]) {
      if (!this.missing[part]) continue;
      out.push(this.prosthetic[part] ? `${LIMB_LABEL[part]} — протез` : `нет ${LIMB_GENITIVE[part]}`);
    }
    if (this.eyeL === 'lost' || this.eyeR === 'lost') out.push('выбит глаз');
    if (this.eyeL === 'prosthetic' || this.eyeR === 'prosthetic') out.push('глазной протез');
    if (this.mobility === MOBILITY.WHEELCHAIR) out.push('в коляске');
    if (this.mobility === MOBILITY.CRAWL) out.push('ползёт');
    if (this.isBleeding) out.push('кровотечение!');
    return out;
  }

  serialize() {
    return {
      missing: { ...this.missing },
      prosthetic: { ...this.prosthetic },
      eyeL: this.eyeL,
      eyeR: this.eyeR,
      bleedingWounds: this.bleedingWounds,
      bleedTimer: this.bleedTimer,
      usesWheelchair: this.usesWheelchair,
      hasWheelchair: this.hasWheelchair,
    };
  }

  static deserialize(data) {
    const inj = new Injuries();
    if (!data) return inj;
    Object.assign(inj.missing, data.missing || {});
    Object.assign(inj.prosthetic, data.prosthetic || {});
    inj.eyeL = data.eyeL || 'ok';
    inj.eyeR = data.eyeR || 'ok';
    inj.bleedingWounds = data.bleedingWounds || 0;
    inj.bleedTimer = data.bleedTimer || 0;
    inj.usesWheelchair = !!data.usesWheelchair;
    inj.hasWheelchair = !!data.hasWheelchair;
    return inj;
  }
}
