// Звук. Как и вся графика в игре, он генерируется кодом — ни одного файла.
//
// Каждый эффект просчитывается в AudioBuffer один раз при запуске обычной
// математикой по сэмплам, а дальше просто проигрывается с разной высотой тона.
// Так игра остаётся без ассетов, а звучит живо.

const SAMPLE_RATE = 44100;

/** Однополюсный фильтр низких частот — им «затемняются» шумовые звуки. */
function lowpass(data, cutoff) {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += (data[i] - y) * cutoff;
    data[i] = y;
  }
}

/** Однополюсный фильтр высоких частот. */
function highpass(data, cutoff) {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += (data[i] - y) * cutoff;
    data[i] -= y;
  }
}

function normalize(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  if (max < 1e-6) return;
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
    this.masterVolume = 0.75;
    this.ready = false;
    this._ambient = null;
    this._ambientZone = null;
    this._listener = { x: 0, y: 0, z: 0, right: { x: 1, z: 0 } };
    this._birdTimer = 3;
  }

  /**
   * Браузеры не дают заводить звук до действия пользователя,
   * поэтому контекст создаётся по первому клику.
   */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.masterVolume : 0;
    this.master.connect(this.ctx.destination);
    this._buildAll();
    this.ready = true;
  }

  _buffer(seconds, fill) {
    const n = Math.floor(SAMPLE_RATE * seconds);
    const buf = this.ctx.createBuffer(1, n, SAMPLE_RATE);
    const data = buf.getChannelData(0);
    fill(data, n);
    return buf;
  }

  _buildAll() {
    const B = (name, seconds, fill) => {
      this.buffers[name] = this._buffer(seconds, fill);
    };
    const rnd = () => Math.random() * 2 - 1;

    // Свист клинка: шум с колоколообразной огибающей, приглушённый фильтром.
    B('swoosh', 0.26, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.sin(Math.PI * t) ** 2;
        d[i] = rnd() * env;
      }
      lowpass(d, 0.16);
      highpass(d, 0.02);
      normalize(d, 0.5);
    });

    // Глухой удар по телу: низкая синусоида, съезжающая вниз, плюс щелчок.
    B('thud', 0.3, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 22);
        const freq = 110 - 55 * (i / n);
        d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.9 + rnd() * env * env * 0.35;
      }
      normalize(d, 0.85);
    });

    // Звон по железу: несколько несогласованных обертонов с быстрым затуханием.
    B('clang', 0.42, (d, n) => {
      const parts = [1180, 1790, 2610, 3350];
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        let s = 0;
        for (let k = 0; k < parts.length; k++) {
          s += Math.sin(2 * Math.PI * parts[k] * t) * Math.exp(-t * (13 + k * 6)) / (k + 1);
        }
        d[i] = s * 0.6 + rnd() * Math.exp(-t * 60) * 0.3;
      }
      normalize(d, 0.7);
    });

    // Отсечение конечности: мокрый хруст — шум с «уезжающим» фильтром и низом.
    B('sever', 0.55, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 9);
        const crack = Math.exp(-t * 45) * rnd();
        const body = Math.sin(2 * Math.PI * (70 - 30 * (i / n)) * t) * env;
        d[i] = rnd() * env * 0.7 + crack * 0.9 + body * 0.8;
      }
      lowpass(d, 0.24);
      normalize(d, 0.95);
    });

    // Тетива.
    B('bow', 0.3, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 17);
        d[i] =
          (Math.sin(2 * Math.PI * 190 * t) + 0.45 * Math.sin(2 * Math.PI * 385 * t)) * env * 0.7 +
          rnd() * Math.exp(-t * 90) * 0.5;
      }
      normalize(d, 0.65);
    });

    // Стрела вошла в цель.
    B('tick', 0.14, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        d[i] = rnd() * Math.exp(-t * 70);
      }
      highpass(d, 0.25);
      normalize(d, 0.6);
    });

    // Шаг.
    B('step', 0.12, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        d[i] = rnd() * Math.exp(-t * 55);
      }
      lowpass(d, 0.1);
      normalize(d, 0.35);
    });

    // Прыжок и приземление.
    B('land', 0.2, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 30);
        d[i] = Math.sin(2 * Math.PI * 80 * t) * env * 0.8 + rnd() * env * 0.4;
      }
      lowpass(d, 0.2);
      normalize(d, 0.6);
    });

    // Золото.
    B('coin', 0.35, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const a = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 16);
        const b = Math.sin(2 * Math.PI * 2250 * t) * Math.exp(-(t - 0.06) * 16) * (t > 0.06 ? 1 : 0);
        d[i] = (a + b) * 0.5;
      }
      normalize(d, 0.5);
    });

    // Предсмертный вскрик: голосовая формантная «а» с падением тона.
    B('death', 0.7, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const f = 240 - 130 * (i / n);
        const env = Math.exp(-t * 4) * Math.min(1, t * 40);
        const vib = 1 + Math.sin(2 * Math.PI * 6 * t) * 0.04;
        d[i] =
          (Math.sin(2 * Math.PI * f * vib * t) +
            0.5 * Math.sin(2 * Math.PI * f * 2.4 * t) +
            0.25 * Math.sin(2 * Math.PI * f * 3.7 * t)) *
          env * 0.4;
      }
      normalize(d, 0.6);
    });

    // Игрока ударили.
    B('hurt', 0.28, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 12) * Math.min(1, t * 60);
        d[i] = (Math.sin(2 * Math.PI * 165 * t) + 0.6 * Math.sin(2 * Math.PI * 330 * t)) * env * 0.5;
      }
      normalize(d, 0.7);
    });

    // Новый уровень.
    B('levelup', 0.8, (d, n) => {
      const notes = [523, 659, 784, 1047];
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const step = Math.min(notes.length - 1, Math.floor(t / 0.11));
        const local = t - step * 0.11;
        d[i] = Math.sin(2 * Math.PI * notes[step] * t) * Math.exp(-local * 11) * 0.4;
      }
      normalize(d, 0.5);
    });

    // Тревога: враг заметил игрока.
    B('alert', 0.4, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        d[i] = Math.sin(2 * Math.PI * (330 + 220 * t) * t) * Math.exp(-t * 6) * 0.4;
      }
      normalize(d, 0.45);
    });

    // Птичья трель для леса.
    B('bird', 0.35, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const wob = Math.sin(2 * Math.PI * 14 * t);
        const f = 2600 + wob * 700;
        d[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7) * Math.min(1, t * 50) * 0.25;
      }
      normalize(d, 0.28);
    });

    // Зацикленный ветер — основа окружения.
    B('wind', 4.0, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = rnd();
      lowpass(d, 0.006);
      // Медленные порывы.
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        d[i] *= 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.13 * t) * Math.sin(2 * Math.PI * 0.31 * t + 1);
      }
      // Сводим края, чтобы петля не щёлкала.
      const fade = Math.floor(SAMPLE_RATE * 0.25);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] *= k;
        d[n - 1 - i] *= k;
      }
      normalize(d, 0.5);
    });
  }

  /** Слушатель — камера игрока. right нужен для панорамирования. */
  setListener(position, yaw) {
    this._listener.x = position.x;
    this._listener.y = position.y;
    this._listener.z = position.z;
    // Вектор «вправо» при заданном рыскании.
    this._listener.right.x = Math.cos(yaw);
    this._listener.right.z = -Math.sin(yaw);
  }

  /**
   * @param {string} name имя эффекта
   * @param {{position?:{x,y,z}, volume?:number, rate?:number}} opts
   */
  play(name, opts = {}) {
    if (!this.ready || !this.enabled) return null;
    const buf = this.buffers[name];
    if (!buf) return null;

    let gain = opts.volume ?? 1;
    let pan = 0;

    if (opts.position) {
      const dx = opts.position.x - this._listener.x;
      const dy = (opts.position.y ?? 0) - this._listener.y;
      const dz = opts.position.z - this._listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 70) return null; // слишком далеко, чтобы тратить узел
      gain *= 1 / (1 + (dist / 6) ** 1.5);
      if (dist > 0.2) {
        pan = Math.max(-1, Math.min(1, (dx * this._listener.right.x + dz * this._listener.right.z) / dist));
      }
    }
    if (gain < 0.005) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    let node = src;
    node.connect(g);
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    src.start();
    return src;
  }

  /** Фоновый ветер, громкость и тон которого зависят от зоны. */
  startAmbient() {
    if (!this.ready || this._ambient) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.wind;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    src.connect(g);
    g.connect(this.master);
    src.start();
    this._ambient = { src, gain: g };
  }

  /** Подстраивает окружение под зону: в горах ветер, в лесу птицы. */
  updateAmbient(zoneId, dt) {
    if (!this.ready) return;
    this.startAmbient();
    if (!this._ambient) return;

    const profile = {
      villain: { volume: 0.5, rate: 0.85, birds: 0 },
      elves: { volume: 0.16, rate: 1.15, birds: 0.5 },
      empire: { volume: 0.24, rate: 1.0, birds: 0.12 },
      humans: { volume: 0.2, rate: 1.05, birds: 0.2 },
    }[zoneId] || { volume: 0.2, rate: 1, birds: 0.1 };

    const g = this._ambient.gain.gain;
    g.value += (profile.volume - g.value) * Math.min(1, dt * 0.8);
    const r = this._ambient.src.playbackRate;
    r.value += (profile.rate - r.value) * Math.min(1, dt * 0.8);

    if (profile.birds > 0) {
      this._birdTimer -= dt;
      if (this._birdTimer <= 0) {
        this._birdTimer = 2 + Math.random() * 7 / profile.birds;
        this.play('bird', {
          volume: 0.3 + Math.random() * 0.3,
          rate: 0.85 + Math.random() * 0.4,
          position: {
            x: this._listener.x + (Math.random() - 0.5) * 30,
            y: this._listener.y + 8,
            z: this._listener.z + (Math.random() - 0.5) * 30,
          },
        });
      }
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.masterVolume : 0;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }
}
