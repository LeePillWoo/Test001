#!/usr/bin/env python3
"""신경망 기억: 좌표 (x, y)를 색 (r, g, b)로 바꾸는 작은 신경장(neural field)을 원본에 맞춰 학습한다.

구조 (Instant-NGP식 조밀 다중 해상도 특징 격자 + 작은 MLP)
    픽셀 중심 좌표 → 해상도가 다른 특징 격자 8장에서 쌍선형 보간 → 특징 23개를 이어 붙여
    MLP(23 → 32 → 32 → 3, ReLU) → RGB. 격자 값과 MLP 가중치가 곧 그림이다.
    격자: 16² 32² 64² 128² 256² (특징 4개) · 400² (2개) · 800² (1개) · 얼굴 상자 300×250 (1개, 픽셀당 한 칸).
    고운 레벨일수록 특징 수를 줄이고 해상도를 올리는 편이 같은 용량에서 더 또렷했다.
    보간 규칙은 WebGL의 LINEAR + CLAMP_TO_EDGE와 같아서, 브라우저는 격자를 텍스처로 올리고
    프래그먼트 셰이더에서 MLP만 계산하면 된다.

학습 (numpy만, 손으로 짠 순전파/역전파)
    묶음은 픽셀 행 52줄(≈6.5만 픽셀) 전체다. 그러면 가로 보간이 행렬 곱 하나라 numpy로도 빠르다.
    행은 윤곽선·얼굴이 많은 줄을 더 자주 뽑고, 픽셀마다 손실 가중치도 준다. Adam(격자는 건드린 행만).
    시드가 고정이라 같은 옵션이면 같은 결과가 나온다.

양자화와 내보내기
    격자는 채널마다 7~8비트로 줄인다(최솟값·간격은 첫 층 가중치와 편향에 접어 넣어 셰이더는 텍스처 값을
    그대로 쓴다). 양자화한 격자로 순전파하며 조금 더 학습(QAT)하고, MLP만 한 번 더 다듬는다.
    격자는 채널별 평면으로 이어 zlib로 줄이고(브라우저의 DecompressionStream으로 푼다) base64로 쓴다.
    같은 데이터로 파이썬에서 다시 그린 그림(--png)도 남겨 브라우저 렌더와 반올림 오차 안에서 같은지 본다.

인트로용 MLP
    같은 격자(고정)에 MLP를 하나 더 학습한다. 고운 레벨 몇 장을 끈(특징 0) 입력에서도 흐린 그림을
    내도록 가르쳐서, 브라우저 인트로에서 거친 격자부터 차례로 켜면 그림이 점점 또렷해진다.
    최종 그림의 MLP와 따로라서 최종 품질을 깎지 않는다 (한 MLP로 함께 배우면 약 2 dB 손해였다).

    OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 python3 concert/tools/train_neural.py --png /tmp/n/recon.png
    python3 concert/tools/train_neural.py --steps 600 --out /tmp/n/data.js --png /tmp/n/recon.png
"""
import argparse
import base64
import json
import os
import sys
import time
import zlib

for _k in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_k, '2')

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(ROOT, 'assets', 'reference.jpg')
OUT = os.path.join(ROOT, 'js', 'neural', 'data.js')

# 얼굴(눈·입) 영역: 픽셀을 더 자주 뽑는다. (cx, cy, rx, ry) — 원본 좌표
FACE = (880, 300, 230, 190)


def parse_levels(text, n):
    """'16:4,...,512:2,384x320:2@700/150/1084/470' → [(가로칸, 세로칸, 특징 수, 상자), ...]

    'R:F'는 그림 전체를 덮는 R×R 격자, 'WxH:F@x0/y0/x1/y1'은 그 상자만 덮는 국소 격자다.
    국소 격자는 상자 밖에서 특징이 0이다 (얼굴처럼 더 촘촘해야 하는 곳에만 칸을 더 쓴다).
    """
    out = []
    for part in text.split(','):
        res, rest = part.split(':')
        F, _, box = rest.partition('@')
        w, _, h = res.partition('x')
        box = tuple(int(v) for v in box.split('/')) if box else (0, 0, n, n)
        out.append((int(w), int(h or w), int(F), box))
    return out


