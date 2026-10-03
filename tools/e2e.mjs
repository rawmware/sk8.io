// End-to-end smoke test: loads the game in headless Chromium, plays a little, screenshots.
// usage: node tools/e2e.mjs [url] [outDir]
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'tools/scratch/shots';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/01-title.png` });

const state = () =>
  page.evaluate(() => {
    const g = window.__sk8;
    if (!g) return null;
    const c = g.controller;
    return { mode: g.mode, cmode: c.mode, pos: c.pos.toArray().map((v) => +v.toFixed(2)), speed: +c.speed.toFixed(2), fps: g._fps };
  });

// start the game through the UI hook (as if the user clicked SKATE)
await page.evaluate(() => window.__sk8.play());
await page.waitForTimeout(800);
console.log('after start', await state());
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
console.log('after push', await state());
await page.screenshot({ path: `${out}/02-rolling.png` });

// kickflip with the mouse: hold left button, pull back, flick up-left, release, click to catch
await page.mouse.move(640, 360);
await page.mouse.down();
for (let i = 0; i < 6; i++) {
  await page.mouse.move(640, 360 + (i + 1) * 50);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(60);
for (let i = 0; i < 6; i++) await page.mouse.move(640 - (i + 1) * 30, 660 - (i + 1) * 90);
await page.mouse.up();
const popState = await state();
console.log('popped', popState);
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/03-flip.png` });
const trick = await page.evaluate(() => {
  const t = window.__sk8.controller.trick;
  return t ? { T: t.T, t: t.t, flips: t.flips, shove: t.shove } : null;
});
console.log('trick in air', trick);
// click when the board comes back around
if (trick) await page.waitForTimeout(Math.max(0, (trick.T - trick.t) * 1000 - 60));
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(900);
console.log('after catch', await state(), await page.evaluate(() => window.__sk8.ui && document.querySelector('#ui')?.innerText.slice(0, 200)));

// carve
await page.keyboard.down('KeyA');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${out}/04-carve.png` });

// force a bail to see the ragdoll
await page.evaluate(() => window.__sk8.controller.forceBail());
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/05-bail.png` });
await page.waitForTimeout(2600);
console.log('after bail', await state());

// teleport spots
const spots = await page.evaluate(() => (window.__sk8.world.spots || []).map((s) => s.name));
console.log('spots', spots);
for (let i = 0; i < spots.length; i++) {
  await page.evaluate((n) => {
    const g = window.__sk8;
    const s = g.world.spots.find((x) => x.name === n);
    g.controller.teleport(s.position, s.yaw);
    g.rig.snap(g.controller.pos, s.yaw);
  }, spots[i]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/10-spot-${i}.png` });
}

// menus
await page.evaluate(() => window.__sk8.pause());
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/20-pause.png` });
await page.evaluate(() => window.__sk8.openCustomize());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/21-customize.png` });
await page.evaluate(() => {
  window.__sk8.closeCustomize();
  window.__sk8.play();
  window.__sk8.openDropper();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/22-dropper.png` });

const perf = await page.evaluate(async () => {
  const g = window.__sk8;
  const info = g.renderer.info;
  return { calls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries };
});
console.log('render info', perf);
console.log('errors:\n' + (errors.slice(0, 30).join('\n') || 'none'));
await browser.close();
