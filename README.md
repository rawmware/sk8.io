# SK8.IO

A skateboarding simulator that runs in the browser. Right now it's **board-only** (no rider model) while the
gameplay feel is tuned. It has real physics, analog **flick-it** trick controls
(mouse or right stick) with click-to-catch flips, grinds and slides, manuals, a skatepark, an object dropper,
and a customizable board.

Everything is generated in code with three.js: the park, the board, the textures and the audio.
There are no downloaded assets. All the art and branding is original.

## Play

| How | What to do |
| --- | --- |
| **Hosted** | Merge to `main`. GitHub Actions builds and deploys to GitHub Pages at `https://rawmware.github.io/sk8.io/` (in the repo, enable *Settings → Pages → Source: GitHub Actions* once). |
| **Desktop shortcut** | Copy one of the files in [`shortcuts/`](shortcuts) to your desktop: `SK8.IO.url` for Windows, `SK8.IO.webloc` for macOS, `SK8.IO.desktop` for Linux. They open the hosted game. |
| **Offline, one file** | Run `npm run build:single` and double-click `dist-single/index.html`. It's fully self-contained and works from `file://`. |
| **Dev** | `npm install && npm run dev` then open the printed URL. |

Use Chrome, Edge or Firefox with hardware acceleration enabled. Plug in any controller (Xbox, PlayStation or
other standard-mapping pad) and press a button.

## Controls

### Keyboard + mouse
| Input | Action |
| --- | --- |
| **Hold left click** | Set up the trick: while holding, pull the mouse back (toward you) to load the tail, then flick it forward or sideways |
| **Release left click** | Pop the trick you drew. A faster flick pops higher |
| **Left click in the air** | Catch. Flips and shove-its keep spinning until you catch them: click as the board comes back around. Catch after two rotations for a double |
| **W** | Push (hold to keep pushing) |
| **S** | Foot brake, or powerslide at speed |
| **A / D** | Carve; on the ground, wind up for a spin; in the air, spin |
| **Space** | Simple ollie (hold, then release); tap in the air to catch |
| **Q / E** | Manual / nose manual (hold) |
| **Right click** in the air | Grab (add **D** for heel side, **W**/**S** for nose/tail). Let go before landing |
| **W / S** while locking onto a rail | Nose grinds and slides / 5-0s and tailslides (add **A/D** for crooked/smith/feeble) |
| **R** | Respawn |
| **T / Y** | Set spot marker / return to marker |
| **F** | Object dropper |
| **C** | Customize |
| **V** | Camera mode |
| **Esc** | Pause menu |

### Controller
Left stick: steer and spin · Right stick: flick-it tricks (pops when you reach the end of the flick) · A: push, or catch in the air · B: brake/powerslide · X: simple ollie ·
LT/RT: grabs · LB/RB: manual/nose manual · D-pad up/down: set/return to marker · View: object dropper ·
Menu: pause · Y: respawn · R3: camera

### Flick-it tricks (regular stance; goofy mirrors left/right)
| Trick | Stick |
| --- | --- |
| Ollie | ↓ then ↑ |
| Nollie (and nollie variations) | ↑ then ↓ |
| Kickflip / Heelflip | ↓ then ↖ / ↗ |
| Double flips | any flip, caught after the second rotation |
| Pop shove-it (BS / FS) | ↓ then ← / → |
| 360 shove-it | ↓ ← ↑ (half circle) |
| Varial kickflip / Varial heelflip | ↓ ← ↖ / ↓ → ↗ |
| Hardflip / Inward heelflip | ↓ → ↖ / ↓ ← ↗ |
| 360 flip / Laser flip | ↓ ← ↑ ↗ / ↓ → ↑ ↖ (go past the top) |
| Late flips | flick in the air |

How high you pop depends on how hard and fast you flick. The board keeps rotating until you catch it, so a
weak pop leaves no time to catch, and a late or early click catches it crooked. Landing sideways, over-rotating, or still holding a grab when you land
will also make you bail.

## Project layout
```
src/
  core/        shared constants (board dimensions, gravity, surfaces) + customization catalog
  game/        game loop, physics controller, flick-it recognizer, input, camera, collision (BVH), object dropper
  board/       procedural skateboard model
  demo/        lightweight park used by the demo build (demo.html)
  world/       skatepark, environment, lighting, droppable objects
  ui/          menus, HUD, customization, controls screen
  audio/       procedural WebAudio sound design
tools/         headless physics checks (node tools/physics-sim.mjs, node tools/catch-sim.mjs)
```
See [`CONTRACTS.md`](CONTRACTS.md) for the module interfaces.
