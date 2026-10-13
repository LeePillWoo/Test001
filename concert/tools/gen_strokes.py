#!/usr/bin/env python3
"""붓질 렌더링(strokes) 데이터 생성기.

Hertzmann(1998) "Painterly Rendering with Curved Brush Strokes of Multiple Sizes"를 바탕으로
몇 가지를 고쳐서, 원본을 굵은 붓부터 가는 붓까지 겹쳐 칠한 붓질 목록을 만든다.

    python3 concert/tools/gen_strokes.py                  # concert/js/strokes/data.js 생성
    python3 concert/tools/gen_strokes.py --preview a.png  # 시뮬레이션 결과도 PNG로 저장 (+층별 점수)
    python3 concert/tools/gen_strokes.py --set 4.T=12     # 층 설정 덮어쓰기 (실험용)

알고리즘 (층마다, 큰 붓 → 작은 붓)
  1. 목표 = 원본을 붓 반지름에 비례해 흐린 그림.
  2. 격자 칸마다 (현재 캔버스 − 목표) 색차 평균 × 중요도가 문턱값을 넘으면,
     그 칸에서 오차가 가장 큰 점을 붓질 씨앗으로 삼는다.
  3. 씨앗들을 칸 번호의 해시 순서로 칠한다. 런타임도 같은 해시로 순서를 재현하므로
     붓을 칸 순서대로 저장해 위치를 작은 증분으로 적을 수 있다.
  4. 붓질은 씨앗에서 양쪽으로 자란다. 방향은 여러 크기로 다듬은 구조 텐서의 결(그라디언트에 수직)을
     따르고, 곡률 필터 · 최대 길이 · 색 경계(목표색이 씨앗 색과 많이 다르면 멈춤) ·
     Hertzmann 종료 조건(캔버스가 이미 붓 색보다 목표에 가까우면 멈춤)으로 끝난다.
  5. 붓 색 = 덮임 비율까지 고려한 최소제곱 해(목표색 범위로 자름)를 채널당 6비트로 양자화.
     실제로 칠해 봐서 오차가 충분히 줄지 않으면 버린다.
  캔버스 시뮬레이션은 Canvas 2D의 둥근 끝 굵은 선을 따라 한다: 폴리라인까지의 거리 d로
  덮임 비율 clamp(r + 0.5 − d, 0, 1)을 구해 섞는다 (크로미움 결과와 평균 1/255 안쪽으로 맞는다).

데이터 형식 (zlib 압축 → base64, window.ConcertData.strokes)
  머리: 'STK2', 층 수(u8), 배경색(3×u8),
        층마다 반지름×4(u16) · 걸음×16(u16) · 격자(u8) · 붓 수(u32),
        스트림 길이 7개(u32)
  스트림(바이트열, 붓은 층별 칸 번호 순):
    cell  칸 번호 증분−1 (varint)        off  칸 안 위치 oy·g+ox (varint)
    r,g,b 색 (각 0~63, 앞 붓과의 차 mod 64)  len  팔 길이 (뒷팔<<4 | 앞팔)
    ang   방향 (256분할; 팔마다 첫 값은 절댓값, 그다음은 앞 값과의 차 mod 256; 앞팔 → 뒷팔)
  점 좌표는 1/16 px 고정소수점 정수로 누적한다. 씨앗 = 칸 안 픽셀의 중심.
"""
import argparse
import base64
import math
import os
import sys
import time
import zlib

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
REF = os.path.join(ROOT, 'assets', 'reference.jpg')
OUT = os.path.join(ROOT, 'js', 'strokes', 'data.js')

W = H = 1254
SEED = 7
NA = 256  # 방향 양자화 단계 수
CQ = 64  # 색 채널 양자화 단계 수
LEVELS = np.array([round(q * 255 / (CQ - 1)) for q in range(CQ)], np.float32)

