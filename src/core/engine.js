// Рендерер, сцена, камера, освещение и игровой цикл.
import * as THREE from 'three';

export const VIEW_DISTANCE = 900;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb3d9);
    this.scene.fog = new THREE.Fog(0x8fb3d9, VIEW_DISTANCE * 0.35, VIEW_DISTANCE);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, VIEW_DISTANCE * 1.6);
    this.camera.rotation.order = 'YXZ';

    this._setupLights();

    this._lastTime = 0;
    this.running = false;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x5d7346, 1.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 2.0);
    this.sun.position.set(120, 200, 80);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Тени рисуем только вокруг игрока — иначе карта теней на весь мир слишком груба.
    const S = 90;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 520;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /** Двигает источник тени вслед за игроком, сохраняя направление солнца. */
  followSun(target) {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x + 120, target.y + 200, target.z + 80);
  }

  /** Меняет цвет неба и тумана — используется при переходе между зонами. */
  setSky(color, fogNear, fogFar) {
    this.scene.background.set(color);
    this.scene.fog.color.set(color);
    this.scene.fog.near = fogNear;
    this.scene.fog.far = fogFar;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  }

  /** Запускает цикл. update получает шаг времени в секундах. */
  start(update) {
    this.running = true;
    this._lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      // Ограничиваем шаг: после сворачивания вкладки перерыв может быть огромным.
      const dt = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;
      update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
