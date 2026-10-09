// 절차적 드로잉 레이어: hair — 머리카락 전부.
// 기하(실루엣, 결을 따라 그은 다발·가닥 흐름선, 잔머리)는 tools/proc_hair.py가 원본에서 잰 data/hair.js를 쓴다.
// 색은 원본 화소를 읽지 않는다: 팔레트 램프 + 손으로 잰 조명 구역 + 역광 규칙(바깥 배경 쪽 가장자리일수록
// 밝다) + 노이즈 + 다발 단위 난수로 정한다.
//
// 칠하는 순서 (애니메이션 일러스트처럼)
//   바탕(가장자리는 옅게) → 다발 리본(셀 셰이딩, 뿌리 굵고 끝 뾰족) → 가는 가닥 → 하이라이트 → 먹선
// 정적인 부분은 prepare에서 뒤(drawBack)·앞(drawFront) 두 장으로 굽는다.
// 매 프레임 그리는 것: 흩날리는 가닥 끝과 잔머리(끝으로 갈수록 흔들림), 무대 조명에 맞춰 일렁이는 테두리빛.
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});
  const TAU = Math.PI * 2;
  const CELL = 4; // 조명 격자 한 칸(px)
  const LEVELS = 7; // 밝기 단계 지도 개수

  // ── 팔레트: 밝기 램프 (u = 0 그늘 → 1 가장 밝은 결) ──────────
  const RAMPS = {
    // 왼쪽·위: 자줏빛 그늘 → 갈색 → 산호 → 복숭아
    warm: [
      [0, '#10060e'],
      [0.16, '#2c1520'],
      [0.32, '#4a2630'],
      [0.46, '#6a3c44'],
      [0.6, '#a85a58'],
      [0.72, '#ec8a7c'],
      [0.86, '#f9aa94'],
      [1, '#fcdccc'],
    ],
    // 오른쪽: 자홍 테두리빛
    pink: [
      [0, '#1e0a1a'],
      [0.16, '#30112a'],
      [0.32, '#4a1a38'],
      [0.46, '#7a2a48'],
      [0.6, '#c8405c'],
      [0.72, '#f06a7a'],
      [0.86, '#f8a4a8'],
      [1, '#fcd8d4'],
    ],
    // 그늘의 보랏빛 반사
    violet: [
      [0, '#120818'],
      [0.16, '#1e1028'],
      [0.32, '#2e1a44'],
      [0.46, '#432a62'],
      [0.6, '#5c3a80'],
      [0.72, '#7a52a0'],
      [0.86, '#a07ac0'],
      [1, '#d0b0e0'],
    ],
  };
  const INK = '#160814';
  const HAIR_LINE = '#2a1018'; // 피부 위를 지나는 가는 가닥

  // ── 조명 구역 (원본에서 손으로 잰 위치) ───────────────────
  // [x, y, 반경, 종류, 세기, 띠 폭]  띠 폭 > 0이면 역광: 바깥 배경 쪽 가장자리에서 그 폭 안쪽까지만 밝다.
  // warm = 왼쪽 위에서 오는 연어·복숭아빛, pink = 오른쪽 자홍빛, violet = 그늘의 보랏빛, dark = 깊은 그늘
  const LIGHTS = [
    // 뒤에서 오는 역광 (배경 쪽 가장자리 띠)
    [520, 380, 430, 'warm', 0.9, 80],
    [880, 60, 260, 'warm', 0.7, 50],
    [230, 790, 170, 'warm', 0.7, 50],
    [1080, 150, 150, 'pink', 0.7, 45],
    [1060, 140, 130, 'warm', 0.5, 45],
    [1160, 430, 250, 'pink', 0.95, 45],
    [1150, 880, 220, 'pink', 0.85, 35],
    [1000, 1150, 260, 'pink', 0.35, 20],
    // 앞에서 오는 무대 조명 (얼굴 둘레 머리, 오른쪽 덩어리 바깥 결)
    [890, 160, 210, 'warm', 0.55, 0],
    [690, 230, 120, 'warm', 0.5, 0],
    [640, 480, 100, 'warm', 0.5, 0],
    [520, 440, 90, 'warm', 0.45, 0],
    [770, 540, 80, 'warm', 0.55, 0],
    [1060, 260, 120, 'warm', 0.55, 0],
    [1140, 520, 140, 'pink', 0.75, 0],
    [1150, 720, 110, 'pink', 0.45, 0],
    [1000, 860, 70, 'pink', 0.5, 0],
    // 그늘의 보랏빛과 깊은 그늘
    [760, 70, 140, 'violet', 0.5, 0],
    [1020, 640, 150, 'violet', 0.45, 0],
    [960, 1100, 220, 'violet', 0.35, 0],
    [520, 390, 70, 'violet', 0.5, 0],
    [740, 350, 70, 'dark', 0.5, 0],
    [900, 560, 80, 'dark', 0.5, 0],
    [930, 1060, 190, 'dark', 0.4, 0],
  ];

  // ── 작은 수학 ──────────────────────────────────────────
  function smooth(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rampAt(stops, u) {
    if (u <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (u <= stops[i][0]) {
        const [u0, c0] = stops[i - 1];
        const [u1, c1] = stops[i];
        return mix3(c0, c1, (u - u0) / (u1 - u0));
      }
    }
    return stops[stops.length - 1][1];
  }

  // ── 조명 ─────────────────────────────────────────────
  // 한 점의 빛. dBg = 바깥 배경까지 거리(px).
  // rim = 역광(띠 폭이 있는 구역)의 합, fill = 앞 조명(띠 없는 구역)의 합, warm/pink = 빛의 색조 가중치.
  function lightAt(x, y, dBg) {
    const out = { warm: 0, pink: 0, violet: 0, dark: 0, rim: 0, fill: 0 };
    const add = (k, f) => (out[k] = 1 - (1 - out[k]) * (1 - f));
    for (const [lx, ly, r, kind, s, band] of LIGHTS) {
      const d2 = ((x - lx) * (x - lx) + (y - ly) * (y - ly)) / (r * r);
      if (d2 >= 1) continue;
      // 안쪽 절반은 평평하고 바깥 절반에서 부드럽게 사라진다
      let f = (1 - smooth(0.45, 1, Math.sqrt(d2))) * s;
      if (band > 0) f *= 1 - smooth(band * 0.55, band * 1.45, dBg);
      add(kind, f);
      if (kind === 'warm' || kind === 'pink') add(band > 0 ? 'rim' : 'fill', f);
    }
    return out;
  }

  // 밝기 단계 v(0..1)의 색. 역광은 다발을 램프 끝까지 올리고, 앞 조명은 갈색 중간톤까지만 올린다.
  function shade(L, v, ramps) {
    const lit = 1 - (1 - L.warm) * (1 - L.pink);
    const top = 0.44 + 0.6 * L.rim + 0.3 * L.fill - 0.25 * L.dark + 0.06 * L.n;
    const u = Math.max(0, Math.min(1, Math.pow(v, 0.85) * top));
    let c = rampAt(ramps.warm, u);
    const pinkW = L.pink / (L.pink + L.warm + 1e-3);
    c = mix3(c, rampAt(ramps.pink, u), pinkW * Math.min(1, L.pink * 2));
    return mix3(c, rampAt(ramps.violet, u), L.violet * (1 - lit) * 0.6);
  }

  // 바깥 배경까지의 거리 (CELL 해상도, 체임퍼 거리)
  function bgDistance(env, rings) {
    const w = Math.ceil(env.W / CELL);
    const h = Math.ceil(env.H / CELL);
    const c = env.makeCanvas(w, h);
    const g = c.getContext('2d');
    g.scale(1 / CELL, 1 / CELL);
    g.fillStyle = '#fff';
    g.fill(ringsPath(rings), 'evenodd');
    const px = g.getImageData(0, 0, w, h).data;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = px[i * 4 + 3] > 127 ? 0 : 1e9;
    const B = Math.SQRT2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 1);
          if (x > 0) v = Math.min(v, d[i - w - 1] + B);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 1);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
          if (x > 0) v = Math.min(v, d[i + w - 1] + B);
        }
        d[i] = v * CELL;
      }
    }
    return d;
  }

  // 조명 격자: 칸마다 빛을 한 번만 계산해 둔다
  function lightGrid(env, dist, noise) {
    const w = Math.ceil(env.W / CELL);
    const h = Math.ceil(env.H / CELL);
    const cells = new Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = i * CELL + CELL / 2;
        const y = j * CELL + CELL / 2;
        const L = lightAt(x, y, dist[j * w + i]);
        L.n = env.core.fbm(noise, x / 90, y / 90, 3);
        L.d = dist[j * w + i];
        cells[j * w + i] = L;
      }
    }
    return {
      w,
      h,
      cells,
      at(x, y) {
        const i = Math.min(w - 1, Math.max(0, Math.floor(x / CELL)));
        const j = Math.min(h - 1, Math.max(0, Math.floor(y / CELL)));
        return cells[j * w + i];
      },
    };
  }

  // 색 지도: 칸마다 fn(빛) → [r,g,b] 를 작은 캔버스에 칠한다. 패턴으로 쓸 때 CELL배로 늘린다.
  function makeMap(env, grid, fn) {
    const c = env.makeCanvas(grid.w, grid.h);
    const g = c.getContext('2d');
    const img = g.createImageData(grid.w, grid.h);
    for (let k = 0; k < grid.cells.length; k++) {
      const col = fn(grid.cells[k]);
      img.data[k * 4] = col[0];
      img.data[k * 4 + 1] = col[1];
      img.data[k * 4 + 2] = col[2];
      img.data[k * 4 + 3] = col.length > 3 ? col[3] : 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function mapPattern(g, small) {
    const pat = g.createPattern(small, 'no-repeat');
    pat.setTransform(new DOMMatrix([CELL, 0, 0, CELL, 0, 0]));
    return pat;
  }

  // ── 기하 도우미 ────────────────────────────────────────
  function ringsPath(rings) {
    const p = new Path2D();
    for (const r of rings) {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    }
    return p;
  }

  function slicePts(flat, a, b) {
    const out = [];
    for (let i = a; i < b; i++) out.push([flat[i * 2], flat[i * 2 + 1]]);
    return out;
  }

  // 점 목록을 따라 폭이 변하는 리본 다각형을 path에 더한다.
  // hw(s) = 반폭, s = 0(뿌리)..1(끝). off = 결에 수직으로 비켜 놓는 거리.
  function addRibbon(path, pts, hw, off = 0) {
    const n = pts.length;
    if (n < 2) return;
    const L = [0];
    for (let i = 1; i < n; i++) {
      L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = L[n - 1] || 1;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const w = hw(L[i] / total);
      const x = pts[i][0] - ty * off;
      const y = pts[i][1] + tx * off;
      left.push([x - ty * w, y + tx * w]);
      right.push([x + ty * w, y - tx * w]);
    }
    path.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) path.lineTo(left[i][0], left[i][1]);
    for (let i = n - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
    path.closePath();
  }

  // 긴 흐름선을 조각으로 자른다 (조각끼리 30% 겹친다). 반환: [시작, 끝) 점 번호 쌍
  function pieces(n, rng, minLen, maxLen) {
    const out = [];
    let a = 0;
    while (a < n - 1) {
      const len = Math.round(minLen + rng() * (maxLen - minLen));
      const b = Math.min(n, a + len);
      if (b - a >= 3) out.push([a, b]);
      if (b >= n) break;
      a = b - Math.max(1, Math.round(len * 0.3));
    }
    return out;
  }

  // 다발 조각: 다발 흐름선을 70~250px로 잘라 조각마다 밝기 하나 (셀 셰이딩 단위)
  function lockPieces(D, rng, grid) {
    const out = [];
    for (const flat of D.locks) {
      for (const [a, b] of pieces(flat.length / 2, rng, 18, 60)) {
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        // 두 갈래 분포: 밝은 다발 / 어두운 다발. 역광이 센 곳일수록 밝은 다발이 많다
        const pBright = 0.06 + 0.6 * grid.at(m[0], m[1]).rim;
        const v = rng() < pBright ? 0.72 + rng() * 0.28 : 0.18 + rng() * 0.36;
        out.push({ pts, v, w: 6 + rng() * 7 });
      }
    }
    return out;
  }

  // 점 → 가장 가까운 다발 조각 (격자 색인)
  function pieceIndex(list, cell) {
    const grid = new Map();
    list.forEach((p, idx) => {
      for (const [x, y] of p.pts) {
        const k = Math.floor(x / cell) * 1024 + Math.floor(y / cell);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(x, y, idx);
      }
    });
    return (x, y) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let best = -1;
      let bd = Infinity;
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          const arr = grid.get(i * 1024 + j);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k += 3) {
            const d = (arr[k] - x) * (arr[k] - x) + (arr[k + 1] - y) * (arr[k + 1] - y);
            if (d < bd) {
              bd = d;
              best = arr[k + 2];
            }
          }
        }
      }
      return best;
    };
  }

  const lockWidth = (L) => (s) => L.w * Math.sqrt(Math.min(1, s / 0.15 + 0.1)) * Math.pow(1 - s, 0.7);

  // ── 굽기: 정적인 머리 한 장 ─────────────────────────────
  function renderHair(env, D, maps, grid, clip) {
    const { W, H } = env;
    const c = env.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rng = env.rng('hair-paint');
    const pats = maps.levels.map((m) => mapPattern(g, m));
    const level = (v) => pats[Math.max(0, Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1))))];
    const locks = lockPieces(D, rng, grid);
    const nearest = pieceIndex(locks, 16);

    g.save();
    g.clip(clip, 'evenodd');

    // 1. 바탕: 어두운 단계. 바깥 가장자리 띠에서는 옅게 비워 배경이 가닥 사이로 비치게 한다
    g.fillStyle = pats[1];
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(maps.edge, 0, 0, W, H);
    g.globalCompositeOperation = 'source-over';

    // 2. 다발 리본: 조각마다 한 밝기로 거의 꽉 채운다
    g.globalAlpha = 0.92;
    for (const L of locks) {
      const path = new Path2D();
      addRibbon(path, L.pts, lockWidth(L));
      g.fillStyle = level(L.v);
      g.fill(path);
    }

    // 3. 가는 가닥: 놓인 다발의 밝기를 따르되 가끔 반대 밝기 (다발 안의 잔결)
    const hl = [];
    for (const flat of D.strands) {
      for (const [a, b] of pieces(flat.length / 2, rng, 16, 60)) {
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        const li = nearest(m[0], m[1]);
        const lv = li >= 0 ? locks[li].v : 0.3;
        // 바깥 가장자리를 스치는 가닥은 역광을 받는다 (테두리빛)
        let dEdge = Infinity;
        for (let i = 0; i < pts.length; i += 2) dEdge = Math.min(dEdge, grid.at(pts[i][0], pts[i][1]).d);
        const la = grid.at(m[0], m[1]);
        const rim = dEdge < 7 && rng() < la.rim * 0.8;
        for (let k = 0; k < 2; k++) {
          const off = (rng() - 0.5) * 3.2;
          const w0 = 0.5 + rng() * 1.0;
          let v = lv + (rng() - 0.5) * 0.12;
          if (rng() < 0.07) v = lv > 0.5 ? 0.1 + rng() * 0.3 : 0.55 + rng() * 0.35;
          if (rim && k === 0) v = 0.8 + rng() * 0.2;
          v = Math.min(1, Math.max(0, v));
          const path = new Path2D();
          addRibbon(path, pts, (s) => w0 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.85 + 0.08)), 0.6), off);
          g.globalAlpha = 0.8 + 0.2 * rng();
          g.fillStyle = level(v);
          g.fill(path);
          // 하이라이트: 밝은 다발 위에 많이, 앞 조명이 닿는 어두운 다발 위에도 가늘게
          const pHl = v > 0.66 ? 0.7 : 0.02 + 0.5 * la.fill;
          if (rng() < pHl) hl.push({ pts, off, w: 0.5 + rng() * 1.1, a: 0.7 + 0.3 * rng() });
        }
      }
    }

    // 4. 하이라이트: 가장 밝은 색을 더 가늘게, 가닥의 가운데 구간에만
    g.fillStyle = mapPattern(g, maps.hl);
    for (const h of hl) {
      const path = new Path2D();
      const s0 = rng() * 0.3;
      const s1 = 0.6 + rng() * 0.4;
      addRibbon(path, h.pts, (s) => (s < s0 || s > s1 ? 0 : h.w * Math.sin((Math.PI * (s - s0)) / (s1 - s0))), h.off);
      g.globalAlpha = h.a;
      g.fill(path);
    }

    // 5. 먹선: 다발 리본 한쪽 가장자리를 따라 가늘고 어두운 선 (다발 사이 경계)
    g.fillStyle = INK;
    for (const L of locks) {
      if (rng() > 0.8) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const wl = 0.6 + rng() * 1.0;
      const s0 = rng() * 0.2;
      const s1 = 0.55 + rng() * 0.45;
      const path = new Path2D();
      addRibbon(path, L.pts, (s) => (s < s0 || s > s1 ? 0 : wl * Math.sin((Math.PI * (s - s0)) / (s1 - s0))),
        side * lockWidth(L)(0.4) * 0.85);
      g.globalAlpha = 0.7 + 0.3 * rng();
      g.fill(path);
    }
    g.restore();
    return c;
  }

  // 흩날리는 끝: 바깥 배경에 닿은 가닥 끝을 결 방향으로 늘인 짧은 곡선 (매 프레임 흔든다)
  function looseEnds(D, rng, grid) {
    const out = [];
    for (let si = 0; si < D.strands.length; si++) {
      const f = +D.open[si];
      if (!f) continue;
      const flat = D.strands[si];
      const n = flat.length / 2;
      for (const end of [1, 2]) {
        if (!(f & end) || n < 3 || rng() > 0.8) continue;
        const base = end === 1 ? slicePts(flat, n - 3, n) : slicePts(flat, 0, 3).reverse();
        const q = base[2];
        let ang = Math.atan2(q[1] - base[1][1], q[0] - base[1][0]);
        const curl = (rng() - 0.5) * 0.32;
        const len = 8 + rng() * 30;
        const pts = base.slice();
        let x = q[0];
        let y = q[1];
        for (let d = 4; d <= len; d += 4) {
          ang += curl;
          x += Math.cos(ang) * 4;
          y += Math.sin(ang) * 4;
          pts.push([x, y]);
        }
        const la = grid.at(q[0], q[1]);
        out.push({
          pts,
          v: Math.min(1, 0.45 + Math.max(la.rim, la.fill) * 0.5 + rng() * 0.15),
          w: 0.45 + rng() * 0.6,
          a: 0.6 + 0.35 * rng(),
          ph: rng() * TAU,
          sp: 0.7 + rng() * 0.9,
          amp: 1 + rng() * 2.5,
        });
      }
    }
    return out;
  }

  // 흔들림: 첫 두 점(뿌리 쪽)은 고정, 끝으로 갈수록 크게. t=0이면 제자리.
  function sway(pts, f, t) {
    const k = Math.sin(t * f.sp + f.ph) - Math.sin(f.ph);
    if (k === 0) return pts;
    const n = pts.length;
    return pts.map((p, i) => {
      const s = Math.max(0, (i - 1) / Math.max(1, n - 2));
      return [p[0] + k * f.amp * s * s, p[1] + k * f.amp * 0.6 * s * s];
    });
  }

  function clipTo(env, src, path) {
    const c = env.makeCanvas(env.W, env.H);
    const g = c.getContext('2d');
    g.clip(path, 'evenodd');
    g.drawImage(src, 0, 0);
    return c;
  }

  P.hair = {
    async prepare(env) {
      const T0 = performance.now();
      const tick = (label) => {
        if (env.params.get('hairtime')) console.warn('hair', label, Math.round(performance.now() - T0));
      };
      await env.core.loadScript('js/procedural/data/hair.js');
      const D = P.hairData;
      const C = env.core;
      const ramps = {};
      for (const k of Object.keys(RAMPS)) ramps[k] = RAMPS[k].map(([u, hex]) => [u, C.hexToRgb(hex)]);
      const noise = C.makeNoise2D((env.seed ^ 0x4a17) >>> 0);
      const dist = bgDistance(env, D.outer);
      const grid = lightGrid(env, dist, noise);
      tick('light');

      // 밝기 단계별 색 지도 + 하이라이트 + 잔머리 + 가장자리 비우기
      const levels = [];
      for (let k = 0; k < LEVELS; k++) levels.push(makeMap(env, grid, (L) => shade(L, k / (LEVELS - 1), ramps)));
      const maps = {
        levels,
        // 하이라이트: 빛이 닿는 곳일수록 복숭아·흰빛
        hl: makeMap(env, grid, (L) => {
          const k = Math.max(L.rim, L.fill);
          return shade({ ...L, rim: 0.65 + 0.35 * k, fill: 0, dark: L.dark * 0.4 }, 0.82 + 0.18 * k, ramps);
        }),
        // 잔머리: 테두리빛 색
        fly: makeMap(env, grid, (L) =>
          shade({ ...L, rim: Math.max(L.rim, 0.5), fill: 0, violet: 0, dark: 0 }, 0.85, ramps)),
        // 바깥 배경에 가까울수록 바탕을 많이 지운다 (검정 + 불투명도)
        edge: makeMap(env, grid, (L) => [0, 0, 0, Math.round(255 * 0.8 * (1 - smooth(1, 16, L.d)))]),
      };
      tick('maps');

      const silPath = ringsPath(D.sil);
      const backPath = env.params.get('hairext') === '0' ? silPath : ringsPath(D.back);
      const hair = renderHair(env, D, maps, grid, backPath);
      tick('render');

      // 디버그: hairmap=k 이면 k번째 밝기 단계 지도(또는 hl, fly)를 실루엣에 그대로 칠해 본다
      const dbg = env.params.get('hairmap');
      if (dbg !== null) {
        const g = hair.getContext('2d');
        g.save();
        g.clip(silPath, 'evenodd');
        const gray = (k) => makeMap(env, grid, (L) => [L[k] * 255, L[k] * 255, L[k] * 255]);
        const m = maps[dbg] || levels[+dbg] || gray(dbg);
        g.fillStyle = mapPattern(g, m);
        g.fillRect(0, 0, env.W, env.H);
        g.restore();
      }

      // 일렁이는 테두리빛: 바깥 가장자리 띠에 가장 밝은 결 색을 깔아 둔 한 장 (알파만 시간에 따라)
      const glow = env.makeCanvas(env.W, env.H);
      {
        const g = glow.getContext('2d');
        g.clip(silPath, 'evenodd');
        g.fillStyle = mapPattern(g, maps.hl);
        g.fillRect(0, 0, env.W, env.H);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(makeMap(env, grid, (L) => [0, 0, 0, Math.round(255 * L.rim * (1 - smooth(4, 30, L.d)))]),
          0, 0, env.W, env.H);
      }

      const rngA = env.rng('hair-anim');
      const rngF = env.rng('hair-fly');
      const fly = D.fly.map((flat) => ({
        pts: slicePts(flat, 0, flat.length / 2),
        w: 0.45 + rngF() * 0.5,
        a: 0.55 + rngF() * 0.4,
        ph: rngF() * TAU,
        sp: 0.6 + rngF() * 0.8,
        amp: 1.5 + rngF() * 2.5,
      }));
      // 목·가슴을 가로지르는 가는 가닥
      const cross = D.cross.map((flat, i) => ({
        pts: slicePts(flat, 0, flat.length / 2),
        w: D.crossW[i] * (0.8 + rngF() * 0.4),
        a: 0.7 + rngF() * 0.25,
        ph: rngF() * TAU,
        sp: 0.5 + rngF() * 0.5,
        amp: 0.8 + rngF() * 1.2,
      }));
      tick('done');

      return {
        cross,
        back: hair,
        front: clipTo(env, hair, ringsPath(D.front)),
        glow,
        maps,
        loose: looseEnds(D, rngA, grid),
        fly,
        glowPh: rngA() * TAU,
      };
    },

    drawBack(ctx, st, t) {
      ctx.drawImage(st.back, 0, 0);
      // 흩날리는 가닥 끝 (몸·얼굴보다 뒤)
      const pats = st.maps.levels.map((m) => mapPattern(ctx, m));
      for (const f of st.loose) {
        const path = new Path2D();
        addRibbon(path, sway(f.pts, f, t), (s) => f.w * Math.pow(1 - s, 0.8));
        ctx.globalAlpha = f.a;
        ctx.fillStyle = pats[Math.round(f.v * (LEVELS - 1))];
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    },

    drawFront(ctx, st, t) {
      ctx.drawImage(st.front, 0, 0);
      // 무대 조명에 맞춰 테두리빛이 잠깐씩 밝아진다 (t=0이면 0)
      const pulse = 0.5 - 0.5 * Math.cos(t * 1.7 + 0.6 * Math.sin(t * 0.43 + st.glowPh) - 0.6 * Math.sin(st.glowPh));
      if (pulse > 0.002) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.35 * pulse;
        ctx.drawImage(st.glow, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      }
      // 목·가슴 위의 가는 가닥 (먹선 색, 끝이 가늘게)
      ctx.fillStyle = HAIR_LINE;
      for (const f of st.cross) {
        const path = new Path2D();
        addRibbon(path, sway(f.pts, f, t), (s) => f.w * Math.min(1, s * 8 + 0.3) * Math.pow(1 - s, 0.6));
        ctx.globalAlpha = f.a;
        ctx.fill(path);
      }
      // 잔머리: 뿌리는 고정, 끝으로 갈수록 크게 흔들린다
      ctx.fillStyle = mapPattern(ctx, st.maps.fly);
      for (const f of st.fly) {
        const path = new Path2D();
        addRibbon(path, sway(f.pts, f, t), (s) => f.w * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)), 0.5));
        ctx.globalAlpha = f.a;
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    },
  };
})();
