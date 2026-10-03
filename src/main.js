import { boot } from './boot.js';
import { createWorld } from './world/index.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';

// Board-only for now: the rider model comes back once the gameplay feel is locked in.
boot({ createWorld, Skater: null, createUI, createAudio });
