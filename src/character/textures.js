// Procedural canvas textures for the skater: fabrics (jersey, fleece, plaid, nylon, denim, twill, knit), skin/face,
// eyes, hair, shoes and original chest graphics. Regions are painted in metric units so patterns keep their real-world
// scale regardless of how the UV atlas region is stretched.
import * as THREE from 'three';
import { rng, clamp } from './util.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- colour helpers
const _c = new THREE.Color();
export function hexToRgb(hex) {
  _c.set(hex);
  return { r: _c.r * 255, g: _c.g * 255, b: _c.b * 255 };
}
export function shade(hex, amt) {
  // amt -1..1 : darken / lighten
  const c = hexToRgb(hex);
  const f = (v) => clamp(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt, 0, 255);
  return `rgb(${f(c.r) | 0},${f(c.g) | 0},${f(c.b) | 0})`;
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${(A.r + (B.r - A.r) * t) | 0},${(A.g + (B.g - A.g) * t) | 0},${(A.b + (B.b - A.b) * t) | 0})`;
}
export function luminance(hex) {
  const c = hexToRgb(hex);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}
export function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a})`;
}

// ---------------------------------------------------------------- regions
/**
 * A region of a canvas addressed by UV rect (u0..u1, v0..v1; v up) with a metric size (mw x mh meters).
 * paint(ctx, fn) calls fn with the context transformed so that 1 unit = 1 meter, origin = region bottom-left.
 * Y axis in that space points UP (v direction).
 */
export function region(canvas, u0, u1, v0, v1, mw, mh) {
  const W = canvas.width;
  const H = canvas.height;
  const x = u0 * W;
  const y = (1 - v1) * H;
  const w = (u1 - u0) * W;
  const h = (v1 - v0) * H;
  return {
    x, y, w, h, mw, mh,
    sx: w / mw,
    sy: h / mh,
    begin(ctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      // metric coords: (0,0) bottom-left, y up
      ctx.setTransform(w / mw, 0, 0, -h / mh, x, y + h);
    },
    end(ctx) {
      ctx.restore();
    },
  };
}

