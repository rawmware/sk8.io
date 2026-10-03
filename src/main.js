import { boot } from './boot.js';
import { createWorld } from './world/index.js';
import { Skater } from './character/skater.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';

boot({ createWorld, Skater, createUI, createAudio });
