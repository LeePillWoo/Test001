// 도형 최적화: 반투명 도형 수천 개를 정해진 순서대로 겹쳐 그린다.
// 도형 목록은 tools/gen_primitives.py가 만든 data.js(base64 바이너리)에 들어 있다.
// 바이너리 형식은 tools/primitive.c 머리말에 있다. 좌표 단위는 원본의 0.5px이다.
//
// 재생 중에는 도형이 하나씩 쌓이며 그림이 드러난다. 처음엔 큰 도형이 천천히,
// 갈수록 작은 도형이 빠르게 쌓이고(지수 곡선) INTRO초 뒤 완성된 그림에서 멈춘다.
//
// 디버그 주소 옵션
//   n=1000    앞에서부터 도형 n개만 그린다 (개수에 따른 품질 비교용)
(function () {
  'use strict';
  const C = window.ConcertCore;
  const INTRO = 9; // 초
  const EASE_K = 5.5; // 클수록 앞부분을 더 천천히 보여 준다

  function decodeBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // 바이너리 → { bg, shapes: [{ path, style, width }] }
  function parse(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== 'PRM2') throw new Error('도형 데이터 형식이 맞지 않습니다: ' + magic);
    const count = dv.getUint32(4, true);
    const bg = `rgb(${bytes[8]},${bytes[9]},${bytes[10]})`;
    const k = 1 / bytes[11];
    const off = dv.getUint16(12, true);
    let o = 14;
    // 12비트 값 두 개가 3바이트에 들어 있다. 도형마다 짝수 개를 읽으므로 남는 값은 없다.
    let pending = -1;
    const u12 = () => {
      if (pending >= 0) {
        const v = pending;
        pending = -1;
        return v;
      }
      const b1 = bytes[o + 1];
      pending = (b1 >> 4) | (bytes[o + 2] << 4);
      const v = bytes[o] | ((b1 & 15) << 8);
      o += 3;
      return v;
    };
    const xy = () => (u12() - off) * k;
    const len = () => u12() * k;

    const shapes = new Array(count);
    for (let i = 0; i < count; i++) {
      const type = bytes[o];
      const alpha = (bytes[o + 4] / 255).toFixed(4);
      const style = `rgba(${bytes[o + 1]},${bytes[o + 2]},${bytes[o + 3]},${alpha})`;
      o += 5;
      const path = new Path2D();
      let width = 0;
      if (type === 0) {
        // 삼각형
        path.moveTo(xy(), xy());
        path.lineTo(xy(), xy());
        path.lineTo(xy(), xy());
        path.closePath();
      } else if (type === 1 || type === 2) {
        // 회전한 타원 / 사각형: 중심, 반지름(반너비), 각도(π/256 단위)
        const cx = xy();
        const cy = xy();
        const a = len();
        const b = len();
        const th = (bytes[o++] * Math.PI) / 256;
        if (type === 1) {
          path.ellipse(cx, cy, a, b, th, 0, Math.PI * 2);
        } else {
          const c = Math.cos(th);
          const s = Math.sin(th);
          path.moveTo(cx - a * c + b * s, cy - a * s - b * c);
          path.lineTo(cx + a * c + b * s, cy + a * s - b * c);
          path.lineTo(cx + a * c - b * s, cy + a * s + b * c);
          path.lineTo(cx - a * c - b * s, cy - a * s + b * c);
          path.closePath();
        }
      } else if (type === 3) {
        // 2차 베지어 획 (둥근 끝)
        path.moveTo(xy(), xy());
        path.quadraticCurveTo(xy(), xy(), xy(), xy());
        width = bytes[o++] * k;
      } else {
        throw new Error('알 수 없는 도형 종류: ' + type);
      }
      shapes[i] = { path, style, width };
    }
    return { bg, shapes };
  }

  function drawRange(ctx, shapes, from, to) {
    for (let i = from; i < to; i++) {
      const s = shapes[i];
      if (s.width > 0) {
        ctx.strokeStyle = s.style;
        ctx.lineWidth = s.width;
        ctx.stroke(s.path);
      } else {
        ctx.fillStyle = s.style;
        ctx.fill(s.path);
      }
    }
  }

  // 0..1 → 0..1, 지수 곡선: 앞쪽 큰 도형은 하나하나 보이고 뒤로 갈수록 빨라진다.
  function ease(u) {
    return (Math.exp(EASE_K * u) - 1) / (Math.exp(EASE_K) - 1);
  }

  C.define('primitives', {
    async mount(host, opts) {
      if (!(window.ConcertData && window.ConcertData.primitives)) await C.loadScript('js/primitives/data.js');
      const parsed = parse(decodeBase64(window.ConcertData.primitives));
      const bg = parsed.bg;
      const limit = parseInt((opts.params && opts.params.get('n')) || '', 10);
      const shapes = limit > 0 ? parsed.shapes.slice(0, limit) : parsed.shapes;
      const total = shapes.length;

      const canvas = C.makeCanvas(C.W, C.H);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `반투명 도형 ${total.toLocaleString('ko-KR')}개로 다시 그린 그림`);
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 재생 중 도형 개수 표시 (화면 UI에서만)
      let badge = null;
      if (!opts.raw) {
        badge = document.createElement('div');
        badge.style.cssText =
          'position:absolute;left:28px;bottom:24px;padding:6px 14px;border-radius:999px;' +
          'font:600 26px/1.2 system-ui,sans-serif;color:#fff;background:rgba(10,6,24,.55);' +
          'font-variant-numeric:tabular-nums;pointer-events:none;transition:opacity .8s';
        host.appendChild(badge);
      }

      let drawn = 0;
      function clear() {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, C.W, C.H);
        drawn = 0;
      }
      function drawTo(n) {
        if (n < drawn) clear();
        drawRange(ctx, shapes, drawn, n);
        drawn = n;
        if (badge) {
          badge.textContent = `도형 ${n.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}`;
          badge.style.opacity = n >= total ? '0' : '1';
        }
      }

      let raf = 0;
      let tNow = opts.time || 0; // 소개 애니메이션의 현재 시각(초)
      let t0 = 0;
      const done = () => drawn >= total;

      function loop() {
        tNow = performance.now() / 1000 - t0;
        const u = Math.min(1, tNow / INTRO);
        drawTo(Math.round(total * ease(u)));
        raf = done() ? 0 : requestAnimationFrame(loop);
      }
      function start() {
        if (done() || raf) return;
        t0 = performance.now() / 1000 - tNow;
        raf = requestAnimationFrame(loop);
      }
      function stop() {
        cancelAnimationFrame(raf);
        raf = 0;
      }

      clear();
      if (opts.animate) start();
      else drawTo(total);

      return {
        destroy() {
          stop();
        },
        // 정지 화면은 언제나 완성된 그림이다.
        renderAt() {
          stop();
          drawTo(total);
        },
        setPlaying(next) {
          if (next) start();
          else stop();
        },
      };
    },
  });
})();