def axis_table(R, n, lo=0, hi=None):
    """n개 픽셀 중심이 [lo, hi) 구간을 덮는 R칸 격자에서 어느 두 격자점 사이에 있는지와 보간 비율.

    WebGL 텍스처의 LINEAR + CLAMP_TO_EDGE와 같은 규칙이다: u = (i + 0.5 − lo) / (hi − lo), g = u·R − 0.5.
    inside는 픽셀이 구간 안에 있는지 (밖이면 특징 0).
    """
    hi = n if hi is None else hi
    p = np.arange(n, dtype=np.float64)
    g = (p + 0.5 - lo) * (R / (hi - lo)) - 0.5
    i0 = np.floor(g)
    f = (g - i0).astype(np.float32)
    i0 = i0.astype(np.int64)
    inside = ((p >= lo) & (p < hi)).astype(np.float32)
    return np.clip(i0, 0, R - 1), np.clip(i0 + 1, 0, R - 1), f, inside


def interp_matrix(table, R):
    """한 축의 선형 보간을 (n, R) 행렬로. 가로 보간은 이 행렬 곱 한 번이면 된다."""
    i0, i1, f, inside = table
    n = i0.size
    A = np.zeros((n, R), np.float32)
    np.add.at(A, (np.arange(n), i0), (1 - f) * inside)
    np.add.at(A, (np.arange(n), i1), f * inside)
    return A


class Adam:
    """Adam. 격자는 이번 묶음이 건드린 행만 갱신한다(행 단위 희소 갱신)."""

    def __init__(self, params, b1=0.9, b2=0.99, eps=1e-10):
        self.m = [np.zeros_like(p) for p in params]
        self.v = [np.zeros_like(p) for p in params]
        self.b1, self.b2, self.eps, self.t = b1, b2, eps, 0

    def step(self, params, grads, lr):
        self.t += 1
        c1 = 1 - self.b1 ** self.t
        c2 = 1 - self.b2 ** self.t
        for p, g, m, v in zip(params, grads, self.m, self.v):
            rows = slice(None)
            if isinstance(g, tuple):  # (행 번호, 그 행들의 기울기)
                rows, g = g
            mr = self.b1 * m[rows] + (1 - self.b1) * g
            vr = self.b2 * v[rows] + (1 - self.b2) * (g * g)
            m[rows] = mr
            v[rows] = vr
            p[rows] -= (lr / c1) * mr / (np.sqrt(vr / c2) + self.eps)


