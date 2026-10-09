#!/usr/bin/env python3
"""hair 레이어용 기하 측정: 원본에서 머리카락의 '모양과 결'만 재서 js/procedural/data/hair.js로 쓴다.

    python3 concert/tools/proc_hair.py [--debug DIR]

내보내는 것 (색 화소는 하나도 내보내지 않는다)
    sil       머리 실루엣의 바깥 고리 (분석 마스크에서 가장자리의 푸른 배경을 빼고 6px 틈은 닫은 것,
              바깥 실루엣에 18px 안으로 다가온 구멍은 바깥으로 터 준 것)
    holes     실루엣 안의 구멍 고리 (300px² 미만은 메움, Chaikin으로 다듬음)
    back      뒤 머리 실루엣: sil + 몸·얼굴 밑으로 조금 이어 그린 부분 (evenodd 고리, 몸이 덮지 않는 배경 틈은 뺌)
    front     몸·얼굴보다 앞에 다시 덮는 머리 (보이는 머리 전부에서 피부 위의 가는 조각과 원본에서 잰 피부 틈을 뺀 것)
    veil      피부가 가닥 사이로 비치는 구역 (아래 팔뚝, 허리 피부)
    litPlane  빛 받는 다발(셀 하이라이트 면)의 윤곽 고리, litHi = 그 안의 가장 밝은 결의 윤곽 고리
    litCore/litCoreW  빛 면 안의 긴 심 곡선(뼈대의 가장 긴 경로)과 점마다 반폭×2
    lit/litW  빛 면이 되기엔 가는 빛 결의 중심선과 반폭×2 (덩어리마다 하나, 곁가지 없이)
    sheenPlane, sheen/sheenW  그늘 안의 조금 밝은 결 (같은 형식)
    midPlane  중간톤 다발 몸통(셀 그늘의 밝은 쪽 면)의 윤곽 고리
    coolPlane 그늘 결에 무대의 파랑·보랏빛이 비친 곳의 윤곽 고리
    outer     바깥 배경 (머리카락 사이 작은 구멍은 뺀 것) — 역광 띠의 기준
    locks     굵은 다발 흐름선 (뿌리 → 끝)
    strands   가는 가닥 흐름선 (뿌리 → 끝)
    open      가닥마다 끝이 바깥 배경에 닿는지 (1 = 끝, 2 = 뿌리, 3 = 둘 다)
    fly       실루엣 밖 배경을 가로지르는 잔머리 곡선 (꺾인 곳에서 잘라 매끈하게)
    cross     목·가슴 피부 위를 가로지르는 가는 머리카락 곡선, crossW = 곡선마다 반폭(px)
    ink       머리 안의 먹선 곡선 (다발 사이 어두운 가는 선), inkW = 곡선마다 반폭(px)
    glint     머리 안의 밝은 가는 결 곡선 (빛을 받아 도드라진 올, 먹선의 짝), glintW = 곡선마다 반폭(px)
    gap       다발 사이 틈을 건너는 가는 가닥 흐름선
    flow      결 방향장 (4px 칸마다 두 배 각 한 바이트, base64): 그리는 쪽에서 구멍 그물·잔머리 다발의 방향에 쓴다

방법
    1. 결 방향: 휘도의 Sobel 기울기로 구조 텐서를 만들고 머리 마스크 안에서 평활(σ 6), 일관도²로 가중해
       한 번 더 평활(σ 8). 결 = 기울기에 수직.
    2. 흐름선: Jobard–Lefer 균등 간격 흐름선. RK2로 양방향 추적, 이미 그은 선과 d_test보다 가까워지거나
       손으로 잰 가르마 선을 건너면 멈춤. 가르마 양옆에서 먼저 씨앗을 뿌린다.
    3. 뿌리 쪽: 한쪽 끝만 가르마 가까이 있으면 그 끝, 아니면 정수리(890, 200)에서 가까운 끝이 뿌리.
    4. 잔머리: 머리 둘레 띠 안의 배경에서 가는 능선(채널별 헤시안)을 골라 뼈대를 따라간다.
       목·가슴 위 가닥도 같은 방법(어두운 능선)에 앞 영역의 가는 조각 뼈대를 더한다.
    5. 셀 면: L*을 결 방향으로만 흐린 뒤(앞뒤 14px와 5px) 문턱으로 '빛 받는 다발'·'가장 밝은 결'·'윤기 결'·
       '중간톤 몸통' 덩어리를, 색상각으로 '차가운 반사' 덩어리를 고른다. 덩어리 모양은 결 따라 길게·결을
       가로질러 짧게 흐린 뒤 반으로 잘라 다듬는다(물결진 가장자리와 부스러기를 없앤다). 넓은 덩어리는 윤곽
       고리로, 가는 것은 뼈대의 가장 긴 경로(+ 거리 변환 반폭)로 낸다. 밝기·색 값은 내보내지 않는다 — 모양만.
    6. 실루엣: 작은(400px² 미만)·가는 푸른 구멍은 머리로 되돌리고, 6px 틈을 닫고, 300px² 미만 구멍을 메우고,
       정수리 윤곽을 σ2로 다듬고, 고리 잔머리 자리는 뺀다. 고리는 Chaikin으로 계단을 편다.
    7. 선: 먹선(어두운 능선)과 밝은 가는 결(밝은 능선)을 헤시안으로 찾아 뼈대를 이은 곡선과 반폭으로 낸다.
    8. 결 방향장: 4px 칸마다 두 배 각 한 바이트 (그리는 쪽이 구멍 그물·잔머리 다발의 방향을 정한다).
같은 입력이면 언제나 같은 결과가 나온다(난수 시드 고정).
"""
import argparse
import base64
import json
import math
import os
from collections import defaultdict, deque

import cv2
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.feature import hessian_matrix, hessian_matrix_eigvals
from skimage.morphology import skeletonize

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
MASKS = os.path.join(HERE, 'analysis')
OUT_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'hair.js')

SCALP = (890.0, 200.0)  # 뿌리 쪽을 정할 기준점 (정수리 가운데)
# 가르마 (손으로 잰 꺾은선): 흐름선은 이 선을 넘지 않고, 이 선에서 가까운 끝이 뿌리다
PART = [(935.0, 55.0), (940.0, 90.0), (945.0, 120.0)]
# 정수리 위 고리 모양 잔머리 자리: 실루엣에서 빼고(속이 빈 고리를 덩어리로 칠하지 않게) 그리는 쪽에서 가는 선으로
LOOP_CUT = [(910, 0), (1004, 0), (1004, 44), (960, 48), (910, 40)]
MID_T = 18  # 중간톤 다발 몸통의 문턱 (결 방향으로 짧게 흐린 L*)
LIT_HI = 60  # 빛 면 안에서 본색(가장 밝은 결)으로 칠할 문턱 (결 방향으로 짧게 흐린 L*)
# 셀 면 모양 다듬기 (flow_shape): 결 따라 앞뒤 px, 결을 가로질러 앞뒤 px
SHAPE = (6, 1)
GLINT_T = 0.02  # 밝은 가는 결의 능선 문턱 (헤시안 고유값)
ANALYSIS_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'analysis.js')
# 머리가 피부 위로 그물처럼 걸친 곳 (손으로 잰 아래 가운데 팔뚝): 덩어리로 칠하지 않고 가는 가닥으로만 그린다
FOREARM = [(588, 1254), (640, 1130), (700, 1018), (745, 972), (905, 955), (905, 995), (840, 1052),
           (780, 1108), (720, 1180), (668, 1254)]


