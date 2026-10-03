import { boot } from '../boot.js';
import { createWorld } from './world-lite.js';
import { Skater } from './skater-lite.js';
import { createUI } from '../ui/index.js';
import { createAudio } from '../audio/index.js';

// Demo build: real physics/tricks/controls/UI/audio with a lightweight park + skater.
boot({ createWorld, Skater, createUI, createAudio });