class Field:
    """다중 해상도 특징 격자 + ReLU MLP. 격자 하나는 (세로칸, 가로칸, F) 배열이고 행 0이 위쪽이다.

    학습 묶음은 픽셀 행 몇 줄 전체다. 그러면 가로 보간이 행렬 곱 하나가 되어 numpy로도 빠르다.
    """

    def __init__(self, levels, hidden, size, rng, mean_color):
        self.levels = levels
        self.size = size
        self.ty = [axis_table(h, size, box[1], box[3]) for w, h, F, box in levels]
        tx = [axis_table(w, size, box[0], box[2]) for w, h, F, box in levels]
        self.mats = [interp_matrix(t, w) for t, (w, _, _, _) in zip(tx, levels)]
        self.inside_x = [t[3] for t in tx]
        self.grids = [rng.uniform(-1e-4, 1e-4, (h, w, F)).astype(np.float32) for w, h, F, _ in levels]
        self.widths = [F for _, _, F, _ in levels]
        self.init_mlp(hidden, rng, mean_color)

    def init_mlp(self, hidden, rng, mean_color):
        """He 초기화. 마지막 편향은 평균색에서 시작한다."""
        dims = [sum(self.widths)] + list(hidden) + [3]
        self.W, self.b = [], []
        for a, c in zip(dims[:-1], dims[1:]):
            self.W.append((rng.standard_normal((a, c)) * np.sqrt(2.0 / a)).astype(np.float32))
            self.b.append(np.zeros(c, np.float32))
        self.b[-1][:] = mean_color

    # ── 인코딩: 레벨마다 쌍선형 보간 (세로: 작은 가중치 행렬, 가로: 보간 행렬) ──
    def encode(self, ys, grids=None):
        """ys: 픽셀 행 번호들. 반환: 특징 (len(ys)·n, D)와 역전파용 캐시."""
        grids = self.grids if grids is None else grids
        m, n = len(ys), self.size
        feats, cache = [], []
        for (w, h, F, _), G, A, (a0, a1, af, ins) in zip(self.levels, grids, self.mats, self.ty):
            y0, y1, fy, iy = a0[ys], a1[ys], af[ys], ins[ys]
            rr, inv = np.unique(np.concatenate([y0, y1]), return_inverse=True)
            k = rr.size
            Wy = np.zeros((m, k), np.float32)
            np.add.at(Wy, (np.arange(m), inv[:m]), (1 - fy) * iy)
            np.add.at(Wy, (np.arange(m), inv[m:]), fy * iy)
            Gx = (G[rr].transpose(0, 2, 1).reshape(k * F, w) @ A.T).reshape(k, F * n)
            feats.append((Wy @ Gx).reshape(m, F, n).transpose(0, 2, 1).reshape(m * n, F))
            cache.append((rr, Wy))
        return np.concatenate(feats, axis=1), cache

    def grid_grads(self, dX, cache):
        out, o = [], 0
        n = self.size
        for (w, h, F, _), A, (rr, Wy) in zip(self.levels, self.mats, cache):
            m, k = Wy.shape
            d = dX[:, o:o + F].reshape(m, n, F).transpose(0, 2, 1).reshape(m, F * n)
            o += F
            dGx = (Wy.T @ d).reshape(k * F, n)
            out.append((rr, (dGx @ A).reshape(k, F, w).transpose(0, 2, 1)))
        return out

    # ── MLP ──
    def mlp(self, X, W=None, b=None):
        W = self.W if W is None else W
        b = self.b if b is None else b
        acts = [X]
        h = X
        for i, (Wi, bi) in enumerate(zip(W, b)):
            h = h @ Wi
            h += bi
            if i < len(W) - 1:
                np.maximum(h, 0, out=h)
            acts.append(h)
        return h, acts

    def mlp_grads(self, acts, dY):
        dW, db = [None] * len(self.W), [None] * len(self.W)
        d = dY
        for i in range(len(self.W) - 1, -1, -1):
            dW[i] = acts[i].T @ d
            db[i] = d.sum(0)
            d = d @ self.W[i].T  # i = 0이면 입력 특징에 대한 기울기
            if i > 0:
                d *= acts[i] > 0
        return dW, db, d


def importance(ref):
    """픽셀 가중치: 바탕 1 + 윤곽 세기 + 얼굴 가산. 행을 뽑는 확률과 손실 가중에 쓴다."""
    lum = ref @ np.array([0.299, 0.587, 0.114], np.float32)
    gy, gx = np.gradient(lum)
    edge = np.sqrt(gx * gx + gy * gy)
    edge = np.clip(edge / (np.percentile(edge, 99) + 1e-6), 0, 1)
    H, W = lum.shape
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy, rx, ry = FACE
    face = np.clip(1.5 - np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2), 0, 1)
    return (1.0 + 1.5 * edge + 2.0 * face).astype(np.float32)


