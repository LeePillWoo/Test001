// 절차적 드로잉 레이어: fx — 다 그린 화면에 얹는 후처리.
// 밝은 곳 번짐(bloom), 원본 팔레트 쪽으로의 옅은 색 보정과 비네트·입자(한 장), 반짝이는 네 갈래 별빛.
// 모두 약하게 걸고 맨 위 상수로 조절한다. 다른 레이어가 없어도 동작하고, 인물의 선과 디테일을 덮지 않는다.
// 조절용 주소 옵션 (상수에 곱하는 배율, 0이면 끔): bloom=, grade=, vignette=, grain=, glints=
//   예) layers=stage,fx&bloom=0   번짐 없이 보기
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});

  // ── 조절값 ─────────────────────────────────────────────
  const BLOOM = {
    scale: 0.25, // 축소 배율 (1254 → 314)
    filter: 'brightness(0.75) contrast(3) saturate(1.25)', // 약 0.45~0.9 밝기를 0~1로 펴는 부드러운 문턱
    blur: 5, // 축소 화면에서의 흐림 반경(px), 원래 크기로는 약 4배
    alpha: 0.16,
    op: 'screen',
  };
  const GRADE = {
    alpha: 0.06, // overlay 색 보정 세기
    from: '#ff2a8a', // 왼쪽 위: 자홍
    to: '#3a3cff', // 오른쪽 아래: 남청
  };
  const VIGNETTE = { alpha: 0.3, color: '#0c0420', inner: 0.55 }; // overlay 층 안에서의 세기
  const GRAIN = { alpha: 0.06, size: 256 };
  // 피부 보호: 공용 분석 데이터의 피부·얼굴 윤곽 안에서는 번짐과 색 보정을 이만큼 덜어 낸다.
  // 다른 레이어가 맞춘 피부색을 fx가 바꾸지 않게 한다 (윤곽 데이터가 없으면 건너뛴다).
  const PROTECT = { bloom: 0.8, grade: 0.8, blur: 6 };
  // 네 갈래 별빛: x, y, 크기, 색 (원본의 반짝이는 자리)
  const GLINTS = [
    [200, 1031, 15, '#ffd0f4'],
    [514, 1199, 18, '#ffc0ec'],
    [111, 988, 11, '#ffffff'],
    [161, 906, 10, '#ffe8fa'],
    [1219, 925, 22, '#d8e4ff'],
    [565, 1047, 9, '#ffffff'],
    [38, 1120, 9, '#e0e8ff'],
  ];

  // 주소 옵션으로 세기 배율을 받는다 (없으면 1)
  function knob(env, name) {
    const v = parseFloat(env.params.get(name));
    return Number.isFinite(v) ? Math.max(0, v) : 1;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 가운데가 밝고 네 갈래로 가늘어지는 별빛 스프라이트
  function makeGlint(env, size, color) {
    const R = Math.ceil(size * 1.2) + 2;
    const c = env.makeCanvas(R * 2, R * 2);
    const g = c.getContext('2d');
    g.translate(R, R);
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.45);
    halo.addColorStop(0, rgba('#ffffff', 0.95));
    halo.addColorStop(0.3, rgba(color, 0.6));
    halo.addColorStop(1, rgba(color, 0));
    g.fillStyle = halo;
    g.fillRect(-R, -R, R * 2, R * 2);
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      const grad = g.createLinearGradient(0, 0, size, 0);
      grad.addColorStop(0, rgba('#ffffff', 0.95));
      grad.addColorStop(0.4, rgba(color, 0.55));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -size * 0.09);
      g.lineTo(size, 0);
      g.lineTo(0, size * 0.09);
      g.closePath();
      g.fill();
      g.restore();
    }
    return { canvas: c, R };
  }

  // 피부·얼굴 윤곽(evenodd 고리 목록)을 채운 흐린 가림판. 데이터가 없으면 null.
  // 피부는 고리끼리 구멍을 이루므로 evenodd로, 얼굴 윤곽은 눈·입까지 덮도록 따로 채워 합친다.
  function makeProtect(env, scale) {
    const regions = (env.data && env.data.regions) || {};
    const groups = [regions.skin, regions.face].filter((r) => r && r.length);
    if (!groups.length) return null;
    const c = env.makeCanvas(Math.round(env.W * scale), Math.round(env.H * scale));
    const g = c.getContext('2d');
    g.filter = `blur(${PROTECT.blur * scale}px)`;
    g.scale(scale, scale);
    g.fillStyle = '#fff';
    for (const rings of groups) {
      const path = new Path2D();
      for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          if (i) path.lineTo(ring[i], ring[i + 1]);
          else path.moveTo(ring[i], ring[i + 1]);
        }
        path.closePath();
      }
      g.fill(path, 'evenodd');
    }
    return c;
  }

  // 미리 그린 캔버스를 정지 비트맵으로 굳힌다 (프레임마다 다시 래스터화되지 않게). 안 되면 캔버스 그대로.
  async function freeze(c) {
    if (!c || typeof createImageBitmap !== 'function') return c;
    try {
      return await createImageBitmap(c);
    } catch (err) {
      return c;
    }
  }

  function makeGrain(env) {
    const n = GRAIN.size;
    const c = env.makeCanvas(n, n);
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    const rng = env.rng('fx-grain');
    for (let i = 0; i < n * n; i++) {
      const v = Math.round(128 + (rng() + rng() - 1) * 110);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  P.fx = {
    async prepare(env) {
      const { W, H } = env;
      const sw = Math.round(W * BLOOM.scale);
      const sh = Math.round(H * BLOOM.scale);
      const rng = env.rng('fx');
      const k = {
        bloom: knob(env, 'bloom'),
        grade: knob(env, 'grade'),
        vignette: knob(env, 'vignette'),
        grain: knob(env, 'grain'),
        glints: knob(env, 'glints'),
      };
      const state = {
        k,
        small: env.makeCanvas(sw, sh),
        soft: env.makeCanvas(sw, sh),
        glints: GLINTS.map(([x, y, size, color]) => ({
          x,
          y,
          s: makeGlint(env, size, color),
          w: 1.2 + rng() * 2.2,
          ph: rng() * Math.PI * 2,
        })),
      };
      // 색 보정·비네트·입자는 정적이라 overlay로 얹을 한 장에 굽는다 (프레임마다 전면 합성 한 번)
      const grade = env.makeCanvas(W, H);
      const gg = grade.getContext('2d');
      const lin = gg.createLinearGradient(0, 0, W, H);
      lin.addColorStop(0, rgba(GRADE.from, Math.min(1, GRADE.alpha * k.grade)));
      lin.addColorStop(1, rgba(GRADE.to, Math.min(1, GRADE.alpha * k.grade)));
      gg.fillStyle = lin;
      gg.fillRect(0, 0, W, H);
      const rad = gg.createRadialGradient(W / 2, H / 2, W * 0.5 * VIGNETTE.inner, W / 2, H / 2, W * 0.75);
      rad.addColorStop(0, rgba(VIGNETTE.color, 0));
      rad.addColorStop(1, rgba(VIGNETTE.color, Math.min(1, VIGNETTE.alpha * k.vignette)));
      gg.fillStyle = rad;
      gg.fillRect(0, 0, W, H);
      gg.globalAlpha = Math.min(1, GRAIN.alpha * k.grain);
      gg.fillStyle = gg.createPattern(makeGrain(env), 'repeat');
      gg.fillRect(0, 0, W, H);
      const protectFull = makeProtect(env, 1);
      if (protectFull) {
        gg.globalCompositeOperation = 'destination-out';
        gg.globalAlpha = PROTECT.grade;
        gg.drawImage(protectFull, 0, 0);
      }
      const protect = makeProtect(env, BLOOM.scale);
      [state.grade, state.protect] = await Promise.all([freeze(grade), freeze(protect)]);
      const frozen = await Promise.all(state.glints.map((gl) => freeze(gl.s.canvas)));
      state.glints.forEach((gl, i) => (gl.s.canvas = frozen[i]));
      return state;
    },

    draw(ctx, state, t, env) {
      const { W, H } = env;
      const src = ctx.canvas;

      const k = state.k;

      // 번짐: 축소 → 부드러운 문턱 → 흐림 → 원래 크기로 늘려 screen
      if (k.bloom > 0) {
        const sg = state.small.getContext('2d');
        sg.globalCompositeOperation = 'copy';
        sg.filter = BLOOM.filter;
        sg.drawImage(src, 0, 0, state.small.width, state.small.height);
        sg.filter = 'none';
        const bg = state.soft.getContext('2d');
        bg.globalCompositeOperation = 'copy';
        bg.filter = `blur(${BLOOM.blur}px)`;
        bg.drawImage(state.small, 0, 0);
        bg.filter = 'none';
        if (state.protect) {
          bg.globalCompositeOperation = 'destination-out';
          bg.globalAlpha = PROTECT.bloom;
          bg.drawImage(state.protect, 0, 0);
          bg.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = BLOOM.op;
        ctx.globalAlpha = Math.min(1, BLOOM.alpha * k.bloom);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(state.soft, 0, 0, W, H);
      }

      // 색 보정 + 비네트 + 입자 (overlay: soft-light와 거의 같은 인상에 훨씬 싸다)
      if (k.grade + k.vignette + k.grain > 0) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 1;
        ctx.drawImage(state.grade, 0, 0);
      }

      // 별빛: 각자 다른 빠르기로 반짝인다 (t=0에서는 기본 세기)
      ctx.globalCompositeOperation = 'lighter';
      for (const gl of state.glints) {
        const pulse = 0.75 + 0.25 * Math.cos(t * gl.w + gl.ph) - 0.25 * Math.cos(gl.ph);
        ctx.globalAlpha = Math.max(0, Math.min(1, pulse * k.glints));
        const R = gl.s.R * (0.85 + 0.15 * pulse);
        if (ctx.globalAlpha > 0) ctx.drawImage(gl.s.canvas, gl.x - R, gl.y - R, R * 2, R * 2);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
})();
