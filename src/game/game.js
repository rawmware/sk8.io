import * as THREE from 'three';
import { createBoard } from '../board/board.js';
import { DEFAULT_APPEARANCE, DEFAULT_BOARD } from '../core/customization.js';
import { CollisionWorld } from './collision.js';
import { SkaterController } from './controller.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Dropper } from './dropper.js';

const MAX_STEP = 1 / 120;

const DEFAULT_SETTINGS = {
  mouseSensitivity: 1,
  invertFlickY: false,
  stance: 'regular',
  cameraFov: 74,
  cameraDistance: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0,
  quality: 'high',
  showTrickNames: true,
  gestureGuide: true,
};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('sk8io.' + key);
      return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  },
  getRaw(key, fallback) {
    try {
      const v = localStorage.getItem('sk8io.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('sk8io.' + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  // modules: { createWorld, Skater, createUI, createAudio } (injected so a lite demo build can swap them)
  constructor(canvas, uiRoot, modules) {
    const { createWorld, Skater, createUI, createAudio } = modules;
    this.canvas = canvas;
    this.settings = store.get('settings', DEFAULT_SETTINGS);
    this.appearance = store.get('appearance', DEFAULT_APPEARANCE);
    this.boardCfg = store.get('board', DEFAULT_BOARD);

    // ---- renderer ----
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.cameraFov, 1, 0.05, 2000);
    this._applyQuality();

    // ---- world ----
    this.world = createWorld(renderer, this.scene);
    this.collision = new CollisionWorld();
    this.collision.setStatic(this.world.colliders);
    this.staticRails = [...this.world.rails];

    // ---- skater + board ----
    this.controller = new SkaterController(this.collision);
    this.controller.stance = this.settings.stance;
    this.board = createBoard(this.boardCfg);
    this.board.object3d.matrixAutoUpdate = false;
    this.scene.add(this.board.object3d);
    this.skater = new Skater(this.appearance);
    this.scene.add(this.skater.object3d);
    this.pose = {
      rider: new THREE.Matrix4(),
      board: new THREE.Matrix4(),
      velocity: new THREE.Vector3(),
      stance: 'regular',
      state: 'ride',
      crouch: 0,
      lean: 0,
      pushPhase: 0,
      feetOnBoard: true,
      flick: 0,
      flickT: 1,
      tuck: 0,
      grab: null,
      slide: 0,
      armSwing: 0,
      speed: 0,
      time: 0,
    };

    // dropped objects (restored from the last session)
    this.world.onChange = () => this._syncPlaced();
    const placed = store.getRaw('placed', []);
    if (Array.isArray(placed) && placed.length) {
      try {
        this.world.deserialize(placed);
      } catch (e) {
        console.warn('could not restore placed objects', e);
      }
    }
    this._syncPlaced();

    this.rig = new CameraRig(this.camera, this.collision);
    this.rig.distance = 2.9 * this.settings.cameraDistance;
    this.input = new Input(canvas);
    this.input.mouseSensitivity = this.settings.mouseSensitivity;
    this.input.invertFlickY = this.settings.invertFlickY;
    this.dropper = new Dropper(this.world, this.collision, this.scene);
    this.audio = createAudio();
    this.audio.setVolumes({ master: this.settings.masterVolume, sfx: this.settings.sfxVolume, music: this.settings.musicVolume });

    // ---- UI ----
    this.previewYaw = 0;
    this.ui = createUI({
      root: uiRoot,
      appearance: this.appearance,
      board: this.boardCfg,
      settings: this.settings,
      previewHooks: {
        enter: () => (this.previewing = true),
        exit: () => (this.previewing = false),
        rotate: (d) => (this.previewYaw += d),
      },
    });
    this.ui.setSpots?.(this.world.spots || []);
    this._wireUI();

    this.mode = 'title';
    this.controller.teleport(this.world.spawn.position, this.world.spawn.yaw);
    this.rig.snap(this.controller.pos, this.world.spawn.yaw);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.hintTimer = 0;

    window.addEventListener('resize', () => this._resize());
    this._resize();
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked && this.mode === 'playing' && this.hadPointerLock && !this.dropper.active) this.pause();
      this.hadPointerLock = this.input.pointerLocked;
    });
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.pause();
    });
    window.addEventListener('pointerdown', () => this.audio.resume(), { once: false });
    window.addEventListener('keydown', () => this.audio.resume());
  }

  // -------------------------------------------------------------------------------------------
  _wireUI() {
    const ui = this.ui;
    ui.on('start', () => this.play());
    ui.on('resume', () => this.play());
    ui.on('customize', () => this.openCustomize());
    ui.on('dropper', () => this.openDropper());
    ui.on('teleport', (name) => {
      const s = (this.world.spots || []).find((sp) => sp.name === name);
      if (s) {
        this.controller.teleport(s.position, s.yaw);
        this.rig.snap(this.controller.pos, s.yaw);
      }
      this.play();
    });
    ui.on('resetPlacedObjects', () => {
      for (const h of [...this.world.placed]) this.world.removeObject(h);
      this._syncPlaced();
      ui.toast?.('Dropped objects cleared');
    });
    ui.on('quit', () => {
      this.mode = 'title';
      this.input.mouseEnabled = false;
      this.input.exitPointerLock();
      ui.show('title');
    });
    ui.on('appearance', (a) => {
      this.appearance = { ...this.appearance, ...a };
      this.skater.setAppearance(this.appearance);
      store.set('appearance', this.appearance);
    });
    ui.on('board', (b) => {
      this.boardCfg = { ...this.boardCfg, ...b };
      this.board.setConfig(this.boardCfg);
      store.set('board', this.boardCfg);
    });
    ui.on('settings', (s) => {
      this.settings = { ...this.settings, ...s };
      store.set('settings', this.settings);
      this.input.mouseSensitivity = this.settings.mouseSensitivity;
      this.input.invertFlickY = this.settings.invertFlickY;
      this.controller.stance = this.settings.stance;
      this.camera.fov = this.settings.cameraFov;
      this.camera.updateProjectionMatrix();
      this.rig.distance = 2.9 * this.settings.cameraDistance;
      this.audio.setVolumes({ master: this.settings.masterVolume, sfx: this.settings.sfxVolume, music: this.settings.musicVolume });
      this._applyQuality();
    });
    ui.on('back', () => {
      if (this.mode === 'customize') this.closeCustomize();
    });
  }

  _applyQuality() {
    const q = this.settings.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 0.85) : dpr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this._resize?.();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _syncPlaced() {
    this.collision.clearDynamic();
    const rails = [...this.staticRails];
    for (const h of this.world.placed) {
      if (h.colliders?.length) this.collision.setDynamic(h, h.colliders);
      if (h.rails) rails.push(...h.rails);
    }
    // the world may also publish dropped-object rails directly in world.rails
    for (const r of this.world.rails) if (!rails.includes(r)) rails.push(r);
    this.controller.rails = rails;
    store.set('placed', this.world.serialize());
  }

  // -------------------------------------------------------------------------------------------
  play() {
    if (this.mode === 'customize') this.closeCustomize(true);
    if (this.dropper.active) this.dropper.exit();
    this.mode = 'playing';
    this.ui.show('playing');
    this.input.mouseEnabled = true;
    this.input.requestPointerLock();
    this.audio.resume();
    this.clock.getDelta();
    if (!this.introShown) {
      this.introShown = true;
      this.hintTimer = 9;
      this.ui.setControlsHint?.('W push · A/D carve · pull the mouse back then flick forward to ollie · Esc menu');
    }
  }

  pause() {
    if (this.mode !== 'playing' && this.mode !== 'dropper') return;
    if (this.dropper.active) this.dropper.exit();
    this.mode = 'paused';
    this.input.mouseEnabled = false;
    this.input.exitPointerLock();
    this.ui.show('paused');
  }

  openCustomize() {
    this.prevMode = this.mode === 'title' ? 'title' : 'paused';
    this.mode = 'customize';
    this.input.mouseEnabled = false;
    this.input.exitPointerLock();
    this.previewYaw = 0;
    this.ui.show('customize');
  }

  closeCustomize(silent) {
    this.previewing = false;
    if (!silent) {
      this.mode = this.prevMode || 'title';
      this.ui.show(this.mode === 'title' ? 'title' : 'paused');
    }
  }

  openDropper() {
    if (this.controller.mode === 'bail') this.controller.respawn();
    this.mode = 'dropper';
    this.ui.show('dropper');
    this.input.mouseEnabled = true;
    this.input.requestPointerLock();
    this.dropper.enter(this.controller.pos, this.rig.heading);
    this._updateDropperUI();
  }

  _updateDropperUI() {
    this.ui.setDropper?.({
      visible: this.mode === 'dropper',
      items: this.world.catalog,
      selected: this.dropper.index,
      hint: 'WASD move · Q/E rotate · Wheel / 1-9 select · Click / Enter drop · X remove · F done',
    });
  }

  // -------------------------------------------------------------------------------------------
  start() {
    this.ui.show('title');
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.time += dt;
    this._fps = this._fps ? this._fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    const inp = this.input.poll(dt);
    const ui = this.ui;

    // ---- global menu navigation (gamepad / arrows) ----
    if (this.mode !== 'playing' && this.mode !== 'dropper') {
      if (inp.nav) ui.navigate?.(inp.nav);
      if (inp.navStart && this.mode === 'paused') this.play();
    }

    switch (this.mode) {
      case 'playing':
        this._play(dt, inp);
        break;
      case 'dropper': {
        const act = this.dropper.update(dt, inp, this.camera);
        if (act === 'select') this._updateDropperUI();
        if (act === 'place') this.audio.play('placeObject');
        if (act === 'remove') this.audio.play('removeObject');
        if (inp.dropper || inp.pause || inp.padMenuBack) {
          this.dropper.exit();
          this.mode = 'playing';
          ui.setDropper?.({ visible: false, items: this.world.catalog, selected: this.dropper.index });
          ui.show('playing');
          this.input.requestPointerLock();
        }
        this._animateSkater(dt);
        break;
      }
      case 'customize': {
        // close-up turntable of the skater
        const c = this.controller.pos;
        const yaw = this.rig.heading + Math.PI + this.previewYaw;
        _v.set(c.x + Math.sin(yaw) * 3.0, c.y + 1.15, c.z + Math.cos(yaw) * 3.0);
        this.camera.position.lerp(_v, 1 - Math.exp(-6 * dt));
        _v2.set(c.x, c.y + 0.95, c.z);
        this.camera.lookAt(_v2);
        this._animateSkater(dt, true);
        if (inp.pause && !ui.handlesEscape) this.closeCustomize();
        break;
      }
      default: {
        // title / paused: gentle orbit around the skater
        if (this.mode === 'title') this.rig.orbit(dt, this.controller.pos, 6.5, 1.9, 0.1);
        this._animateSkater(dt, true);
        if (this.mode === 'paused' && inp.pause && !ui.handlesEscape) this.play();
      }
    }

    this.world.update(dt, this.controller.mode === 'bail' && this.skater.isRagdoll ? this.skater.getRagdollCenter(_v) : this.controller.pos, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  _animateSkater(dt, idle = false) {
    const c = this.controller;
    if (this.skater.isRagdoll && c.mode !== 'bail') this.skater.endRagdoll();
    if (this.skater.isRagdoll) this.skater.updateRagdoll(dt);
    else this.skater.update(dt, c.getPose(this.pose));
    this.board.object3d.matrix.copy(c.boardMatrix(this.board.object3d.matrix));
    this.board.object3d.matrixWorldNeedsUpdate = true;
    this.board.setWheelSpin(c.wheelSpin);
    this.board.setTruckLean(c.lean);
    if (idle) this.audio.update(dt, { speed: 0, grounded: true, surface: c.surface, grinding: null, sliding: false, powerslide: false, airborne: false, manual: false });
  }

  _play(dt, inp) {
    const c = this.controller;
    const ui = this.ui;

    if (inp.pause) return this.pause();
    if (inp.customize) return this.openCustomize();
    if (inp.dropper) return this.openDropper();
    if (inp.camera) this.rig.mode = (this.rig.mode + 1) % 3;
    if (inp.setMarker) {
      if (c.setMarker()) {
        ui.toast?.('Spot marker set');
        this.audio.play('uiClick');
      }
    }
    if (inp.toMarker) {
      if (this.skater.isRagdoll) this.skater.endRagdoll();
      if (c.gotoMarker()) this.rig.snap(c.pos, this.rig.heading);
      else ui.toast?.('No marker set — press T (D-pad up) to set one');
    }
    if (inp.respawn && c.mode !== 'bail') {
      c.respawn();
    }

    // ---- physics: variable sub-steps (<= 1/120s) keep motion smooth at any refresh rate ----
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) c.step(h, inp);
    this._handleEvents(c.events);
    c.events.length = 0;

    // ---- visuals ----
    this._animateSkater(dt);

    // props: knock cones & trash cans around
    if (this.world.props && c.mode !== 'bail') {
      for (const p of this.world.props) {
        const o = p.object3d;
        const dx = o.position.x - c.pos.x;
        const dz = o.position.z - c.pos.z;
        const r = (p.radius || 0.3) + 0.35;
        if (dx * dx + dz * dz < r * r && Math.abs(o.position.y - c.pos.y) < 1.2 && c.speed > 0.8) {
          const imp = _v.copy(c.vel).multiplyScalar(1.1);
          imp.y += 1.2 + c.speed * 0.25;
          this.world.kickProp?.(p, imp);
          this.audio.play('boardHit', Math.min(1, c.speed / 6));
        }
      }
    }

    // ---- camera ----
    const ragdoll = this.skater.isRagdoll;
    const target = ragdoll ? this.skater.getRagdollCenter(_v2) : c.pos;
    const facing = Math.atan2(c.fwd(_v).x, c.fwd(_v).z);
    this.rig.update(dt, target, ragdoll ? c.board.vel.clone().multiplyScalar(0) : c.vel, { airborne: c.mode === 'air' || ragdoll, facing });

    // ---- audio ----
    this.audio.update(dt, {
      speed: c.mode === 'grind' ? c.grind?.speed || 0 : c.speed,
      grounded: c.mode === 'ground',
      surface: c.surface,
      grinding: c.mode === 'grind' ? c.grind?.kind || 'metal' : null,
      sliding: c.mode === 'grind' && !!c.grind?.slide,
      powerslide: c.slide > 0.4,
      airborne: c.mode === 'air',
      manual: !!c.manual,
    });

    // ---- HUD ----
    ui.setHud?.({ speedKmh: c.speed * 3.6, gamepad: this.input.gamepadConnected, marker: !!c.marker });
    if (this.settings.gestureGuide) {
      const f = inp.flick;
      ui.setFlickStick?.({ x: f.x, y: f.y, loaded: c.flick.loaded });
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) ui.setControlsHint?.(null);
    }
  }

  _handleEvents(events) {
    const ui = this.ui;
    const a = this.audio;
    for (const e of events) {
      switch (e.type) {
        case 'pop':
          a.play('pop', 0.6 + 0.4 * (e.power ?? 1));
          this.input.rumble(0.35, 60);
          break;
        case 'flip':
          a.play('flip');
          break;
        case 'catch':
          a.play('catch');
          break;
        case 'land':
          a.play('land', e.intensity);
          this.input.rumble(0.3 * e.intensity, 70);
          break;
        case 'landHard':
          a.play('landHard', e.intensity);
          this.input.rumble(0.7, 120);
          break;
        case 'push':
          a.play('push');
          break;
        case 'grindStart':
          a.play('grindStart', 1);
          this.input.rumble(0.25, 60);
          break;
        case 'slideStart':
          a.play('slideStart', 1);
          break;
        case 'boardHit':
          a.play('boardHit', e.intensity ?? 0.6);
          break;
        case 'powerslide':
          break;
        case 'trick':
          if (this.settings.showTrickNames) ui.trick?.(e.text, { quality: e.quality });
          break;
        case 'lineEnd':
          ui.lineEnd?.();
          break;
        case 'bail': {
          a.play('bail');
          this.input.rumble(1, 260);
          if (this.settings.showTrickNames) ui.trick?.('Bail', { quality: 'bail', sub: e.reason });
          ui.lineEnd?.();
          const spin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
          this.skater.bail(e.velocity || this.controller.vel.clone(), spin, (center, radius) => this.collision.sphere(center, radius));
          break;
        }
        case 'respawn':
          if (this.skater.isRagdoll) this.skater.endRagdoll();
          this.rig.snap(this.controller.pos, Math.atan2(this.controller.fwd(_v).x, this.controller.fwd(_v).z));
          break;
      }
    }
  }
}