def render(field, grids=None, W=None, b=None, keep_levels=None, fill=None, rows=32):
    """전체 그림을 픽셀 중심마다 계산한다 (브라우저 셰이더와 같은 식).

    fill: 레벨이 꺼졌거나 상자 밖일 때 넣는 값(레벨마다 F개). 학습 공간에서는 0이고,
          텍스처 공간(접어 넣은 가중치)에서는 '특징 0'에 해당하는 텍스처 값이다.
    """
    n = field.size
    fill = [np.zeros(F, np.float32) for F in field.widths] if fill is None else fill
    keep = level_mask(field.levels, len(field.levels) if keep_levels is None else keep_levels)
    img = np.zeros((n, n, 3), np.float32)
    for y in range(0, n, rows):
        ys = np.arange(y, min(n, y + rows))
        X, _ = field.encode(ys, grids)
        # 덮는 정도(상자 안 1, 밖 0)와 켜짐을 곱한 만큼 격자 값, 나머지는 fill
        cover = np.concatenate([np.repeat(np.outer(ty[3][ys], ix).reshape(-1, 1), F, axis=1)
                                for ty, ix, F in zip(field.ty, field.inside_x, field.widths)], axis=1) * keep
        X = X * cover + (1 - cover) * np.concatenate(fill)
        Y, _ = field.mlp(X, W, b)
        img[y:y + rows] = Y.reshape(-1, n, 3)
    return img


def level_mask(levels, k):
    """앞의 k개 레벨만 남기는 특징 마스크 (D,)"""
    return np.concatenate([np.full(lv[2], 1.0 if li < k else 0.0, np.float32) for li, lv in enumerate(levels)])


def psnr(a, b):
    mse = float(((np.clip(a, 0, 1) - b) ** 2).mean())
    return 10 * np.log10(1.0 / max(mse, 1e-12))


def train(field, ref, args, rng, steps, mlp_only=False, grids=None, lr_scale=None, qat=None, log_every=250):
    """격자와 MLP를 학습한다. mlp_only면 grids(고정)를 쓰고 MLP만 바꾼다.

    qat가 있으면(레벨마다 (lo, step, top)) 순전파는 양자화한 격자로 하고 기울기는 실수 격자에 그대로 준다
    (양자화 인지 학습, straight-through).
    """
    n = field.size
    imp = importance(ref)
    row_p = imp.mean(1) ** 0.5
    row_p /= row_p.sum()
    pix_w = imp / imp.mean(1, keepdims=True)
    L = len(field.levels)
    params = ([] if mlp_only else field.grids) + field.W + field.b
    opt = Adam(params)
    t0 = time.time()
    ema = None
    lr0 = args.lr * (lr_scale if lr_scale is not None else 0.03 if mlp_only else 1.0)
    for step in range(steps):
        # 학습률: 앞 40%는 그대로, 그 뒤로 코사인으로 2%까지
        prog = step / max(1, steps - 1)
        k = 1.0 if prog < 0.4 else 0.02 + 0.98 * 0.5 * (1 + np.cos(np.pi * (prog - 0.4) / 0.6))
        lr = lr0 * k
        ys = np.sort(rng.choice(n, args.rows, replace=False, p=row_p))
        if qat is not None:
            grids = [dequant(quant(G, *qp), *qp) for G, qp in zip(field.grids, qat)]
        X, cache = field.encode(ys, grids)
        keep = None
        if args.nested > 0:
            # 중첩 학습: 일부 픽셀은 고운 레벨 몇 장을 끈다(특징 0). 최소 nested_min장은 남긴다.
            cut = rng.random(X.shape[0]) < args.nested
            lvl = np.where(cut, rng.integers(args.nested_min, L, X.shape[0]), L)
            first = np.repeat(np.arange(L), field.widths)
            keep = (lvl[:, None] > first[None, :]).astype(np.float32)
            X *= keep
        Y, acts = field.mlp(X)
        err = Y - ref[ys].reshape(-1, 3)
        w = pix_w[ys].reshape(-1, 1)
        loss = float((err * err).mean())
        dY = (2.0 / err.size) * err * w
        dW, db, dX = field.mlp_grads(acts, dY)
        grads = []
        if not mlp_only:
            if keep is not None:
                dX *= keep
            grads += field.grid_grads(dX, cache)
        for i in range(len(dW)):
            dW[i] += args.wd * field.W[i]
        grads += dW + db
        opt.step(params, grads, lr)
        ema = loss if ema is None else 0.97 * ema + 0.03 * loss
        if step % log_every == 0 or step == steps - 1:
            print(f'  {"mlp" if mlp_only else "all"} step {step:5d}  loss {ema:.5f}'
                  f'  psnr~{10 * np.log10(1 / ema):.2f}  lr {lr:.4f}  {time.time() - t0:.0f}s', flush=True)


