// 절차적 드로잉 레이어: body — 목·어깨·가슴·팔·허리 피부와 스팽글 드레스(몸판·치마·가방·어깨끈).
// 윤곽과 명암 단계 모양은 data/body.js(tools/proc_body.py가 원본에서 잰 기하)를 쓰고,
// 색은 아래 팔레트를 그라디언트·셀 단계·림 라이트·노이즈 규칙으로 입힌다.
// 스팽글은 천의 곡률을 따르는 곡선 격자(행 안내선 사이 보간, 원본에서 잰 간격) 위에 하나씩 그리고,
// 밝기는 손으로 잰 조명 구역과 노이즈로 정한다: 빛을 못 받은 것은 천에 묻히고, 받은 것만
// 3~5px 하이라이트(일부 초승달·구멍)로 보인다. 하이라이트 심 색은 흰빛·붉은 분홍·파랑 팔레트에서
// 자리별 몫(윗단·치마는 흰빛, 가운데·아래 몸판은 붉은 분홍)으로 고른다. 정적인 그림은 prepare에서 한 장에 굽는다.
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
    waist: ['#fdf2ea', '#fedac2', '#fdc6ad', '#fbb29c', '#ec9386', '#d57d7e'],
    fore: ['#fff0e8', '#fddfd4', '#fcc2b8', '#ea8d95', '#da8488', '#d07179'],
  };
  const DRESS = {
    base: '#0a040c',
    deep: '#050208',
    sheen: '#2c1838',
    violet: '#3c2060',
    line: '#07030a',
    dim: '#4a1438', // 빛을 덜 받은 스팽글(붉은 자주)
    scale: '#0f0817', // 스팽글 몸통(비늘)
  };
  // 조명 구역 색 (반쯤 빛을 받은 점을 물들이는 색)
  const SEQ = {
    white: '#fdf8ff',
    lavender: '#d0a8f0',
    pink: '#ff5cb4',
    magenta: '#f02cb0',
    blue: '#8c9cff',
    violet: '#b27cf2',
  };
  // 빛을 받은 스팽글 심의 색: 무채색 흰빛 둘, 붉은 분홍 셋, 파랑, 치마 왼쪽 아래의 푸른 흰빛.
  // 보라·라벤더 조명은 심을 물들이지 않는다(반쯤 받은 점만).
  const CORE = {
    white: ['#fff6fa', '#f4eef8'],
    pink: ['#ff5c8a', '#f03a6c', '#ff8aa8'],
    blue: ['#8a9cff'],
    ice: ['#b8c8ff'],
    silver: ['#f4f0ff'],
  };
  // 심 색 몫 [붉은 분홍, 파랑] (나머지는 흰빛): 몸판 윗단과 치마는 대부분 흰빛이고,
  // 몸판 가운데·아래는 붉은 분홍이 절반 가까이 된다. 그 자리 조명 구역의 색이 몫을 더 민다(SHARE_K: 바탕 몫의 무게).
  const SHARE = { top: [0.1, 0.12], mid: [0.48, 0.2], low: [0.4, 0.38], skirt: [0.05, 0.12] };
  const SHARE_K = 0.12;
  // 몸판 윗단(목선 쪽) 가장자리 띠: 스팽글이 크다. 왼쪽은 붉은 분홍, 오른쪽은 파랑이 섞인다
  const TOPROW = { dist: 34, grow: 0.3, pink: 0.16, blue: 0.2 };

  // ── 스팽글 조명 구역: [x, y, 반지름, 색 이름, 세기] ──
  // 원본 드레스에서 밝은 스팽글이 몰린 자리를 가우스 덩어리로 잰 값. 세기는 그 자리의 '반짝이는 면적 비율'.
  const ZONES = {
    dress: [
      // 목선을 따라 가장 밝은 띠
      [640, 800, 45, 'white', 0.22],
      [705, 806, 45, 'white', 0.22],
      [770, 822, 34, 'white', 0.1],
      // 윗단 양쪽 모서리 (왼쪽 겨드랑이 쪽, 오른쪽 가슴 아래)
      [570, 815, 50, 'white', 0.38],
      [545, 855, 40, 'pink', 0.08],
      [762, 888, 45, 'white', 0.17],
      [730, 896, 30, 'white', 0.08],
      [805, 835, 25, 'white', 0.12],
      // 가운데 왼쪽의 옅은 빛 줄
      [530, 880, 30, 'pink', 0.08],
      [600, 912, 35, 'white', 0.07],
      [680, 866, 32, 'white', 0.12],
      // 가운데 남색 반사 속의 파란 스팽글
      [728, 850, 40, 'blue', 0.12],
      [795, 862, 36, 'blue', 0.1],
      [600, 920, 14, 'white', 0.16],
      // 오른쪽 가슴 옆 몸판 조각: 대부분 어둡고 흰 점 몇 개만
      [890, 752, 20, 'white', 0.2],
      // 가운데·아래 몸판: 붉은 분홍 반짝임
      [700, 1022, 28, 'magenta', 0.18],
      [730, 935, 40, 'pink', 0.07],
      [600, 905, 60, 'pink', 0.09],
      [610, 994, 34, 'pink', 0.14],
      [508, 968, 22, 'pink', 0.12],
      [530, 1020, 55, 'pink', 0.07],
      [660, 950, 50, 'pink', 0.04],
      // 아래 몸판: 팔 사이로 보이는 반짝임 무리
      [517, 1200, 28, 'pink', 0.2],
      [545, 1137, 28, 'pink', 0.14],
      [560, 1120, 24, 'pink', 0.12],
      [470, 1175, 45, 'violet', 0.08],
      [450, 1235, 40, 'violet', 0.07],
      [440, 1080, 30, 'white', 0.06],
      [400, 1122, 40, 'white', 0.07],
      [500, 1065, 30, 'pink', 0.09],
    ],
    skirt: [
      [107, 984, 85, 'white', 0.4],
      // 치마 윗단 왼쪽: 가방 아래 가는 그늘 띠 양옆이 밝다
      [40, 935, 45, 'white', 0.3],
      [130, 878, 35, 'white', 0.25],
      [10, 1133, 85, 'white', 0.24],
      [18, 1122, 26, 'blue', 0.08],
      [189, 870, 62, 'pink', 0.15],
      [40, 1180, 140, 'white', 0.02],
      [46, 1210, 28, 'white', 0.1],
      [200, 1035, 28, 'white', 0.14],
      [0, 1238, 28, 'white', 0.13],
      [151, 1209, 28, 'white', 0.05],
      [87, 1253, 43, 'white', 0.05],
      [116, 1150, 28, 'white', 0.08],
      [91, 1189, 28, 'white', 0.05],
      [235, 1110, 60, 'pink', 0.06],
    ],
  };
  // 구역 밖의 바탕 비율 — 스팽글 몇 개는 어디서나 반짝인다. 몸판은 아래로 가도 이만큼은 남는다(low).
  const AMBIENT = { dress: 0.04, skirt: 0.05 };
  const AMBIENT_LOW = { y0: 1000, y1: 1080, add: 0.06, col: '#c84ee0' };
  // 치마 왼쪽 아래: 이웃한 밝은 스팽글이 은빛 덩어리로 뭉친다 [x, y, 반지름]
  const MERGE = [40, 1180, 140];
  // 천의 어두운 주름 골: [점들, 폭(px), 깊이(밝기에서 빼는 비율)]. 원본의 밝은 띠 사이 골을 잰 것
  const CREASES = {
    dress: [
      [[[530, 842], [590, 850], [660, 842]], 8, 0.35],
      [[[430, 938], [500, 955], [585, 962]], 11, 0.5],
      [[[700, 925], [765, 936], [835, 918]], 9, 0.4],
      // 허리 접힌 띠의 골: 원본에서 이 띠는 어둡고 작은 붉은 점만 보인다
      [[[540, 960], [610, 972], [690, 968]], 10, 0.55],
      [[[560, 1012], [640, 1016], [710, 1002]], 8, 0.45],
    ],
    skirt: [
      [[[170, 1030], [178, 1110], [192, 1210]], 16, 0.6],
      [[[60, 1150], [120, 1168], [165, 1190]], 11, 0.55],
      [[[236, 972], [208, 1008], [182, 1040]], 12, 0.5],
      [[[20, 1060], [70, 1082], [110, 1100]], 9, 0.45],
      [[[0, 1108], [40, 1120], [90, 1140]], 7, 0.4],
      [[[0, 1186], [50, 1200], [100, 1222]], 7, 0.4],
    ],
  };
  // 표면별 스팽글 모양.
  //   gain     반짝이는 면적 비율 → 밝게 보일 확률
  //   core     빛 받은 면 반지름 = 행 간격 × (core[0] + core[1]·√밝기)
  //   unlit    빛을 못 받은 스팽글: [색 어두운 끝, 밝은 끝, 반지름/행 간격, 불투명도] — 천보다 L* 6~10 밝을 뿐
  //   partial  빛을 비껴 받은(희미하게 물든) 스팽글이 되는 문턱 폭, rings 그 가운데 고리로 보이는 몫
  //   tile     몸통을 행 방향으로 놓인 네모 비늘로 (치마: 가까이서 타일 결이 보인다)
  //   rjit     크기 흔들림(±), spec  빛 받은 것 가운데 '어두운 비늘 + 모서리 반짝임'으로만 보이는 몫
  //   crest    행 단위 마루·골의 대비 [바닥, 폭], pinkish  반쯤 받은 점 가운데 분홍으로 물드는 몫
  const LOOK = {
    dress: {
      gain: 5, core: [0.07, 0.19], unlit: ['#1a0c1e', '#26142c', 0.38, 0.7], partial: 0.6, rings: 0.35,
      rjit: 0.25, spec: 0, crest: [0.45, 0.8], pinkish: 0.5,
    },
    skirt: {
      gain: 6.5, core: [0.11, 0.14], unlit: ['#1c1428', '#2e2240', 0.4, 0.9], partial: 0.4, rings: 0.3,
      tile: true, rjit: 0.35, spec: 0.33, crest: [0.3, 1.05], pinkish: 0.35,
    },
  };
  // 모양 규칙: 초승달 비율, 가운데 구멍 비율, 자리 흔들림(px), 잔주름에 따른 격자 일렁임(px)
  const RULE = { crescent: 0.15, hole: 0.1, jitter: 0.8, warp: 2.2 };
  // 스팽글을 비추는 주 조명 방향(왼쪽 위) — 초승달은 빛 쪽 가장자리만 남는다
  const LIGHT = [-0.6, -0.8];

  // ── 스팽글 행 안내선 (원본 좌표). 이웃 안내선 사이를 행 간격으로 보간해 행을 만든다 ──
  // 몸판: 위는 목선을 따라 휘고, 가슴 아래에서 평평해졌다가 허리에서 접혀 촘촘해지고,
  // 아래쪽은 몸이 기운 쪽으로 기운다.
  // 안내선: { pitch: 행 안에서 스팽글 간격(px), gap: 행 사이 간격(기본 pitch), stretch: 행 방향 납작함, pts: 곡선 }
  // 간격은 원본 몸판 조각마다 격자 주기를 잰 값(윗단 8.6~9px, 접힌 띠 6.7px, 아래 몸판 7~10px)
  const ROWS = {
    dress: {
      pitch: 8.5,
      guides: [
        // 목선 위로 한 겹 더: 오른쪽 가슴 옆 몸판 조각(어깨끈 아래)까지 스팽글이 덮는다
        {
          pitch: 9.4,
          gap: 8.8,
          pts: [[470, 700], [590, 706], [650, 728], [720, 748], [780, 760], [840, 742], [900, 708],
            [975, 676]],
        },
        {
          pitch: 8.8,
          gap: 8.6,
          pts: [[470, 748], [590, 758], [650, 783], [720, 802], [780, 815], [840, 805], [900, 785],
            [975, 757]],
        },
        {
          pitch: 9,
          gap: 8.5,
          pts: [[450, 800], [560, 828], [640, 858], [720, 872], [800, 870], [870, 850], [970, 820]],
        },
        {
          pitch: 9.2,
          gap: 8.8,
          pts: [[420, 900], [520, 942], [600, 960], [680, 962], [760, 950], [850, 925], [960, 895]],
        },
        // 허리의 접힌 띠: 촘촘하고 행 방향으로 납작하다
        {
          pitch: 6.6,
          stretch: 1.4,
          pts: [[380, 990], [470, 1015], [560, 1036], [640, 1022], [720, 1004], [820, 990]],
        },
        // 아래 몸판: 행 안 간격 7px, 행 사이 9.5px, 오른쪽 위로 약 14° 올라간다
        { pitch: 7.1, gap: 9.5, pts: [[340, 1095], [450, 1085], [560, 1060], [640, 1040]] },
        { pitch: 7.1, gap: 9.5, pts: [[250, 1290], [400, 1255], [490, 1232], [600, 1200]] },
      ],
    },
    skirt: {
      pitch: 9.8,
      guides: [
        // 엉덩이를 감아 오른쪽 아래로 약 24° 기운 행, 왼쪽 아래로 내려가는 열 (격자 간격 9.8~11px)
        { pitch: 9.8, pts: [[-40, 690], [180, 800], [400, 900], [530, 970]] },
        { pitch: 9.8, pts: [[-120, 790], [100, 900], [320, 1000], [450, 1070]] },
        // 왼쪽 아래로 가면 행이 거의 수평으로 눕고 열은 곧게 선다 (원본 격자 방향을 조각마다 잰 값)
        { pitch: 10.4, gap: 10, pts: [[-210, 1010], [0, 1098], [110, 1120], [230, 1170], [360, 1250]] },
        { pitch: 11, gap: 10, pts: [[-240, 1330], [0, 1335], [140, 1345], [270, 1400]] },
      ],
    },
  };

  // 목선(드레스 위 가장자리)과 겨드랑이 쪽 검은 안감
  const NECKLINE = [[540, 744], [590, 752], [630, 770], [680, 786], [730, 798], [780, 809], [820, 803],
    [860, 794], [905, 780], [960, 752]];
  // 오른쪽 가슴 옆 몸판 조각의 윗단(목선이 이어지는 곳)
  const SIDE_EDGE = [[806, 804], [835, 791], [856, 789], [876, 765], [896, 740], [921, 713], [934, 721]];
  const LINING = [[572, 722], [592, 722], [606, 740], [620, 756], [632, 772], [600, 778], [565, 778]];

  // 치마에 박힌 큰 원형 장식(라인스톤): x, y, 반지름
  // 위의 것은 푸른 빛을 뿜는 돌, 아래 것은 은빛 고리
  const JEWELS = [[128, 956, 7, 'glow'], [69, 1022, 7, 'ring']];
  // 원본에서 자리를 잰 네 갈래 별빛: x, y, 크기(px), 색, 둘레 빛 반지름(px)
  const GLINTS = [
    [515, 1200, 20, '#ff4aa0', 13],
    [200, 1036, 16, '#ff70c0', 8],
    [108, 982, 13, '#ffffff', 6],
    [160, 903, 13, '#ffd0e8', 6],
    [655, 797, 10, '#ffffff', 0],
  ];
  // 치마 윗단(허리 피부와의 경계)
  const SKIRT_TOP = [[110, 866], [160, 868], [200, 898], [240, 930], [280, 962], [310, 992]];
  // 가방(왼쪽 아래 구겨진 검은 에나멜): 원본에서 잰 면 조각. [점들, 위쪽 색, 아래쪽 색]
  // 맨 위 면만 붉은 조명을 받고(그 안에도 구김 그늘), 나머지는 검정·남색이다.
  const SASH_FACETS = [
    // 붉은 조명을 받는 윗면
    [[[-10, 898], [40, 868], [84, 843], [100, 853], [118, 866], [104, 876], [70, 889], [36, 901], [-10, 918]],
      '#b8215d', '#4a1036'],
    // 윗면 안의 구김 그늘
    [[[50, 866], [64, 856], [74, 858], [60, 870]], '#170a22', '#170a22'],
    [[[14, 893], [34, 878], [44, 876], [26, 892], [16, 898]], '#170a22', '#170a22'],
    [[[70, 884], [92, 870], [100, 872], [80, 884]], '#1e0c28', '#1e0c28'],
    [[[30, 870], [44, 864], [36, 872]], '#2a0c2c', '#2a0c2c'],
    // 오른쪽 위 두 번째 혹: 검정에 남색 면
    [[[100, 853], [108, 840], [122, 834], [162, 826], [185, 842], [176, 856], [150, 870], [128, 878],
      [118, 866]], '#1a0e2a', '#100818'],
    [[[124, 842], [158, 833], [170, 846], [146, 858], [128, 860]], '#232048', '#161430'],
    // 아래 몸통의 남색 면 둘과 왼쪽 가장자리의 붉은 면
    [[[10, 918], [50, 903], [88, 888], [78, 920], [36, 948], [8, 950]], '#1c1e48', '#100e22'],
    [[[44, 962], [84, 928], [104, 912], [98, 944], [66, 972]], '#181840', '#0e0c20'],
    [[[-10, 918], [8, 916], [12, 940], [4, 962], [-10, 964]], '#8a1a4a', '#3a0e30'],
  ];
  // 면 가장자리의 가는 분홍 반사: [점들, 굵기, 색]
  const SASH_RIMS = [
    [[[0, 897], [40, 872], [82, 848]], 2.6, '#f0307a'],
    [[[88, 850], [104, 858], [116, 867]], 2, '#e02a6a'],
    [[[110, 842], [134, 833], [160, 830]], 1.5, '#c0306a'],
    [[[3, 921], [8, 936], [5, 954]], 2, '#d0204a'],
    [[[54, 902], [80, 892]], 1.2, '#6a7ad0'],
  ];
  // 면 사이의 구김 선: [점들, 굵기]
  const SASH_CREASES = [
    [[[10, 918], [50, 903], [88, 888]], 2.4],
    [[[8, 950], [36, 948], [78, 920], [104, 912]], 2],
    [[[100, 853], [118, 866], [128, 878]], 1.8],
    [[[66, 972], [98, 944]], 1.6],
    [[[44, 962], [70, 945]], 1.4],
  ];
  // 치마 윗단을 따라 박힌 구슬 줄
  const SASH_BEADS = [[96, 880], [120, 868], [140, 862], [160, 858], [178, 856]];

  // 목·가슴의 또렷한 셀 그림자: [점들, 단계(1..4), 흐림 px] (부드러운 곡선)
  const TORSO_CEL = [
    // 가슴골 그늘 (오른쪽 가슴 안쪽 윤곽 아래)
    [[[760, 790], [776, 760], [794, 722], [800, 742], [790, 772], [778, 800], [762, 800]], 2, 1.5],
    // 턱 밑에 드리운 그늘
    [[[790, 430], [830, 454], [868, 472], [906, 468], [948, 450], [934, 474], [904, 490], [876, 500],
      [854, 506], [836, 490], [814, 462]], 3, 0.8],
  ];
  // 목의 평면: 곧은 변으로 꺾이는 셀 면 [점들, 색, 흐림 px]. 원본에서 잰 자리, 아래 것이 위에 덮인다.
  const NECK_PLANES = [
    // 목 앞면: 빛을 받는 밝은 면
    [[[770, 474], [800, 464], [826, 494], [848, 530], [854, 556], [832, 568], [796, 573], [776, 562],
      [766, 520]], '#fdcdb0', 0.8],
    // 목 오른쪽: 밝은 면과 그늘 사이의 중간 띠
    [[[792, 456], [818, 456], [846, 490], [866, 530], [868, 562], [856, 568], [850, 538], [828, 500]],
      '#ea9888', 0.7],
    // 목 오른쪽 옆면의 그늘 삼각형 (아래 꼭짓점에서 밝은 가슴이 시작된다)
    [[[816, 456], [880, 460], [962, 448], [950, 482], [908, 530], [874, 572], [851, 597], [858, 566],
      [862, 530], [842, 490]], '#d07a78', 0.6],
    // 턱 밑 그늘 삼각형 속의 더 진한 오른쪽 위 (턱이 드리운 그늘)
    [[[864, 462], [962, 448], [952, 476], [922, 512], [896, 500]], '#c1676b', 0.8],
    // 목 아래 우묵한 곳(V): 목 앞면 아래에서 그늘 삼각형 꼭짓점으로 좁아든다
    [[[834, 570], [854, 560], [862, 568], [851, 600], [842, 590]], '#e4928a', 1.2],
  ];
  // 빗장뼈: 옅은 연어색 띠와 그 끝의 진한 분홍 혹, 띠 위의 1px 하이라이트 (색은 원본에서 잰 값)
  const COLLAR = {
    band: [[[667, 564], [680, 586], [692, 607], [703, 627]], 11, '#fcbaa5'],
    knob: [[[697, 623], [714, 628], [722, 647], [704, 652]], '#f0907f'],
    hi: [[[660, 572], [673, 593], [685, 613]], 1, '#fbe0cc'],
  };
  // 허리의 셀 그림자: 오른쪽 위 머리카락 그늘, 치마 단을 따라 진 그늘
  const WAIST_CEL = [
    [[[244, 852], [270, 846], [290, 852], [298, 866], [284, 872], [262, 866]], 2, 1.2],
    [[[190, 893], [209, 912], [259, 951], [289, 971], [300, 985], [305, 965], [268, 940], [218, 901],
      [203, 886]], 2, 2],
  ];
  // 손으로 잰 그늘 띠: [부위, 중심선, 최대 폭(px), 색, 불투명도, 흐림 px]. 양 끝이 가늘어진다.
  const SHADE_RIBBONS = [
    // 어깨 위: 머리카락이 드리운 그늘
    ['arm', [[548, 467], [572, 467], [596, 475], [618, 485], [638, 488]], 11, '#eaa496', 0.75, 2.5],
  ];
  // 피부의 작은 윤기(흰 점·짧은 획): [점들, 굵기]
  const SHINES = [
    [[[597, 501], [600, 505]], 1.6],
    [[[606, 536], [607, 540]], 1.4],
    [[[792, 520], [794, 522]], 1.6],
    [[[688, 690], [692, 700]], 1.2],
    // 안감 가장자리에 걸린 빛
    [[[594, 725], [601, 733], [607, 741]], 1.6],
  ];

  // ── 손으로 그린 안쪽 선: [점들, 굵기] (빗장뼈·가슴골·겨드랑이·팔꿈치 주름) ──
  const INNER_LINES = [
    // 오른쪽 가슴 안쪽 윤곽(가슴골): 가는 곡선 하나
    [[[802, 712], [796, 740], [786, 768], [774, 798]], 1, '#b05a5a'],
    [[[820, 666], [838, 650], [858, 640]], 1.4],
    [[[590, 676], [585, 700], [579, 722]], 1.6],
    [[[368, 1030], [376, 1050], [380, 1072]], 1.2],
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
    for (let i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return L;
  }
  // 호 길이 비율 s(0..1) 위치. pts는 촘촘하게 다시 찍은 곡선
  function at(dense, s) {
    const n = dense.length - 1;
    const f = Math.min(Math.max(s, 0), 1) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const u = f - i;
    const p = dense[i];
    const q = dense[i + 1];
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
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
    // stops: [위치, 단계 번호(0 하이라이트, 1 바탕, 2.. 그림자)] — 밝은 곳에서 그늘로 이어지는 바탕을 직접 줄 때
    const stops = opts.stops || [[0, -1], [0.6, 1], [1, -2]];
    for (const [t, k] of stops) {
      // -1: 바탕에 하이라이트를 조금, -2: 바탕에 따뜻한 반사광을 조금
      let col = tone[k];
      if (k === -1) col = C.mixColor(tone[1], tone[0], 0.15);
      else if (k === -2) col = C.mixColor(tone[1], SKIN.warm, 0.3);
      lin.addColorStop(t, col);
    }
    g.fillStyle = lin;
    g.fillRect(0, 0, env.W, env.H);
    // 셀 그림자 단계: 그림자 1..4, 마지막에 하이라이트. 단계마다 분홍 조명 쪽으로 기우는 그라디언트
    // levels로 생성된 단계 가운데 일부만 쓸 수 있다
    const order = [1, 2, 3, 4, 0].filter((k) => !opts.levels || opts.levels.includes(k));
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
    // 손으로 잰 곧은 셀 면(목의 평면들): [점들, 색, 흐림]
    for (const [pts, col, blur] of opts.planes || []) {
      g.save();
      if (blur > 0) g.filter = `blur(${blur}px)`;
      g.fillStyle = col;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.restore();
    }
    // 손으로 잰 또렷한 셀 그림자(턱 밑 그늘 같은 것): [점들, 단계, 흐림]
    for (const [pts, k, blur] of opts.cel || []) {
      g.save();
      if (blur > 0) g.filter = `blur(${blur}px)`;
      g.fillStyle = tone[k + 1];
      g.fill(new Path2D(C.smoothPath(pts, true, 0.35)));
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

  // 림 라이트 규칙: 보이는 윤곽 마디마다 바깥 법선이 조명 쪽을 볼수록 안쪽으로 번지는 띠를 그린다.
  // lights: [[빛 방향 x, y], 색, 폭(px), 세기]
  function rimLight(g, env, shape, edges, lights, tmp) {
    const C = env.core;
    const t = tmp.getContext('2d');
    const segs = [];
    for (const r of edges) {
      const pts = resample(chaikin(flat(r), false, 2), 4);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        let nx = y0 - y1;
        let ny = x1 - x0;
        const d = Math.hypot(nx, ny) || 1;
        nx /= d;
        ny /= d;
        // 법선이 부위 안쪽을 보면 뒤집는다
        if (g.isPointInPath(shape.path, (x0 + x1) / 2 + nx * 3, (y0 + y1) / 2 + ny * 3, 'evenodd')) {
          nx = -nx;
          ny = -ny;
        }
        segs.push([x0, y0, x1, y1, nx, ny]);
      }
    }
    for (const [[lx, ly], col, width, alpha] of lights) {
      const ln = Math.hypot(lx, ly);
      t.clearRect(0, 0, tmp.width, tmp.height);
      t.lineCap = 'round';
      t.lineWidth = width;
      for (const [x0, y0, x1, y1, nx, ny] of segs) {
        const k = (nx * lx + ny * ly) / ln;
        if (k <= 0.05) continue;
        t.strokeStyle = C.rgba(col, alpha * k);
        t.beginPath();
        t.moveTo(x0, y0);
        t.lineTo(x1, y1);
        t.stroke();
      }
      // 한 번에 흐려서 부위 안쪽에만 얹는다
      g.save();
      g.clip(shape.path, 'evenodd');
      g.filter = `blur(${(width / 3).toFixed(1)}px)`;
      g.drawImage(tmp, 0, 0);
      g.restore();
    }
  }

  // ── 드레스 ─────────────────────────────────────────────
  function makeRows(spec) {
    const guides = spec.guides.map((gd) => {
      const dense = resample(chaikin(gd.pts, false, 3), 2);
      const pitch = gd.pitch || spec.pitch;
      return { dense, len: polyLength(dense), pitch, gap: gd.gap || pitch, stretch: gd.stretch || 1 };
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
      const pv = (A.gap + B.gap) / 2;
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

  // 스팽글 자리의 조명: 구역 가우스 합(음수 세기 = 그늘) × 큰 노이즈. 색은 구역 색의 가중 평균(반쯤 받은
  // 점용). 심 색을 고를 때 쓰는 흰·분홍·파랑 구역의 무게(cls)도 함께 돌려준다.
  const CLASS = { white: 0, pink: 1, magenta: 1, blue: 2 };
  function lightAt(zones, amb, x, y, noise, base) {
    let I = amb;
    let r = 0;
    let gg = 0;
    let b = 0;
    let wsum = 0;
    const cls = [0, 0, 0];
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
      if (cname in CLASS) cls[CLASS[cname]] += w;
    }
    I = Math.max(0, I) * (0.7 + 0.6 * (noise(x * 0.012, y * 0.012) * 0.5 + 0.5));
    const k = 0.05;
    const n = wsum + k;
    const col = [(r + base[0] * k) / n, (gg + base[1] * k) / n, (b + base[2] * k) / n];
    return { I, col, cls };
  }

  // 빛 받은 스팽글 심의 색 갈래: 바탕 몫(표면·높이별)에 조명 구역 색의 무게를 더해 고른다
  function coreKind(name, x, y, L, pick, top, C) {
    let sp;
    let sb;
    if (name === 'skirt') [sp, sb] = SHARE.skirt;
    else {
      // 윗단 → 가운데 → 아래 몸판(무대 바닥의 푸른 보라 조명)
      const m = C.smoothstep(850, 920, y);
      const lo = C.smoothstep(AMBIENT_LOW.y0, AMBIENT_LOW.y1, y);
      sp = SHARE.top[0] + (SHARE.mid[0] - SHARE.top[0]) * m + (SHARE.low[0] - SHARE.mid[0]) * lo;
      sb = SHARE.top[1] + (SHARE.mid[1] - SHARE.top[1]) * m + (SHARE.low[1] - SHARE.mid[1]) * lo;
      // 윗단 띠: 왼쪽은 붉은 분홍, 오른쪽은 파랑이 더 섞인다
      sp += TOPROW.pink * top * (1 - C.smoothstep(620, 760, x));
      sb += TOPROW.blue * top * C.smoothstep(700, 780, x) * (1 - C.smoothstep(840, 870, x));
    }
    const [ww, wp, wb] = L.cls;
    const n = SHARE_K + ww + wp + wb;
    const p = (sp * SHARE_K + wp) / n;
    const b = (sb * SHARE_K + wb) / n;
    return pick < p ? 'pink' : pick < p + b ? 'blue' : 'white';
  }

  // 점에서 꺾은선까지의 거리
  function distToPoly(pts, x, y) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const u = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + dx * u - x, ay + dy * u - y));
    }
    return best;
  }

  // 스팽글 하나하나: 빛을 못 받은 것은 천에 묻히고(희미한 원판), 비껴 받은 것은 작고 흐린 색점,
  // 빛을 받은 것은 3~5px의 꽉 찬 하이라이트(일부는 초승달, 드물게 가운데 구멍)로 그린다.
  function drawSequins(g, env, path, name, rng, noise, fx) {
    const C = env.core;
    const spec = ROWS[name];
    const zones = ZONES[name];
    const look = LOOK[name];
    const creases = CREASES[name].map(([pts, w, d]) => [chaikin(pts, false, 2), w, d]);
    const rows = makeRows(spec);
    const dim = C.hexToRgb(DRESS.dim);
    const white = CORE.rgb.white[0];
    const neck = chaikin(NECKLINE, false, 2);
    const un0 = C.hexToRgb(look.unlit[0]);
    const un1 = C.hexToRgb(look.unlit[1]);
    const TAU = Math.PI * 2;
    const ell = (x, y, rx, ry, rot) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, rot, 0, TAU);
      g.fill();
    };
    g.save();
    g.clip(path, 'evenodd');
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.count; i++) {
        const s = (i + 0.5) / row.count;
        const a = at(row.A, s);
        const b = at(row.B, s);
        // 천의 잔주름이 격자를 살짝 일렁이게 한다(큰 노이즈) + 스팽글마다 작은 흔들림.
        // 난수는 갈래와 상관없이 늘 같은 개수를 뽑는다 → 한 스팽글을 고쳐도 이웃 무늬가 그대로
        const gx = a[0] + (b[0] - a[0]) * row.f;
        const gy = a[1] + (b[1] - a[1]) * row.f;
        const x = gx + RULE.warp * noise(gx * 0.025, gy * 0.025 + 50) + (rng() - 0.5) * 2 * RULE.jitter;
        const y = gy + RULE.warp * noise(gx * 0.025 + 50, gy * 0.025) + (rng() - 0.5) * 2 * RULE.jitter;
        const facet = rng();
        const rj = rng();
        const hue = rng();
        const shp = rng();
        const rot = rng() * Math.PI;
        const pick = rng();
        if (!g.isPointInPath(path, x, y, 'evenodd')) continue;
        // 아래 몸판은 무대 바닥의 분홍·보라 조명을 받는다: 바탕 비율과 바탕 색이 아래로 갈수록 바뀐다
        const low = name === 'dress' ? C.smoothstep(AMBIENT_LOW.y0, AMBIENT_LOW.y1, y) : 0;
        const amb = AMBIENT[name] + AMBIENT_LOW.add * low;
        const L = lightAt(zones, amb, x, y, noise, mix3(SEQ.rgb.lavender, AMBIENT_LOW.rgb, low));
        // 주름: 행을 따라 길게 이어지고 행을 가로질러 빨리 바뀌는 노이즈 → 가로로 어두운 골
        const fold = C.smoothstep(-0.6, 0.4, noise(s * 3.1 + 17.3, j * 0.21 + row.f));
        // 행을 따라 이어지는 반짝임 줄무늬(이웃 스팽글끼리 닮게)
        const streak = C.smoothstep(-0.55, 0.55, noise(s * 14 + j * 0.37, j * 0.9));
        // 몇 줄마다 빛을 받는 마루와 그늘진 골이 번갈아 든다 (행 단위로 밝기가 갈린다)
        const crest = C.smoothstep(-0.45, 0.35, noise(s * 1.7 + 40.3, j * 0.55));
        let crease = 1;
        for (const [pts, w, d] of creases) {
          const dd = distToPoly(pts, x, y) / w;
          crease *= 1 - d * Math.exp(-dd * dd);
        }
        // 밝게 보일 확률 p와 이 스팽글의 기울기(facet): facet < p면 반짝인다. 차이가 클수록 희게.
        // 주름 골은 밝은 곳에서도 어둡게 남도록 확률을 자른 뒤에 곱한다
        const shade = (0.7 + 0.45 * fold) * (0.6 + 0.8 * streak) * (look.crest[0] + look.crest[1] * crest);
        const p = C.clamp(look.gain * L.I * shade, 0, 0.98) * crease;
        // 행 방향(접힌 띠에서는 스팽글이 행을 따라 납작하게 눕는다)
        const p0 = at(row.A, s - 0.002);
        const p1 = at(row.A, s + 0.002);
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const sx = row.stretch;
        const sy = 1 / Math.sqrt(row.stretch);
        // 1) 스팽글 몸통: 천보다 아주 조금 밝은 원판 — 가까이서만 비늘 결이 보인다
        const ur = row.pitch * look.unlit[2];
        const lit = Math.min(1, L.I * 3 * crease);
        const bodyRgb = mix3(un0, un1, rj);
        g.fillStyle = C.rgba(bodyRgb, look.unlit[3] * (0.6 + 0.4 * hue) * (0.35 + 0.65 * lit));
        if (look.tile) {
          g.save();
          g.translate(x, y);
          g.rotate(ang);
          g.fillRect(-ur, -ur * 0.9, ur * 2, ur * 1.8);
          g.restore();
        } else ell(x, y + ur * 0.1, ur * sx, ur * sy, ang);
        if (facet >= p) {
          // 2) 빛을 비껴 받은 스팽글: 작고 흐린 자주·분홍 점 (문턱 바로 위만). 보라 조명은 여기만 물들인다
          const q = (facet - p) / look.partial;
          if (q < 1 && p > 0.02) {
            // 일부는 붉은 자주 고리(가장자리만 빛을 받은 것), 나머지는 작은 점
            const tint = hue < look.pinkish ? SEQ.rgb.pink : hue < look.pinkish + 0.1 ? SEQ.rgb.blue : L.col;
            const c = C.rgba(mix3(dim, tint, 0.3 + 0.4 * (1 - q)), 0.55 + 0.4 * (1 - q));
            if (shp < look.rings * (1 - low)) {
              g.strokeStyle = c;
              g.lineWidth = 1;
              g.beginPath();
              g.ellipse(x, y, ur * 0.6 * sx, ur * 0.55 * sy, ang, 0, TAU);
              g.stroke();
            } else {
              g.fillStyle = c;
              const pr = row.pitch * 0.15 * (0.8 + 0.5 * rj);
              ell(x, y, pr, pr * (0.7 + 0.3 * shp), rot);
            }
          }
          continue;
        }
        // 3) 빛을 받은 스팽글: 심 색은 흰빛·붉은 분홍·파랑 가운데 하나 (자리마다 몫이 다르다)
        const b2 = C.clamp((p - facet) / 0.5, 0, 1);
        // 목선 쪽 윗단 띠(top 0..1)와 치마 왼쪽 아래 뭉침 구역(mz 0..1)
        const dn = name === 'dress' ? distToPoly(neck, x, y) : 1e9;
        const top = 1 - C.smoothstep(TOPROW.dist * 0.5, TOPROW.dist, dn);
        const mz = name === 'skirt'
          ? Math.exp(-((x - MERGE[0]) ** 2 + (y - MERGE[1]) ** 2) / (MERGE[2] * MERGE[2])) : 0;
        const kind = coreKind(name, x, y, L, pick, top, C);
        const pal = kind === 'white' ? (mz > 0.35 ? CORE.rgb.silver : CORE.rgb.white)
          : kind === 'blue' ? (mz > 0.35 ? CORE.rgb.ice : CORE.rgb.blue) : CORE.rgb.pink;
        const col = pal[Math.floor(((pick * 13.7) % 1) * pal.length)];
        const fillRgb = b2 < 0.3 ? mix3(dim, col, 0.55 + 1.5 * b2) : col;
        const size = (1 + (rj - 0.5) * 2 * look.rjit) * (1 + TOPROW.grow * top) * (1 + 0.4 * mz * b2);
        const r = row.pitch * (look.core[0] + look.core[1] * Math.sqrt(b2)) * size;
        const fsx = Math.min(sx, 1.25) * (1 + 0.35 * mz);
        const fsy = 1 / Math.sqrt(Math.min(sx, 1.25));
        if (look.spec && (shp * 7.3) % 1 < look.spec && b2 < 0.85 && mz < 0.5) {
          // 3a) 어두운 비늘에 빛 쪽 모서리만 반짝인다 (치마: 가까이서 네모 비늘 결이 보인다)
          g.fillStyle = C.rgba(bodyRgb, 1);
          g.save();
          g.translate(x, y);
          g.rotate(ang);
          g.fillRect(-ur, -ur * 0.9, ur * 2, ur * 1.8);
          g.restore();
          g.fillStyle = C.rgba(fillRgb, 1);
          const cr = 0.9 + 1.1 * b2;
          ell(x + LIGHT[0] * ur * 0.6, y + LIGHT[1] * ur * 0.6, cr * 1.2, cr * 0.9, rot);
          continue;
        }
        // 밝은 것은 둘레에 제 색 빛이 살짝 번진다
        if (b2 > 0.75) {
          g.fillStyle = C.rgba(col, 0.04 + 0.06 * b2);
          ell(x, y, r * 1.6, r * 1.5, rot);
        }
        g.fillStyle = C.rgba(fillRgb, 1);
        // 꽉 찬 하이라이트: 타원 하나에 작은 혹을 붙여 모양을 들쭉날쭉하게. 뭉침 구역은 행 방향으로 길다
        ell(x, y, r * fsx, r * (0.72 + 0.28 * shp) * fsy, mz > 0.2 ? ang : rot);
        if (b2 > 0.35) {
          const ba = rot * 2 + hue * 6;
          ell(x + Math.cos(ba) * r * 0.4, y + Math.sin(ba) * r * 0.4, r * 0.6, r * 0.5, rot);
        }
        if (shp < RULE.crescent && mz < 0.3) {
          // 초승달: 빛 반대쪽으로 민 몸통 색 타원이 하이라이트를 가린다
          g.fillStyle = C.rgba(bodyRgb, 1);
          ell(x - LIGHT[0] * r * 0.6, y - LIGHT[1] * r * 0.6, r * 0.75, r * 0.75, rot);
        } else if (b2 > 0.5 && shp > 1 - RULE.hole) {
          // 드물게 가운데 구멍이 비친다
          g.fillStyle = C.rgba(SEQ.body, 0.75);
          ell(x, y, r * 0.34, r * 0.3, rot);
        } else if (b2 > 0.75 && kind !== 'white') {
          // 가장 밝은 색 스팽글은 빛 쪽에 흰 심
          const k = (b2 - 0.75) / 0.25;
          g.fillStyle = C.rgba(white, 0.35 + 0.5 * k);
          ell(x + LIGHT[0] * r * 0.15, y + LIGHT[1] * r * 0.15, r * 0.5, r * 0.45, rot);
        }
        // 움직일 때 반짝일 후보와, 빛줄기가 지나갈 때 밝아질 하이라이트 판
        if (b2 > 0.35) {
          if (facet < 0.16) fx.twinkles.push([x, y, r * 3, hue]);
          fx.spec.fillStyle = C.rgba(mix3(col, white, 0.4), b2);
          fx.spec.beginPath();
          fx.spec.arc(x, y, r * 1.2, 0, TAU);
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
  // glow: 별 둘레에 번지는 제 색 빛의 반지름(px)
  function starSprite(env, size, col, glow) {
    const R = Math.ceil(Math.max(size, glow)) + 2;
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    if (glow > 0) {
      const C = env.core;
      const rg = g.createRadialGradient(R, R, 0, R, R, glow);
      rg.addColorStop(0, C.rgba('#ffffff', 1));
      rg.addColorStop(0.3, C.rgba(col, 0.85));
      rg.addColorStop(1, C.rgba(col, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, R * 2, R * 2);
    }
    star(g, env.core, R, R, size, col, 1);
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

  function drawFabric(g, env, path, opts) {
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

  // 가방: 아주 검은 바탕 위에 잰 면 조각을 위→아래 그라디언트로 채우고, 능선에만 가는 분홍 반사를 긋는다
  function drawSash(g, env, path, noise) {
    const C = env.core;
    g.save();
    g.clip(path, 'evenodd');
    g.fillStyle = DRESS.base;
    g.fillRect(-20, 800, 240, 220);
    for (const [pts, top, bottom] of SASH_FACETS) {
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [, y] of pts) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const lg = g.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, top);
      lg.addColorStop(1, bottom);
      g.fillStyle = lg;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
    // 치마 윗단 쪽으로 번지는 붉은 반사
    const rg = g.createRadialGradient(140, 884, 0, 140, 884, 16);
    rg.addColorStop(0, C.rgba('#d02a6a', 0.55));
    rg.addColorStop(1, C.rgba('#d02a6a', 0));
    g.fillStyle = rg;
    g.fillRect(120, 864, 40, 40);
    for (const [pts, w] of SASH_CREASES) inkLine(g, pts, w, C.rgba('#06030a', 0.9), noise, 31, true);
    for (const [pts, w, col] of SASH_RIMS) inkLine(g, pts, w, col, noise, 37, true);
    // 구슬: 흰색과 분홍이 번갈아
    resample(chaikin(SASH_BEADS, false, 2), 5).forEach(([x, y], i) => {
      g.fillStyle = i % 3 === 1 ? '#ff7ab8' : '#f4eeff';
      g.beginPath();
      g.arc(x, y, 1.6 + (i % 2) * 0.4, 0, Math.PI * 2);
      g.fill();
    });
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
      CORE.rgb = {};
      for (const k in CORE) if (k !== 'rgb') CORE.rgb[k] = CORE[k].map((h) => C.hexToRgb(h));
      SEQ.body = C.hexToRgb(DRESS.scale);
      AMBIENT_LOW.rgb = C.hexToRgb(AMBIENT_LOW.col);
      const noise = C.makeNoise2D(C.hashString('body') ^ env.seed);
      const rng = env.rng('body');

      const shapes = {};
      for (const name in D.shapes) {
        // 몸통 단계는 평면처럼 꺾이도록 덜 다듬는다
        const iters = name === 'torso' ? 1 : 2;
        shapes[name] = {
          path: ringsPath(D.shapes[name]),
          bands: (D.bands[name] || []).map((lv) => (lv.length ? ringsPath(lv, iters) : null)),
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
        blur: [1.5, 0.9, 0.9, 0.8, 0.6], // 또렷한 셀 경계 (모양 자체는 proc_body.py가 곧은 마디로 줄여 둔다)
        planes: NECK_PLANES,
        cel: TORSO_CEL,
        rim: [[960, 700, 160, '#ff70b0', 0.35]],
      });
      // 허리: 왼쪽 위의 빛에서 드레스·팔 쪽 연어색 그늘로 이어지는 바탕 + 깊은 단계만
      drawSkin(g, env, shapes, 'waist', {
        grad: [200, 855, 305, 975],
        stops: [[0, 0], [0.3, 1], [0.55, 2], [0.8, 3], [1, 4]],
        levels: [3, 4],
        cel: WAIST_CEL,
        rim: [[200, 880, 80, '#ff6aa0', 0.3]],
      });

      // 2) 드레스: 몸판, 치마, 가방
      const spec = env.makeCanvas(W, H);
      const fx = { sparkles: GLINTS, twinkles: [], spec: spec.getContext('2d') };
      drawFabric(g, env, shapes.dress.path, {
        sheen: [
          [700, 830, 160, DRESS.sheen, 0.35],
          [600, 1000, 140, DRESS.violet, 0.2],
          [500, 1180, 120, '#3a1840', 0.3],
          [750, 870, 80, '#34208a', 0.42], // 가운데 남보라 반사
          [795, 862, 45, '#2c3cb0', 0.35], // 오른쪽 가슴 아래 푸른 반사
          [820, 900, 90, '#1c1a50', 0.3],
        ],
      });
      drawSequins(g, env, shapes.dress.path, 'dress', rng, noise, fx);
      drawFabric(g, env, shapes.skirt.path, {
        sheen: [
          [100, 1000, 170, DRESS.sheen, 0.4],
          [20, 1140, 120, '#1a2060', 0.4],
        ],
      });
      drawSequins(g, env, shapes.skirt.path, 'skirt', rng, noise, fx);
      // 치마 윗단: 허리 피부와 닿는 가장자리의 검은 띠
      g.save();
      g.clip(shapes.skirt.path, 'evenodd');
      inkLine(g, chaikin(SKIRT_TOP, false, 3), 5, DRESS.deep, noise, 19, false);
      g.restore();
      drawSash(g, env, shapes.sash.path, noise);
      for (const [x, y, r, kind] of JEWELS) {
        if (kind === 'glow') {
          const jg = g.createRadialGradient(x, y, 0, x, y, r * 2);
          jg.addColorStop(0, '#ffffff');
          jg.addColorStop(0.3, '#f4f4ff');
          jg.addColorStop(0.55, C.rgba('#98a8ff', 0.75));
          jg.addColorStop(1, C.rgba('#5060e0', 0));
          g.fillStyle = jg;
          g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
        } else {
          g.fillStyle = '#2a2440';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#ddd4f4';
          g.lineWidth = 2.2;
          g.beginPath();
          g.arc(x, y, r - 1.2, 0, Math.PI * 2);
          g.stroke();
          // 고리 안쪽의 반사
          g.lineWidth = 1.4;
          g.strokeStyle = '#f4eeff';
          g.beginPath();
          g.arc(x, y, r * 0.45, Math.PI * 0.6, Math.PI * 1.7);
          g.stroke();
        }
      }

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
        for (const r of D.edges[name] || []) {
          inkLine(g, chaikin(flat(r), false, 2), 2.2, DRESS.line, noise, 13, false);
        }
      }
      // 가슴 옆 몸판 조각의 윗단: 4px 검은 단 + 1px 보라 윤기, 목선 먹선을 이어 긋는다
      g.save();
      g.clip(shapes.dress.path, 'evenodd');
      const side = resample(chaikin(SIDE_EDGE, false, 2), 2);
      g.fillStyle = '#0e0814';
      g.fill(ribbon(side, (u) => 4.5 * Math.min(1, u * 8), 2.4));
      g.fillStyle = C.rgba('#3a2a50', 0.9);
      g.fill(ribbon(side, (u) => 1.1 * Math.min(1, u * 8, (1 - u) * 8), 4.4));
      g.restore();
      inkLine(g, SIDE_EDGE, 2, DRESS.line, noise, 13, false);

      // 3) 앞쪽 팔
      drawSkin(g, env, shapes, 'arm', {
        grad: [470, 470, 330, 1254],
        rim: [
          [420, 1120, 150, '#ff7aa8', 0.35],
          [600, 720, 90, '#ff9a9a', 0.3],
        ],
      });

      // 림 라이트: 왼쪽 위 흰 조명은 크림색, 오른쪽·아래 분홍 조명은 분홍으로 가장자리를 물들인다
      const RIM = [
        [[-0.6, -0.8], '#fff6ea', 10, 0.45],
        [[0.85, 0.35], '#ff7eb0', 14, 0.3],
      ];
      const tmp = env.makeCanvas(W, H);
      for (const name of ['fore', 'waist', 'arm']) {
        rimLight(g, env, shapes[name], D.edges[name] || [], RIM, tmp);
      }

      // 빗장뼈: 굽은 그늘 띠 + 끝의 분홍 혹 + 위쪽 1px 하이라이트
      g.save();
      g.clip(shapes.torso.path, 'evenodd');
      g.filter = 'blur(0.7px)';
      {
        const [pts, w, col] = COLLAR.band;
        g.fillStyle = col;
        const line = resample(chaikin(pts, false, 3), 3);
        g.fill(ribbon(line, (u) => w * Math.pow(Math.sin(Math.PI * u), 0.5), 0));
        g.fillStyle = COLLAR.knob[1];
        g.fill(new Path2D(C.smoothPath(COLLAR.knob[0], true, 0.4)));
      }
      g.filter = 'none';
      inkLine(g, COLLAR.hi[0], COLLAR.hi[1], COLLAR.hi[2], noise, 5, true);
      g.restore();

      for (const [part, pts, w, col, a, blur] of SHADE_RIBBONS) {
        g.save();
        g.clip(shapes[part].path, 'evenodd');
        g.filter = `blur(${blur}px)`;
        g.fillStyle = C.rgba(col, a);
        const line = resample(chaikin(pts, false, 3), 3);
        g.fill(ribbon(line, (u) => w * Math.pow(Math.sin(Math.PI * u), 0.6), 0));
        g.restore();
      }

      // 4) 피부 윤곽선과 안쪽 선
      for (const name of ['fore', 'torso', 'waist', 'arm']) {
        for (const r of D.edges[name] || []) {
          inkLine(g, chaikin(flat(r), false, 2), 2.0, SKIN.line, noise, 7, false);
        }
      }
      for (const [pts, w, col] of INNER_LINES) {
        inkLine(g, pts, w, col || C.rgba(SKIN.line, 0.75), noise, 3, true);
      }

      // 5) 어깨끈
      const strap = resample(chaikin(D.strapL, false, 3), 3);
      g.fillStyle = '#16102a';
      g.fill(ribbon(strap, (u) => 7 + 2 * u * u, 0));
      g.fillStyle = C.rgba('#6a5aa8', 0.75);
      g.fill(ribbon(strap, (u) => 2.2 * Math.sin(Math.PI * Math.min(1, u * 1.15)), -2.4));
      // 어깨·빗장뼈의 작은 윤기
      g.strokeStyle = C.rgba('#fffaf4', 0.8);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const [pts, w] of SHINES) {
        g.lineWidth = w;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }

      // 6) 움직일 때 쓸 것: 별빛 스프라이트, 반짝일 스팽글, 빛줄기가 쓸고 갈 하이라이트 판
      // 하이라이트 판은 드레스 안쪽만 (팔·피부가 덮은 곳은 지운다)
      const sg = fx.spec;
      sg.globalCompositeOperation = 'destination-in';
      sg.fill(shapes.dress.path, 'evenodd');
      sg.globalCompositeOperation = 'destination-out';
      sg.fill(shapes.arm.path, 'evenodd');
      sg.lineWidth = 14;
      sg.stroke(new Path2D(C.smoothPath(NECKLINE)));
      sg.fill(new Path2D(C.smoothPath(LINING, true)));

      const prng = env.rng('body-anim');
      const stars = fx.sparkles.map(([x, y, size, col, glow]) => ({
        x,
        y,
        sp: starSprite(env, size, col, glow),
        w: 1.5 + prng() * 2.5,
        ph: prng() * Math.PI * 2,
      }));
      // 반짝임 후보는 완성된 그림에서 실제로 밝게 보이는 스팽글만 (단·안감·팔에 덮인 것은 뺀다)
      const px = g.getImageData(0, 0, W, H).data;
      const lum = (x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return px[i] * 0.3 + px[i + 1] * 0.55 + px[i + 2] * 0.15;
      };
      const inside = (name, x, y) => g.isPointInPath(shapes[name].path, x, y, 'evenodd');
      const onCloth = (x, y) => !inside('arm', x, y) && (inside('dress', x, y) || inside('skirt', x, y));
      const twinkles = fx.twinkles
        .filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && lum(x, y) > 120 && onCloth(x, y))
        .map(([x, y, r, u]) => ({ x, y, r, w: 2 + u * 5, ph: u * 40 }));
      return { canvas, stars, twinkles, spec, dot: dotSprite(env), tmp: env.makeCanvas(W, H) };
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
