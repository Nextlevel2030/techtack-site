/* TECH TACK — particle scene.
   One cloud of points re-forms into a new shape for every chapter of the journey,
   inside a field of stars and stage-light beams that stream past as you scroll. */
(() => {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SPACING = 2.0;      // world distance between chapters
  const DISTANCE = 5.6;     // camera distance to a chapter's shape
  const FOV = 50 * Math.PI / 180;
  const TAN = Math.tan(FOV / 2);

  const C = {
    cyan: [0.22, 0.75, 0.94],
    violet: [0.58, 0.47, 0.95],
    magenta: [0.78, 0.33, 0.68],
    white: [0.9, 0.94, 1.0],
    blue: [0.32, 0.46, 0.92]
  };
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---------- small matrix helpers (column-major) ----------
  function perspective(aspect) {
    const f = 1 / TAN, near = 0.05, far = 140, nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(e, t) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = zz, xy = 0, xz = -zx; // up = (0,1,0): x = up × z
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  }
  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
    }
    return o;
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- shaders ----------
  const SHAPE_VS = `
precision highp float;
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec4 aCFrom;
attribute vec4 aCTo;
attribute vec4 aSeed;
uniform mat4 uPV;
uniform vec4 uOffFrom;
uniform vec4 uOffTo;
uniform float uMix;
uniform float uTime;
uniform float uSize;
uniform float uDim;
uniform float uSpin;
uniform vec4 uMouse;
varying vec3 vColor;
varying float vAlpha;
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
void main() {
  float d = clamp(uMix * 1.5 - aSeed.w * 0.5, 0.0, 1.0);
  float e = d * d * (3.0 - 2.0 * d);
  vec3 a = rotY(aFrom, uSpin) * uOffFrom.w + uOffFrom.xyz;
  vec3 b = rotY(aTo, uSpin) * uOffTo.w + uOffTo.xyz;
  vec3 p = mix(a, b, e);
  float arc = sin(3.14159265 * e);
  vec3 dir = normalize(vec3(sin(aSeed.y * 6.2831853), cos(aSeed.y * 6.2831853), sin(aSeed.x * 9.0 + 1.0)) + vec3(0.0001));
  p += dir * arc * (0.5 + aSeed.z * 1.6);
  float t = uTime * 0.6 + aSeed.y * 50.0;
  p += vec3(sin(t), cos(t * 0.83), sin(t * 0.61)) * (0.003 + 0.005 * aSeed.x);
  vec2 dm = p.xy - uMouse.xy;
  float push = uMouse.w * exp(-dot(dm, dm) * 3.2);
  p.xy += normalize(dm + vec2(0.0001)) * push * 0.3;
  p.z += push * 0.3;
  vec4 clip = uPV * vec4(p, 1.0);
  gl_Position = clip;
  vec4 c = mix(aCFrom, aCTo, e);
  float depth = max(clip.w, 0.05);
  gl_PointSize = clamp(uSize * c.w * (0.82 + aSeed.x * 0.45) / depth, 0.0, 26.0);
  float twinkle = 0.9 + 0.1 * sin(uTime * 1.5 + aSeed.y * 40.0);
  vColor = c.rgb * (1.12 + push * 1.2 + arc * 0.35);
  vAlpha = uDim * twinkle * smoothstep(0.35, 1.6, depth);
}`;

  const STAR_VS = `
precision highp float;
attribute vec4 aPos;
attribute vec4 aSeed;
uniform mat4 uPV;
uniform float uCamZ;
uniform float uTime;
uniform float uSize;
uniform float uWarp;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = mod(aPos.z - uCamZ, 56.0);
  vec3 p = vec3(aPos.x, aPos.y, uCamZ + r - 50.0);
  vec4 clip = uPV * vec4(p, 1.0);
  gl_Position = clip;
  float depth = max(clip.w, 0.05);
  gl_PointSize = clamp(uSize * (0.35 + aSeed.x * 0.85) / depth, 0.0, 9.0);
  vec3 cold = mix(vec3(0.55, 0.62, 1.0), vec3(0.36, 0.8, 1.0), aSeed.z);
  vColor = mix(cold, vec3(0.74, 0.54, 1.0), step(0.82, aSeed.w));
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.x * 2.2) + aSeed.y * 70.0);
  vAlpha = (0.35 + 0.65 * tw) * (0.6 + uWarp * 0.7) * smoothstep(0.3, 2.5, depth) * (1.0 - smoothstep(36.0, 50.0, depth));
}`;

  const RAY_VS = `
precision highp float;
attribute vec4 aRay;
attribute vec4 aSeed;
uniform mat4 uPV;
uniform float uCamZ;
uniform float uTime;
uniform float uWarp;
uniform float uRays;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float speed = (0.012 + uWarp * 0.2) * (0.6 + aSeed.x * 0.8);
  float t = fract(aRay.z + uTime * speed);
  float len = (0.014 + uWarp * 0.17) * (0.6 + aSeed.y * 0.8);
  float tt = t + aRay.w * len;
  float z = mix(-48.0, 4.0, tt);
  float rad = aRay.y * (0.04 + tt * tt * 1.15);
  vec3 p = vec3(cos(aRay.x) * rad, sin(aRay.x) * rad, uCamZ + z);
  gl_Position = uPV * vec4(p, 1.0);
  vColor = mix(vec3(0.25, 0.74, 0.94), vec3(0.56, 0.44, 0.94), aSeed.z);
  float fade = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.78, 1.0, t));
  vAlpha = uRays * (0.1 + uWarp * 0.8) * fade * mix(0.15, 1.0, aRay.w);
}`;

  const POINT_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  vec3 col = vColor * (exp(-r * 3.2) * 0.8 + exp(-r * 14.0) * 0.95) * vAlpha;
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}`;

  const SHAPE_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float disc = 1.0 - smoothstep(0.44, 0.64, d);
  float glow = exp(-d * d * 6.0) * 0.26;
  // Drawn "over" (not added), so dense lines keep their brand colour instead of adding up to white.
  vec3 c = min(vColor, vec3(1.0));
  float a = clamp((disc + glow) * vAlpha, 0.0, 1.0) * clamp(max(c.r, max(c.g, c.b)) * 1.15, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;

  const LINE_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 col = vColor * vAlpha;
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}`;

  // ---------- 2D sources that the points sample ----------
  const ICONS = {
    // a calendar: rings, header, a few day marks and a check on the event day
    'icon-event'(d) { d.r(6, 9, 36, 33); d.s('M6 17h36'); d.s('M16 4.5v8M32 4.5v8'); d.s('M11 24h3M20 24h3M11 36h3M34 36h3', 0.6); d.f('M17.5 31.5l2-2 4 4 8-9 2 2-10 11z'); },
    'icon-creative'(d) { d.s('M18.5 31c0-3.6-5.5-6-5.5-12.5a11 11 0 0 1 22 0C35 25 29.5 27.4 29.5 31z'); d.s('M19 35h10M20.5 39h7'); d.s('M24 2.5V6M8.6 8.6l2.5 2.5M39.4 8.6l-2.5 2.5M4 18.5h3.5M44 18.5h-3.5', 0.6); d.f('M24 15l3 3-3 3-3-3z'); },
    'icon-audio'(d) { d.s('M7 19h7l10-8v26l-10-8H7z'); d.s('M30 18.5a8 8 0 0 1 0 11M34.5 13.5a15 15 0 0 1 0 21'); d.s('M39 9a21.5 21.5 0 0 1 0 30', 0.6); },
    'icon-visual'(d) { d.r(5, 8, 38, 25); d.s('M24 33v6M15 40h18'); d.s('M11 13h4M11 28h4M33 13h4M33 28h4', 0.6); d.f('M21 15.5l8 5-8 5z'); },
    'icon-light'(d) { d.r(17, 4, 14, 8); d.s('M19 12L9 39h30L29 12'); d.f('M19 12L9 39h30L29 12', 0.16); d.e(24, 40, 15, 2.6); d.s('M24 17v4M24 26v5', 0.6); },
    'icon-tech'(d) { d.s('M24 6l14 8v16l-14 8-14-8V14z'); d.s('M10 14l14 8 14-8M24 22v16', 0.8); d.s('M5 43h38', 0.6); d.s('M42 3.5v5M39.5 6h5', 0.8); d.f('M6 5.5l1.8 1.8L6 9.1 4.2 7.3z'); },
    'icon-content'(d) { d.s('M6 16h8l3-5h14l3 5h8v22H6z'); d.c(24, 26.5, 7.5); d.fc(24, 26.5, 2.8); d.s('M36.5 21h1.5'); },
    'icon-rsvp'(d) { d.r(6, 6, 13, 13); d.r(29, 6, 13, 13); d.r(6, 29, 13, 13); d.f('M10.5 10.5h4v4h-4zM33.5 10.5h4v4h-4zM10.5 33.5h4v4h-4z'); d.s('M29 29h4v4h-4zM36.5 29H42v4M29 37v5h4M37 37h5v5h-5z'); }
  };

  function drawIcon(ctx, size, key) {
    const k = size * 0.8 / 48, o = size * 0.1;
    ctx.setTransform(k, 0, 0, k, o, o);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const WHITE = '#ffffff', ACCENT = '#ffff00';
    const d = {
      s(path, a = 1) { ctx.globalAlpha = a; ctx.strokeStyle = WHITE; ctx.stroke(new Path2D(path)); },
      f(path, a = 1) { ctx.globalAlpha = a; ctx.fillStyle = ACCENT; ctx.fill(new Path2D(path)); },
      c(x, y, r) { ctx.globalAlpha = 1; ctx.strokeStyle = WHITE; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); },
      fc(x, y, r) { ctx.globalAlpha = 1; ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },
      r(x, y, w, h) { ctx.globalAlpha = 1; ctx.strokeStyle = WHITE; ctx.strokeRect(x, y, w, h); },
      e(x, y, rx, ry) { ctx.globalAlpha = 1; ctx.strokeStyle = WHITE; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
    };
    ICONS[key](d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Draws a source into a canvas and returns up to `want` points [x, y, z, r, g, b, size].
  function sample(draw, want, rand, colour, depth = 0.05, edge = 0, size = 400) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    draw(ctx, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const A = new Uint8Array(size * size);
    for (let i = 0; i < A.length; i++) A[i] = data[i * 4 + 3];
    const fill = [], rim = [];
    const inside = i => i >= 0 && i < A.length && A[i] > 127;
    for (let y = 2; y < size - 2; y++) {
      for (let x = 2; x < size - 2; x++) {
        const idx = y * size + x;
        const a = A[idx];
        if (a <= 16) continue;
        if (edge > 0 && a > 127 && (!inside(idx - 1) || !inside(idx + 1) || !inside(idx - size) || !inside(idx + size) ||
            !inside(idx - 2) || !inside(idx + 2) || !inside(idx - 2 * size) || !inside(idx + 2 * size))) rim.push(idx * 4);
        else if (rand() < a / 255) fill.push(idx * 4);
      }
    }
    const out = [];
    if (!fill.length && !rim.length) return out;
    const span = 2.9;
    for (let n = 0; n < want; n++) {
      const fromRim = rim.length && (rand() < edge || !fill.length);
      const list = fromRim ? rim : fill;
      const i = list[(rand() * list.length) | 0];
      const p = i / 4, px = p % size, py = (p / size) | 0;
      const x = (px + rand() - size / 2) / size * span;
      const y = (size / 2 - py - rand()) / size * span;
      const z = (rand() - 0.5) * depth * 2;
      const c = colour(data[i], data[i + 1], data[i + 2], x, y, rand);
      const k = fromRim ? 1.18 : edge > 0 ? 0.78 : 1;
      out.push(x, y, z, c[0] * k, c[1] * k, c[2] * k, c[3]);
    }
    return out;
  }

  const SOURCES = {
    logo(want, rand, res) {
      const img = res.logo;
      return sample((ctx, size) => {
        if (!img) return;
        const sw = 386, sh = 446, h = size * 0.84, w = h * sw / sh;
        ctx.drawImage(img, 0, 0, sw, sh, (size - w) / 2, (size - h) / 2, w, h);
      }, want, rand, (r, g) => g > 150 ? [...C.cyan, 1] : [...C.violet, 1], 0.05, 0);
    },
    digits(want, rand) {
      return sample((ctx, size) => {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(size * 0.66)}px Bahij, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.direction = 'ltr';
        ctx.fillText('08', size / 2, size * 0.53);
      }, want, rand, (r, g, b, x) => [...mix3(C.cyan, C.violet, clamp((x + 1.2) / 2.4, 0, 1)), 1], 0.05, 0);
    },
    question(want, rand, res) {
      const glyph = res.question || '؟';
      return sample((ctx, size) => {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(size * 0.8)}px Bahij, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.direction = glyph === '؟' ? 'rtl' : 'ltr';
        ctx.fillText(glyph, size / 2, size * 0.5);
      }, want, rand, (r, g, b, x, y) => [...mix3(C.violet, C.cyan, clamp((y + 1.2) / 2.4, 0, 1)), 1], 0.05, 0);
    },
    // The opening message ("Scroll down" / «مرّر للأسفل») with a small chevron under it.
    greeting(want, rand, res) {
      const text = res.greeting || '';
      const rtl = /[\u0600-\u06FF]/.test(text);
      return sample((ctx, size) => {
        let px = Math.round(size * 0.2);
        ctx.font = `700 ${px}px Bahij, Arial, sans-serif`;
        const w = ctx.measureText(text).width;
        if (w > size * 0.9) { px = Math.floor(px * size * 0.9 / w); ctx.font = `700 ${px}px Bahij, Arial, sans-serif`; }
        res.greetFont = px / size;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.direction = rtl ? 'rtl' : 'ltr';
        ctx.fillText(text, size / 2, size * 0.44);
        const cy = size * 0.44 + px * 0.95, cw = px * 0.28;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(4, px * 0.07);
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(size / 2 - cw, cy - cw * 0.45);
        ctx.lineTo(size / 2, cy + cw * 0.45);
        ctx.lineTo(size / 2 + cw, cy - cw * 0.45);
        ctx.stroke();
        // sampled finer and flatter than the other shapes, and a touch whiter, so the words read clearly
      }, want, rand, (r, g, b, x, y) => y < -0.25 ? [...C.magenta, 1.1] : [...mix3(mix3(C.cyan, C.violet, clamp((x + 1.3) / 2.6, 0, 1)), C.white, 0.22), 1.05], 0.008, 0, 800);
    },
    core(want, rand) {
      const out = [];
      const nS = Math.floor(want * 0.5), nA = Math.floor(want * 0.24), nB = want - nS - nA;
      for (let i = 0; i < nS; i++) {
        const y = 1 - (i + 0.5) / nS * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963;
        const R = 0.9 + (rand() - 0.5) * 0.04;
        const c = mix3(C.violet, C.cyan, (y + 1) / 2);
        out.push(Math.cos(th) * rr * R, y * R, Math.sin(th) * rr * R, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9, 0.9);
      }
      const ring = (n, R, tilt, roll, col, size) => {
        for (let i = 0; i < n; i++) {
          const a = rand() * Math.PI * 2;
          let x = Math.cos(a) * (R + (rand() - 0.5) * 0.08), y = Math.sin(a) * (R + (rand() - 0.5) * 0.08), z = (rand() - 0.5) * 0.06;
          const y1 = y * Math.cos(tilt) - z * Math.sin(tilt), z1 = y * Math.sin(tilt) + z * Math.cos(tilt);
          const x2 = x * Math.cos(roll) - y1 * Math.sin(roll), y2 = x * Math.sin(roll) + y1 * Math.cos(roll);
          const big = rand() < 0.012;
          out.push(x2, y2, z1, col[0], col[1], col[2], big ? size * 2.2 : size);
        }
      };
      ring(nA, 1.32, 1.22, 0.45, C.cyan, 0.9);
      ring(nB, 1.56, -1.05, -0.35, C.magenta, 0.85);
      return out;
    },
    path(want, rand) {
      const out = [];
      const curve = y => [0.36 * Math.sin(y * 2.1 + 0.4), y, 0.25 * Math.cos(y * 2.7)];
      const nC = Math.floor(want * 0.58);
      for (let i = 0; i < nC; i++) {
        const y = -1.45 + rand() * 2.9;
        const p = curve(y);
        const c = mix3(C.violet, C.cyan, (y + 1.45) / 2.9);
        out.push(p[0] + (rand() - 0.5) * 0.09, p[1], p[2] + (rand() - 0.5) * 0.09, c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 0.85);
      }
      const nodes = [1.25, 0.42, -0.42, -1.25];
      const perNode = Math.floor((want - nC) / 4);
      nodes.forEach(ny => {
        const p = curve(ny);
        for (let i = 0; i < perNode; i++) {
          if (i < perNode * 0.3) {
            const u = rand() * 2 - 1, th = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u) * 0.1;
            out.push(p[0] + Math.cos(th) * rr, p[1] + u * 0.1, p[2] + Math.sin(th) * rr, C.white[0] * 0.6, C.white[1] * 0.6, C.white[2] * 0.6, 1.1);
          } else {
            const a = rand() * Math.PI * 2;
            out.push(p[0] + Math.cos(a) * 0.27, p[1] + Math.sin(a) * 0.27, p[2], ...C.magenta, 0.95);
          }
        }
      });
      return out;
    },
    'path-h'(want, rand) {
      const pts = SOURCES.path(want, rand);
      for (let i = 0; i < pts.length; i += 7) { const x = pts[i], y = pts[i + 1]; pts[i] = y; pts[i + 1] = -x; }
      return pts;
    },
    tunnel(want, rand) {
      const out = [];
      const rings = 10, nR = Math.floor(want * 0.72 / rings);
      for (let k = 0; k < rings; k++) {
        const z = 2 - k * 1.25, R = 2.2 + Math.sin(k * 1.7) * 0.12;
        const c = mix3(C.violet, C.cyan, k / (rings - 1));
        for (let i = 0; i < nR; i++) {
          const a = rand() * Math.PI * 2, rr = R + (rand() - 0.5) * 0.04;
          out.push(Math.cos(a) * rr, Math.sin(a) * rr, z + (rand() - 0.5) * 0.05, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 0.9);
        }
      }
      while (out.length / 7 < want) {
        const a = Math.round(rand() * 12) / 12 * Math.PI * 2, z = 2 - rand() * 11.25;
        out.push(Math.cos(a) * 2.2, Math.sin(a) * 2.2, z, C.blue[0] * 0.7, C.blue[1] * 0.7, C.blue[2] * 0.7, 0.7);
      }
      return out;
    },
    scatter(want, rand) {
      const out = [];
      for (let i = 0; i < want; i++) {
        const u = rand() * 2 - 1, th = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u), R = 1.5 + Math.cbrt(rand()) * 3.2;
        const c = mix3(C.blue, C.violet, rand());
        out.push(Math.cos(th) * rr * R, u * R * 0.8, Math.sin(th) * rr * R, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 0.7);
      }
      return out;
    }
  };
  Object.keys(ICONS).forEach(key => {
    SOURCES[key] = (want, rand) => {
      const strokes = Math.floor(want * 0.86);
      const out = sample((ctx, size) => drawIcon(ctx, size, key), strokes, rand,
        // strokes: cyan → violet across the icon; filled accents: magenta
        (r, g, b, x, y) => [...(b < 100 ? C.magenta : mix3(C.cyan, C.violet, clamp((x + y + 1.4) / 2.8, 0, 1))), 1], 0.04);
      for (let i = strokes; i < want; i++) {
        const a = rand() * Math.PI * 2, R = 1.66 + (rand() - 0.5) * 0.05;
        const big = rand() < 0.01;
        out.push(Math.cos(a) * R, Math.sin(a) * R, (rand() - 0.5) * 0.04, C.violet[0] * 0.42, C.violet[1] * 0.42, C.violet[2] * 0.42, big ? 1.8 : 0.8);
      }
      return out;
    };
  });

  // Every formation holds a position for every particle: some trace the shape, the rest drift around it as dust.
  function formation(key, N, seed, res) {
    const rand = rng(seed);
    const share = key === 'scatter' || key === 'greeting' ? 1 : key.startsWith('icon') ? 0.72 : key === 'path' || key === 'path-h' ? 0.62 : key === 'core' ? 0.8 : key === 'tunnel' ? 0.92 : 0.9;
    const want = Math.floor(N * share);
    const pts = (SOURCES[key] || SOURCES.scatter)(want, rand, res);
    const count = Math.min(pts.length / 7, N);
    const order = new Uint32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    for (let i = N - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 4);
    for (let n = 0; n < N; n++) {
      const i = order[n];
      if (n < count) {
        const k = n * 7;
        pos.set([pts[k], pts[k + 1], pts[k + 2]], i * 3);
        col.set([pts[k + 3], pts[k + 4], pts[k + 5], pts[k + 6]], i * 4);
      } else {
        const u = rand() * 2 - 1, th = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u), R = 1.7 + rand() * 1.8;
        const c = rand() < 0.5 ? C.violet : C.blue;
        pos.set([Math.cos(th) * rr * R, u * R * 0.75, Math.sin(th) * rr * R * 0.6], i * 3);
        col.set([c[0] * 0.1, c[1] * 0.1, c[2] * 0.1, 0.45], i * 4);
      }
    }
    return { pos, col };
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function create(canvas, options) {
    const attrs = { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) return null;
    const small = Math.min(innerWidth, innerHeight) < 700 || matchMedia('(pointer: coarse)').matches;
    const N = small ? 6000 : 11000;
    const STARS = small ? 1800 : 3600;
    const RAYS = small ? 56 : 96;
    const DASHES = small ? 10 : 14;
    const shapes = options.shapes;
    const sides = options.sides;
    let cpu = null;               // cached formations, re-uploaded if the context is restored
    let formations = [];
    let alts = {};
    let scatterF = null;
    let greetF = null;
    let built = false;
    let lost = false;
    let width = 1, height = 1, dpr = 1, aspect = 1, narrow = false;
    const layout = [];
    let proj = perspective(1);

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(vs, fs) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, a = {};
      const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < nu; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < na; i++) { const name = gl.getActiveAttrib(p, i).name; a[name] = gl.getAttribLocation(p, name); }
      return { p, u, a };
    }
    function buffer(data) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }

    let P = {}, B = {};
    function setup() {
      P.shape = program(SHAPE_VS, SHAPE_FS);
      P.star = program(STAR_VS, POINT_FS);
      P.ray = program(RAY_VS, LINE_FS);
      const r = rng(7);
      const seeds = new Float32Array(N * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = r();
      B.seeds = buffer(seeds);
      const stars = new Float32Array(STARS * 4), starSeeds = new Float32Array(STARS * 4);
      for (let i = 0; i < STARS; i++) {
        const a = r() * Math.PI * 2, R = 0.8 + Math.pow(r(), 0.7) * 9;
        stars.set([Math.cos(a) * R, Math.sin(a) * R * 0.8, r() * 56, 0], i * 4);
        starSeeds.set([r(), r(), r(), r()], i * 4);
      }
      B.stars = buffer(stars);
      B.starSeeds = buffer(starSeeds);
      const rays = new Float32Array(RAYS * DASHES * 2 * 4), raySeeds = new Float32Array(RAYS * DASHES * 2 * 4);
      let v = 0;
      for (let k = 0; k < RAYS; k++) {
        const angle = r() * Math.PI * 2, spread = 6 + r() * 5, sx = r(), sy = r(), sz = r();
        for (let j = 0; j < DASHES; j++) {
          const t = (j + r() * 0.6) / DASHES;
          for (let end = 0; end < 2; end++) {
            rays.set([angle, spread, t, end], v * 4);
            raySeeds.set([sx, sy, sz, 0], v * 4);
            v++;
          }
        }
      }
      B.rays = buffer(rays);
      B.raySeeds = buffer(raySeeds);
      if (cpu) upload();
      maxAttribs = Math.min(gl.getParameter(gl.MAX_VERTEX_ATTRIBS), 8);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
    }
    function upload() {
      formations = cpu.list.map(f => ({ pos: buffer(f.pos), col: buffer(f.col) }));
      alts = {};
      Object.keys(cpu.alt || {}).forEach(key => { alts[key] = { pos: buffer(cpu.alt[key].pos), col: buffer(cpu.alt[key].col) }; });
      scatterF = { pos: buffer(cpu.scatter.pos), col: buffer(cpu.scatter.col) };
      greetF = cpu.greet ? { pos: buffer(cpu.greet.pos), col: buffer(cpu.greet.col) } : null;
    }

    async function build(onProgress) {
      const res = { logo: await loadImage(options.logo), question: options.question, greeting: options.greeting };
      const list = [];
      const scatter = formation('scatter', N, 3, res);
      for (let i = 0; i < shapes.length; i++) {
        list.push(formation(shapes[i], N, 100 + i * 17, res));
        if (onProgress) onProgress((i + 1) / shapes.length);
        await new Promise(r => setTimeout(r, 0));
      }
      const alt = {};
      if (shapes.includes('path')) alt.path = formation('path-h', N, 911, res);
      const greet = options.greeting ? formation('greeting', N, 61, res) : null;
      cpu = { list, scatter, alt, greet, greetFont: res.greetFont || 0 };
      if (!lost) upload();
      built = true;
    }

    function resize(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
      width = Math.max(1, w || innerWidth);
      height = Math.max(1, h || innerHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      aspect = width / height;
      narrow = aspect < 1.02;
      proj = perspective(aspect);
      const halfW = TAN * aspect * DISTANCE;
      const X = clamp(halfW * 0.5, 1.25, 2.35);
      for (let k = 0; k < shapes.length; k++) {
        const side = sides[k], key = shapes[k];
        let x = 0, y = 0, s = 1;
        if (key === 'tunnel') s = narrow ? 0.8 : 1;
        else if (narrow && key === 'question') { y = -0.35; s = 0.75; }
        else if (narrow && key === 'path') { y = 1.3; s = clamp(aspect * 1.2, 0.45, 0.7); }
        else if (narrow) { y = 0.95; s = clamp(aspect * 1.3, 0.5, 0.8); }
        else x = side === 'start' ? -X : side === 'end' ? X : 0;
        layout[k] = [x, y, -k * SPACING, s];
      }
    }

    // Where the greeting sits: [x, y, z, scale].
    function greetAt() {
      return [0, narrow ? 0.25 : 0.1, layout[0][2], narrow ? clamp(aspect * 1.5, 0.64, 0.95) : 1.3];
    }
    // The greeting in CSS pixels on the canvas (camera at the first chapter, pointer centred),
    // so the page can lay real text exactly over it: { x, y, font }.
    function greetBox() {
      if (!cpu || !cpu.greetFont) return null;
      const at = greetAt();
      const k = height / 2 / (TAN * (DISTANCE - at[2]));       // pixels per world unit
      const span = 2.9 * at[3];                                  // world size of the sampled square
      return { x: width / 2 + at[0] * k, y: height / 2 - (at[1] + span * 0.06) * k, font: cpu.greetFont * span * k };
    }

    function bindPair(fa, fb) {
      const a = P.shape.a;
      gl.bindBuffer(gl.ARRAY_BUFFER, fa.pos); gl.enableVertexAttribArray(a.aFrom); gl.vertexAttribPointer(a.aFrom, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, fa.col); gl.enableVertexAttribArray(a.aCFrom); gl.vertexAttribPointer(a.aCFrom, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, fb.pos); gl.enableVertexAttribArray(a.aTo); gl.vertexAttribPointer(a.aTo, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, fb.col); gl.enableVertexAttribArray(a.aCTo); gl.vertexAttribPointer(a.aCTo, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.seeds); gl.enableVertexAttribArray(a.aSeed); gl.vertexAttribPointer(a.aSeed, 4, gl.FLOAT, false, 0, 0);
    }
    function attrib(prog, name, buf, size) {
      const loc = prog.a[name];
      if (loc === undefined || loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    let maxAttribs = 8;
    function disableAll() {
      for (let i = 0; i < maxAttribs; i++) gl.disableVertexAttribArray(i);
    }

    // state: { cam, from, to, mix, greet, intro, warp, rays, dim, lift, shrink, px, py, mx, my, touch }
    function render(time, s) {
      if (lost) return;
      const t = time % 3600;
      gl.clear(gl.COLOR_BUFFER_BIT);
      const last = shapes.length - 1;
      const cam = clamp(s.cam, 0, last + 0.7);
      const camZ = DISTANCE - cam * SPACING;
      const eye = [s.px * 0.35, s.py * 0.2, camZ];
      const view = lookAt(eye, [s.px * 0.12, s.py * 0.07, camZ - 12]);
      const pv = multiply(proj, view);
      const unit = canvas.height / 2 / TAN;

      // stars
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.star.p);
      disableAll();
      attrib(P.star, 'aPos', B.stars, 4);
      attrib(P.star, 'aSeed', B.starSeeds, 4);
      gl.uniformMatrix4fv(P.star.u.uPV, false, pv);
      gl.uniform1f(P.star.u.uCamZ, camZ);
      gl.uniform1f(P.star.u.uTime, t);
      gl.uniform1f(P.star.u.uSize, unit * 0.022);
      gl.uniform1f(P.star.u.uWarp, s.warp);
      gl.drawArrays(gl.POINTS, 0, STARS);

      // beams
      gl.useProgram(P.ray.p);
      disableAll();
      attrib(P.ray, 'aRay', B.rays, 4);
      attrib(P.ray, 'aSeed', B.raySeeds, 4);
      gl.uniformMatrix4fv(P.ray.u.uPV, false, pv);
      gl.uniform1f(P.ray.u.uCamZ, camZ);
      gl.uniform1f(P.ray.u.uTime, t);
      gl.uniform1f(P.ray.u.uWarp, s.warp);
      gl.uniform1f(P.ray.u.uRays, s.rays);
      gl.drawArrays(gl.LINES, 0, RAYS * DASHES * 2);

      if (!built || !formations.length) return;

      // the shape cloud
      let from, to, mix, oFrom, oTo;
      if (s.intro < 1) {
        // Opening: dust → the message (greet 0 → 1), a pause, then the message → the logo (intro 0 → 1).
        // greet < 0 means the message was skipped and the dust gathers straight into the logo.
        const greeting = greetF && s.greet >= 0;
        const at = greetAt();
        if (greeting && s.intro <= 0) {
          from = scatterF; to = greetF; mix = s.greet; oFrom = oTo = at;
        } else {
          from = greeting ? greetF : scatterF; to = formations[0]; mix = s.intro;
          oFrom = greeting ? at : [layout[0][0], layout[0][1], layout[0][2], 1]; oTo = layout[0];
        }
      } else {
        const fa = clamp(s.from, 0, last), fb = clamp(s.to, 0, last);
        mix = fa === fb ? 1 : s.mix;
        const pick = k => (narrow && alts[shapes[k]]) || formations[k];
        from = pick(fa); to = pick(fb); oFrom = layout[fa]; oTo = layout[fb];
      }
      // optional nudge from the page (e.g. lift the shape to make room for longer text on phones)
      const lift = s.lift || 0, shrink = s.shrink || 1;
      if (lift || shrink !== 1) {
        oFrom = [oFrom[0], oFrom[1] + lift, oFrom[2], oFrom[3] * shrink];
        oTo = [oTo[0], oTo[1] + lift, oTo[2], oTo[3] * shrink];
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.shape.p);
      disableAll();
      bindPair(from, to);
      const u = P.shape.u;
      gl.uniformMatrix4fv(u.uPV, false, pv);
      gl.uniform4fv(u.uOffFrom, oFrom);
      gl.uniform4fv(u.uOffTo, oTo);
      gl.uniform1f(u.uMix, clamp(mix, 0, 1));
      gl.uniform1f(u.uTime, t);
      gl.uniform1f(u.uSize, unit * (small ? 0.032 : 0.027));
      gl.uniform1f(u.uDim, s.dim);
      // the greeting holds still (no sway, no pointer tilt) so it stays readable
      const still = greetF && s.greet >= 0 && s.intro < 1 ? 1 - s.intro : 0;
      gl.uniform1f(u.uSpin, (Math.sin(t * 0.18) * 0.1 + s.px * 0.22) * (1 - still));
      // the pointer, projected onto the plane of the current shape
      const plane = camZ - (-clamp(Math.round(cam), 0, last) * SPACING);
      const mx = eye[0] + s.mx * TAN * aspect * plane;
      const my = eye[1] + s.my * TAN * plane;
      gl.uniform4f(u.uMouse, mx, my, 0, s.touch);
      gl.drawArrays(gl.POINTS, 0, N);
    }

    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener('webglcontextrestored', () => { lost = false; P = {}; B = {}; setup(); resize(width, height); }, false);

    try { setup(); } catch (err) { console.warn('TECH TACK scene:', err); return null; }
    resize();
    return { build, resize, render, greetBox, get ready() { return built; }, get count() { return N; } };
  }

  window.TTScene = { create };
})();
