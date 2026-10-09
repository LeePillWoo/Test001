// 절차적 드로잉 레이어: face — 머리카락을 뺀 머리 전부.
// 피부(셀 음영·볼터치·윤곽 림), 귀와 인이어·귀걸이, 눈, 눈썹, 코, 웃는 입, 선화.
// 윤곽 다각형은 data/face.js(tools/proc_face.py가 원본에서 잰 좌표), 세부 기하는 아래 상수(손으로 잰 좌표).
// 색은 모두 팔레트 상수에서 오고, 그라디언트·띠·림 규칙으로 칠한다. 정적인 얼굴은 prepare에서 한 장에 굽고,
// 프레임마다 반짝이(귀걸이·콧등·눈동자 빛)만 얹는다.
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
    skinRim: '#ec8580',
    skinShade: '#f3b0a5',
    rimLight: '#fff3ea',
    blush: '#f9a6a2',
    hatch: '#ea7f86',
    line: '#2c121a',
    lineSoft: '#6e3436',
    lineRed: '#b8545b',
    lash: '#130810',
    lashSoft: '#3a1a22',
    sclera: '#fbf5f5',
    scleraShade: '#cdb7c4',
    iris: '#24101a',
    irisMid: '#5e2430',
    irisLow: '#c2434f',
    irisRing: '#3a1820',
    lashRoot: '#6b5566',
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
    ear: '#ee9784',
    earDeep: '#c55c58',
    earShadow: '#7a2a32',
    earDark: '#1c0c14',
    earLight: '#f8b9a2',
    metal: '#8f86a8',
    metalDeep: '#585274',
    metalDark: '#1f1828',
    metalLight: '#d8d4ec',
    white: '#ffffff',
  };

  // ── 손으로 잰 기하 (원본 픽셀) ─────────────────────────────
  // 눈: 화면 왼쪽(0), 오른쪽(1). 점 목록은 바깥 눈꼬리 → 안쪽 눈머리 순서.
  const EYES = [
    {
      // 속눈썹 띠의 위쪽 가장자리와 아래쪽 가장자리. 둘 다 날개 끝에서 시작해 눈머리에서 만난다.
      top: [[780, 241.8], [790, 239.2], [800, 235.5], [807, 232], [815, 227.5], [827, 222.5], [840, 220.5],
        [851, 221.5], [860, 224], [867, 229.5], [871.5, 237], [874, 247], [875.5, 256]],
      bot: [[780, 242.6], [792, 243], [801, 244.5], [806.5, 246.8], [810.5, 245], [816, 239.5], [827, 233.5], [840, 231.5],
        [852, 232], [861, 236], [866.5, 241], [870.5, 248], [873.5, 254], [875.5, 256]],
      open: 3, // bot에서 눈 트임이 시작하는 점(바깥 눈꼬리)
      lowerExt: [[784, 245.5], [796, 246], [807, 247.5]],
      lower: [[807, 247.5], [815, 249.4], [827, 250.6], [840, 251.2], [852, 251.4], [862, 252.6],
        [870, 254.4], [875.5, 256]],
      iris: [842.5, 242, 19.5],
      pupil: [843, 245, 5.6],
      crease: [[807, 229], [817, 221.5], [829, 217.5], [846, 216.2], [860, 219.5], [869.5, 226.5],
        [875, 237], [877, 250]],
      // 위 속눈썹 가닥: 뿌리 x, y, 끝 x, y, 굵기
      spikes: [[825, 223.5, 818, 215.5, 1.8], [834, 222, 831.5, 213.5, 1.7], [845.5, 221.5, 846.5, 214.5, 1.7],
        [811, 229, 804.5, 225, 1.7], [804, 233, 795.5, 230, 1.6], [797, 237.5, 788, 236, 1.4],
        [790, 240.5, 781, 240, 1.2], [856, 223.5, 860, 217.5, 1.2]],
      lowLashes: [[812, 250, 810, 253.5, 0.7], [866, 254.5, 867.5, 258, 0.7]],
      hlBlob: [[835, 236.5], [838.5, 234], [843.5, 233.2], [847.5, 234.4], [848.5, 237.2], [845, 239.6],
        [840, 240.2], [836, 239.2]],
      hlDots: [[844.6, 242.2, 1.6], [851, 240.6, 1.9]],
      hlStreaks: [[[824, 243.4], [831.5, 242.2], 1.5], [[857, 249.5], [861, 247], 1.2]],
      bag: [[828, 259.5], [840, 260.2], [851, 259.5]],
    },
    {
      top: [[1020, 291], [1019, 282], [1017, 271.5], [1012, 261.5], [1004, 256.5], [995, 252.5],
        [985, 250], [972.5, 249.2], [960, 250.8], [950, 255.5], [944, 262.5], [940.5, 268.5]],
      bot: [[1020, 291], [1013, 288.8], [1010, 286.5], [1007.5, 278], [1003.5, 270], [996, 263.5],
        [985, 259.5], [972, 258.5], [959, 260], [950, 263], [944, 266.5], [940.5, 268.5]],
      open: 2,
      lower: [[1010, 286.5], [1006, 286], [997.5, 283.8], [989, 280.6], [979, 277.6], [966, 275.2],
        [953.8, 272.5], [940.5, 268.5]],
      iris: [973.5, 266.5, 18.5],
      pupil: [972.5, 267.5, 5.2],
      crease: [[1013, 263], [1007.5, 255], [1000, 250.4], [989, 246], [979, 244.4], [966, 245], [954, 249],
        [944, 255.5]],
      spikes: [[970, 250, 970.5, 245.5, 1.4], [980.5, 250, 980.5, 244.5, 1.4], [986, 250.5, 991, 237.5, 1.8],
        [995.5, 252.5, 1003, 247.5, 1.5], [1003, 257, 1016, 258, 2.6], [1009, 264, 1024, 267.5, 3],
        [1012, 273, 1027.5, 279, 3], [1013, 282, 1027, 290.5, 2.6], [1011, 288, 1019, 295, 1.6]],
      lowLashes: [[1003, 285.8, 1005, 290, 0.7]],
      hlBlob: [[965, 262.5], [968, 259.8], [973.5, 259.2], [978, 260.2], [978.4, 263], [975.5, 265.2],
        [969.5, 265.6], [966, 264.8]],
      hlDots: [[972.8, 268, 1.6]],
      hlStreaks: [[[957.5, 266], [961, 265], 1.4], [[982.5, 274.4], [989, 276.3], 1.5]],
      bag: [[948, 277], [960, 280.2], [972, 282]],
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
    spot: [908.5, 282.8],
  };

  const MOUTH = {
    // 입술 바깥 윤곽(왼쪽 입꼬리에서 시계 방향)
    lips: [[828, 343], [835, 338.5], [845, 335.5], [858, 333.5], [872, 333], [886, 333.5], [900, 336],
      [914, 340.5], [927, 347], [938, 355], [946, 362], [951, 368.5], [951, 371], [948, 378], [942, 388],
      [933, 397], [921, 404], [906, 409], [890, 411.5], [875, 411], [862, 407.5], [851, 401], [842, 392],
      [835, 381], [831, 368], [829, 355]],
    // 입 안(트임): 윗입술 아래 테두리(왼→오) + 아랫입술 안쪽 테두리(오→왼)
    open: [[829, 346.5], [835, 343], [849, 339.7], [870.8, 337.6], [892, 339], [908, 342.6], [922, 348],
      [936.6, 357], [946.6, 367], [949.5, 370.5], [942, 376.5], [932, 382.2], [921.5, 387.6], [908, 392.4],
      [892, 394.4], [875, 392.6], [858, 387.6], [845, 380.2], [836, 368], [831, 357]],
    upperN: 10, // open의 앞 10점이 윗입술 테두리
    tongue: [[836, 371], [842, 366.4], [852, 362.6], [864, 361], [874, 362], [880, 364.5], [886, 363],
      [897, 364.6], [908, 368.8], [919, 374], [928, 379.5], [934, 383.2], [921.5, 388.8], [908, 393.4], [892, 395.4],
      [875, 393.6], [858, 388.6], [845, 381.2]],
    // 윗니: 왼쪽 x, 오른쪽 x, 아래 끝 y, 그늘(0 흰색 ~ 1 회보라)
    teeth: [[835, 840.5, 356, 0.9], [840, 847.5, 357, 0.55], [847, 857.5, 357, 0.1], [857, 869, 355.8, 0],
      [869, 885.5, 357.6, 0], [885, 902, 361, 0], [902, 914, 365, 0.05], [914, 922.5, 369, 0.15],
      [922, 931, 372.6, 0.3], [930.5, 938.5, 375.5, 0.8]],
    lipHl: [[[858.5, 394.6], [863, 395.8], [868.5, 398.6], [863.5, 398.4]], [[884, 401.2], [888.5, 400.8],
      [893, 401.6], [888.5, 402.8]]],
    underLip: [[866, 408.2], [874, 410.6], [884, 411.2], [892, 410]],
    corners: [[[827, 343.5], [830.5, 347], [832.5, 352]], [[952.5, 366.5], [950.5, 371], [946.5, 373.5]]],
  };

  // 볼터치: 타원(cx, cy, rx, ry, 기울기) + 사선 해칭 + 흰 점
  const BLUSH = [
    { e: [818, 290, 52, 28, -0.12], hatch: [808, 280, 862, 300], dot: [[797, 281, 3.4]] },
    { e: [1000, 312, 40, 28, 0.25], hatch: [983, 300, 1025, 330], dot: [[1000, 316, 2.6]] },
  ];

  // 귀: 귓바퀴, 안쪽 밝은 면(대이륜·귓불), 귓바퀴 안 붉은 갈색 선, 인이어(셸·검은 노즐), 귀걸이(파베 보석)
  const EARS = [
    {
      shell: [[716, 300], [722, 292], [732, 289], [742, 290], [750, 296], [755, 305], [758, 318], [761, 335],
        [763, 352], [762, 366], [756, 372], [747, 374], [738, 374], [730, 370], [723, 362], [718, 350], [715, 335],
        [714, 318]],
      inner: [[724, 318], [729, 312], [735, 309], [731, 320], [727, 334], [731, 346], [740, 350], [750, 350],
        [758, 352], [760, 364], [752, 370], [741, 370], [731, 364], [724, 352], [721, 336]],
      folds: [[[724, 320], [722, 332], [726, 344], [733, 350]], [[751, 348], [756, 356], [757, 366]]],
      shade: [732, 293, 30, 18],
      monitor: [[742, 307], [747, 309], [748, 315], [746, 323], [745, 331], [748, 338], [750, 344], [744, 345.5],
        [736, 343], [730.5, 337], [729, 329], [732, 319], [737, 311]],
      glint: [[744, 318], [742.5, 327], [744, 335]],
      canal: [[748, 310], [752, 313], [755, 320], [753, 328], [754, 336], [756, 343], [750, 345], [748, 338],
        [746, 330], [747, 321]],
      earring: [[733, 352], [738, 348.5], [744, 349], [747.5, 354], [747, 362], [744, 369], [739, 372], [733.5, 370],
        [730.5, 363], [730.5, 357]],
      drop: [740, 375, 2],
    },
    {
      shell: [[1003, 395], [1010, 380], [1018, 368], [1026, 358], [1036, 351], [1046, 350], [1053, 357], [1055, 370],
        [1052, 386], [1045, 400], [1036, 410], [1028, 416], [1020, 421], [1012, 425], [1004, 425], [998, 418],
        [996, 408]],
      inner: [[1000, 404], [1010, 400], [1022, 401], [1032, 402], [1040, 399], [1036, 408], [1026, 414], [1014, 419],
        [1004, 420], [998, 414]],
      folds: [[[1004, 402], [1016, 398.5], [1030, 400]], [[1026, 362], [1038, 358], [1047, 362]]],
      shade: [1044, 362, 16, 22],
      monitor: [[1024, 369], [1030, 371], [1034.5, 378], [1036, 386], [1034, 394], [1028, 399.5], [1020, 400],
        [1013, 397], [1015, 391], [1020, 386], [1022, 378]],
      glint: [[1031, 377], [1033, 386], [1030, 394]],
      canal: [[1006, 394], [1010, 389], [1016, 387], [1021, 389], [1019, 396], [1013, 400], [1007, 400]],
      earring: [[1012, 410], [1018, 407.5], [1024, 409], [1027, 414], [1026.5, 421], [1024, 428], [1018, 431.5],
        [1012, 430], [1008, 424], [1008, 416]],
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

  function line(ctx, pts, w, color, alpha = 1) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

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

  // 머리 윤곽을 굵게 흐려 그린 띠: 가장자리로 갈수록 따뜻하게 물드는 셀 음영
  // 보이는 턱선 쪽(y0 아래)은 밝게 두도록 세로로 사라지게 한다
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
    return c;
  }

  function drawSkin(ctx, env, D, C) {
    const head = polyPath(pairs(D.head));
    ctx.fillStyle = PAL.skin;
    ctx.fill(head);
    ctx.save();
    ctx.clip(head);
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
    // 앞머리 그늘
    for (const [x, y, rx, ry, rot] of BANG_SHADE) {
      ellipseGrad(ctx, x, y, rx, ry, rot, [[0, rgba(PAL.skinShade, 0.8)], [1, rgba(PAL.skinShade, 0)]]);
    }
    // 눈 밑 홍조 띠
    ellipseGrad(ctx, 838, 266, 44, 14, -0.05, [[0, rgba(PAL.skinPink, 0.85)], [1, rgba(PAL.skinPink, 0)]]);
    ellipseGrad(ctx, 975, 290, 44, 15, 0.2, [[0, rgba(PAL.skinPink, 0.9)], [1, rgba(PAL.skinPink, 0)]]);
    // 왼쪽 볼 가장자리: 무대 조명이 스치는 밝은 림
    for (const seg of D.contour) {
      const pts = [];
      for (let i = 0; i < seg.length; i += 3) {
        if (seg[i] < 805 && seg[i + 1] < 445) pts.push([seg[i] + 3, seg[i + 1]]);
      }
      if (pts.length < 2) continue;
      ctx.filter = 'blur(2px)';
      ctx.fillStyle = rgba(PAL.rimLight, 0.9);
      taper(ctx, pts, brush(7, 0.15, 0.7, 0.1));
      ctx.filter = 'none';
    }
    drawBlush(ctx, env);
    ctx.restore();
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
      // 사선 해칭: 짧고 가는 선을 오른쪽 아래로 기울여 늘어놓는다
      const [x0, y0, x1, y1] = b.hatch;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * u + (rng() - 0.5) * 3;
        const y = y0 + (y1 - y0) * (0.35 + 0.3 * Math.sin(u * Math.PI)) + (rng() - 0.5) * 3;
        const len = 9 + rng() * 6;
        const ang = 1.15 + (rng() - 0.5) * 0.2;
        ctx.fillStyle = rgba(PAL.hatch, 0.35 + rng() * 0.2);
        taper(ctx, [[x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5],
          [x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5]], brush(1.2, 0.3, 0.7, 0.1), 6);
      }
      for (const [dx, dy, r] of b.dot) {
        ctx.fillStyle = rgba(PAL.white, 0.95);
        ctx.beginPath();
        ctx.moveTo(dx - r, dy + r * 0.2);
        ctx.lineTo(dx + r * 0.3, dy - r);
        ctx.lineTo(dx + r, dy - r * 0.1);
        ctx.lineTo(dx - r * 0.2, dy + r);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // 얼굴 윤곽선: 조명을 받는 왼쪽 위는 가늘고 붉은 갈색, 턱 아래·오른쪽은 굵고 짙은 갈색
  function drawContour(ctx, D) {
    for (const seg of D.contour) {
      const pts = [];
      const ws = [];
      for (let i = 0; i < seg.length; i += 3) {
        pts.push([seg[i], seg[i + 1]]);
        ws.push(seg[i + 2]);
      }
      const n = ws.length;
      const wAt = (u) => {
        const k = u * (n - 1);
        const i = Math.floor(k);
        return ws[i] + (ws[Math.min(n - 1, i + 1)] - ws[i]) * (k - i);
      };
      const ends = (u) => Math.min(1, u * 10, (1 - u) * 10);
      ctx.fillStyle = rgba(PAL.lineRed, 0.9);
      taper(ctx, pts, (u) => Math.max(0.8, wAt(u)) * (0.3 + 0.7 * ends(u)), 6);
      // 짙은 선은 아래쪽에서만: 위치에 따라 투명도를 바꾼 그라디언트로 덧칠
      const g = ctx.createLinearGradient(775, 345, 800, 400);
      g.addColorStop(0, rgba(PAL.line, 0));
      g.addColorStop(1, rgba(PAL.line, 0.95));
      ctx.fillStyle = g;
      taper(ctx, pts, (u) => Math.max(0.8, wAt(u)) * 0.9 * (0.3 + 0.7 * ends(u)), 6);
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
      ctx.strokeStyle = rgba(PAL.earDeep, 0.8);
      ctx.lineWidth = 7;
      ctx.filter = 'blur(2px)';
      ctx.stroke(shell);
      ctx.filter = 'none';
      const [sx, sy, sr, sr2] = ear.shade;
      ellipseGrad(ctx, sx, sy, sr, sr2, 0, [[0, rgba(PAL.earShadow, 0.95)], [0.6, rgba(PAL.earDeep, 0.6)],
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
        base: [PAL.metalLight, PAL.metal, PAL.metalDeep],
        pitch: 2.2,
        light: 0.55,
        dark: 0.3,
      });
      ctx.fillStyle = rgba(PAL.white, 0.9);
      taper(ctx, ear.glint, brush(2, 0.3, 0.6, 0.2));
      // 귀걸이: 어두운 바탕에 큰 은빛 알갱이
      const er = ear.earring;
      drawJewel(ctx, smoothPath2D(C, er, true), er, rng, {
        base: [PAL.metal, PAL.metalDark, PAL.metalDark],
        pitch: 3.2,
        light: 1,
        dark: 0.15,
      });
      if (ear.drop) {
        const [dx, dy, dr] = ear.drop;
        ctx.fillStyle = PAL.metalLight;
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
    const [ix, iy, ir] = e.iris;
    // 흰자: 띠 밑은 회보라, 양 끝은 살짝 분홍
    ctx.fillStyle = PAL.sclera;
    ctx.fill(opening);
    ctx.save();
    ctx.clip(opening);
    const sh = ctx.createLinearGradient(0, iy - ir * 0.7, 0, iy + ir * 0.45);
    sh.addColorStop(0, rgba(PAL.scleraShade, 1));
    sh.addColorStop(1, rgba(PAL.scleraShade, 0));
    ctx.fillStyle = sh;
    ctx.fillRect(ix - 70, iy - 40, 140, 80);
    for (const end of [e.lower[0], e.lower[e.lower.length - 1]]) {
      ellipseGrad(ctx, end[0], end[1] - 1, 7, 4, 0, [[0, rgba(PAL.skinWarm, 0.55)], [1, rgba(PAL.skinWarm, 0)]]);
    }
    // 홍채: 어두운 바탕 + 아래쪽 붉은 초승달
    const iris = new Path2D();
    iris.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fillStyle = PAL.iris;
    ctx.fill(iris);
    ctx.save();
    ctx.clip(iris);
    ellipseGrad(ctx, ix + ir * 0.05, iy + ir * 0.45, ir * 0.9, ir * 0.42, 0, [
      [0, rgba(PAL.irisLow, 1)],
      [0.55, rgba(PAL.irisLow, 0.7)],
      [1, rgba(PAL.irisMid, 0)],
    ]);
    // 오른쪽 위로 비치는 옅은 자줏빛 반사
    ellipseGrad(ctx, ix + ir * 0.5, iy - ir * 0.05, ir * 0.32, ir * 0.3, 0, [
      [0, rgba(PAL.irisMid, 0.9)],
      [1, rgba(PAL.irisMid, 0)],
    ]);
    // 안쪽 결: 동공에서 뻗는 옅은 선
    ctx.strokeStyle = rgba(PAL.pupil, 0.35);
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
    ctx.lineWidth = 2;
    ctx.stroke(iris);
    // 동공과 그 둘레의 옅은 고리
    const [px, py, pr] = e.pupil;
    ctx.strokeStyle = rgba(PAL.irisRing, 0.9);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px, py, pr + 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PAL.pupil;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    // 속눈썹 띠가 드리운 그림자
    ctx.save();
    ctx.translate(0, 3);
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = rgba(PAL.pupil, 0.8);
    ctx.fill(smoothPath2D(C, bandPts, true));
    ctx.restore();
    ctx.restore();

    // 아래 눈꺼풀 선(붉은 갈색, 바깥쪽이 조금 굵다)
    ctx.fillStyle = rgba(PAL.lineRed, 0.9);
    taper(ctx, e.lower, brush(1.8, 0.15, 0.7, 0.25));
    if (e.lowerExt) taper(ctx, e.lowerExt, brush(1.4, 0.4, 0.8, 0.2));
    // 쌍꺼풀 선
    ctx.fillStyle = rgba(PAL.lineRed, 0.55);
    taper(ctx, e.crease, brush(1.6, 0.25, 0.75, 0.1));
    ctx.fillStyle = rgba(PAL.lineSoft, 0.45);
    taper(ctx, e.crease, brush(0.9, 0.25, 0.75, 0.1));
    // 속눈썹 띠
    const band = smoothPath2D(C, bandPts, true);
    ctx.fillStyle = PAL.lash;
    ctx.fill(band);
    // 띠 위쪽 가장자리의 촘촘한 짧은 속눈썹 (바깥 눈꼬리 쪽으로 눕는다)
    const topD = dense(e.top, false, 10);
    const outerX = e.top[0][0];
    for (let i = Math.round(topD.length * 0.25); i < topD.length * 0.75; i += 7) {
      const [x, y] = topD[i];
      const [x2, y2] = topD[i + 1];
      let nx = y2 - y;
      let ny = -(x2 - x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const lean = outerX < ix ? -0.5 : 0.5;
      const l = 1 + rng() * 1.2;
      const tx = x + (nx + lean * 0.6) * l;
      const ty = y + ny * l;
      taper(ctx, [[x - nx, y - ny], [tx, ty]], (u) => 1.4 * (1 - u * 0.9), 3);
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
    // 하이라이트
    ctx.fillStyle = PAL.white;
    ctx.fill(smoothPath2D(C, e.hlBlob, true));
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
    ctx.fillStyle = rgba(PAL.lineRed, 0.4);
    ctx.beginPath();
    ctx.arc(NOSE.spot[0], NOSE.spot[1], 1.5, 0, Math.PI * 2);
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

  // 이 하나: 위는 입술 밑으로 길게, 아래 끝은 납작한 반원
  function toothPath(xl, xr, yb) {
    const r = (xr - xl) / 2;
    const ry = r * 1.3;
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
    // 윗니: 하나씩 둥근 아래 끝, 위는 잇몸 그늘
    for (const [xl, xr, yb, shade] of MOUTH.teeth) {
      const tp = toothPath(xl, xr, yb);
      ctx.fillStyle = shade > 0 ? C.mixColor(PAL.teeth, PAL.teethShade, shade) : PAL.teeth;
      ctx.fill(tp);
      // 이 하나하나가 볼록해 보이게: 아래 끝 둘레는 옅은 회보라, 가운데는 흰빛
      ctx.save();
      ctx.clip(tp);
      const r = (xr - xl) / 2;
      ellipseGrad(ctx, xl + r, yb - r * 1.6, r * 1.6, r * 2.4, 0, [
        [0, rgba(PAL.white, 0)],
        [0.6, rgba(PAL.teethShade, 0)],
        [1, rgba(PAL.teethShade, 0.55)],
      ]);
      ctx.restore();
    }
    // 이 사이 홈: 아래 끝 근처만 옅게
    for (const [xl, xr, yb] of MOUTH.teeth) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xl - 2, yb - 7, xr - xl + 4, 10);
      ctx.clip();
      ctx.strokeStyle = rgba(PAL.teethShade, 0.8);
      ctx.lineWidth = 0.8;
      ctx.stroke(toothPath(xl, xr, yb));
      ctx.restore();
    }
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
    ctx.fillStyle = rgba(PAL.lipEdge, 0.6);
    taper(ctx, MOUTH.open.slice(MOUTH.upperN, MOUTH.upperN + 9), brush(1.4, 0.2, 0.8, 0.1));
    // 아랫입술 광택
    ctx.fillStyle = rgba(PAL.white, 0.95);
    for (const h of MOUTH.lipHl) ctx.fill(smoothPath2D(C, h, true));
    // 아랫입술 밑 그늘선, 입꼬리
    ctx.fillStyle = rgba(PAL.lipEdge, 0.45);
    taper(ctx, MOUTH.underLip, brush(1.4, 0.3, 0.7, 0.1));
    ctx.fillStyle = rgba(PAL.lineRed, 0.8);
    for (const c of MOUTH.corners) taper(ctx, c, brush(1.5, 0.3, 0.7, 0.2));
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
      drawSkin(ctx, env, D, C);
      drawContour(ctx, D);
      drawBrows(ctx, env, C);
      const eyeRng = env.rng('face-eye');
      for (const e of EYES) drawEye(ctx, e, C, eyeRng);
      drawNose(ctx, D, C);
      drawMouth(ctx, D, C);
      return { canvas };
    },

    draw(ctx, state) {
      ctx.drawImage(state.canvas, 0, 0);
    },
  };
})();
