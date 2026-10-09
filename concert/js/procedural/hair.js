// 절차적 드로잉 레이어: hair — 머리카락 전부.
// 기하는 tools/proc_hair.py가 원본에서 잰 data/hair.js를 쓴다: 실루엣·구멍·앞/뒤 영역, 결을 따라 그은
// 다발·가닥 흐름선(가르마에서 양쪽으로), 먹선, 잔머리, 그리고 셀 면의 모양 — '빛 받는 다발' 면과 그 안의
// 가장 밝은 결, 중간톤 다발 몸통, 윤기 결, 차가운 반사 결의 윤곽. 색은 원본 화소를 읽지 않는다: 팔레트 램프
// + 손으로 잰 조명 구역 + 역광 규칙(바깥 배경 쪽 가장자리일수록 밝다) + 노이즈로 정한다. 어느 면이 밝은지(모양)는
// 재고, 얼마나 무슨 색으로 밝은지는 조명 구역이 정한다.
//
// 칠하는 순서 (셀 셰이딩 일러스트처럼)
//   가장 어두운 바탕 → 다발 리본(빛 면 가까이는 중간톤) → 가는 결 → 중간톤 다발 면 → 차가운 반사 결
//   → 윤기 면·결 → 빛 면(어깨색, 가장 밝은 결은 본색) → 빛 다발의 올·빛 면 위 어두운 올 → 복숭아빛 심
//   → 먹선 → 왼쪽 아래 다발 끝 흐리기 → 구멍 비우기
// 정적인 부분은 prepare에서 뒤(drawBack)·앞(drawFront) 두 장으로 굽는다. 앞 장에는 피부 위로 걸친 머리
// (목 둘레 베일, 목 왼쪽 다발 끝, 얼굴 둘레 가닥 끝, 이마 가닥), 구멍 가장자리의 빛 테, 구멍을 건너는 활 모양
// 가는 가닥을 더 굽는다. 매 프레임 그리는 것: 흩날리는 가닥 끝과 긴 잔머리·정수리 고리·목 위 가닥
// (끝으로 갈수록 흔들림), 일렁이는 테두리빛. t=0이 원본 자세다.
//
// 디버그 주소 옵션: hairmap=0..6|lit0|lit1|sheen|hl|fly|mid|cool|gap|rim|fill|pink… (색 지도나 조명 값을 실루엣에 칠해 봄),
//   hairoff=mid,cool,sheen,veil,ink,lockink,fibre,darkon,strand,core,soft,rim (그 단계를 끔),
//   hairext=0 (몸 밑으로 이어 그리지 않음),
//   hairtime=1 (준비 단계별 시간을 콘솔 경고로)
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});
  const TAU = Math.PI * 2;
  const CELL = 4; // 조명 격자 한 칸(px)
  const LEVELS = 7; // 밝기 단계 지도 개수
  const STRAND_P = 0.3; // 가는 결을 그릴 확률 (낮을수록 다발의 평평한 셀 면이 드러난다)
  const LOCK_W = [4.5, 5.5]; // 다발 리본 반폭(px): 최소, 더할 수 있는 폭
  const INK_W = 0.7; // 원본에서 잰 먹선 반폭에 곱하는 값
  const INK_MIN_PTS = 4; // 이보다 짧은(점 수, 5px 간격) 먹선은 긁힌 자국처럼 보여 버린다
  const LOCK_INK_P = 0.15; // 다발 리본 가장자리에 먹선을 그을 확률
  const GAP_W = [0.5, 0.7]; // 틈을 건너는 가닥의 반폭(px): 최소, 더할 수 있는 폭
  const RIM_W = [2, 2]; // 구멍 가장자리 빛 테의 폭(px): 최소, 더할 수 있는 폭
  const GAP_P = 0.6; // 틈을 건너는 가닥을 그릴 확률
  const GAP_DARK = 0.2; // 틈 가닥 중 어두운 것의 비율
  const FIBRE_P = 0.15; // 빛 다발 곁의 가는 결을 같은 빛으로 그릴 확률
  const CORE_P = 0.75; // 넓은 빛 다발 가운데에 복숭아빛 심을 넣을 확률
  const EDGE_BAND = 1; // 바깥 가장자리에서 바탕을 비우는 띠(px): 가닥 끝만 남는다
  const HOLE_SHRINK = 0; // 구멍을 비울 때 줄이는 폭(px)
  const HOLE_BLUR = 0.8; // 구멍 가장자리를 흐리는 폭(px)
  const MID_A = 0.9; // 중간톤 다발 몸통의 불투명도
  const COOL_A = 0.85; // 차가운 반사 결의 불투명도
  const DARK_ON_LIT = 0.16; // 빛 면 위를 지나는 결 조각을 어두운 올로 그릴 확률
  const CORE_MIN_LEN = 60; // 복숭아빛 심을 넣을 빛 심 곡선의 최소 길이(px)
  // 빛이 오는 쪽 (상자 x0, y0, x1, y1 안에서 빛을 향하는 방향 dx, dy): 왼쪽·정수리는 왼쪽 위, 오른쪽은 오른쪽.
  // 구멍 가장자리 빛 테를 어느 쪽에 그을지 정한다
  const LIGHT_DIR = [
    [0, 0, 900, 1254, -0.45, -0.9],
    [900, 0, 1254, 1254, 0.9, -0.4],
  ];
  const VEIL_P = 0.95; // 베일 띠에서 결 조각을 가는 가닥으로 그릴 확률
  const VEIL_W = [0.6, 0.7]; // 베일 가닥 뿌리 반폭(px): 최소, 더할 수 있는 폭
  const FRINGE_P = 0.7; // 얼굴 둘레 상자에서 경계에서 끝나는 결을 피부 쪽으로 늘일 확률
  const FRINGE_EXT = [3, 6]; // 그때 늘이는 길이(px): 최소, 더할 수 있는 길이
  // 다발 끝을 뾰족하게 늘이는 상자 (x0, y0, x1, y1): 목 왼쪽 다발
  const TIPS = [[700, 500, 800, 600]];
  const TIP_P = 0.35; // 그 상자에서 끝나는 결을 늘일 확률
  // 바깥 윤곽을 반투명하게 흐리는 상자 (x0, y0, x1, y1, 폭 px): 왼쪽 아래로 풀린 다발 끝
  const SOFT_EDGE = [[100, 600, 430, 980, 6]];
  const SEE_N = 4; // 비침 구역(팔뚝·허리)에서 굵은 다발 사이에 더 긋는 가는 가닥 수
  const LONG_P = 0.3; // 역광 띠의 흩날리는 끝이 긴 잔머리가 될 확률
  const MAX_CURL = 0.05; // 잔머리가 4px마다 휘는 최대 각(rad): 곡률 1/80px 이하
  const LOOSE_LEN = 30; // 역광 가장자리에서 흩날리는 끝을 더 늘일 수 있는 길이(px)

  // ── 팔레트: 밝기 램프 (u = 0 그늘 → 1 가장 밝은 결) ──────────
  const RAMPS = {
    // 왼쪽·위: 자줏빛 그늘 → 갈색 → 산호 → 복숭아
    warm: [
      [0, '#10060e'],
      [0.16, '#2c1520'],
      [0.32, '#4a2630'],
      [0.46, '#6c4044'],
      [0.6, '#a25e5a'],
      [0.72, '#ee7c7e'],
      [0.86, '#f99c92'],
      [1, '#fcd4c6'],
    ],
    // 오른쪽: 자홍 테두리빛
    pink: [
      [0, '#1e0a1a'],
      [0.16, '#30112a'],
      [0.32, '#4a1a38'],
      [0.46, '#82204a'],
      [0.6, '#d23c62'],
      [0.72, '#ec5a74'],
      [0.86, '#f8a4a8'],
      [1, '#fcd8d4'],
    ],
    // 얼굴 둘레: 윤기 도는 갈색 (자줏빛이 덜하다)
    brown: [
      [0, '#100808'],
      [0.16, '#2a1816'],
      [0.32, '#4a2c2a'],
      [0.46, '#6a4440'],
      [0.6, '#94605a'],
      [0.72, '#e07c72'],
      [0.86, '#f4a090'],
      [1, '#fcd4c6'],
    ],
    // 파란 무대 빔이 비친 결
    blue: [
      [0, '#120a2a'],
      [0.16, '#1e1848'],
      [0.32, '#2c2a78'],
      [0.46, '#3c3ca8'],
      [0.6, '#5458d8'],
      [0.72, '#7a80f0'],
      [0.86, '#a8b0ff'],
      [1, '#d8dcff'],
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
  const VEIL_LINE = '#4a2830'; // 얼굴 위를 가로지르는 한 가닥 (빛을 받아 조금 옅다)

  // ── 조명 구역 (원본에서 손으로 잰 위치) ───────────────────
  // [x, y, 반경, 종류, 세기, 띠 폭]  띠 폭 > 0이면 역광: 바깥 배경 쪽 가장자리에서 그 폭 안쪽까지만 밝다.
  // warm = 왼쪽 위에서 오는 연어·복숭아빛, pink = 오른쪽 자홍빛, violet = 그늘의 보랏빛, dark = 깊은 그늘
  const LIGHTS = [
    // 뒤에서 오는 역광 (배경 쪽 가장자리 띠)
    [500, 420, 400, 'warm', 0.95, 80],
    [660, 170, 170, 'warm', 0.95, 60],
    [880, 60, 260, 'warm', 0.6, 38],
    [270, 760, 230, 'warm', 0.85, 60],
    [1080, 150, 150, 'pink', 0.7, 45],
    [1060, 140, 130, 'warm', 0.5, 45],
    [1160, 430, 250, 'pink', 0.95, 65],
    [1190, 600, 260, 'pink', 0.9, 95],
    [1150, 880, 220, 'pink', 0.85, 35],
    [1000, 1150, 260, 'pink', 0.35, 20],
    // 앞에서 오는 무대 조명 (얼굴 둘레 머리, 오른쪽 덩어리 바깥 결)
    [900, 150, 200, 'warm', 0.65, 0],
    [990, 220, 60, 'pink', 0.6, 0],
    [690, 230, 120, 'warm', 0.3, 0],
    [640, 480, 100, 'warm', 0.5, 0],
    [540, 450, 130, 'warm', 0.55, 0],
    [760, 540, 110, 'warm', 0.6, 0],
    [1060, 260, 120, 'pink', 0.55, 0],
    [1150, 250, 110, 'pink', 0.85, 0],
    [1050, 150, 100, 'warm', 0.6, 0],
    [1160, 540, 100, 'pink', 0.85, 0],
    [700, 520, 70, 'warm', 0.5, 0],
    [1170, 720, 70, 'pink', 0.4, 0],
    [1000, 860, 70, 'pink', 0.5, 0],
    [1150, 400, 90, 'pink', 0.6, 0],
    [1140, 850, 110, 'pink', 0.6, 0],
    [1120, 1000, 100, 'pink', 0.5, 0],
    [1110, 1150, 100, 'pink', 0.45, 0],
    [560, 445, 90, 'warm', 0.85, 0],
    [1105, 560, 60, 'warm', 0.85, 0],
    // 그늘의 보랏빛과 깊은 그늘
    [760, 70, 140, 'violet', 0.25, 0],
    [1030, 650, 170, 'violet', 0.4, 0],
    [960, 1100, 220, 'violet', 0.35, 0],
    [520, 390, 70, 'violet', 0.5, 0],
    [740, 350, 70, 'dark', 0.5, 0],
    [940, 85, 40, 'dark', 0.8, 0], // 가르마 그늘
    [690, 280, 60, 'dark', 0.6, 0],
    [900, 560, 80, 'dark', 0.5, 0],
    [930, 1060, 190, 'dark', 0.2, 0],
    [960, 1150, 160, 'pink', 0.45, 0], // 아래 오른쪽 덩어리의 자홍 결
    [420, 720, 120, 'dark', 0.8, 0], // 팔 옆 깊은 그늘
    // 얼굴 둘레의 갈색 머리 (관자놀이·이마): 몸통을 갈색 중간톤으로 들어 올리되 산호빛까지는 아니게
    [770, 230, 80, 'warm', 0.45, 0],
    [1015, 270, 70, 'warm', 0.4, 0],
    [775, 250, 110, 'brown', 0.8, 0],
    [1020, 290, 100, 'brown', 0.7, 0],
    [890, 150, 110, 'brown', 0.6, 0],
    [270, 740, 170, 'brown', 0.6, 0], // 왼쪽 아래로 풀린 다발 끝: 따뜻한 갈색
    // 파란 빔이 비친 곳 (왼쪽 아치 다발 속, 오른쪽 안쪽 덩어리, 오른쪽 가장자리, 왼쪽 아래)
    [510, 420, 60, 'blue', 0.9, 0],
    [370, 470, 40, 'blue', 0.7, 0],
    [1030, 690, 100, 'blue', 0.65, 0],
    [1180, 430, 80, 'blue', 0.6, 40],
    [220, 700, 70, 'blue', 0.5, 30],
  ];

  // ── 베일: 머리가 피부 위에 걸친 가장자리 (손으로 잰 상자 x0, y0, x1, y1, 깎는 반경 r) ──
  // r > 0: 앞 머리 경계 띠를 덩어리 대신 촘촘한 가는 가닥으로 그려, 가닥 사이로 피부가 비친다
  // r = 0: 깎지 않고, 경계에서 끝나는 결의 끝만 피부 쪽으로 늘인다 (얼굴 둘레)
  const VEILS = [
    [795, 110, 880, 245, 0], // 이마 왼쪽 앞머리
    [735, 225, 805, 305, 0], // 왼쪽 관자놀이
    [985, 190, 1045, 350, 0], // 오른쪽 관자놀이
    [690, 275, 770, 345, 0], // 왼쪽 귀 위
    [1020, 330, 1070, 460, 0], // 오른쪽 귀·볼
    [700, 420, 845, 660, 9], // 목 왼쪽
    [845, 440, 965, 660, 8], // 목 오른쪽·가슴
  ];
  // 손으로 잰 이마 가닥 (x, y, …): 가르마(935, 112)에서 왼쪽 눈썹 아래 가장자리(858, 211)까지
  const FOREHEAD = [935, 112, 935, 135, 931, 155, 922, 175, 910, 190, 895, 200, 876, 207, 858, 211];
  // 손으로 잰 가는 가닥 (x, y, …): 왼쪽 귀를 덮는 가닥들
  const VEIL_LINES = [
    [770, 240, 745, 262, 715, 285, 690, 305],
    [775, 252, 756, 276, 736, 300, 712, 330],
    [758, 262, 748, 290, 742, 318],
    [745, 255, 725, 281, 706, 310, 690, 340],
    [766, 268, 752, 300, 744, 338],
  ];

  // 정수리 위 고리 모양 잔머리 (손으로 잰 곡선): 실루엣에서 뺀 자리에 가는 선으로 그린다
  const LOOPS = [
    [930, 62, 932, 40, 942, 21, 960, 12, 978, 16, 988, 30, 990, 48],
    [938, 58, 944, 37, 956, 25, 970, 22, 980, 32, 984, 46],
    [924, 60, 921, 40, 928, 24, 940, 16],
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
    const out = { warm: 0, pink: 0, violet: 0, blue: 0, brown: 0, dark: 0, rim: 0, fill: 0 };
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

  // 색조 섞기: 연어빛 램프에 자홍(오른쪽 빛)과 보랏빛(빛이 없는 그늘)을 섞는다
  function tint(L, u, ramps, pinkGain) {
    const lit = 1 - (1 - L.warm) * (1 - L.pink);
    let c = rampAt(ramps.warm, u);
    const pinkW = L.pink / (L.pink + L.warm + 1e-3);
    c = mix3(c, rampAt(ramps.pink, u), pinkW * Math.min(1, L.pink * pinkGain));
    c = mix3(c, rampAt(ramps.brown, u), L.brown);
    c = mix3(c, rampAt(ramps.violet, u), L.violet * (1 - lit) * 0.75);
    // 파란 빔: 그늘 바탕과 산호빛 빛 면은 그대로 두고 그 사이 결(윤기·중간톤)만 파랗게
    return mix3(c, rampAt(ramps.blue, u), L.blue * 0.85 * smooth(0.25, 0.45, u) * (1 - smooth(0.55, 0.75, u)));
  }

  // 그늘 단계 v(0..1)의 색: 다발 몸통. 빛 구역은 그늘을 조금만 들어 올린다 (밝은 면은 따로 칠한다)
  function shade(L, v, ramps) {
    const u = 0.1 + 0.3 * v + 0.08 * L.rim + 0.28 * L.fill + 0.1 * L.violet - 0.1 * L.dark + 0.05 * L.n;
    return tint(L, Math.max(0, Math.min(0.62, u)), ramps, 2);
  }

  // 빛 받는 다발의 색. tier 0 = 어깨(가장자리), 1 = 본색, 2 = 심, 3 = 윤기 결(그늘 안). b = 그 자리 빛의 세기
  function litShade(L, tier, ramps) {
    const b = Math.max(0.12, Math.min(1, 0.36 + 0.8 * Math.max(L.rim, L.fill) - 0.35 * L.dark + 0.06 * L.n));
    const u = [0.42 + 0.34 * b, 0.48 + 0.46 * b, 0.74 + 0.26 * b, Math.min(0.6, 0.38 + 0.3 * b)][tier];
    return tint(L, u, ramps, tier < 2 ? 4 : 2.5);
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
  // hw(s) = 반폭, s = 0(뿌리)..1(끝). off = 결에 수직으로 비켜 놓는 거리. cap이면 뿌리를 반원으로 둥글게.
  function addRibbon(path, pts, hw, off = 0, cap = false) {
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
    if (cap) {
      // right[0] → 뿌리 뒤쪽 → left[0] 반원 (윤곽이 한 번에 이어져 감김 방향이 다른 리본과 같다)
      const cx = (left[0][0] + right[0][0]) / 2;
      const cy = (left[0][1] + right[0][1]) / 2;
      const r = Math.hypot(left[0][0] - cx, left[0][1] - cy);
      if (r > 0.3) {
        const nx = (left[0][0] - cx) / r;
        const ny = (left[0][1] - cy) / r;
        const tl = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1;
        const tx = (pts[1][0] - pts[0][0]) / tl;
        const ty = (pts[1][1] - pts[0][1]) / tl;
        for (let k = 1; k < 8; k++) {
          const a = (Math.PI * k) / 8;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          path.lineTo(cx - (nx * c + tx * sn) * r, cy - (ny * c + ty * sn) * r);
        }
      }
    }
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

  // 다발 조각: 다발 흐름선을 잘라 조각마다 그늘 단계 하나 (셀 그늘 면). 원본에서 잰 빛 면 가까이(10px)의
  // 다발은 중간톤(빛 면 둘레의 감빛 갈색 몸통), 나머지는 어둡게
  function lockPieces(D, rng, nearLit) {
    const out = [];
    for (const flat of D.locks) {
      for (const [a, b] of pieces(flat.length / 2, rng, 18, 60)) {
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        const v = nearLit(m[0], m[1], 10) ? 0.36 + rng() * 0.2 : rng() * 0.3;
        out.push({ pts, v, w: LOCK_W[0] + rng() * LOCK_W[1] });
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

  // 폭 윤곽들 (s = 0 뿌리 → 1 끝)
  const lockWidth = (L) => (s) => L.w * Math.sqrt(Math.min(1, s / 0.15 + 0.1)) * Math.pow(1 - s, 0.7);
  // 양 끝이 가는 가닥: 시작을 조금 잘라(a, b) 뿌리 쪽이 덜 뾰족하게, p가 작을수록 통통하다
  const taper = (w, a, b, p) => (s) => w * Math.pow(Math.sin(Math.PI * Math.min(1, s * a + b)), p);
  // [s0, s1] 구간에만 있는 가는 띠
  const span = (w, s0, s1) => (s) => (s < s0 || s > s1 ? 0 : w * Math.sin((Math.PI * (s - s0)) / (s1 - s0)));

  // ── 굽기: 정적인 머리 한 장 ─────────────────────────────
  // 칠하는 순서: 어두운 바탕 → 다발 몸통(빛 면 가까이는 중간톤) → 가는 결 → 원본에서 잰 중간톤 다발 면
  //   → 윤기 면·결 → 빛 면(어깨색 → 가장 밝은 결은 본색) → 빛 면 위의 어두운 올 → 복숭아빛 심 → 먹선
  //   → 구멍(부드럽게 비움)
  function renderHair(env, D, maps, grid, clip, holes, S) {
    const { W, H } = env;
    const c = env.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rng = env.rng('hair-paint');
    const pats = maps.levels.map((m) => mapPattern(g, m));
    const level = (v) => pats[Math.max(0, Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1))))];
    const off = offSet(env);
    const locks = lockPieces(D, rng, S.nearLit);
    const nearest = pieceIndex(locks, 16);
    const inHole = (x, y) => holes && g.isPointInPath(holes, x, y, 'evenodd');

    g.save();
    g.clip(clip, 'evenodd');

    // 1. 바탕: 가장 어두운 단계. 바깥 가장자리 띠는 비워 둔다 (가닥 끝만 그 위로 나온다)
    g.fillStyle = pats[0];
    g.fill(clip, 'evenodd');
    g.save();
    g.beginPath();
    g.rect(EDGE_BAND + 2, EDGE_BAND + 2, W - 2 * EDGE_BAND - 4, H - 2 * EDGE_BAND - 4); // 그림 테두리는 비우지 않는다
    g.clip();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = EDGE_BAND * 2;
    g.lineJoin = 'round';
    g.stroke(clip);
    g.restore();

    // 2. 다발 몸통: 조각마다 그늘 단계 하나 (빛 면 가까이는 중간톤)
    for (const L of locks) {
      const path = new Path2D();
      addRibbon(path, L.pts, lockWidth(L));
      g.globalAlpha = 0.95;
      g.fillStyle = level(L.v);
      g.fill(path);
    }

    // 3. 가는 결: 놓인 다발의 밝기 둘레 (어두운 다발은 어둡게 남는다)
    for (const flat of D.strands) {
      for (const [a, b] of pieces(flat.length / 2, rng, 16, 60)) {
        if (rng() > STRAND_P || off.has('strand')) continue;
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        if (inHole(m[0], m[1])) continue;
        const li = nearest(m[0], m[1]);
        const lv = li >= 0 ? locks[li].v : 0.2;
        const v = Math.min(1, Math.max(0, lv + (rng() - 0.35) * 0.3));
        const path = new Path2D();
        addRibbon(path, pts, taper(0.5 + rng() * 0.9, 0.85, 0.08, 0.6), (rng() - 0.5) * 3.2);
        g.globalAlpha = 0.85 + 0.15 * rng();
        g.fillStyle = level(v);
        g.fill(path);
      }
    }
    g.globalAlpha = 1;

    // 3b. 중간톤 다발 몸통: 원본에서 잰 셀 그늘의 밝은 쪽 면 (감빛 갈색, 오른쪽은 자줏빛 감).
    //     어두운 바탕 위에 물결진 다발 모양이 드러난다
    if (!off.has('mid')) {
      g.globalAlpha = MID_A;
      g.fillStyle = mapPattern(g, maps.mid);
      g.fill(ringsPath(D.midPlane), 'evenodd');
      g.globalAlpha = 1;
    }

    const planes = ringsPath(D.litPlane);

    // 4. 차가운 반사: 원본에서 잰 보랏빛·파랑 결 모양 (그늘 결에 무대의 푸른빛이 비친 곳)
    if (!off.has('cool')) {
      g.globalAlpha = COOL_A;
      g.fillStyle = mapPattern(g, maps.cool);
      g.fill(ringsPath(D.coolPlane), 'evenodd');
      g.globalAlpha = 1;
    }

    // 5. 윤기: 그늘 안의 조금 밝은 면·결 (원본에서 잰 모양, 한 단계 밝은 그늘색)
    if (!off.has('sheen')) {
      g.fillStyle = mapPattern(g, maps.sheen);
      g.fill(ringsPath(D.sheenPlane), 'evenodd');
      const path = new Path2D();
      D.sheen.forEach((flat, i) => {
        addRibbon(path, slicePts(flat, 0, flat.length / 2), litWidth(D.sheenW[i], 1));
      });
      g.fill(path);
    }

    // 6. 빛 면: 어깨색으로 면 전체, 그 안의 가장 밝은 결(원본에서 잰 litHi 모양)은 본색.
    //    가는 빛 리본은 뿌리가 둥글고 끝 20%만 가늘다
    {
      const lc = env.makeCanvas(W, H);
      const lg = lc.getContext('2d');
      lg.fillStyle = mapPattern(lg, maps.lit[0]);
      lg.fill(planes, 'evenodd');
      const thin0 = new Path2D();
      for (const R of S.thin) addRibbon(thin0, R.pts, litWidth(R.w, 1), 0, true);
      lg.fill(thin0);
      // 안쪽 본색: 원본에서 잰 '가장 밝은 결'(litHi) 모양. 면 안에 가둔다
      const sc = env.makeCanvas(W, H);
      const sg = sc.getContext('2d');
      sg.fillStyle = mapPattern(sg, maps.lit[1]);
      sg.fill(ringsPath(D.litHi), 'evenodd');
      sg.globalCompositeOperation = 'destination-in';
      sg.fill(planes, 'evenodd');
      sg.globalCompositeOperation = 'source-over';
      const thin1 = new Path2D();
      for (const R of S.thin) {
        if (maxOf(R.w) * 0.5 >= 0.9) addRibbon(thin1, R.pts, litWidth(R.w, 0.62), 0, true);
      }
      sg.fillStyle = mapPattern(sg, maps.lit[1]);
      sg.fill(thin1);
      lg.drawImage(sc, 0, 0);
      g.drawImage(lc, 0, 0);
    }

    // 6b. 빛 다발의 올: 빛 면 곁을 지나는 가는 결은 같은 빛으로 (다발 끝이 가닥으로 풀린다).
    //     빛 면 위를 지나는 결은 가끔 어두운 올로 (밝은 면 위에 어두운 가닥 선이 놓인다)
    const litPats = maps.lit.map((m) => mapPattern(g, m));
    for (const flat of D.strands) {
      for (const [a, b] of pieces(flat.length / 2, rng, 10, 40)) {
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        if (inHole(m[0], m[1])) continue;
        let hit = 0;
        for (const q of pts) if (S.nearLit(q[0], q[1], 4)) hit++;
        const la = grid.at(m[0], m[1]);
        const onPlane = g.isPointInPath(planes, m[0], m[1], 'evenodd');
        if (onPlane && rng() < DARK_ON_LIT && !off.has('darkon')) {
          const path = new Path2D();
          addRibbon(path, pts, taper(0.35 + rng() * 0.2, 0.9, 0.05, 0.6), (rng() - 0.5) * 2);
          g.globalAlpha = 0.55 + 0.3 * rng();
          g.fillStyle = rng() < 0.5 ? INK : '#2c1520';
          g.fill(path);
          continue;
        }
        const p = hit / pts.length > 0.3 ? FIBRE_P : 0.02 + 0.05 * la.fill + 0.05 * la.rim;
        if (rng() > p || off.has('fibre')) continue;
        const path = new Path2D();
        addRibbon(path, pts, taper(0.35 + rng() * 0.4, 0.9, 0.05, 0.6), (rng() - 0.5) * 2);
        g.globalAlpha = 0.9;
        g.fillStyle = litPats[hit && rng() < 0.6 ? 1 : 0];
        g.fill(path);
      }
    }

    // 7. 복숭아빛 심: 긴(60px 넘는) 빛 심 곡선의 가운데 구간에만
    g.fillStyle = mapPattern(g, maps.hl);
    for (const R of S.cores.concat(S.thin)) {
      const wMax = maxOf(R.w) * 0.5;
      if (wMax < 1.6 || R.len < CORE_MIN_LEN || rng() > CORE_P || off.has('core')) continue;
      const path = new Path2D();
      const s0 = 0.1 + rng() * 0.2;
      addRibbon(path, R.pts, span(Math.min(1.3, 0.4 + wMax * 0.12), s0, s0 + 0.45 + rng() * 0.25),
        (rng() - 0.5) * wMax * 0.5);
      g.globalAlpha = 0.8 + 0.2 * rng();
      g.fill(path);
    }

    // 8. 먹선: 다발 리본 한쪽 가장자리 (다발 사이 경계) + 원본에서 잰 먹선
    g.fillStyle = INK;
    for (const L of locks) {
      if (rng() > LOCK_INK_P || off.has('lockink')) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const path = new Path2D();
      const s0 = rng() * 0.2;
      const prof = span(0.5 + rng() * 0.8, s0, 0.55 + rng() * 0.45);
      addRibbon(path, L.pts, prof, side * lockWidth(L)(0.4) * 0.85);
      g.globalAlpha = 0.6 + 0.3 * rng();
      g.fill(path);
    }
    D.ink.forEach((flat, i) => {
      const pts = slicePts(flat, 0, flat.length / 2);
      if (pts.length < INK_MIN_PTS || off.has('ink')) return;
      const path = new Path2D();
      addRibbon(path, pts, taper(D.inkW[i] * INK_W * (0.85 + 0.3 * rng()), 0.9, 0.05, 0.5));
      g.globalAlpha = 0.75 + 0.25 * rng();
      g.fill(path);
    });
    g.restore();

    // 8b. 왼쪽 아래로 풀린 다발 끝: 바깥 윤곽을 반투명하게 흐려 가는 끝이 비치게 (상자 안에서만)
    if (!off.has('soft')) {
      for (const [x0, y0, x1, y1, w] of SOFT_EDGE) {
        g.save();
        g.beginPath();
        g.rect(x0, y0, x1 - x0, y1 - y0);
        g.clip();
        g.globalCompositeOperation = 'destination-out';
        g.globalAlpha = 0.55;
        g.filter = 'blur(' + w / 2 + 'px)';
        g.lineWidth = w * 2;
        g.lineJoin = 'round';
        g.strokeStyle = '#000';
        g.stroke(clip);
        g.restore();
      }
    }

    // 9. 구멍: 구멍 모양으로 조금 흐리게 비운다
    if (holes) {
      const cut = env.makeCanvas(W, H);
      const cg = cut.getContext('2d');
      cg.fillStyle = '#000';
      cg.fill(holes, 'evenodd');
      if (HOLE_SHRINK > 0) {
        cg.globalCompositeOperation = 'destination-out';
        cg.lineWidth = HOLE_SHRINK * 2;
        cg.lineJoin = 'round';
        cg.stroke(holes);
      }
      g.globalCompositeOperation = 'destination-out';
      g.filter = 'blur(' + HOLE_BLUR + 'px)';
      g.drawImage(cut, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    return { canvas: c, locks };
  }

  // 곡선 점들의 격자 색인: (x, y)에서 r 안에 점이 있는지
  function pointIndex(list, cell) {
    const grid = new Map();
    for (const R of list) {
      for (const [x, y] of R.pts) {
        const k = Math.floor(x / cell) * 1024 + Math.floor(y / cell);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(x, y);
      }
    }
    return (x, y, r) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          const arr = grid.get(i * 1024 + j);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k += 2) {
            if ((arr[k] - x) * (arr[k] - x) + (arr[k + 1] - y) * (arr[k + 1] - y) < r * r) return true;
          }
        }
      }
      return false;
    };
  }

  // 디버그: hairoff=sheen,veil,… 로 단계를 끈다
  function offSet(env) {
    return new Set((env.params.get('hairoff') || '').split(','));
  }

  function maxOf(a) {
    let m = 0;
    for (const v of a) m = Math.max(m, v);
    return m;
  }

  // 잰 반폭(2배 정수, 점마다)을 s(0..1)에서 보간해 k배. 뿌리는 그대로(둥근 마개를 따로 씌운다),
  // 끝 20%에서만 가늘어진다
  function litWidth(w2, k) {
    const n = w2.length;
    return (s) => {
      const f = s * (n - 1);
      const i = Math.max(0, Math.min(n - 1, Math.floor(f)));
      const j = Math.min(n - 1, i + 1);
      const t = Math.max(0, Math.min(1, f - i));
      const w = ((w2[i] * (1 - t) + w2[j] * t) / 2) * k;
      return s > 0.8 ? w * Math.pow((1 - s) / 0.2, 0.8) : w;
    };
  }

  // 흩날리는 끝: 바깥 배경에 닿은 가닥 끝을 결 방향 그대로 이어 늘인 매끈한 곡선 (매 프레임 흔든다).
  // 휨은 1/80px 이하로 한 방향으로만, 긴 것은 천천히 아래로 쓸려 내려간다 (꺾이거나 되돌아오지 않는다)
  function looseEnds(D, rng, grid) {
    const out = [];
    for (let si = 0; si < D.strands.length; si++) {
      const f = +D.open[si];
      if (!f) continue;
      const flat = D.strands[si];
      const n = flat.length / 2;
      for (const end of [1, 2]) {
        if (!(f & end) || n < 4 || rng() > 0.8) continue;
        const base = end === 1 ? slicePts(flat, n - 4, n) : slicePts(flat, 0, 4).reverse();
        const q = base[3];
        let ang = Math.atan2(q[1] - base[0][1], q[0] - base[0][0]);
        const la = grid.at(q[0], q[1]);
        // 역광이 센 가장자리일수록 길게, 가끔 30~150px의 긴 잔머리로
        const long = la.rim > 0.4 && rng() < LONG_P;
        const len = long ? 30 + rng() * 120 : 8 + rng() * (24 + LOOSE_LEN * la.rim);
        const bend = (rng() - 0.5) * 2 * MAX_CURL;
        const pts = base.slice();
        let x = q[0];
        let y = q[1];
        let turned = 0;
        for (let d = 4; d <= len; d += 4) {
          // 긴 것은 아래(중력) 쪽으로 쓸리게: 아래를 향할 때까지만 같은 방향으로 휜다
          let c = bend;
          if (long) {
            const toDown = Math.atan2(Math.sin(Math.PI / 2 - ang), Math.cos(Math.PI / 2 - ang));
            c = Math.max(-MAX_CURL, Math.min(MAX_CURL, toDown * 0.04 + bend * 0.5));
          }
          if (Math.abs(turned + c) > 1.1) c = 0;
          turned += c;
          ang += c;
          x += Math.cos(ang) * 4;
          y += Math.sin(ang) * 4;
          pts.push([x, y]);
        }
        out.push({
          pts,
          lit: long || rng() < 0.25 + 0.6 * Math.max(la.rim, la.fill),
          w: long ? 0.4 + rng() * 0.3 : 0.3 + rng() * 0.3,
          a: long ? 0.6 + 0.3 * rng() : 1,
          ph: rng() * TAU,
          sp: 0.7 + rng() * 0.9,
          amp: 1 + rng() * 2.5,
        });
      }
    }
    return out;
  }


  // 구멍 고리 → 점·넓이·무게중심·경로
  function holeInfo(r) {
    const pts = slicePts(r, 0, r.length / 2);
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const c = x0 * y1 - x1 * y0;
      a += c;
      cx += (x0 + x1) * c;
      cy += (y0 + y1) * c;
    }
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) path.lineTo(p[0], p[1]);
    path.closePath();
    return { pts, area: Math.abs(a / 2), c: a ? [cx / (3 * a), cy / (3 * a)] : pts[0], path };
  }

  // 구멍 테: 고리 점마다 '구멍 안쪽 방향'이 빛 쪽을 볼수록 굵게 (빛을 받는 다발 가장자리), 머리 쪽으로 반폭만큼 비켜
  function addHoleRim(path, h, w) {
    const n = h.pts.length;
    if (n < 4) return;
    const dir = (p) => LIGHT_DIR.find(([x0, y0, x1, y1]) => p[0] >= x0 && p[0] < x1 && p[1] >= y0 && p[1] < y1);
    const L = dir(h.c) || LIGHT_DIR[0];
    const ll = Math.hypot(L[4], L[5]) || 1;
    const f = h.pts.map((p) => {
      const dx = h.c[0] - p[0];
      const dy = h.c[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      return Math.max(0, (dx * L[4] + dy * L[5]) / (d * ll));
    });
    // 빛이 0인 점에서 시작하는 열린 곡선으로 (양 끝 폭 0)
    let k0 = 0;
    for (let i = 1; i < n; i++) if (f[i] < f[k0]) k0 = i;
    const pts = [];
    const ws = [];
    for (let j = 0; j <= n; j++) {
      const i = (k0 + j) % n;
      const p = h.pts[i];
      const dx = h.c[0] - p[0];
      const dy = h.c[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      const wi = w * Math.pow(f[i], 1.5);
      pts.push([p[0] - (dx / d) * (wi * 0.5), p[1] - (dy / d) * (wi * 0.5)]);
      ws.push(wi * 0.5);
    }
    addRibbon(path, pts, (s) => ws[Math.min(n, Math.round(s * n))]);
  }

  // 곡선을 결에 수직으로 사인 물결만큼 비튼다 (진폭 amp px, 파장 lam px, 위상 ph)
  function wobble(pts, amp, lam, ph) {
    const n = pts.length;
    let d = 0;
    return pts.map((p, i) => {
      if (i > 0) d += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const o = amp * Math.sin((d / lam) * TAU + ph);
      return [p[0] - ((b[1] - a[1]) / tl) * o, p[1] + ((b[0] - a[0]) / tl) * o];
    });
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

  // 피부 위로 걸친 머리를 가는 가닥으로 그리기 (앞 장 위에)
  //   1) 비침 구역(D.veil: 아래 팔뚝·허리): 덩어리 없이 결을 따라 어두운 가는 가닥만 → 피부가 그 사이로 보인다
  //   2) 베일 상자: 목 둘레는 앞 머리 경계 띠를 덩어리 대신 촘촘한 가는 가닥으로, 얼굴 둘레는
  //      경계에서 끝나는 결의 끝을 피부 쪽으로 늘여 경계를 가닥 끝으로 푼다. 빛 쪽 가닥은 한쪽에 연어빛 테
  //   3) 손으로 잰 몇 가닥 (이마를 가로지르는 가닥, 귀를 덮는 가닥)
  function veilFront(env, D, front, frontPath, maps, grid) {
    const g = front.getContext('2d');
    const rng = env.rng('hair-veil');
    const rim = mapPattern(g, maps.lit[1]);
    const dark = [1, 2].map((k) => mapPattern(g, maps.levels[k]));
    const darkStyle = () => {
      const r = rng();
      return r < 0.3 ? INK : r < 0.5 ? HAIR_LINE : dark[r < 0.8 ? 0 : 1];
    };
    const strand = (pts, prof, off, lit) => {
      if (lit) {
        const p = new Path2D();
        addRibbon(p, pts, (s) => prof(s) + 0.5, off - 0.6);
        g.fillStyle = rim;
        g.fill(p);
      }
      const path = new Path2D();
      addRibbon(path, pts, prof, off);
      g.fillStyle = darkStyle();
      g.fill(path);
    };

    // 1) 비침 구역(팔뚝·허리): 생성기가 이 구역을 보통 머리처럼 앞 장에 넣고 원본에서 잰 피부 틈만 비웠다.
    //    여기서는 그 틈을 건너는 물결진 가는 가닥 몇 올만 더한다
    const veil = ringsPath(D.veil);
    const thinIn = [];
    for (const flat of D.strands) {
      for (const [a, b] of pieces(flat.length / 2, rng, 10, 30)) {
        const pts = slicePts(flat, a, b);
        const m = pts[pts.length >> 1];
        if (g.isPointInPath(veil, m[0], m[1], 'evenodd')) thinIn.push(pts);
      }
    }
    for (let k = 0; k < SEE_N && thinIn.length; k++) {
      const pts = thinIn.splice(Math.floor(rng() * thinIn.length), 1)[0];
      const wavy = wobble(pts, 2, 70, rng() * TAU);
      strand(wavy, taper(0.4 + rng() * 0.4, 0.9, 0.05, 0.5), (rng() - 0.5) * 2, false);
    }

    // 2) 베일 상자: 앞 머리의 경계 띠(반경 r)를 깎고, 그 띠를 결을 따라 촘촘한 가는 가닥으로 다시 덮는다.
    //    상자 가장자리로 갈수록 깎는 반경을 줄여 계단이 생기지 않게 한다
    const { W, H } = env;
    const m = env.makeCanvas(W, H);
    const mg = m.getContext('2d');
    mg.fillStyle = '#000';
    mg.fillRect(0, 0, W, H);
    mg.globalCompositeOperation = 'destination-out';
    mg.lineJoin = 'round';
    for (const [x0, y0, x1, y1, r] of VEILS) {
      for (let k = r; k >= 2; k -= 1) { // r = 0이면 건너뛴다
        const inset = (r - k) * 2;
        mg.save();
        mg.beginPath();
        mg.rect(x0 - r + inset, y0 - r + inset, x1 - x0 + 2 * (r - inset), y1 - y0 + 2 * (r - inset));
        mg.clip();
        mg.lineWidth = k * 2;
        mg.stroke(frontPath);
        mg.restore();
      }
    }
    const alpha = mg.getImageData(0, 0, W, H).data;
    const inBand = (x, y) => {
      const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
      const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
      return alpha[(yi * W + xi) * 4 + 3] < 128 && g.isPointInPath(frontPath, x, y, 'evenodd');
    };
    g.globalCompositeOperation = 'destination-in';
    g.filter = 'blur(0.7px)';
    g.drawImage(m, 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    // 반경 0인 상자(얼굴 둘레)는 깎지 않는다: 얼굴과 귀 사이의 가는 머리띠가 통째로 사라지므로.
    // 대신 앞 머리 경계에서 끝나는 결의 끝을 피부 쪽으로 몇 px 늘여 경계를 가닥 끝으로 푼다
    const inFringe = (x, y) =>
      VEILS.some(([x0, y0, x1, y1, r]) => !r && x > x0 && x < x1 && y > y0 && y < y1);
    for (const flat of D.strands) {
      for (const [a, b] of pieces(flat.length / 2, rng, 6, 24)) {
        let pts = slicePts(flat, a, b);
        const n = pts.length;
        const q = pts[n >> 1];
        const la = grid.at(q[0], q[1]);
        const lit = la.warm + la.pink > 0.4 && rng() < 0.5;
        const prof = taper(VEIL_W[0] + rng() * VEIL_W[1], 1, 0.05, 0.5);
        if (inBand(q[0], q[1])) {
          if (rng() < VEIL_P) strand(pts, prof, (rng() - 0.5) * 2.4, lit);
          continue;
        }
        const e = pts[n - 1];
        if (n < 3 || !inFringe(e[0], e[1]) || rng() > FRINGE_P) continue;
        const p = pts[n - 2];
        const l = Math.hypot(e[0] - p[0], e[1] - p[1]) || 1;
        const dx = (e[0] - p[0]) / l;
        const dy = (e[1] - p[1]) / l;
        if (g.isPointInPath(frontPath, e[0] + dx * 5, e[1] + dy * 5, 'evenodd')) continue; // 경계에서 끝나는 결만
        const ext = FRINGE_EXT[0] + rng() * FRINGE_EXT[1];
        pts = pts.concat([
          [e[0] + dx * ext * 0.5, e[1] + dy * ext * 0.5],
          [e[0] + dx * ext, e[1] + dy * ext],
        ]);
        strand(pts, prof, (rng() - 0.5) * 2, lit);
      }
    }

    // 2b) 목 왼쪽 다발 끝: 앞 머리 경계에서 끝나는 결을 결 방향으로 40~120px 늘여 뾰족하게 (뭉툭한 가로 경계 대신
    //     S자로 휘며 가늘어지는 다발 끝 여러 개). 넷에 하나는 빛 쪽에 연어빛 테
    const tipRim = mapPattern(g, maps.lit[0]);
    for (const flat of D.strands) {
      const n = flat.length / 2;
      if (n < 5) continue;
      const e = [flat[2 * n - 2], flat[2 * n - 1]];
      const box = TIPS.find(([x0, y0, x1, y1]) => e[0] > x0 && e[0] < x1 && e[1] > y0 && e[1] < y1);
      if (!box || rng() > TIP_P) continue;
      const p = [flat[2 * n - 10], flat[2 * n - 9]];
      const l = Math.hypot(e[0] - p[0], e[1] - p[1]) || 1;
      let ang = Math.atan2(e[1] - p[1], e[0] - p[0]);
      if (Math.sin(ang) < 0.3) continue; // 아래로 흘러내리는 결만
      const len = 40 + rng() * 80;
      const lam = 50 + rng() * 40;
      const ph = rng() * TAU;
      const pts = [p, e];
      let x = e[0];
      let y = e[1];
      for (let d = 4; d <= len; d += 4) {
        ang += 0.035 * Math.cos((d / lam) * TAU + ph);
        x += Math.cos(ang) * 4;
        y += Math.sin(ang) * 4;
        pts.push([x, y]);
      }
      const w0 = 1 + rng() * 0.6;
      const hw = (s) => w0 * Math.pow(1 - s, 0.9);
      if (rng() < 0.25) {
        const rimP = new Path2D();
        addRibbon(rimP, pts, (s) => hw(s) + 0.4, -0.7);
        g.fillStyle = tipRim;
        g.fill(rimP);
      }
      const path = new Path2D();
      addRibbon(path, pts, hw);
      g.fillStyle = darkStyle();
      g.fill(path);
    }

    // 3) 손으로 잰 가닥. 이마 가닥은 가르마에서 내려와 왼쪽으로 휘어 눈썹 아래 가장자리를 따라가는 C자 곡선
    //    (빛을 받은 회갈색, 가운데 밝은 심)
    {
      const pts = [];
      for (let i = 0; i < FOREHEAD.length; i += 2) pts.push([FOREHEAD[i], FOREHEAD[i + 1]]);
      const curve = new Path2D(env.core.smoothPath(pts, false, 0.5));
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = '#7a5a4c';
      g.lineWidth = 1.2;
      g.stroke(curve);
      g.strokeStyle = '#c89a88';
      g.lineWidth = 0.5;
      g.stroke(curve);
      g.restore();
    }
    for (const line of VEIL_LINES) {
      const pts = [];
      for (let i = 0; i < line.length; i += 2) pts.push([line[i], line[i + 1]]);
      const smooth = new Path2D(env.core.smoothPath(pts, false, 0.5));
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = VEIL_LINE;
      g.lineWidth = 0.9;
      g.stroke(smooth);
      g.restore();
    }
  }

  function clipTo(env, src, path) {
    const c = env.makeCanvas(env.W, env.H);
    const g = c.getContext('2d');
    g.save();
    g.clip(path, 'evenodd');
    g.drawImage(src, 0, 0);
    g.restore();
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

      // 그늘 단계별 색 지도 + 빛 다발(어깨·본색) + 하이라이트 심 + 잔머리
      const levels = [];
      for (let k = 0; k < LEVELS; k++) {
        const v = k / (LEVELS - 1);
        levels.push(makeMap(env, grid, (L) => shade(L, v, ramps)));
      }
      const maps = {
        levels,
        lit: [0, 1].map((tier) => makeMap(env, grid, (L) => litShade(L, tier, ramps))),
        sheen: makeMap(env, grid, (L) => litShade(L, 3, ramps)),
        // 심: 연어빛 구역은 복숭아·흰빛, 자홍 구역은 연분홍. 빛이 약한 그늘에서는 보랏빛으로
        hl: makeMap(env, grid, (L) => {
          const k = Math.max(L.rim, L.fill);
          const vk = Math.min(1, L.violet * 1.1) * (1 - k);
          return mix3(litShade(L, 2, ramps), rampAt(ramps.violet, 0.72), vk);
        }),
        // 잔머리: 테두리빛 산호·분홍 (흰빛이 아니라 빛 램프의 0.66~0.8)
        fly: makeMap(env, grid, (L) => {
          const b = Math.min(1, 0.4 + Math.max(L.rim, L.fill));
          return tint({ ...L, violet: 0, blue: 0 }, 0.66 + 0.14 * b, ramps, 4);
        }),
        // 틈을 건너는 빛 가닥: 분홍 램프 쪽으로 (구멍 속 무대 자홍빛과 어울리게)
        gap: makeMap(env, grid, (L) => {
          const b = Math.min(1, 0.4 + Math.max(L.rim, L.fill));
          return tint({ ...L, pink: Math.max(L.pink, 0.6), violet: 0 }, 0.72 + 0.14 * b, ramps, 4);
        }),
        // 차가운 반사: 보랏빛 (#441b64 → #5a3a8a), 파란 빔 구역은 파랑
        cool: makeMap(env, grid, (L) => {
          const u = 0.4 + 0.12 * Math.max(L.rim, L.fill);
          return mix3(rampAt(ramps.violet, u), rampAt(ramps.blue, u + 0.08), Math.min(1, L.blue * 1.2));
        }),
        // 빛 면 둘레의 중간톤 (감빛 갈색, 오른쪽은 자줏빛 감)
        mid: makeMap(env, grid, (L) =>
          tint(L, Math.min(0.5, 0.4 + 0.05 * Math.max(L.rim, L.fill) - 0.06 * L.dark), ramps, 2.5)),
      };
      tick('maps');

      // 원본에서 잰 빛 면의 심 곡선과 가는 빛 리본 (+ 길이), 가까운 빛 판정용 점 색인
      const curve = (flat, w) => {
        const pts = slicePts(flat, 0, flat.length / 2);
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
          len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        }
        return { pts, w, len };
      };
      const S = {
        cores: D.litCore.map((f, i) => curve(f, D.litCoreW[i])),
        thin: D.lit.map((f, i) => curve(f, D.litW[i])),
      };
      S.nearLit = pointIndex(S.cores.concat(S.thin, D.litPlane.map((r) => curve(r, null))), 12);

      const silPath = ringsPath(D.sil);
      const holesPath = ringsPath(D.holes);
      const backPath = env.params.get('hairext') === '0' ? silPath : ringsPath(D.back);
      const { canvas: hair } = renderHair(env, D, maps, grid, backPath, holesPath, S);
      tick('render');

      // 디버그: hairmap=k 이면 k번째 그늘 단계 지도(또는 hl, fly, lit0/lit1, 조명 값)를 실루엣에 칠해 본다
      const dbg = env.params.get('hairmap');
      if (dbg !== null) {
        const g = hair.getContext('2d');
        g.save();
        g.clip(silPath);
        const gray = (k) => makeMap(env, grid, (L) => [L[k] * 255, L[k] * 255, L[k] * 255]);
        const named = Array.isArray(maps[dbg]) ? null : maps[dbg];
        const m = named || (dbg.startsWith('lit') ? maps.lit[+dbg[3] || 0] : levels[+dbg]) || gray(dbg);
        g.fillStyle = mapPattern(g, m);
        g.fillRect(0, 0, env.W, env.H);
        g.restore();
      }

      // 일렁이는 테두리빛: 바깥 가장자리 띠에 가장 밝은 결 색을 깔아 둔 한 장 (알파만 시간에 따라)
      const glow = env.makeCanvas(env.W, env.H);
      {
        const g = glow.getContext('2d');
        g.drawImage(hair, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = mapPattern(g, maps.hl);
        g.fillRect(0, 0, env.W, env.H);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(makeMap(env, grid, (L) => [0, 0, 0, Math.round(255 * L.rim * (1 - smooth(4, 30, L.d)))]),
          0, 0, env.W, env.H);
      }

      const rngA = env.rng('hair-anim');
      const rngF = env.rng('hair-fly');
      const fly = D.fly.concat(LOOPS).map((flat) => ({
        pts: slicePts(flat, 0, flat.length / 2),
        w: 0.45 + rngF() * 0.5,
        a: 0.75 + rngF() * 0.25,
        ph: rngF() * TAU,
        sp: 0.6 + rngF() * 0.8,
        amp: 1.5 + rngF() * 2.5,
      }));
      // 앞 장: 몸·얼굴 위로 다시 덮는 머리 + 다발 사이 틈을 건너는 가는 가닥 (불투명, 끝이 가늘게).
      // 어두운 가닥과 빛 받는 가닥이 그물처럼 엇갈린다
      const off = offSet(env);
      const frontPath = ringsPath(D.front);
      const front = clipTo(env, hair, frontPath);
      if (!off.has('veil')) veilFront(env, D, front, frontPath, maps, grid);
      {
        const g = front.getContext('2d');
        const rngG = env.rng('hair-gap');
        // 구멍 가장자리의 빛: 빛을 향한 쪽에만 2~4px 산호빛 테 (양 끝은 0으로 가늘어져 고리가 닫히지 않는다)
        const holes = D.holes.map((r) => holeInfo(r));
        if (!off.has('rim')) {
          g.fillStyle = mapPattern(g, maps.lit[0]);
          const path = new Path2D();
          for (const h of holes) if (h.area > 150) addHoleRim(path, h, RIM_W[0] + rngG() * RIM_W[1]);
          g.globalAlpha = 0.9;
          g.fill(path);
          g.globalAlpha = 1;
        }
        // 틈 가닥: 활처럼 휜 물결(진폭 3~6px). 대부분 분홍·산호빛 반투명, 일부만 어두운 선.
        // 구멍 하나에는 3~6올만 (촘촘한 빗살이 되지 않게), 구멍 밖 틈은 GAP_P 확률로
        const gapLit = mapPattern(g, maps.gap);
        const perHole = holes.map(() => 3 + Math.floor(rngG() * 4));
        for (const flat of D.gap) {
          const pts0 = slicePts(flat, 0, flat.length / 2);
          const m = pts0[pts0.length >> 1];
          const hi = holes.findIndex((h) => h.area > 150 && g.isPointInPath(h.path, m[0], m[1]));
          if (hi >= 0) {
            if (perHole[hi] <= 0) continue;
            perHole[hi]--;
          } else if (rngG() > GAP_P) continue;
          const pts = wobble(pts0, (3 + rngG() * 3) * (rngG() < 0.5 ? -1 : 1), 70 + rngG() * 50, 0);
          const dark = rngG() < GAP_DARK;
          const path = new Path2D();
          addRibbon(path, pts, taper(GAP_W[0] + rngG() * GAP_W[1], 0.9, 0.05, 0.6));
          g.globalAlpha = dark ? 0.9 : 0.5 + rngG() * 0.2;
          g.fillStyle = dark ? (rngG() < 0.5 ? INK : HAIR_LINE) : gapLit;
          g.fill(path);
        }
        g.globalAlpha = 1;
      }

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
        front,
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
      const pats = [mapPattern(ctx, st.maps.levels[1]), mapPattern(ctx, st.maps.fly)];
      for (const f of st.loose) {
        const path = new Path2D();
        addRibbon(path, sway(f.pts, f, t), (s) => f.w * Math.pow(1 - s, 0.8));
        ctx.globalAlpha = f.a;
        ctx.fillStyle = pats[f.lit ? 1 : 0];
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    },

    drawFront(ctx, st, t) {
      ctx.drawImage(st.front, 0, 0);
      // 무대 조명에 맞춰 테두리빛이 잠깐씩 밝아진다 (t=0이면 0)
      const wob = 0.6 * (Math.sin(t * 0.43 + st.glowPh) - Math.sin(st.glowPh));
      const pulse = 0.5 - 0.5 * Math.cos(t * 1.7 + wob);
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
        addRibbon(path, sway(f.pts, f, t), (s) => f.w * Math.min(1, s * 8 + 0.3) * (1 - 0.75 * s));
        ctx.globalAlpha = f.a;
        ctx.fill(path);
      }
      // 잔머리: 뿌리는 고정, 끝으로 갈수록 크게 흔들린다
      ctx.fillStyle = mapPattern(ctx, st.maps.fly);
      for (const f of st.fly) {
        const path = new Path2D();
        addRibbon(path, sway(f.pts, f, t), taper(f.w, 0.9, 0.1, 0.5));
        ctx.globalAlpha = f.a;
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    },
  };
})();
