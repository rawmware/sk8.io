// Tiny DOM helpers for the SK8.IO UI.

/**
 * h('div', { class: 'a b', text: 'hi', on: { click() {} }, style: {...}, dataset: {...}, attrs: {...} }, ...children)
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'attrs') for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function svg(markup, cls = '') {
  const wrap = document.createElement('span');
  wrap.className = 'svg-wrap ' + cls;
  wrap.innerHTML = markup;
  return wrap;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Key-cap / button glyph used in prompts. */
export function keycap(label, kind = 'key') {
  return h('span', { class: `kc kc-${kind}`, text: label });
}
