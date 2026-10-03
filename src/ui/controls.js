// Controls reference screen content.
import { h, svg, keycap } from './dom.js';
import { ICONS } from './icons.js';
import { GESTURES, gestureSVG } from './gestures.js';

const K = (t) => keycap(t, 'key');
const KW = (t) => keycap(t, 'key wide');
const PAD = (t) => keycap(t, 'pad pad-' + t.toLowerCase());
const SH = (t) => keycap(t, 'shoulder');
const STICK = (t) => keycap(t, 'stick');
const ICON = (name, title) => h('span', { class: 'kc kc-icon', title }, svg(ICONS[name]));
const or = () => h('span', { class: 'kc-or', text: '/' });
const plus = () => h('span', { class: 'kc-or', text: '+' });

function bind(keys, action, note) {
  return h('div', { class: 'bind' },
    h('div', { class: 'bind-keys' }, keys),
    h('div', { class: 'bind-act' }, h('span', { class: 'bind-name', text: action }), note ? h('span', { class: 'bind-note', text: note }) : null));
}
const group = (title, ...rows) => h('div', { class: 'bind-group' }, h('h4', { text: title }), rows);

export function buildControlsContent() {
  const kbm = h('section', { class: 'ctl-col' },
    h('header', { class: 'ctl-col-head' }, h('span', { class: 'ctl-col-icon' }, svg(ICONS.mouse)), h('h3', { text: 'Keyboard + Mouse' })),
    group('Flick stick',
      bind([ICON('mouseL', 'Hold left click')], 'Set up the trick', 'Hold, pull the mouse back to load the tail, flick it forward / sideways'),
      bind([ICON('mouseL', 'Release left click')], 'Pop', 'Letting go pops the trick you drew — a faster flick pops higher'),
      bind([ICON('mouseL', 'Click in the air')], 'Catch', 'Flips spin until you catch them. Click as the board comes back around'),
      bind([KW('Space')], 'Simple ollie', 'Hold to crouch, release to pop · tap in the air to catch')),
    group('Riding',
      bind([K('W')], 'Push', 'Hold to keep pushing'),
      bind([K('S')], 'Brake', 'Powerslide at speed'),
      bind([K('A'), K('D')], 'Carve', 'Spin while in the air'),
      bind([K('Q'), or(), K('E')], 'Manual / Nose manual', 'Hold')),
    group('Air & grinds',
      bind([ICON('mouseR', 'Right click')], 'Grab', 'In the air · + D heel side · + W / S nose / tail · let go before landing'),
      bind([K('W'), or(), K('S')], 'Grind variation', 'As you lock on: S 5-0 / tailslide · W nosegrind / noseslide. Press a new one mid-grind to switch'),
      bind([K('S'), plus(), K('A'), K('D')], 'Smith / Feeble · Bluntslide', 'Holding W/S in the air makes A/D pick the variation instead of spinning'),
      bind([K('W'), plus(), K('A'), K('D')], 'Crooked / Overcrook · Noseblunt', 'Toward the far side of the rail vs. back toward you'),
      bind([K('S'), plus(), K('A'), or(), K('D')], 'Revert', 'Right after landing: brake + steer whips the board 180')),
    group('Session',
      bind([K('R')], 'Respawn'),
      bind([K('T'), or(), K('Y')], 'Set marker / Return to marker'),
      bind([K('F')], 'Object dropper'),
      bind([K('C')], 'Customize'),
      bind([KW('Esc')], 'Pause')));

  const pad = h('section', { class: 'ctl-col' },
    h('header', { class: 'ctl-col-head' }, h('span', { class: 'ctl-col-icon' }, svg(ICONS.gamepad)), h('h3', { text: 'Controller' })),
    group('Flick stick',
      bind([STICK('RS')], 'Flick-it tricks', 'Pull down to load, flick to pop — see gestures'),
      bind([PAD('A')], 'Catch', 'In the air, as the board comes back around'),
      bind([PAD('X')], 'Simple ollie')),
    group('Riding',
      bind([STICK('LS')], 'Steer', 'Spin while in the air'),
      bind([PAD('A')], 'Push'),
      bind([PAD('B')], 'Brake', 'Powerslide at speed'),
      bind([SH('LB'), or(), SH('RB')], 'Manual / Nose manual', 'Hold')),
    group('Air & grinds',
      bind([SH('LT'), or(), SH('RT')], 'Grabs', 'Toe side / heel side'),
      bind([STICK('LS')], 'Grind variation', 'Down 5-0 / tailslide · up nosegrind / noseslide · add left/right for smith, feeble, crooked, blunts'),
      bind([PAD('B'), plus(), STICK('LS')], 'Revert', 'Right after landing')),
    group('Session',
      bind([PAD('Y')], 'Respawn'),
      bind([ICON('dpadUp', 'D-pad up'), or(), ICON('dpadDown', 'D-pad down')], 'Set marker / Return to marker'),
      bind([ICON('view', 'View')], 'Object dropper'),
      bind([ICON('menu', 'Menu')], 'Pause')));

  const ges = h('section', { class: 'ctl-col ctl-gestures' },
    h('header', { class: 'ctl-col-head' }, h('span', { class: 'ctl-col-icon accent' }, svg(gestureSVG(GESTURES[0]))), h('h3', { text: 'Flick-it gestures' })),
    h('p', { class: 'ctl-note', text: 'Right stick, or mouse while holding left click (release to pop). Start dot = where the stick goes first. Catch flips with a click (A on a controller) — catch after two rotations for a double.' }),
    h('div', { class: 'gest-grid' },
      GESTURES.map((g) =>
        h('div', { class: 'gest' },
          svg(gestureSVG(g), 'gest-svg'),
          h('div', { class: 'gest-txt' }, h('span', { class: 'gest-name', text: g.name }), h('span', { class: 'gest-seq' + (/[a-z]/i.test(g.seq) ? ' words' : ''), text: g.seq }))))));

  return h('div', { class: 'ctl-cols' }, kbm, pad, ges);
}
