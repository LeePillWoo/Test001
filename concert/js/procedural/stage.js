// 절차적 드로잉 레이어: stage. 계약은 index.js 머리말 참고.
(function () {
  'use strict';
  const P = (window.ConcertProc = window.ConcertProc || {});
  P.stage = {
    prepare() {
      return {};
    },
    drawBack(ctx, state, t, env) {
      const g = ctx.createLinearGradient(0, 0, env.W, env.H);
      g.addColorStop(0, '#2a1060');
      g.addColorStop(1, '#ff2d7a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, env.W, env.H);
    },
  };
})();
