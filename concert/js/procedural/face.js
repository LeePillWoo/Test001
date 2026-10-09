// 절차적 드로잉 레이어: face — 머리카락을 뺀 머리 전부.
// 피부(셀 음영·볼터치·윤곽 림), 귀와 인이어·귀걸이, 눈, 눈썹, 코, 웃는 입, 선화.
// 윤곽 다각형은 data/face.js(tools/proc_face.py가 원본에서 잰 좌표), 세부 기하는 아래 상수(손으로 잰 좌표).
// 색은 모두 팔레트 상수에서 오고, 그라디언트·띠·림 규칙으로 칠한다. 정적인 얼굴은 prepare에서 한 장에 굽고,
// 프레임마다 반짝이(귀걸이·콧등·눈동자 빛)만 얹는다.
// 머리카락 레이어가 앞머리 영역(P.hairData.front)을 주면, 숨은 가장자리의 피부를 그 밑으로 넉넉히 넓혀 틈을 막는다.
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});

  // ── 팔레트 ─────────────────────────────────────────────
  const PAL = {
    skin: '#fdd5c1',
    skinLit: '#fedcc6',
    skinCoral: '#f3968b',
    skinPink: '#fbc1b5',
    skinWarm: '#f6a39b',
    skinShade: '#f3b0a5',
    rimLight: '#fff3ea',
    jawRim: '#f9a69e',
    hairShade: '#ef937e',
    jawStep: '#d27a6e',
    blush: '#f9a6a2',
    hatch: '#ea7f86',
    line: '#2c121a',
    lineRed: '#b8545b',
    lash: '#130810',
    lashRoot: '#6b5566',
    sclera: '#faf4f4',
    scleraShade: '#c7a2b3',
    iris: '#1c0b15',
    irisDeep: '#5c1520',
    irisMid: '#a0202e',
    irisLow: '#d83c4c',
    irisGlow: '#f0646a',
    crease: '#a63a42',
    creasePink: '#f0948a',
    pupil: '#12060b',
    brow: '#93605d',
    browDark: '#6f4241',
    nostril: '#9c2a37',
    noseHl: '#fff6ec',
    lip: '#fb8f95',
    lipLight: '#fdaab0',
    lipDark: '#e0727c',
    lipEdge: '#c9505d',
    mouthDark: '#5a1f2a',
    mouthMid: '#c4545f',
    tongue: '#fb8c91',
    tongueLight: '#fd9fa2',
    teeth: '#fdf4f2',
    teethShade: '#d9c6cc',
    teethLine: '#e6d8e0',
    gum: '#e0647a',
    ear: '#ec9082',
    earDeep: '#c64a52',
    earShadow: '#7a2a32',
    earDark: '#1c0c14',
    earLight: '#f7ae9c',
    monLight: '#aea6c2',
    monMid: '#8a809e',
    monDeep: '#5a5070',
    silver: '#dcdaea',
    silverMid: '#9c98b2',
    metalDeep: '#585274',
    metalDark: '#1f1828',
    white: '#ffffff',
  };

  // ── 손으로 잰 기하 (원본 픽셀) ─────────────────────────────
  // 눈: 화면 왼쪽(0), 오른쪽(1). 점 목록은 바깥 눈꼬리 → 안쪽 눈머리 순서.
  const EYES = [
    {
      // 속눈썹 띠의 위쪽 가장자리와 아래쪽 가장자리. 둘 다 날개 끝에서 시작해 눈머리에서 만난다.
      top: [[780, 243.6], [790, 241.2], [800, 236], [807, 231], [815, 227.4], [827, 223], [840, 221.2],
        [851, 222.2], [858, 224.6], [863.2, 229.6], [866.8, 236.4], [869.2, 244.4], [871, 251],
        [872.5, 255.5]],
      bot: [[780, 244.4], [792, 245.3], [801, 246.4], [806.5, 247.4], [809, 243.4], [813, 240], [817, 237.2],
        [821, 234.6], [826, 232.2], [833, 230.8], [842, 230.4], [852, 231.2], [859.5, 235], [863.5, 240.3],
        [866.6, 245], [869.2, 249.6], [871.2, 253.2], [872.5, 255.5]],
      open: 3, // bot에서 눈 트임이 시작하는 점(바깥 눈꼬리)
      lowerExt: [[784, 246.5], [796, 247], [807, 248]],
      lower: [[807, 247.5], [815, 249.6], [827, 251], [840, 251.6], [852, 253], [862, 254.6],
        [868, 255.4], [872.5, 255.5]],
      iris: [842.5, 242.6, 18.6],
      pupil: [844.6, 244.4, 6.6],
      // 쌍꺼풀 선은 눈머리 쪽 끝에만 보인다
      crease: [[846, 218.6], [853, 219.6], [859, 221.8], [864.2, 225], [868.4, 229.4], [871.2, 234.6],
        [872.6, 240.5], [872.8, 246]],
      creaseGlow: [866, 227, 10, 7],
      // 위 속눈썹 가닥: 뿌리 x, y, 끝 x, y, 굵기
      spikes: [[825, 223.5, 818, 215.5, 1.8], [834, 222, 831.5, 213.5, 1.7], [845.5, 221.5, 846.5, 214.5, 1.7],
        [811, 229, 804.5, 225, 1.7], [804, 233, 795.5, 230, 1.6], [797, 237.5, 788, 236, 1.4],
        [790, 240.5, 781, 240, 1.2], [856, 223.5, 860, 217.5, 1.2]],
      lowLashes: [[812, 250, 810, 253.5, 0.7], [866, 255.5, 867.5, 258.5, 0.7]],
      // 하이라이트: 지름이 다른 타원 몇 개를 합친 덩어리 (cx, cy, rx, ry, 기울기)
      hl: [[841.8, 236.6, 6.2, 2.7, -0.08], [838.6, 238.6, 2.6, 1.9, 0.3], [846.2, 235.6, 2.4, 1.7, 0],
        [843.5, 234.9, 2.8, 1.2, 0]],
      hlDots: [[844.6, 242.2, 1.4], [851, 240.6, 1.8]],
      hlStreaks: [[[824, 243.4], [831.5, 242.2], 1.5], [[857, 249.5], [861, 247], 1.2]],
      // 홍채 오른쪽 위로 비치는 자줏빛 반사 (cx, cy, rx, ry, 색, 불투명도)
      sheen: [854.5, 240.5, 3.2, 6.5, '#5a2442', 0.75],
      bag: [[828, 259.5], [840, 260.2], [851, 259.5]],
    },
    {
      top: [[1017, 292], [1016, 283], [1014, 272], [1009.5, 262.5], [1002.5, 257], [995, 253],
        [985, 250.5], [972.5, 249.8], [963, 250.8], [957.5, 253.6], [952.4, 257.8], [947.6, 262.2],
        [944.2, 265.8], [941.5, 269]],
      bot: [[1017, 292], [1011, 289.5], [1008, 287.4], [1004.5, 279.6], [1000.5, 272], [996, 267.6],
        [991, 263], [985, 260], [972, 258.8], [962, 258.6], [957.4, 258.2], [954, 260.4], [950.6, 263],
        [947, 265.6], [944, 267.6], [941.5, 269]],
      open: 2,
      lower: [[1008, 287.6], [1004, 287], [997, 285.6], [990, 283.4], [984, 281], [978, 279], [966, 275],
        [954, 273], [941.5, 269.5]],
      iris: [972.8, 269.6, 17.6],
      pupil: [972, 269.2, 6.4],
      crease: [[1006, 259.4], [1001, 255], [995.5, 250.9], [990, 247.6], [984, 245.3], [976, 244.3],
        [967, 244.5], [960, 245.9], [955.5, 248.1], [951, 251.6]],
      creaseGlow: null,
      spikes: [[970, 250, 970.5, 245.5, 1.4], [980.5, 250, 980.5, 244.5, 1.4], [986, 250.5, 991, 237.5, 1.8],
        [995.5, 252.5, 1003, 247.5, 1.5], [1003, 257, 1016, 258, 2.6], [1009, 264, 1024, 267.5, 3],
        [1012, 273, 1027.5, 279, 3], [1013, 282, 1027, 290.5, 2.6], [1011, 288, 1019, 295, 1.6]],
      lowLashes: [[1003, 286.6, 1005, 290.8, 0.7]],
      hl: [[970.8, 261.6, 5.8, 2.4, -0.06], [968.6, 263.4, 2.6, 1.6, 0.4], [975.4, 261, 2.4, 1.7, 0],
        [968.5, 260.6, 2.8, 1.3, 0]],
      hlDots: [[972.8, 267.6, 1.4], [984.6, 268.4, 1.1]],
      hlStreaks: [[[956.6, 265.6], [960.4, 264.8], 1.6], [[982.5, 275.4], [989, 277.6], 1.5]],
      sheen: [988.6, 265.6, 2.4, 5, '#c9a2b8', 0.75],
      bag: [[948, 278], [960, 281.2], [972, 283]],
    },
  ];

  // 눈썹: 위·아래 가장자리(같은 방향), 털이 흩어지는 끝(fan: 0 앞, 1 뒤)과 그쪽의 굵은 털 가닥
  const BROWS = [
    {
      top: [[815, 193], [822, 189.5], [830, 187.5], [840, 187], [850, 187.5], [860, 189], [868, 191],
        [875, 193.5], [882, 197], [888, 201], [893, 205]],
      bot: [[815, 198], [822, 197], [830, 196], [840, 195.5], [850, 195.6], [860, 196.5], [868, 198.5],
        [876, 201], [883, 203.5], [889, 205.5], [893, 205]],
      fan: 1,
      hairs: [[866, 192, 884, 201], [870, 193, 889, 203.5], [874, 194.5, 892, 206], [878, 196, 895, 208.5],
        [882, 198.5, 897, 210.5], [871, 196.5, 886, 204.5], [886, 199.5, 899, 208]],
    },
    {
      top: [[940, 219], [945, 214], [951, 210.5], [960, 209], [970, 210], [980, 212.5], [990, 216.5],
        [1000, 221], [1010, 227.5], [1018, 234]],
      bot: [[940, 219], [946, 219.5], [952, 219.5], [960, 219.2], [970, 219.2], [980, 221], [990, 224.5],
        [1000, 229], [1010, 234], [1018, 239.5]],
      fan: 0,
      hairs: [[938.5, 220.5, 947.5, 209.5], [942.5, 221, 952, 209], [946.5, 221, 956.5, 208.8],
        [950.5, 220.5, 961, 209], [954.5, 220.5, 965, 209.5], [936, 218, 943, 211.5]],
    },
  ];

  const NOSE = {
    nostrils: [
      [[[881.5, 305], [886.2, 300.8], [891.5, 302.8]], 2.6],
      [[[907.5, 306], [911.6, 304.3], [917.5, 310.5]], 3.1],
    ],
    glitter: [[902.5, 259], [904.8, 262.4], [911.8, 264.2], [915.8, 266.4], [920.2, 268.6]],
    mark: [[[906.5, 284], [911.5, 279.5]], [[909, 281.5], [913, 283]]],
    dot: [903, 286.5, 1.2],
  };

  const MOUTH = {
    // 입술 바깥 윤곽(왼쪽 입꼬리에서 시계 방향)
    lips: [[827, 343], [834, 337.5], [845, 333.6], [858, 331.8], [872, 331.2], [886, 331.8], [900, 334.2],
      [914, 338.8], [927, 345.5], [938, 354], [946, 361.5], [951, 368.5], [951, 371], [947, 377.5],
      [940.5, 387], [932, 395.5], [920.5, 402.5], [906, 407.6], [890, 410], [875, 409.6], [862.5, 406],
      [852, 400], [843.5, 391.2], [836.5, 380.6], [832.5, 368.5], [830, 355]],
    // 입 안(트임): 윗입술 아래 테두리(왼→오) + 아랫입술 안쪽 테두리(오→왼)
    open: [[826.5, 344], [834, 343.5], [849, 341.4], [870.8, 339.6], [892, 340.8], [908, 344.6], [922, 350.4],
      [936.6, 359.2], [946.6, 367.6], [952, 370.5], [942, 377], [932, 382.6], [921.5, 388], [908, 392.6],
      [892, 394.6], [875, 392.8], [858, 387.8], [845, 380.4], [835.5, 368], [829.5, 355]],
    upperN: 10, // open의 앞 10점이 윗입술 테두리
    tongue: [[836, 371], [842, 366.4], [852, 362.6], [864, 361], [874, 362], [880, 364.5], [886, 363],
      [897, 364.6], [908, 368.8], [919, 374], [928, 379.5], [934, 383.2], [921.5, 388.8], [908, 393.4],
      [892, 395.4], [875, 393.6], [858, 388.6], [845, 381.2]],
    // 윗니: 왼쪽 x, 오른쪽 x, 아래 끝 y, 그늘(0 흰색 ~ 1 회보라)
    teeth: [[835, 840.5, 356, 0.95], [840, 847.5, 357, 0.6], [847, 857.5, 357, 0], [857, 869, 356, 0],
      [869, 885.5, 357.6, 0], [885, 902, 361, 0], [902, 914, 365, 0], [914, 922.5, 369, 0],
      [922, 931, 372.6, 0.1], [930.5, 938.5, 375.5, 0.8]],
    lipHl: [[[858.5, 394.6], [863, 395.8], [868.5, 398.6], [863.5, 398.4]], [[884, 401.2], [888.5, 400.8],
      [893, 401.6], [888.5, 402.8]]],
    underLip: [[866, 408.2], [874, 410.6], [884, 411.2], [892, 410]],
    corners: [[[825, 342.5], [828.5, 346], [831, 352]], [[953.5, 367], [951.5, 371.5], [947.5, 374]]],
  };

  // 오른쪽 잇몸 띠 폭: x에 따른 붓선 굵기(px, 절반은 입술 밑에 숨는다)
  const GUM_W = [[896, 0], [910, 3], [922, 6.5], [932, 10], [946, 12]];

  // 볼터치: 타원(cx, cy, rx, ry, 기울기), 해칭 선(중심 x, y, 길이, 각도°), 흰 반사(다각형)
  const BLUSH = [
    {
      e: [818, 290, 52, 28, -0.12],
      hatch: [[796, 273, 11, 123], [803, 275, 15, 134], [810, 277, 16, 132], [817, 277.5, 15, 128],
        [824, 279, 13, 120], [832, 278.5, 10, 110]],
      glare: [[792.5, 283], [797, 277], [801, 278.5], [796.5, 284.5]],
    },
    {
      e: [998, 312, 40, 28, 0.25],
      hatch: [[964, 306, 7, 104], [971, 309, 12, 93], [979, 311, 15, 78], [987, 313, 14, 70], [993, 313, 11, 68],
        [999, 321, 11, 75]],
      glare: [[996.5, 318], [1000.5, 314.5], [1003, 316], [999, 319.5]],
    },
  ];

  // 귀: 귓바퀴, 안쪽 밝은 면(대이륜·귓불), 귓바퀴 안 붉은 갈색 선, 인이어(셸·검은 노즐), 귀걸이(파베 보석)
  const EARS = [
    {
      // 귓바퀴 오른쪽은 볼 밑으로 넉넉히 들어간다(얼굴이 위에 그려진다)
      shell: [[716, 300], [722, 292], [732, 289], [742, 289], [752, 290], [762, 296], [770, 318],
        [772, 345], [769, 366], [758, 373], [747, 374], [738, 374], [730, 370], [723, 362], [718, 350],
        [715, 335], [714, 318]],
      inner: [[724, 318], [729, 312], [735, 309], [731, 320], [727, 334], [731, 346], [740, 350], [750, 350],
        [758, 352], [760, 364], [752, 370], [741, 370], [731, 364], [724, 352], [721, 336]],
      folds: [[[724, 320], [722, 332], [726, 344], [733, 350]], [[751, 348], [756, 356], [757, 366]]],
      shade: [726, 296, 30, 26],
      monitor: [[742, 312], [746.5, 314], [748, 319], [746.5, 326], [746, 333], [748.5, 339], [749, 343.5],
        [743, 345], [736, 343], [730.5, 337.5], [729.5, 330], [732, 321], [737, 315]],
      glint: [[744, 320], [743, 328], [744, 335]],
      canal: [[748, 310], [752, 313], [755, 320], [753, 328], [754, 336], [756, 343], [750, 345], [748, 338],
        [746, 330], [747, 321]],
      // 귀걸이: 둥근 머리에서 아래로 흘러내리는 물방울 모양
      earring: [[735, 351], [740, 349], [745, 350.5], [747, 355], [746, 361], [743.5, 366], [742, 371],
        [741, 376], [739, 377.5], [737.5, 372], [735.5, 366], [733, 360], [733, 355]],
      drop: [739.5, 379.5, 1.6],
    },
    {
      shell: [[1000, 395], [1003, 375], [1010, 358], [1022, 346], [1036, 345], [1046, 350], [1053, 357],
        [1055, 370], [1052, 386], [1045, 400], [1036, 410], [1028, 416], [1020, 421], [1012, 425],
        [1004, 425], [998, 418], [996, 408]],
      inner: [[1000, 404], [1010, 400], [1022, 401], [1032, 402], [1040, 399], [1036, 408], [1026, 414],
        [1014, 419], [1004, 420], [998, 414]],
      folds: [[[1004, 402], [1016, 398.5], [1030, 400]], [[1026, 362], [1038, 358], [1047, 362]]],
      shade: [1048, 366, 18, 28],
      monitor: [[1026, 369], [1031, 371.5], [1035, 378], [1036, 386], [1035, 394], [1030, 399.5],
        [1023, 400.5], [1018, 398.5], [1019, 392], [1023, 386], [1024.5, 378]],
      glint: [[1031.5, 378], [1033, 386], [1031, 394]],
      canal: [[1006, 394], [1010, 389], [1016, 387], [1021, 389], [1019, 396], [1013, 400], [1007, 400]],
      earring: [[1012, 410], [1018, 407.5], [1024, 409], [1027, 414], [1026.5, 421], [1024, 428],
        [1018, 431.5], [1012, 430], [1008, 424], [1008, 416]],
      drop: null,
    },
  ];

  // ── 도우미 ─────────────────────────────────────────────
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function pairs(flat) {
    const out = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
    return out;
  }

  function polyPath(pts) {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  }

  // Catmull-Rom을 촘촘한 점열로 (가변 굵기 선과 오프셋 계산용)
  function dense(pts, closed, per = 8) {
    const n = pts.length;
    if (n < 2) return pts.slice();
    const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a, b, c, d) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (!closed) out.push(pts[n - 1].slice());
    return out;
  }

  function smoothPath2D(C, pts, closed) {
    return new Path2D(C.smoothPath(pts, closed, 0.5));
  }

  // 가변 굵기 선: wfn(u, i)가 0..1 위치의 굵기를 준다
  function taper(ctx, pts, wfn, per = 8) {
    const d = dense(pts, false, per);
    const n = d.length;
    if (n < 2) return;
    let total = 0;
    const acc = [0];
    for (let i = 1; i < n; i++) {
      total += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]);
      acc.push(total);
    }
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = d[Math.max(0, i - 1)];
      const b = d[Math.min(n - 1, i + 1)];
      let nx = -(b[1] - a[1]);
      let ny = b[0] - a[0];
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const w = wfn(total ? acc[i] / total : 0, i) / 2;
      left.push([d[i][0] + nx * w, d[i][1] + ny * w]);
      right.push([d[i][0] - nx * w, d[i][1] - ny * w]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  // 양 끝이 가는 붓선 (0→peak→0)
  const brush = (w, a = 0.25, b = 0.75, min = 0.15) => (u) => {
    const s = u < a ? u / a : u > b ? (1 - u) / (1 - b) : 1;
    return w * (min + (1 - min) * Math.sqrt(Math.max(0, s)));
  };

  function ellipseGrad(ctx, cx, cy, rx, ry, rot, stops) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // ── 피부 ──────────────────────────────────────────────
  // 조명 구역: 오른쪽 이마·관자놀이·볼 가장자리에 분홍 무대 조명이 산호색으로 번진다
  const CORAL_ZONE = [[972, 95], [1070, 95], [1070, 380], [1032, 380], [1012, 330], [1000, 280], [992, 230],
    [982, 170]];
  // 앞머리 그늘(머리카락이 이마에 드리우는 그림자)
  const BANG_SHADE = [[818, 172, 40, 14, -0.2], [948, 118, 70, 22, 0.1]];

  const SKIN_EXT = 16; // 앞머리 밑으로 피부를 넓히는 폭(px)
  // 조명을 정면으로 받는 왼쪽 볼 가장자리: 따뜻한 테두리 그늘을 빼는 곳
  const LIT_EDGE = [[740, 245], [800, 245], [805, 330], [800, 470], [740, 470]];

  // 오른쪽 턱·볼 안쪽의 분홍 반사광 띠: x에 따른 띠 폭(px). 턱 끝에서 가늘고 귀 쪽으로 넓어진다.
  const JAW_RIM = [[838, 0], [848, 1.8], [882, 2.2], [905, 3], [920, 4.4], [955, 6.4], [980, 8], [1000, 9],
    [1012, 11.5], [1024, 14]];
  // 턱선 먹선 굵기 배율: 조명을 받는 왼쪽 턱(x 808~836)에는 먹선 없이 색 단계만 있다
  const INK_GAP = [[798, 1], [808, 0], [836, 0], [846, 1]];

  function interpX(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        const [x0, v0] = table[i - 1];
        const [x1, v1] = table[i];
        return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
      }
    }
    return table[table.length - 1][1];
  }

  // 머리 윤곽을 굵게 흐려 그린 띠: 가장자리로 갈수록 따뜻하게 물드는 셀 음영.
  // 보이는 턱선 쪽(y0 아래)과 밝은 왼쪽 볼은 밝게 두도록 지운다.
  function edgeGlow(env, path, color, width, blur, alpha, y0, y1) {
    const c = env.makeCanvas(env.W, env.H);
    const g = c.getContext('2d');
    g.filter = `blur(${blur}px)`;
    g.strokeStyle = rgba(color, alpha);
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.stroke(path);
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, y0, 0, y1);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, env.W, env.H);
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(10px)';
    g.fillStyle = '#000';
    g.fill(polyPath(LIT_EDGE));
    return c;
  }

  // 머리카락 레이어가 주는 앞머리 영역(evenodd 고리들) → Path2D, 없으면 null
  function hairFront() {
    const hd = P.hairData;
    if (!hd || !hd.front) return null;
    const front = new Path2D();
    for (const r of hd.front) front.addPath(polyPath(pairs(r)));
    return front;
  }

  // 앞머리가 이마·관자놀이에 드리우는 따뜻한 그림자: 앞머리 영역(없으면 머리 윤곽)을 크게 흐려
  // 빛 반대쪽(오른쪽 아래)으로 조금 민다. 밝은 왼쪽 볼과 턱 쪽은 지운다.
  function hairShadow(env, head) {
    const c = env.makeCanvas(env.W, env.H);
    const g = c.getContext('2d');
    const front = hairFront();
    g.filter = 'blur(12px)';
    g.translate(2, 6);
    if (front) {
      g.fillStyle = rgba(PAL.hairShade, 0.6);
      g.fill(front, 'evenodd');
    } else {
      g.strokeStyle = rgba(PAL.hairShade, 0.45);
      g.lineWidth = 40;
      g.stroke(head);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 290, 0, 350);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, env.W, env.H);
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(10px)';
    g.fillStyle = '#000';
    g.fill(polyPath(LIT_EDGE));
    return c;
  }

  // 피부 바탕: 머리 윤곽 + (앞머리가 덮는 곳이면) 숨은 가장자리를 머리카락 밑으로 넉넉히 넓힌 띠
  function skinMask(env, D, head) {
    const c = env.makeCanvas(env.W, env.H);
    const g = c.getContext('2d');
    g.fillStyle = PAL.skin;
    g.fill(head);
    const front = hairFront();
    if (front) {
      const hidden = new Path2D(`M0 0H${env.W}V${env.H}H0Z`);
      hidden.addPath(polyPath(pairs(D.visible)));
      g.save();
      g.clip(front, 'evenodd');
      g.clip(hidden, 'evenodd');
      g.strokeStyle = PAL.skin;
      g.lineWidth = SKIN_EXT * 2;
      g.lineJoin = 'round';
      g.stroke(head);
      g.restore();
    }
    return c;
  }

  // 음영은 모두 피부 바탕 캔버스 위에 source-atop으로 칠해 바탕 밖으로 나가지 않게 한다
  function drawSkin(out, env, D) {
    const head = polyPath(pairs(D.head));
    const skin = skinMask(env, D, head);
    const ctx = skin.getContext('2d');
    ctx.globalCompositeOperation = 'source-atop';
    // 가장자리 전체: 따뜻한 분홍으로 물든다
    ctx.drawImage(edgeGlow(env, head, PAL.skinWarm, 30, 9, 0.55, 300, 360), 0, 0);
    // 왼쪽 아래 볼·턱: 무대 조명을 받은 밝은 면
    ellipseGrad(ctx, 800, 375, 70, 85, 0.4, [
      [0, rgba(PAL.skinLit, 0.75)],
      [0.6, rgba(PAL.skinLit, 0.35)],
      [1, rgba(PAL.skinLit, 0)],
    ]);
    // 오른쪽 산호색 조명 구역 (안쪽 경계를 흐려 붓으로 번진 듯하게)
    ctx.save();
    ctx.filter = 'blur(7px)';
    ctx.fillStyle = rgba(PAL.skinCoral, 0.95);
    ctx.fill(polyPath(CORAL_ZONE));
    ctx.restore();
    // 앞머리 그늘: 가르마 밑이 가장 짙다
    for (const [x, y, rx, ry, rot] of BANG_SHADE) {
      ellipseGrad(ctx, x, y, rx, ry, rot, [[0, rgba(PAL.skinShade, 0.8)], [1, rgba(PAL.skinShade, 0)]]);
    }
    ctx.drawImage(hairShadow(env, head), 0, 0);
    ellipseGrad(ctx, 905, 112, 24, 11, 0.05, [[0, rgba(PAL.hairShade, 0.75)], [1, rgba(PAL.hairShade, 0)]]);
    // 눈 밑 홍조 띠
    ellipseGrad(ctx, 838, 266, 44, 14, -0.05, [[0, rgba(PAL.skinPink, 0.85)], [1, rgba(PAL.skinPink, 0)]]);
    ellipseGrad(ctx, 975, 290, 44, 15, 0.2, [[0, rgba(PAL.skinPink, 0.9)], [1, rgba(PAL.skinPink, 0)]]);
    // 왼쪽 볼 가장자리: 무대 조명이 스치는 밝은 림
    for (const seg of D.contour) {
      const pts = [];
      for (let i = 0; i < seg.length; i += 3) {
        if (seg[i] < 800 && seg[i + 1] < 410) pts.push([seg[i] + 3, seg[i + 1]]);
      }
      if (pts.length < 2) continue;
      ctx.filter = 'blur(2px)';
      ctx.fillStyle = rgba(PAL.rimLight, 0.9);
      taper(ctx, pts, brush(7, 0.15, 0.7, 0.1));
      ctx.filter = 'none';
    }
    // 오른쪽 턱 안쪽 분홍 띠: 윤곽선을 중심으로 폭 2w 붓선을 그으면 안쪽 절반이 띠가 된다(바깥은 피부 밖)
    for (const seg of D.contour) {
      const pts = [];
      for (let i = 0; i < seg.length; i += 3) {
        if (seg[i] > 836 && seg[i + 1] > 330) pts.push([seg[i], seg[i + 1]]);
      }
      if (pts.length < 2) continue;
      const d = dense(pts, false, 6);
      ctx.save();
      ctx.filter = 'blur(1px)';
      ctx.fillStyle = rgba(PAL.jawRim, 0.9);
      taper(ctx, pts, (u, i) => 2 * interpX(JAW_RIM, d[Math.min(i, d.length - 1)][0]) + 2.5, 6);
      ctx.restore();
    }
    drawBlush(ctx, env);
    out.drawImage(skin, 0, 0);
  }

  function drawBlush(ctx, env) {
    const rng = env.rng('face-blush');
    for (const b of BLUSH) {
      const [cx, cy, rx, ry, rot] = b.e;
      ellipseGrad(ctx, cx, cy, rx, ry, rot, [
        [0, rgba(PAL.blush, 0.5)],
        [0.55, rgba(PAL.blush, 0.32)],
        [1, rgba(PAL.blush, 0)],
      ]);
      // 사선 해칭: 가는 붓선을 조금씩 흔들어 손맛을 낸다
      for (const [x, y, len, deg] of b.hatch) {
        const ang = ((deg + (rng() - 0.5) * 6) * Math.PI) / 180;
        const dx = (Math.cos(ang) * len) / 2;
        const dy = (Math.sin(ang) * len) / 2;
        ctx.fillStyle = rgba(PAL.hatch, 0.45 + rng() * 0.2);
        taper(ctx, [[x - dx, y - dy], [x + dx, y + dy]], brush(1.3, 0.3, 0.6, 0.1), 6);
      }
      ctx.fillStyle = rgba(PAL.white, 0.95);
      ctx.fill(polyPath(b.glare));
    }
  }

  // 얼굴 윤곽선(굵기는 원본에서 잰 값): 조명을 받는 왼쪽 볼은 붉은 갈색, 턱 아래·오른쪽은 짙은 갈색
  function drawContour(ctx, D) {
    for (const seg of D.contour) {
      const pts = [];
      const ws = [];
      for (let i = 0; i < seg.length; i += 3) {
        pts.push([seg[i], seg[i + 1]]);
        ws.push(seg[i + 2]);
      }
      const n = ws.length;
      const d = dense(pts, false, 6);
      const xAt = (i) => d[Math.min(i, d.length - 1)][0];
      const wAt = (u) => {
        const k = u * (n - 1);
        const i = Math.floor(k);
        return ws[i] + (ws[Math.min(n - 1, i + 1)] - ws[i]) * (k - i);
      };
      const ends = (u) => Math.min(1, u * 10, (1 - u) * 10);
      const ink = (u, i) => Math.max(0.8, wAt(u) * 0.8) * (0.3 + 0.7 * ends(u)) * interpX(INK_GAP, xAt(i));
      ctx.fillStyle = rgba(PAL.lineRed, 0.9);
      taper(ctx, pts, ink, 6);
      // 짙은 선은 아래쪽에서만: 위치에 따라 투명도를 바꾼 그라디언트로 덧칠
      const g = ctx.createLinearGradient(775, 345, 800, 400);
      g.addColorStop(0, rgba(PAL.line, 0));
      g.addColorStop(1, rgba(PAL.line, 0.95));
      ctx.fillStyle = g;
      taper(ctx, pts, (u, i) => ink(u, i) * 0.9, 6);
      // 먹선이 빠진 곳: 피부 → 연어색으로 넘어가는 가는 색 단계, 그 안쪽에 밝은 림
      const gap = pts.filter(([x, y]) => x > 800 && x < 846 && y > 400);
      if (gap.length > 1) {
        const fade = (u) => Math.min(1, u * 5, (1 - u) * 5);
        ctx.fillStyle = rgba(PAL.jawStep, 0.85);
        taper(ctx, gap, (u) => 1.6 * fade(u), 6);
        ctx.fillStyle = rgba(PAL.rimLight, 0.5);
        taper(ctx, gap.map(([x, y]) => [x + 0.9, y - 1.6]), (u) => 1.3 * fade(u), 6);
      }
    }
  }

  // ── 귀 ───────────────────────────────────────────────
  function drawEars(ctx, env, C) {
    const rng = env.rng('face-ear');
    for (const ear of EARS) {
      const shell = smoothPath2D(C, ear.shell, true);
      ctx.fillStyle = PAL.ear;
      ctx.fill(shell);
      ctx.save();
      ctx.clip(shell);
      // 가장자리와 위쪽(머리카락 그늘)은 짙은 붉은빛, 안쪽 대이륜·귓불은 밝은 살구빛
      ctx.strokeStyle = rgba(PAL.earDeep, 0.9);
      ctx.lineWidth = 10;
      ctx.filter = 'blur(3px)';
      ctx.stroke(shell);
      ctx.filter = 'none';
      const [sx, sy, sr, sr2] = ear.shade;
      // 위쪽: 붉은 무대 조명을 받은 진한 산호빛 (가운데만 살짝 어둡다)
      ellipseGrad(ctx, sx, sy, sr, sr2, 0, [[0, rgba(PAL.earShadow, 0.5)], [0.35, rgba(PAL.earDeep, 0.85)],
        [1, rgba(PAL.earDeep, 0)]]);
      ctx.save();
      ctx.filter = 'blur(1px)';
      ctx.fillStyle = rgba(PAL.earLight, 0.95);
      ctx.fill(smoothPath2D(C, ear.inner, true));
      ctx.restore();
      ctx.fillStyle = rgba(PAL.earShadow, 0.7);
      for (const f of ear.folds) taper(ctx, f, brush(1.8, 0.3, 0.7, 0.2));
      ctx.restore();
      ctx.strokeStyle = rgba(PAL.earShadow, 0.85);
      ctx.lineWidth = 1.2;
      ctx.stroke(shell);
      // 검은 노즐(귓구멍)
      ctx.fillStyle = PAL.earDark;
      ctx.fill(smoothPath2D(C, ear.canal, true));
      // 인이어 셸: 회보라 크롬 + 반짝이 결 + 가장자리 흰 빛
      const mon = ear.monitor;
      drawJewel(ctx, smoothPath2D(C, mon, true), mon, rng, {
        base: [PAL.monLight, PAL.monMid, PAL.monDeep],
        pitch: 2.2,
        light: 0.38,
        dark: 0.3,
      });
      ctx.fillStyle = rgba(PAL.white, 0.55);
      taper(ctx, ear.glint, brush(1.6, 0.3, 0.6, 0.2));
      // 귀걸이: 은빛 바탕(왼쪽 위가 밝고 아래가 어둡다)에 반짝이는 알갱이
      const er = ear.earring;
      drawJewel(ctx, smoothPath2D(C, er, true), er, rng, {
        base: [PAL.silver, PAL.silverMid, PAL.metalDark],
        pitch: 2.6,
        light: 0.85,
        dark: 0.3,
      });
      if (ear.drop) {
        const [dx, dy, dr] = ear.drop;
        ctx.fillStyle = PAL.silver;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 보석·금속 조각: 대각 그라디언트 바탕 위에 촘촘한 파베 알갱이(엇갈린 격자 + 시드 흔들림)
  function drawJewel(ctx, path, pts, rng, o) {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, o.base[0]);
    g.addColorStop(0.5, o.base[1]);
    g.addColorStop(1, o.base[2]);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    const step = o.pitch;
    for (let y = y0; y <= y1; y += step * 0.87) {
      const odd = Math.round((y - y0) / (step * 0.87)) % 2;
      for (let x = x0 + odd * step * 0.5; x <= x1; x += step) {
        const px = x + (rng() - 0.5) * step * 0.4;
        const py = y + (rng() - 0.5) * step * 0.4;
        // 왼쪽 위가 밝다: 조명 쪽 알갱이일수록 흰빛을 많이 받는다
        const lit = 1 - ((px - x0) / (x1 - x0 + 1e-6) + (py - y0) / (y1 - y0 + 1e-6)) / 2;
        const v = rng();
        if (v < o.light * (0.35 + 0.65 * lit)) {
          ctx.fillStyle = rgba(PAL.white, 0.6 + rng() * 0.4);
          ctx.beginPath();
          ctx.arc(px, py, step * (0.28 + rng() * 0.18), 0, Math.PI * 2);
          ctx.fill();
        } else if (v > 1 - o.dark) {
          ctx.fillStyle = rgba(PAL.metalDark, 0.75);
          ctx.beginPath();
          ctx.arc(px, py, step * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = rgba(PAL.metalDark, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }

  // ── 눈 ───────────────────────────────────────────────
  function drawEye(ctx, e, C, rng) {
    const opening = smoothPath2D(C, e.bot.slice(e.open).concat(e.lower.slice(1, -1).reverse()), true);
    const bandPts = e.top.concat(e.bot.slice(1, -1).reverse());
    const band = smoothPath2D(C, bandPts, true);
    const [ix, iy, ir] = e.iris;
    // 홍채가 보이는 세로 범위: 띠 아래 가장자리 ~ 아래 눈꺼풀 (홍채 중심 x에서)
    const near = (pts) => pts.reduce((best, p) => (Math.abs(p[0] - ix) < Math.abs(best[0] - ix) ? p : best));
    const yTop = near(e.bot.slice(e.open))[1];
    const yLid = near(e.lower)[1];
    // 흰자: 밝은 흰색, 띠 바로 밑 2~4px만 라벤더 그늘
    ctx.fillStyle = PAL.sclera;
    ctx.fill(opening);
    ctx.save();
    ctx.clip(opening);
    ctx.save();
    ctx.translate(0, 3);
    ctx.filter = 'blur(2.2px)';
    ctx.fillStyle = rgba(PAL.scleraShade, 0.95);
    ctx.fill(band);
    ctx.restore();
    for (const end of [e.lower[0], e.lower[e.lower.length - 1]]) {
      ellipseGrad(ctx, end[0], end[1] - 1, 6, 3.5, 0, [
        [0, rgba(PAL.skinWarm, 0.5)],
        [1, rgba(PAL.skinWarm, 0)],
      ]);
    }
    // 홍채: 위는 띠 그늘에 묻힌 검붉은색, 아래 눈꺼풀에 가까울수록 진홍 → 밝은 산호빛.
    // 붉은 띠는 눈꺼풀 곡선을 따라 긋는다 (기울어진 눈에서도 눈꺼풀 위 같은 높이에 놓이게).
    const iris = new Path2D();
    iris.arc(ix, iy, ir, 0, Math.PI * 2);
    const ig = ctx.createLinearGradient(0, yTop, 0, yLid);
    ig.addColorStop(0, PAL.iris);
    ig.addColorStop(0.55, PAL.iris);
    ig.addColorStop(1, PAL.irisDeep);
    ctx.fillStyle = ig;
    ctx.fill(iris);
    ctx.save();
    ctx.clip(iris);
    const lidPath = new Path2D(C.smoothPath(e.lower, false, 0.5));
    ctx.lineJoin = 'round';
    for (const [col, a, w, blur] of [[PAL.irisDeep, 0.85, 15, 2.5], [PAL.irisMid, 0.9, 10, 1.8],
      [PAL.irisLow, 0.9, 6, 1.2], [PAL.irisGlow, 0.8, 2.6, 0.8]]) {
      ctx.filter = `blur(${blur}px)`;
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = w;
      ctx.stroke(lidPath);
    }
    ctx.filter = 'none';
    // 오른쪽으로 비치는 자줏빛(오른 눈은 옅은 라벤더) 반사
    const [sx, sy, srx, sry, scol, sa] = e.sheen;
    ellipseGrad(ctx, sx, sy, srx, sry, 0, [
      [0, rgba(scol, sa)],
      [0.6, rgba(scol, sa * 0.6)],
      [1, rgba(scol, 0)],
    ]);
    // 안쪽 결: 동공에서 뻗는 옅은 선
    ctx.strokeStyle = rgba(PAL.pupil, 0.18);
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rng() * 0.2;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(a) * ir * 0.38, iy + Math.sin(a) * ir * 0.38);
      ctx.lineTo(ix + Math.cos(a) * ir * 0.9, iy + Math.sin(a) * ir * 0.9);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = rgba(PAL.pupil, 0.9);
    ctx.lineWidth = 2.4;
    ctx.stroke(iris);
    // 동공: 가장자리를 살짝 흐려 붉은 홍채에 녹아들게
    const [px, py, pr] = e.pupil;
    ctx.save();
    ctx.filter = 'blur(0.6px)';
    ctx.fillStyle = PAL.pupil;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 속눈썹 띠가 홍채에 드리운 그림자 (흰자에는 위의 라벤더 그늘만)
    ctx.save();
    ctx.clip(iris);
    ctx.translate(0, 3);
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = rgba(PAL.pupil, 0.85);
    ctx.fill(band);
    ctx.restore();
    ctx.restore();

    // 아래 눈꺼풀 선(붉은 갈색, 바깥쪽이 조금 굵다)
    ctx.fillStyle = rgba(PAL.lineRed, 0.9);
    taper(ctx, e.lower, brush(1.8, 0.15, 0.7, 0.25));
    if (e.lowerExt) taper(ctx, e.lowerExt, brush(1.4, 0.4, 0.8, 0.2));
    // 쌍꺼풀 선: 분홍 번짐 위에 짙은 붉은 심
    if (e.creaseGlow) {
      const [gx, gy, grx, gry] = e.creaseGlow;
      ellipseGrad(ctx, gx, gy, grx, gry, 0.6, [[0, rgba(PAL.skinCoral, 0.6)], [1, rgba(PAL.skinCoral, 0)]]);
    }
    ctx.save();
    ctx.filter = 'blur(1px)';
    ctx.fillStyle = rgba(PAL.creasePink, 0.6);
    taper(ctx, e.crease, brush(3.4, 0.2, 0.75, 0.2));
    ctx.restore();
    ctx.fillStyle = rgba(PAL.crease, 0.9);
    taper(ctx, e.crease, brush(1.7, 0.2, 0.75, 0.15));
    // 속눈썹 띠
    ctx.fillStyle = PAL.lash;
    ctx.fill(band);
    // 띠 위쪽 가장자리의 술: 길이와 간격이 고르지 않은 짧은 속눈썹, 바깥 눈꼬리 쪽으로 눕는다
    const topD = dense(e.top, false, 10);
    const outerSign = e.top[0][0] < ix ? -1 : 1;
    let i = Math.round(topD.length * 0.12);
    while (i < topD.length * 0.85) {
      const [x, y] = topD[i];
      const [x2, y2] = topD[Math.min(topD.length - 1, i + 1)];
      let nx = y2 - y;
      let ny = -(x2 - x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const u = i / topD.length;
      const lean = outerSign * (0.9 - u * 0.8);
      const l = 2.5 + rng() * 3.5;
      const tx = x + (nx + lean) * l;
      const ty = y + ny * l * 0.8;
      ctx.fillStyle = rgba(PAL.lash, 0.75 + rng() * 0.25);
      taper(ctx, [[x - nx * 1.5, y - ny * 1.5], [(x + tx) / 2 + lean * 0.4, (y + ty) / 2], [tx, ty]],
        (q) => (1.1 + rng() * 0.3) * (1 - q * 0.9), 4);
      i += 4 + Math.floor(rng() * 5);
    }
    // 띠 안의 속눈썹 뿌리 점
    const botD = dense(e.bot.slice(e.open), false, 10);
    for (let i = 2; i < Math.min(topD.length, botD.length) - 3; i += 2) {
      const ti = Math.min(topD.length - 1, Math.round((i / botD.length) * topD.length));
      const [tx, ty] = topD[ti];
      const [bx, by] = botD[i];
      const v = 0.25 + rng() * 0.2;
      ctx.fillStyle = rgba(PAL.lashRoot, 0.2 + rng() * 0.25);
      ctx.beginPath();
      ctx.arc(tx + (bx - tx) * v, ty + (by - ty) * v, 0.7 + rng() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 긴 속눈썹 가닥
    ctx.fillStyle = PAL.lash;
    for (const [x0, y0, x1, y1, w] of e.spikes) {
      const mx = (x0 + x1) / 2 + (y1 - y0) * 0.08;
      const my = (y0 + y1) / 2 - (x1 - x0) * 0.08;
      taper(ctx, [[x0, y0], [mx, my], [x1, y1]], (u) => w * (1 - u * 0.92), 6);
    }
    ctx.fillStyle = rgba(PAL.lineRed, 0.7);
    for (const [x0, y0, x1, y1, w] of e.lowLashes) {
      taper(ctx, [[x0, y0], [x1, y1]], (u) => w * (1 - u * 0.85), 6);
    }
    // 눈 밑 살 선
    ctx.fillStyle = rgba(PAL.hatch, 0.35);
    taper(ctx, e.bag, brush(1.2, 0.3, 0.7, 0.05));
    // 하이라이트: 타원 몇 개를 겹친 불규칙한 덩어리
    ctx.fillStyle = PAL.white;
    for (const [hx, hy, hrx, hry, hrot] of e.hl) {
      ctx.beginPath();
      ctx.ellipse(hx, hy, hrx, hry, hrot, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y, r] of e.hlDots) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [a, b, w] of e.hlStreaks) {
      ctx.fillStyle = rgba(PAL.white, 0.92);
      taper(ctx, [a, b], brush(w, 0.3, 0.7, 0.3), 6);
    }
  }

  function drawBrows(ctx, env, C) {
    const rng = env.rng('face-brow');
    for (const b of BROWS) {
      const shape = smoothPath2D(C, b.top.concat(b.bot.slice().reverse()), true);
      // 몸통: 아래쪽이 조금 진하고, 털이 흩어지는 끝으로 갈수록 옅어진다
      const t0 = b.top[0];
      const t1 = b.top[b.top.length - 1];
      const g = ctx.createLinearGradient(t0[0], t0[1], t1[0], t1[1]);
      const solid = rgba(PAL.brow, 0.9);
      const fade = rgba(PAL.brow, 0.3);
      g.addColorStop(0, b.fan === 0 ? fade : solid);
      g.addColorStop(b.fan === 0 ? 0.25 : 0.65, solid);
      g.addColorStop(1, b.fan === 1 ? fade : solid);
      ctx.fillStyle = g;
      ctx.fill(shape);
      ctx.save();
      ctx.clip(shape);
      ctx.strokeStyle = rgba(PAL.browDark, 0.35);
      ctx.lineWidth = 3;
      ctx.filter = 'blur(1px)';
      ctx.beginPath();
      dense(b.bot, false, 4).forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 0.5) : ctx.moveTo(x, y + 0.5)));
      ctx.stroke();
      ctx.filter = 'none';
      ctx.restore();
      // 결: 눈썹 방향의 가는 털 선
      const top = dense(b.top, false, 6);
      const bot = dense(b.bot, false, 6);
      const n = Math.min(top.length, bot.length);
      for (let i = 0; i < 40; i++) {
        const u = 0.08 + rng() * 0.84;
        const k = Math.min(n - 2, Math.floor(u * (n - 1)));
        const v = 0.15 + rng() * 0.7;
        const x = top[k][0] + (bot[k][0] - top[k][0]) * v;
        const y = top[k][1] + (bot[k][1] - top[k][1]) * v;
        const ang = Math.atan2(top[k + 1][1] - top[k][1], top[k + 1][0] - top[k][0]) + (rng() - 0.5) * 0.2;
        const len = 5 + rng() * 7;
        ctx.fillStyle = rgba(PAL.browDark, 0.15 + rng() * 0.3);
        taper(ctx, [[x, y], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]], (q) => 0.9 * (1 - q * 0.8), 4);
      }
      // 흩어지는 끝의 굵은 털 가닥
      for (const [x0, y0, x1, y1] of b.hairs) {
        ctx.fillStyle = rgba(PAL.browDark, 0.45 + rng() * 0.25);
        taper(ctx, [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 - 0.4], [x1, y1]], brush(1.3, 0.2, 0.5, 0.1), 5);
      }
    }
  }

  function drawNose(ctx, D, C) {
    // 콧망울 옆 옅은 그늘
    ellipseGrad(ctx, 900, 292, 14, 9, 0.2, [[0, rgba(PAL.skinPink, 0.4)], [1, rgba(PAL.skinPink, 0)]]);
    // 콧등 하이라이트(크림색 타원)
    const hl = smoothPath2D(C, pairs(D.noseHl), true);
    ctx.save();
    ctx.filter = 'blur(0.5px)';
    ctx.fillStyle = PAL.noseHl;
    ctx.fill(hl);
    ctx.restore();
    for (const [pts, w] of NOSE.nostrils) {
      ctx.fillStyle = PAL.nostril;
      taper(ctx, pts, brush(w, 0.35, 0.6, 0.1));
    }
    ctx.fillStyle = rgba(PAL.hatch, 0.6);
    for (const m of NOSE.mark) taper(ctx, m, brush(1.3, 0.3, 0.7, 0.2), 4);
    ctx.fillStyle = rgba(PAL.white, 0.9);
    ctx.beginPath();
    ctx.arc(NOSE.dot[0], NOSE.dot[1], NOSE.dot[2], 0, Math.PI * 2);
    ctx.fill();
    // 콧등의 반짝이 알갱이
    for (const [x, y] of NOSE.glitter) {
      ctx.fillStyle = rgba(PAL.metalDeep, 0.55);
      ctx.beginPath();
      ctx.arc(x + 0.4, y + 0.5, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.white;
      ctx.beginPath();
      ctx.arc(x - 0.3, y - 0.3, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 이 하나: 위는 입술 밑으로 길게, 아래 끝은 얕은 반타원 (이웃 이와 이어져 물결 모양 아래 끝이 된다)
  function toothPath(xl, xr, yb) {
    const r = (xr - xl) / 2;
    const ry = Math.min(r * 0.7, 4.2);
    const k = 0.5523;
    const xm = xl + r;
    const p = new Path2D();
    p.moveTo(xl, yb - 40);
    p.lineTo(xl, yb - ry);
    p.bezierCurveTo(xl, yb - ry + k * ry, xm - k * r, yb, xm, yb);
    p.bezierCurveTo(xm + k * r, yb, xr, yb - ry + k * ry, xr, yb - ry);
    p.lineTo(xr, yb - 40);
    p.closePath();
    return p;
  }

  function drawMouth(ctx, D, C) {
    const lips = smoothPath2D(C, MOUTH.lips, true);
    // 입술: 가운데가 밝은 분홍, 가장자리로 진해진다
    const lg = ctx.createLinearGradient(0, 333, 0, 413);
    lg.addColorStop(0, PAL.lipDark);
    lg.addColorStop(0.12, PAL.lip);
    lg.addColorStop(0.75, PAL.lip);
    lg.addColorStop(1, PAL.lipDark);
    ctx.fillStyle = lg;
    ctx.fill(lips);
    ctx.save();
    ctx.clip(lips);
    ellipseGrad(ctx, 885, 402, 45, 9, 0.02, [[0, rgba(PAL.lipLight, 0.9)], [1, rgba(PAL.lipLight, 0)]]);
    ctx.restore();
    // 입 안
    const open = smoothPath2D(C, MOUTH.open, true);
    ctx.fillStyle = PAL.mouthMid;
    ctx.fill(open);
    ctx.save();
    ctx.clip(open);
    ctx.fillStyle = PAL.mouthDark;
    for (const flat of D.mouthDark) ctx.fill(smoothPath2D(C, pairs(flat), true));
    // 혀
    const tongue = smoothPath2D(C, MOUTH.tongue, true);
    ctx.fillStyle = PAL.tongue;
    ctx.fill(tongue);
    ctx.save();
    ctx.clip(tongue);
    ellipseGrad(ctx, 885, 384, 38, 10, 0.05, [[0, rgba(PAL.tongueLight, 0.8)], [1, rgba(PAL.tongueLight, 0)]]);
    ctx.restore();
    // 윗니: 한 줄로 이어진 흰 띠, 아래 끝만 얕은 물결. 양 끝 이만 회보라로 물러난다.
    const teeth = MOUTH.teeth;
    for (const [xl, xr, yb, shade] of teeth) {
      const tp = toothPath(xl - 0.5, xr + 0.5, yb);
      ctx.fillStyle = shade > 0 ? C.mixColor(PAL.teeth, PAL.teethShade, shade) : PAL.teeth;
      ctx.fill(tp);
      // 볼록함: 아래 끝 둘레만 아주 옅게
      ctx.save();
      ctx.clip(tp);
      const r = (xr - xl) / 2;
      ellipseGrad(ctx, xl + r, yb - r * 1.2, r * 1.5, r * 1.6, 0, [
        [0, rgba(PAL.white, 0)],
        [0.75, rgba(PAL.teethShade, 0)],
        [1, rgba(PAL.teethShade, 0.3)],
      ]);
      ctx.restore();
    }
    // 이 사이: 틈 대신 아래 끝 몇 px만 옅은 회보라 선
    ctx.strokeStyle = rgba(PAL.teethLine, 0.9);
    ctx.lineWidth = 0.9;
    for (let i = 1; i < teeth.length; i++) {
      const x = teeth[i][0];
      const yb = Math.min(teeth[i - 1][2], teeth[i][2]);
      ctx.beginPath();
      ctx.moveTo(x, yb - 5);
      ctx.lineTo(x, yb - 0.8);
      ctx.stroke();
    }
    // 오른쪽 윗니 위의 잇몸: 윗입술 테두리를 따라 붉은 띠, 입꼬리 쪽으로 넓어진다
    const gum = MOUTH.open.slice(5, MOUTH.upperN);
    const gd = dense(gum, false, 6);
    ctx.fillStyle = rgba(PAL.gum, 0.92);
    taper(ctx, gum, (u, i) => interpX(GUM_W, gd[Math.min(i, gd.length - 1)][0]), 6);
    // 윗입술 밑 잇몸 쪽 그늘
    const tg = ctx.createLinearGradient(0, 337, 0, 347);
    tg.addColorStop(0, rgba(PAL.teethShade, 0.6));
    tg.addColorStop(1, rgba(PAL.teethShade, 0));
    ctx.fillStyle = tg;
    ctx.fillRect(820, 330, 140, 30);
    ctx.restore();
    // 윗입술 선과 아랫입술 안쪽 경계선
    ctx.fillStyle = rgba(PAL.lipEdge, 0.85);
    taper(ctx, MOUTH.open.slice(0, MOUTH.upperN), brush(1.6, 0.1, 0.9, 0.3));
    ctx.fillStyle = rgba(PAL.lipEdge, 0.7);
    taper(ctx, MOUTH.open.slice(MOUTH.upperN, MOUTH.upperN + 9), brush(1.5, 0.15, 0.8, 0.2));
    // 오른쪽 윗입술 밑은 그늘진 가는 선
    ctx.fillStyle = rgba(PAL.mouthDark, 0.8);
    taper(ctx, MOUTH.open.slice(6, MOUTH.upperN), brush(1.5, 0.5, 0.9, 0.1));
    // 아랫입술 광택
    ctx.fillStyle = rgba(PAL.white, 0.95);
    for (const h of MOUTH.lipHl) ctx.fill(smoothPath2D(C, h, true));
    // 아랫입술 밑 그늘선, 입꼬리
    ctx.fillStyle = rgba(PAL.lipEdge, 0.45);
    taper(ctx, MOUTH.underLip, brush(1.4, 0.3, 0.7, 0.1));
    ctx.fillStyle = rgba(PAL.lineRed, 0.8);
    for (const c of MOUTH.corners) taper(ctx, c, brush(1.5, 0.3, 0.7, 0.2));
  }

  // ── 반짝임 (애니메이션) ─────────────────────────────────
  // 보석과 눈동자 빛 위에 네 갈래 별빛이 번갈아 켜진다. t=0에는 모두 꺼져 있어 원본 그대로다.
  const GLINTS = [
    [741, 318, 6, 1.7, 0.0],
    [736, 356, 5, 2.3, 1.3],
    [1028, 380, 6, 1.9, 2.1],
    [1015, 414, 5, 2.6, 0.7],
    [841, 236, 5, 1.1, 3.0],
    [970, 261, 5, 1.3, 4.2],
    [906, 263, 3.5, 2.9, 5.1],
  ];

  function makeGlint(env, size) {
    const R = Math.ceil(size) + 2;
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    g.translate(R, R);
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.5);
    halo.addColorStop(0, rgba(PAL.white, 1));
    halo.addColorStop(1, rgba(PAL.white, 0));
    g.fillStyle = halo;
    g.fillRect(-R, -R, R * 2, R * 2);
    g.fillStyle = PAL.white;
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -size * 0.12);
      g.lineTo(size, 0);
      g.lineTo(0, size * 0.12);
      g.closePath();
      g.fill();
    }
    return c;
  }

  // ── 레이어 ─────────────────────────────────────────────
  P.faceGeom = { EYES, BROWS, NOSE, MOUTH, BLUSH, EARS }; // 겹쳐 보기 도구용
  P.face = {
    async prepare(env) {
      const C = env.core;
      if (!P.faceData) await C.loadScript('js/procedural/data/face.js');
      const D = P.faceData;
      const canvas = env.makeCanvas(env.W, env.H);
      const ctx = canvas.getContext('2d');
      drawEars(ctx, env, C);
      drawSkin(ctx, env, D);
      drawContour(ctx, D);
      drawBrows(ctx, env, C);
      const eyeRng = env.rng('face-eye');
      for (const e of EYES) drawEye(ctx, e, C, eyeRng);
      drawNose(ctx, D, C);
      drawMouth(ctx, D, C);
      const glints = GLINTS.map(([x, y, size, w, ph]) => ({ x, y, w, ph, img: makeGlint(env, size) }));
      return { canvas, glints };
    },

    draw(ctx, state, t) {
      ctx.drawImage(state.canvas, 0, 0);
      if (!t) return;
      // 처음 1.5초 동안 서서히 켜지고, 각자 다른 빠르기로 짧게 반짝인다 (같은 t면 같은 그림)
      const fade = Math.min(1, t / 1.5);
      ctx.globalCompositeOperation = 'lighter';
      for (const gl of state.glints) {
        const k = fade * Math.pow(0.5 - 0.5 * Math.cos(t * gl.w + gl.ph), 3);
        if (k < 0.02) continue;
        ctx.globalAlpha = k * 0.9;
        const R = gl.img.width / 2;
        ctx.drawImage(gl.img, gl.x - R, gl.y - R);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
})();
