// Ввод: клавиатура, мышь с захватом курсора (pointer lock).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    /** Клавиши, нажатые именно в этом кадре (для однократных действий). */
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.wheel = 0;
    this.locked = false;
    /** Пока открыто меню, игровой ввод глушится. */
    this.enabled = true;

    this._onKeyDown = (e) => {
      if (e.code === 'Tab' || e.code.startsWith('F') === false) {
        // Не даём браузеру прокручивать страницу пробелом и стрелками.
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
          e.preventDefault();
        }
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    };
    this._onMouseUp = (e) => this.buttons.delete(e.button);
    this._onWheel = (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
      this.onLockChange?.(this.locked);
    };
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  /** Однократное срабатывание: true только в кадре нажатия. */
  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  /** Однократное нажатие, работающее даже когда игровой ввод заглушён (для меню). */
  hitRaw(code) {
    return this.pressed.has(code);
  }

  mouseDown(btn) {
    return this.enabled && this.buttons.has(btn);
  }

  mouseHit(btn) {
    return this.enabled && this.buttonsPressed.has(btn);
  }

  /** Вызывается в конце кадра: сбрасывает однократные события и дельты мыши. */
  endFrame() {
    this.pressed.clear();
    this.buttonsPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Вектор движения от WASD в локальных осях (x — вбок, y — вперёд). */
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
  }
}
