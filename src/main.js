import { Game } from './game/game.js';

const bootMsg = document.getElementById('boot-msg');
const boot = document.getElementById('boot');

function fail(err) {
  console.error(err);
  if (bootMsg) {
    bootMsg.className = 'msg err';
    bootMsg.textContent = 'SK8.IO could not start: ' + (err?.message || err) + '. Try a recent Chrome, Edge or Firefox with hardware acceleration enabled.';
  }
}

try {
  const canvas = document.getElementById('game');
  const game = new Game(canvas, document.getElementById('ui'));
  window.__sk8 = game; // handy for debugging from the console
  game.start();
  requestAnimationFrame(() => setTimeout(() => boot?.classList.add('done'), 150));
} catch (err) {
  fail(err);
}
