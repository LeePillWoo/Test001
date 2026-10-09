// 절차적 드로잉: 레이어 모듈을 순서대로 한 캔버스에 겹쳐 그린다.
//
// 모듈 계약 (window.ConcertProc.<이름>)
//   prepare(env) → state 또는 Promise<state>   무거운 정적 요소를 오프스크린 캔버스에 미리 그린다.
//   drawBack / drawFront / draw (ctx, state, t, env)
//       t는 초 단위 시각. t=0 장면이 원본 구도와 같아야 하고, 같은 t면 언제나 같은 그림이어야 한다.
//       ctx 상태(save/restore)는 오케스트레이터가 감싸 준다.
//   bake(ctx, state, env) → 무엇이든 또는 Promise   (선택)
//       모든 prepare가 끝난 뒤 한 번 불린다. 이때 ctx에는 t=0 장면이 이 모듈의 첫 차례 바로 앞까지
//       그려져 있다. 아래 장면 전체에 기대는 무거운 처리(예: fx의 번짐)를 매 프레임 하지 않고 여기서
//       한 번 구워 둔다. 결과는 t=0 장면에만 기대므로 renderAt(t)는 그전에 무엇을 그렸든 같은 그림이 된다.
//
// 디버그 주소 옵션
//   layers=stage,hair     그 모듈만 그린다
//   under=ref             맨 아래에 원본을 깐다 (레이어 하나만 원본 위에서 맞춰 볼 때)
//   onion=0.5             맨 위에 원본을 그 불투명도로 덮는다
// 준비·굽기에 걸린 시간(ms)은 window.ConcertProc.timing에 남는다.
(function () {
  'use strict';
  const C = window.ConcertCore;
  const P = (window.ConcertProc = window.ConcertProc || {});
  const BASE = 'js/procedural/';
  const PARTS = ['data/analysis.js', 'stage.js', 'hair.js', 'body.js', 'face.js', 'fx.js'];
  const MODULES = ['stage', 'hair', 'body', 'face', 'fx'];
  const ORDER = [
    ['stage', 'drawBack'],
    ['hair', 'drawBack'],
    ['body', 'draw'],
    ['face', 'draw'],
    ['hair', 'drawFront'],
    ['stage', 'drawFront'],
    ['fx', 'draw'],
  ];

  async function loadParts() {
    for (const part of PARTS) {
      try {
        await C.loadScript(BASE + part);
      } catch (err) {
        console.warn(err.message);
      }
    }
  }

  C.define('procedural', {
    async mount(host, opts) {
      await loadParts();
      const { W, H } = C;
      const params = opts.params || new URLSearchParams();
      const only = params.get('layers');
      const enabled = new Set(only ? only.split(',') : MODULES);
      const under = params.get('under');
      const onion = parseFloat(params.get('onion') || '0');
      const ref = under === 'ref' || onion > 0 ? await C.loadImage('assets/reference.jpg') : null;

      const canvas = C.makeCanvas(W, H);
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      const env = {
        W,
        H,
        seed: opts.seed,
        animate: !!opts.animate,
        params,
        data: P.data || {},
        rng: (name) => C.rngFor(opts.seed, name),
        makeCanvas: C.makeCanvas,
        core: C,
      };

      const timing = (P.timing = { prepare: {} });
      const states = {};
      const ready = MODULES.filter((name) => P[name] && enabled.has(name));
      for (const name of ready) {
        const mod = P[name];
        const tp = performance.now();
        states[name] = mod.prepare ? await mod.prepare(env) : {};
        timing.prepare[name] = Math.round(performance.now() - tp);
      }
      // 실제로 그릴 차례만 남긴다
      const steps = ORDER.filter(([name, fn]) => ready.includes(name) && typeof P[name][fn] === 'function');

      function begin() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.clearRect(0, 0, W, H);
        if (ref && under === 'ref') ctx.drawImage(ref, 0, 0, W, H);
        else if (only) {
          ctx.fillStyle = '#808080';
          ctx.fillRect(0, 0, W, H);
        }
      }

      function drawStep([name, fn], t) {
        ctx.save();
        try {
          P[name][fn](ctx, states[name], t, env);
        } finally {
          ctx.restore();
        }
      }

      function frame(t) {
        begin();
        for (const step of steps) drawStep(step, t);
        if (ref && onion > 0) {
          ctx.globalAlpha = onion;
          ctx.drawImage(ref, 0, 0, W, H);
          ctx.globalAlpha = 1;
        }
      }

      // 굽기: t=0 장면을 차례대로 그리다가 bake가 있는 모듈의 첫 차례 앞에서 그때까지의 장면을 넘긴다
      const bakers = ready.filter((name) => typeof P[name].bake === 'function');
      if (bakers.length) {
        const tb = performance.now();
        const left = new Set(bakers);
        begin();
        for (const step of steps) {
          const name = step[0];
          if (left.delete(name)) {
            ctx.save();
            try {
              await P[name].bake(ctx, states[name], env);
            } finally {
              ctx.restore();
            }
          }
          if (!left.size) break;
          drawStep(step, 0);
        }
        timing.bake = Math.round(performance.now() - tb);
      }

      let playing = !!opts.animate;
      let raf = 0;
      let t0 = performance.now() / 1000 - (opts.time || 0);
      let tNow = opts.time || 0;
      function loop() {
        tNow = performance.now() / 1000 - t0;
        frame(tNow);
        raf = requestAnimationFrame(loop);
      }
      frame(tNow);
      if (playing) raf = requestAnimationFrame(loop);

      return {
        destroy() {
          cancelAnimationFrame(raf);
          for (const name of ready) {
            const mod = P[name];
            if (mod.dispose && states[name]) mod.dispose(states[name]);
          }
        },
        renderAt(t) {
          tNow = t;
          frame(t);
        },
        setPlaying(next) {
          if (next === playing) return;
          playing = next;
          cancelAnimationFrame(raf);
          if (playing) {
            t0 = performance.now() / 1000 - tNow;
            raf = requestAnimationFrame(loop);
          }
        },
      };
    },
  });
})();
