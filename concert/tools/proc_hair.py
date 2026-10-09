#!/usr/bin/env python3
"""hair 레이어용 기하 측정: 원본에서 머리카락의 '모양과 결'만 재서 js/procedural/data/hair.js로 쓴다.

    python3 concert/tools/proc_hair.py [--debug DIR]

내보내는 것 (색 화소는 하나도 내보내지 않는다)
    sil       머리 실루엣 (분석 마스크에서 가장자리의 푸른 배경 구멍을 뺀 것)
    back      뒤 머리 실루엣: sil + 몸·얼굴 밑으로 조금 이어 그린 부분 (evenodd 고리)
    front     몸·얼굴보다 앞에 다시 덮는 머리 (보이는 머리 전부에서 피부 위의 가는 조각만 뺀 것)
    outer     바깥 배경 (머리카락 사이 작은 구멍은 뺀 것) — 역광 띠의 기준
    locks     굵은 다발 흐름선 (뿌리 → 끝)
    strands   가는 가닥 흐름선 (뿌리 → 끝)
    open      가닥마다 끝이 바깥 배경에 닿는지 (1 = 끝, 2 = 뿌리, 3 = 둘 다)
    fly       실루엣 밖 배경을 가로지르는 잔머리 곡선
    cross     목·가슴 피부 위를 가로지르는 가는 머리카락 곡선, crossW = 곡선마다 반폭(px)
    ink       머리 안의 먹선 곡선 (다발 사이 어두운 가는 선)

방법
    1. 결 방향: 휘도의 Sobel 기울기로 구조 텐서를 만들고 머리 마스크 안에서 평활(σ 6), 일관도²로 가중해
       한 번 더 평활(σ 8). 결 = 기울기에 수직.
    2. 흐름선: Jobard–Lefer 균등 간격 흐름선. RK2로 양방향 추적, 이미 그은 선과 d_test보다 가까워지면 멈춤.
    3. 뿌리 쪽: 정수리(890, 200)에서 가까운 끝이 뿌리.
    4. 잔머리: 머리 둘레 띠 안의 배경에서 가는 능선(채널별 헤시안)을 골라 뼈대를 따라간다.
       목·가슴 위 가닥도 같은 방법(어두운 능선)에 앞 영역의 가는 조각 뼈대를 더한다.
같은 입력이면 언제나 같은 결과가 나온다(난수 시드 고정).
"""
import argparse
import json
import math
import os
from collections import defaultdict

import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.feature import hessian_matrix, hessian_matrix_eigvals
from skimage.morphology import skeletonize

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
MASKS = os.path.join(HERE, 'analysis')
OUT_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'hair.js')

SCALP = (890.0, 200.0)  # 뿌리 쪽을 정할 기준점 (정수리 가운데)


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
            if not field.inside(nx, ny) or not grid.free(nx, ny, d_test):
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


def streamlines(field, mask, d_sep, d_test, min_len, seed, max_len=900):
    rng = np.random.default_rng(seed)
    grid = Grid(d_sep)
    lines = []
    # 첫 씨앗 후보: 마스크 안의 격자점을 섞어서
    ys, xs = np.nonzero(mask[::int(d_sep * 2), ::int(d_sep * 2)])
    cand = list(zip(xs * int(d_sep * 2) + 0.5, ys * int(d_sep * 2) + 0.5))
    order = rng.permutation(len(cand))
    cand = [cand[i] for i in order]
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
    """정수리에서 가까운 끝을 뿌리로."""
    a, b = pts[0], pts[-1]
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
def rings(mask, eps=1.0, min_area=25):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(ap) < 3:
            continue
        out.append([int(v) for v in ap.ravel()])
    return out


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


