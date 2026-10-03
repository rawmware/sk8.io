# SK8.IO — module contracts

Build: Vite + three.js (`three@0.186`, `three-mesh-bvh@0.9`). Plain ES modules (JavaScript, no TypeScript).
Units: meters / seconds / radians. World is right-handed, **Y up**. No external assets — every
texture, model and sound is generated procedurally in code (canvas textures, BufferGeometry, WebAudio).
Everything must be original (no real-brand logos, no copyrighted art).

Shared files (read-only for module authors; ask the integrator to change them):
- `src/core/constants.js` — board dimensions, gravity, surface + rail kinds.
- `src/core/customization.js` — appearance/board option catalogs + defaults.

Each module owns its folder. Don't edit other folders. The integrator (`src/game/*`, `src/main.js`)
wires everything together.

---------------------------------------------------------------------------------------------------
## 1. World — `src/world/index.js`  (owner: world agent)

```js
export function createWorld(renderer, scene) => World
World = {
  colliders: THREE.Mesh[],      // static rideable/solid meshes. world matrices final (matrixAutoUpdate=false ok).
                                //   mesh.userData.surface = one of SURFACES (constants.js)
                                //   geometry must be indexed or non-indexed BufferGeometry; integrator builds BVHs.
                                //   Rideable transitions must be SMOOTH (>= 20 segments per quarter pipe) and meet the
                                //   ground tangentially with no gaps or steps. Don't add thin rails as colliders.
  rails: Rail[],                // grindable lines: { a: Vector3, b: Vector3, kind: 'metal'|'coping'|'concrete'|'wood', radius: number }
                                //   a/b = world-space contact line (top of the rail / ledge edge / coping top)
  spawn: { position: Vector3, yaw: number },       // yaw: rotation about +Y, 0 = facing +Z
  spots: [{ name, position: Vector3, yaw }],       // named teleport spots (plaza, bowl, vert, stairs, hill...)
  sun: THREE.DirectionalLight,
  update(dt, focus: Vector3, camera),              // move shadow camera to follow focus, animate anything ambient
  // ---- Object dropper ----
  catalog: [{ id, name, category }],               // droppable objects
  placeObject(id, position: Vector3, yaw) => handle // adds visuals + colliders + rails, returns handle {id, group, ...}
  removeObject(handle),
  placed: handle[],
  makeGhost(id) => THREE.Object3D                   // translucent preview mesh for the dropper
  onChange: null | (() => void),                    // call whenever colliders/rails change (integrator rebuilds caches)
  serialize() => [{id, x, y, z, yaw}], deserialize(list),
  // ---- Dynamic props (knockable cones/trash cans/etc) ----
  props: [{ object3d, radius, velocity: Vector3, ... }], // optional simple physics, integrator may push them
  kickProp(prop, impulse: Vector3)
}
```

## 2. Character — `src/character/skater.js`  (owner: character agent)

```js
export class Skater {
  constructor(appearance)               // appearance: see DEFAULT_APPEARANCE
  object3d: THREE.Object3D              // add to scene; casts shadows
  setAppearance(appearance)
  update(dt, pose)                      // procedural animation, see Pose below
  bail(velocity: Vector3, spin: Vector3, collide)   // switch to verlet ragdoll
  updateRagdoll(dt)                     // integrator calls instead of update() while ragdolling
  isRagdoll: boolean
  getRagdollCenter(target: Vector3) => Vector3      // pelvis world position (camera follows it)
  endRagdoll()
}
// collide(center: Vector3, radius) => null | { normal: Vector3, depth: number }  (push-out along normal)
Pose = {
  rider: THREE.Matrix4,   // rider frame. origin = board wheel-contact point, +Y = rider up (surface normal),
                          // +Z = direction of the rider's FRONT foot (toward the board nose in the normal case)
  board: THREE.Matrix4,   // actual board world matrix (board-local frame per constants.js). Can flip/spin.
  stance: 'regular'|'goofy', // regular: left foot forward, chest faces rider -X; goofy: right foot forward, chest +X
  state: 'ride'|'push'|'brake'|'powerslide'|'air'|'grind'|'slide'|'manual'|'nosemanual',
  crouch: 0..1,           // knee bend (pop loading, landing compression)
  lean: -1..1,            // carve: +1 = turning left (toward +X of rider frame)
  pushPhase: 0..1,        // push cycle when state==='push' (0 lift, 0.25 foot down, 0.6 foot up, 1 back on board)
  feetOnBoard: boolean,   // false while the board is flipping: feet hover above the board in the rider frame
  flick: number,          // -1..1 front foot kick direction for flip tricks (+ = toward rider +X), 0 = none
  flickT: 0..1,           // progress of the flick kick animation
  tuck: 0..1,             // knees pulled up in the air
  grab: null|'indy'|'melon'|'nose'|'tail'|'stalefish'|'mute',
  slide: 0..1,            // powerslide amount (board turned sideways)
  armSwing: -1..1,        // body spin wind-up (+ = counter-clockwise from above)
  velocity: THREE.Vector3,
  speed: number,
  time: number,
}
```
Feet: when `feetOnBoard`, use 2-bone IK to put feet on the board at BOARD.frontFootZ / BOARD.backFootZ
(or backFootPopZ when crouch > 0.6) on top of the deck. Body stands sideways on the board (stance).

## 3. Board model — `src/board/board.js` (owner: integrator)

```js
export function createBoard(config) => { object3d, setConfig(config), setWheelSpin(rad), setTruckLean(-1..1) }
```

## 4. UI — `src/ui/index.js` (owner: ui/audio agent)

DOM overlay on top of the canvas (`#ui` root). Styled like a premium skate game (clean, bold, condensed type).
```js
export function createUI({ root, appearance, board, settings, previewHooks }) => UI
UI = {
  screen: 'title'|'playing'|'paused'|'customize'|'controls'|'settings'|'dropper',
  show(screen), on(event, cb)            // events: 'start','resume','customize','appearance' (appearance obj),
                                         //   'board' (board cfg), 'settings' (settings obj), 'teleport' (spot name),
                                         //   'resetPlacedObjects', 'quit'
  trick(text, { quality: 'clean'|'sketchy'|'bail', sub?: string })  // trick callouts (bottom center, stacked line)
  lineEnd()                                // line finished (fade the chain)
  toast(text)                              // small notification
  setHud({ speedKmh, gamepad: bool, marker: bool })
  setDropper({ visible, items: catalog, selected: index, hint })     // object dropper bar
  setSpots(spots)                          // names for the teleport menu
  setControlsHint(text|null)
}
Settings = { mouseSensitivity: 0.2..3, invertFlickY: bool, stance: 'regular'|'goofy', cameraFov: 60..100,
             cameraDistance: 0.6..1.6, masterVolume: 0..1, sfxVolume, musicVolume, quality: 'low'|'medium'|'high',
             showTrickNames: bool, gestureGuide: bool }
```

## 5. Audio — `src/audio/index.js` (owner: ui/audio agent)

```js
export function createAudio() => Audio
Audio = {
  resume()                               // call on first user gesture
  setVolumes({ master, sfx, music })
  update(dt, { speed, grounded, surface, grinding: null|'metal'|'concrete'|'wood'|'coping',
               sliding: bool, powerslide: bool, airborne: bool, manual: bool })
  play(name, intensity = 1)  // 'pop','land','landHard','catch','flip','bail','push','grindStart','slideStart',
                             // 'boardHit','footBrake','uiClick','uiHover','uiBack','placeObject','removeObject','whoosh'
}
```
