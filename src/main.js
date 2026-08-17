// Точка входа: заводим движок, строим мир, показываем меню.
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Game } from './game.js';

const canvas = document.getElementById('viewport');
const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

function setStatus(text) {
  bootStatus.textContent = text;
}

async function main() {
  let engine;
  try {
    engine = new Engine(canvas);
  } catch (err) {
    setStatus('Не удалось запустить WebGL. Нужен браузер с поддержкой WebGL 2.');
    console.error(err);
    return;
  }

  const input = new Input(canvas);
  const game = new Game(engine, input);
  // Доступ к состоянию из консоли браузера — удобно для отладки.
  window.__game = game;

  setStatus('Готовим движок…');
  await game.buildWorld(setStatus);

  // Камера смотрит на дворец, пока игрок листает меню.
  const palace = game.world.hubPosition('empire');
  engine.camera.position.set(palace.x + 150, palace.y + 95, palace.z + 210);
  engine.camera.lookAt(palace.x, palace.y + 20, palace.z);

  boot.classList.add('done');
  setTimeout(() => boot.remove(), 600);
  game.screens.showMainMenu();

  // Браузер не даёт заводить звук до действия пользователя,
  // поэтому первый же клик или нажатие клавиши поднимает аудиоконтекст.
  const wakeAudio = () => game.audio.unlock();
  window.addEventListener('mousedown', wakeAudio);
  window.addEventListener('keydown', wakeAudio);

  // Клик по картинке возвращает захват курсора после меню.
  canvas.addEventListener('mousedown', () => {
    if (game.running && !game.screens.isOpen && game.player?.alive) input.requestLock();
  });

  // Esc: закрыть панель или открыть паузу.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (!game.running) return;
    e.preventDefault();
    if (game.screens.isOpen) {
      const screen = game.screens.current;
      // Из вложенных панелей возвращаемся в паузу, из остальных — в игру.
      if (['save', 'load', 'help', 'stats'].includes(screen)) game.screens.showPause();
      else game.screens.close();
    } else {
      game.screens.showPause();
    }
  });

  // Потеря захвата курсора во время игры ставит паузу — так удобнее.
  input.onLockChange = (locked) => {
    if (!locked && game.running && !game.screens.isOpen && game.player?.alive) {
      game.screens.showPause();
    }
  };

  engine.start((dt) => {
    game.update(dt);
    input.endFrame();
  });

  // Отладочная статистика по F3.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3' && game.world) {
      e.preventDefault();
      const f = game.world.forest;
      game.log(
        `Деревьев: ${f.treeCount}, из них 3D сейчас: ${f.nearCount}. Актёров: ${game.actors.length}.`,
      );
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Ошибка запуска: ${err.message}`);
});