def load_mask(name):
    return cv2.imread(os.path.join(MASKS, 'mask_%s.png' % name), cv2.IMREAD_GRAYSCALE) > 127


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


# ── 1. 결 방향 ────────────────────────────────────────────
def orientation(gray, mask, s_t=6.0, s_v=8.0):
    """구조 텐서(σ s_t)로 결을 재고, 일관도²로 가중한 두 배 각 벡터를 σ s_v로 한 번 더 평활한다."""
    g = cv2.GaussianBlur(gray, (0, 0), 1.0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    m = cv2.dilate(mask.astype(np.uint8), disk(3)).astype(np.float32)
    den = cv2.GaussianBlur(m, (0, 0), s_t) + 1e-6
    T = [cv2.GaussianBlur(j * m, (0, 0), s_t) / den for j in (gx * gx, gx * gy, gy * gy)]
    a = T[0] - T[2]
    b = 2 * T[1]
    mag = np.sqrt(a * a + b * b)
    coh = mag / (T[0] + T[2] + 1e-6)
    # 기울기의 두 배 각 → 결은 수직이므로 부호를 뒤집는다
    c = -a / (mag + 1e-9)
    s = -b / (mag + 1e-9)
    w = coh * coh * m
    d2 = cv2.GaussianBlur(w, (0, 0), s_v) + 1e-6
    c = cv2.GaussianBlur(c * w, (0, 0), s_v) / d2
    s = cv2.GaussianBlur(s * w, (0, 0), s_v) / d2
    n = np.sqrt(c * c + s * s) + 1e-9
    return (c / n).astype(np.float32), (s / n).astype(np.float32)


class Field:
    def __init__(self, c2, s2, mask):
        self.c2, self.s2, self.mask = c2, s2, mask
        self.h, self.w = mask.shape

    def inside(self, x, y):
        xi, yi = int(x + 0.5), int(y + 0.5)
        return 0 <= xi < self.w and 0 <= yi < self.h and self.mask[yi, xi]

    def dir(self, x, y, px, py):
        """(x, y)의 결 단위벡터. 앞 방향 (px, py)과 같은 쪽으로 맞춘다."""
        x = min(max(x, 0), self.w - 1.001)
        y = min(max(y, 0), self.h - 1.001)
        x0, y0 = int(x), int(y)
        fx, fy = x - x0, y - y0
        c = (self.c2[y0, x0] * (1 - fx) * (1 - fy) + self.c2[y0, x0 + 1] * fx * (1 - fy)
             + self.c2[y0 + 1, x0] * (1 - fx) * fy + self.c2[y0 + 1, x0 + 1] * fx * fy)
        s = (self.s2[y0, x0] * (1 - fx) * (1 - fy) + self.s2[y0, x0 + 1] * fx * (1 - fy)
             + self.s2[y0 + 1, x0] * (1 - fx) * fy + self.s2[y0 + 1, x0 + 1] * fx * fy)
        a = 0.5 * math.atan2(s, c)
        dx, dy = math.cos(a), math.sin(a)
        if dx * px + dy * py < 0:
            dx, dy = -dx, -dy
        return dx, dy


def flow_grid(c2, s2, hair, cell=4):
    """결 방향장을 cell px 칸마다 한 바이트(두 배 각 0..255)로: 그리는 쪽이 구멍 그물·잔머리 다발의 방향을 정한다.
    머리 밖은 가장 가까운 머리 화소의 결을 이어 쓴다 (실루엣 너머로 뻗는 가닥 끝도 결을 따르게)."""
    valid = cv2.dilate(hair.astype(np.uint8), disk(3)).astype(bool)
    _, (iy, ix) = ndi.distance_transform_edt(~valid, return_indices=True)
    c, s = c2[iy, ix], s2[iy, ix]
    h, w = hair.shape
    ys = np.arange(cell // 2, h, cell)
    xs = np.arange(cell // 2, w, cell)
    a = np.arctan2(s[np.ix_(ys, xs)], c[np.ix_(ys, xs)])
    b = (np.round((a + np.pi) / (2 * np.pi) * 256) % 256).astype(np.uint8)
    return {'cell': cell, 'w': len(xs), 'h': len(ys), 'data': base64.b64encode(b.tobytes()).decode('ascii')}


# ── 2. 균등 간격 흐름선 (Jobard–Lefer) ──────────────────────
class Grid:
    def __init__(self, cell):
        self.cell = cell
        self.cells = defaultdict(list)

    def add(self, x, y, lid):
        self.cells[(int(x // self.cell), int(y // self.cell))].append((x, y, lid))

    def free(self, x, y, d, skip=-1):
        cx, cy = int(x // self.cell), int(y // self.cell)
        r = int(math.ceil(d / self.cell))
        d2 = d * d
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for (qx, qy, lid) in self.cells.get((i, j), ()):
                    if lid != skip and (qx - x) ** 2 + (qy - y) ** 2 < d2:
                        return False
        return True


def trace(field, grid, x, y, d_test, step=1.0, max_len=900, max_turn=0.5):
    """씨앗에서 양쪽으로 RK2 추적. 점 목록(한쪽 끝 → 다른 끝)을 돌려준다."""
    halves = []
    d0 = field.dir(x, y, 1.0, 0.0)
    for sign in (1, -1):
        px, py = d0[0] * sign, d0[1] * sign
        cx, cy = x, y
        pts = []
        n = 0
        own = []  # 자기 선과의 교차를 막기 위한 최근 점
        while n * step < max_len:
            k1 = field.dir(cx, cy, px, py)
            mx, my = cx + k1[0] * step * 0.5, cy + k1[1] * step * 0.5
            k2 = field.dir(mx, my, k1[0], k1[1])
            nx, ny = cx + k2[0] * step, cy + k2[1] * step
            if k2[0] * px + k2[1] * py < math.cos(max_turn):
                break
            if not field.inside(nx, ny) or not grid.free(nx, ny, d_test) or crosses_part(cx, cy, nx, ny):
                break
            # 자기 자신에게 되돌아오는 고리 방지
            loop = False
            for (ox, oy) in own[:-int(4 * d_test / step) - 2]:
                if (ox - nx) ** 2 + (oy - ny) ** 2 < d_test * d_test:
                    loop = True
                    break
            if loop:
                break
            cx, cy, px, py = nx, ny, k2[0], k2[1]
            pts.append((cx, cy))
            if n % 3 == 0:
                own.append((cx, cy))
            n += 1
        halves.append(pts)
    return halves[1][::-1] + [(x, y)] + halves[0]


def _ccw(a, b, c):
    return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])


def crosses_part(x0, y0, x1, y1):
    """(x0, y0)→(x1, y1) 한 걸음이 가르마 선을 건너는지."""
    if y1 > PART[-1][1] + 2 and y0 > PART[-1][1] + 2:
        return False
    a, b = (x0, y0), (x1, y1)
    for c, d in zip(PART[:-1], PART[1:]):
        if _ccw(a, c, d) != _ccw(b, c, d) and _ccw(a, b, c) != _ccw(a, b, d):
            return True
    return False


def part_dist(p):
    """점에서 가르마 꺾은선까지의 거리."""
    best = 1e9
    for (ax, ay), (bx, by) in zip(PART[:-1], PART[1:]):
        vx, vy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy)))
        best = min(best, math.hypot(p[0] - ax - vx * t, p[1] - ay - vy * t))
    return best


def streamlines(field, mask, d_sep, d_test, min_len, seed, max_len=900):
    rng = np.random.default_rng(seed)
    grid = Grid(d_sep)
    lines = []
    # 첫 씨앗 후보: 마스크 안의 격자점을 섞어서
    ys, xs = np.nonzero(mask[::int(d_sep * 2), ::int(d_sep * 2)])
    cand = list(zip(xs * int(d_sep * 2) + 0.5, ys * int(d_sep * 2) + 0.5))
    order = rng.permutation(len(cand))
    cand = [cand[i] for i in order]
    # 가르마 양옆에서 먼저 씨앗을 뿌린다 (가닥이 가르마에서 시작해 양쪽으로 흘러내리게)
    side = []
    for (ax, ay), (bx, by) in zip(PART[:-1], PART[1:]):
        for t in np.arange(0, 1, d_sep / math.hypot(bx - ax, by - ay)):
            for off in (-d_sep * 0.6, d_sep * 0.6):
                side.append((ax + (bx - ax) * t + off, ay + (by - ay) * t))
    cand = side + cand
    queue = []
    ci = 0
    while True:
        if queue:
            sx, sy = queue.pop()
        elif ci < len(cand):
            sx, sy = cand[ci]
            ci += 1
        else:
            break
        if not field.inside(sx, sy) or not grid.free(sx, sy, d_sep):
            continue
        pts = trace(field, grid, sx, sy, d_test, max_len=max_len)
        if len(pts) < min_len:
            continue
        lid = len(lines)
        for (px, py) in pts:
            grid.add(px, py, lid)
        lines.append(pts)
        # 이웃 씨앗: 선의 양옆 d_sep 거리
        for i in range(0, len(pts), max(2, int(d_sep))):
            if i + 1 < len(pts):
                tx, ty = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
            else:
                tx, ty = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
            ln = math.hypot(tx, ty) + 1e-9
            nx, ny = -ty / ln, tx / ln
            for sgn in (1, -1):
                queue.append((pts[i][0] + nx * d_sep * sgn, pts[i][1] + ny * d_sep * sgn))
    return lines


def orient_root(pts):
    """뿌리 쪽 끝을 앞으로: 한쪽 끝만 가르마 가까이(25px) 있으면 그 끝, 아니면 정수리에서 가까운 끝."""
    a, b = pts[0], pts[-1]
    pa, pb = part_dist(a) < 25, part_dist(b) < 25
    if pa != pb:
        return pts if pa else pts[::-1]
    da = math.hypot(a[0] - SCALP[0], a[1] - SCALP[1])
    db = math.hypot(b[0] - SCALP[0], b[1] - SCALP[1])
    return pts if da <= db else pts[::-1]


def smooth_path(pts, k=7):
    """뼈대의 계단 무늬를 이동 평균으로 편다 (끝점은 그대로)."""
    p = np.array(pts, np.float64)
    if len(p) < k + 2:
        return [tuple(v) for v in p]
    ker = np.ones(k) / k
    pad = k // 2
    out = p.copy()
    for c in range(2):
        q = np.concatenate([np.full(pad, p[0, c]), p[:, c], np.full(pad, p[-1, c])])
        out[:, c] = np.convolve(q, ker, mode='valid')
    out[0], out[-1] = p[0], p[-1]
    return [tuple(v) for v in out]


def resample(pts, step):
    """호 길이 step 간격으로 다시 찍는다 (끝점 포함)."""
    p = np.array(pts, dtype=np.float64)
    seg = np.sqrt(((p[1:] - p[:-1]) ** 2).sum(1))
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    n = max(2, int(round(total / step)) + 1)
    t = np.linspace(0, total, n)
    x = np.interp(t, s, p[:, 0])
    y = np.interp(t, s, p[:, 1])
    return [int(round(v)) for xy in zip(x, y) for v in xy]


# ── 영역 ──────────────────────────────────────────────────
def chaikin(pts, it=2):
    """닫힌 다각형의 모서리를 깎아 계단을 없앤다 (Chaikin)."""
    p = np.asarray(pts, np.float64)
    for _ in range(it):
        q = np.roll(p, -1, axis=0)
        p = np.stack([0.75 * p + 0.25 * q, 0.25 * p + 0.75 * q], 1).reshape(-1, 2)
    return p


def rings(mask, eps=1.0, min_area=25, smooth=0, part='all'):
    """마스크 → 닫힌 고리들 (evenodd). part = 'all' | 'outer'(바깥 고리만) | 'holes'(구멍 고리만).
    smooth > 0 이면 Chaikin을 그만큼 되풀이해 계단 무늬를 편다."""
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for i, c in enumerate(cs):
        is_hole = hier is not None and hier[0][i][3] >= 0
        if (part == 'outer' and is_hole) or (part == 'holes' and not is_hole):
            continue
        if abs(cv2.contourArea(c)) < min_area:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(ap) < 3:
            continue
        if smooth:
            ap = chaikin(ap, smooth)
            ap = cv2.approxPolyDP(np.round(ap * 2).astype(np.int32).reshape(-1, 1, 2), 0.8, True)
            ap = (ap.reshape(-1, 2) / 2.0).round().astype(int)
        out.append([int(v) for v in ap.ravel()])
    return out


def see_through(shape):
    """피부가 머리카락 사이로 비치는 구역: 손으로 잰 팔뚝 + 공용 분석의 허리 피부(3px 깎은 것).
    허리 피부 조각들의 볼록 껍질을 쓰면 그 옆을 덮은 불투명한 다발까지 삼키므로 피부 모양 그대로 쓴다."""
    src = open(ANALYSIS_JS).read()
    parts = json.loads(src[src.index('.data = ') + 8:src.rindex('}') + 1])['parts']
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(FOREARM, np.int32)], 1)
    w = np.zeros(shape, np.uint8)
    cv2.fillPoly(w, [np.array(r, np.int32).reshape(-1, 2) for r in parts['waist']], 1)
    m |= cv2.erode(w, disk(3))
    return m.astype(bool)