def ink_lines(img, hair):
    """머리 안의 먹선(다발 사이 어두운 가는 선): 어두운 능선(헤시안) 뼈대를 이어 붙인 곡선."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    H = hessian_matrix(gray, sigma=1.2, order='rc', use_gaussian_derivatives=False)
    l1, _ = hessian_matrix_eigvals(H)
    m = np.where(hair, np.maximum(l1, 0), 0) > 0.02
    paths = link_paths(trace_skeleton(skeletonize(m), min_len=6), gap=8, max_turn=0.5)
    return [p for p in paths if path_len(p) >= 14]


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
    m = (np.where(area, np.maximum(l1, 0), 0) > 0.05) | thin
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
    from scipy.spatial import cKDTree
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
    return hair & ~cut


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
    m = ridge > 0.05
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
        if diffs and np.median(diffs) < 0.35:
            out.append(p)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', default=None)
    args = ap.parse_args()

    img = cv2.imread(REF)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hair, skin, face, dress, bg = (load_mask(n) for n in ('hair', 'skin', 'face', 'dress', 'bg'))
    cut = hair & ~refine_hair(img, hair)
    hair = hair & ~cut
    bg = bg | cut

    c2, s2 = orientation(gray, hair)
    back, front, thin = regions(hair, skin, face, dress)
    cross, cross_w = cross_strands(img, hair, skin, face, dress, thin)
    cross = [orient_root(c) for c in cross]

    trace_mask = cv2.dilate(hair.astype(np.uint8), disk(2)).astype(bool)
    field = Field(c2, s2, trace_mask)
    locks = streamlines(field, trace_mask, d_sep=11.0, d_test=5.0, min_len=20, seed=1)
    strands = streamlines(field, trace_mask, d_sep=3.2, d_test=1.5, min_len=10, seed=2, max_len=500)
    locks = [orient_root(l) for l in locks]
    strands = [orient_root(l) for l in strands]


    fly = flyaways(img, hair, bg)
    ink = [orient_root(p) for p in ink_lines(img, hair)]
    fly = [orient_root(f) for f in fly]

    # 바깥 배경: 머리카락 사이로 비치는 작은 구멍은 뺀다 (역광은 바깥 가장자리에서만)
    n, lab, st, _ = cv2.connectedComponentsWithStats(bg.astype(np.uint8), connectivity=8)
    outer = np.zeros_like(bg)
    for i in range(1, n):
        x, y, w, h, area = st[i]
        touches = x == 0 or y == 0 or x + w >= bg.shape[1] or y + h >= bg.shape[0]
        if touches or area >= 6000:
            outer |= lab == i
    d_out = cv2.distanceTransform((~outer).astype(np.uint8), cv2.DIST_L2, 5)
    # 끝이 바깥 배경에 닿는 가닥 (1 = 끝, 2 = 뿌리, 3 = 둘 다): 그리는 쪽에서 잔머리처럼 늘인다
    def openness(l):
        a, b = l[0], l[-1]
        f = 0
        if d_out[min(1253, int(b[1])), min(1253, int(b[0]))] < 5:
            f |= 1
        if d_out[min(1253, int(a[1])), min(1253, int(a[0]))] < 5:
            f |= 2
        return str(f)

    data = {
        'version': 1,
        'scalp': list(SCALP),
        'sil': rings(hair),
        'back': rings(back),
        'front': rings(front),
        'locks': [resample(l, 5.0) for l in locks],
        'strands': [resample(l, 4.0) for l in strands],
        'open': ''.join(openness(l) for l in strands),
        'outer': rings(outer, eps=1.5, min_area=200),
        'fly': [resample(smooth_path(f), 4.0) for f in fly],
        'cross': [resample(smooth_path(c), 4.0) for c in cross],
        'ink': [resample(smooth_path(c), 5.0) for c in ink],
        'crossW': [round(w, 1) for w in cross_w],
    }
    js = ('// tools/proc_hair.py가 만든다. 직접 고치지 않는다.\n'
          '// 머리카락의 기하: 뒤 실루엣·앞 영역(evenodd 고리), 다발·가닥·잔머리 흐름선(뿌리→끝, 원본 픽셀 좌표).\n'
          '(window.ConcertProc = window.ConcertProc || {}).hairData = '
          + json.dumps(data, separators=(',', ':')) + ';\n')
    with open(OUT_JS, 'w') as f:
        f.write(js)
    print('locks', len(locks), 'strands', len(strands), 'fly', len(fly), 'cross', len(cross), 'ink', len(ink),
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
