// Flick-it gesture diagrams: tiny SVG stick-gate drawings.
// Waypoints: 'c' = stick centre, number = angle in degrees on the gate (0 = right, 90 = up/forward,
// 180 = left, 270 = down/back). Prefix '~' = travel along the gate rim (arc) to that angle,
// otherwise a straight line.

export const GESTURES = [
  { name: 'Ollie', seq: '↓ ↑', pts: ['c', 270, 90] },
  { name: 'Nollie', seq: '↑ ↓', pts: ['c', 90, 270] },
  { name: 'Kickflip', seq: '↓ ↖', pts: ['c', 270, 135] },
  { name: 'Heelflip', seq: '↓ ↗', pts: ['c', 270, 45] },
  { name: 'Double Flip', seq: 'Flick fast', pts: ['c', 270, 135], badge: '×2', fast: true },
  { name: 'BS Pop Shove-it', seq: '↓ ←', pts: ['c', 270, '~180'] },
  { name: 'FS Pop Shove-it', seq: '↓ →', pts: ['c', 270, '~360'] },
  { name: '360 Shove-it', seq: '↓ ← ↑', pts: ['c', 270, '~180', '~90'] },
  { name: 'Varial Kickflip', seq: '↓ ← ↖', pts: ['c', 270, '~180', '~135'] },
  { name: 'Varial Heelflip', seq: '↓ → ↗', pts: ['c', 270, '~360', '~405'] },
  { name: 'Hardflip', seq: '↓ → ↖', pts: ['c', 270, '~360', 135] },
  { name: 'Inward Heelflip', seq: '↓ ← ↗', pts: ['c', 270, '~180', 45] },
  { name: '360 Flip', seq: '↓ ← ↑ ↗', pts: ['c', 270, '~180', '~90', '~45'] },
  { name: 'Laser Flip', seq: '↓ → ↑ ↖', pts: ['c', 270, '~360', '~450', '~495'] },
  { name: 'Late Flips', seq: 'Flick in the air', pts: ['c', 270, 135], badge: 'AIR', dashed: true },
  { name: 'Spins', seq: 'Hold A / D · left stick', spin: true },
];

const R = 31;
const pt = (deg) => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * R, -Math.sin(a) * R];
};

function buildPoints(pts) {
  const out = [];
  let prevAngle = null;
  for (const p of pts) {
    if (p === 'c') {
      out.push([0, 0]);
      prevAngle = null;
      continue;
    }
    const arc = typeof p === 'string' && p[0] === '~';
    const ang = arc ? parseFloat(p.slice(1)) : p;
    if (arc && prevAngle != null) {
      // walk along the rim, choosing the shortest way round
      let d = ((ang - prevAngle) % 360 + 540) % 360 - 180;
      const steps = Math.max(2, Math.ceil(Math.abs(d) / 6));
      for (let i = 1; i <= steps; i++) out.push(pt(prevAngle + (d * i) / steps));
      prevAngle = prevAngle + d;
    } else {
      out.push(pt(ang));
      prevAngle = ang;
    }
  }
  return out;
}

const f = (n) => n.toFixed(1);

export function gestureSVG(g) {
  const gate = `
    <circle cx="0" cy="0" r="44" class="g-gate"/>
    <circle cx="0" cy="0" r="31" class="g-ring"/>
    <path d="M-44 0H44M0 -44V44" class="g-cross"/>`;
  if (g.spin) {
    return `<svg viewBox="-50 -50 100 100" class="gesture">${gate}
      <circle cx="0" cy="0" r="9" class="g-knob"/>
      <path d="M-14 -6 A 30 30 0 0 1 -40 -2" class="g-path"/>
      <path d="M14 -6 A 30 30 0 0 0 40 -2" class="g-path"/>
      <path d="M-44 -9 L-41 1 L-33 -6Z" class="g-head"/>
      <path d="M44 -9 L41 1 L33 -6Z" class="g-head"/>
      <text x="-27" y="27" class="g-label">A</text><text x="27" y="27" class="g-label">D</text>
    </svg>`;
  }
  const P = buildPoints(g.pts);
  const d = P.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
  // arrow head from last segment
  const a = P[P.length - 1];
  let b = P[P.length - 2];
  for (let i = P.length - 2; i >= 0; i--) {
    b = P[i];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 3) break;
  }
  const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
  const hl = 11, hw = 7;
  const tip = [a[0] + Math.cos(ang) * 4, a[1] + Math.sin(ang) * 4];
  const l = [tip[0] - Math.cos(ang) * hl + Math.cos(ang + Math.PI / 2) * hw, tip[1] - Math.sin(ang) * hl + Math.sin(ang + Math.PI / 2) * hw];
  const r = [tip[0] - Math.cos(ang) * hl - Math.cos(ang + Math.PI / 2) * hw, tip[1] - Math.sin(ang) * hl - Math.sin(ang + Math.PI / 2) * hw];
  const head = `<path d="M${f(tip[0])} ${f(tip[1])} L${f(l[0])} ${f(l[1])} L${f(r[0])} ${f(r[1])}Z" class="g-head"/>`;
  const start = P[1] || P[0];
  const badge = g.badge
    ? `<rect x="8" y="-50" width="42" height="22" rx="4" class="g-badge"/><text x="29" y="-34" class="g-badge-t">${g.badge}</text>`
    : '';
  const speed = g.fast
    ? `<path d="${d}" class="g-path g-ghost" transform="translate(-5 3)"/>`
    : '';
  return `<svg viewBox="-50 -50 100 100" class="gesture">${gate}${speed}
    <path d="${d}" class="g-path${g.dashed ? ' g-dashed' : ''}"/>${head}
    <circle cx="${f(start[0])}" cy="${f(start[1])}" r="4.2" class="g-start"/>
    <circle cx="0" cy="0" r="3" class="g-center"/>${badge}</svg>`;
}
