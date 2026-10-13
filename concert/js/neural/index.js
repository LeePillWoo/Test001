// 신경망 기억: 좌표 (x, y)를 색으로 바꾸는 작은 신경장(neural field)으로 그림 전체를 계산한다.
//
// 구조 (tools/train_neural.py가 학습)
//   해상도가 다른 특징 격자 8장(16²…800², 얼굴 상자 하나) → 픽셀 중심에서 쌍선형 보간 → 특징 24개
//   → MLP(24 → 32 → 32 → 3, ReLU) → RGB. 격자 값과 가중치가 곧 그림이고, 원본 픽셀은 쓰지 않는다.
//
// WebGL2: 격자는 LINEAR 필터 8비트 텍스처, 가중치는 셰이더 소스에 상수로 펼쳐 넣는다.
// WebGL2가 없으면 같은 계산을 JS로 행 묶음씩 나눠 한다(페이지가 멈추지 않게 프레임마다 양보).
//
// 인트로: 거친 격자부터 한 장씩 켠다. 고운 레벨을 끈 입력에서도 흐린 그림을 내도록 따로 학습한
// 인트로용 MLP로 그리다가, 끝에서 최종 MLP 그림으로 겹쳐 넘어간다. 정지 화면과 renderAt(t)은
// 언제나 완성된 그림이다.
//
// 디버그 주소 옵션
//   cpu=1        WebGL2를 쓰지 않고 JS로 계산
//   levels=k     앞의 k개 레벨만 켠 그림
//   at=초        인트로의 그 시각 장면에서 멈춘 그림
(function () {
  'use strict';
  const C = window.ConcertCore;
  const BASE = 'js/neural/';
  const RAMP = 6.2; // 인트로: 레벨을 차례로 켜는 시간(초)
  const INTRO = 7.6; // 그 뒤 최종 MLP로 넘어가는 것까지 끝나는 시각
  const SWIZ = 'xyzw';

  function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // 브라우저에 들어 있는 zlib 해제기를 쓴다 (외부 라이브러리 없이, file://에서도 동작).
  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 DecompressionStream이 없습니다');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // data.js → { size, levels: [{ w, h, F, box, local, data(채널 교차), off }], layers, intro }
  //   layers / intro: [{ nIn, nOut, W, b }] — 최종 그림용 MLP와 인트로용 MLP
  // box는 격자가 덮는 픽셀 상자 [x0, y0, x1, y1]. 그림 전체가 아니면(local) 상자 밖 특징은 0이다.
  async function unpack(meta) {
    const planes = await inflate(fromBase64(meta.grids));
    const levels = [];
    let o = 0;
    meta.levels.forEach(([w, h, F, ...box], i) => {
      // 채널별 평면 → 텍스처용 교차 배열 (r g b a r g b a …)
      const N = w * h;
      const data = new Uint8Array(N * F);
      for (let c = 0; c < F; c++) {
        const plane = planes.subarray(o + c * N, o + (c + 1) * N);
        for (let k = 0; k < N; k++) data[k * F + c] = plane[k];
      }
      const local = box[0] > 0 || box[1] > 0 || box[2] < meta.size || box[3] < meta.size;
      levels.push({ w, h, F, box, local, data, off: meta.off[i] });
      o += N * F;
    });
    // MLP: float32 [W0(입력×출력, 행 우선), b0, W1, b1, …]
    const mlp = (b64) => {
      const f32 = new Float32Array(fromBase64(b64).buffer);
      const layers = [];
      let p = 0;
      for (let i = 0; i + 1 < meta.dims.length; i++) {
        const nIn = meta.dims[i];
        const nOut = meta.dims[i + 1];
        const W = f32.subarray(p, p + nIn * nOut);
        p += nIn * nOut;
        const b = f32.subarray(p, p + nOut);
        p += nOut;
        layers.push({ nIn, nOut, W, b });
      }
      return layers;
    };
    return {
      size: meta.size,
      levels,
      layers: mlp(meta.mlp),
      // 인트로용 MLP: 같은 격자로 고운 레벨을 끈 입력에서도 흐린 그림을 내도록 따로 학습한 것
      intro: meta.mlpIntro ? mlp(meta.mlpIntro) : null,
    };
  }

  // 인트로 시각 t에서 레벨 k가 켜지는 정도 (0..1). 앞쪽은 천천히, 뒤로 갈수록 빨라진다. t >= RAMP면 전부 1.
  function levelMix(t, L) {
    const p = Math.pow(C.clamp(t / RAMP, 0, 1), 1.6) * (L + 0.35);
    const out = [];
    for (let k = 0; k < L; k++) out.push(C.smoothstep(0, 1, p - k));
    return out;
  }

  // ── WebGL2 ────────────────────────────────────────────
  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // GLSL 실수 리터럴. 유효숫자 9자리면 float32 값이 그대로 돌아온다.
  function lit(v) {
    if (v === 0) return '0.0';
    const s = Math.fround(v).toPrecision(9);
    return /[.e]/.test(s) ? s : s + '.0';
  }

  // 가중치를 상수로 박아 넣은 프래그먼트 셰이더를 만든다.
  // (유니폼 블록에서 읽는 것보다 SwiftShader에서 8배쯤 빠르고, GPU에서도 손해가 없다.)
  // 층마다 출력 4개씩 묶어 vec4로 계산한다: h_j = b_j + Σ_i mat4(입력 4i..4i+3 → 출력 4j..4j+3) · a_i
  function buildFragment(net, layers) {
    const L = net.levels.length;
    const lines = [];
    const comps = [];
    net.levels.forEach((lv, l) => {
      if (lv.local) {
        // 국소 격자: 상자 좌표로 바꾸고, 상자 밖이면 '특징 0'
        const [x0, y0, x1, y1] = lv.box;
        const at = `vec2(${lit(x0)}, ${lit(y0)})`;
        const size = `vec2(${lit(x1 - x0)}, ${lit(y1 - y0)})`;
        lines.push(`vec2 q${l} = (uv * ${lit(net.size)} - ${at}) / ${size};`);
        lines.push(`vec2 s${l} = step(vec2(0.0), q${l}) * step(q${l}, vec2(1.0));`);
        lines.push(`float in${l} = s${l}.x * s${l}.y;`);
        lines.push(`vec4 f${l} = mix(uOff[${l}], texture(uG${l}, q${l}), uMix[${l}] * in${l});`);
      } else {
        lines.push(`vec4 f${l} = mix(uOff[${l}], texture(uG${l}, uv), uMix[${l}]);`);
      }
      for (let c = 0; c < lv.F; c++) comps.push(`f${l}.${SWIZ[c]}`);
    });
    while (comps.length % 4) comps.push('0.0');
    for (let i = 0; i < comps.length / 4; i++) {
      lines.push(`vec4 a${i} = vec4(${comps.slice(4 * i, 4 * i + 4).join(', ')});`);
    }
    let prev = 'a';
    layers.forEach(({ nIn, nOut, W, b }, li) => {
      const inB = Math.ceil(nIn / 4);
      const outB = Math.ceil(nOut / 4);
      const last = li === layers.length - 1;
      const cur = last ? 'o' : `h${li}_`;
      const w = (i, j) => (i < nIn && j < nOut ? W[i * nOut + j] : 0);
      for (let j = 0; j < outB; j++) {
        const bias = [0, 1, 2, 3].map((r) => lit(4 * j + r < nOut ? b[4 * j + r] : 0));
        let expr = `vec4(${bias.join(', ')})`;
        for (let i = 0; i < inB; i++) {
          // mat4는 열 우선: 열 c = 입력 4i+c가 출력 4j..4j+3에 주는 가중치
          const m = [];
          for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) m.push(lit(w(4 * i + c, 4 * j + r)));
          expr += `\n    + mat4(${m.join(', ')}) * ${prev}${i}`;
        }
        lines.push(last ? `vec4 ${cur}${j} = ${expr};` : `vec4 ${cur}${j} = max(${expr}, 0.0);`);
      }
      prev = cur;
    });
    const samplers = net.levels.map((_, l) => `uniform sampler2D uG${l};`).join('\n');
    return `#version 300 es
precision highp float;
precision highp sampler2D;
${samplers}
uniform vec4 uOff[${L}];
uniform float uMix[${L}];
uniform float uRes; // 그리는 대상의 한 변 픽셀 수 (인트로 앞부분은 절반 해상도)
out vec4 outColor;
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uRes - gl_FragCoord.y) / uRes;
  ${lines.join('\n  ')}
  outColor = vec4(clamp(o0.rgb, 0.0, 1.0), 1.0);
}`;
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('셰이더 컴파일 실패: ' + log);
    }
    return sh;
  }

  function createGL(canvas, net) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2를 쓸 수 없습니다');
    const L = net.levels.length;
    if (L + 1 > gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) throw new Error('텍스처 유닛이 모자랍니다');

    const vert = compile(gl, gl.VERTEX_SHADER, VERT);

    // 화면을 덮는 삼각형 하나
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 특징 격자: 채널 수에 맞는 8비트 텍스처. 행 0이 그림 위쪽이고 셰이더도 위에서부터 잰다.
    const FORMATS = {
      1: [gl.R8, gl.RED],
      2: [gl.RG8, gl.RG],
      3: [gl.RGB8, gl.RGB],
      4: [gl.RGBA8, gl.RGBA],
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const textures = net.levels.map((lv, l) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + l);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const [internal, format] = FORMATS[lv.F];
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, lv.w, lv.h, 0, format, gl.UNSIGNED_BYTE, lv.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    });

    // 레벨을 끈 상태(특징 0)의 텍스처 값
    const off = new Float32Array(4 * L);
    net.levels.forEach((lv, l) => lv.off.forEach((v, c) => (off[4 * l + c] = v)));

    // MLP 하나에 프로그램 하나. 격자 텍스처는 함께 쓴다.
    const programs = [];
    function program(layers) {
      const prog = gl.createProgram();
      gl.attachShader(prog, vert);
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, buildFragment(net, layers)));
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('셰이더 링크 실패: ' + gl.getProgramInfoLog(prog));
      }
      gl.useProgram(prog);
      net.levels.forEach((_, l) => gl.uniform1i(gl.getUniformLocation(prog, 'uG' + l), l));
      gl.uniform4fv(gl.getUniformLocation(prog, 'uOff'), off);
      programs.push(prog);
      return {
        prog,
        mixLoc: gl.getUniformLocation(prog, 'uMix'),
        resLoc: gl.getUniformLocation(prog, 'uRes'),
      };
    }
    const main = program(net.layers);
    const intro = net.intro ? program(net.intro) : main;

    // 인트로 앞부분(흐린 단계)은 절반 해상도로 그린 뒤 늘려 붙인다. 느린 GPU에서도 프레임이 나오게.
    const n = net.size;
    const half = Math.ceil(n / 2);
    const lowTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + L);
    gl.bindTexture(gl.TEXTURE_2D, lowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, half, half);
    const lowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, lowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.disable(gl.DITHER);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);

    // 셰이더는 첫 그리기 때 번역되므로 픽셀 하나짜리로 미리 한 번씩 그려 둔다.
    gl.viewport(0, 0, 1, 1);
    new Set([main, intro]).forEach((p) => {
      gl.useProgram(p.prog);
      gl.uniform1fv(p.mixLoc, new Array(L).fill(0));
      gl.uniform1f(p.resLoc, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });

    function pass(p, mix, res, alpha) {
      gl.useProgram(p.prog);
      gl.uniform1fv(p.mixLoc, mix);
      gl.uniform1f(p.resLoc, res);
      if (alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, alpha);
      } else {
        gl.disable(gl.BLEND);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return {
      // which: 'main' | 'intro'. alpha < 1이면 지금 화면 위에 그만큼만 섞어 그린다.
      draw(mix, which = 'main', alpha = 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, n, n);
        pass(which === 'intro' ? intro : main, mix, n, alpha);
      },
      // 절반 해상도로 그려서 화면 크기로 늘린다 (선형 보간).
      drawLow(mix, which = 'intro') {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lowFbo);
        gl.viewport(0, 0, half, half);
        pass(which === 'intro' ? intro : main, mix, half, 1);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lowFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(0, 0, half, half, 0, 0, n, n, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      finish() {
        // 픽셀 하나를 읽어 그리기가 정말 끝날 때까지 기다린다 (SwiftShader는 finish만으로는 안 기다린다).
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      },
      destroy() {
        textures.forEach((t) => gl.deleteTexture(t));
        gl.deleteTexture(lowTex);
        gl.deleteFramebuffer(lowFbo);
        gl.deleteBuffer(vbo);
        programs.forEach((p) => gl.deleteProgram(p));
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      },
    };
  }

  // ── JS 대체 경로 ─────────────────────────────────────
  // 셰이더와 같은 식: 텍스처 값 q/255를 쌍선형 보간(가장자리 고정) → MLP → 0..1로 자르고 반올림.
  function createCPU(canvas, net) {
    const ctx = canvas.getContext('2d');
    const n = net.size;
    // 축마다 (왼쪽 칸, 오른쪽 칸, 비율, 상자 안인지) — 셰이더의 LINEAR + CLAMP_TO_EDGE와 같은 규칙
    const axis = (R, lo, hi) => {
      const i0 = new Int32Array(n);
      const i1 = new Int32Array(n);
      const f = new Float32Array(n);
      const inside = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        const g = ((p + 0.5 - lo) * R) / (hi - lo) - 0.5;
        const fl = Math.floor(g);
        f[p] = g - fl;
        i0[p] = C.clamp(fl, 0, R - 1);
        i1[p] = C.clamp(fl + 1, 0, R - 1);
        inside[p] = p >= lo && p < hi ? 1 : 0;
      }
      return { i0, i1, f, inside };
    };
    const axes = net.levels.map(({ w, h, box }) => ({
      x: axis(w, box[0], box[2]),
      y: axis(h, box[1], box[3]),
    }));
    const widths = net.layers.map((l) => l.nOut);
    const bufs = [new Float32Array(net.layers[0].nIn)].concat(widths.map((w) => new Float32Array(w)));

    function pixel(x, y, mix, out, o) {
      const a = bufs[0];
      let k = 0;
      for (let l = 0; l < net.levels.length; l++) {
        const { w, F, data, off } = net.levels[l];
        const { x: ax, y: ay } = axes[l];
        const m = ax.inside[x] && ay.inside[y] ? mix[l] : 0;
        const x0 = ax.i0[x];
        const x1 = ax.i1[x];
        const fx = ax.f[x];
        const y0 = ay.i0[y] * w;
        const y1 = ay.i1[y] * w;
        const fy = ay.f[y];
        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;
        for (let c = 0; c < F; c++) {
          const v =
            (data[(y0 + x0) * F + c] * w00 +
              data[(y0 + x1) * F + c] * w01 +
              data[(y1 + x0) * F + c] * w10 +
              data[(y1 + x1) * F + c] * w11) /
            255;
          a[k++] = off[c] + (v - off[c]) * m;
        }
      }
      for (let li = 0; li < net.layers.length; li++) {
        const { nIn, nOut, W, b } = net.layers[li];
        const src = bufs[li];
        const dst = bufs[li + 1];
        for (let j = 0; j < nOut; j++) dst[j] = b[j];
        for (let i = 0; i < nIn; i++) {
          const v = src[i];
          if (v === 0) continue;
          const row = i * nOut;
          for (let j = 0; j < nOut; j++) dst[j] += v * W[row + j];
        }
        if (li < net.layers.length - 1) for (let j = 0; j < nOut; j++) if (dst[j] < 0) dst[j] = 0;
      }
      const res = bufs[net.layers.length];
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(C.clamp(res[c], 0, 1) * 255);
      out[o + 3] = 255;
    }

    let job = 0;
    return {
      // 행 묶음씩 계산하고 프레임마다 양보한다. 끝나면 resolve.
      draw(mix) {
        const my = ++job;
        return new Promise((resolve) => {
          let y = 0;
          const step = () => {
            if (my !== job) return resolve(false);
            const start = performance.now();
            while (y < n && performance.now() - start < 14) {
              const rows = Math.min(8, n - y);
              const img = ctx.createImageData(n, rows);
              for (let r = 0; r < rows; r++) {
                for (let x = 0; x < n; x++) pixel(x, y + r, mix, img.data, (r * n + x) * 4);
              }
              ctx.putImageData(img, 0, y);
              y += rows;
            }
            if (y < n) requestAnimationFrame(step);
            else resolve(true);
          };
          step();
        });
      },
      cancel() {
        job++;
      },
    };
  }

  C.define('neural', {
    async mount(host, opts) {
      await C.loadScript(BASE + 'data.js');
      const meta = window.ConcertData && window.ConcertData.neural;
      if (!meta) throw new Error('신경망 데이터(js/neural/data.js)가 없습니다');
      const net = await unpack(meta);
      const L = net.levels.length;
      const params = opts.params || new URLSearchParams();
      const only = parseInt(params.get('levels') || '', 10);
      const full = Array.from({ length: L }, (_, k) => (only > 0 && k >= only ? 0 : 1));

      const makeCanvas = () => {
        const c = C.makeCanvas(net.size, net.size);
        c.style.cssText = 'display:block;width:100%;height:100%';
        host.appendChild(c);
        return c;
      };

      let canvas = makeCanvas();
      let gpu = null;
      if (params.get('cpu') !== '1') {
        try {
          gpu = createGL(canvas, net);
        } catch (err) {
          console.warn('neural: WebGL2 대신 JS로 계산합니다 —', err.message);
          canvas.remove();
          canvas = makeCanvas();
        }
      }

      // JS 경로는 한 장 계산에 몇 초가 걸리므로 인트로 없이 위에서부터 채워 나간다.
      if (!gpu) {
        const cpu = createCPU(canvas, net);
        const done = cpu.draw(full);
        if (!opts.animate) await done;
        return {
          destroy() {
            cpu.cancel();
            canvas.remove();
          },
          async renderAt() {
            await done;
          },
          setPlaying() {},
        };
      }

      // WebGL 경로. 인트로: 인트로용 MLP로 거친 레벨부터 차례로 켜고(RAMP까지),
      // 그 뒤 최종 MLP 그림을 서서히 겹쳐 넘어간다(INTRO까지). 매 프레임 그림 전체를 다시 계산한다.
      const paint = (t) => {
        if (t >= INTRO) {
          gpu.draw(full);
          return;
        }
        const mix = levelMix(t, L).map((m, k) => m * full[k]);
        // 켜진 격자가 모두 픽셀 두 개에 한 칸 이하로 성기면 절반 해상도로도 충분하다.
        const coarse = net.levels.every((lv, k) => mix[k] === 0 || lv.w / (lv.box[2] - lv.box[0]) <= 0.5);
        if (coarse) gpu.drawLow(mix);
        else gpu.draw(mix, 'intro');
        if (t > RAMP) gpu.draw(full, 'main', C.smoothstep(RAMP, INTRO, t));
      };
      let playing = !!opts.animate;
      let introT = playing ? 0 : INTRO;
      let last = null;
      let raf = 0;
      let alive = true;

      const frame = (now) => {
        raf = 0;
        if (!alive) return;
        // 느린 렌더러(소프트웨어 WebGL)에서도 제시간에 끝나게 실제 경과 시간을 쓰되, 탭이 잠들었다 깨면 끊어 준다.
        if (last !== null && playing) introT += Math.min(0.5, (now - last) / 1000);
        last = now;
        paint(introT);
        if (playing && introT < INTRO) raf = requestAnimationFrame(frame);
      };

      const at = parseFloat(params.get('at'));
      if (playing) {
        paint(0);
        raf = requestAnimationFrame(frame);
      } else {
        paint(at >= 0 ? at : INTRO);
        gpu.finish();
      }

      return {
        destroy() {
          alive = false;
          if (raf) cancelAnimationFrame(raf);
          gpu.destroy();
          canvas.remove();
        },
        renderAt() {
          // 정지 화면은 언제나 완성된 그림
          introT = INTRO;
          paint(INTRO);
          gpu.finish();
        },
        setPlaying(next) {
          playing = !!next;
          last = null;
          if (playing && introT < INTRO && !raf && alive) raf = requestAnimationFrame(frame);
        },
      };
    },
  });
})();
