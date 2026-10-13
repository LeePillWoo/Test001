// 절차적 드로잉 레이어: stage — 인물 뒤의 공연장 전부.
// 바탕 조명 번짐, 볼륨 빔, 트러스, LED 도트 전광판, 조명과 별빛, 색종이, 관객과 응원봉.
// 위치·크기·각도는 원본에서 잰 값(tools/proc_stage.py가 일부를 잰다)이고,
// 색은 팔레트에서 골라 그라디언트·노이즈·흐림으로 칠한다. 배경은 인물보다 흐리게(ctx.filter blur) 둔다.
//
// 층 순서: far(바탕 번짐·빛 띠) → 빔 → near(트러스·관객·연무·LED 판·보케·조명기구·
// 머리카락 뒤 역광) → 빔의 숨 → LED 반짝임 → 조명 → 색종이 → 응원봉
// far·빔·near는 prepare에서 한 장으로 굽고(빔은 t=0 자리에 멈춰 있다), 움직이는 것만 스프라이트로
// 매 프레임 얹는다. 큰 스프라이트를 프레임마다 돌려 그리면 비싸서(소프트웨어 래스터에서 픽셀당 수 ns)
// 빔은 흔드는 대신 무리별로 숨 쉬듯 밝아지고, 응원봉은 미리 세워 둔 한 장을 정수 칸만큼 옮긴다.
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
    [610, 1120, 120, 180, 0, '#d0105c', 0.85, 0.3],
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

  // 볼륨 빔: [광원 x, y, 방향°, 길이, 시작 폭, 끝 폭, 색, 세기, 가장자리 흐림, 합성, 숨 무리, 선택]
  // 숨 무리: BEAM_PULSE의 번호 (0이면 밝아지지 않는다)
  // 선택: fadeIn·fade(길이 비율로 밝아지기 시작·사라지기 시작), haze(빔 결을 따라 흐르는 연무의 세기)
  const BEAMS = [
    // 위 가운데 조명의 빨간 빔 (광원을 화면 위 바깥에 두어 폭을 맞췄다), 붉은 심, 자홍 가장자리
    [250, -200, 69, 640, 95, 210, '#ff1438', 1, 24, 'source-over', 1, { fade: 0.78, haze: 0.12 }],
    [326, -10, 72, 320, 30, 100, '#ff4a50', 0.5, 14, 'lighter', 1],
    [300, 40, 78, 200, 30, 50, '#c01860', 0.5, 14, 'screen', 1],
    // (430,215) 조명에서 왼쪽 아래로 퍼지는 파란 원뿔과 또렷한 하늘색 심, 광원 가까이의 흰 심
    [430, 215, 125, 520, 20, 300, '#3a48ff', 1, 18, 'source-over', 2, { fadeIn: 0.35, fade: 0.8, haze: 0.1 }],
    [430, 215, 127, 240, 12, 60, '#3a8cff', 1, 5, 'screen', 2, { fade: 0.55 }],
    [430, 215, 127, 100, 6, 20, '#c8dcff', 0.9, 4, 'screen', 2, { fade: 0.3 }],
    // 같은 조명에서 오른쪽(머리카락 쪽)으로 번지는 남보라 부채 (원본 (480-640, 180-235)의 띠,
    // tools/proc_stage.py fan으로 잰 가운데 방향 약 -8°)
    [430, 215, -6, 300, 12, 60, '#4430d8', 0.75, 7, 'source-over', 3,
      { fadeIn: 0.4, fade: 0.75, haze: 0.15 }],
    [430, 215, -8, 260, 6, 30, '#3a48ff', 0.5, 6, 'screen', 3, { fadeIn: 0.45, fade: 0.7, haze: 0.2 }],
    // 오른쪽 위로 비스듬한 파란 빛, 왼쪽 위 보라 빛줄기, 별빛 조명의 분홍 꼬리, 오른쪽 위 파란 조각
    [565, 150, 25, 220, 30, 120, '#2e44f0', 0.75, 14, 'screen', 3],
    [222, -30, 92, 150, 50, 70, PAL.violet, 0.3, 16, 'screen', 0],
    [226, 312, 117, 110, 14, 20, '#ffa8f4', 0.75, 4, 'screen', 0],
    [1122, -16, 132, 66, 24, 26, '#1a5cff', 1, 5, 'screen', 0],
  ].map(([x, y, ang, len, w0, w1, color, a, soft, op, pulse, more]) => ({
    x, y, ang, len, w0, w1, color, a, soft, op, pulse, ...more,
  }));
  // 빔의 숨: 무리의 빔을 더한 빛을 near 아래로 비치는 만큼만 screen으로 얹는다 (t=0에서 0).
  // 빔 자체는 바탕과 함께 구워 두므로 프레임마다 회전 그리기가 없다.
  // 무리마다 [최대 세기, 빠르기(rad/s), 밝아질 때 물드는 색]
  const BEAM_PULSE = {
    1: [0.3, 0.9, '#ff9aac'],
    2: [0.35, 0.65, '#a0b8ff'],
    3: [0.4, 1.15, '#b0a0ff'],
  };

  // 트러스: 가운데 선이 지나는 점들 pts, 두 현 사이 폭 d0→d1 (왼쪽 아래가 가까워 넓고 오른쪽 위로 좁아진다),
  // 칸 수 n, 흐림 blur(초점이 먼 만큼). 길이 방향(s: 0..1) 표는 조각별 직선으로 잇는다.
  //   face  빛 쪽(위)을 향한 삼각 면의 세기 — 원본 오른쪽 위 구간의 보라·분홍 삼각형
  //   lit   부재의 밝은 모서리 세기, dark 어두운 부재의 불투명도 (빨간 빔 속에서는 옅다)
  //   joint 마디의 흰분홍 빛 세기
  //   col   [s, 면 색, 면 그늘 색, 부재 색] — 원본 띠 안 밝기 백분위 색을 구간별로 잼
  // 위치와 폭은 원본의 선 성분에서 잼 (tools/proc_stage.py lines, truss): 구간마다 가장 밝은 직선을 이어
  // 가운데 선을 정하고, 그 선을 따라 법선 방향 단면으로 폭을 확인했다.
  const TRUSSES = [
    // 큰 트러스: 왼쪽 (40,238)에서 오른쪽 위 화면 밖까지. 광각이라 오른쪽으로 갈수록 가팔라진다.
    // s 약 0.33~0.55가 빨간 빔 속, 0.7 이후가 분홍·보라 삼각 면이 또렷한 구간
    {
      pts: [
        [40, 238], [150, 214], [250, 190], [330, 158], [420, 119],
        [520, 68], [610, 24], [700, -22], [740, -42],
      ],
      d0: 34,
      d1: 24,
      n: 18,
      blur: 2.2,
      face: [
        [0, 0.45], [0.3, 0.4], [0.36, 0.12], [0.54, 0.12], [0.62, 0.7], [0.72, 1.2], [0.94, 1.2], [1, 0.7],
      ],
      lit: [[0, 0.95], [0.3, 0.85], [0.36, 0.6], [0.54, 0.6], [0.62, 0.6], [1, 0.45]],
      dark: [[0, 0.8], [0.3, 0.75], [0.36, 0.35], [0.54, 0.35], [0.6, 0.85], [1, 0.85]],
      joint: [[0, 0.35], [0.3, 0.5], [0.36, 1], [0.54, 1], [0.6, 0.7], [0.8, 0.9], [1, 0.6]],
      col: [
        [0, '#4a24c0', '#22105c', '#6038d0'],
        [0.28, '#7a24b0', '#3a1460', '#8040d0'],
        [0.38, '#fa4d80', '#a11444', '#ffa0b8'],
        [0.54, '#fa4d80', '#a11444', '#ff98b8'],
        [0.6, '#c02080', '#6a1050', '#d040a0'],
        [0.68, '#b83cff', '#6a20d8', '#7a30c8'],
        [0.82, '#c844ff', '#7424e0', '#8a38d8'],
        [1, '#a838ff', '#6a20d8', '#7a30c8'],
      ],
    },
    // 그 위 왼쪽의 작은 트러스: 빨간 빔 속으로 사라진다 (원본 (100-340, 95-185)의 보라 격자)
    {
      pts: [[90, 184], [200, 148], [350, 98]],
      d0: 30,
      d1: 26,
      n: 7,
      blur: 3.2,
      face: [[0, 0.3], [0.7, 0.3], [1, 0]],
      lit: [[0, 0.7], [0.7, 0.7], [1, 0.2]],
      dark: [[0, 0.6], [0.7, 0.6], [1, 0.2]],
      joint: [[0, 0.3], [0.7, 0.4], [1, 0.2]],
      col: [
        [0, '#5a1a9a', '#2a1050', '#7038c8'],
        [0.7, '#7a1a9a', '#3a1050', '#a038c0'],
        [1, '#f03060', '#801030', '#ff6080'],
      ],
    },
    // 오른쪽 위 전광판을 받치는 짧은 트러스
    {
      pts: [[1068, 112], [1168, 84], [1268, 52]],
      d0: 16,
      d1: 14,
      n: 9,
      blur: 1.2,
      face: [[0, 0.5], [1, 0.5]],
      lit: [[0, 0.6], [1, 0.6]],
      dark: [[0, 0.6], [1, 0.6]],
      joint: [[0, 0.3], [1, 0.3]],
      col: [[0, '#ff40b0', '#6a1460', '#ff40b0'], [1, '#ff60d0', '#6a1460', '#ff60d0']],
    },
  ];
  // 트러스 둘레 번짐의 세기
  const TRUSS_GLOW = 0.2;
  // 트러스 이음매의 작은 조명
  const JOINTS = [
    [522, 62, 15, PAL.pink], [579, 36, 14, PAL.orchid], [624, 12, 12, PAL.orchid],
    [386, 128, 9, PAL.pink], [286, 166, 8, PAL.hot], [300, 176, 7, PAL.hot], [218, 137, 8, PAL.hot],
    [357, 144, 7, PAL.pink], [555, 57, 8, PAL.orchid],
  ];

  // LED 전광판: 중심, 크기, 회전°(또는 원근으로 기운 평행사변형 quad: [왼위, 오른위, 왼아래]),
  // 도트 간격, 무늬, 판 바탕색·꺼진 도트·켜진 도트 색
  // hot: [흰 심, 번짐 색, 반지름/간격] — 켜진 도트를 흰 심 스프라이트로 그린다. dimR: 꺼진 도트 반지름/간격
  const PANELS = [
    { cx: 100, cy: 310, w: 200, h: 78, ang: 16, pitch: 9.5, motif: 'scatter',
      back: '#f00c80', dim: '#ff2a9c', lit: '#ffd0f8', dimR: 0.32, hot: ['#ffd8f4', '#ff58c0', 0.46] },
    // 큰 판: 위 가장자리 (0,355)→(216,415), 오른쪽 가장자리 (216,415)→(152,553) (원본의 판 윤곽에서 잼)
    { quad: [[-130, 319], [216, 415], [-194, 457]], pitch: 10.5, motif: 'glyph',
      back: '#fc0a92', dim: '#ff30b8', lit: '#ffc8f8', dimR: 0.34, hot: ['#fff0ff', '#ff60e0', 0.48] },
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
    // 트러스에 매달린 큰 조명 덩어리 (원본 (505-540, 45-80)의 흰분홍 덩어리)
    { x: 524, y: 62, w: 38, h: 36, ang: -22, color: '#fb48ea', glow: '#fb40ea', core: '#ffd8fa' },
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
  // 관객 실루엣: 원본의 어두운 덩어리(머리·어깨·팔)를 감싸는 타원: x, y, rx, ry, 회전°, 깊이
  // (tools/proc_stage.py crowd 출력 그대로). 깊이는 어두운 정도로 나눴다:
  // 0 먼 줄(주변보다 조금 어두운, 파란 빛 속의 옅은 남보라), 1 가운데 줄, 2 가까운 줄(또렷한 짙은 보라)
  const CROWD = [
    [1224, 1186, 36, 68, -44, 2], [21, 762, 42, 21, -90, 2], [118, 806, 24, 20, -51, 2],
    [33, 690, 32, 18, -54, 1], [1128, 1111, 22, 20, -14, 1], [169, 773, 34, 17, -58, 1],
    [1161, 1183, 29, 12, -78, 1], [126, 756, 24, 10, -90, 1], [1164, 1243, 10, 29, -63, 1],
    [1236, 1219, 27, 8, -78, 1], [1246, 1150, 16, 8, -90, 1], [160, 687, 12, 8, -66, 1],
    [107, 831, 16, 7, -59, 1], [1185, 1117, 7, 11, -6, 1], [64, 588, 36, 41, -6, 0],
    [190, 615, 25, 16, -45, 0], [141, 662, 31, 13, -61, 0], [1175, 1223, 11, 30, -18, 0],
    [120, 592, 25, 11, -47, 0], [16, 602, 17, 16, -36, 0], [228, 631, 19, 14, -84, 0],
    [65, 733, 9, 29, -1, 0], [1181, 1077, 26, 12, -54, 0], [43, 803, 20, 12, -87, 0],
    [197, 668, 19, 11, -58, 0], [1149, 1048, 16, 9, -90, 0], [1227, 1114, 14, 13, -90, 0],
    [174, 734, 14, 14, -90, 0], [1228, 1214, 7, 23, -19, 0], [1118, 1080, 14, 9, -82, 0],
    [256, 630, 12, 8, -72, 0], [1115, 1002, 6, 14, -8, 0],
  ];
  // 들어 올린 팔: 어깨(x0,y0) → 손(x1,y1) (응원봉 손잡이 끝), 굵기, 깊이
  const ARMS = [
    [48, 760, 80, 694, 14, 1], [90, 900, 74, 858, 16, 2], [20, 930, 1, 878, 14, 2],
    [138, 800, 113, 734, 11, 1], [170, 820, 146, 760, 12, 2], [8, 770, 4, 721, 12, 2],
    [40, 778, 44, 742, 9, 1], [0, 690, 7, 653, 10, 1], [185, 700, 190, 655, 10, 0],
    [290, 672, 296, 632, 9, 0], [78, 662, 72, 622, 9, 0], [128, 650, 133, 612, 8, 0],
    [1200, 1320, 1217, 1262, 18, 2], [1250, 1200, 1223, 1104, 14, 2], [1150, 1260, 1129, 1195, 14, 2],
    [1160, 1150, 1142, 1088, 12, 1], [1118, 1102, 1123, 1060, 10, 1], [1172, 1106, 1166, 1062, 9, 1],
    [1258, 1180, 1250, 1133, 10, 2],
  ];
  // 실루엣 색·불투명도·흐림 (깊이 0, 1, 2)
  const CROWD_LOOK = [
    { color: '#3a1678', a: 0.8, blur: 3.5 },
    { color: '#2c1052', a: 0.85, blur: 3 },
    { color: '#1e0c30', a: 0.92, blur: 2.5 },
  ];
  // 오른쪽 가장자리의 분홍 빛 띠: 시작, 끝, 굵기, 색, 세기
  const BANDS = [
    [1170, 458, 1290, 293, 24, '#ff1458', 0.9],
    [1120, 517, 1290, 431, 48, '#ff3a90', 0.9],
    [1120, 512, 1290, 426, 22, '#ffa0d8', 0.75],
    [930, 872, 1290, 824, 46, '#ff1a70', 0.9],
    [1100, 858, 1290, 840, 16, '#ff8ad0', 0.6],
  ];

  // 머리카락 뒤 역광: 원본은 머리카락 틈마다 뒤에서 비치는 자홍 빛이 보인다.
  // 공용 분석의 머리카락 윤곽을 erode px만큼 안으로 줄여(위쪽 가장자리 가까운 푸른 틈은 그대로 둔다)
  // 흐린 뒤, 위 보라빛 자홍 → 아래 붉은 분홍의 세로 그라디언트로 칠한다.
  // 아래쪽(haloY0→haloY1에서 점점)은 줄이지 않은 윤곽까지 칠해 머리카락 둘레로 빛이 번지게 한다.
  // 정수리 쪽 틈은 원본에서 어두운 남색이라 위로 갈수록 사라지게 한다. stops: [y, 색, 세기]
  const BACKLIGHT = {
    erode: 20,
    blur: 18,
    alpha: 0.75,
    haloY0: 380,
    haloY1: 560,
    stops: [[130, '#c01c9c', 0], [330, '#c01c9c', 1], [760, '#c81888', 1], [1254, '#e8145a', 1]],
  };
  // 머리카락 틈으로 보이는 파란 빛: 왼쪽 머리 덩어리의 비스듬한 틈 (원본 (460-590, 385-450),
  // tools/proc_stage.py gaps로 잰 가운데 선). 이 길을 따라 자홍 역광을 지우고(cut 굵기)
  // 파란 빛 띠(w 굵기, 심 core → 가장자리 edge)를 깐다.
  const HAIR_GAPS = [
    { pts: [[470, 440], [510, 424], [550, 412], [588, 390]], cut: 48, w: 26, core: '#6a80ff', edge: '#3a3ad0',
    },
  ];
  // 역광 위에 얹는 진분홍 번짐 (아래 오른쪽 머리카락 틈과 그 오른쪽 띠): [x, y, rx, ry, 회전°, 색, 불투명도]
  const BACKGLOW = [
    [1020, 930, 120, 120, 0, '#f81e94', 0.9],
    [940, 990, 60, 60, 0, '#f81e94', 0.9],
    [1025, 950, 28, 130, -10, '#d0208a', 0.8],
    [1090, 880, 70, 140, 0, '#d0187a', 0.8],
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

  // 미리 그린 캔버스를 정지 비트맵으로 굳힌다. 캔버스를 그대로 drawImage하면 크로미움이 그리기 기록을
  // 프레임마다 다시 래스터화할 수 있어(넓은 near 한 장에 약 15ms) 한 번 굳혀 둔다. 안 되면 캔버스 그대로 쓴다.
  async function freeze(c) {
    if (typeof createImageBitmap !== 'function') return c;
    try {
      return await createImageBitmap(c);
    } catch (err) {
      return c;
    }
  }

  // filter(흐림)를 건 그리기를 둘레 상자만 한 작은 캔버스에서 하고 결과를 g의 현재 합성·불투명도로 얹는다.
  // 큰 캔버스에 filter를 바로 걸면 그리는 크기와 상관없이 캔버스 전체만 한 층을 거쳐 한 번에 약 20ms가 든다.
  // box는 화면 좌표 [x, y, w, h]로, 흐림이 번질 여백(3σ)까지 넣는다. draw(cg)는 화면 좌표로 그린다.
  function boxFilter(env, g, box, filter, draw) {
    const x = Math.floor(box[0]);
    const y = Math.floor(box[1]);
    const c = env.makeCanvas(Math.ceil(box[0] + box[2]) - x, Math.ceil(box[1] + box[3]) - y);
    const cg = c.getContext('2d');
    cg.translate(-x, -y);
    cg.filter = filter;
    draw(cg);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'none';
    g.drawImage(c, x, y);
    g.restore();
  }

  // 점 [[x, y], ...]들을 감싸는 상자 [x, y, w, h]에 여백 m
  function boxAround(pts, m) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs) - m;
    const y = Math.min(...ys) - m;
    return [x, y, Math.max(...xs) + m - x, Math.max(...ys) + m - y];
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

  // 빔 하나를 광원 자리에서 제 방향으로 그린다
  function drawBeam(g, { b, s }, op = b.op) {
    g.save();
    g.globalCompositeOperation = op;
    g.translate(b.x, b.y);
    g.rotate(b.ang * DEG);
    g.drawImage(s.canvas, -s.pad, -s.cy);
    g.restore();
  }

  // 빔의 숨 한 무리: 무리의 빔을 더한 빛(밝은 쪽으로 물들인)에서 near가 가리는 만큼 덜어 낸 한 장
  function makePulse(env, group, near, [amp, w, tint]) {
    const xs = [];
    const ys = [];
    for (const { b, s } of group) {
      const c = Math.cos(b.ang * DEG);
      const sn = Math.sin(b.ang * DEG);
      for (const u of [-s.pad, s.canvas.width - s.pad]) {
        for (const v of [-s.cy, s.canvas.height - s.cy]) {
          xs.push(b.x + u * c - v * sn);
          ys.push(b.y + u * sn + v * c);
        }
      }
    }
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(env.W, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(env.H, Math.ceil(Math.max(...ys)));
    const c = env.makeCanvas(x1 - x0, y1 - y0);
    const g = c.getContext('2d');
    g.translate(-x0, -y0);
    for (const o of group) drawBeam(g, o, 'lighter');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgba(tint, 0.5);
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(near, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return { canvas: c, x: x0, y: y0, amp, w, strips: litStrips(c, 24) };
  }

  // 투명하지 않은 곳만 덮는 가로 띠들 [x, y, w, h] (step줄씩). 비스듬한 빔 상자의 빈 구석을 건너뛴다.
  function litStrips(c, step) {
    const { width: w, height: h } = c;
    const a = c.getContext('2d').getImageData(0, 0, w, h).data;
    const out = [];
    for (let y0 = 0; y0 < h; y0 += step) {
      const y1 = Math.min(h, y0 + step);
      let x0 = w;
      let x1 = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w * 4 + 3;
        for (let x = 0; x < x0; x++) {
          if (a[row + x * 4]) {
            x0 = x;
            break;
          }
        }
        for (let x = w - 1; x >= x1; x--) {
          if (a[row + x * 4]) {
            x1 = x + 1;
            break;
          }
        }
      }
      if (x1 > x0) out.push([x0, y0, x1 - x0, y1 - y0]);
    }
    return out;
  }

  // ── 별빛 조명 스프라이트 ───────────────────────────────────
  function makeLight(env, L) {
    const R = Math.ceil(Math.max(L.halo, L.flare ? L.flare[1] : 0) + 6);
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    g.translate(R, R);
    glowDot(g, 0, 0, L.halo, L.color, 0.62 * L.a);
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

  // 응원봉을 손잡이 끝 (x0, y0)에서 제 각도로 세워 화면 방향 한 장으로 (매 프레임에는 정수 칸만큼 옮겨 얹는다)
  function standStick(env, x0, y0, ang, sp) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const u0 = -sp.pad - sp.wid / 2;
    const v0 = -sp.len - sp.pad;
    const xs = [];
    const ys = [];
    for (const u of [u0, u0 + sp.canvas.width]) {
      for (const v of [v0, v0 + sp.canvas.height]) {
        xs.push(x0 + u * c - v * s);
        ys.push(y0 + u * s + v * c);
      }
    }
    const bx = Math.floor(Math.min(...xs));
    const by = Math.floor(Math.min(...ys));
    const out = env.makeCanvas(Math.ceil(Math.max(...xs)) - bx, Math.ceil(Math.max(...ys)) - by);
    const g = out.getContext('2d');
    g.setTransform(c, s, -s, c, x0 - bx, y0 - by);
    g.drawImage(sp.canvas, u0, v0);
    return { canvas: out, x: bx, y: by };
  }

  // ── LED 도트 판 ─────────────────────────────────────────
  // 왼쪽 큰 판의 흰 점 무늬(물음표 비슷한 두 글자): 화면 좌표의 굵은 획 [x0, y0, x1, y1, 반굵기]
  // 원본의 가장 밝은 도트(초록 채널이 높은 흰분홍)가 이루는 획을 따라 잡았다.
  const GLYPH = [
    // 물음표: 왼쪽 끝 → 위 고리 → 오른쪽으로 돌아 내려와 왼쪽 아래로 꺾이는 줄기
    [6, 410, 10, 384, 15],
    [10, 384, 42, 374, 15],
    [42, 374, 80, 386, 14],
    [80, 388, 94, 420, 17],
    [94, 420, 82, 448, 18],
    [82, 448, 46, 468, 17],
    [46, 468, 32, 512, 17],
    // 오른쪽 둘째 글자: 내려오는 줄기와 왼쪽으로 뻗는 발
    [173, 440, 170, 495, 14],
    [170, 495, 152, 522, 15],
    [150, 540, 114, 544, 13],
  ];
  function segDist(px, py, [x0, y0, x1, y1]) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = dx * dx + dy * dy;
    const k = L ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L)) : 0;
    return Math.hypot(px - x0 - dx * k, py - y0 - dy * k);
  }

  // 무늬 함수: 화면 좌표(sx, sy), 판 좌표(u, v), 노이즈 n, 도트별 난수 r → 밝기 0..1
  function panelMotif(kind, sx, sy, u, v, n, r) {
    if (kind === 'glyph') {
      let m = 0;
      for (const sgm of GLYPH) m = Math.max(m, 1 - (segDist(sx, sy, sgm) - sgm[4]) / 7);
      return Math.max(0, Math.min(1, m));
    }
    // scatter: 시드로 고른 일부 도트만 켠다 (노이즈가 높은 곳에 몰리게)
    if (kind === 'scatter') return r < 0.22 + 0.7 * n * n ? 0.35 + 0.6 * n : 0;
    // rows: 화면 오른쪽(바깥)으로 갈수록 하얗게 타오르는 줄무늬 화면
    const row = 0.5 + 0.5 * Math.sin(v * 22 + u * 3);
    const edge = Math.max(0, Math.min(1, (sx - 1130) / 115));
    return 0.1 + 0.9 * edge * edge + 0.25 * v + 0.3 * row * n;
  }

  // 판의 좌표틀: 판 좌표 (0..w, 0..h) → 화면. 회전한 직사각형이나 평행사변형(quad)
  function panelFrame(pn) {
    let p0;
    let u;
    let v;
    let w;
    let h;
    if (pn.quad) {
      const [a, b, c] = pn.quad;
      p0 = a;
      w = Math.hypot(b[0] - a[0], b[1] - a[1]);
      h = Math.hypot(c[0] - a[0], c[1] - a[1]);
      u = [(b[0] - a[0]) / w, (b[1] - a[1]) / w];
      v = [(c[0] - a[0]) / h, (c[1] - a[1]) / h];
    } else {
      const ca = Math.cos(pn.ang * DEG);
      const sa = Math.sin(pn.ang * DEG);
      w = pn.w;
      h = pn.h;
      u = [ca, sa];
      v = [-sa, ca];
      p0 = [pn.cx - (w / 2) * ca + (h / 2) * sa, pn.cy - (w / 2) * sa - (h / 2) * ca];
    }
    const at = (x, y) => [p0[0] + x * u[0] + y * v[0], p0[1] + x * u[1] + y * v[1]];
    const corners = [at(0, 0), at(w, 0), at(0, h), at(w, h)];
    return {
      w,
      h,
      at,
      corners,
      apply: (ctx) => ctx.transform(u[0], u[1], v[0], v[1], p0[0], p0[1]),
    };
  }

  // 빛나는 도트 스프라이트: 흰 심 → 색 번짐 → 투명
  function makeDot(env, r, core, halo) {
    const R = Math.ceil(r * 1.6);
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, rgba(core, 1));
    grad.addColorStop(0.36, rgba(core, 1));
    grad.addColorStop(0.62, rgba(halo, 0.95));
    grad.addColorStop(0.8, rgba(halo, 0.3));
    grad.addColorStop(1, rgba(halo, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    return { canvas: c, R };
  }

  function drawPanel(env, ctx, pn) {
    const C = env.core;
    const noise = C.makeNoise2D(C.hashString('panel' + pn.motif) ^ env.seed);
    const rng = env.rng('panel' + pn.motif);
    const fr = panelFrame(pn);
    const cols = Math.ceil(fr.w / pn.pitch);
    const rows = Math.ceil(fr.h / pn.pitch);
    const dim = rgbOf(pn.dim);
    const lit = rgbOf(pn.lit);
    // hot이 있는 판은 켜진 도트를 흰 심 스프라이트로, 꺼진 도트는 작은 색 점으로 그린다
    const hot = pn.hot ? makeDot(env, pn.pitch * pn.hot[2], pn.hot[0], pn.hot[1]) : null;
    ctx.save();
    fr.apply(ctx);
    // 판 바탕 (빛이 번진 진분홍)
    ctx.fillStyle = rgba(pn.back, 0.9);
    ctx.fillRect(0, 0, fr.w, fr.h);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const lx = (i + 0.5) * pn.pitch;
        const ly = (j + 0.5) * pn.pitch;
        const [sx, sy] = fr.at(lx, ly);
        const n = C.fbm(noise, i * 0.23, j * 0.23, 3) * 0.5 + 0.5;
        const m = C.clamp(panelMotif(pn.motif, sx, sy, i / cols, j / rows, n, rng()), 0, 1);
        if (hot) {
          ctx.globalAlpha = 0.6 + 0.4 * n;
          ctx.fillStyle = pn.dim;
          ctx.beginPath();
          ctx.arc(lx, ly, pn.pitch * pn.dimR, 0, Math.PI * 2);
          ctx.fill();
          if (m > 0.02) {
            ctx.globalAlpha = m;
            ctx.drawImage(hot.canvas, lx - hot.R, ly - hot.R);
          }
          ctx.globalAlpha = 1;
          continue;
        }
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

  // 조각별 직선 표 [[s, v], ...]에서 s의 값
  function ramp(tab, s) {
    let i = 0;
    while (i < tab.length - 2 && s > tab[i + 1][0]) i++;
    const [s0, v0] = tab[i];
    const [s1, v1] = tab[i + 1];
    return v0 + (v1 - v0) * Math.max(0, Math.min(1, (s - s0) / (s1 - s0 || 1)));
  }
  // 색 표 tr.col에서 s의 k번째 색 (1 면, 2 그늘, 3 부재)을 rgb 배열로
  function rampColor(tab, s, k) {
    let i = 0;
    while (i < tab.length - 2 && s > tab[i + 1][0]) i++;
    const c0 = hexRgb(tab[i][k]);
    const c1 = hexRgb(tab[i + 1][k]);
    const f = Math.max(0, Math.min(1, (s - tab[i][0]) / (tab[i + 1][0] - tab[i][0] || 1)));
    return c0.map((v, j) => v + (c1[j] - v) * f);
  }

  // 트러스 한 개: 워런 트러스(지그재그 사재)의 상자 구조를 아래에서 올려다본 모습.
  // 1) 빛 쪽 삼각 면(면 색 → 그늘 색 그라디언트) 2) 어두운 현·사재 3) 위로 살짝 비낀 밝은 모서리
  // 4) 마디의 흰분홍 빛. 현의 굵기와 마디 빛의 크기는 폭(원근)에 비례한다.
  function drawTruss(ctx, tr, rng) {
    const f = polyAt(tr.pts);
    const dAt = (s) => tr.d0 + (tr.d1 - tr.d0) * s;
    // side +1: 위 현, -1: 아래 현 (polyAt의 법선은 선의 왼쪽 = 화면 위쪽)
    const at = (s, side, lift = 0) => {
      const [x, y, nx, ny] = f(Math.max(0, Math.min(1, s)));
      const d = dAt(s) * (side / 2 + lift);
      return [x + nx * d, y + ny * d];
    };
    const n = tr.n;
    // 위 마디는 s = i/n, 아래 마디는 그 사이 (i+0.5)/n
    const top = (i, lift) => at(i / n, 1, lift);
    const bot = (i, lift) => at((i + 0.5) / n, -1, lift);
    // 1) 삼각 면: 위 두 마디와 그 사이 아래 마디 (빛 쪽), 아래 두 마디와 그 사이 위 마디 (그늘 쪽)
    for (let i = 0; i < n; i++) {
      const sm = (i + 0.5) / n;
      // 칸마다 빛을 고르지 않게: 몇 칸은 그늘에 든다
      const jitter = rng() < 0.25 ? 0.3 : 0.75 + 0.25 * rng();
      const tris = [[top(i), top(i + 1), bot(i), ramp(tr.face, sm) * jitter]];
      if (i < n - 1) tris.push([bot(i), bot(i + 1), top(i + 1), ramp(tr.face, (i + 1) / n) * jitter * 0.12]);
      for (const [p0, p1, p2, a] of tris) {
        if (a < 0.02) continue;
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2;
        const g = ctx.createLinearGradient(mx, my, p2[0], p2[1]);
        g.addColorStop(0, rgba(rampColor(tr.col, sm, 1), Math.min(1, a)));
        g.addColorStop(0.45, rgba(rampColor(tr.col, sm, 1), Math.min(1, a) * 0.9));
        g.addColorStop(1, rgba(rampColor(tr.col, sm, 2), Math.min(1, a) * 0.85));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    // 부재 목록: [시작, 끝, s, 굵기 배율] — 두 현은 칸마다 끊어 그려 길이 방향으로 색과 굵기를 바꾼다
    const members = (lift) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const s0 = i / n;
        const sm = (i + 0.5) / n;
        out.push([top(i, lift), top(i + 1, lift), s0 + 0.5 / n, 1]);
        if (i < n - 1) out.push([bot(i, lift), bot(i + 1, lift), sm + 0.5 / n, 1]);
        out.push([top(i, lift), bot(i, lift), sm, 0.6]);
        if (i < n - 1) out.push([bot(i, lift), top(i + 1, lift), sm + 0.25 / n, 0.6]);
      }
      return out;
    };
    ctx.lineCap = 'round';
    // 2) 어두운 부재
    for (const [p0, p1, s, w] of members(0)) {
      ctx.strokeStyle = rgba('#2a0e48', ramp(tr.dark, s));
      ctx.lineWidth = (3 + dAt(s) * 0.16) * w;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    // 3) 밝은 모서리 (폭의 4%만큼 위로)
    for (const [p0, p1, s, w] of members(0.04)) {
      ctx.strokeStyle = rgba(rampColor(tr.col, s, 3), ramp(tr.lit, s));
      ctx.lineWidth = (2 + dAt(s) * 0.08) * w;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    // 4) 마디 빛: 위·아래 마디마다, 시드로 세기를 흩는다
    for (let i = 0; i <= n; i++) {
      for (const [p, s] of [[top(i), i / n], [bot(i), (i + 0.5) / n]]) {
        if (s > 1) continue;
        const a = ramp(tr.joint, s) * (rng() < 0.5 ? 0.3 : 1);
        const d = dAt(s);
        glowDot(ctx, p[0], p[1], d * 0.3, rampColor(tr.col, s, 1), a * 0.6);
        glowDot(ctx, p[0], p[1], 1.5 + d * 0.08, '#ffd0f0', a);
      }
    }
  }

  // ── 관객 실루엣: 머리·어깨와 응원봉을 든 팔 (깊이별로 한 장씩, 한 색으로 칠한 뒤 통째로 흐린다) ──────
  function drawCrowd(ctx, depth) {
    ctx.lineCap = 'round';
    ctx.fillStyle = ctx.strokeStyle = CROWD_LOOK[depth].color;
    for (const [x0, y0, x1, y1, w, d] of ARMS) {
      if (d !== depth) continue;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      // 응원봉을 쥔 주먹
      ctx.beginPath();
      ctx.arc(x1, y1, w * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y, rx, ry, rot, d] of CROWD) {
      if (d !== depth) continue;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rot * DEG, 0, Math.PI * 2);
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
    const box = boxAround(BANDS.flatMap((b) => [b.slice(0, 2), b.slice(2, 4)]), 24 + 44);
    g.globalAlpha = 0.8;
    boxFilter(env, g, box, 'blur(14px)', (cg) => cg.drawImage(bands, 0, 0));
    g.globalAlpha = 0.9;
    boxFilter(env, g, box, 'blur(4px)', (cg) => cg.drawImage(bands, 0, 0));
    g.globalAlpha = 1;
    return far;
  }

  // 빔 앞에 놓이는 정적 요소 한 장 (투명 바탕):
  // 트러스와 이음매 조명, 관객석 붉은 번짐, 관객 실루엣, 연무, LED 판, 보케, 사각 조명기구,
  // 머리카락 뒤 역광과 그 틈의 파란 빛
  function buildNear(env) {
    const { W, H } = env;
    const near = env.makeCanvas(W, H);
    const g = near.getContext('2d');
    // 트러스: 빔 앞에 그린다 (빨간 빔 속 구간은 표에서 옅게 둔다). 살짝 흐린 뒤 넓은 번짐을 screen으로.
    // 흐림이 비싸서 트러스마다 자기 둘레 상자만 한 캔버스에 그린다.
    const trng = env.rng('truss');
    for (const tr of TRUSSES) {
      const pad = Math.max(tr.d0, tr.d1) + 40;
      const xs = tr.pts.map((p) => p[0]);
      const ys = tr.pts.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
      const x1 = Math.min(W, Math.ceil(Math.max(...xs) + pad));
      const y1 = Math.min(H, Math.ceil(Math.max(...ys) + pad));
      const truss = env.makeCanvas(x1 - x0, y1 - y0);
      const tg = truss.getContext('2d');
      tg.translate(-x0, -y0);
      drawTruss(tg, tr, trng);
      const m = Math.ceil(tr.blur * 3) + 2;
      const box = [x0 - m, y0 - m, truss.width + m * 2, truss.height + m * 2];
      boxFilter(env, g, box, `blur(${tr.blur}px)`, (cg) => cg.drawImage(truss, x0, y0));
      // 넓은 번짐은 1/4 크기에서 흐려 늘린다
      const q = env.makeCanvas(Math.ceil(truss.width / 4), Math.ceil(truss.height / 4));
      const qg = q.getContext('2d');
      qg.filter = `blur(${(tr.blur * 3 + 4) / 4}px)`;
      qg.drawImage(truss, 0, 0, q.width, q.height);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = TRUSS_GLOW;
      g.drawImage(q, x0, y0, q.width * 4, q.height * 4);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    g.filter = 'none';

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
    // 왼쪽 아래·오른쪽 아래 두 무리만 흐린다
    for (const side of [(x) => x < W / 2, (x) => x >= W / 2]) {
      const pts = GLOWS.filter((e) => side(e[0])).flatMap(([x, y, rx, ry]) => {
        const r = Math.max(rx, ry) + 4;
        return [[x - r, y - r], [x + r, y + r]];
      });
      boxFilter(env, g, boxAround(pts, 14), 'blur(4px)', (cg) => cg.drawImage(glow, 0, 0));
    }

    // 관객 실루엣: 먼 줄 → 가까운 줄. 흐림은 관객이 있는 두 상자(왼쪽 아래·오른쪽 아래)에만 건다
    const crowd = env.makeCanvas(W, H);
    const cg = crowd.getContext('2d');
    const boxes = [(x) => x < W / 2, (x) => x >= W / 2].map((side) => {
      const xs = [];
      const ys = [];
      for (const [x, y, rx, ry] of CROWD) if (side(x)) xs.push(x - rx, x + rx), ys.push(y - ry, y + ry);
      for (const [x0, y0, x1, y1] of ARMS) if (side(x0)) xs.push(x0, x1), ys.push(y0, y1);
      const bx = Math.max(0, Math.min(...xs) - 30);
      const by = Math.max(0, Math.min(...ys) - 30);
      return [bx, by, Math.min(W, Math.max(...xs) + 30) - bx, Math.min(H, Math.max(...ys) + 30) - by];
    });
    CROWD_LOOK.forEach((look, depth) => {
      cg.clearRect(0, 0, W, H);
      drawCrowd(cg, depth);
      g.globalAlpha = look.a;
      const m = Math.ceil(look.blur * 3) + 2;
      for (const [x, y, w, h] of boxes) {
        boxFilter(env, g, [x - m, y - m, w + m * 2, h + m * 2], `blur(${look.blur}px)`, (fc) =>
          fc.drawImage(crowd, x, y, w, h, x, y, w, h)
        );
      }
    });
    g.globalAlpha = 1;

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
      const at = (cg) => {
        cg.translate(f.x, f.y);
        cg.rotate(f.ang * DEG);
      };
      const r = Math.hypot(f.w, f.h) / 2 + 14;
      const box = [f.x - r, f.y - r, r * 2, r * 2];
      g.save();
      at(g);
      glowDot(g, 0, 0, Math.max(f.w, f.h) * 1.3, f.glow, 0.3);
      g.restore();
      // 흰 심(core)이 있는 덩어리는 제 색을 덮어 칠하고 가운데만 하얗게 빛난다
      if (f.core) g.globalCompositeOperation = 'source-over';
      boxFilter(env, g, box, 'blur(2px)', (cg) => {
        at(cg);
        cg.fillStyle = f.color;
        cg.beginPath();
        cg.roundRect(-f.w / 2, -f.h / 2, f.w, f.h, 6);
        cg.fill();
      });
      if (f.core) {
        boxFilter(env, g, box, 'blur(4px)', (cg) => {
          at(cg);
          cg.fillStyle = f.core;
          cg.beginPath();
          cg.ellipse(0, 2, f.w * 0.28, f.h * 0.3, 0, 0, Math.PI * 2);
          cg.fill();
        });
        g.globalCompositeOperation = 'lighter';
      }
    }
    g.globalCompositeOperation = 'source-over';

    const back = buildBacklight(env);
    if (back) g.drawImage(back, 0, 0);
    return near;
  }

  // 점 목록을 이은 열린 Path2D
  function polyPath(pts) {
    const path = new Path2D();
    pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    return path;
  }

  // evenodd 고리 목록(납작한 [x0, y0, x1, y1, ...] 배열들)을 Path2D 하나로
  function ringsPath(rings) {
    const path = new Path2D();
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i += 2) {
        if (i) path.lineTo(ring[i], ring[i + 1]);
        else path.moveTo(ring[i], ring[i + 1]);
      }
      path.closePath();
    }
    return path;
  }

  // 머리카락 뒤 역광 한 장 (공용 분석에 머리카락 윤곽이 없으면 진분홍 번짐만)
  function buildBacklight(env) {
    const { W, H } = env;
    const rings = env.data && env.data.regions && env.data.regions.hair;
    const out = env.makeCanvas(W, H);
    const g = out.getContext('2d');
    if (rings && rings.length) {
      // 윤곽 채우기 → 경계선을 굵게 지워 안으로 줄이기 (+ 아래쪽은 줄이지 않은 윤곽) → 흐림 → 색 입히기
      // 넓게 흐릴 가림판이라 절반 해상도로 만든다 (준비 시간 절약)
      const k = 0.5;
      const path = ringsPath(rings);
      const m = env.makeCanvas(Math.round(W * k), Math.round(H * k));
      const mg = m.getContext('2d');
      mg.scale(k, k);
      mg.fillStyle = '#fff';
      mg.fill(path, 'evenodd');
      mg.globalCompositeOperation = 'destination-out';
      mg.lineJoin = 'round';
      mg.lineWidth = BACKLIGHT.erode * 2;
      mg.stroke(path);
      const halo = env.makeCanvas(m.width, m.height);
      const hg = halo.getContext('2d');
      hg.scale(k, k);
      hg.fillStyle = '#fff';
      hg.fill(path, 'evenodd');
      hg.globalCompositeOperation = 'destination-in';
      const ramp = hg.createLinearGradient(0, BACKLIGHT.haloY0, 0, BACKLIGHT.haloY1);
      ramp.addColorStop(0, 'rgba(255,255,255,0)');
      ramp.addColorStop(1, '#fff');
      hg.fillStyle = ramp;
      hg.fillRect(0, 0, W, H);
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.globalCompositeOperation = 'source-over';
      mg.drawImage(halo, 0, 0);
      // 파란 틈 자리는 자홍 역광을 지운다
      mg.scale(k, k);
      mg.globalCompositeOperation = 'destination-out';
      mg.lineCap = 'round';
      for (const gap of HAIR_GAPS) {
        mg.lineWidth = gap.cut;
        mg.stroke(polyPath(gap.pts));
      }
      const soft = env.makeCanvas(m.width, m.height);
      const sg = soft.getContext('2d');
      sg.filter = `blur(${BACKLIGHT.blur * k}px)`;
      sg.drawImage(m, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(soft, 0, 0, W, H);
      g.globalCompositeOperation = 'source-in';
      const st = BACKLIGHT.stops;
      const y0 = st[0][0];
      const y1 = st[st.length - 1][0];
      const grad = g.createLinearGradient(0, y0, 0, y1);
      for (const [y, c, a] of st) grad.addColorStop((y - y0) / (y1 - y0), rgba(c, a * BACKLIGHT.alpha));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    for (const z of BACKGLOW) softEllipse(g, z[0], z[1], z[2], z[3], z[4], z[5], z[6], 0.25);
    // 파란 틈: 넓고 흐린 가장자리 색 위에 좁고 밝은 심
    for (const gap of HAIR_GAPS) {
      const path = polyPath(gap.pts);
      const box = boxAround(gap.pts, gap.w * 0.75 + 26);
      const stroke = (color, width) => (cg) => {
        cg.lineCap = 'round';
        cg.strokeStyle = color;
        cg.lineWidth = width;
        cg.stroke(path);
      };
      boxFilter(env, g, box, 'blur(8px)', stroke(gap.edge, gap.w * 1.5));
      boxFilter(env, g, box, 'blur(4px)', stroke(gap.core, gap.w * 0.6));
    }
    return out;
  }

  // LED 판의 반짝임: 판 위 일부 도트만 밝게 빛나는 가산 레이어 (판을 감싸는 상자만 잘라 둔다)
  function buildSparkle(env, phase) {
    const C = env.core;
    const boxes = [];
    for (const pn of PANELS) {
      const fr = panelFrame(pn);
      const xs = fr.corners.map((p) => p[0]);
      const ys = fr.corners.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs) - 8));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) - 8));
      const x1 = Math.min(env.W, Math.ceil(Math.max(...xs) + 8));
      const y1 = Math.min(env.H, Math.ceil(Math.max(...ys) + 8));
      const c = env.makeCanvas(x1 - x0, y1 - y0);
      const g = c.getContext('2d');
      const noise = C.makeNoise2D(C.hashString('sparkle' + pn.motif + phase) ^ env.seed);
      g.translate(-x0, -y0);
      fr.apply(g);
      g.filter = 'blur(1.5px)';
      const cols = Math.ceil(fr.w / pn.pitch);
      const rows = Math.ceil(fr.h / pn.pitch);
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
    // 판이 있는 왼쪽·오른쪽 상자에서만 흐린다
    const boxes = [(x) => x < W / 2, (x) => x >= W / 2].map((side) => {
      const sideOf = (pn) => side(pn.quad ? pn.quad[0][0] : pn.cx);
      return boxAround(PANELS.filter(sideOf).flatMap((pn) => panelFrame(pn).corners), 44);
    });
    for (const box of boxes) boxFilter(env, g, box, 'blur(2.2px)', (cg) => cg.drawImage(raw, 0, 0));
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.25;
    for (const box of boxes) boxFilter(env, g, box, 'blur(14px)', (cg) => cg.drawImage(raw, 0, 0));
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return out;
  }

  P.stage = {
    async prepare(env) {
      const rng = env.rng('stage');
      const part = env.params.get('stage');
      const state = {};
      const far = buildFar(env);
      const near = buildNear(env);
      state.sparkle = [buildSparkle(env, 0), buildSparkle(env, 1)];
      const beams = BEAMS.map((b) => ({ b, s: makeBeam(env, b) }));
      BEAMS.forEach(() => rng()); // 예전 빔 흔들림 위상 자리: 뒤의 난수열(색종이 자리 등)을 그대로 두려고 뽑는다
      // far → 빔 → near를 한 장으로 굽는다 (far가 화면을 다 덮어 불투명 캔버스로 둔다: 얹기가 복사가 된다)
      const back = env.makeCanvas(env.W, env.H);
      const bg = back.getContext('2d', { alpha: false });
      bg.drawImage(far, 0, 0);
      for (const o of beams) drawBeam(bg, o);
      bg.drawImage(near, 0, 0);
      state.back = back;
      state.pulses = Object.keys(BEAM_PULSE).map((id) =>
        makePulse(env, beams.filter((o) => o.b.pulse === +id), near, BEAM_PULSE[id])
      );
      if (part === 'far' || part === 'beams') state.debug = { part, far, beams };
      state.lights = LIGHTS.map((L) => ({ L, s: makeLight(env, L), w: 0.6 + rng() * 1.6 }));
      state.shards = CONFETTI.map((s) => ({
        sp: makeShard(env, s),
        w: 0.4 + rng() * 0.8,
        bob: 8 + rng() * 8, // 제자리에서 오르내리는 폭(px)
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
        small.push({ sp, w: 0.6 + rng() * 1.4, vy: 18 + rng() * 26, a: 0.4 + rng() * 0.5 });
      }
      state.small = small;
      state.sticks = STICKS.map(([x0, y0, x1, y1, w, p]) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const sp = standStick(env, x0, y0, Math.atan2(x1 - x0, -(y1 - y0)), makeStick(env, len, w, p));
        // 흔드는 폭(px): 2~6°만큼 기울였을 때 봉 가운데가 움직이는 거리
        return { sp, w: 0.8 + rng() * 1.2, reach: (2 + rng() * 4) * DEG * len * 0.5 };
      });
      // 정적인 장들과 스프라이트를 모두 굳힌다 (그림은 같고 프레임 비용만 준다)
      const sprites = [
        ...state.pulses,
        ...state.lights.map((o) => o.s),
        ...state.shards.map((o) => o.sp),
        ...state.small.map((o) => o.sp),
        ...state.sticks.map((o) => o.sp),
        ...state.sparkle.flat(),
      ];
      state.back = await freeze(state.back);
      const frozen = await Promise.all(sprites.map((sp) => freeze(sp.canvas)));
      sprites.forEach((sp, i) => (sp.canvas = frozen[i]));
      return state;
    },

    drawBack(ctx, state, t, env) {
      if (state.debug) {
        const { part, far, beams } = state.debug;
        if (part === 'far') ctx.drawImage(far, 0, 0);
        else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, env.W, env.H);
          for (const o of beams) drawBeam(ctx, o);
        }
        return;
      }
      ctx.drawImage(state.back, 0, 0);

      // 빔의 숨: 무리마다 다른 빠르기로 밝아졌다 돌아온다 (t=0에서 0)
      ctx.globalCompositeOperation = 'screen';
      for (const p of state.pulses) {
        const k = p.amp * (0.5 - 0.5 * Math.cos(t * p.w));
        if (k < 0.004) continue;
        ctx.globalAlpha = k;
        for (const [x, y, w, h] of p.strips) ctx.drawImage(p.canvas, x, y, w, h, p.x + x, p.y + y, w, h);
      }
      ctx.globalAlpha = 1;

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

      // 색종이: 작은 것은 떨어지며 돌고 화면 아래로 나가면 위에서 다시 나온다. 큰 조각은 원본 구도를 지키도록
      // 제자리에서 오르내리며 나풀거린다 (fx의 번짐은 t=0 자리에 구워져 있어 멀리 가면 번짐만 남는다).
      const span = env.H + 120;
      const drawShard = (o, alpha, fall) => {
        const y = fall
          ? ((((o.sp.cy + o.vy * t + 60) % span) + span) % span) - 60
          : o.sp.cy + o.bob * Math.sin(t * o.w * 0.5);
        const x = o.sp.cx + 10 * Math.sin(t * o.w * 0.7);
        const rot = 0.5 * Math.sin(t * o.w);
        const flip = Math.cos(t * o.w * 1.7);
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        ctx.globalAlpha = alpha;
        ctx.setTransform(c, s, -s * flip, c * flip, x, y);
        ctx.drawImage(o.sp.canvas, o.sp.ox, o.sp.oy);
      };
      for (const o of state.small) drawShard(o, o.a, true);
      for (const o of state.shards) drawShard(o, 1, false);
      ctx.globalAlpha = 1;

      // 응원봉: 좌우로 흔들며 흔들 때마다 살짝 들린다. 정수 칸으로만 옮겨 회전 그리기 없이 얹는다.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'screen';
      for (const st of state.sticks) {
        const ph = t * st.w * 2.4;
        const dx = Math.round(st.reach * Math.sin(ph));
        const dy = Math.round(st.reach * 0.25 * (Math.cos(2 * ph) - 1));
        ctx.drawImage(st.sp.canvas, st.sp.x + dx, st.sp.y + dy);
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    // 원본에는 인물 앞을 가리는 무대 요소가 없어 비워 둔다 (반짝임은 fx가 맡는다).
    drawFront() {},
  };
})();