// ---------------------------------------------------------------- fabric painters
/** Paints fabric `style` into the region of ctx (colour) and bctx (bump, grey). */
export function paintFabric(ctx, bctx, R, color, style, seed = 1) {
  const rand = rng(seed);
  const { mw, mh } = R;
  R.begin(ctx);
  ctx.fillStyle = color;
  ctx.fillRect(-0.01, -0.01, mw + 0.02, mh + 0.02);
  if (bctx) {
    R.begin(bctx);
    bctx.fillStyle = '#808080';
    bctx.fillRect(-0.01, -0.01, mw + 0.02, mh + 0.02);
  }
  const area = mw * mh;
  const speck = (n, size, alpha, light = 0.5) => {
    for (let i = 0; i < n; i++) {
      const x = rand() * mw;
      const y = rand() * mh;
      const s = size * (0.5 + rand());
      ctx.fillStyle = rand() < light ? `rgba(255,255,255,${alpha * rand()})` : `rgba(0,0,0,${alpha * rand()})`;
      ctx.fillRect(x, y, s, s * (0.6 + rand() * 0.8));
      if (bctx) {
        const g = 128 + (rand() - 0.5) * 120;
        bctx.fillStyle = `rgba(${g},${g},${g},0.5)`;
        bctx.fillRect(x, y, s, s);
      }
    }
  };
  if (style === 'jersey' || style === 'fleece') {
    // soft mottling + tiny knit grain
    for (let i = 0; i < area * 300; i++) {
      const x = rand() * mw;
      const y = rand() * mh;
      const r = 0.01 + rand() * 0.04;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    speck(area * (style === 'fleece' ? 40000 : 25000), 0.0016, 0.12);
    if (bctx && style === 'jersey') {
      bctx.strokeStyle = 'rgba(40,40,40,0.25)';
      bctx.lineWidth = 0.0008;
      for (let x = 0; x < mw; x += 0.003) {
        bctx.beginPath();
        bctx.moveTo(x, 0);
        bctx.lineTo(x, mh);
        bctx.stroke();
      }
    }
  } else if (style === 'nylon') {
    const g = ctx.createLinearGradient(0, 0, mw, mh);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.04)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, mw, mh);
    speck(area * 6000, 0.0012, 0.06);
  } else if (style === 'plaid') {
    const dark = shade(color, -0.6);
    const light = luminance(color) > 0.55 ? shade(color, -0.25) : mixHex(color, '#ffffff', 0.55);
    const accent = luminance(color) > 0.5 ? '#202020' : '#f0e6d0';
    const P = 0.1; // pattern period (m)
    const bands = (horiz) => {
      for (let k = -1; k < (horiz ? mh : mw) / P + 1; k++) {
        const o = k * P;
        const rect = (a, w, style2) => {
          ctx.fillStyle = style2;
          if (horiz) ctx.fillRect(0, o + a, mw, w);
          else ctx.fillRect(o + a, 0, w, mh);
        };
        ctx.globalAlpha = 0.5;
        rect(0.0, 0.034, dark);
        ctx.globalAlpha = 0.35;
        rect(0.012, 0.01, dark);
        ctx.globalAlpha = 0.6;
        rect(0.055, 0.005, light);
        rect(0.075, 0.0025, accent);
        ctx.globalAlpha = 1;
      }
    };
    bands(true);
    bands(false);
    // twill diagonal grain
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 0.0009;
    for (let x = -mh; x < mw; x += 0.0028) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + mh, mh);
      ctx.stroke();
    }
    speck(area * 15000, 0.0016, 0.1);
    if (bctx) {
      bctx.strokeStyle = 'rgba(30,30,30,0.3)';
      bctx.lineWidth = 0.001;
      for (let x = -mh; x < mw; x += 0.0028) {
        bctx.beginPath();
        bctx.moveTo(x, 0);
        bctx.lineTo(x + mh, mh);
        bctx.stroke();
      }
    }
  } else if (style === 'denim' || style === 'twill' || style === 'canvas') {
    const sp = style === 'denim' ? 0.0026 : style === 'twill' ? 0.0022 : 0.002;
    const a = style === 'denim' ? 0.22 : 0.08;
    ctx.lineWidth = sp * 0.45;
    for (let x = -mh; x < mw; x += sp) {
      ctx.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${a * (0.4 + rand() * 0.6)})` : `rgba(0,0,0,${a * 0.7})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + mh * (style === 'canvas' ? 0 : 1), mh);
      ctx.stroke();
    }
    if (style === 'canvas') {
      ctx.lineWidth = sp * 0.4;
      for (let y = 0; y < mh; y += sp) {
        ctx.strokeStyle = `rgba(0,0,0,${0.06 * rand()})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mw, y);
        ctx.stroke();
      }
    }
    if (style === 'denim') {
      // slub: long vertical irregular streaks
      for (let i = 0; i < area * 900; i++) {
        const x = rand() * mw;
        const y = rand() * mh;
        ctx.fillStyle = rand() < 0.6 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
        ctx.fillRect(x, y, 0.0012, 0.02 + rand() * 0.08);
      }
    }
    speck(area * 12000, 0.0014, 0.08);
    if (bctx) {
      bctx.lineWidth = sp * 0.5;
      bctx.strokeStyle = 'rgba(20,20,20,0.35)';
      for (let x = -mh; x < mw; x += sp) {
        bctx.beginPath();
        bctx.moveTo(x, 0);
        bctx.lineTo(x + mh * (style === 'canvas' ? 0 : 1), mh);
        bctx.stroke();
      }
    }
  } else if (style === 'knit') {
    const sp = 0.0065;
    for (let x = 0; x < mw; x += sp) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, sp * 0.3, mh);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + sp * 0.5, 0, sp * 0.25, mh);
      if (bctx) {
        bctx.fillStyle = 'rgba(0,0,0,0.6)';
        bctx.fillRect(x, 0, sp * 0.35, mh);
        bctx.fillStyle = 'rgba(255,255,255,0.4)';
        bctx.fillRect(x + sp * 0.45, 0, sp * 0.35, mh);
      }
    }
    // stitch rows
    for (let y = 0; y < mh; y += 0.0035) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, y, mw, 0.0012);
    }
    speck(area * 8000, 0.0015, 0.08);
  } else if (style === 'rubber') {
    speck(area * 8000, 0.001, 0.06);
  } else if (style === 'suede') {
    for (let i = 0; i < area * 3000; i++) {
      const x = rand() * mw;
      const y = rand() * mh;
      const r = 0.002 + rand() * 0.008;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    speck(area * 20000, 0.0012, 0.1);
  }
  R.end(ctx);
  if (bctx) R.end(bctx);
}

/** dashed stitch line (metric coords, region already begun) */
export function stitch(ctx, pts, color = 'rgba(255,255,255,0.5)', w = 0.0012, dash = 0.004) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.setLineDash([dash, dash * 0.7]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

/** seam: darker crease line with stitches on both sides */
export function seam(ctx, bctx, pts, stitchColor, crease = 0.18) {
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${crease})`;
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
  if (stitchColor) stitch(ctx, pts.map(([x, y]) => [x + 0.004, y]), stitchColor);
  if (bctx) {
    bctx.save();
    bctx.strokeStyle = 'rgba(0,0,0,0.7)';
    bctx.lineWidth = 0.004;
    bctx.beginPath();
    bctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) bctx.lineTo(pts[i][0], pts[i][1]);
    bctx.stroke();
    bctx.restore();
  }
}

