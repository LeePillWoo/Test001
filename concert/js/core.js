// 공용 도우미: 시드 난수, 노이즈, 색, 경로, 캔버스, 스크립트 로더, 기법 레지스트리.
// 브라우저에서는 window.ConcertCore, Node에서는 module.exports로 쓴다.
// 좌표계는 원본 그림과 같은 1254×1254 픽셀이다.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConcertCore = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const W = 1254;
  const H = 1254;

  // ── 난수 ──────────────────────────────────────────────
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32: 같은 시드면 같은 수열. 0 이상 1 미만 실수를 돌려준다.
  function seededRng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.gauss = () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return next;
  }

  // 이름별로 갈라진 난수열: 한 레이어를 고쳐도 다른 레이어의 무늬가 바뀌지 않게 한다.
  function rngFor(seed, name) {
    return seededRng((seed ^ hashString(name)) >>> 0);
  }

  // ── 노이즈 (2D 그라디언트 노이즈 + fbm) ─────────────────
  function makeNoise2D(seed) {
    const rand = seededRng(seed);
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const grad = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        case 3: return -x - y;
        case 4: return x;
        case 5: return -x;
        case 6: return y;
        default: return -y;
      }
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return function noise(x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const X = xi & 255;
      const Y = yi & 255;
      const u = fade(xf);
      const v = fade(yf);
      const aa = perm[perm[X] + Y];
      const ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y];
      const bb = perm[perm[X + 1] + Y + 1];
      const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return lerp(x1, x2, v) * 0.7071; // 대략 -1..1
    };
  }

  function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x, y);
      norm += amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum / norm;
  }

  // ── 수학 ──────────────────────────────────────────────
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // ── 색 ───────────────────────────────────────────────
  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function rgba(color, alpha = 1) {
    const [r, g, b] = Array.isArray(color) ? color : hexToRgb(color);
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
  }
  function mixColor(a, b, t) {
    const ca = Array.isArray(a) ? a : hexToRgb(a);
    const cb = Array.isArray(b) ? b : hexToRgb(b);
    return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
  }

  // ── 경로 ─────────────────────────────────────────────
  // 점 목록을 지나는 Catmull-Rom 곡선을 SVG 경로 문자열로 만든다. Path2D에 바로 넣을 수 있다.
  function smoothPath(points, closed = false, tension = 0.5) {
    const n = points.length;
    if (n < 2) return '';
    const f = (v) => Math.round(v * 10) / 10;
    const at = (i) => (closed ? points[(i + n) % n] : points[clamp(i, 0, n - 1)]);
    let d = `M${f(points[0][0])} ${f(points[0][1])}`;
    const segs = closed ? n : n - 1;
    const k = tension / 3;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      const c1x = p1[0] + (p2[0] - p0[0]) * k;
      const c1y = p1[1] + (p2[1] - p0[1]) * k;
      const c2x = p2[0] - (p3[0] - p1[0]) * k;
      const c2y = p2[1] - (p3[1] - p1[1]) * k;
      d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return closed ? d + 'Z' : d;
  }

  // ── 브라우저 전용 ─────────────────────────────────────
  function makeCanvas(w, h) {
    const c = root.document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const scriptCache = new Map();
  // file://로 열어도 동작하도록 모듈 대신 일반 스크립트를 주입한다.
  function loadScript(src) {
    if (scriptCache.has(src)) return scriptCache.get(src);
    const p = new Promise((resolve, reject) => {
      const el = root.document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = () => resolve(src);
      el.onerror = () => reject(new Error('스크립트를 불러오지 못했습니다: ' + src));
      root.document.head.appendChild(el);
    });
    scriptCache.set(src, p);
    return p;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new root.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다: ' + src));
      img.src = src;
    });
  }

  // ── 기법 레지스트리 ───────────────────────────────────
  // 각 기법 스크립트는 define(id, { mount(host, opts) })로 자신을 등록한다.
  // mount는 { destroy(), renderAt?(t) }를 돌려주는 Promise여야 한다.
  const methods = new Map();
  const waiters = new Map();
  function define(id, impl) {
    methods.set(id, impl);
    const w = waiters.get(id);
    if (w) {
      w.forEach((fn) => fn(impl));
      waiters.delete(id);
    }
  }
  function whenDefined(id) {
    if (methods.has(id)) return Promise.resolve(methods.get(id));
    return new Promise((resolve) => {
      if (!waiters.has(id)) waiters.set(id, []);
      waiters.get(id).push(resolve);
    });
  }

  return {
    W,
    H,
    hashString,
    seededRng,
    rngFor,
    makeNoise2D,
    fbm,
    clamp,
    lerp,
    smoothstep,
    hexToRgb,
    rgbToHex,
    rgba,
    mixColor,
    smoothPath,
    makeCanvas,
    loadScript,
    loadImage,
    define,
    whenDefined,
  };
});
