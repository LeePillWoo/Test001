// 벡터 트레이싱: tools/gen_trace.py가 만든 벡터 도형을 층별로, 큰 것부터 차례로 칠한다.
//
// 데이터 (window.ConcertData.trace, zlib 압축 바이너리의 base64) — 형식은 gen_trace.py 머리말 참고
//   층 0  무대 배경 색 영역. 흐림 값이 있으면 오프스크린에 칠한 뒤 한 번에 가우시안 흐림을 걸어 합성한다.
//   층 1  인물 색 영역. 평면색 또는 선형 그라디언트로 채운 닫힌 곡선. 앞 도형이 뒤 도형 밑까지 뻗어 틈이 없다.
//   층 2  선화(생성기 --ink일 때만): 원본의 가는 어두운 획을 1/4px 정밀도로 따낸 채운 도형.
//   하위 경로가 여럿인 도형(구멍이 있는 도형)은 evenodd로 칠한다.
//   꼭짓점은 1/4px 단위이고, 모서리가 아닌 꼭짓점은 Catmull–Rom 곡선(구간 길이로 접선 크기를 맞춤)으로 잇는다.
//
// 디버그 주소 옵션
//   layers=0,1    이 층만 칠한다 (0 배경, 1 인물, 2 선화)
//   upto=0.5      층마다 도형을 앞에서부터 이 비율만 칠한다
//   blur=1        배경 층 흐림 배율 (데이터에 흐림 값이 있을 때)
//   intro=9       인트로 길이(초)
// 재생 중에는 인트로(무대 → 인물 → 선화)가 한 번 지나간 뒤, 작고 밝은 도형 몇 개가 가끔 반짝인다.
// 정지 화면과 renderAt(t)는 언제나 반짝임 없는 완성 그림이다.
(function () {
  'use strict';
  const C = window.ConcertCore;
  const DATA_SRC = 'js/trace/data.js';

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('이 브라우저는 DecompressionStream을 지원하지 않습니다');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // varint(LEB128) 읽개. sv는 지그재그 부호 변환을 되돌린다.
  function reader(bytes, pos) {
    const r = {
      pos,
      u8() {
        return bytes[r.pos++];
      },
      uv() {
        let v = 0;
        let mul = 1;
        let b;
        do {
          b = bytes[r.pos++];
          v += (b & 0x7f) * mul;
          mul *= 128;
        } while (b & 0x80);
        return v;
      },
      sv() {
        const v = r.uv();
        return v % 2 ? -(v + 1) / 2 : v / 2;
      },
    };
    return r;
  }

  function parse(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (magic !== 'TRC4') throw new Error('trace 데이터 형식이 아닙니다: ' + magic);
    const n = dv.getUint32(8, true);
    const base = [buf[12], buf[13], buf[14]];
    const unit = buf[15]; // 꼭짓점 좌표 단위 1/unit px
    const nl = buf[16];
    let o = 17;
    const layerCounts = [];
    const layerBlur = [];
    for (let i = 0; i < nl; i++, o += 5) {
      layerCounts.push(dv.getUint32(o, true));
      layerBlur.push(buf[o + 4] / 10);
    }
    const lens = [];
    for (let i = 0; i < 5; i++, o += 4) lens.push(dv.getUint32(o, true));
    const offs = [o];
    for (let i = 0; i < 4; i++) offs.push(offs[i] + lens[i]);
    const kindR = reader(buf, offs[0]);
    const colR = reader(buf, offs[1]);
    const cntR = reader(buf, offs[2]);
    const startR = reader(buf, offs[3]);
    const dR = reader(buf, offs[4]);

    const kind = new Uint8Array(n);
    const col = new Uint8Array(n * 6);
    const grad = new Float32Array(n * 4);
    // 하위 경로 목록: 도형 i는 subFirst[i]..subFirst[i+1]-1, 하위 경로 j의 꼭짓점은 first[j]..first[j+1]-1
    const subFirst = new Uint32Array(n + 1);
    const subCount = [];
    const subCorner0 = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      subFirst[i] = subCount.length;
      let more = 1;
      while (more) {
        const c = cntR.uv();
        more = c & 1;
        subCorner0.push((c >> 1) & 1);
        subCount.push(Math.floor(c / 4));
        total += Math.floor(c / 4);
      }
    }
    const ns = subCount.length;
    subFirst[n] = ns;
    const first = new Uint32Array(ns + 1);
    for (let j = 0, t = 0; j <= ns; j++) {
      first[j] = t;
      if (j < ns) t += subCount[j];
    }
    const pts = new Float32Array(total * 2);
    const corner = new Uint8Array(total);
    for (let i = 0; i < n; i++) {
      const k = (kind[i] = kindR.u8());
      for (let j = 0; j < 3; j++) col[i * 6 + j] = colR.u8();
      if (k === 1) {
        for (let j = 3; j < 6; j++) col[i * 6 + j] = colR.u8();
        for (let j = 0; j < 4; j++) grad[i * 4 + j] = colR.uv() / 2;
      }
    }
    // 첫 점은 앞 하위 경로의 첫 점에서의 차이다
    let sx = 0;
    let sy = 0;
    for (let j = 0; j < ns; j++) {
      sx += startR.sv();
      sy += startR.sv();
      let x = sx;
      let y = sy;
      let p = first[j];
      pts[p * 2] = x / unit;
      pts[p * 2 + 1] = y / unit;
      corner[p] = subCorner0[j];
      for (let m = 1; m < subCount[j]; m++) {
        const a = dR.uv(); // (zz(dx) << 1) | 모서리
        const zx = Math.floor(a / 2);
        x += zx % 2 ? -(zx + 1) / 2 : zx / 2;
        y += dR.sv();
        p++;
        pts[p * 2] = x / unit;
        pts[p * 2 + 1] = y / unit;
        corner[p] = a & 1;
      }
    }
    return { n, base, layerCounts, layerBlur, kind, col, grad, subFirst, first, pts, corner };
  }

  // 닫힌 꼭짓점 목록 하나를 path에 더한다. 모서리가 아니면 접선 = 앞뒤 점을 잇는 방향, 크기 = 구간 길이/3.
  function addSubpath(path, D, j) {
    const { pts, corner, first } = D;
    const s = first[j];
    const n = first[j + 1] - s;
    const tx = new Float32Array(n);
    const ty = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (corner[s + k]) continue;
      const a = s + ((k + n - 1) % n);
      const b = s + ((k + 1) % n);
      const dx = pts[b * 2] - pts[a * 2];
      const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      tx[k] = dx / l;
      ty[k] = dy / l;
    }
    path.moveTo(pts[s * 2], pts[s * 2 + 1]);
    for (let k = 0; k < n; k++) {
      const a = s + k;
      const kb = (k + 1) % n;
      const b = s + kb;
      const x0 = pts[a * 2];
      const y0 = pts[a * 2 + 1];
      const x1 = pts[b * 2];
      const y1 = pts[b * 2 + 1];
      const l = Math.hypot(x1 - x0, y1 - y0) / 3;
      const c1x = corner[a] ? x0 + (x1 - x0) / 3 : x0 + tx[k] * l;
      const c1y = corner[a] ? y0 + (y1 - y0) / 3 : y0 + ty[k] * l;
      const c2x = corner[b] ? x1 - (x1 - x0) / 3 : x1 - tx[kb] * l;
      const c2y = corner[b] ? y1 - (y1 - y0) / 3 : y1 - ty[kb] * l;
      path.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
    }
    path.closePath();
  }

  function buildPath(D, i) {
    const path = new Path2D();
    for (let j = D.subFirst[i]; j < D.subFirst[i + 1]; j++) addSubpath(path, D, j);
    return path;
  }

  function fillStyle(ctx, D, i) {
    const c = D.col;
    const o = i * 6;
    if (D.kind[i] === 1) {
      const g = D.grad;
      const lg = ctx.createLinearGradient(g[i * 4], g[i * 4 + 1], g[i * 4 + 2], g[i * 4 + 3]);
      lg.addColorStop(0, `rgb(${c[o]},${c[o + 1]},${c[o + 2]})`);
      lg.addColorStop(1, `rgb(${c[o + 3]},${c[o + 4]},${c[o + 5]})`);
      return lg;
    }
    return `rgb(${c[o]},${c[o + 1]},${c[o + 2]})`;
  }

  // 반짝임 스프라이트: 둥근 빛 + 십자 빛줄기 (흰색, 'lighter'로 더한다)
  function makeGlint() {
    const c = C.makeCanvas(64, 64);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 12);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    for (const horiz of [true, false]) {
      const lg = horiz ? g.createLinearGradient(0, 32, 64, 32) : g.createLinearGradient(32, 0, 32, 64);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      if (horiz) g.fillRect(0, 31, 64, 2);
      else g.fillRect(31, 0, 2, 64);
    }
    return c;
  }

  // 작고 밝은 평면색 도형(스팽글·조명 반사) 가운데 일부를 반짝일 자리로 고른다
  function pickSparkles(D, from, to, rng, max) {
    const cand = [];
    for (let i = from; i < to; i++) {
      if (D.kind[i] !== 0) continue;
      const o = i * 6;
      const luma = 0.299 * D.col[o] + 0.587 * D.col[o + 1] + 0.114 * D.col[o + 2];
      if (luma < 215) continue;
      const j = D.subFirst[i];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let p = D.first[j]; p < D.first[j + 1]; p++) {
        x0 = Math.min(x0, D.pts[p * 2]);
        x1 = Math.max(x1, D.pts[p * 2]);
        y0 = Math.min(y0, D.pts[p * 2 + 1]);
        y1 = Math.max(y1, D.pts[p * 2 + 1]);
      }
      const size = Math.max(x1 - x0, y1 - y0);
      if (size > 9) continue;
      cand.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: 7 + size * 1.6 });
    }
    // 시드 난수로 섞어서 앞에서부터 고른다
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    return cand.slice(0, max).map((c) => Object.assign(c, { period: rng.range(2.5, 6.5), phase: rng() }));
  }

  C.define('trace', {
    async mount(host, opts) {
      const { W, H } = C;
      const params = opts.params || new URLSearchParams();
      if (!(window.ConcertData && window.ConcertData.trace)) await C.loadScript(DATA_SRC);
      const D = parse(await inflate(b64ToBytes(window.ConcertData.trace)));
      const frac = Math.min(1, parseFloat(params.get('upto') || '1'));
      const only = params.get('layers');
      const introLen = parseFloat(params.get('intro') || '9');
      const blurMul = params.has('blur') ? parseFloat(params.get('blur')) : 1;

      const canvas = C.makeCanvas(W, H);
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const canFilter = typeof ctx.filter === 'string';

      // 층마다 칠할 도형 [s, e). 흐림이 있는 층은 오프스크린에 칠했다가 한 번에 흐려서 합성한다.
      const layers = [];
      for (let li = 0, s = 0; li < D.layerCounts.length; li++) {
        const cnt = D.layerCounts[li];
        const on = !only || only.split(',').includes(String(li));
        const L = { s, e: on ? s + Math.round(cnt * frac) : s, blur: D.layerBlur[li] * blurMul, off: null };
        if (L.blur > 0 && L.e > L.s) {
          L.off = C.makeCanvas(W, H);
          L.octx = L.off.getContext('2d');
        }
        layers.push(L);
        s += cnt;
      }
      const paths = new Array(D.n);
      const styles = new Array(D.n);
      const rules = new Array(D.n);
      for (const L of layers) {
        const c = L.octx || ctx;
        for (let i = L.s; i < L.e; i++) {
          paths[i] = buildPath(D, i);
          styles[i] = fillStyle(c, D, i);
          rules[i] = D.subFirst[i + 1] - D.subFirst[i] > 1 ? 'evenodd' : 'nonzero';
        }
      }
      const baseColor = `rgb(${D.base[0]},${D.base[1]},${D.base[2]})`;

      function drawRange(c, a, b) {
        for (let i = a; i < b; i++) {
          c.fillStyle = styles[i];
          c.fill(paths[i], rules[i]);
        }
      }
      // 인트로 동안 아직 칠하지 않은 자리는 어두운 실루엣으로 보인다 (조명이 켜지기 전의 무대 위 가수)
      const shadowColor = `rgb(${D.base.map((v) => Math.round(v * 0.22)).join(',')})`;
      function clearMain(color) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        ctx.fillStyle = color || baseColor;
        ctx.fillRect(0, 0, W, H);
      }
      // 흐린 층 합성: 흐리지 않은 그림을 받침으로 깔아 가장자리가 비치지 않게 한다
      function composite(L) {
        ctx.drawImage(L.off, 0, 0);
        if (canFilter) {
          ctx.filter = `blur(${L.blur}px)`;
          ctx.drawImage(L.off, 0, 0);
          ctx.filter = 'none';
        }
      }
      function complete() {
        clearMain();
        for (const L of layers) {
          if (L.off) {
            L.octx.clearRect(0, 0, W, H);
            drawRange(L.octx, L.s, L.e);
            composite(L);
          } else drawRange(ctx, L.s, L.e);
        }
      }

      // 인트로 (약 9초): 무대 배경 → 인물을 큰 도형부터 점점 빠르게 → (있으면) 선화가 스며든다.
      // 층마다 시간 몫이 있고, 층 안의 진행도 v에 대해 칠한 도형 수 = 개수 × v^2.2.
      const share = layers.map((L, li) => (L.e > L.s ? [0.28, 0.72, 0.15][li] || 0.1 : 0));
      const shareSum = share.reduce((a, b) => a + b, 0) || 1;
      let raf = 0;
      let introT = 0;
      let last = 0;
      let phase = 0;
      let drawn = 0;
      let under = null; // 마지막 층이 스며드는 동안 그 아래 그림
      function startPhase(li) {
        phase = li;
        drawn = layers[li] ? layers[li].s : 0;
        under = null;
      }
      function tick(now) {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        last = now;
        introT += dt;
        let t = Math.min(1, introT / introLen) * shareSum;
        let li = 0;
        while (li < layers.length - 1 && t >= share[li]) t -= share[li++];
        while (phase < li) {
          // 앞 층을 마저 칠하고 넘어간다
          const L = layers[phase];
          if (L.off) {
            drawRange(L.octx, drawn, L.e);
            clearMain(shadowColor);
            composite(L);
          } else if (!under) drawRange(ctx, drawn, L.e);
          startPhase(phase + 1);
        }
        const L = layers[li];
        const v = share[li] ? Math.min(1, t / share[li]) : 1;
        const k = L.s + Math.ceil((L.e - L.s) * Math.pow(v, 2.2));
        if (L.off) {
          drawRange(L.octx, drawn, k);
          clearMain(shadowColor);
          composite(L);
        } else if (li === layers.length - 1 && li > 0) {
          if (!under) {
            under = C.makeCanvas(W, H);
            under.getContext('2d').drawImage(canvas, 0, 0);
          }
          ctx.globalAlpha = 1;
          ctx.drawImage(under, 0, 0);
          ctx.globalAlpha = v * v * (3 - 2 * v);
          drawRange(ctx, L.s, L.e);
          ctx.globalAlpha = 1;
        } else drawRange(ctx, drawn, k);
        drawn = Math.max(drawn, k);
        if (introT < introLen) raf = requestAnimationFrame(tick);
        else {
          raf = 0;
          under = null;
          complete();
          startAmbient();
        }
      }

      // 완성 뒤: 고른 반짝이 몇 개가 가끔 짧게 빛난다 (완성 그림 사본 위에 더한다)
      const fig = layers[1] || layers[0];
      const sparkles = pickSparkles(D, fig.s, fig.e, C.rngFor(opts.seed || 7, 'trace-sparkle'), 70);
      const glint = sparkles.length ? makeGlint() : null;
      let still = null;
      let ambRaf = 0;
      let ambT = 0;
      let ambLast = 0;
      function ambient(now) {
        const dt = ambLast ? Math.min(0.1, (now - ambLast) / 1000) : 0;
        ambLast = now;
        ambT += dt;
        ctx.globalAlpha = 1;
        ctx.drawImage(still, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        for (const sp of sparkles) {
          const ph = (ambT / sp.period + sp.phase) % 1;
          if (ph > 0.14) continue;
          const a = Math.sin((ph / 0.14) * Math.PI);
          const r = sp.r * (0.55 + 0.45 * a);
          ctx.globalAlpha = 0.6 * a;
          ctx.drawImage(glint, sp.x - r, sp.y - r, 2 * r, 2 * r);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ambRaf = requestAnimationFrame(ambient);
      }
      function startAmbient() {
        if (!glint || ambRaf || !playing) return;
        if (!still) {
          still = C.makeCanvas(W, H);
          still.getContext('2d').drawImage(canvas, 0, 0);
        }
        ambLast = 0;
        ambRaf = requestAnimationFrame(ambient);
      }
      function stopAmbient(clean) {
        cancelAnimationFrame(ambRaf);
        ambRaf = 0;
        if (clean && still) ctx.drawImage(still, 0, 0);
      }

      let playing = !!opts.animate;
      if (playing) {
        clearMain(shadowColor);
        startPhase(0);
        raf = requestAnimationFrame(tick);
      } else {
        introT = introLen;
        complete();
      }

      return {
        destroy() {
          cancelAnimationFrame(raf);
          raf = 0;
          stopAmbient(false);
        },
        renderAt() {
          cancelAnimationFrame(raf);
          raf = 0;
          stopAmbient(false);
          introT = introLen;
          under = null;
          complete();
        },
        setPlaying(next) {
          playing = next;
          if (!next) {
            cancelAnimationFrame(raf);
            raf = 0;
            stopAmbient(true);
          } else if (introT < introLen) {
            if (!raf) {
              last = 0;
              raf = requestAnimationFrame(tick);
            }
          } else startAmbient();
        },
      };
    },
  });
})();