// ---------------------------------------------------------------- chest graphics (original art)
/**
 * Draws a chest graphic centred at (cx, cy) in metric coords of region R (already begun is NOT required).
 * size = width in meters.
 */
export function paintGraphic(ctx, R, kind, color, base, cx, cy, size) {
  if (!kind || kind === 'none') return;
  ctx.save();
  // pixel space centred on graphic, isotropic (correct region anisotropy)
  const px = R.x + cx * R.sx;
  const py = R.y + R.h - cy * R.sy;
  ctx.beginPath();
  ctx.rect(R.x, R.y, R.w, R.h);
  ctx.clip();
  ctx.translate(px, py);
  ctx.scale(1, R.sy / R.sx);
  const S = size * R.sx; // graphic width in px
  const outline = luminance(base) > 0.5 ? shade(color, -0.6) : mixHex(color, '#ffffff', 0.7);
  const contrast = luminance(color) > 0.6 ? '#151515' : '#f4f1ea';
  if (kind === 'logo') {
    ctx.rotate(-0.06);
    ctx.font = `italic 900 ${S * 0.3}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = S * 0.035;
    ctx.strokeStyle = outline;
    ctx.strokeText('SK8.IO', 0, 0);
    ctx.fillStyle = color;
    ctx.fillText('SK8.IO', 0, 0);
    // skateboard swoosh underline
    ctx.lineCap = 'round';
    ctx.lineWidth = S * 0.045;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(-S * 0.46, S * 0.2);
    ctx.quadraticCurveTo(-S * 0.42, S * 0.25, -S * 0.32, S * 0.25);
    ctx.lineTo(S * 0.32, S * 0.25);
    ctx.quadraticCurveTo(S * 0.42, S * 0.25, S * 0.46, S * 0.2);
    ctx.stroke();
    ctx.fillStyle = color;
    for (const wx of [-0.22, 0.22]) {
      ctx.beginPath();
      ctx.arc(wx * S, S * 0.32, S * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `700 ${S * 0.07}px Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText('SKATE  SIMULATOR  CO.', 0, -S * 0.22);
  } else if (kind === 'stripe') {
    ctx.restore();
    ctx.save();
    // full-width band across the region
    const y0 = R.y + R.h - (cy + size * 0.12) * R.sy;
    const hh = size * 0.12 * R.sy;
    ctx.fillStyle = color;
    ctx.fillRect(R.x, y0, R.w, hh);
    ctx.fillStyle = outline;
    ctx.fillRect(R.x, y0 + hh + hh * 0.18, R.w, hh * 0.22);
    ctx.fillRect(R.x, y0 - hh * 0.4, R.w, hh * 0.22);
  } else if (kind === 'pocket') {
    // left chest pocket (character's left = viewer's right)
    ctx.translate(S * 0.55, 0);
    const w = S * 0.36;
    const h = S * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h * 0.35);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, h * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = S * 0.012;
    ctx.stroke();
    ctx.setLineDash([S * 0.02, S * 0.015]);
    ctx.strokeStyle = outline;
    ctx.lineWidth = S * 0.008;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + S * 0.02, -h / 2 + S * 0.03);
    ctx.lineTo(w / 2 - S * 0.02, -h / 2 + S * 0.03);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = contrast;
    ctx.font = `900 ${S * 0.09}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('S8', 0, h * 0.12);
  } else if (kind === 'flame') {
    const draw = (scale, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      const n = 7;
      ctx.moveTo(-S * 0.5 * scale, S * 0.3);
      for (let i = 0; i < n; i++) {
        const x0 = -0.5 + (i / n);
        const x1 = -0.5 + ((i + 1) / n);
        const tip = 0.35 + 0.35 * Math.sin(i * 1.7 + 0.5) ** 2;
        ctx.quadraticCurveTo(S * (x0 + 0.02) * scale, S * (0.05 - tip * 0.6) * scale, S * (x0 + 0.12) * scale, -S * tip * scale);
        ctx.quadraticCurveTo(S * (x0 + 0.05) * scale, S * (0.1 - tip * 0.4) * scale, S * x1 * scale, S * 0.12 * scale);
      }
      ctx.lineTo(S * 0.5 * scale, S * 0.3);
      ctx.closePath();
      ctx.fill();
    };
    draw(1.0, color);
    draw(0.72, mixHex(color, '#ffd23a', 0.6));
    draw(0.45, '#fff2b0');
    ctx.font = `italic 900 ${S * 0.13}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = outline;
    ctx.fillText('SHRED', 0, S * 0.42);
  } else if (kind === 'wheel') {
    const r = S * 0.32;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = S * 0.02;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      ctx.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      ctx.stroke();
    }
    ctx.font = `900 ${S * 0.1}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText('ROLL FAST', 0, r + S * 0.1);
    ctx.fillText('54MM', 0, -r - S * 0.08);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- skin / face
/** Skin canvas: the head sphere maps to v in [HEAD_V0, 1]; the body uses a plain patch below. */
export const HEAD_V0 = 0.1;
export const BODY_UV = [0.5, 0.04];

/** Converts a head-centred direction to the head-region UV. */
export function headDirToUV(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  const th = Math.acos(clamp(y / l, -1, 1));
  const ph = Math.atan2(x / l, z / l);
  return [(ph + Math.PI) / (2 * Math.PI), HEAD_V0 + (1 - HEAD_V0) * (1 - th / Math.PI)];
}

export function paintSkin(app, headR, opts = {}) {
  const W = 1024;
  const H = 1024;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const rand = rng(77);
  const skin = app.skin;
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, W, H);
  // mottling
  for (let i = 0; i < 2500; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 2 + rand() * 14;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,240,230,0.035)' : 'rgba(120,40,30,0.035)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = `rgba(90,40,30,${0.05 * rand()})`;
    ctx.fillRect(rand() * W, rand() * H, 1.2, 1.2);
  }
  const uvToPx = (u, v) => [u * W, (1 - v) * H];
  // head feature painter in head-centred metric coords (x left, y up, z fwd), using ellipsoid radii
  const at = (x, y, z) => {
    const [u, v] = headDirToUV(x / headR.x, y / headR.y, z / headR.z);
    return uvToPx(u, v);
  };
  const pxPerM = W / (2 * Math.PI * headR.x * 1.15); // approx horizontal density at the face
  const pyPerM = ((1 - HEAD_V0) * H) / (Math.PI * headR.y * 1.05);
  const blob = (x, y, z, rw, rh, color, alpha) => {
    const [px, py] = at(x, y, z);
    const g = ctx.createRadialGradient(px, py, 0, px, py, rw * pxPerM);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, rh / rw * (pyPerM / pxPerM));
    ctx.translate(-px, -py);
    ctx.fillStyle = g;
    ctx.fillRect(px - rw * pxPerM, py - rw * pxPerM, rw * pxPerM * 2, rw * pxPerM * 2);
    ctx.restore();
  };
  const R = headR;
  // warmth on cheeks, nose, ears; slight shadow under brows and jaw
  blob(0.045, -0.025, 0.07, 0.03, 0.022, '#c0503a', 0.12);
  blob(-0.045, -0.025, 0.07, 0.03, 0.022, '#c0503a', 0.12);
  blob(0, -0.02, 0.1, 0.02, 0.03, '#c0503a', 0.1);
  blob(R.x, -0.005, -0.005, 0.03, 0.04, '#b04a3a', 0.12);
  blob(-R.x, -0.005, -0.005, 0.03, 0.04, '#b04a3a', 0.12);
  // eye sockets slight darkening
  blob(0.031, 0.006, 0.08, 0.02, 0.013, '#3a2018', 0.16);
  blob(-0.031, 0.006, 0.08, 0.02, 0.013, '#3a2018', 0.16);
  // lips
  const lipCol = mixHex(skin, '#a4474a', luminance(skin) > 0.45 ? 0.38 : 0.22);
  const lipDark = shade(lipCol, -0.35);
  {
    const [cx, cy] = at(0, -0.062 * R.y / 0.117, 0.09);
    const lw = 0.024 * pxPerM;
    const lh = 0.008 * pyPerM;
    ctx.fillStyle = lipCol;
    ctx.beginPath(); // upper lip with cupid's bow
    ctx.moveTo(cx - lw, cy);
    ctx.quadraticCurveTo(cx - lw * 0.5, cy - lh * 1.2, cx - lw * 0.15, cy - lh * 1.05);
    ctx.quadraticCurveTo(cx, cy - lh * 0.75, cx + lw * 0.15, cy - lh * 1.05);
    ctx.quadraticCurveTo(cx + lw * 0.5, cy - lh * 1.2, cx + lw, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mixHex(skin, '#b0575a', luminance(skin) > 0.45 ? 0.32 : 0.18);
    ctx.beginPath(); // lower lip
    ctx.moveTo(cx - lw * 0.92, cy);
    ctx.quadraticCurveTo(cx, cy + lh * 2.0, cx + lw * 0.92, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = lipDark;
    ctx.lineWidth = Math.max(1.5, lh * 0.25);
    ctx.beginPath();
    ctx.moveTo(cx - lw * 0.95, cy + 0.5);
    ctx.quadraticCurveTo(cx, cy + lh * 0.25, cx + lw * 0.95, cy + 0.5);
    ctx.stroke();
  }
  // nostrils hint
  blob(0.008, -0.045, 0.1, 0.005, 0.004, '#3a1a14', 0.35);
  blob(-0.008, -0.045, 0.1, 0.005, 0.004, '#3a1a14', 0.35);
  // stubble / beard shadow
  if (opts.facialHair && opts.facialHair !== 'none') {
    const col = opts.hairColor || '#2a2018';
    const dens = opts.facialHair === 'stubble' ? 1 : 0.6;
    for (let i = 0; i < 26000 * dens; i++) {
      // sample a direction in the lower face region
      const a = (rand() - 0.5) * 2.6; // azimuth (-1.3..1.3)
      const yy = -0.95 + rand() * 0.75; // y on unit sphere
      const inMoustache = Math.abs(a) < 0.45 && yy > -0.62 && yy < -0.42;
      const jaw = yy < -0.55 + 0.25 * Math.max(0, Math.abs(a) - 0.5) || Math.abs(a) > 1.0;
      if (!(inMoustache || jaw)) continue;
      if (yy > -0.2) continue;
      // skip lips
      if (Math.abs(a) < 0.32 && yy > -0.62 && yy < -0.48) continue;
      const s = Math.sqrt(1 - yy * yy);
      const [u, v] = headDirToUV(Math.sin(a) * s, yy, Math.cos(a) * s);
      const [px, py] = uvToPx(u, v);
      ctx.fillStyle = rgba(col, 0.25 + rand() * 0.35);
      ctx.fillRect(px, py, 1.3, 1.3);
    }
  }
  // scalp tint under hair (blends the hairline)
  if (opts.hairStyle && opts.hairStyle !== 'bald') {
    const col = opts.hairColor || '#2a2018';
    for (let py = 0; py < (1 - HEAD_V0) * H; py += 2) {
      const th = (py / ((1 - HEAD_V0) * H)) * Math.PI;
      const yy = Math.cos(th);
      for (let px = 0; px < W; px += 2) {
        const ph = (px / W) * 2 * Math.PI - Math.PI;
        const front = Math.cos(ph);
        const side = Math.abs(Math.sin(ph));
        // hairline height on the unit sphere
        const yt = front > 0 ? 0.48 * front + 0.12 * side * (1 - front) : -0.35 * -front + 0.12 * (1 + front);
        const m = clamp((yy - yt) / 0.12 + 0.5);
        if (m <= 0.01) continue;
        ctx.fillStyle = rgba(col, 0.75 * m);
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }
  // plain body patch
  ctx.fillStyle = skin;
  ctx.fillRect(0, H * (1 - HEAD_V0) + 4, W, H * HEAD_V0);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(90,40,30,${0.04 * rand()})`;
    ctx.fillRect(rand() * W, H * (1 - HEAD_V0) + 4 + rand() * (H * HEAD_V0 - 4), 2, 2);
  }
  return toTexture(cv);
}

