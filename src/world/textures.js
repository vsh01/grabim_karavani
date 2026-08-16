// Все текстуры рисуются на canvas прямо в браузере — в репозитории нет ни одного ассета.
import * as THREE from 'three';
import { makeRng, clamp } from '../core/utils.js';

const cache = new Map();

/** Создаёт текстуру один раз и запоминает её по ключу. */
function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, { repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Рассыпает по холсту цветные точки — основа почти всех наших материалов. */
function speckle(ctx, size, colors, count, minR, maxR, rng) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const x = rng() * size;
    const y = rng() * size;
    const r = minR + rng() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Дублируем у краёв, чтобы текстура бесшовно замыкалась.
    if (x < maxR) ctx.beginPath(), ctx.arc(x + size, y, r, 0, Math.PI * 2), ctx.fill();
    if (x > size - maxR) ctx.beginPath(), ctx.arc(x - size, y, r, 0, Math.PI * 2), ctx.fill();
    if (y < maxR) ctx.beginPath(), ctx.arc(x, y + size, r, 0, Math.PI * 2), ctx.fill();
    if (y > size - maxR) ctx.beginPath(), ctx.arc(x, y - size, r, 0, Math.PI * 2), ctx.fill();
  }
}

/** Мелкий шум для земли: скрывает растяжение больших полигонов ландшафта. */
export const groundDetail = () =>
  cached('groundDetail', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(1337);
    ctx.fillStyle = '#8e8e8e';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, ['#7d7d7d', '#9c9c9c', '#868686', '#a3a3a3'], 2600, 1, 4, rng);
    return finish(c, { repeat: 1 });
  });

export const woodPlanks = () =>
  cached('woodPlanks', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(77);
    ctx.fillStyle = '#8a6136';
    ctx.fillRect(0, 0, size, size);
    const plank = 32;
    for (let y = 0; y < size; y += plank) {
      const shade = 0.82 + rng() * 0.32;
      const r = Math.floor(138 * shade);
      const g = Math.floor(97 * shade);
      const b = Math.floor(54 * shade);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, y, size, plank - 2);
      // Волокна древесины.
      ctx.strokeStyle = `rgba(60,38,18,0.28)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const yy = y + 3 + rng() * (plank - 8);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        for (let x = 0; x <= size; x += 16) ctx.lineTo(x, yy + Math.sin(x * 0.05 + i) * 1.6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(44,28,12,0.55)';
      ctx.fillRect(0, y + plank - 2, size, 2);
    }
    return finish(c);
  });

export const bark = () =>
  cached('bark', () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(4242);
    ctx.fillStyle = '#5a4128';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(${30 + rng() * 50 | 0},${20 + rng() * 35 | 0},${10 + rng() * 20 | 0},0.6)`;
      ctx.lineWidth = 1 + rng() * 3;
      const x = rng() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= size; y += 8) ctx.lineTo(x + Math.sin(y * 0.08 + i) * 3, y);
      ctx.stroke();
    }
    return finish(c);
  });

export const stoneBlocks = () =>
  cached('stoneBlocks', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(909);
    ctx.fillStyle = '#a09a90';
    ctx.fillRect(0, 0, size, size);
    const bh = 32;
    for (let row = 0, y = 0; y < size; y += bh, row++) {
      const offset = row % 2 ? 32 : 0;
      for (let x = -64; x < size; x += 64) {
        const shade = 0.88 + rng() * 0.26;
        ctx.fillStyle = `rgb(${(214 * shade) | 0},${(208 * shade) | 0},${(194 * shade) | 0})`;
        ctx.fillRect(x + offset + 2, y + 2, 60, bh - 4);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x + offset + 2, y + bh - 6, 60, 4);
      }
    }
    speckle(ctx, size, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.05)'], 800, 1, 3, rng);
    return finish(c);
  });

export const thatch = () =>
  cached('thatch', () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(5150);
    ctx.fillStyle = '#8a7333';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 700; i++) {
      const g = 90 + rng() * 80;
      ctx.strokeStyle = `rgb(${(g * 1.35) | 0},${(g * 1.05) | 0},${(g * 0.45) | 0})`;
      ctx.lineWidth = 1 + rng() * 2;
      const x = rng() * size;
      const y = rng() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 8, y + 8 + rng() * 10);
      ctx.stroke();
    }
    return finish(c);
  });

/** Однотонная ткань с лёгким шумом — знамёна, палатки, тенты корованов. */
export const cloth = (hex, key) =>
  cached(`cloth${key}`, () => {
    const size = 64;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(31 + key.length * 7);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.10)'], 260, 1, 3, rng);
    return finish(c);
  });

/**
 * Небо: вертикальный градиент с облаками. Используется как фон сцены,
 * поэтому равнопрямоугольная развёртка (2:1).
 */
export function skyTexture(topHex, bottomHex) {
  return cached(`sky${topHex}${bottomHex}`, () => {
    const w = 1024;
    const h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, topHex);
    grad.addColorStop(0.34, topHex);
    grad.addColorStop(0.62, bottomHex);
    grad.addColorStop(1.0, bottomHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Облаков здесь намеренно нет: на равнопрямоугольной развёртке любое
    // пятно у полюса растягивается в клин и небо идёт заломами.
    // Чистый градиент к тому же лучше ложится на низкополигональную картинку.
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Пятно крови под трупом и отрубленной конечностью. */
export const bloodSplat = () =>
  cached('bloodSplat', () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(666);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * 34;
      const r = 6 + rng() * 20;
      ctx.fillStyle = `rgba(${110 + rng() * 40 | 0},${8 + rng() * 14 | 0},${10 + rng() * 12 | 0},${0.55 + rng() * 0.4})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });

/** Плоский цвет как текстура — удобно, когда материалу нужен map. */
export function flatColor(hex) {
  return cached(`flat${hex}`, () => {
    const c = canvas(4);
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 4, 4);
    return finish(c);
  });
}

export function tint(hex, amount) {
  const col = new THREE.Color(hex);
  col.offsetHSL(0, 0, clamp(amount, -1, 1));
  return col;
}
