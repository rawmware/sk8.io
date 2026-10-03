import { Game } from './game/game.js';

export function boot(modules) {
  const bootMsg = document.getElementById('boot-msg');
  const bootEl = document.getElementById('boot');
  try {
    const canvas = document.getElementById('game');
    const game = new Game(canvas, document.getElementById('ui'), modules);
    window.__sk8 = game; // handy for debugging from the console
    game.start();
    requestAnimationFrame(() => setTimeout(() => bootEl?.classList.add('done'), 150));
    return game;
  } catch (err) {
    console.error(err);
    if (bootMsg) {
      bootMsg.className = 'msg err';
      bootMsg.textContent = 'SK8.IO could not start: ' + (err?.message || err) + '. Try a recent Chrome, Edge or Firefox with hardware acceleration enabled.';
    }
    return null;
  }
}