def quant_params(grids, bits):
    """채널마다 0.01%~99.99% 범위를 bits비트로 나누는 눈금. [(lo, step, top), ...]"""
    out = []
    for G, nb in zip(grids, bits):
        top = (1 << nb) - 1
        lo = np.percentile(G, 0.01, axis=(0, 1)).astype(np.float32)
        hi = np.percentile(G, 99.99, axis=(0, 1)).astype(np.float32)
        out.append((lo, (np.maximum(hi - lo, 1e-6) / top).astype(np.float32), top))
    return out


def quant(G, lo, step, top):
    return np.clip(np.round((G - lo) / step), 0, top).astype(np.uint8)


def dequant(q, lo, step, top):
    return q.astype(np.float32) * step + lo


def fold(Ws, bs, qs):
    """역양자화를 첫 층에 접어 넣는다. 텍스처 값 t = q/255이면 특징 = t·(255·step) + lo."""
    gain = np.concatenate([255.0 * st for _, _, st in qs]).astype(np.float64)
    lo = np.concatenate([lo for _, lo, _ in qs]).astype(np.float64)
    W = [w.astype(np.float64) for w in Ws]
    b = [x.astype(np.float64) for x in bs]
    b[0] = b[0] + lo @ W[0]
    W[0] = W[0] * gain[:, None]
    return [w.astype(np.float32) for w in W], [x.astype(np.float32) for x in b]


