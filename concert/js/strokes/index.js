// 붓질 렌더링: tools/gen_strokes.py가 만든 붓질 목록을 굵은 붓부터 차례로 다시 칠한다.
//
// 데이터 (window.ConcertData.strokes, zlib 압축 바이너리의 base64)
//   머리: 'STK2', 층 수, 배경색, 층마다 (반지름×4, 걸음×16, 격자, 붓 수), 스트림 길이 7개
//   스트림: 칸 증분 · 칸 안 위치 · R · G · B(각 6비트, 앞 붓과의 차) · 팔 길이 · 방향(256분할)
// 붓은 씨앗에서 양쪽으로 자란 폴리라인이다. 좌표는 1/16 px 정수로 누적해 생성기 시뮬레이션과 똑같다.
// 층 안의 칠하는 순서는 칸 번호의 해시 순서다 (생성기와 같은 해시).
//
// 마지막에 붓마다의 결 방향으로 붓털 자국 높이를 만들어 비스듬한 빛으로 엠보싱한다 (임파스토).
//
// 디버그 주소 옵션
//   layers=3     앞에서부터 이 개수의 층만 칠한다
//   intro=9      애니메이션 길이(초)
//   relief=1     임파스토 빛의 세기 배율 (0이면 끔)
//   reliefr=2    이 반지름 이상의 붓만 임파스토 높이를 남긴다
//   timing=1     풀기·칠하기 시간을 콘솔에 남긴다
(function () {
  'use strict';
  const C = window.ConcertCore;
  const NA = 256;
  const SEED = 7;
  // 층별 인트로 시간 비율 (굵은 붓에 시간을 더 준다)
  const LAYER_TIME = [2.4, 1.7, 1.5, 1.4, 1.2, 0.8, 0.6, 0.5];
  // 임파스토: 이 반지름 이상의 붓만 높이를 남긴다. 빛의 세기 (relief=배율 주소 옵션으로 조절)
  const RELIEF_MIN_R = 2;
  const RELIEF_GAIN = 0.035;

  // lowbias32 — 생성기의 hash32와 같다
  function hash32(x) {
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('이 브라우저는 DecompressionStream을 지원하지 않습니다');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // 바이너리를 풀어 칠할 순서대로 정렬된 붓 목록을 만든다.
  function parse(buf) {
    const { W } = C;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (magic !== 'STK2') throw new Error('붓질 데이터 형식이 다릅니다: ' + magic);
    let p = 4;
    const nLayers = buf[p++];
    const bg = [buf[p], buf[p + 1], buf[p + 2]];
    p += 3;
    const layers = [];
    for (let li = 0; li < nLayers; li++, p += 9) {
      layers.push({
        r: dv.getUint16(p, true) / 4,
        step16: dv.getUint16(p + 2, true),
        g: buf[p + 4],
        count: dv.getUint32(p + 5, true),
      });
    }
    const streams = [];
    const lens = [];
    for (let i = 0; i < 7; i++, p += 4) lens.push(dv.getUint32(p, true));
    for (const n of lens) {
      streams.push(buf.subarray(p, p + n));
      p += n;
    }
    const [sCell, sOff, sR, sG, sB, sLen, sAng] = streams;
    let pCell = 0;
    let pOff = 0;
    let pAng = 0;
    const varint = (s, i) => {
      let v = 0;
      let mul = 1;
      for (;;) {
        const b = s[i++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) return [v, i];
        mul *= 128;
      }
    };

    let total = 0;
    for (const L of layers) total += L.count;
    const xy = new Float32Array((sAng.length + total) * 2);
    const start = new Uint32Array(total + 1);
    const color = new Uint32Array(total); // (r << 12) | (g << 6) | b, 각 0~63
    const layerOf = new Uint8Array(total);
    const order = new Uint32Array(total);
    let si = 0;
    let pi = 0;
    let cr = 0;
    let cg = 0;
    let cb = 0;
    const bx = new Int32Array(16);
    const by = new Int32Array(16);
    for (let li = 0; li < nLayers; li++) {
      const L = layers[li];
      const g = L.g;
      const ncx = Math.ceil(W / g);
      // 방향 번호 → 1/16 px 걸음 (생성기 step_table과 같은 식)
      const tx = new Int32Array(NA);
      const ty = new Int32Array(NA);
      for (let a = 0; a < NA; a++) {
        const th = (2 * Math.PI * a) / NA;
        tx[a] = Math.round(L.step16 * Math.cos(th));
        ty[a] = Math.round(L.step16 * Math.sin(th));
      }
      const first = si;
      const keys = new Float64Array(L.count);
      let cell = -1;
      cr = cg = cb = 0;
      for (let k = 0; k < L.count; k++, si++) {
        let v;
        [v, pCell] = varint(sCell, pCell);
        cell += v + 1;
        let off;
        [off, pOff] = varint(sOff, pOff);
        const ox = off % g;
        const oy = (off - ox) / g;
        const sx = ((cell % ncx) * g + ox) * 16 + 8;
        const sy = (Math.floor(cell / ncx) * g + oy) * 16 + 8;
        cr = (cr + sR[si]) & 63;
        cg = (cg + sG[si]) & 63;
        cb = (cb + sB[si]) & 63;
        color[si] = (cr << 12) | (cg << 6) | cb;
        const lb = sLen[si];
        const nb = lb >> 4;
        const nf = lb & 15;
        // 앞팔 방향은 뒷팔보다 먼저 저장돼 있다
        const fStart = pAng;
        pAng += nf;
        // 뒷팔: 씨앗에서 거꾸로 걸어간 점들을 역순으로 넣는다
        let x = sx;
        let y = sy;
        let last = 0;
        for (let i = 0; i < nb; i++) {
          const d = sAng[pAng++];
          last = i === 0 ? d : (last + d) & (NA - 1);
          x += tx[last];
          y += ty[last];
          bx[i] = x;
          by[i] = y;
        }
        start[si] = pi;
        for (let i = nb - 1; i >= 0; i--, pi++) {
          xy[pi * 2] = bx[i] / 16;
          xy[pi * 2 + 1] = by[i] / 16;
        }
        xy[pi * 2] = sx / 16;
        xy[pi * 2 + 1] = sy / 16;
        pi++;
        x = sx;
        y = sy;
        for (let i = 0; i < nf; i++, pi++) {
          const d = sAng[fStart + i];
          last = i === 0 ? d : (last + d) & (NA - 1);
          x += tx[last];
          y += ty[last];
          xy[pi * 2] = x / 16;
          xy[pi * 2 + 1] = y / 16;
        }
        layerOf[si] = li;
        const key = hash32((cell + Math.imul(li + 1, 0x9e3779b9) + SEED) >>> 0);
        keys[k] = key * 2097152 + k;
      }
      keys.sort();
      for (let k = 0; k < L.count; k++) order[first + k] = first + (keys[k] % 2097152);
      L.first = first;
      L.end = si;
    }
    start[total] = pi;
    return { bg, layers, xy, start, color, layerOf, order, total };
  }

  // 6비트 색 → CSS 문자열 (같은 색은 한 번만 만든다)
  const LEVELS = Array.from({ length: 64 }, (_, q) => Math.round((q * 255) / 63));
  const styleCache = new Map();
  function colorStyle(key) {
    let s = styleCache.get(key);
    if (!s) {
      s = `rgb(${LEVELS[key >> 12]},${LEVELS[(key >> 6) & 63]},${LEVELS[key & 63]})`;
      styleCache.set(key, s);
    }
    return s;
  }

  function drawStroke(ctx, D, s) {
    const L = D.layers[D.layerOf[s]];
    const a = D.start[s];
    const b = D.start[s + 1];
    const xy = D.xy;
    if (b - a === 1) {
      ctx.fillStyle = colorStyle(D.color[s]);
      ctx.beginPath();
      ctx.arc(xy[a * 2], xy[a * 2 + 1], L.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.lineWidth = L.r * 2;
    ctx.strokeStyle = colorStyle(D.color[s]);
    ctx.beginPath();
    ctx.moveTo(xy[a * 2], xy[a * 2 + 1]);
    for (let i = a + 1; i < b; i++) ctx.lineTo(xy[i * 2], xy[i * 2 + 1]);
    ctx.stroke();
  }

  // ── 임파스토 (물감 두께) ─────────────────────────────────
  // 붓마다 '결 캔버스'에 단색으로 한 번 더 긋는다. 색에 붓의 방향(R)·무늬 위상(G)·층(B)을 담는다.
  // 다 칠한 뒤 픽셀마다 그 붓의 방향을 따라 붓털 줄무늬 높이를 만들고,
  // 왼쪽 위에서 빛을 비춘 것처럼 엠보싱해 색 캔버스에 더한다. 붓과 붓 사이 경계는 위상이 달라 턱이 진다.
  function makeRelief(W, H, seed, minR, layers) {
    const cv = C.makeCanvas(W, H);
    const g = cv.getContext('2d');
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const rng = C.rngFor(seed, 'bristle');
    // 붓털 한 가닥 = 1~3칸, 높이는 제각각. 1024칸을 돌려 쓴다.
    const LUT = new Uint8Array(1024);
    let v = 128;
    for (let i = 0; i < LUT.length; i++) {
      if (i === 0 || rng() < 0.5) v = 70 + rng() * 116;
      LUT[i] = v;
    }
    // 방향 번호(0~255 → 0~π)의 cos/sin, 층별 줄무늬 촘촘함 (큰 붓일수록 굵은 붓털)
    const CS = new Float32Array(256);
    const SN = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      CS[i] = Math.cos((i / 256) * Math.PI);
      SN[i] = Math.sin((i / 256) * Math.PI);
    }
    const FREQ = new Float32Array(256);
    layers.forEach((L, i) => (FREQ[i + 1] = Math.min(1.6, 7 / L.r)));
    return {
      clear() {
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
      },
      stroke(D, s) {
        const li = D.layerOf[s];
        const L = D.layers[li];
        if (L.r < minR) return;
        const a = D.start[s];
        const b = D.start[s + 1];
        const xy = D.xy;
        const x0 = xy[a * 2];
        const y0 = xy[a * 2 + 1];
        let ang = b - a > 1 ? Math.atan2(xy[(b - 1) * 2 + 1] - y0, xy[(b - 1) * 2] - x0) : s * 2.399;
        ang = ((ang % Math.PI) + Math.PI) % Math.PI;
        const style = `rgb(${Math.floor((ang / Math.PI) * 256) & 255},${(s * 97) & 255},${li + 1})`;
        if (b - a === 1) {
          g.fillStyle = style;
          g.beginPath();
          g.arc(x0, y0, L.r, 0, Math.PI * 2);
          g.fill();
          return;
        }
        g.strokeStyle = style;
        g.lineWidth = L.r * 2;
        g.beginPath();
        g.moveTo(x0, y0);
        for (let i = a + 1; i < b; i++) g.lineTo(xy[i * 2], xy[i * 2 + 1]);
        g.stroke();
      },
      shade(ctx, k) {
        const id = g.getImageData(0, 0, W, H).data;
        // 1) 높이: 붓 방향에 수직인 좌표로 줄무늬 표를 읽는다
        const hgt = new Uint8Array(W * H);
        for (let y = 0, i = 0; y < H; y++) {
          for (let x = 0; x < W; x++, i++) {
            const j = i * 4;
            const f = FREQ[id[j + 2]];
            if (f === 0) {
              hgt[i] = 128;
              continue;
            }
            const ai = id[j];
            const u = (CS[ai] * y - SN[ai] * x) * f + id[j + 1] * 4;
            hgt[i] = LUT[(u | 0) & 1023];
          }
        }
        // 2) 엠보싱: 왼쪽 위 이웃 − 오른쪽 아래 이웃
        const img = ctx.getImageData(0, 0, W, H);
        const c = img.data;
        for (let y = 1; y < H - 1; y++) {
          let i = y * W + 1;
          for (let x = 1; x < W - 1; x++, i++) {
            const d = hgt[i - W - 1] + hgt[i - W] + hgt[i - 1] - hgt[i + W + 1] - hgt[i + W] - hgt[i + 1];
            if (d === 0) continue;
            const v = d * k;
            const j = i * 4;
            c[j] += v;
            c[j + 1] += v;
            c[j + 2] += v;
          }
        }
        ctx.putImageData(img, 0, 0);
      },
    };
  }

  C.define('strokes', {
    async mount(host, opts) {
      const { W, H } = C;
      const params = opts.params || new URLSearchParams();
      await C.loadScript('js/strokes/data.js');
      const b64 = window.ConcertData && window.ConcertData.strokes;
      if (!b64) throw new Error('붓질 데이터(js/strokes/data.js)가 없습니다');
      const tm0 = performance.now();
      const D = parse(await inflate(b64ToBytes(b64)));
      const tm1 = performance.now();
      const nLayers = Math.min(D.layers.length, parseInt(params.get('layers') || '99', 10));
      const total = nLayers >= D.layers.length ? D.total : D.layers[nLayers - 1].end;

      const canvas = C.makeCanvas(W, H);
      canvas.setAttribute('aria-label', '붓질로 다시 칠한 무대 위의 소녀');
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 물감 두께(임파스토): 붓마다 결 무늬를 높이 캔버스에 따로 칠해 두었다가
      // 마지막에 왼쪽 위에서 빛을 비춘 것처럼 엠보싱해 색 캔버스에 더한다.
      const reliefK = parseFloat(params.get('relief') || '1') * RELIEF_GAIN;
      const reliefMinR = parseFloat(params.get('reliefr') || String(RELIEF_MIN_R));
      const relief = reliefK > 0 ? makeRelief(W, H, opts.seed, reliefMinR, D.layers) : null;

      let drawn = 0;
      let finished = false;
      function clear() {
        ctx.fillStyle = `rgb(${D.bg.join(',')})`;
        ctx.fillRect(0, 0, W, H);
        if (relief) relief.clear();
        drawn = 0;
        finished = false;
      }
      function drawUpTo(n) {
        n = Math.min(n, total);
        for (; drawn < n; drawn++) {
          const s = D.order[drawn];
          drawStroke(ctx, D, s);
          if (relief) relief.stroke(D, s);
        }
      }
      // 다 칠한 뒤 한 번: 엠보싱 빛을 입힌다 (target이 없으면 색 캔버스에 바로)
      function finish(target) {
        if (finished) return;
        finished = true;
        if (relief) relief.shade(target || ctx, reliefK);
      }

      // 인트로 일정: 층마다 시간 조각을 주고, 조각 안에서는 점점 빠르게 칠한다
      const introLen = parseFloat(params.get('intro') || '9');
      const weights = D.layers.slice(0, nLayers).map((_, i) => LAYER_TIME[i] || 0.5);
      const wsum = weights.reduce((a, b) => a + b, 0);
      const spans = [];
      let acc = 0;
      for (let i = 0; i < nLayers; i++) {
        const d = (weights[i] / wsum) * introLen;
        spans.push({ t0: acc, t1: acc + d, first: D.layers[i].first, end: D.layers[i].end });
        acc += d;
      }
      const FADE = 0.8; // 마지막 광택이 번지는 시간(초)
      function targetAt(t) {
        let n = 0;
        for (const s of spans) {
          if (t >= s.t1) n = s.end;
          else if (t > s.t0) {
            const u = (t - s.t0) / (s.t1 - s.t0);
            n = s.first + Math.floor((s.end - s.first) * Math.pow(u, 1.5));
            break;
          } else break;
        }
        return n;
      }

      let raf = 0;
      let playing = !!opts.animate;
      let elapsed = Math.max(0, opts.time || 0);
      let lastNow = 0;
      let destroyed = false;
      let lit = null; // 빛을 입힌 완성본 (페이드용)
      let litAt = 0;

      function tick(now) {
        raf = 0;
        if (destroyed || !playing) return;
        if (lastNow) elapsed += Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;
        if (drawn < total) {
          drawUpTo(targetAt(elapsed));
          if (drawn >= total && relief) {
            // 빛을 입힌 완성본을 따로 만들어 두고, 색 캔버스 위로 천천히 덮는다
            lit = C.makeCanvas(W, H);
            const lctx = lit.getContext('2d');
            lctx.drawImage(canvas, 0, 0);
            finish(lctx);
            litAt = elapsed;
          } else if (drawn >= total) finish();
        }
        if (lit) {
          const a = Math.min(1, (elapsed - litAt) / FADE);
          ctx.globalAlpha = a < 1 ? a * 0.35 : 1;
          ctx.drawImage(lit, 0, 0);
          ctx.globalAlpha = 1;
          if (a >= 1) lit = null;
        }
        if (drawn < total || lit) raf = requestAnimationFrame(tick);
      }

      // 정지 화면: 완성된 그림. 메인 스레드를 오래 막지 않게 잘게 나눠 칠한다.
      async function renderComplete() {
        if (finished && !lit) return;
        lit = null;
        clear();
        const sliceMs = 40;
        while (drawn < total && !destroyed) {
          const t0 = performance.now();
          while (drawn < total && performance.now() - t0 < sliceMs) drawUpTo(drawn + 256);
          if (drawn < total) await new Promise((r) => setTimeout(r, 0));
        }
        if (!destroyed) {
          const t = performance.now();
          finish();
          if (params.get('timing')) console.warn(`strokes: shade ${(performance.now() - t).toFixed(0)}ms`);
        }
      }

      clear();
      if (playing) {
        drawUpTo(targetAt(elapsed));
        raf = requestAnimationFrame(tick);
      } else {
        await renderComplete();
      }
      if (params.get('timing')) {
        console.warn(
          `strokes: decode ${(tm1 - tm0).toFixed(0)}ms, paint ${(performance.now() - tm1).toFixed(0)}ms`,
        );
      }

      return {
        destroy() {
          destroyed = true;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          canvas.remove();
        },
        async renderAt() {
          playing = false;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          await renderComplete();
        },
        setPlaying(next) {
          playing = !!next;
          if (playing && (drawn < total || lit) && !raf) {
            lastNow = 0;
            raf = requestAnimationFrame(tick);
          } else if (!playing && raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
        },
      };
    },
  });
})();