# 층 설정
#   r      붓 반지름(px). 선 굵기 = 2r
#   g      격자 칸 크기(px)
#   T      칸 평균 (색차 × 중요도) 문턱값 (RGB 유클리드, 0~441). 0이면 모든 칸
#   blur   목표 흐림 σ = blur × r
#   step   한 걸음 길이 = step × r (px)
#   arm    한쪽 팔 최대 걸음 수 (≤ 15)
#   minarm Hertzmann 종료 조건을 보기 전 최소 걸음 수
#   fc     곡률 필터 (1 = 결을 그대로, 0 = 직선)
#   tc     색 경계 문턱값: 목표색이 씨앗 색과 이만큼 다르면 더 가지 않는다
#   imin   이 층을 칠할 최소 중요도 (가는 붓은 중요한 곳만)
#   gain   붓 한 번이 덮인 픽셀당 줄여야 하는 최소 오차 (색차 단위, 제곱해서 비교)
LAYERS = [
    dict(r=32, g=28, T=0, blur=0.5, step=0.75, arm=6, minarm=2, fc=0.8, tc=60, imin=0, gain=0),
    dict(r=16, g=14, T=16, blur=0.5, step=0.75, arm=7, minarm=2, fc=0.8, tc=45, imin=0, gain=8),
    dict(r=8, g=7, T=16, blur=0.5, step=0.75, arm=8, minarm=2, fc=0.75, tc=40, imin=0, gain=8),
    dict(r=4, g=4, T=13, blur=0.5, step=1.0, arm=8, minarm=1, fc=0.7, tc=36, imin=0, gain=8),
    dict(r=2, g=3, T=14, blur=0.5, step=1.25, arm=8, minarm=1, fc=0.7, tc=32, imin=1.2, gain=10),
    dict(r=1, g=2, T=16, blur=0.35, step=2.0, arm=6, minarm=1, fc=0.7, tc=30, imin=1.7, gain=10),
    # 눈·입·귀걸이 전용 가는 붓 (속눈썹, 눈꺼풀 선)
    dict(r=0.75, g=2, T=12, blur=0.3, step=3.0, arm=6, minarm=1, fc=0.7, tc=30, imin=3.0, gain=8),
]


# ── 결정적 해시 (런타임 JS와 똑같이 32비트 정수로 계산) ─────────────
def imul(a, b):
    return (a * b) & 0xFFFFFFFF


def hash32(x):
    """lowbias32. JS: x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; ..."""
    x &= 0xFFFFFFFF
    x ^= x >> 16
    x = imul(x, 0x7FEB352D)
    x ^= x >> 15
    x = imul(x, 0x846CA68B)
    x ^= x >> 16
    return x


def order_key(layer_index, cell):
    """층 안에서 칠하는 순서 = (이 값, 칸 번호) 오름차순."""
    return hash32((cell + imul(layer_index + 1, 0x9E3779B9) + SEED) & 0xFFFFFFFF)


def step_table(s16):
    """방향 번호 → (dx, dy) 1/16 px 정수. s16 = 걸음 길이×16 (정수, 데이터에 저장).
    JS도 Math.round(s16 * Math.cos(2 * Math.PI * a / 256))로 같은 표를 만든다."""
    tab = []
    for a in range(NA):
        th = 2.0 * math.pi * a / NA
        vx, vy = s16 * math.cos(th), s16 * math.sin(th)
        # 반올림 경계(.5)에 너무 가까우면 JS와 결과가 갈릴 수 있으니 확인한다
        for v in (vx, vy):
            assert abs(v - math.floor(v) - 0.5) > 1e-6, 'step table rounding ambiguity'
        # JS Math.round는 .5에서 +∞쪽으로 반올림 → floor(v + 0.5)
        tab.append((int(math.floor(vx + 0.5)), int(math.floor(vy + 0.5))))
    return tab


# ── 이미지 준비 ───────────────────────────────────────────
def load_ref():
    im = Image.open(REF).convert('RGB')
    assert im.size == (W, H)
    return np.asarray(im, dtype=np.float32)


def blur(img, sigma):
    if sigma <= 0.01:
        return img.copy()
    return cv2.GaussianBlur(img, (0, 0), sigma, borderType=cv2.BORDER_REFLECT)