def skin_gaps(img, zone):
    """비침 구역(팔뚝·허리) 안에서 다발 사이로 피부가 보이는 틈: 밝은(L* > 40) 덩어리의 모양만.
    이 틈을 뺀 나머지는 보통 머리처럼 불투명하게 칠한다 (다발·결·먹선이 그대로 이어진다)."""
    from skimage.color import rgb2lab
    L = rgb2lab(img[:, :, ::-1].astype(np.float64) / 255.0)[..., 0]
    g = zone & (L > 48)
    g = cv2.morphologyEx(g.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    n, lab, st, _ = cv2.connectedComponentsWithStats(g.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 15
    return keep[lab]


def regions(hair, skin, face, dress):
    body = (skin | dress | face).astype(np.uint8)
    # 몸 덩어리: 크게 닫고 구멍을 메운 것 — 이 안의 가는 머리 조각은 피부 위를 지나는 가닥이다
    hull = cv2.morphologyEx(body, cv2.MORPH_CLOSE, disk(22))
    hull = ndi.binary_fill_holes(hull).astype(bool)
    # 앞 영역 = 보이는 머리 전부 (몸·얼굴이 넉넉하게 그린 모양 위로 다시 덮는다).
    # 단, 몸 위에 걸친 가는 조각(폭 18px 미만)은 채우지 않고 가는 가닥 선으로 그린다.
    core = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_OPEN, disk(9)).astype(bool)
    core = cv2.dilate(core.astype(np.uint8), disk(2)).astype(bool) & hair
    thin = hair & ~core & hull & cv2.dilate(skin.astype(np.uint8), disk(3)).astype(bool)
    thin = cv2.morphologyEx(thin.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    front = hair & ~thin
    # 뒤 실루엣: 머리 + 몸·얼굴 밑으로 18px 이어 그림 (이음새에 배경이 비치지 않게)
    ext = cv2.dilate(hair.astype(np.uint8), disk(18)).astype(bool) & body.astype(bool)
    back = hair | ext
    back = cv2.morphologyEx(back.astype(np.uint8), cv2.MORPH_CLOSE, disk(1)).astype(bool)
    return back, front, thin


def gap_strands(gray, hair, face, dress):
    """머리 다발 사이 틈(배경·피부가 비치는 구멍)을 건너는 가는 가닥: 머리를 크게 닫은 덮개 안에서
    결을 다시 재고, 틈에서만 씨앗을 뿌려 흐름선을 긋는다."""
    envl = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_CLOSE, disk(18)).astype(bool)
    envl = ndi.binary_fill_holes(envl)
    gap = envl & ~hair & ~face & ~dress
    gap = cv2.morphologyEx(gap.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    c2, s2 = orientation(gray, envl)
    tm = cv2.dilate(gap.astype(np.uint8), disk(3)).astype(bool)
    lines = streamlines(Field(c2, s2, tm), tm, d_sep=3.0, d_test=1.5, min_len=10, seed=3, max_len=300)
    return lines


def ink_lines(img, hair):
    """머리 안의 먹선(다발 사이 어두운 가는 선): 어두운 능선(헤시안) 뼈대를 이어 붙인 곡선."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    H = hessian_matrix(gray, sigma=1.2, order='rc', use_gaussian_derivatives=False)
    l1, _ = hessian_matrix_eigvals(H)
    m = np.where(hair, np.maximum(l1, 0), 0) > 0.014
    paths = link_paths(trace_skeleton(skeletonize(m), min_len=6), gap=8, max_turn=0.5)
    paths = [p for p in paths if path_len(p) >= 12]
    # 반폭: 어두운 선 자체의 폭 (주변보다 확실히 어두운 화소 띠의 거리 변환)
    local = cv2.GaussianBlur(gray, (0, 0), 4.0)
    dark = (gray < local - 0.04) & hair
    dt = cv2.distanceTransform(dark.astype(np.uint8), cv2.DIST_L2, 3)
    widths = []
    for p in paths:
        d = np.array([dt[y, x] for x, y in p])
        widths.append(float(np.clip(np.percentile(d, 60), 0.5, 4.0)))
    return paths, widths


def glint_lines(img, hair, thr=GLINT_T):
    """머리 안의 밝은 가는 결(빛을 받아 도드라진 머리카락 올): 밝은 능선(헤시안의 큰 음의 고유값) 뼈대를
    이어 붙인 곡선. 먹선의 짝이다 — 선의 자리와 폭만 내보내고 밝기·색은 그리는 쪽 팔레트가 정한다."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    H = hessian_matrix(gray, sigma=1.2, order='rc', use_gaussian_derivatives=False)
    _, l2 = hessian_matrix_eigvals(H)
    m = np.where(hair, np.maximum(-l2, 0), 0) > thr
    paths = link_paths(trace_skeleton(skeletonize(m), min_len=6), gap=8, max_turn=0.5)
    paths = [p for p in paths if path_len(p) >= 14]
    local = cv2.GaussianBlur(gray, (0, 0), 4.0)
    bright = (gray > local + 0.04) & hair
    dt = cv2.distanceTransform(bright.astype(np.uint8), cv2.DIST_L2, 3)
    widths = []
    for p in paths:
        d = np.array([dt[y, x] for x, y in p])
        widths.append(float(np.clip(np.percentile(d, 60), 0.5, 3.0)))
    return paths, widths


def flow_blur(img, c2, s2, half=5):
    """결 방향으로만 흐린다 (삼각 가중, 앞뒤 half px): 결을 따라 끊긴 밝은 조각이 한 가닥으로 이어진다."""
    ang = 0.5 * np.arctan2(s2, c2)
    dx, dy = np.cos(ang).astype(np.float32), np.sin(ang).astype(np.float32)
    h, w = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros_like(img)
    wsum = 0.0
    for k in range(-half, half + 1):
        wk = 1.0 - abs(k) / (half + 1.0)
        acc += wk * cv2.remap(img, xx + dx * k, yy + dy * k, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        wsum += wk
    return acc / wsum


_OFF8 = [(-1, -1, 1.4142), (-1, 0, 1.0), (-1, 1, 1.4142), (0, -1, 1.0), (0, 1, 1.0),
         (1, -1, 1.4142), (1, 0, 1.0), (1, 1, 1.4142)]


def _diameter(S, start):
    """뼈대 화소 집합 S 안의 가장 긴 측지 경로 (BFS 두 번). 반환: [(x, y), …]"""
    def bfs(s):
        prev, dist, q, far = {s: None}, {s: 0.0}, deque([s]), s
        while q:
            p = q.popleft()
            for dy, dx, c in _OFF8:
                n = (p[0] + dy, p[1] + dx)
                if n in S and n not in prev:
                    prev[n] = p
                    dist[n] = dist[p] + c
                    q.append(n)
                    if dist[n] > dist[far]:
                        far = n
        return far, prev
    a, _ = bfs(start)
    b, prev = bfs(a)
    path = []
    while b is not None:
        path.append((b[1], b[0]))
        b = prev[b]
    return path


def long_paths(sk, min_len, branches=True):
    """뼈대 → 덩어리마다 가장 긴 경로(지름). 짧은 곁가지(spur)는 버린다.
    branches면 지름을 뺀 나머지에서 min_len 이상인 긴 가지도 되풀이해 뽑는다."""
    lab, n = ndi.label(sk, structure=np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        ys, xs = np.nonzero(lab[sl] == i + 1)
        S = set(zip((ys + sl[0].start).tolist(), (xs + sl[1].start).tolist()))
        while len(S) >= min_len:
            p = _diameter(S, min(S))
            if path_len(p) < min_len:
                break
            out.append(p)
            if not branches:
                break
            # 지름과 그 둘레 2px를 지우고 남은 조각들에서 다시
            for x, y in p:
                for dy in (-2, -1, 0, 1, 2):
                    for dx in (-2, -1, 0, 1, 2):
                        S.discard((y + dy, x + dx))
            if not S:
                break
            sub = np.zeros(sk.shape, bool)
            yy, xx = zip(*S)
            sub[list(yy), list(xx)] = True
            out.extend(long_paths(sub, min_len, branches))
            break
    return out


def chaikin_open(p, it=2):
    """열린 곡선의 Chaikin (끝점은 그대로)."""
    p = np.asarray(p, np.float64)
    for _ in range(it):
        if len(p) < 3:
            break
        q = np.stack([0.75 * p[:-1] + 0.25 * p[1:], 0.25 * p[:-1] + 0.75 * p[1:]], 1).reshape(-1, 2)
        p = np.concatenate([p[:1], q, p[-1:]])
    return p


def centreline(p, dt, step=3.0):
    """화소 경로 → 매끈한 중심선(Chaikin ×2) + 점마다 반폭(5점 이동 평균). 3px 간격, 반폭은 2배 정수."""
    w = np.array([dt[min(dt.shape[0] - 1, int(y)), min(dt.shape[1] - 1, int(x))] for x, y in p], np.float64)
    a = np.array(smooth_path(p, k=5))
    seg = np.sqrt(((a[1:] - a[:-1]) ** 2).sum(1))
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(round(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    x, y, ww = np.interp(t, s, a[:, 0]), np.interp(t, s, a[:, 1]), np.interp(t, s, w)
    c = chaikin_open(np.stack([x, y], 1))
    # Chaikin 뒤 점 수가 늘었으니 다시 같은 간격으로
    seg = np.sqrt(((c[1:] - c[:-1]) ** 2).sum(1))
    s2 = np.concatenate([[0], np.cumsum(seg)])
    t2 = np.linspace(0, s2[-1], n)
    x, y = np.interp(t2, s2, c[:, 0]), np.interp(t2, s2, c[:, 1])
    if len(ww) >= 5:
        ww = np.convolve(np.pad(ww, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    return ([int(round(v)) for xy in zip(x, y) for v in xy],
            [int(round(min(14.0, max(0.5, v)) * 2)) for v in ww])


def ribbons(M, min_len=25, gap=12, max_turn=0.44, branches=False):
    """가는 덩어리 마스크 → 덩어리마다 긴 중심선 하나(곁가지 없이) + 점마다 반폭.
    방향이 이어지는(25° 안) 끝끼리 12px 안이면 잇고, min_len보다 짧은 조각은 버린다."""
    dt = cv2.distanceTransform(M.astype(np.uint8), cv2.DIST_L2, 5)
    paths = long_paths(skeletonize(M), min_len=8, branches=branches)
    paths = link_paths(paths, gap=gap, max_turn=max_turn)
    out, widths = [], []
    for p in paths:
        if path_len(p) < min_len:
            continue
        c, w = centreline(p, dt)
        out.append(c)
        widths.append(w)
    return out, widths


def split_planes(M, dt_min=3.0, area_min=250):
    """덩어리를 '면'(넓거나 큰 것: 윤곽 고리로)과 '가는 결'(뼈대 리본으로)로 나눈다."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(M.astype(np.uint8), connectivity=8)
    dt = cv2.distanceTransform(M.astype(np.uint8), cv2.DIST_L2, 5)
    mx = ndi.maximum(dt, lab, index=np.arange(n))
    plane = np.zeros(n, bool)
    for i in range(1, n):
        plane[i] = mx[i] > dt_min or st[i, cv2.CC_STAT_AREA] > area_min
    return plane[lab] & M, ~plane[lab] & M


def flow_shape(M, c2, s2, along, across):
    """덩어리 모양을 결 방향으로 다듬는다: 결을 따라 앞뒤 along px, 결을 가로질러 across px 흐린 뒤 반으로 자른다.
    결을 따라 물결진 가장자리(문턱이 가는 올 하나하나를 따라 오르내린 자국)가 곧게 펴지고, 결을 따라 짧은
    부스러기는 사라진다. 모양만 다듬을 뿐 새 밝기 단계를 만들지 않는다."""
    m = M.astype(np.float32)
    return flow_blur(flow_blur(m, c2, s2, half=along), -c2, -s2, half=across) > 0.5


def lit_ridges(img, hair, c2, s2):
    """셀 면의 모양: 머리 안의 '빛 받는 다발'(하이라이트 면)과 '윤기 결'(그늘 안의 조금 밝은 결).
    밝기 값은 내보내지 않는다 — 어느 면에 속하는지(모양)만 재고, 색은 그리는 쪽 팔레트와 조명 구역이 정한다.
    판정은 결 방향으로 길게(앞뒤 14px) 흐린 L*로:
      빛 다발  L* > 40 이고 주변(σ10)보다 아주 어둡지 않음
      윤기 결  빛 다발이 아니면서 L* > 22, 주변보다 7 이상 밝음
    넓거나 큰 덩어리는 '면'(윤곽 고리 + 그 안의 긴 심 곡선들), 가는 것만 중심선 리본으로 낸다."""
    from skimage.color import rgb2lab
    L = rgb2lab(img[:, :, ::-1].astype(np.float64) / 255.0)[..., 0].astype(np.float32)
    Lb = flow_blur(L, c2, s2, half=14)
    Ls = flow_blur(L, c2, s2, half=5)
    m = hair.astype(np.float32)
    loc = cv2.GaussianBlur(L * m, (0, 0), 10) / (cv2.GaussianBlur(m, (0, 0), 10) + 1e-6)
    k = np.ones((2, 2), np.uint8)
    # 빛 면 = 길게 흐린 판정(결을 따라 이어진 다발) ∪ 짧게 흐린 판정(가는 밝은 결도 놓치지 않게)
    lit = hair & (((Lb > 40) & (Lb - loc > -4)) | ((Ls > 40) & (Ls - loc > -4)))
    lit = cv2.morphologyEx(lit.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    # 빛 면 안의 가장 밝은 결 (본색 단계): 짧게 흐린 L* > LIT_HI
    hi = lit & (Ls > LIT_HI)
    hi = cv2.morphologyEx(hi.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    # 모양 다듬기: 결 따라 길게 이어진 가닥 모양으로 (경계의 물결·부스러기를 없애고 끝을 뾰족하게)
    lit = flow_shape(lit, c2, s2, *SHAPE) & hair
    hi = flow_shape(hi, c2, s2, *SHAPE) & lit
    sheen = hair & (Lb > 22) & (Lb - loc > 7) & ~cv2.dilate(lit.astype(np.uint8), k).astype(bool)
    sheen = cv2.morphologyEx(sheen.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    sheen = flow_shape(sheen, c2, s2, *SHAPE) & hair & ~lit
    # 중간톤 다발 몸통 (셀 그늘의 밝은 쪽 면): 짧게 흐린 L* > MID_T. 빛 면 밑에 깔린다
    mid = hair & (Ls > MID_T)
    mid = cv2.morphologyEx(mid.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    mid = flow_shape(mid, c2, s2, *SHAPE) & hair
    # 차가운 반사 (무대의 파랑·보랏빛이 그늘 결에 비친 곳): 색상각이 보랏빛·파랑 쪽인 덩어리의 모양만
    Lab = rgb2lab(img[:, :, ::-1].astype(np.float64) / 255.0)
    hue = np.degrees(np.arctan2(Lab[..., 2], Lab[..., 1]))
    cool = hair & (L >= 12) & (hue < -30) & (np.hypot(Lab[..., 1], Lab[..., 2]) > 12) & ~lit
    cool = cv2.morphologyEx(cool.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    cool = flow_shape(cool, c2, s2, *SHAPE) & hair & ~lit
    lp, lt = split_planes(lit)
    sp, st = split_planes(sheen, dt_min=2.5, area_min=180)
    dt = cv2.distanceTransform(lp.astype(np.uint8), cv2.DIST_L2, 5)
    cores = [centreline(p, dt) for p in long_paths(skeletonize(lp), min_len=30)]
    return {
        'litPlane': rings(lp, eps=1.5, min_area=40, smooth=2),
        'litCore': [c for c, _ in cores],
        'litCoreW': [w for _, w in cores],
        'lit': ribbons(lt, min_len=8),
        'litHi': rings(hi, eps=1.0, min_area=12, smooth=1),
        'midPlane': rings(mid, eps=1.2, min_area=40, smooth=1),
        'coolPlane': rings(cool, eps=1.2, min_area=30, smooth=1),
        'sheenPlane': rings(sp, eps=1.5, min_area=40, smooth=2),
        'sheen': ribbons(st, min_len=8),
    }, lit | sheen


def cross_strands(img, hair, skin, face, dress, thin):
    """목·가슴을 가로지르는 가는 머리카락: 앞 영역의 가는 조각 뼈대 + 피부 위의 어두운 가는 능선."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    area = skin & cv2.dilate(hair.astype(np.uint8), disk(80)).astype(bool)
    area &= ~cv2.dilate(hair.astype(np.uint8), disk(1)).astype(bool)
    # 목과 가슴 창 안에서만, 턱선·드레스 선 같은 몸의 선 근처는 뺀다
    box = np.zeros_like(area)
    box[440:800, 680:960] = True
    area &= box
    edge = cv2.morphologyEx(face.astype(np.uint8), cv2.MORPH_GRADIENT, disk(1)).astype(bool)
    area &= ~cv2.dilate((edge | dress).astype(np.uint8), disk(7)).astype(bool)
    H = hessian_matrix(gray, sigma=1.0, order='rc', use_gaussian_derivatives=False)
    l1, _ = hessian_matrix_eigvals(H)
    m = (np.where(area, np.maximum(l1, 0), 0) > 0.035) | thin
    paths = link_paths(trace_skeleton(skeletonize(m), min_len=6), gap=16, max_turn=0.7)
    paths = [p for p in paths if path_len(p) >= 30]
    # 반폭: 가는 조각 위를 지나는 선은 조각의 두께를 따른다 (능선만으로 찾은 선은 1px 안팎)
    dt = cv2.distanceTransform(thin.astype(np.uint8), cv2.DIST_L2, 3)
    widths = []
    for p in paths:
        d = np.array([dt[y, x] for x, y in p])
        widths.append(float(max(0.6, min(2.2, np.percentile(d, 75) * 0.5))))
    return paths, widths


def path_len(p):
    a = np.array(p, np.float64)
    return float(np.sqrt(((a[1:] - a[:-1]) ** 2).sum(1)).sum())


def link_paths(paths, gap, max_turn):
    """끊긴 곡선 조각을 잇는다: 끝점끼리 gap 안이고 방향이 이어지면 하나로 (가까운 쌍부터, 탐욕적으로)."""
    paths = [list(map(tuple, p)) for p in paths]
    if len(paths) < 2:
        return paths

    def end_info(p, at_end):
        q = np.array(p[-1] if at_end else p[0], float)
        r = np.array(p[max(0, len(p) - 7)] if at_end else p[min(len(p) - 1, 6)], float)
        d = q - r
        return q, d / (np.linalg.norm(d) + 1e-9)

    ends = []  # (path, at_end)
    pos = []
    dirs = []
    for i, p in enumerate(paths):
        for e in (True, False):
            q, d = end_info(p, e)
            ends.append((i, e))
            pos.append(q)
            dirs.append(d)
    pos = np.array(pos)
    dirs = np.array(dirs)
    cos_t = math.cos(max_turn)
    pairs = []
    for a, b in cKDTree(pos).query_pairs(gap):
        if ends[a][0] == ends[b][0]:
            continue
        v = pos[b] - pos[a]
        dist = np.linalg.norm(v)
        if dist < 1e-6:
            continue
        u = v / dist
        # 나가는 방향과 잇는 방향, 상대가 들어오는 방향이 모두 비슷해야 한다
        if dirs[a] @ u >= cos_t and -(dirs[b] @ u) >= cos_t:
            pairs.append((dist, a, b))
    pairs.sort()
    # 합집합-찾기로 이은 사슬을 만든다: 끝점마다 한 번만 이을 수 있다
    link = {}
    used = set()
    parent = list(range(len(paths)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for _, a, b in pairs:
        if a in used or b in used:
            continue
        pa, pb = find(ends[a][0]), find(ends[b][0])
        if pa == pb:
            continue
        used.add(a)
        used.add(b)
        link[a] = b
        link[b] = a
        parent[pa] = pb
    # 사슬 따라 붙이기. 끝점 번호: 2i = 경로 i의 끝, 2i+1 = 시작 (짝은 번호 ^ 1)
    out = []
    seen = set()
    for i in range(len(paths)):
        if i in seen:
            continue
        # 사슬의 머리를 찾아 거슬러 올라간다 (경로 i는 시작으로 들어오는 방향)
        cur, enter = i, 2 * i + 1
        while enter in link:
            nb = link[enter]
            if ends[nb][0] == i:
                break
            cur, enter = ends[nb][0], nb ^ 1
        chain = []
        while True:
            seen.add(cur)
            chain.extend(paths[cur] if enter == 2 * cur + 1 else paths[cur][::-1])
            exit_ = enter ^ 1
            if exit_ not in link or ends[link[exit_]][0] in seen:
                break
            cur, enter = ends[link[exit_]][0], link[exit_]
        out.append(chain)
    return out


def refine_hair(img, hair):
    """머리 마스크 가장자리의 푸른 배경 구멍을 뺀다 (정수리 위·왼쪽 다발 사이로 비치는 무대).
    색은 모양을 정하는 데만 쓴다: 가장자리 45px 안에서 푸른빛이 우세한 덩어리."""
    f = img.astype(np.float32)
    b, r = f[:, :, 0], f[:, :, 2]
    blue = ((b > r * 1.05) & (b > 70)).astype(np.float32)
    blue = cv2.GaussianBlur(blue, (0, 0), 2.5) > 0.55
    depth = cv2.distanceTransform(hair.astype(np.uint8), cv2.DIST_L2, 5)
    cut = hair & blue & (depth < 45)
    cut[620:] = False
    cut = cv2.morphologyEx(cut.astype(np.uint8), cv2.MORPH_OPEN, disk(2)).astype(bool)
    # 작은(400px² 미만)·가는(폭 8px 미만) 조각은 머리로 남긴다: 덩어리 안에 뚫린 타원 구멍처럼 보이므로
    n, lab, st, _ = cv2.connectedComponentsWithStats(cut.astype(np.uint8), connectivity=8)
    dt = cv2.distanceTransform(cut.astype(np.uint8), cv2.DIST_L2, 5)
    keep = np.zeros(n, bool)
    mx = ndi.maximum(dt, lab, index=np.arange(n))
    for i in range(1, n):
        keep[i] = st[i, cv2.CC_STAT_AREA] >= 400 and mx[i] >= 4
    return hair & ~keep[lab]


def open_holes(hair, outer, r=9, min_area=300):
    """바깥 실루엣에서 2r px 안까지 다가온 구멍은 바깥으로 터 준다: 구멍과 바깥 배경 사이의 가는 머리 다리를 뺀다.
    원본에서 이런 틈은 바깥으로 열려 있고 가는 가닥만 건너간다 (닫힌 타원 구멍은 '눈'처럼 보인다)."""
    holes = ndi.binary_fill_holes(hair) & ~hair
    lab, n = ndi.label(holes)
    if not n:
        return hair
    area = ndi.sum(holes, lab, index=np.arange(1, n + 1))
    big = np.concatenate([[False], area >= min_area])[lab]
    bridge = (cv2.dilate(big.astype(np.uint8), disk(r)).astype(bool)
              & cv2.dilate(outer.astype(np.uint8), disk(r)).astype(bool) & hair)
    return hair & ~bridge


def clean_hair(hair):
    """실루엣 다듬기: 6px 안팎의 틈은 닫고, 300px² 미만의 구멍은 메운다. 정수리 위쪽 윤곽은 부드럽게."""
    m = cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_CLOSE, disk(3)).astype(bool)
    holes = ndi.binary_fill_holes(m) & ~m
    lab, n = ndi.label(holes)
    if n:
        area = ndi.sum(holes, lab, index=np.arange(1, n + 1))
        small = np.concatenate([[False], area < 300])
        m |= small[lab]
    top = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.0) > 0.5
    m[:130] = top[:130]
    cut = np.zeros(m.shape, np.uint8)
    cv2.fillPoly(cut, [np.array(LOOP_CUT, np.int32)], 1)
    m &= ~cut.astype(bool)
    return m


# ── 잔머리 ────────────────────────────────────────────────
def flyaways(img, hair, bg):
    """머리 둘레 띠 안의 배경에서 가는 선(채널별 밝은·어두운 능선)을 골라 뼈대 곡선으로.
    밝은 덩어리(색종이·응원봉)의 테두리는 양옆 색이 크게 다르므로 버린다."""
    band = cv2.dilate(hair.astype(np.uint8), disk(80)).astype(bool) & bg
    band &= ~cv2.dilate(hair.astype(np.uint8), disk(1)).astype(bool)
    f = img.astype(np.float32) / 255.0
    rs = []
    for ch in range(3):
        H = hessian_matrix(f[:, :, ch], sigma=1.0, order='rc', use_gaussian_derivatives=False)
        l1, l2 = hessian_matrix_eigvals(H)
        rs.append(np.maximum(-l2, 0))
        rs.append(np.maximum(l1, 0))
    ridge = np.where(band, np.max(np.stack(rs), 0), 0)
    m = ridge > 0.035
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8)).astype(bool)
    paths = link_paths(trace_skeleton(skeletonize(m), min_len=8), gap=9, max_turn=0.6)
    soft = cv2.GaussianBlur(f, (0, 0), 1.0)
    h, w = m.shape
    out = []
    for p in paths:
        if path_len(p) < 22:
            continue
        a = np.array(p, np.float64)
        # 그림 테두리를 따라가는 선은 버린다
        if np.mean((a[:, 0] < 4) | (a[:, 1] < 4) | (a[:, 0] > w - 5) | (a[:, 1] > h - 5)) > 0.3:
            continue
        diffs = []
        for i in range(2, len(a) - 2, 3):
            t = a[i + 2] - a[i - 2]
            t /= np.linalg.norm(t) + 1e-9
            nrm = np.array([-t[1], t[0]])
            q1 = np.clip(np.round(a[i] + nrm * 4), 0, [w - 1, h - 1]).astype(int)
            q2 = np.clip(np.round(a[i] - nrm * 4), 0, [w - 1, h - 1]).astype(int)
            diffs.append(np.abs(soft[q1[1], q1[0]] - soft[q2[1], q2[0]]).sum())
        if diffs and np.median(diffs) < 0.42:
            out.append(p)
    return out


def split_kinks(paths, max_turn=0.6, span=8, min_len=25):
    """곡선을 꺾인 곳(앞뒤 span px의 방향 차이 > max_turn)에서 자르고 짧은 조각은 버린다 (긁힌 자국 같은 잔머리 방지)."""
    out = []
    for p in paths:
        a = np.array(p, np.float64)
        cut = [0]
        for i in range(span, len(a) - span):
            u, v = a[i] - a[i - span], a[i + span] - a[i]
            c = (u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)
            if c < math.cos(max_turn) and i - cut[-1] > span:
                cut.append(i)
        cut.append(len(a))
        for i0, i1 in zip(cut[:-1], cut[1:]):
            q = [tuple(v) for v in a[i0:i1]]
            if len(q) > 2 and path_len(q) >= min_len:
                out.append(q)
    return out


def trace_skeleton(sk, min_len):
    """뼈대 화소를 끊김 없는 곡선들로 나눈다 (갈림길에서 끊는다)."""
    sk = sk.copy()
    h, w = sk.shape
    nb = ndi.convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') - 1
    sk[(nb > 2) & sk] = False  # 갈림길 제거
    lab, n = ndi.label(sk, structure=np.ones((3, 3)))
    out = []
    objs = ndi.find_objects(lab)
    for i, sl in enumerate(objs):
        comp = lab[sl] == i + 1
        ys, xs = np.nonzero(comp)
        if len(xs) < min_len:
            continue
        pts = set(zip((xs + sl[1].start).tolist(), (ys + sl[0].start).tolist()))
        # 끝점에서 출발해 이웃을 따라간다
        def nbrs(p):
            x, y = p
            return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    if (dx or dy) and (x + dx, y + dy) in pts]
        ends = [p for p in pts if len(nbrs(p)) == 1]
        start = min(ends) if ends else min(pts)
        path = [start]
        seen = {start}
        cur = start
        while True:
            nx = [q for q in nbrs(cur) if q not in seen]
            if not nx:
                break
            cur = nx[0]
            seen.add(cur)
            path.append(cur)
        if len(path) >= min_len:
            out.append(path)
    return out


def outer_background(bg):
    """바깥 배경: 머리카락 사이로 비치는 작은 구멍은 뺀다 (역광은 바깥 가장자리에서만 받는다)."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(bg.astype(np.uint8), connectivity=8)
    outer = np.zeros_like(bg)
    for i in range(1, n):
        x, y, w, h, area = st[i]
        touches = x == 0 or y == 0 or x + w >= bg.shape[1] or y + h >= bg.shape[0]
        if touches or area >= 6000:
            outer |= lab == i
    return outer


def openness(lines, outer):
    """가닥 끝이 바깥 배경에 닿는지 (1 = 끝, 2 = 뿌리, 3 = 둘 다): 그리는 쪽에서 잔머리처럼 늘인다."""
    d_out = cv2.distanceTransform((~outer).astype(np.uint8), cv2.DIST_L2, 5)
    h, w = outer.shape

    def near(p):
        return d_out[min(h - 1, int(p[1])), min(w - 1, int(p[0]))] < 5

    return ''.join(str((1 if near(l[-1]) else 0) | (2 if near(l[0]) else 0)) for l in lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', default=None)
    args = ap.parse_args()

    img = cv2.imread(REF)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hair, skin, face, dress, bg = (load_mask(n) for n in ('hair', 'skin', 'face', 'dress', 'bg'))
    refined = clean_hair(refine_hair(img, hair))
    bg = (bg | (hair & ~refined)) & ~refined
    hair = refined
    outer = outer_background(bg)
    opened = open_holes(hair, outer)
    bg |= hair & ~opened
    hair = opened
    outer = outer_background(bg)
    back, front, thin = regions(hair, skin, face, dress)
    # 앞 장의 고리: 머리 구멍은 메운다 (구멍은 그리는 쪽에서 부드럽게 비운다). 피부 위 가는 조각만 뺀다
    front = ndi.binary_fill_holes(front) & ~thin
    back = ndi.binary_fill_holes(back)
    # 몸 밑으로 이어 그린 뒤 머리가 몸이 덮지 않는 배경 틈(예: 드레스 단과 팔뚝 사이의 분홍 틈)을 메우지 않게:
    # 머리에서 4px 넘게 떨어진 배경(2px 깎은 것)은 뺀다
    bg_in = cv2.erode(bg.astype(np.uint8), disk(2)).astype(bool)
    leak = back & bg_in & ~cv2.dilate(hair.astype(np.uint8), disk(4)).astype(bool)
    back &= ~leak
    back = cv2.morphologyEx(back.astype(np.uint8), cv2.MORPH_OPEN, disk(1)).astype(bool)
    print('back leak removed', int(leak.sum()), 'left', int((back & bg & ~hair).sum()))
    veil = front & see_through(hair.shape)
    veil = cv2.morphologyEx(veil.astype(np.uint8), cv2.MORPH_OPEN, disk(2)).astype(bool)
    # 비침 구역도 보통 머리처럼 앞 장에 넣고, 원본에서 잰 피부 틈만 비운다
    front = (front & ~veil) | (veil & ~skin_gaps(img, veil))

    # 결 방향장과 흐름선 (다발: 넓은 간격, 가닥: 좁은 간격)
    c2, s2 = orientation(gray, hair)
    trace_mask = cv2.dilate(hair.astype(np.uint8), disk(2)).astype(bool)
    field = Field(c2, s2, trace_mask)
    locks = streamlines(field, trace_mask, d_sep=11.0, d_test=5.0, min_len=20, seed=1)
    strands = streamlines(field, trace_mask, d_sep=3.2, d_test=1.5, min_len=10, seed=2, max_len=500)
    locks = [orient_root(l) for l in locks]
    strands = [orient_root(l) for l in strands]

    # 가는 선들: 잔머리, 틈 가닥, 먹선, 목·가슴 위 가닥
    fly = [orient_root(f) for f in split_kinks([smooth_path(f, k=9) for f in flyaways(img, hair, bg)])]
    gaps = [orient_root(p) for p in gap_strands(gray, hair, face, dress)]
    shapes, _ = lit_ridges(img, hair, c2, s2)
    (lit, lit_w), (sheen, sheen_w) = shapes['lit'], shapes['sheen']
    ink, ink_w = ink_lines(img, hair)
    ink = [orient_root(p) for p in ink]
    glint, glint_w = glint_lines(img, hair)
    glint = [orient_root(p) for p in glint]
    cross, cross_w = cross_strands(img, hair, skin, face, dress, thin)
    cross = [orient_root(c) for c in cross]

    data = {
        'version': 1,
        'scalp': list(SCALP),
        'sil': rings(hair, part='outer', smooth=2),
        'holes': rings(hair, part='holes', smooth=2, min_area=60),
        'back': rings(back, smooth=2, min_area=60),
        'front': rings(front, smooth=2),
        'veil': rings(veil, smooth=2, min_area=60),
        'outer': rings(outer, eps=1.5, min_area=200),
        'locks': [resample(l, 5.0) for l in locks],
        'strands': [resample(l, 4.0) for l in strands],
        'open': openness(strands, outer),
        'fly': [resample(f, 4.0) for f in fly],
        'gap': [resample(p, 4.0) for p in gaps],
        'litPlane': shapes['litPlane'],
        'litCore': shapes['litCore'],
        'litCoreW': shapes['litCoreW'],
        'litHi': shapes['litHi'],
        'midPlane': shapes['midPlane'],
        'coolPlane': shapes['coolPlane'],
        'lit': lit,
        'litW': lit_w,
        'sheenPlane': shapes['sheenPlane'],
        'sheen': sheen,
        'sheenW': sheen_w,
        'ink': [resample(smooth_path(c), 5.0) for c in ink],
        'glint': [resample(smooth_path(c), 4.0) for c in glint],
        'glintW': [round(w, 1) for w in glint_w],
        'flow': flow_grid(c2, s2, hair),
        'inkW': [round(w, 1) for w in ink_w],
        'cross': [resample(smooth_path(c), 4.0) for c in cross],
        'crossW': [round(w, 1) for w in cross_w],
    }
    js = ('// tools/proc_hair.py가 만든다. 직접 고치지 않는다.\n'
          '// 머리카락의 기하만 담는다(색 없음): 실루엣·구멍·앞·뒤·비침·바깥 배경(고리), 다발·가닥 흐름선,\n'
          '// 먹선·밝은 결·틈 가닥·잔머리·목 위 가닥 곡선(뿌리→끝), 빛 다발·윤기 결의 뼈대와 반폭, 결 방향장.\n'
          '// 좌표는 원본 픽셀.\n'
          '(window.ConcertProc = window.ConcertProc || {}).hairData = '
          + json.dumps(data, separators=(',', ':')) + ';\n')
    with open(OUT_JS, 'w') as f:
        f.write(js)
    print('locks', len(locks), 'strands', len(strands), 'fly', len(fly), 'cross', len(cross),
          'ink', len(ink), 'glint', len(glint), 'gap', len(gaps), 'lit', len(lit), 'sheen', len(sheen),
          'litPlane', len(shapes['litPlane']), 'litCore', len(shapes['litCore']),
          'bytes', len(js), 'back rings', len(data['back']), 'front rings', len(data['front']))

    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
        cv2.imwrite(os.path.join(args.debug, 'back.png'), back.astype(np.uint8) * 255)
        cv2.imwrite(os.path.join(args.debug, 'front.png'), front.astype(np.uint8) * 255)
        vis = (img * 0.35).astype(np.uint8)
        for l in strands:
            cv2.polylines(vis, [np.array(l, np.int32)], False, (120, 160, 200), 1, cv2.LINE_AA)
        for l in locks:
            cv2.polylines(vis, [np.array(l, np.int32)], False, (0, 255, 255), 1, cv2.LINE_AA)
            cv2.circle(vis, (int(l[0][0]), int(l[0][1])), 2, (0, 0, 255), -1)
        for l in fly:
            cv2.polylines(vis, [np.array(l, np.int32)], False, (255, 0, 255), 1, cv2.LINE_AA)
        vis2 = img.copy()
        vis2[front] = (vis2[front] * 0.5 + np.array([0, 0, 120])).astype(np.uint8)
        for l in cross:
            cv2.polylines(vis2, [np.array(l, np.int32)], False, (0, 255, 0), 1, cv2.LINE_AA)
        cv2.imwrite(os.path.join(args.debug, 'cross.png'), vis2)
        cv2.imwrite(os.path.join(args.debug, 'lines.png'), vis)


if __name__ == '__main__':
    main()
