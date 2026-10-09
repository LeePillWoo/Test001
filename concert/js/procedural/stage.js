// 절차적 드로잉 레이어: stage — 인물 뒤의 공연장 전부.
// 바탕 조명 번짐, 볼륨 빔, 트러스, LED 도트 전광판, 조명과 별빛, 색종이, 관객과 응원봉.
// 위치·크기·각도는 원본에서 잰 값(tools/proc_stage.py가 일부를 잰다)이고,
// 색은 팔레트에서 골라 그라디언트·노이즈·흐림으로 칠한다. 배경은 인물보다 흐리게(ctx.filter blur) 둔다.
//
// 층 순서: far(바탕 번짐·빛 띠·트러스) → 빔 → near(관객·연무·LED 판·보케·조명기구) → 조명 → 색종이 → 응원봉
// far와 near는 prepare에서 한 장씩 미리 그리고, 움직이는 것만 스프라이트로 매 프레임 얹는다.
// 디버그 주소 옵션: stage=far (바탕 한 장만), stage=beams (검은 바탕에 빔만)
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});
  const DEG = Math.PI / 180;

  // ── 팔레트 (원본에서 잰 색) ──────────────────────────────
  // 자주 쓰는 빛 색만 이름을 붙였다. 조명 번짐처럼 한 번만 쓰는 색은 그 자리에 적는다.
  const PAL = {
    base: '#1e1660',
    violet: '#5a1a9a',
    red: '#ff2a55',
    coral: '#ff6a6a',
    hot: '#f81e9a',
    orchid: '#d63cf0',
    pink: '#fc8ef4',
    blush: '#fdc4fd',
    white: '#fff6fe',
    blue: '#3f5cfc',
    sky: '#7a9cff',
    ice: '#e6ecff',
  };

  // ── 배치 (원본 1254×1254 좌표) ──────────────────────────
  // 넓은 조명 번짐: [x, y, rx, ry, 회전°, 색, 불투명도, 평평한 안쪽 비율]
  // 조명마다 손으로 놓은 그라디언트 덩어리다. 뒤에서 크게 흐려 바탕의 빛 지도를 만든다.
  const ZONES = [
    // 바탕의 어둠: 왼쪽 위 남보라, 위 가운데 남색, 오른쪽 아래 구석
    [120, 100, 300, 210, 0, '#28124e', 0.95, 0.4],
    [700, 40, 360, 160, 0, '#161a6c', 0.95, 0.3],
    [1180, 1190, 170, 110, 0, '#4a1660', 0.8, 0.3],
    // 오른쪽 남색 벽과 그 위의 조명 번짐 (전광판, 보라 조명, 아래 파란 조명, 머리카락 사이 자홍)
    [1190, 640, 140, 320, 0, '#2c1a9c', 0.95, 0.5],
    [1180, 715, 55, 85, 0, '#9a1aa0', 0.95, 0.3],
    [1210, 150, 140, 100, -16, '#f82aa8', 0.8, 0.3],
    [1210, 330, 90, 60, 0, '#6a28b0', 0.8, 0.3],
    [1215, 282, 70, 30, -18, '#3a2cc8', 1, 0.4],
    [1228, 965, 100, 80, 0, '#2440f4', 0.95, 0.35],
    [1195, 985, 100, 65, 0, '#3a4cff', 1, 0.5],
    [1125, 975, 40, 40, 0, '#d020c0', 0.9, 0.3],
    [1070, 910, 120, 200, 10, '#e020b0', 0.95, 0.4],
    [1190, 1090, 80, 50, 0, '#5c1470', 0.9, 0.3],
    [1060, 1225, 140, 50, 0, '#b0104e', 0.95, 0.4],
    // 빨간 빔이 떨어지는 자리의 붉은·자홍 번짐과 그 둘레
    [480, 330, 110, 100, 0, '#e8205a', 0.9, 0.3],
    [470, 420, 130, 120, 0, '#c81e78', 0.9, 0.35],
    [530, 230, 50, 40, 0, '#9222a0', 0.8, 0.3],
    [280, 300, 90, 70, 0, '#801c88', 0.85, 0.3],
    [225, 238, 95, 42, 22, '#3c1858', 0.9, 0.3],
    [660, 200, 70, 120, 0, '#4a22a8', 0.8, 0.3],
    // 왼쪽 LED 판 둘레의 분홍 빛과 판 사이의 그늘
    [20, 300, 110, 80, 17, '#f02aa8', 0.95, 0.4],
    [40, 218, 140, 34, 16, '#f0206a', 0.95, 0.4],
    [130, 205, 120, 30, -16, '#3c1ea0', 0.8, 0.3],
    [185, 365, 80, 40, 16, '#30248e', 0.9, 0.3],
    [80, 520, 150, 50, 17, '#a038c0', 0.7, 0.3],
    // 파란 빔 아래와 관객석 바탕 (파랑·남보라, 왼쪽 가장자리의 붉은 빛)
    [40, 598, 90, 50, 0, '#5430c0', 0.9, 0.3],
    [120, 690, 50, 40, 0, '#4a2ab8', 0.8, 0.3],
    [10, 850, 50, 60, 0, '#d02860', 0.9, 0.3],
    // 인물 뒤 아래쪽 (팔과 머리카락 사이로 비치는 진홍)
    [600, 1080, 110, 130, 0, '#d0105c', 0.85, 0.3],
    [880, 1180, 260, 110, 0, '#a8145a', 0.85, 0.3],
    [905, 1125, 35, 35, 0, '#c80c5a', 0.9, 0.3],
    [1015, 1075, 35, 45, 0, '#a01070', 0.9, 0.3],
    // 머리카락 왼쪽 가장자리 바로 바깥의 자홍 빛
    [575, 300, 45, 60, 0, '#c8207c', 0.9, 0.3],
    [420, 445, 40, 50, 0, '#e824a8', 0.9, 0.3],
  ];

  // 빔 위에 얹는 옅은 색 번짐 (빔 가장자리의 색 섞임): [x, y, rx, ry, 회전°, 색, 불투명도]
  const TINTS = [
    [470, 225, 60, 45, 0, '#e0288c', 0.5],
    [255, 150, 30, 55, 0, '#c0206a', 0.45],
    [100, 200, 50, 30, 0, '#3c1ca0', 0.55],
    [400, 40, 30, 40, 0, '#801438', 0.4],
    [1080, 1215, 90, 45, 0, '#b01050', 0.6],
  ];

  // 볼륨 빔: [광원 x, y, 방향°, 길이, 시작 폭, 끝 폭, 색, 세기, 가장자리 흐림, 합성, 흔들림°, 선택]
  // 선택: fadeIn·fade(길이 비율로 밝아지기 시작·사라지기 시작), haze(빔 결을 따라 흐르는 연무의 세기)
  const BEAMS = [
    // 위 가운데 조명의 빨간 빔 (광원을 화면 위 바깥에 두어 폭을 맞췄다), 붉은 심, 자홍 가장자리
    [250, -200, 69, 640, 95, 210, '#ff1438', 1, 24, 'source-over', 3, { fade: 0.78, haze: 0.12 }],
    [326, -10, 72, 320, 30, 100, '#ff4a50', 0.5, 14, 'lighter', 3],
    [300, 40, 78, 200, 30, 50, '#c01860', 0.5, 14, 'screen', 3],
    // (430,215) 조명에서 왼쪽 아래로 퍼지는 파란 원뿔과 연보라 심
    [430, 215, 125, 520, 20, 300, '#3a48ff', 1, 18, 'source-over', 4, { fadeIn: 0.35, fade: 0.8, haze: 0.1 }],
    [430, 215, 129, 220, 12, 50, '#a0b0ff', 0.6, 8, 'screen', 4],
    // 오른쪽 위로 비스듬한 파란 빛, 왼쪽 위 보라 빛줄기, 별빛 조명의 분홍 꼬리, 오른쪽 위 파란 조각
    [565, 150, 25, 220, 30, 120, '#2e44f0', 0.75, 14, 'screen', 3],
    [222, -30, 92, 150, 50, 70, PAL.violet, 0.3, 16, 'screen', 2],
    [226, 312, 117, 110, 14, 20, '#ffa8f4', 0.75, 4, 'screen', 2],
    [1122, -16, 132, 66, 24, 26, '#1a5cff', 1, 5, 'screen', 2],
  ].map(([x, y, ang, len, w0, w1, color, a, soft, op, sweep, more]) => ({
    x, y, ang, len, w0, w1, color, a, soft, op, sweep, ...more,
  }));

  // 트러스: 아래 현이 지나는 점들(원근으로 살짝 휜다), 두 현 사이 간격 d0→d1, 마디 수 n, 밝기 lit,
  // 길이 방향 빛 받는 정도 glow [[비율, 세기]] — 빨간 빔과 이음매 조명 근처가 밝다.
  // 아래 현의 위치는 원본 선 성분(DoG)과 겹쳐 보며 구간별로 맞췄다.
  const TRUSSES = [
    {
      pts: [[40, 250], [150, 218], [300, 158], [430, 111], [550, 60], [650, 15], [720, -20]],
      d0: 50,
      d1: 42,
      n: 18,
      lit: 1,
      glow: [[0, 0.3], [0.25, 0.6], [0.4, 1], [0.55, 0.85], [0.66, 0.55], [0.74, 1], [0.86, 0.7], [1, 0.4]],
    },
    // 오른쪽 위 전광판을 받치는 짧은 트러스
    { pts: [[1070, 120], [1170, 92], [1270, 60]], d0: 16, d1: 14, n: 9, lit: 0.36, glow: [[0, 1], [1, 1]] },
  ];
  // 트러스 이음매의 작은 조명
  const JOINTS = [
    [522, 62, 15, PAL.pink], [579, 36, 14, PAL.orchid], [624, 12, 12, PAL.orchid],
    [386, 128, 9, PAL.pink], [286, 166, 8, PAL.hot], [300, 176, 7, PAL.hot], [218, 137, 8, PAL.hot],
    [357, 144, 7, PAL.pink], [555, 57, 8, PAL.orchid],
  ];

  // LED 전광판: 중심, 크기, 회전°, 도트 간격, 무늬, 판 바탕색·꺼진 도트·켜진 도트 색
  const PANELS = [
    { cx: 100, cy: 310, w: 200, h: 78, ang: 16, pitch: 9.5, motif: 'scatter',
      back: '#e0106e', dim: '#ff3cb0', lit: '#ffd0f8' },
    { cx: 8, cy: 438, w: 340, h: 166, ang: 16.5, pitch: 10.5, motif: 'glyph',
      back: '#f00c88', dim: '#ff1aa0', lit: '#ffc8f8' },
    { cx: 1274, cy: 149, w: 320, h: 175, ang: -18, pitch: 13, motif: 'rows',
      back: '#e8106c', dim: '#ff1476', lit: '#ffc4f2' },
  ];

  // 조명: 위치, 심 반지름 r, 번짐 반지름 halo, 색, 세기, 별빛 flare [갈래 수, 길이, 굵기, 기울기°]
  const LIGHTS = [
    { x: 326, y: 8, r: 20, halo: 90, color: PAL.coral, a: 1 },
    { x: 1169, y: 52, r: 24, halo: 75, color: '#a070ff', a: 1 },
    { x: 226, y: 305, r: 20, halo: 48, color: PAL.pink, a: 1, flare: [8, 80, 6, -14] },
    { x: 430, y: 216, r: 13, halo: 50, color: PAL.pink, a: 1 },
    { x: 255, y: 192, r: 11, halo: 34, color: PAL.coral, a: 0.9 },
    { x: 22, y: 191, r: 11, halo: 26, color: PAL.sky, a: 0.8 },
    { x: 1221, y: 924, r: 10, halo: 50, color: PAL.sky, a: 1, flare: [6, 40, 3, 20] },
    { x: 1241, y: 82, r: 9, halo: 22, color: PAL.pink, a: 0.8 },
    { x: 1211, y: 90, r: 8, halo: 20, color: PAL.pink, a: 0.7 },
    { x: 145, y: 76, r: 8, halo: 20, color: PAL.hot, a: 0.6 },
    { x: 278, y: 92, r: 7, halo: 18, color: PAL.red, a: 0.6 },
    { x: 282, y: 23, r: 7, halo: 18, color: PAL.red, a: 0.6 },
    { x: 210, y: 205, r: 8, halo: 18, color: PAL.orchid, a: 0.5 },
    { x: 108, y: 225, r: 7, halo: 16, color: PAL.blue, a: 0.6 },
    { x: 73, y: 239, r: 7, halo: 16, color: PAL.pink, a: 0.6 },
    { x: 30, y: 275, r: 14, halo: 30, color: PAL.blush, a: 0.9 },
    { x: 60, y: 265, r: 10, halo: 24, color: PAL.blush, a: 0.8 },
    { x: 544, y: 240, r: 7, halo: 16, color: PAL.hot, a: 0.6 },
    { x: 491, y: 221, r: 10, halo: 30, color: PAL.orchid, a: 0.6 },
  ];

  // 사각 조명기구(빛나는 직사각형): 중심, 크기, 회전°, 색
  const FIXTURES = [
    { x: 564, y: 156, w: 28, h: 20, ang: 55, color: PAL.ice, glow: PAL.sky },
    { x: 475, y: 344, w: 48, h: 26, ang: -63, color: PAL.white, glow: PAL.pink },
    { x: 344, y: 211, w: 26, h: 12, ang: -57, color: PAL.blush, glow: PAL.hot },
  ];

  // 색종이: 꼭짓점 목록(큰 조각은 원본 윤곽을 단순화), 색 두 가지(그라디언트), 흐림
  const CONFETTI = [
    { pts: [[28, 61], [67, 62], [106, 131], [128, 190], [100, 170]], c0: PAL.blush, c1: PAL.orchid,
      blur: 1.6 },
    { pts: [[700, 38], [728, 42], [748, 90], [739, 94], [722, 84], [699, 44]], c0: PAL.pink, c1: PAL.hot,
      blur: 1.6 },
    { pts: [[298, 383], [315, 393], [298, 408], [282, 410]], c0: '#ff4a80', c1: '#ff2a60', blur: 1.4 },
    { pts: [[217, 408], [227, 419], [212, 452], [207, 424]], c0: '#fff0ff', c1: '#ffb0f0', blur: 2.4 },
  ];
  // 둥근 보케 원반: x, y, r, 색, 세기
  const BOKEH = [
    [240, 505, 19, '#ff9ee0', 0.9],
    [16, 566, 20, '#e030b0', 0.8],
  ];

  // 응원봉: 손잡이 쪽 끝(x0,y0)에서 위쪽 끝(x1,y1)까지, 굵기, 세기
  // (tools/proc_stage.py sticks로 잰 심의 양 끝에 테두리만큼 늘린 값)
  const STICKS = [
    [80, 694, 176, 574, 36, 1],
    [74, 858, 77, 767, 33, 1],
    [1217, 1262, 1190, 1178, 30, 1],
    [1, 878, 21, 811, 26, 0.95],
    [1223, 1104, 1211, 1043, 20, 0.9],
    [1129, 1195, 1138, 1140, 22, 0.9],
    [4, 721, 4, 665, 19, 0.85],
    [1142, 1088, 1124, 1042, 21, 0.85],
    [1250, 1133, 1250, 1077, 17, 0.8],
    [146, 760, 153, 715, 19, 0.75],
    [190, 655, 204, 625, 20, 0.7],
    [113, 734, 116, 691, 17, 0.75],
    [1123, 1060, 1123, 1030, 18, 0.6],
    [7, 653, 16, 621, 16, 0.6],
    [296, 632, 296, 598, 15, 0.45],
    [72, 622, 72, 590, 14, 0.5],
    [133, 612, 135, 590, 11, 0.4],
    [44, 742, 48, 712, 11, 0.4],
    [1166, 1062, 1164, 1000, 14, 0.4],
    [1049, 1260, 1049, 1234, 12, 0.6],
    [978, 1260, 977, 1234, 10, 0.45],
  ];
  // 관객석의 붉은 빛 번짐 (tools/proc_stage.py glows로 잰 타원): x, y, rx, ry, 회전°
  const GLOWS = [
    [65, 789, 108, 47, -66], [1133, 1166, 36, 15, -77], [1202, 1216, 16, 44, -18], [1118, 1226, 6, 25, -30],
    [151, 736, 24, 10, -70], [145, 640, 61, 5, -50], [49, 644, 16, 7, -63], [180, 701, 14, 8, -69],
    [140, 829, 9, 9, -74], [1165, 1062, 17, 5, -72], [41, 878, 15, 6, -35], [72, 602, 13, 9, -90],
    [8, 899, 14, 5, -43], [132, 603, 28, 3, -43], [95, 640, 18, 5, -45], [1116, 971, 5, 21, -2],
    [1102, 1091, 3, 17, -3], [191, 815, 20, 4, -56], [197, 640, 13, 10, -63], [164, 810, 7, 8, -90],
    [13, 689, 30, 6, -76], [1246, 1105, 5, 26, -6],
  ];
  // 관객 실루엣: 어두운 덩어리 타원 (tools/proc_stage.py crowd로 잰 값): x, y, rx, ry, 회전°
  const CROWD = [
    [1194, 1157, 96, 58, -90], [142, 786, 63, 41, -84], [24, 736, 77, 26, -81], [1130, 1108, 34, 22, -90],
    [159, 685, 15, 10, -63], [43, 802, 12, 7, -90], [1150, 1050, 12, 4, -90], [200, 759, 7, 6, -90],
    [130, 678, 7, 6, -90],
  ];
  // 들어 올린 팔: 어깨(x0,y0) → 손(x1,y1), 굵기
  const ARMS = [
    [45, 770, 80, 692, 18], [90, 900, 74, 858, 16], [20, 930, 1, 878, 14], [140, 810, 113, 734, 12],
    [1200, 1320, 1217, 1262, 18], [1250, 1200, 1223, 1104, 14], [1150, 1260, 1129, 1195, 14],
    [1160, 1150, 1142, 1088, 12], [170, 820, 146, 760, 12],
  ];
  // 오른쪽 가장자리의 분홍 빛 띠: 시작, 끝, 굵기, 색, 세기
  const BANDS = [
    [1170, 458, 1290, 293, 24, '#ff1458', 0.9],
    [1120, 517, 1290, 431, 48, '#ff3a90', 0.9],
    [1120, 512, 1290, 426, 22, '#ffa0d8', 0.75],
    [930, 872, 1290, 824, 46, '#ff1a70', 0.9],
    [1100, 858, 1290, 840, 16, '#ff8ad0', 0.6],
  ];

  // ── 작은 도우미 ────────────────────────────────────────
  function rgbOf(c) {
    return Array.isArray(c) ? c : hexRgb(c);
  }
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    const [r, g, b] = rgbOf(c);
    return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  }

  // 부드러운 타원 번짐 (가장자리가 smoothstep으로 사라진다)
  function softEllipse(ctx, x, y, rx, ry, rot, color, alpha, hard = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot * DEG);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(color, alpha));
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const f = 1 - t * t * (3 - 2 * t);
      g.addColorStop(hard + (1 - hard) * t, rgba(color, alpha * f));
    }
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  function glowDot(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.35, rgba(color, alpha * 0.45));
    g.addColorStop(0.7, rgba(color, alpha * 0.12));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 저해상도 fbm 노이즈를 알파로 담은 캔버스 (늘려 쓰면 부드러운 연무가 된다)
  function noiseCanvas(env, w, h, sx, sy, seedName, lo, hi) {
    const C = env.core;
    const noise = C.makeNoise2D(C.hashString(seedName) ^ env.seed);
    const c = env.makeCanvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = C.fbm(noise, x * sx, y * sy, 4) * 0.5 + 0.5;
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * C.clamp(lo + (hi - lo) * n, 0, 1));
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ── 빔 스프라이트: 광원이 왼쪽 가운데, +x 방향으로 퍼지는 원뿔 ─────────
  function makeBeam(env, b) {
    const pad = Math.ceil(b.soft * 3);
    const wMax = Math.max(b.w0, b.w1);
    const cw = Math.ceil(b.len + pad * 2);
    const ch = Math.ceil(wMax + pad * 2);
    const c = env.makeCanvas(cw, ch);
    const g = c.getContext('2d');
    const cy = ch / 2;
    const cone = (k, alpha) => {
      const grad = g.createLinearGradient(pad, 0, pad + b.len, 0);
      // fade: 이 비율부터 끝까지 서서히 사라진다
      const f = b.fade == null ? 0.4 : b.fade;
      const fi = b.fadeIn || 0;
      grad.addColorStop(0, rgba(b.color, fi ? alpha * 0.15 : alpha));
      if (fi) grad.addColorStop(fi, rgba(b.color, alpha));
      grad.addColorStop(f, rgba(b.color, alpha * 0.9));
      grad.addColorStop(f + (1 - f) * 0.5, rgba(b.color, alpha * 0.45));
      grad.addColorStop(1, rgba(b.color, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(pad, cy - (b.w0 * k) / 2);
      g.lineTo(pad + b.len, cy - (b.w1 * k) / 2);
      g.lineTo(pad + b.len, cy + (b.w1 * k) / 2);
      g.lineTo(pad, cy + (b.w0 * k) / 2);
      g.closePath();
      g.fill();
    };
    g.filter = `blur(${b.soft}px)`;
    cone(1, b.a);
    g.filter = `blur(${b.soft * 0.6}px)`;
    cone(0.5, b.a * 0.5);
    g.filter = 'none';
    // 빔 방향으로 늘어진 연무 줄무늬
    const haze = b.haze == null ? 0.35 : b.haze;
    const nz = noiseCanvas(env, 48, 24, 0.09, 0.35, 'beam' + b.x + b.ang, 1 - haze, 1 + haze);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(nz, 0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
    return { canvas: c, pad, cy };
  }

  // ── 별빛 조명 스프라이트 ───────────────────────────────────
  function makeLight(env, L) {
    const R = Math.ceil(Math.max(L.halo, L.flare ? L.flare[1] : 0) + 6);
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    g.translate(R, R);
    glowDot(g, 0, 0, L.halo, L.color, 0.55 * L.a);
    glowDot(g, 0, 0, L.r * 1.6, L.color, 0.9 * L.a);
    // 작은 조명은 흰 심 없이 제 색으로만 빛난다
    const coreColor = L.r >= 10 ? PAL.white : L.color;
    const core = g.createRadialGradient(0, 0, 0, 0, 0, L.r);
    core.addColorStop(0, rgba(coreColor, L.a));
    core.addColorStop(0.55, rgba(coreColor, 0.9 * L.a));
    core.addColorStop(1, rgba(L.color, 0));
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, L.r, 0, Math.PI * 2);
    g.fill();
    if (L.flare) {
      const [n, len, wid, tilt] = L.flare;
      g.filter = 'blur(0.8px)';
      for (let i = 0; i < n; i++) {
        const major = i % 2 === 0;
        const a = (tilt + (i * 360) / n) * DEG;
        const l = major ? len : len * 0.45;
        const w = major ? wid : wid * 0.6;
        g.save();
        g.rotate(a);
        const grad = g.createLinearGradient(0, 0, l, 0);
        grad.addColorStop(0, rgba(PAL.white, 0.95 * L.a));
        grad.addColorStop(0.3, rgba(L.color, 0.6 * L.a));
        grad.addColorStop(1, rgba(L.color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, -w);
        g.lineTo(l, 0);
        g.lineTo(0, w);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.filter = 'none';
    }
    return { canvas: c, R };
  }

  // ── 색종이 스프라이트 (살짝 흐리고 낙하 방향으로 번진다) ─────────────
  function makeShard(env, s) {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - 16;
    const y0 = Math.min(...ys) - 16;
    const w = Math.max(...xs) - x0 + 16;
    const h = Math.max(...ys) - y0 + 16;
    const c = env.makeCanvas(Math.ceil(w), Math.ceil(h));
    const g = c.getContext('2d');
    g.translate(-x0, -y0);
    const grad = g.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    grad.addColorStop(0, s.c0);
    grad.addColorStop(1, s.c1);
    const path = new Path2D();
    s.pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
    path.closePath();
    g.filter = 'blur(5px)';
    g.globalAlpha = 0.45;
    g.fillStyle = s.c1;
    g.fill(path);
    g.filter = `blur(${s.blur}px)`;
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.fill(path);
    g.filter = 'none';
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    return { canvas: c, ox: x0 - cx, oy: y0 - cy, cx, cy };
  }

  // ── 응원봉 스프라이트: 아래 끝이 원점, 위로 길이 L ───────────────
  function makeStick(env, len, wid, power) {
    const pad = Math.ceil(wid * 1.4 + 8);
    const c = env.makeCanvas(Math.ceil(wid + pad * 2), Math.ceil(len + pad * 2));
    const g = c.getContext('2d');
    const x = pad;
    const y = pad;
    const capsule = (inset, color, alpha, blur) => {
      g.filter = blur ? `blur(${blur}px)` : 'none';
      g.globalAlpha = alpha;
      g.fillStyle = color;
      const r = Math.max(1, (wid - inset * 2) / 2);
      g.beginPath();
      g.roundRect(x + inset, y + inset, wid - inset * 2, len - inset * 2, r * 0.6);
      g.fill();
    };
    // 넓은 붉은 번짐 → 진분홍 몸통 → 연분홍 심 → 흰 심
    capsule(-wid * 0.3, '#ff1448', 0.4 * power, wid * 0.3);
    capsule(-2, '#ff1850', power, 1.6);
    capsule(wid * 0.2, '#ff9ce4', power, 1.8);
    capsule(wid * 0.32, '#fff4fc', 0.85 * power, 1.5);
    g.filter = 'none';
    g.globalAlpha = 1;
    return { canvas: c, pad, wid, len };
  }

  // ── LED 도트 판 ─────────────────────────────────────────
  // 왼쪽 큰 판의 흰 점 무늬(물음표 비슷한 두 글자): 화면 좌표의 굵은 획 [x0, y0, x1, y1, 반굵기]
  const GLYPH = [
    [5, 377, 95, 381, 18],
    [100, 390, 102, 452, 11],
    [100, 461, 20, 462, 9],
    [12, 370, 12, 470, 13],
    [32, 470, 32, 515, 22],
    [168, 446, 165, 535, 17],
    [110, 539, 175, 540, 16],
  ];
  function segDist(px, py, [x0, y0, x1, y1]) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - x0 - dx * k, py - y0 - dy * k);
  }

  // 무늬 함수: 화면 좌표(sx, sy), 판 좌표(u, v), 노이즈 n → 밝기 0..1
  function panelMotif(kind, sx, sy, u, v, n) {
    if (kind === 'glyph') {
      let m = 0;
      for (const sgm of GLYPH) m = Math.max(m, 1 - (segDist(sx, sy, sgm) - sgm[4]) / 6);
      return Math.max(0.06 + 0.12 * n, Math.min(1, m));
    }
    if (kind === 'scatter') return n > 0.62 ? 0.75 : n > 0.5 ? 0.4 : 0.12;
    // rows: 화면 오른쪽(바깥)으로 갈수록 하얗게 타오르는 줄무늬 화면
    const row = 0.5 + 0.5 * Math.sin(v * 22 + u * 3);
    const edge = Math.max(0, Math.min(1, (sx - 1130) / 115));
    return 0.1 + 0.9 * edge * edge + 0.25 * v + 0.3 * row * n;
  }

  function drawPanel(env, ctx, pn) {
    const C = env.core;
    const noise = C.makeNoise2D(C.hashString('panel' + pn.motif) ^ env.seed);
    const cols = Math.ceil(pn.w / pn.pitch);
    const rows = Math.ceil(pn.h / pn.pitch);
    const dim = rgbOf(pn.dim);
    const lit = rgbOf(pn.lit);
    const ca = Math.cos(pn.ang * DEG);
    const sa = Math.sin(pn.ang * DEG);
    ctx.save();
    ctx.translate(pn.cx, pn.cy);
    ctx.rotate(pn.ang * DEG);
    ctx.translate(-pn.w / 2, -pn.h / 2);
    // 판 바탕 (빛이 번진 진분홍)
    ctx.fillStyle = rgba(pn.back, 0.9);
    ctx.fillRect(0, 0, pn.w, pn.h);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const lx = (i + 0.5) * pn.pitch;
        const ly = (j + 0.5) * pn.pitch;
        const ox = lx - pn.w / 2;
        const oy = ly - pn.h / 2;
        const sx = pn.cx + ox * ca - oy * sa;
        const sy = pn.cy + ox * sa + oy * ca;
        const n = C.fbm(noise, i * 0.23, j * 0.23, 3) * 0.5 + 0.5;
        const m = C.clamp(panelMotif(pn.motif, sx, sy, i / cols, j / rows, n), 0, 1);
        const col = [0, 1, 2].map((k) => dim[k] + (lit[k] - dim[k]) * m);
        ctx.fillStyle = rgba(col, 0.75 + 0.25 * m);
        ctx.beginPath();
        ctx.arc(lx, ly, pn.pitch * (0.34 + 0.1 * m), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── 트러스: 두 현과 지그재그 사재. 조명을 받아 분홍·보라로 빛나는 부재와 어두운 틈 ────
  // 점 목록을 호 길이로 매개화해 s∈[0,1]의 위치와 법선을 돌려준다.
  function polyAt(pts) {
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      seg.push(l);
      total += l;
    }
    return (s) => {
      let d = s * total;
      let i = 0;
      while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
      const k = d / seg[i];
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const ux = (x1 - x0) / seg[i];
      const uy = (y1 - y0) / seg[i];
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, uy, -ux];
    };
  }

  function drawTruss(ctx, tr) {
    const f = polyAt(tr.pts);
    const at = (s, side) => {
      const [x, y, nx, ny] = f(s);
      const d = (tr.d0 + (tr.d1 - tr.d0) * s) * side;
      return [x + nx * d, y + ny * d];
    };
    const chord = (side, w, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const p = at(i / 60, side);
        if (i) ctx.lineTo(p[0], p[1]);
        else ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
    };
    const line = (a, b, w, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    // 빛 받는 정도가 길이 방향으로 달라진다 (빨간 빔이 지나는 곳, 이음매 조명 근처가 밝다)
    const p0 = tr.pts[0];
    const p1 = tr.pts[tr.pts.length - 1];
    const litGrad = (color, alpha) => {
      const g = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
      for (const [s, k] of tr.glow) g.addColorStop(s, rgba(color, alpha * k * tr.lit));
      return g;
    };
    // 어두운 몸체(틈새 그림자) → 빛 받은 부재 → 밝은 모서리 순으로 겹친다
    const passes = [
      [2, 'rgba(18,8,40,0.6)'],
      [1, litGrad('#c838d8', 0.95)],
      [0.4, litGrad('#ff70e0', 0.85)],
    ];
    for (const [k, color] of passes) {
      chord(0, 8 * k, color);
      chord(1, 8 * k, color);
      for (let i = 0; i < tr.n; i++) {
        const s0 = i / tr.n;
        const s1 = (i + 1) / tr.n;
        line(at(s0, 0), at(s1, 1), 4.6 * k, color);
        line(at(s0, 1), at(s1, 0), 4.6 * k, color);
        line(at(s0, 0), at(s0, 1), 3.2 * k, color);
      }
    }
  }

  // ── 관객 실루엣: 크게 흐려질 어두운 덩어리와 응원봉을 든 팔 ──────────
  function drawCrowd(ctx) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(40,12,60,0.75)';
    for (const [x0, y0, x1, y1, w] of ARMS) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(58,16,80,0.9)';
    for (const [x, y, rx, ry, rot] of CROWD) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx + 4, ry + 4, rot * DEG, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 정적 배경 한 장 ─────────────────────────────────────
  function buildFar(env) {
    const { W, H } = env;
    const far = env.makeCanvas(W, H);
    const g = far.getContext('2d');
    // 바탕: 위는 어두운 남보라, 오른쪽 아래로 남색
    const base = g.createLinearGradient(0, 0, W * 0.6, H);
    base.addColorStop(0, '#26144c');
    base.addColorStop(0.5, PAL.base);
    base.addColorStop(1, '#22168a');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    // 큰 조명 번짐 (따로 그려 크게 흐린 뒤 얹는다)
    const zones = env.makeCanvas(W, H);
    const zg = zones.getContext('2d');
    for (const z of ZONES) softEllipse(zg, z[0], z[1], z[2], z[3], z[4], z[5], z[6], z[7]);
    g.filter = 'blur(18px)';
    g.drawImage(zones, 0, 0);
    g.filter = 'none';

    // 오른쪽 가장자리 빛 띠
    const bands = env.makeCanvas(W, H);
    const bg = bands.getContext('2d');
    bg.lineCap = 'round';
    for (const [x0, y0, x1, y1, w, color, a] of BANDS) {
      bg.strokeStyle = rgba(color, a);
      bg.lineWidth = w;
      bg.beginPath();
      bg.moveTo(x0, y0);
      bg.lineTo(x1, y1);
      bg.stroke();
    }
    g.filter = 'blur(14px)';
    g.globalAlpha = 0.8;
    g.drawImage(bands, 0, 0);
    g.filter = 'blur(4px)';
    g.globalAlpha = 0.9;
    g.drawImage(bands, 0, 0);
    g.globalAlpha = 1;
    g.filter = 'none';

    // 트러스 (조금 흐린 먼 구조물)
    const truss = env.makeCanvas(W, H);
    const tg = truss.getContext('2d');
    for (const tr of TRUSSES) drawTruss(tg, tr);
    g.filter = 'blur(6px)';
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.6;
    g.drawImage(truss, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'blur(3.5px)';
    g.drawImage(truss, 0, 0);
    g.filter = 'none';
    return far;
  }

  // 빔 앞에 놓이는 정적 요소 한 장 (투명 바탕):
  // 트러스 이음매 조명, 관객석 붉은 번짐, 관객 실루엣, 연무, LED 판, 보케, 사각 조명기구
  function buildNear(env) {
    const { W, H } = env;
    const near = env.makeCanvas(W, H);
    const g = near.getContext('2d');
    for (const z of TINTS) softEllipse(g, z[0], z[1], z[2], z[3], z[4], z[5], z[6], 0.2);
    g.globalCompositeOperation = 'screen';
    for (const [x, y, r, c] of JOINTS) {
      glowDot(g, x, y, r * 2.4, c, 0.55);
      glowDot(g, x, y, r, r > 10 ? PAL.blush : c, 0.85);
    }
    g.globalCompositeOperation = 'source-over';
    // 관객석 붉은 빛 번짐
    const glow = env.makeCanvas(W, H);
    const gl = glow.getContext('2d');
    for (const [x, y, rx, ry, rot] of GLOWS) {
      softEllipse(gl, x, y, rx + 4, ry + 4, rot, '#f01450', 0.85, 0.45);
    }
    g.filter = 'blur(4px)';
    g.drawImage(glow, 0, 0);
    g.filter = 'none';

    // 관객 실루엣 (가장 흐리다)
    const crowd = env.makeCanvas(W, H);
    drawCrowd(crowd.getContext('2d'));
    g.filter = 'blur(7px)';
    g.drawImage(crowd, 0, 0);
    g.filter = 'none';

    // 연무
    const haze = noiseCanvas(env, 96, 96, 0.06, 0.06, 'haze', -0.3, 0.5);
    const hz = env.makeCanvas(W, H);
    const hg = hz.getContext('2d');
    hg.drawImage(haze, 0, 0, W, H);
    hg.globalCompositeOperation = 'source-in';
    hg.fillStyle = rgba('#b060ff', 0.05);
    hg.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'screen';
    g.drawImage(hz, 0, 0);
    g.globalCompositeOperation = 'source-over';

    g.drawImage(buildPanels(env), 0, 0);

    // 보케 원반
    g.globalCompositeOperation = 'screen';
    for (const [x, y, r, c, a] of BOKEH) {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(c, a));
      rg.addColorStop(0.8, rgba(c, a * 0.9));
      rg.addColorStop(1, rgba(c, 0));
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 사각 조명기구 (살짝 흐린 빛나는 직사각형)
    g.globalCompositeOperation = 'lighter';
    for (const f of FIXTURES) {
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.ang * DEG);
      glowDot(g, 0, 0, Math.max(f.w, f.h) * 1.3, f.glow, 0.3);
      g.filter = 'blur(2px)';
      g.fillStyle = f.color;
      g.beginPath();
      g.roundRect(-f.w / 2, -f.h / 2, f.w, f.h, 4);
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    return near;
  }

  // LED 판의 반짝임: 판 위 일부 도트만 밝게 빛나는 가산 레이어 (판을 감싸는 상자만 잘라 둔다)
  function buildSparkle(env, phase) {
    const C = env.core;
    const boxes = [];
    for (const pn of PANELS) {
      const ca = Math.abs(Math.cos(pn.ang * DEG));
      const sa = Math.abs(Math.sin(pn.ang * DEG));
      const hw = (pn.w * ca + pn.h * sa) / 2 + 8;
      const hh = (pn.w * sa + pn.h * ca) / 2 + 8;
      const x0 = Math.max(0, Math.floor(pn.cx - hw));
      const y0 = Math.max(0, Math.floor(pn.cy - hh));
      const x1 = Math.min(env.W, Math.ceil(pn.cx + hw));
      const y1 = Math.min(env.H, Math.ceil(pn.cy + hh));
      const c = env.makeCanvas(x1 - x0, y1 - y0);
      const g = c.getContext('2d');
      const noise = C.makeNoise2D(C.hashString('sparkle' + pn.motif + phase) ^ env.seed);
      g.translate(-x0, -y0);
      g.translate(pn.cx, pn.cy);
      g.rotate(pn.ang * DEG);
      g.translate(-pn.w / 2, -pn.h / 2);
      g.filter = 'blur(1.5px)';
      const cols = Math.ceil(pn.w / pn.pitch);
      const rows = Math.ceil(pn.h / pn.pitch);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const n = noise(i * 0.61, j * 0.61) * 0.5 + 0.5;
          if (n < 0.68) continue;
          g.fillStyle = rgba(pn.lit, Math.min(1, (n - 0.68) * 4));
          g.beginPath();
          g.arc((i + 0.5) * pn.pitch, (j + 0.5) * pn.pitch, pn.pitch * 0.45, 0, Math.PI * 2);
          g.fill();
        }
      }
      boxes.push({ canvas: c, x: x0, y: y0 });
    }
    return boxes;
  }

  // LED 판: 흐린 도트 + 넓은 빛 번짐
  function buildPanels(env) {
    const { W, H } = env;
    const raw = env.makeCanvas(W, H);
    const rg = raw.getContext('2d');
    for (const pn of PANELS) drawPanel(env, rg, pn);
    const out = env.makeCanvas(W, H);
    const g = out.getContext('2d');
    g.filter = 'blur(2.2px)';
    g.drawImage(raw, 0, 0);
    g.filter = 'blur(14px)';
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.25;
    g.drawImage(raw, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    return out;
  }

  P.stage = {
    prepare(env) {
      const rng = env.rng('stage');
      const state = {};
      state.far = buildFar(env);
      state.near = buildNear(env);
      state.sparkle = [buildSparkle(env, 0), buildSparkle(env, 1)];
      state.beams = BEAMS.map((b) => ({ b, s: makeBeam(env, b), ph: rng() * 6.28 }));
      state.lights = LIGHTS.map((L) => ({ L, s: makeLight(env, L), w: 0.6 + rng() * 1.6 }));
      state.shards = CONFETTI.map((s) => ({
        sp: makeShard(env, s),
        w: 0.4 + rng() * 0.8,
        vy: 12 + rng() * 18,
      }));
      // 작은 색종이: 시드로 흩뿌린다 (인물 바깥 위주)
      const small = [];
      const colors = [PAL.pink, PAL.hot, PAL.blush, PAL.red, PAL.ice, PAL.orchid];
      for (let i = 0; i < 36; i++) {
        let x;
        let y;
        do {
          x = rng() * env.W;
          y = rng() * env.H * 0.75;
        } while (x > 560 && x < 1120 && y > 120);
        const sz = 4 + rng() * 9;
        const ang = rng() * Math.PI;
        const asp = 0.35 + rng() * 0.5;
        const pts = [
          [x - sz * Math.cos(ang), y - sz * Math.sin(ang)],
          [x - sz * asp * Math.sin(ang), y + sz * asp * Math.cos(ang)],
          [x + sz * Math.cos(ang), y + sz * Math.sin(ang)],
          [x + sz * asp * Math.sin(ang), y - sz * asp * Math.cos(ang)],
        ];
        const c = colors[Math.floor(rng() * colors.length)];
        const s = { pts, c0: c, c1: PAL.hot, blur: 0.8 + rng() * 1.6 };
        const sp = makeShard(env, s);
        small.push({ sp, w: 0.6 + rng() * 1.4, vy: 18 + rng() * 26, a: 0.35 + rng() * 0.5 });
      }
      state.small = small;
      state.sticks = STICKS.map(([x0, y0, x1, y1, w, p]) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        return {
          x0,
          y0,
          ang: Math.atan2(x1 - x0, -(y1 - y0)),
          sp: makeStick(env, len, w, p),
          w: 0.8 + rng() * 1.2,
          amp: 2 + rng() * 4,
        };
      });
      return state;
    },

    drawBack(ctx, state, t, env) {
      const part = env.params.get('stage');
      if (part === 'beams') {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, env.W, env.H);
      } else ctx.drawImage(state.far, 0, 0);
      if (part === 'far') return;

      // 빔: 광원 둘레로 몇 도씩 흔들린다
      for (const { b, s, ph } of state.beams) {
        const sw = b.sweep * Math.sin(t * 0.45 + ph) - b.sweep * Math.sin(ph);
        ctx.save();
        ctx.globalCompositeOperation = b.op;
        ctx.translate(b.x, b.y);
        ctx.rotate((b.ang + sw) * DEG);
        ctx.drawImage(s.canvas, -s.pad, -s.cy);
        ctx.restore();
      }
      if (part === 'beams') return;

      ctx.drawImage(state.near, 0, 0);

      // LED 판 반짝임: 두 무늬가 엇갈려 켜졌다 꺼진다 (t=0에서는 꺼져 있다)
      if (t > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const k = [0.5 - 0.5 * Math.cos(t * 1.7), 0.5 - 0.5 * Math.cos(t * 1.1)];
        state.sparkle.forEach((boxes, i) => {
          ctx.globalAlpha = 0.6 * k[i];
          for (const bx of boxes) ctx.drawImage(bx.canvas, bx.x, bx.y);
        });
        ctx.globalAlpha = 1;
      }

      // 조명: 천천히 숨 쉬듯 밝기가 변한다 (t=0에서 가장 밝다)
      ctx.globalCompositeOperation = 'lighter';
      for (const { L, s, w } of state.lights) {
        ctx.globalAlpha = 1 - 0.3 * (0.5 - 0.5 * Math.cos(t * w * 2.1));
        ctx.drawImage(s.canvas, L.x - s.R, L.y - s.R);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // 색종이: 떨어지며 돌고, 화면 아래로 나가면 위에서 다시 나온다
      const span = env.H + 120;
      const drawShard = (o, alpha) => {
        const y = ((((o.sp.cy + o.vy * t + 60) % span) + span) % span) - 60;
        const x = o.sp.cx + 10 * Math.sin(t * o.w * 0.7);
        const rot = 0.5 * Math.sin(t * o.w);
        const flip = Math.cos(t * o.w * 1.7);
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        ctx.globalAlpha = alpha;
        ctx.setTransform(c, s, -s * flip, c * flip, x, y);
        ctx.drawImage(o.sp.canvas, o.sp.ox, o.sp.oy);
      };
      for (const o of state.small) drawShard(o, o.a);
      for (const o of state.shards) drawShard(o, 1);
      ctx.globalAlpha = 1;

      // 응원봉: 손 쪽 끝을 축으로 좌우로 흔든다
      ctx.globalCompositeOperation = 'screen';
      for (const st of state.sticks) {
        const a = st.ang + st.amp * DEG * Math.sin(t * st.w * 2.4);
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.setTransform(c, s, -s, c, st.x0, st.y0);
        ctx.drawImage(st.sp.canvas, -st.sp.pad - st.sp.wid / 2, -st.sp.len - st.sp.pad);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    },

    // 원본에는 인물 앞을 가리는 무대 요소가 없어 비워 둔다 (반짝임은 fx가 맡는다).
    drawFront() {},
  };
})();
