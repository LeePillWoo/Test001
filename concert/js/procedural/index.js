// 절차적 드로잉: 레이어 모듈을 순서대로 한 캔버스에 겹쳐 그린다.
//
// 모듈 계약 (window.ConcertProc.<이름>)
//   prepare(env) → state 또는 Promise<state>   무거운 정적 요소를 오프스크린 캔버스에 미리 그린다.
//   drawBack / drawFront / draw (ctx, state, t, env)
//       t는 초 단위 시각. t=0 장면이 원본 구도와 같아야 하고, 같은 t면 언제나 같은 그림이어야 한다.
//       ctx 상태(save/restore)는 오케스트레이터가 감싸 준다.
//
// 디버그 주소 옵션
//   layers=stage,hair     그 모듈만 그린다
//   under=ref             맨 아래에 원본을 깐다 (레이어 하나만 원본 위에서 맞춰 볼 때)
//   onion=0.5             맨 위에 원본을 그 불투명도로 덮는다
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

      const states = {};
      for (const name of MODULES) {
        const mod = P[name];
        if (!mod || !enabled.has(name)) continue;
        states[name] = mod.prepare ? await mod.prepare(env) : {};
      }

      function frame(t) {
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
        for (const [name, fn] of ORDER) {
          const mod = P[name];
          if (!mod || !enabled.has(name) || typeof mod[fn] !== 'function') continue;
          ctx.save();
          try {
            mod[fn](ctx, states[name], t, env);
          } finally {
            ctx.restore();
          }
        }
        if (ref && onion > 0) {
          ctx.globalAlpha = onion;
          ctx.drawImage(ref, 0, 0, W, H);
          ctx.globalAlpha = 1;
        }
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
          for (const name of MODULES) {
            const mod = P[name];
            if (mod && mod.dispose && states[name]) mod.dispose(states[name]);
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
