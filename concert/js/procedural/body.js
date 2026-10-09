// 절차적 드로잉 레이어: body — 목·어깨·가슴·팔·허리 피부와 스팽글 드레스(몸판·치마·가방·어깨끈).
// 윤곽과 명암 단계 모양은 data/body.js(tools/proc_body.py가 원본에서 잰 기하)를 쓰고,
// 색은 아래 팔레트를 그라디언트·셀 단계·림 라이트·노이즈 규칙으로 입힌다.
// 스팽글은 천의 곡률을 따르는 곡선 격자(행 안내선 사이 보간) 위에 하나씩 그리고,
// 밝기·색은 손으로 잰 조명 구역과 노이즈로 정한다. 정적인 그림은 prepare에서 한 장에 굽는다.
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});

  // ── 팔레트 (원본에서 잰 색) ──────────────────────────────
  const SKIN = {
    warm: '#ffc4a8', // 따뜻한 반사광
    pink: '#ff9fb4', // 분홍 조명 림
    line: '#3a1820',
  };
  // 부위별 셀 단계 색: [하이라이트, 바탕, 그림자1..4]. 부위마다 받는 빛이 달라
  // 팔은 분홍 조명 쪽으로, 목·가슴은 주황빛 그림자로 기운다.
  const TONES = {
    arm: ['#fff4e8', '#fedac1', '#fdb6ab', '#fca6a2', '#f79991', '#e88a88'],
    torso: ['#fff0e2', '#fdd6bd', '#fdc2a8', '#f29f91', '#db817d', '#c1676b'],
    waist: ['#fff0e2', '#fdd9bf', '#fcc2a9', '#faae9a', '#ee9388', '#e18986'],
    fore: ['#fff0e8', '#fddfd4', '#fcc2b8', '#ea8d95', '#da8488', '#d07179'],
  };
  const DRESS = {
    base: '#0a040c',
    deep: '#050208',
    sheen: '#2c1838',
    violet: '#3c2060',
    line: '#07030a',
    dim: '#3a1834', // 빛을 덜 받은 스팽글
    scale: '#0f0817', // 스팽글 몸통(비늘)
  };
  const SEQ = {
    white: '#fdf8ff',
    lavender: '#c6a6f0',
    pink: '#ff5cb4',
    magenta: '#f02cb0',
    blue: '#7e9cff',
    red: '#ff4a7c',
  };

  // ── 스팽글 조명 구역: [x, y, 반지름, 색 이름, 세기] ──
  // 원본 드레스에서 밝은 스팽글이 몰린 자리를 가우스 덩어리로 잰 값. 세기는 그 자리의 '반짝이는 면적 비율'.
  const ZONES = {
    dress: [
      [681, 784, 85, 'white', 0.26],
      [694, 1027, 28, 'magenta', 0.21],
      [517, 1200, 28, 'pink', 0.2],
      [778, 892, 43, 'lavender', 0.14],
      [545, 1137, 28, 'pink', 0.14],
      [608, 996, 85, 'pink', 0.11],
      [728, 906, 28, 'white', 0.09],
      [584, 867, 28, 'white', 0.085],
      [750, 880, 32, 'blue', 0.06],
      [600, 905, 60, 'pink', 0.12],
      [660, 950, 50, 'white', 0.08],
    ],
    skirt: [
      [107, 984, 85, 'white', 0.34],
      [10, 1133, 85, 'blue', 0.26],
      [189, 870, 62, 'pink', 0.19],
      [46, 1210, 28, 'white', 0.15],
      [200, 1035, 28, 'lavender', 0.14],
      [0, 1238, 28, 'white', 0.13],
      [151, 1209, 28, 'lavender', 0.1],
      [87, 1253, 43, 'white', 0.09],
      [116, 1150, 28, 'white', 0.08],
      [91, 1189, 28, 'white', 0.08],
    ],
  };
  // 구역 밖의 바탕 비율 — 스팽글 몇 개는 어디서나 반짝인다
  const AMBIENT = { dress: 0.045, skirt: 0.05 };
  // 반짝이는 면적 비율 → 스팽글 하나가 밝게 보일 확률 (밝은 스팽글 하나가 칸의 약 1/3을 덮는다)
  const P_GAIN = 2.6;
  // 스팽글 반지름 / 행 간격
  const SEQ_R = 0.3;

  // ── 스팽글 행 안내선 (원본 좌표). 이웃 안내선 사이를 행 간격으로 보간해 행을 만든다 ──
  // 몸판: 위는 목선을 따라 휘고, 가슴 아래에서 평평해졌다가 허리에서 접혀 촘촘해지고,
  // 아래쪽은 몸이 기운 쪽으로 기운다.
  const ROWS = {
    dress: {
      pitch: 8.5,
      guides: [
        { pitch: 8, pts: [[470, 742], [590, 752], [650, 778], [720, 797], [780, 810], [840, 800], [900, 780], [975, 752]] },
        { pitch: 9, pts: [[450, 800], [560, 828], [640, 858], [720, 872], [800, 870], [870, 850], [970, 820]] },
        { pitch: 10, pts: [[420, 900], [520, 942], [600, 960], [680, 962], [760, 950], [850, 925], [960, 895]] },
        { pitch: 6, stretch: 1.7, pts: [[380, 990], [470, 1015], [560, 1036], [640, 1022], [720, 1004], [820, 990]] },
        { pitch: 9, pts: [[340, 1080], [450, 1086], [560, 1072], [640, 1052]] },
        { pitch: 9.5, pts: [[250, 1270], [400, 1252], [490, 1238], [600, 1224]] },
      ],
    },
    skirt: {
      pitch: 11,
      guides: [
        // 엉덩이를 감아 오른쪽 아래로 약 30° 기운 행, 왼쪽 아래로 내려가는 열(약 115°)
        { pitch: 11.5, pts: [[-120, 790], [100, 900], [320, 1000], [450, 1070]] },
        { pitch: 11.5, pts: [[-210, 990], [10, 1100], [230, 1200], [360, 1270]] },
        { pitch: 11, pts: [[-300, 1190], [-80, 1300], [140, 1400], [270, 1470]] },
      ],
    },
  };

  // 목선(드레스 위 가장자리)과 겨드랑이 쪽 검은 안감
  const NECKLINE = [[540, 744], [590, 752], [630, 770], [680, 786], [730, 798], [780, 809], [820, 803],
    [860, 794], [905, 780], [960, 752]];
  const LINING = [[572, 726], [600, 722], [612, 738], [632, 760], [662, 782], [610, 792], [560, 792]];

  // 치마에 박힌 큰 원형 장식(라인스톤): x, y, 반지름
  const JEWELS = [[130, 1021, 7], [62, 958, 8], [250, 944, 5], [113, 935, 5]];
  // 치마 윗단(허리 피부와의 경계)
  const SKIRT_TOP = [[110, 866], [160, 868], [200, 898], [240, 930], [280, 962], [310, 992]];
  // 가방(왼쪽 아래 검은 가죽): 분홍 조명을 받는 윗면과 구김 선
  const SASH_LIT = [[-10, 906], [40, 876], [82, 846], [112, 857], [122, 842], [160, 830], [180, 850],
    [150, 868], [116, 872], [80, 884], [40, 910], [-10, 940]];
  const SASH_CREASES = [
    [[[4, 922], [40, 896], [76, 868]], 3],
    [[[30, 912], [62, 884], [96, 864]], 2],
    [[[10, 960], [50, 936], [90, 900]], 2.5],
    [[[60, 960], [96, 920], [118, 890]], 2],
  ];

  // 피부의 작은 윤기(흰 점·짧은 획): [점들, 굵기]
  const SHINES = [
    [[[596, 496], [599, 501]], 1.6],
    [[[606, 518], [607, 523]], 1.4],
    [[[792, 520], [794, 522]], 1.6],
    [[[688, 690], [692, 700]], 1.2],
  ];

  // ── 손으로 그린 안쪽 선: [점들, 굵기] (빗장뼈·가슴골·겨드랑이·팔꿈치 주름) ──
  const INNER_LINES = [
    [[[742, 768], [748, 782], [754, 796]], 1.6],
    [[[820, 666], [838, 650], [858, 640]], 1.4],
    [[[598, 690], [592, 716], [586, 742]], 1.8],
    [[[368, 1030], [376, 1050], [380, 1072]], 1.2],
    [[[600, 748], [640, 772], [690, 788]], 1.0],
  ];

  // ── 작은 도우미 ─────────────────────────────────────────
  function flat(r) {
    const out = [];
    for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
    return out;
  }
  // 차이킨 다듬기: 각진 마스크 윤곽을 부드러운 곡선으로
  function chaikin(pts, closed, iters) {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      const q = [];
      const n = p.length;
      const m = closed ? n : n - 1;
      if (!closed) q.push(p[0]);
      for (let i = 0; i < m; i++) {
        const a = p[i];
        const b = p[(i + 1) % n];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) q.push(p[n - 1]);
      p = q;
    }
    return p;
  }
  function ringsPath(rings, iters = 2) {
    const path = new Path2D();
    for (const r of rings) {
      const pts = chaikin(flat(r), true, iters);
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
    }
    return path;
  }
  // 열린 곡선을 일정 간격으로 다시 찍는다
  function resample(pts, step) {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const d = Math.hypot(x1 - x0, y1 - y0);
      let s = step - carry;
      while (s <= d) {
        const f = s / d;
        out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
        s += step;
      }
      carry = d - (s - step);
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
    return out;
  }
  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  // 호 길이 비율 s(0..1) 위치. pts는 촘촘하게 다시 찍은 곡선
  function at(dense, s) {
    const n = dense.length - 1;
    const f = Math.min(Math.max(s, 0), 1) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const u = f - i;
    return [dense[i][0] + (dense[i + 1][0] - dense[i][0]) * u, dense[i][1] + (dense[i + 1][1] - dense[i][1]) * u];
  }

  // 폭이 w(u)(u: 0..1 호 길이 비율)인 띠 모양. off는 중심선을 옆으로 미는 양(+는 진행 방향 왼쪽)
  function ribbon(pts, w, off) {
    const n = pts.length;
    const L = [];
    const R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let nx = a[1] - b[1];
      let ny = b[0] - a[0];
      const d = Math.hypot(nx, ny) || 1;
      nx /= d;
      ny /= d;
      const u = i / (n - 1);
      const hw = Math.max(0, w(u)) / 2;
      const cx = pts[i][0] + nx * off;
      const cy = pts[i][1] + ny * off;
      L.push([cx + nx * hw, cy + ny * hw]);
      R.push([cx - nx * hw, cy - ny * hw]);
    }
    const path = new Path2D();
    L.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    for (let i = n - 1; i >= 0; i--) path.lineTo(R[i][0], R[i][1]);
    path.closePath();
    return path;
  }

  // 굵기가 노이즈로 흔들리는 먹선. 짧은 마디를 둥근 끝으로 이어 그린다.
  function inkLine(g, pts, width, color, noise, seedOff, taper = true) {
    const dense = resample(pts, 2.5);
    const n = dense.length;
    if (n < 2) return;
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 1; i < n; i++) {
      const [x0, y0] = dense[i - 1];
      const [x1, y1] = dense[i];
      const s = i / (n - 1);
      const nz = noise((x0 + seedOff) * 0.02, y0 * 0.02);
      let w = width * (0.75 + 0.55 * nz);
      if (taper) w *= Math.min(1, s * 6, (1 - s) * 6) * 0.7 + 0.3;
      g.lineWidth = Math.max(0.4, w);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }

  // ── 피부 ───────────────────────────────────────────────
  // 단계별 경계 흐림(px): [하이라이트, 그림자1..4]. 기본은 또렷한 셀 경계
  const BLUR = [1.5, 0.6, 0.6, 0.6, 0.6];

  function drawSkin(g, env, shapes, name, opts) {
    const C = env.core;
    const shape = shapes[name];
    const tone = TONES[name];
    g.save();
    g.clip(shape.path, 'evenodd');
    // 바탕: 왼쪽 위 조명에서 오른쪽 아래로 살짝 따뜻해지는 그라디언트
    const [x0, y0, x1, y1] = opts.grad;
    const lin = g.createLinearGradient(x0, y0, x1, y1);
    lin.addColorStop(0, C.mixColor(tone[1], tone[0], 0.15));
    lin.addColorStop(0.6, tone[1]);
    lin.addColorStop(1, C.mixColor(tone[1], SKIN.warm, 0.3));
    g.fillStyle = lin;
    g.fillRect(0, 0, env.W, env.H);
    // 셀 그림자 단계: 그림자 1..4, 마지막에 하이라이트. 단계마다 분홍 조명 쪽으로 기우는 그라디언트
    const order = [1, 2, 3, 4, 0];
    for (const k of order) {
      const path = shape.bands[k];
      if (!path) continue;
      const col = k === 0 ? tone[0] : tone[k + 1];
      const blur = (opts.blur || BLUR)[k];
      g.save();
      if (blur > 0) g.filter = `blur(${blur}px)`;
      if (k === 0) {
        g.fillStyle = col;
        g.globalAlpha = 0.85;
      } else {
        const lg = g.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, C.mixColor(col, SKIN.warm, 0.08));
        lg.addColorStop(1, C.mixColor(col, SKIN.pink, 0.1));
        g.fillStyle = lg;
      }
      g.fill(path, 'evenodd');
      g.restore();
    }
    // 분홍·붉은 조명 반사(림): 지정한 쪽 가장자리를 안쪽으로 번지게 칠한다
    if (opts.rim) {
      for (const [rx, ry, rr, col, a] of opts.rim) {
        const rg = g.createRadialGradient(rx, ry, 0, rx, ry, rr);
        rg.addColorStop(0, C.rgba(col, a));
        rg.addColorStop(1, C.rgba(col, 0));
        g.fillStyle = rg;
        g.globalCompositeOperation = 'soft-light';
        g.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
        g.globalCompositeOperation = 'source-over';
      }
    }
    g.restore();
  }

  // ── 드레스 ─────────────────────────────────────────────
  function makeRows(spec) {
    const guides = spec.guides.map((gd) => {
      const pts = Array.isArray(gd) ? gd : gd.pts;
      const dense = resample(chaikin(pts, false, 3), 2);
      return { dense, len: polyLength(dense), pitch: gd.pitch || spec.pitch, stretch: gd.stretch || 1 };
    });
    const rows = [];
    for (let k = 0; k < guides.length - 1; k++) {
      const A = guides[k];
      const B = guides[k + 1];
      let d = 0;
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const a = at(A.dense, s);
        const b = at(B.dense, s);
        d += Math.hypot(a[0] - b[0], a[1] - b[1]) / 5;
      }
      const pv = (A.pitch + B.pitch) / 2;
      const nr = Math.max(1, Math.round(d / pv));
      for (let j = 0; j < nr; j++) {
        const f = j / nr;
        const len = A.len + (B.len - A.len) * f;
        const pu = A.pitch + (B.pitch - A.pitch) * f;
        const st = A.stretch + (B.stretch - A.stretch) * f;
        rows.push({ A: A.dense, B: B.dense, f, count: Math.round(len / pu), pitch: pu, stretch: st });
      }
    }
    return rows;
  }

  // 스팽글 자리의 조명: 구역 가우스 합(음수 세기 = 그늘) × 큰 노이즈. 색은 구역 색의 가중 평균.
  function lightAt(zones, amb, x, y, noise) {
    let I = amb;
    let r = 0;
    let gg = 0;
    let b = 0;
    let wsum = 0;
    for (const [zx, zy, zr, cname, a] of zones) {
      const d2 = ((x - zx) * (x - zx) + (y - zy) * (y - zy)) / (zr * zr);
      if (d2 > 9) continue;
      const w = a * Math.exp(-d2 * 1.2);
      I += w;
      if (w <= 0) continue;
      const c = SEQ.rgb[cname];
      r += c[0] * w;
      gg += c[1] * w;
      b += c[2] * w;
      wsum += w;
    }
    I = Math.max(0, I) * (0.7 + 0.6 * (noise(x * 0.012, y * 0.012) * 0.5 + 0.5));
    const base = SEQ.rgb.lavender;
    const k = 0.05;
    const col = [(r + base[0] * k) / (wsum + k), (gg + base[1] * k) / (wsum + k), (b + base[2] * k) / (wsum + k)];
    return { I, col };
  }

  function drawSequins(g, env, path, name, rng, noise, fx) {
    const C = env.core;
    const spec = ROWS[name];
    const zones = ZONES[name];
    const rows = makeRows(spec);
    const dim = C.hexToRgb(DRESS.dim);
    const white = SEQ.rgb.white;
    g.save();
    g.clip(path, 'evenodd');
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.count; i++) {
        const s = (i + 0.5) / row.count;
        const a = at(row.A, s);
        const b = at(row.B, s);
        const x = a[0] + (b[0] - a[0]) * row.f + (rng() - 0.5) * 0.7;
        const y = a[1] + (b[1] - a[1]) * row.f + (rng() - 0.5) * 0.7;
        const facet = rng();
        const rj = rng();
        if (!g.isPointInPath(path, x, y, 'evenodd')) continue;
        const L = lightAt(zones, AMBIENT[name], x, y, noise);
        // 주름: 행을 따라 길게 이어지고 행을 가로질러 빨리 바뀌는 노이즈 → 가로로 어두운 골
        const fold = C.smoothstep(-0.6, 0.4, noise(s * 3.1 + 17.3, j * 0.21 + row.f));
        // 행을 따라 이어지는 반짝임 줄무늬(이웃 스팽글끼리 닮게)
        const streak = noise(s * 14 + j * 0.37, j * 0.9) * 0.5 + 0.5;
        // 밝게 보일 확률 p와 이 스팽글의 각도 u: u < p면 반짝인다. p - u가 클수록 희게.
        const p = C.clamp(P_GAIN * L.I * (0.7 + 0.45 * fold) * (0.75 + 0.5 * streak), 0, 0.98);
        const u = facet;
        const col = L.col;
        let fill;
        let b2 = 0;
        if (u < p) {
          b2 = C.clamp((p - u) / 0.35, 0, 1);
          fill = b2 < 0.45 ? C.rgba(mix3(dim, col, 0.55 + b2), 0.95) : C.rgba(mix3(col, white, b2 - 0.2), 1);
        } else {
          // 빛을 비껴 받은 스팽글: 조명 색이 살짝 밴 어두운 점으로 격자 결이 늘 보이게
          const d = C.clamp((u - p) / 0.5, 0, 1);
          fill = C.rgba(mix3(dim, col, 0.45 * (1 - d) + 0.1), 0.85 - 0.35 * d);
        }
        const rad = row.pitch * SEQ_R * (0.75 + 0.35 * b2 + rj * 0.15);
        // 행 방향(접힌 띠에서는 스팽글이 행을 따라 납작하게 눕는다)
        const p0 = at(row.A, s - 0.002);
        const p1 = at(row.A, s + 0.002);
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const sx = row.stretch;
        const sy = 1 / Math.sqrt(row.stretch);
        // 스팽글 몸통: 비늘처럼 겹치는 어두운 원판(아래 행이 위 행을 살짝 덮는다)
        const body = row.pitch * 0.5;
        g.fillStyle = C.rgba(mix3(SEQ.body, col, 0.04 + 0.08 * L.I), 0.8);
        g.beginPath();
        g.ellipse(x, y + body * 0.12, body * sx, body * sy, ang, 0, Math.PI * 2);
        g.fill();
        // 빛을 받은 면: 기울기마다 조금씩 다른 타원. 밝은 것 중 일부는 가운데 구멍이 비쳐 고리가 된다
        const tilt = ang + (rj - 0.5) * 1.6;
        const asp = 0.7 + 0.3 * facet;
        g.fillStyle = fill;
        g.beginPath();
        g.ellipse(x, y, rad * sx, rad * asp * sy, tilt, 0, Math.PI * 2);
        g.fill();
        if (b2 > 0.3 && rj > 0.8) {
          g.fillStyle = C.rgba(SEQ.body, 0.6);
          g.beginPath();
          g.ellipse(x + rad * 0.1, y + rad * 0.1, rad * 0.32 * sx, rad * 0.28 * sy, tilt, 0, Math.PI * 2);
          g.fill();
        } else if (b2 > 0.75) {
          const k = (b2 - 0.75) / 0.25;
          g.fillStyle = C.rgba(white, 0.4 + 0.6 * k);
          g.beginPath();
          g.arc(x - rad * 0.12, y - rad * 0.12, rad * (0.35 + 0.25 * k), 0, Math.PI * 2);
          g.fill();
          if (k > 0.95 && rj < 0.012) fx.sparkles.push([x, y, row.pitch * (1.2 + rj * 80), col]);
        }
        // 움직일 때 반짝일 후보와, 빛줄기가 지나갈 때 밝아질 하이라이트 판
        if (b2 > 0.35) {
          if (facet < 0.16) fx.twinkles.push([x, y, rad * 2.6, C.rgbToHex(mix3(col, white, 0.5)), rng()]);
          fx.spec.fillStyle = C.rgba(mix3(col, white, 0.4), b2);
          fx.spec.beginPath();
          fx.spec.arc(x, y, rad * 1.1, 0, Math.PI * 2);
          fx.spec.fill();
        }
      }
    }
    g.restore();
  }
  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // 네 갈래 별빛을 작은 캔버스(스프라이트)에 굽는다
  function starSprite(env, size, col) {
    const R = Math.ceil(size) + 2;
    const c = env.makeCanvas(R * 2, R * 2);
    star(c.getContext('2d'), env.core, R, R, size, col, 1);
    return { c, R };
  }
  // 부드러운 빛 점 스프라이트(반짝임용)
  function dotSprite(env) {
    const c = env.makeCanvas(32, 32);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(255,240,255,0.7)');
    rg.addColorStop(1, 'rgba(255,200,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  // 네 갈래 별빛
  function star(g, C, x, y, size, col, alpha = 1) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(x, y, 0, x, y, size * 0.5);
    halo.addColorStop(0, C.rgba('#ffffff', 0.9 * alpha));
    halo.addColorStop(0.35, C.rgba(col, 0.45 * alpha));
    halo.addColorStop(1, C.rgba(col, 0));
    g.fillStyle = halo;
    g.fillRect(x - size, y - size, size * 2, size * 2);
    g.fillStyle = C.rgba('#ffffff', 0.85 * alpha);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.beginPath();
      g.moveTo(x - s * size * 0.08, y + c * size * 0.08);
      g.lineTo(x + c * size, y + s * size);
      g.lineTo(x + s * size * 0.08, y - c * size * 0.08);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function drawFabric(g, env, path, name, opts) {
    const C = env.core;
    g.save();
    g.clip(path, 'evenodd');
    g.fillStyle = DRESS.base;
    g.fillRect(0, 0, env.W, env.H);
    // 은은한 보라 반사광과 주름 그림자
    for (const [x, y, r, col, a] of opts.sheen) {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, C.rgba(col, a));
      rg.addColorStop(1, C.rgba(col, 0));
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
  }

  // 가방: 검은 가죽 바탕 + 분홍 반사면 + 구김
  function drawSash(g, env, path, noise) {
    const C = env.core;
    g.save();
    g.clip(path, 'evenodd');
    const base = g.createLinearGradient(0, 860, 120, 990);
    base.addColorStop(0, '#1a0e26');
    base.addColorStop(1, '#07040c');
    g.fillStyle = base;
    g.fillRect(-20, 800, 240, 220);
    // 남색 면 몇 개(구겨진 가죽이 푸른 빛을 받는 곳)
    const navy = g.createRadialGradient(40, 950, 0, 40, 950, 60);
    navy.addColorStop(0, C.rgba('#28306a', 0.6));
    navy.addColorStop(1, C.rgba('#28306a', 0));
    g.fillStyle = navy;
    g.fillRect(-20, 890, 120, 120);
    // 분홍 반사면: 위쪽 가장자리에서 아래로 사라진다
    g.beginPath();
    SASH_LIT.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    const lit = g.createLinearGradient(60, 850, 90, 910);
    lit.addColorStop(0, C.rgba('#ff3c88', 0.95));
    lit.addColorStop(0.55, C.rgba('#d01e64', 0.75));
    lit.addColorStop(1, C.rgba('#6a0c3c', 0.2));
    g.fillStyle = lit;
    g.fill();
    for (const [pts, w] of SASH_CREASES) inkLine(g, pts, w, C.rgba('#0a0612', 0.85), noise, 31, true);
    g.restore();
  }

  P.body = {
    async prepare(env) {
      const { W, H } = env;
      const C = env.core;
      if (!P.bodyData) await C.loadScript('js/procedural/data/body.js');
      const D = P.bodyData;
      SEQ.rgb = {};
      for (const k in SEQ) if (k !== 'rgb' && k !== 'body') SEQ.rgb[k] = C.hexToRgb(SEQ[k]);
      SEQ.body = C.hexToRgb(DRESS.scale);
      const noise = C.makeNoise2D(C.hashString('body') ^ env.seed);
      const rng = env.rng('body');

      const shapes = {};
      for (const name in D.shapes) {
        shapes[name] = {
          path: ringsPath(D.shapes[name]),
          bands: (D.bands[name] || []).map((lv) => (lv.length ? ringsPath(lv) : null)),
        };
      }

      const canvas = env.makeCanvas(W, H);
      const g = canvas.getContext('2d');

      // 1) 뒤쪽 피부: 오른쪽 아래 팔, 목·가슴, 허리
      drawSkin(g, env, shapes, 'fore', {
        grad: [560, 1254, 900, 950],
        rim: [[600, 1180, 120, '#ff5fa0', 0.5]],
      });
      drawSkin(g, env, shapes, 'torso', {
        grad: [640, 480, 940, 800],
        blur: [1.5, 5, 2.5, 1, 0.6], // 가슴의 넓은 그림자는 부드럽게, 깊은 그림자는 또렷하게
        rim: [[960, 700, 160, '#ff70b0', 0.35]],
      });
      drawSkin(g, env, shapes, 'waist', { grad: [180, 860, 320, 1000], rim: [[200, 880, 80, '#ff6aa0', 0.4]] });

      // 2) 드레스: 몸판, 치마, 가방
      const spec = env.makeCanvas(W, H);
      const fx = { sparkles: [], twinkles: [], spec: spec.getContext('2d') };
      drawFabric(g, env, shapes.dress.path, 'dress', {
        sheen: [
          [700, 830, 160, DRESS.sheen, 0.35],
          [600, 1000, 140, DRESS.violet, 0.2],
          [500, 1180, 120, '#3a1840', 0.3],
          [820, 900, 90, '#1c1a50', 0.3],
        ],
      });
      drawSequins(g, env, shapes.dress.path, 'dress', rng, noise, fx);
      drawFabric(g, env, shapes.skirt.path, 'skirt', {
        sheen: [
          [100, 1000, 170, DRESS.sheen, 0.4],
          [20, 1140, 120, '#1a2060', 0.4],
        ],
      });
      drawSequins(g, env, shapes.skirt.path, 'skirt', rng, noise, fx);
      // 치마 윗단: 허리 피부와 닿는 가장자리의 검은 띠
      g.save();
      g.clip(shapes.skirt.path, 'evenodd');
      inkLine(g, chaikin(SKIRT_TOP, false, 3), 12, DRESS.deep, noise, 19, false);
      g.restore();
      drawSash(g, env, shapes.sash.path, noise);
      for (const [x, y, r] of JEWELS) {
        const jg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        jg.addColorStop(0, '#ffffff');
        jg.addColorStop(0.5, '#c8c8e8');
        jg.addColorStop(0.85, '#6a6a9a');
        jg.addColorStop(1, '#2a2440');
        g.fillStyle = jg;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }

      // 목선 단(hem): 드레스 위 가장자리를 따라 스팽글 없는 검은 띠
      g.save();
      g.clip(shapes.dress.path, 'evenodd');
      inkLine(g, chaikin(NECKLINE, false, 3), 13, DRESS.deep, noise, 17, false);
      g.restore();
      // 겨드랑이 쪽 안감
      g.save();
      g.beginPath();
      LINING.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      const lg = g.createLinearGradient(580, 725, 640, 790);
      lg.addColorStop(0, '#1c1430');
      lg.addColorStop(1, DRESS.deep);
      g.fillStyle = lg;
      g.fill();
      g.restore();

      // 드레스 윤곽선
      for (const name of ['dress', 'skirt', 'sash']) {
        for (const r of D.edges[name] || []) inkLine(g, chaikin(flat(r), false, 2), 2.2, DRESS.line, noise, 13, false);
      }

      // 3) 앞쪽 팔
      drawSkin(g, env, shapes, 'arm', {
        grad: [470, 470, 330, 1254],
        rim: [
          [420, 1120, 150, '#ff7aa8', 0.35],
          [600, 720, 90, '#ff9a9a', 0.3],
        ],
      });

      // 4) 피부 윤곽선과 안쪽 선
      for (const name of ['fore', 'torso', 'waist', 'arm']) {
        for (const r of D.edges[name] || []) inkLine(g, chaikin(flat(r), false, 2), 2.0, SKIN.line, noise, 7, false);
      }
      for (const [pts, w] of INNER_LINES) inkLine(g, pts, w, C.rgba(SKIN.line, 0.75), noise, 3, true);

      // 5) 어깨끈
      const strap = resample(chaikin(D.strapL, false, 3), 3);
      g.fillStyle = '#16102a';
      g.fill(ribbon(strap, (u) => 8.5 - 2.5 * u, 0));
      g.fillStyle = C.rgba('#6a5aa8', 0.75);
      g.fill(ribbon(strap, (u) => 2.2 * Math.sin(Math.PI * Math.min(1, u * 1.15)), -2.4));
      g.strokeStyle = C.rgba('#05030a', 0.8);
      g.lineWidth = 0.8;
      g.stroke(ribbon(strap, (u) => 8.5 - 2.5 * u, 0));
      // 어깨·빗장뼈의 작은 윤기
      g.strokeStyle = C.rgba('#ffffff', 0.85);
      g.lineCap = 'round';
      for (const [pts, w] of SHINES) {
        g.lineWidth = w;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
      g.save();
      g.beginPath();
      D.strapR.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = DRESS.base;
      g.fill();
      g.restore();

      // 6) 반짝이 별빛
      // 하이라이트 판은 드레스 안쪽만 (팔·피부가 덮은 곳은 지운다)
      const sg = fx.spec;
      sg.globalCompositeOperation = 'destination-in';
      sg.fill(shapes.dress.path, 'evenodd');
      sg.globalCompositeOperation = 'destination-out';
      sg.fill(shapes.arm.path, 'evenodd');
      sg.lineWidth = 14;
      sg.stroke(new Path2D(C.smoothPath(NECKLINE)));
      sg.fill(new Path2D(C.smoothPath(LINING, true)));
      const specAll = env.makeCanvas(W, H);
      const sa = specAll.getContext('2d');
      sa.drawImage(spec, 0, 0);

      const prng = env.rng('body-anim');
      const stars = fx.sparkles.map(([x, y, size, col]) => ({
        x,
        y,
        sp: starSprite(env, size, C.rgbToHex(col)),
        w: 1.5 + prng() * 2.5,
        ph: prng() * Math.PI * 2,
      }));
      // 반짝임 후보는 완성된 그림에서 실제로 밝게 보이는 스팽글만 (단·안감·팔에 덮인 것은 뺀다)
      const px = g.getImageData(0, 0, W, H).data;
      const lum = (x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return px[i] * 0.3 + px[i + 1] * 0.55 + px[i + 2] * 0.15;
      };
      const twinkles = fx.twinkles
        .filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && lum(x, y) > 120)
        .map(([x, y, r, col, u]) => ({ x, y, r, w: 2 + u * 5, ph: u * 40 }));
      return { canvas, stars, twinkles, spec: specAll, dot: dotSprite(env), tmp: env.makeCanvas(W, H) };
    },

    draw(ctx, state, t) {
      ctx.drawImage(state.canvas, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      // 별빛: t=0에서 0.8, 그 둘레로 숨 쉬듯
      for (const s of state.stars) {
        ctx.globalAlpha = 0.8 * (0.7 + 0.3 * Math.cos(t * s.w));
        ctx.drawImage(s.sp.c, s.x - s.sp.R, s.y - s.sp.R);
      }
      if (t === 0) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      // 스팽글 반짝임: t=0에서 꺼져 있다가 저마다의 빠르기로 켜졌다 꺼진다
      for (const p of state.twinkles) {
        const k = 0.5 - 0.5 * Math.cos(t * p.w);
        const a = Math.pow(k, 6) * (0.5 + 0.5 * Math.sin(p.ph + t * 0.37));
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(state.dot, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      // 빛줄기: 대각선 띠가 드레스를 천천히 쓸고 지나간다 (t=0에서 세기 0)
      const amp = 0.5 - 0.5 * Math.cos((t * 2 * Math.PI) / 9);
      if (amp > 0.01) {
        const g = state.tmp.getContext('2d');
        const pos = ((t / 9) % 1) * 1600 - 300;
        g.globalCompositeOperation = 'copy';
        g.globalAlpha = 1;
        g.drawImage(state.spec, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        const lg = g.createLinearGradient(pos - 160, 700, pos + 160, 1100);
        lg.addColorStop(0, 'rgba(0,0,0,0)');
        lg.addColorStop(0.5, 'rgba(0,0,0,1)');
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = lg;
        g.fillRect(0, 700, 1254, 554);
        ctx.globalAlpha = 0.8 * amp;
        ctx.drawImage(state.tmp, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
})();