def save_png(img, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Image.fromarray(np.round(np.clip(img, 0, 1) * 255).astype(np.uint8)).save(path)


def write_data(path, field, qs, W, b, off, intro, extra):
    """data.js: 격자는 레벨·채널별 평면으로 이어 붙여 zlib로 줄인 뒤 base64, MLP는 float32 base64."""
    planes = b''.join(np.ascontiguousarray(q.transpose(2, 0, 1)).tobytes() for q, _, _ in qs)
    packed = zlib.compress(planes, 9)
    def flat(Ws, bs):
        return np.concatenate([np.concatenate([w.ravel(), x]) for w, x in zip(Ws, bs)]).astype('<f4')

    mlp_arr = flat(W, b)
    meta = {
        'size': field.size,
        'levels': [[w, h, F, *box] for w, h, F, box in field.levels],
        'dims': [int(W[0].shape[0])] + [int(w.shape[1]) for w in W],
        'off': [[round(float(v), 6) for v in o] for o in off],
        **extra,
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// tools/train_neural.py가 만든다. 직접 고치지 않는다.\n')
        f.write('// grids: zlib(레벨마다 채널별 R×R uint8 평면, 행 0이 위), mlp: float32 [W0, b0, W1, b1, ...]\n')
        f.write('window.ConcertData = window.ConcertData || {};\n')
        f.write('window.ConcertData.neural = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
        f.write(f"window.ConcertData.neural.grids = '{base64.b64encode(packed).decode('ascii')}';\n")
        f.write(f"window.ConcertData.neural.mlp = '{base64.b64encode(mlp_arr.tobytes()).decode('ascii')}';\n")
        if intro:
            f.write(f"window.ConcertData.neural.mlpIntro = '{base64.b64encode(flat(*intro).tobytes()).decode('ascii')}';\n")
    return len(planes), len(packed), mlp_arr.nbytes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--levels', default='16:4,32:4,64:4,128:4,256:4,400:2,800:1,300x250:1@760/180/1060/430')
    ap.add_argument('--hidden', default='32,32')
    ap.add_argument('--bits', default='8,8,8,7,7,7,7,7', help='레벨별 양자화 비트 (하나면 전부 같게)')
    ap.add_argument('--steps', type=int, default=8000)
    ap.add_argument('--qat-steps', type=int, default=600, help='양자화 인지 학습 단계 수')
    ap.add_argument('--qat-lr', type=float, default=0.1, help='QAT 학습률 배율')
    ap.add_argument('--tune-steps', type=int, default=200, help='양자화 뒤 MLP만 다듬는 단계 수')
    ap.add_argument('--rows', type=int, default=52, help='한 묶음의 픽셀 행 수 (52행 ≈ 6.5만 픽셀)')
    ap.add_argument('--lr', type=float, default=0.01)
    ap.add_argument('--wd', type=float, default=1e-6)
    ap.add_argument('--nested', type=float, default=0.0)
    ap.add_argument('--nested-min', type=int, default=2)
    ap.add_argument('--seed', type=int, default=1254)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--png', default='', help='양자화된 최종 모델로 파이썬에서 다시 그린 그림')
    ap.add_argument('--save', default='', help='학습된 실수 모델을 .npz로 저장 (실험용)')
    ap.add_argument('--load', default='', help='학습을 건너뛰고 .npz 모델에서 시작 (실험용)')
    ap.add_argument('--intro-steps', type=int, default=1500, help='인트로용 MLP 학습 단계 수 (0이면 없음)')
    ap.add_argument('--stages-png', default='', help='레벨을 하나씩 켠 중간 그림들의 접두어')
    args = ap.parse_args()

    t_start = time.time()
    rng = np.random.default_rng(args.seed)

    # 학습 뒤 단계마다 따로 시드를 둔다: --load로 이어 해도 처음부터 돌린 것과 같은 결과가 나온다.
    def phase_rng(k):
        return np.random.default_rng(args.seed + 1000 * k)

    ref = np.asarray(Image.open(REF).convert('RGB'), dtype=np.float32) / 255.0
    n = ref.shape[0]
    levels = parse_levels(args.levels, n)
    hidden = [int(v) for v in args.hidden.split(',') if v]
    bits = [int(v) for v in args.bits.split(',')]
    bits = bits * len(levels) if len(bits) == 1 else bits
    field = Field(levels, hidden, n, rng, ref.reshape(-1, 3).mean(0))
    n_grid = sum(w * h * F for w, h, F, _ in levels)
    n_mlp = sum(w.size for w in field.W) + sum(b.size for b in field.b)
    print(f'levels {levels}  bits {bits}  hidden {hidden}  grid params {n_grid}  mlp params {n_mlp}', flush=True)

    if args.load:
        z = np.load(args.load)
        arrs = [z[f'arr_{i}'] for i in range(len(z.files))]
        L, nl = len(levels), len(field.W)
        field.grids, field.W, field.b = arrs[:L], arrs[L:L + nl], arrs[L + nl:]
    else:
        train(field, ref, args, rng, args.steps)
    t_train = time.time() - t_start
    if args.save:
        np.savez(args.save, *field.grids, *field.W, *field.b)
    print(f'float  psnr {psnr(render(field), ref):.2f} dB  (train {t_train:.0f}s)', flush=True)

    # ── 양자화: 눈금을 정하고, 양자화한 격자로 순전파하며 조금 더 학습(QAT)한 뒤 정수로 굳힌다 ──
    qp = quant_params(field.grids, bits)
    print(f'quant  psnr {psnr(render(field, grids=[dequant(quant(G, *p), *p) for G, p in zip(field.grids, qp)]), ref):.2f} dB'
          ' (before QAT)', flush=True)
    if args.qat_steps:
        args_q = argparse.Namespace(**vars(args))
        args_q.nested = 0.0
        train(field, ref, args_q, phase_rng(2), args.qat_steps, lr_scale=args.qat_lr, qat=qp)
    qs = [(quant(G, *p), p[0], p[1]) for G, p in zip(field.grids, qp)]
    deq = [dequant(q, *p) for (q, _, _), p in zip(qs, qp)]
    p_quant = psnr(render(field, grids=deq), ref)
    print(f'quant  psnr {p_quant:.2f} dB (after QAT)', flush=True)

    # ── 양자화된 격자를 고정한 채 MLP만 다듬기 (나빠지면 되돌린다) ──
    if args.tune_steps:
        backup = ([w.copy() for w in field.W], [x.copy() for x in field.b])
        args_t = argparse.Namespace(**vars(args))
        args_t.nested = 0.0
        train(field, ref, args_t, phase_rng(3), args.tune_steps, mlp_only=True, grids=deq)
        p_tuned = psnr(render(field, grids=deq), ref)
        print(f'tuned  psnr {p_tuned:.2f} dB', flush=True)
        if p_tuned < p_quant:
            field.W, field.b = backup

    # ── 인트로용 MLP: 같은 격자(고정)로, 고운 레벨을 몇 장 끈 입력에서도 흐린 그림을 내도록 따로 학습 ──
    # 최종 그림의 MLP와 분리되어 있어서 최종 품질을 깎지 않는다.
    intro = None
    if args.intro_steps:
        main = (field.W, field.b)
        field.init_mlp(hidden, np.random.default_rng(args.seed + 1), ref.reshape(-1, 3).mean(0))
        args_i = argparse.Namespace(**vars(args))
        args_i.nested, args_i.nested_min = 0.85, 0
        train(field, ref, args_i, phase_rng(4), args.intro_steps, mlp_only=True, grids=deq, lr_scale=0.5)
        intro = fold(field.W, field.b, qs)
        field.W, field.b = main

    # ── 브라우저와 같은 데이터로 다시 그리기: 텍스처 값 q/255 + 접어 넣은 첫 층 ──
    W, b = fold(field.W, field.b, qs)
    tex = [q.astype(np.float32) / 255 for q, _, _ in qs]
    # '특징 0'(레벨을 껐거나 국소 격자 상자 밖)에 해당하는 텍스처 값
    off = [(-lo / (255.0 * st)).astype(np.float32) for _, lo, st in qs]
    final = render(field, grids=tex, W=W, b=b, fill=off)
    p_final = psnr(final, ref)
    print(f'final  psnr {p_final:.2f} dB (quantized, folded)', flush=True)
    if args.png:
        save_png(final, args.png)
        print(f'wrote {args.png}')
    if args.stages_png:
        # 인트로 단계: 거친 레벨부터 k장만 켰을 때의 그림 (중첩 학습을 했을 때 의미가 있다)
        iW, ib = intro or (W, b)
        for k in range(len(levels) + 1):
            save_png(render(field, grids=tex, W=iW, b=ib, keep_levels=k, fill=off), f'{args.stages_png}_{k}.png')

    extra = {'psnr': round(p_final, 2), 'params': {'grid': n_grid, 'mlp': n_mlp}, 'bits': bits,
             'seconds': round(time.time() - t_start)}
    raw, packed, mlp_bytes = write_data(args.out, field, qs, W, b, off, intro, extra)
    size = os.path.getsize(args.out)
    print(f'wrote {args.out}  {size} bytes ({size / 1024:.0f} KB)  grids {raw} B → zlib {packed} B,'
          f' mlp {mlp_bytes} B  total {time.time() - t_start:.0f}s')


if __name__ == '__main__':
    sys.exit(main())
