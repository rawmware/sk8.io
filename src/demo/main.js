import { boot } from '../boot.js';
import { createWorld } from './world-lite.js';
import { createUI } from '../ui/index.js';
import { createAudio } from '../audio/index.js';

// Demo build: board-only gameplay (real physics, tricks, controls, UI, audio) in a lightweight park.
boot({ createWorld, Skater: null, createUI, createAudio });
