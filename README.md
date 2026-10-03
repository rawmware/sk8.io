# sk8.io

An original, board-focused 3D skateboarding playground built for the browser. Harbor Park includes a bowl, quarter pipe, street ramps, stairs, rails, and manual pads. Three starting spots share the same connected park.

## Play the rough beta

[Play sk8.io on RawmWare — Day 7](https://rawmware.com/365-days/projects/day-007)

I was bored and wanted to try something new. This is a rough beta — just an idea for now. Expect bugs and unfinished gameplay.

For development, run `npm ci`, `npm run dev`, or build with `npm run build` and preview with `npm run preview`. Use the address printed by the development tool.

## Controls

| Action | Keyboard | Standard controller |
| --- | --- | --- |
| Push | W / up | A / Cross |
| Steer | A D / left right | Left stick |
| Brake | S / down | D-pad down |
| Charge, then ollie | Hold and release Space | Hold and release RT / R2 |
| Kickflip / heelflip | J / K while airborne | X / Square, B / Circle |
| 360 shuvit | U while airborne | Y / Triangle |
| Spin | Hold Q / E in air | LB / L1, RB / R1 |
| Grind | Hold G, land along a flat rail | LT / L2 |
| Manual | Hold Shift while rolling | Left stick click |
| Reset | R | View / Share |
| Pause | Escape | Menu / Options |
| Camera | C | Right stick or camera button |
| Park editor | B | On-screen button |

On touchscreens, hold PUSH, steer with the left pad, and hold/release FLICK for an ollie. Swipe the flick pad sideways for flips or down for a shuvit. The spin, grind, and manual buttons support simultaneous touches. Landscape gives more room.

## Features and current scope

- Three.js WebGL 2 rendering, an original shaped board with trucks/wheels/grip, concrete park geometry, shadows, and two lighting settings.
- Fixed 120 Hz custom board simulation: momentum, friction, slope acceleration, charged pop, rotation timing, landing alignment, bails, flat-rail grind locks, and manuals.
- Trick combinations with a three-second bank window, a multiplier, and a saved best line.
- Deck/wheel colors and truck response saved on the current device.
- Place, rotate, and undo up to 24 rails, ramps, or ledges. Saved locally with overlap checks.
- Keyboard, multitouch, and standard Gamepad API mappings; performance graphics option.
- All fonts and game assets are bundled locally. No runtime API, account, CDN, or game download is required.

This first playable build is ready for feel testing. It is a new board-only game, not a port or an exact simulation of the original iOS Skater or Skate 3. There is no animated human rider, multiplayer, or cloud save. The stair handrail is scenery; the separate flat rails support grinds. Real phone and physical controller testing remains part of the user playtest.

## Development and validation

```sh
npm run dev
npm test
npm run build
```

The physics tests cover momentum, braking, ollies, completed/failed flips, bowl sampling, ledge collisions, grind scoring, and frame-rate independence. `tests/browser-smoke.js` is an agent-browser evaluation script exercising keyboard play, pause, saved setup, spawn changes, obstacle placement/undo, and simulated standard-gamepad mappings through public input events. It does not directly change the simulation state. `window.sk8.snapshot()` exposes read-only diagnostics for playtesting.

Production files are in `dist/`. Vite uses relative asset paths, so the same build can be hosted at a domain root or under a subpath. The playable build is hosted on RawmWare as Day 7.

## References

The supplied Internet Archive metadata identified Skater 1.6.5 for iOS 8. The IPA was inspected as an archive; none of its executable, artwork, audio, or game data is used. The supplied [skate3-ios-setup repository](https://github.com/andrewnakas/skate3-ios-setup) contains an iOS setup/build workflow, rather than a browser engine. This project uses original code and procedural geometry, plus Three.js (MIT), Vite (MIT), and Barlow Condensed/DM Sans fonts (SIL OFL).