def blur_wide(img, sigma):
    """큰 σ 가우시안: 줄여서 흐린 뒤 다시 키운다 (σ가 수십 px일 때 빠르게)."""
    if sigma <= 12:
        return blur(img, sigma)
    f = int(sigma // 6)
    h, w = img.shape[:2]
    small = cv2.resize(img, (w // f, h // f), interpolation=cv2.INTER_AREA)
    small = blur(small, sigma / f)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def luminance(img):
    return img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114


def orientation_field(ref, r):
    """구조 텐서로 결 방향(그라디언트에 수직)의 cos, sin을 구한다.
    텐서를 세 크기로 흐려 더한다: 결이 약한 평평한 곳은 넓은 범위의 윤곽 방향을 물려받아
    붓이 제자리에서 꼬불거리지 않는다."""
    lum = luminance(blur(ref, max(0.7, 0.35 * r)))
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    s = max(2.0, 1.0 * r)
    g3 = np.dstack([gx * gx, gx * gy, gy * gy])
    j = blur(g3, s) + 0.5 * blur_wide(g3, 4 * s) + 0.25 * blur_wide(g3, min(16 * s, 96))
    # 그라디언트 주방향 φ = ½·atan2(2Jxy, Jxx−Jyy). 결은 그에 수직.
    theta = 0.5 * np.arctan2(2 * j[..., 1], j[..., 0] - j[..., 2]) + np.pi / 2
    return np.cos(theta).astype(np.float32), np.sin(theta).astype(np.float32)


def ellipse_mask(cx, cy, rx, ry, angle=0.0, soft=0.25):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ca, sa = math.cos(angle), math.sin(angle)
    u = ((xx - cx) * ca + (yy - cy) * sa) / rx
    v = (-(xx - cx) * sa + (yy - cy) * ca) / ry
    d = np.sqrt(u * u + v * v)
    return np.clip((1 + soft - d) / soft, 0, 1)


def importance_map(ref):
    """중요도 1(배경)~5(눈·입). 가는 붓과 낮은 문턱값을 어디에 쓸지 정한다."""
    lum = luminance(ref)
    # 선화: 주변보다 어두운 가는 선 (블랙햇)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    lines = np.clip(cv2.morphologyEx(lum, cv2.MORPH_BLACKHAT, k) / 60.0, 0, 1)
    # 윤곽: 조금 흐린 그림의 그라디언트 크기
    lb = luminance(blur(ref, 1.5))
    gx = cv2.Sobel(lb, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(lb, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    edge = np.clip(np.sqrt(gx * gx + gy * gy) / 40.0, 0, 1)
    detail = blur(np.maximum(lines, edge), 1.0)

    face = ellipse_mask(905, 300, 175, 190, angle=-0.25, soft=0.3)
    body = ellipse_mask(640, 720, 330, 330, soft=0.6) * 0.5
    feat = np.zeros((H, W), np.float32)
    for cx, cy, rx, ry, a in [
        (845, 238, 62, 30, -0.1),  # 왼눈
        (985, 262, 58, 30, 0.15),  # 오른눈
        (893, 365, 82, 48, -0.05),  # 입
        (918, 292, 26, 26, 0.0),  # 코
        (742, 330, 30, 46, 0.0),  # 왼 귀걸이
        (1020, 405, 30, 42, 0.0),  # 오른 귀걸이
    ]:
        feat = np.maximum(feat, ellipse_mask(cx, cy, rx, ry, a, soft=0.5))
    imp = 1.0 + 1.2 * detail + 1.0 * face + 0.5 * body + 2.6 * feat + 0.8 * face * detail
    return np.clip(imp, 1.0, 5.0).astype(np.float32)


# ── 붓 자국 (Canvas 2D 둥근 끝 굵은 선 시뮬레이션) ───────────────
def stroke_coverage(xs, ys, r):
    """점열(px) 폴리라인을 굵기 2r로 그었을 때 픽셀별 덮임 비율. 반환: x0, y0, cov(h, w)."""
    x0 = max(0, int(math.floor(min(xs) - r - 1)))
    x1 = min(W, int(math.ceil(max(xs) + r + 2)))
    y0 = max(0, int(math.floor(min(ys) - r - 1)))
    y1 = min(H, int(math.ceil(max(ys) + r + 2)))
    if x1 <= x0 or y1 <= y0:
        return x0, y0, None
    px = (np.arange(x0, x1, dtype=np.float32) + 0.5)[None, :]
    py = (np.arange(y0, y1, dtype=np.float32) + 0.5)[:, None]
    if len(xs) == 1:
        d2 = (px - xs[0]) ** 2 + (py - ys[0]) ** 2
    else:
        ax = np.asarray(xs[:-1], np.float32)[:, None, None]
        ay = np.asarray(ys[:-1], np.float32)[:, None, None]
        dx = np.asarray(xs[1:], np.float32)[:, None, None] - ax
        dy = np.asarray(ys[1:], np.float32)[:, None, None] - ay
        ll = dx * dx + dy * dy
        ll = np.where(ll < 1e-9, 1.0, ll)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / ll, 0.0, 1.0)
        qx = ax + t * dx - px
        qy = ay + t * dy - py
        d2 = (qx * qx + qy * qy).min(axis=0)
    cov = np.clip(r + 0.5 - np.sqrt(d2), 0.0, 1.0)
    return x0, y0, cov


def put_varint(buf, v):
    assert v >= 0
    while v >= 0x80:
        buf.append((v & 0x7F) | 0x80)
        v >>= 7
    buf.append(v)


# ── 그리기 ────────────────────────────────────────────────
class Painter:
    def __init__(self, ref, imp, bg, verbose=True):
        self.ref = ref
        self.imp = imp
        self.canvas = np.empty_like(ref)
        self.canvas[:] = bg
        self.verbose = verbose
        self.layers_out = []

    def candidates(self, li, L, target):
        """층 시작 시점의 오차로 붓질 씨앗 칸을 고른다. 반환: [(순서 키, 칸, ox, oy)] (칠할 순서)."""
        g, imp = L['g'], self.imp
        diff = np.sqrt(((self.canvas - target) ** 2).sum(-1))
        ncx, ncy = (W + g - 1) // g, (H + g - 1) // g

        def cells(a):
            pad = np.zeros((ncy * g, ncx * g), np.float32)
            pad[:H, :W] = a
            return pad.reshape(ncy, g, ncx, g).transpose(0, 2, 1, 3).reshape(ncy, ncx, g * g)

        err = cells(diff * imp)
        cell_err = err.sum(-1) / np.maximum(cells(np.ones((H, W), np.float32)).sum(-1), 1)
        cell_imp = cells(imp).max(-1)
        arg = err.argmax(-1)
        ok = cell_imp >= L['imin']
        if L['T'] > 0:
            ok &= cell_err > L['T']
        cand = []
        for cy, cx in zip(*np.nonzero(ok)):
            a = int(arg[cy, cx])
            ox, oy = a % g, a // g
            if cx * g + ox >= W or cy * g + oy >= H:
                continue
            cell = int(cy * ncx + cx)
            cand.append((order_key(li, cell), cell, ox, oy))
        cand.sort()
        return cand, ncx

    def grow(self, L, sx, sy, cos_t, sin_t, target, tab, tabf):
        """씨앗에서 양쪽으로 붓질을 키운다. 반환: (앞팔 방향들, 뒷팔 방향들)."""
        canvas = self.canvas
        c0 = target[sy, sx]
        c0r, c0g, c0b = float(c0[0]), float(c0[1]), float(c0[2])
        fx0, fy0 = sx * 16 + 8, sy * 16 + 8
        # 씨앗의 결 방향. 앞팔은 이 방향, 뒷팔은 반대 방향으로 자란다.
        d0x, d0y = float(cos_t[sy, sx]), float(sin_t[sy, sx])
        fc, tc, minarm = L['fc'], L['tc'], L['minarm']
        arms = []
        for sign in (1.0, -1.0):
            angs = []
            fx, fy = fx0, fy0
            ldx, ldy = sign * d0x, sign * d0y
            for i in range(L['arm']):
                if i == 0:
                    dx, dy = ldx, ldy
                else:
                    ix, iy = fx >> 4, fy >> 4
                    dx, dy = float(cos_t[iy, ix]), float(sin_t[iy, ix])
                    if dx * ldx + dy * ldy < 0:
                        dx, dy = -dx, -dy
                    dx, dy = fc * dx + (1 - fc) * ldx, fc * dy + (1 - fc) * ldy
                n = math.hypot(dx, dy)
                if n < 1e-6:
                    break
                a = int(round(math.atan2(dy, dx) / (2 * math.pi) * NA)) % NA
                nfx, nfy = fx + tab[a][0], fy + tab[a][1]
                if nfx < 0 or nfy < 0 or nfx >= W * 16 or nfy >= H * 16:
                    break
                nix, niy = nfx >> 4, nfy >> 4
                t = target[niy, nix]
                tr, tg, tb = float(t[0]), float(t[1]), float(t[2])
                dcol = math.sqrt((tr - c0r) ** 2 + (tg - c0g) ** 2 + (tb - c0b) ** 2)
                if dcol > tc:
                    break
                if i >= minarm:
                    cv = canvas[niy, nix]
                    dcan = math.sqrt((tr - cv[0]) ** 2 + (tg - cv[1]) ** 2 + (tb - cv[2]) ** 2)
                    if dcan < dcol:
                        break
                angs.append(a)
                fx, fy = nfx, nfy
                ldx, ldy = tabf[a]
            arms.append(angs)
        return arms[0], arms[1]

    def paint_layer(self, li, L):
        r = L['r']
        t0 = time.time()
        target = blur(self.ref, L['blur'] * r)
        cos_t, sin_t = orientation_field(self.ref, r)
        imp, canvas = self.imp, self.canvas
        step16 = int(round(L['step'] * r * 16))
        tab = step_table(step16)
        tabf = [(dx / math.hypot(dx, dy), dy / math.hypot(dx, dy)) for dx, dy in tab]
        cand, ncx = self.candidates(li, L, target)
        g = L['g']

        accepted = []
        n_rej = 0
        for _, cell, ox, oy in cand:
            sx, sy = (cell % ncx) * g + ox, (cell // ncx) * g + oy
            # 앞서 칠한 이웃 붓이 이미 덮었으면 건너뛴다
            if L['T'] > 0:
                dcur = math.sqrt(float(((canvas[sy, sx] - target[sy, sx]) ** 2).sum()))
                if dcur * imp[sy, sx] <= L['T'] * 0.5:
                    continue
            fwd, back = self.grow(L, sx, sy, cos_t, sin_t, target, tab, tabf)
            # 점 좌표 복원 (런타임과 같은 정수 누적): 뒷팔(역순) + 씨앗 + 앞팔
            fx0, fy0 = sx * 16 + 8, sy * 16 + 8
            bpts = []
            fx, fy = fx0, fy0
            for a in back:
                fx, fy = fx + tab[a][0], fy + tab[a][1]
                bpts.append((fx, fy))
            pts = bpts[::-1] + [(fx0, fy0)]
            fx, fy = fx0, fy0
            for a in fwd:
                fx, fy = fx + tab[a][0], fy + tab[a][1]
                pts.append((fx, fy))
            x0, y0, cov = stroke_coverage([p[0] / 16.0 for p in pts], [p[1] / 16.0 for p in pts], r)
            if cov is None:
                continue
            hh, ww = cov.shape
            tsub = target[y0:y0 + hh, x0:x0 + ww]
            csub = canvas[y0:y0 + hh, x0:x0 + ww]
            iw = imp[y0:y0 + hh, x0:x0 + ww]
            wsub = iw * cov
            # 붓 색: 덮임 비율까지 고려한 최소제곱 해
            #   new = old + c(u − old) 이므로 u = Σ w·c·(t − (1−c)·old) / Σ w·c²
            c3 = cov[..., None]
            den = float((wsub * cov).sum())
            if den < 1e-3:
                continue
            best = ((tsub - (1 - c3) * csub) * wsub[..., None]).sum((0, 1)) / den
            # 가장자리 보정 때문에 목표에 없는 색으로 튀지 않게 덮인 곳 목표색 범위로 자른다
            inside = tsub[cov > 0.5] if (cov > 0.5).any() else tsub.reshape(-1, 3)
            best = np.clip(best, inside.min(0), inside.max(0))
            q = np.clip(np.round(best * (CQ - 1) / 255.0), 0, CQ - 1).astype(np.int32)
            col = LEVELS[q]
            new = csub * (1 - c3) + col * c3
            e_old = (((csub - tsub) ** 2).sum(-1) * iw).sum()
            e_new = (((new - tsub) ** 2).sum(-1) * iw).sum()
            if L['gain'] > 0 and (e_old - e_new) < (L['gain'] ** 2) * float(cov.sum()):
                n_rej += 1
                continue
            csub[...] = new
            accepted.append((cell, ox, oy, tuple(int(v) for v in q), back, fwd))
        accepted.sort(key=lambda s: s[0])
        self.layers_out.append(dict(L=L, strokes=accepted, step16=step16))
        if self.verbose:
            npts = sum(len(s[4]) + len(s[5]) for s in accepted)
            print(
                f'  layer {li} r={r}: candidates {len(cand)} accepted {len(accepted)} rejected {n_rej} '
                f'steps {npts} ({time.time() - t0:.1f}s)',
                file=sys.stderr,
            )


# ── 직렬화 ────────────────────────────────────────────────
STREAMS = ['cell', 'off', 'r', 'g', 'b', 'len', 'ang']


def encode(painter, bg):
    st = {n: bytearray() for n in STREAMS}
    head = bytearray(b'STK2')
    head += bytes([len(painter.layers_out)])
    head += bytes(int(v) for v in bg)
    for lo in painter.layers_out:
        L, strokes = lo['L'], lo['strokes']
        head += int(round(L['r'] * 4)).to_bytes(2, 'little')
        head += lo['step16'].to_bytes(2, 'little')
        head += int(L['g']).to_bytes(1, 'little')
        head += len(strokes).to_bytes(4, 'little')
        prev = -1
        pc = (0, 0, 0)
        for cell, ox, oy, q, back, fwd in strokes:
            put_varint(st['cell'], cell - prev - 1)
            prev = cell
            put_varint(st['off'], oy * L['g'] + ox)
            for k, n in enumerate('rgb'):
                st[n].append((q[k] - pc[k]) % CQ)
            pc = q
            assert len(back) <= 15 and len(fwd) <= 15
            st['len'].append((len(back) << 4) | len(fwd))
            for arm in (fwd, back):
                last = None
                for a in arm:
                    st['ang'].append(a if last is None else (a - last) % NA)
                    last = a
    for n in STREAMS:
        head += len(st[n]).to_bytes(4, 'little')
    raw = bytes(head) + b''.join(bytes(st[n]) for n in STREAMS)
    comp = zlib.compress(raw, 9)
    sizes = {n: (len(st[n]), len(zlib.compress(bytes(st[n]), 9))) for n in STREAMS}
    return raw, comp, sizes


def write_js(comp, path):
    b64 = base64.b64encode(comp).decode('ascii')
    lines = [b64[i:i + 100] for i in range(0, len(b64), 100)]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w') as f:
        f.write('// tools/gen_strokes.py가 만든다. 직접 고치지 않는다.\n')
        f.write('// 붓질 목록 (zlib 압축 바이너리의 base64). 형식은 생성기 머리말 참고.\n')
        f.write('window.ConcertData = window.ConcertData || {};\n')
        f.write('window.ConcertData.strokes =\n')
        f.write(' +\n'.join("  '" + ln + "'" for ln in lines))
        f.write(';\n')
    return os.path.getsize(path)


# ── 평가 (compare.py와 같은 정의의 대표 수치) ─────────────────
def quick_metrics(ref, img):
    from skimage.color import rgb2lab
    from skimage.metrics import structural_similarity

    a = Image.fromarray(ref.astype(np.uint8))
    b = Image.fromarray(np.clip(np.round(img), 0, 255).astype(np.uint8))
    rs, bs = a.resize((W // 4, H // 4), Image.LANCZOS), b.resize((W // 4, H // 4), Image.LANCZOS)
    ss = structural_similarity(np.asarray(rs), np.asarray(bs), channel_axis=2, data_range=255)
    ta, tb = a.resize((W // 8, H // 8), Image.LANCZOS), b.resize((W // 8, H // 8), Image.LANCZOS)
    la = rgb2lab(np.asarray(ta, np.float64) / 255)
    lb = rgb2lab(np.asarray(tb, np.float64) / 255)
    return ss, float(np.sqrt(((la - lb) ** 2).sum(-1)).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--preview', help='시뮬레이션 캔버스를 PNG로 저장하고 층마다 점수를 찍는다')
    ap.add_argument('--layers', type=int, default=len(LAYERS), help='앞에서부터 이 개수의 층만 (실험용)')
    ap.add_argument('--set', default='', help='층 설정 덮어쓰기 (실험용), 예: 4.T=14,5.imin=2')
    args = ap.parse_args()
    for item in filter(None, args.set.split(',')):
        k, v = item.split('=')
        li, name = k.split('.')
        LAYERS[int(li)][name] = float(v) if '.' in v else int(v)
    cv2.setNumThreads(2)
    t0 = time.time()

    ref = load_ref()
    imp = importance_map(ref)
    # 바탕색: 원본 평균색
    bg = np.round(ref.reshape(-1, 3).mean(0)).astype(np.uint8)

    painter = Painter(ref, imp, bg)
    for li, L in enumerate(LAYERS[: args.layers]):
        painter.paint_layer(li, L)
        if args.preview:
            ss, de = quick_metrics(ref, painter.canvas)
            print(f'    -> ssim_small {ss:.4f} dE {de:.2f}', file=sys.stderr)

    raw, comp, sizes = encode(painter, bg)
    n = sum(len(lo['strokes']) for lo in painter.layers_out)
    size = write_js(comp, args.out)
    if args.preview:
        Image.fromarray(np.clip(np.round(painter.canvas), 0, 255).astype(np.uint8)).save(args.preview)
    print(f'wrote {args.out}: {n} strokes, raw {len(raw)} B, zlib {len(comp)} B, file {size} B')
    print('streams (raw, zlib):', sizes)
    print(f'total {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