export function paintEyes() {
  const W = 256;
  const H = 128;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#efe9e2';
  ctx.fillRect(0, 0, W, H);
  // faint veins/corners
  const g0 = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.4);
  g0.addColorStop(0, 'rgba(0,0,0,0)');
  g0.addColorStop(1, 'rgba(150,90,80,0.35)');
  ctx.fillStyle = g0;
  ctx.fillRect(0, 0, W, H);
  // iris at u = 0.5 (front, +Z), v = 0.5
  const cx = W * 0.5;
  const cy = H * 0.5;
  const rx = W * 0.075;
  const ry = H * 0.15;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, '#2a1a10');
  g.addColorStop(0.35, '#4a3020');
  g.addColorStop(0.8, '#6b4a2c');
  g.addColorStop(1, '#2b1d14');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#080605';
  ctx.beginPath();
  ctx.arc(0, 0, rx * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return toTexture(cv);
}

export function paintHair(color, style) {
  const W = 256;
  const H = 256;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const rand = rng(31);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  const n = style === 'curly' ? 0 : 900;
  for (let i = 0; i < n; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const len = 20 + rand() * 80;
    ctx.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${0.1 * rand()})` : `rgba(0,0,0,${0.22 * rand()})`;
    ctx.lineWidth = 0.6 + rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 6, y + len * 0.5, x + (rand() - 0.5) * 8, y + len);
    ctx.stroke();
  }
  if (style === 'curly') {
    for (let i = 0; i < 1800; i++) {
      const x = rand() * W;
      const y = rand() * H;
      ctx.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${0.12 * rand()})` : `rgba(0,0,0,${0.3 * rand()})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + rand() * 3, rand() * 6, rand() * 6 + 3);
      ctx.stroke();
    }
  }
  const t = toTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
