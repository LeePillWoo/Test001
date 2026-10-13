#!/usr/bin/env python3
"""원본 그림을 영역(피부·머리카락·드레스·배경)으로 나누고, 절차적 기법이 쓸 좌표·윤곽·팔레트를 만든다.

    python3 concert/tools/analyze.py [--debug DIR]

출력
    tools/analysis/mask_{skin,face,hair,dress,bg}.png   1254×1254, 255 = 안쪽
    js/procedural/data/analysis.js                      window.ConcertProc.data

방법
    1. 피부: Lab 색 범위 + 팔 가장자리 역광. 열림 연산 뒤 씨앗 점에 닿은 덩어리만 남긴다.
    2. 나머지(머리카락·드레스·배경): 손으로 그린 확실한 영역(SCRIB)과 색으로 고른 자동 표본으로
       작은 MLP 픽셀 분류기를 학습한다. 특징은 여러 흐림 단계의 Lab, 잔결 세기, 스팽글 점 밀도 등.
    3. 끈·가방·귀처럼 자동으로 안 갈리는 곳은 힌트 다각형으로 정한다.
    4. 정리: 가는 머리카락 가닥은 밑 영역에 붙이고, 30픽셀 미만 조각은 이웃 영역에 합친다.
같은 입력이면 언제나 같은 결과가 나온다(난수 시드 고정).
"""
import argparse
import json
import os

import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage.feature import hessian_matrix, hessian_matrix_eigvals

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
OUT_MASK = os.path.join(HERE, 'analysis')
OUT_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'analysis.js')

BG, HAIR, DRESS, SKIN = 0, 1, 2, 3
NAMES = {BG: 'bg', HAIR: 'hair', DRESS: 'dress', SKIN: 'skin'}

# ── 힌트 (원본 픽셀 좌표) ─────────────────────────────────
# 분류기 학습용 확실한 영역
SCRIB = {
    BG: [
        [(0, 0), (690, 0), (640, 60), (560, 150), (520, 230), (440, 300), (380, 360), (320, 420),
         (270, 480), (230, 540), (190, 600), (160, 660), (140, 740), (120, 800), (0, 840)],
        [(1060, 0), (1254, 0), (1254, 1254), (1170, 1254), (1175, 1100), (1200, 950), (1225, 800),
         (1232, 600), (1215, 420), (1180, 300), (1140, 180), (1090, 80)],
    ],
    HAIR: [
        [(760, 50), (980, 50), (1010, 90), (930, 110), (800, 115), (740, 90)],
        [(620, 220), (720, 170), (740, 230), (705, 280), (690, 420), (620, 450), (560, 380)],
        [(330, 560), (440, 500), (450, 640), (380, 760), (320, 740)],
        [(990, 430), (1100, 420), (1150, 600), (1120, 800), (1000, 800), (950, 600)],
    ],
    DRESS: [
        [(480, 830), (600, 830), (850, 830), (860, 930), (760, 1000), (600, 1040), (500, 1040), (460, 950)],
        [(440, 1100), (560, 1080), (580, 1254), (430, 1254)],
        [(0, 1010), (200, 975), (270, 1010), (230, 1150), (190, 1254), (0, 1254)],
    ],
    SKIN: [
        [(800, 150), (980, 160), (1000, 300), (920, 440), (820, 420), (780, 300)],
        [(520, 520), (620, 520), (600, 620), (450, 800), (330, 1050), (260, 1240), (230, 1240), (300, 1000),
         (420, 760)],
        [(660, 560), (860, 560), (880, 640), (820, 740), (660, 700)],
        [(640, 1180), (700, 1100), (730, 1200), (680, 1250)],
    ],
}
# 이 안에서는 색으로 표본을 더 고른다: 어두운 무채색 = 머리카락, 넓게 빛나는 색 = 배경
AUTO = [
    [(860, 700), (1000, 600), (1180, 700), (1170, 1254), (700, 1254), (740, 1000), (880, 980)],
    [(160, 560), (330, 500), (420, 640), (300, 860), (160, 860)],
    [(560, 1000), (700, 1000), (650, 1200), (560, 1200)],
]
# 피부 덩어리를 고르는 씨앗 점
SKIN_SEEDS = [(900, 250), (560, 560), (420, 850), (300, 1150), (780, 620), (700, 1180), (250, 890),
              (840, 500), (230, 910), (760, 1000)]
# 귀(인이어·귀걸이 포함) — 얼굴에 들어간다
EARS = [
    [(722, 284), (742, 282), (755, 292), (762, 310), (764, 368), (752, 372), (745, 380), (735, 380),
     (727, 368), (719, 352), (712, 333), (710, 310), (713, 293)],
    [(1018, 351), (1035, 347), (1048, 359), (1054, 380), (1051, 398), (1041, 410), (1031, 418),
     (1026, 433), (1011, 434), (1005, 421), (1002, 405), (1004, 385), (1010, 365)],
]
# 눈(속눈썹 선 포함) — 눈꼬리가 머리카락에 닿아 구멍 채우기로 안 메워지므로 직접 넣는다
EYES = [
    [(790, 250), (800, 232), (820, 214), (845, 208), (868, 214), (882, 228), (888, 250), (878, 260),
     (850, 262), (820, 258), (800, 256)],
    [(942, 272), (950, 256), (968, 245), (990, 241), (1008, 248), (1020, 262), (1026, 284), (1012, 295),
     (985, 292), (960, 285)],
]
# 얼굴 범위: 이마 위부터 턱선까지 (턱선 아래는 목)
FACE_CLIP = [(690, 90), (1080, 90), (1080, 395), (1022, 395), (1000, 416), (970, 441), (940, 461),
             (900, 474), (868, 478), (840, 462), (815, 446), (795, 430), (780, 410), (770, 395), (690, 395)]
# 어깨끈: 이 굵은 선 둘레의 어두운 픽셀
STRAP_L = [(641, 478), (652, 530), (656, 580), (650, 620), (636, 665), (615, 705), (590, 738)]
# 오른쪽 끈 자리(머리카락 밑으로 스팽글이 비치는 곳)
STRAP_R = [(845, 805), (898, 738), (922, 712), (936, 724), (906, 776), (872, 815)]
# 왼쪽 아래 검은 가방/띠
SASH = [(0, 906), (40, 880), (80, 858), (118, 840), (160, 834), (176, 852), (150, 872), (128, 884),
        (110, 920), (82, 958), (40, 985), (0, 992)]
# 드레스가 있을 수 있는 범위(몸판·아랫단 / 왼쪽 아래 치마·가방)
DRESS_ENV = [
    [(430, 690), (640, 690), (700, 760), (940, 680), (975, 750), (920, 880), (890, 960), (800, 1000),
     (700, 1040), (620, 1080), (600, 1254), (320, 1254), (330, 1100), (380, 960), (420, 820)],
    [(0, 820), (180, 815), (340, 880), (360, 1000), (330, 1254), (0, 1254)],
]
# 열림 연산에 깎인 좁은 피부 조각(머리 가닥 사이)을 되살리는 곳
SKIN_LOOSE = [
    [(170, 840), (335, 840), (335, 880), (318, 1000), (170, 1000)],
    [(560, 940), (900, 940), (900, 1254), (520, 1254)],
    [(800, 600), (935, 600), (935, 760), (800, 760)],
]
# 주요 조명(빛무리 있는 스포트라이트) 대략 위치
LIGHT_HINTS = [(326, 6), (231, 309), (425, 222), (1170, 51), (1220, 924)]
# 파츠 나누기
PART_ARM_L = [(0, 420), (642, 466), (655, 560), (650, 620), (632, 675), (600, 735), (520, 800),
              (500, 920), (470, 1080), (440, 1254), (0, 1254)]
PART_WAIST = [(150, 820), (335, 820), (335, 880), (318, 1000), (150, 1000)]
PART_ARM_R = [(560, 940), (900, 940), (900, 1254), (520, 1254)]
PART_SKIRT = [(0, 830), (200, 830), (330, 900), (380, 1000), (360, 1254), (0, 1254)]


def ell(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def poly_mask(polys, shape, value=1):
    m = np.zeros(shape, np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.array(p, np.int32)], value)
    return m.astype(bool)


def line_mask(pts, shape, width):
    m = np.zeros(shape, np.uint8)
    cv2.polylines(m, [np.array(pts, np.int32)], False, 1, width)
    return m.astype(bool)


# ── 특징 ──────────────────────────────────────────────
def features(img, lab):
    H, W = lab.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    f = []
    for s in (0, 1.5, 4, 10):
        l = lab if s == 0 else cv2.GaussianBlur(lab, (0, 0), s)
        f += [l[..., 0], l[..., 1], l[..., 2]]
    d = np.abs(gray - cv2.GaussianBlur(gray, (0, 0), 2))
    f += [cv2.GaussianBlur(d, (0, 0), 3) * 500, cv2.GaussianBlur(d, (0, 0), 9) * 500]
    # 스팽글: 밝은 점(헤시안 두 고윳값이 모두 음수) 밀도와 가닥(한 방향만) 밀도
    e = hessian_matrix_eigvals(hessian_matrix(gray, sigma=1.5, order='rc', use_gaussian_derivatives=False))
    blob = np.clip(-e[0], 0, None)
    ridge = np.clip(-e[1], 0, None) - blob
    f += [cv2.GaussianBlur(blob, (0, 0), 6) * 3000, cv2.GaussianBlur(blob, (0, 0), 14) * 3000,
          cv2.GaussianBlur(ridge, (0, 0), 6) * 1000]
    k9 = np.ones((9, 9), np.uint8)
    f += [cv2.erode(lab[..., 0], k9), cv2.dilate(lab[..., 0], k9)]
    k25 = np.ones((25, 25), np.uint8)
    f += [cv2.GaussianBlur(cv2.erode(lab[..., 0], k25), (0, 0), 5),
          cv2.GaussianBlur(cv2.dilate(lab[..., 0], k25), (0, 0), 5)]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    f += [xx / 4, yy / 4]
    return np.stack(f, -1).reshape(-1, len(f)).astype(np.float32)


# ── 작은 MLP (numpy, Adam) ──────────────────────────────
def train_mlp(X, y, ncls, hidden=(48, 32), iters=600, lr=3e-3, seed=0, wd=1e-4):
    rng = np.random.default_rng(seed)
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Xs = (X - mu) / sd
    dims = [X.shape[1], *hidden, ncls]
    Ws = [rng.normal(0, np.sqrt(2 / dims[i]), (dims[i], dims[i + 1])).astype(np.float32)
          for i in range(len(dims) - 1)]
    bs = [np.zeros(d, np.float32) for d in dims[1:]]
    params = Ws + bs
    m1 = [np.zeros_like(p) for p in params]
    m2 = [np.zeros_like(p) for p in params]
    Y = np.eye(ncls, dtype=np.float32)[y]
    for it in range(1, iters + 1):
        bi = rng.choice(len(X), min(len(X), 16384), replace=False)
        acts = [Xs[bi]]
        h = acts[0]
        for i in range(len(Ws)):
            z = h @ Ws[i] + bs[i]
            h = np.maximum(z, 0) if i < len(Ws) - 1 else z
            acts.append(h)
        z = acts[-1] - acts[-1].max(1, keepdims=True)
        p = np.exp(z)
        p /= p.sum(1, keepdims=True)
        g = (p - Y[bi]) / len(bi)
        gW, gb = [None] * len(Ws), [None] * len(Ws)
        for i in range(len(Ws) - 1, -1, -1):
            gW[i] = acts[i].T @ g + wd * Ws[i]
            gb[i] = g.sum(0)
            if i > 0:
                g = (g @ Ws[i].T) * (acts[i] > 0)
        for j, (pp, gg) in enumerate(zip(params, gW + gb)):
            m1[j] = 0.9 * m1[j] + 0.1 * gg
            m2[j] = 0.999 * m2[j] + 0.001 * gg * gg
            pp -= lr * (m1[j] / (1 - 0.9 ** it)) / (np.sqrt(m2[j] / (1 - 0.999 ** it)) + 1e-8)

    def predict(Xq, chunk=200000):
        out = np.empty((len(Xq), ncls), np.float32)
        for s in range(0, len(Xq), chunk):
            h = (Xq[s:s + chunk] - mu) / sd
            for i in range(len(Ws)):
                h = h @ Ws[i] + bs[i]
                if i < len(Ws) - 1:
                    h = np.maximum(h, 0)
            h = h - h.max(1, keepdims=True)
            e = np.exp(h)
            out[s:s + chunk] = e / e.sum(1, keepdims=True)
        return out

    return predict


def classify(img, lab):
    H, W = lab.shape[:2]
    L = lab[..., 0] * 100 / 255
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    chroma = np.hypot(a, b)
    lbl = np.full((H, W), 255, np.uint8)
    for c, polys in SCRIB.items():
        lbl[poly_mask(polys, (H, W))] = c
    reg = poly_mask(AUTO, (H, W)) & (lbl == 255)
    dark = cv2.erode(((L < 28) & (chroma < 35)).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    glow = cv2.morphologyEx(((chroma > 45) & (L > 30)).astype(np.uint8), cv2.MORPH_OPEN, ell(4)).astype(bool)
    lbl[reg & dark] = HAIR
    lbl[reg & glow] = BG
    F = features(img, lab)
    rng = np.random.default_rng(0)
    idx = []
    for c in range(4):
        ii = np.flatnonzero(lbl.ravel() == c)
        idx.append(rng.choice(ii, min(30000, len(ii)), replace=False))
    idx = np.concatenate(idx)
    predict = train_mlp(F[idx], lbl.ravel()[idx].astype(np.int64), 4)
    P = predict(F).reshape(H, W, 4)
    return P, lbl


# ── 피부 ──────────────────────────────────────────────
def skin_mask(lab):
    H, W = lab.shape[:2]
    L = lab[..., 0] * 100 / 255
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    cand = (L > 50) & (a > 2) & (a < 42) & (b > 3) & (b < 36) & (b > a * 0.2)
    cand |= (L > 80) & (np.hypot(a, b) < 30)  # 팔 가장자리 역광
    op = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, ell(3))
    n, cc = cv2.connectedComponents(op, connectivity=4)
    keep = np.zeros(n, bool)
    for x, y in SKIN_SEEDS:
        if cc[y, x] > 0:
            keep[cc[y, x]] = True
    sk = keep[cc]
    for _ in range(3):  # 열림으로 깎인 가장자리를 원래 후보 안에서 되살린다
        sk = cv2.dilate(sk.astype(np.uint8), ell(1)).astype(bool) & cand
    # 머리 가닥 사이로 보이는 좁은 피부: 지정한 곳에서는 20px 이상 후보 덩어리를 받아들인다
    loose = cand & poly_mask(SKIN_LOOSE, (H, W))
    n, cc, st, _ = cv2.connectedComponentsWithStats(loose.astype(np.uint8), connectivity=4)
    ok = np.zeros(n, bool)
    ok[1:] = st[1:, cv2.CC_STAT_AREA] >= 20
    return sk | ok[cc]


def fill_small_holes(m, max_area):
    holes = ndi.binary_fill_holes(m) & ~m
    n, cc, st, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=4)
    small = np.zeros(n, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] <= max_area
    return m | small[cc]


def absorb_small(label, min_area=30):
    """min_area보다 작은 조각을 가장 가까운 다른 영역 픽셀의 값으로 바꾼다."""
    out = label.copy()
    bad = np.zeros(label.shape, bool)
    for c in np.unique(label):
        n, cc, st, _ = cv2.connectedComponentsWithStats((label == c).astype(np.uint8), connectivity=4)
        small = np.zeros(n, bool)
        small[1:] = st[1:, cv2.CC_STAT_AREA] < min_area
        bad |= small[cc]
    if bad.any():
        _, (iy, ix) = ndi.distance_transform_edt(bad, return_indices=True)
        out[bad] = label[iy[bad], ix[bad]]
    return out


def segment(img, lab, P):
    H, W = lab.shape[:2]
    L = lab[..., 0] * 100 / 255
    shape = (H, W)
    # 확률을 살짝 펴서 픽셀 잡음을 줄인다
    Ps = np.stack([cv2.GaussianBlur(P[..., c], (0, 0), 1.0) for c in range(3)], -1)
    label = Ps.argmax(-1).astype(np.uint8)

    # 드레스는 범위 밖이거나 주변에 어두운 바탕이 적으면(분홍 조명) 아니다
    darkfrac = cv2.blur((L < 12).astype(np.float32), (21, 21))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    e = hessian_matrix_eigvals(hessian_matrix(gray, sigma=1.5, order='rc', use_gaussian_derivatives=False))
    blob = cv2.GaussianBlur(np.clip(-e[0], 0, None), (0, 0), 8) * 3000  # 스팽글 점 밀도
    notdress = ~poly_mask(DRESS_ENV, shape) | ((darkfrac < 0.35) & (blob < 8))
    alt = np.where(Ps[..., HAIR] > Ps[..., BG], HAIR, BG).astype(np.uint8)
    fix = (label == DRESS) & notdress
    label[fix] = alt[fix]

    sk = skin_mask(lab)
    ears = poly_mask(EARS, shape)
    # 얼굴: 머리 쪽 피부 덩어리 + 귀, 구멍(눈·입·눈썹)을 채운다
    n, cc = cv2.connectedComponents(sk.astype(np.uint8), connectivity=4)
    head = cc == cc[250, 900]
    face = head | ears | poly_mask(EYES, shape)
    face = cv2.morphologyEx(face.astype(np.uint8), cv2.MORPH_CLOSE, ell(4)).astype(bool)
    face = ndi.binary_fill_holes(face & poly_mask([FACE_CLIP], shape) | ears)
    face = select_face(face, ears)

    # 피부 전체: 가는 가닥(4px 이하)이 지나간 자리는 피부로 메운다
    skc = cv2.morphologyEx(sk.astype(np.uint8), cv2.MORPH_CLOSE, ell(2)).astype(bool)
    skin = sk | (skc & (label != DRESS)) | face
    skin = fill_small_holes(skin, 60)
    label[skin] = SKIN

    # 어깨끈과 가방
    strap = line_mask(STRAP_L, shape, 16) & (L < 45) & ~face
    strap = cv2.morphologyEx(strap.astype(np.uint8), cv2.MORPH_CLOSE, ell(1)).astype(bool)
    strapR = poly_mask([STRAP_R], shape) & ~skin
    label[strap] = DRESS
    label[strapR] = DRESS
    sash = poly_mask([SASH], shape) & ~skin
    label[sash] = DRESS

    # 드레스 위를 지나는 가는 머리 가닥은 드레스로
    dr = label == DRESS
    drc = cv2.morphologyEx(dr.astype(np.uint8), cv2.MORPH_CLOSE, ell(2)).astype(bool)
    label[drc & (label == HAIR)] = DRESS
    # 배경 위 1~2px 가닥은 배경으로
    hair = label == HAIR
    thin = hair & ~cv2.morphologyEx(hair.astype(np.uint8), cv2.MORPH_OPEN, ell(1)).astype(bool)
    bgfrac = cv2.blur((label == BG).astype(np.float32), (7, 7))
    label[thin & (bgfrac > 0.45)] = BG

    # 인물과 떨어진 머리카락 조각(흰 꽃가루·조명 반사)은 배경이다
    hair = (label == HAIR).astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(hair, connectivity=8)
    if n > 1:
        body = cv2.dilate(((label == SKIN) | (label == DRESS)).astype(np.uint8), ell(2)).astype(bool)
        main = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        touch = np.zeros(n, bool)
        touch[np.unique(cc[body])] = True
        stray = (np.arange(n) != main) & ~touch & (st[:, cv2.CC_STAT_AREA] < 5000)
        stray[0] = False
        label[stray[cc]] = BG

    label = absorb_small(label, 30)
    label[face] = SKIN
    return label, face, strap | strapR, sash


def select_face(face, ears):
    """머리 피부 덩어리는 목까지 이어져 있으므로 턱선(FACE_CLIP)에서 자른다."""
    face = face & poly_mask([FACE_CLIP], face.shape)
    n, cc = cv2.connectedComponents(face.astype(np.uint8), connectivity=4)
    return (cc == cc[250, 900]) | ears


# ── 파츠 ──────────────────────────────────────────────
def make_parts(label, face, strap, sash):
    shape = label.shape
    skin, dress = label == SKIN, label == DRESS
    parts = {}
    parts['faceHead'] = face
    arm_poly = poly_mask([PART_ARM_L], shape)
    waist = skin & poly_mask([PART_WAIST], shape) & ~face
    rest = skin & ~face & ~waist
    # 큰 팔: 힌트 다각형 안의 피부 중 팔 씨앗과 이어진 덩어리
    n, cc = cv2.connectedComponents((rest & arm_poly).astype(np.uint8), connectivity=8)
    arm_l = cc == cc[850, 420]
    rest &= ~arm_l
    n, cc = cv2.connectedComponents((rest & poly_mask([PART_ARM_R], shape)).astype(np.uint8), connectivity=8)
    ids = [i for i in np.unique(cc[1150:1254, 600:760]) if i > 0]
    arm_r = np.isin(cc, ids) if ids else np.zeros(shape, bool)
    rest &= ~arm_r
    n, cc = cv2.connectedComponents(rest.astype(np.uint8), connectivity=8)
    neck = cc == cc[620, 780]
    parts['neckChest'] = neck
    parts['armLeft'] = arm_l
    parts['armRight'] = arm_r
    parts['waist'] = waist
    parts['skinOther'] = rest & ~neck
    sash_p = dress & sash
    straps = dress & strap
    skirt = dress & poly_mask([PART_SKIRT], shape) & ~sash_p & ~straps
    parts['straps'] = straps
    parts['skirt'] = skirt
    parts['sash'] = sash_p
    parts['dressBody'] = dress & ~straps & ~skirt & ~sash_p
    return parts


# ── 윤곽 ──────────────────────────────────────────────
def rings(mask, eps=1.2, min_area=30):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area and len(c) < 40:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(ap) < 3:
            continue
        out.append([int(v) for v in ap.ravel()])
    return out


def raster(rs, shape):
    """evenodd로 채운다: 고리마다 따로 채우고 XOR."""
    acc = np.zeros(shape, np.uint8)
    for r in rs:
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [np.array(r, np.int32).reshape(-1, 2)], 1)
        acc ^= m
    return acc.astype(bool)


# ── 기준점 ────────────────────────────────────────────
def centroid(m):
    ys, xs = np.nonzero(m)
    return [int(round(xs.mean())), int(round(ys.mean()))]


def landmarks(img, lab, label, face, parts):
    H, W = label.shape
    L = lab[..., 0] * 100 / 255
    lm = {}
    # 눈동자: 눈 창 안의 어두운 붉은 갈색 덩어리(속눈썹 선보다 채도가 높다) 중심
    # 눈동자: 눈 다각형을 깎아 위 속눈썹 띠를 빼고 남은 어두운 픽셀의 중심
    for name, poly in zip(('eyeL', 'eyeR'), EYES):
        m = cv2.erode(poly_mask([poly], (H, W)).astype(np.uint8), ell(7)).astype(bool)
        ys, xs = np.nonzero(m & (L < 50))
        lm[name] = [int(round(xs.mean())), int(round(ys.mean()))]
    # 입: 얼굴 안, 피부가 아닌 큰 구멍(이·입안)의 중심
    sk = skin_mask(lab)
    hole = face & ~sk & poly_mask([[(820, 330), (980, 330), (980, 420), (820, 420)]], (H, W))
    n, cc, st, cen = cv2.connectedComponentsWithStats(hole.astype(np.uint8))
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    lm['mouth'] = [int(round(cen[k][0])), int(round(cen[k][1]))]
    ys, xs = np.nonzero(face & ~poly_mask(EARS, (H, W)))
    i = int(np.argmax(ys))
    lm['chin'] = [int(xs[i]), int(ys[i])]
    ear_c = [centroid(poly_mask([e], (H, W))) for e in EARS]
    lm['earL'], lm['earR'] = ear_c
    # 귀걸이: 귀 아래쪽의 회색·흰 반짝이 덩어리
    boxes = {'earringL': (722, 345, 760, 385), 'earringR': (1002, 400, 1035, 436)}
    for name, (x0, y0, x1, y1) in boxes.items():
        hs = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
        m = (hs[..., 1] < 70) & (hs[..., 2] > 90)
        if m.sum() < 5:
            m = np.ones(m.shape, bool)
        ys, xs = np.nonzero(m)
        lm[name] = [int(round(xs.mean())) + x0, int(round(ys.mean())) + y0]
    lm['noseTip'] = [915, 298]
    arm = parts['armLeft']
    ys, xs = np.nonzero(arm[:, 480:650])
    i = int(np.argmin(ys))
    lm['shoulderL'] = [int(xs[i]) + 480, int(ys[i])]
    lm['elbowL'] = [380, 1000]
    ys, xs = np.nonzero(parts['straps'] & (np.arange(W)[None, :] < 700))
    top, bot = int(np.argmin(ys)), int(np.argmax(ys))
    lm['strapL'] = [[int(xs[top]), int(ys[top])], [int(xs[bot]), int(ys[bot])]]
    # 네크라인: 드레스 몸판의 가슴 위쪽 경계 (x마다 피부 바로 아래 첫 드레스 픽셀)
    body = parts['dressBody']
    neck = []
    for x in range(590, 881, 10):
        col = body[700:900, x]
        sk_col = label[700:900, x] == SKIN
        ys_d = np.flatnonzero(col)
        if len(ys_d):
            # 피부 아래 이어지는 첫 드레스
            above = np.flatnonzero(sk_col)
            y = ys_d[ys_d > above.max()][0] if len(above) and (ys_d > above.max()).any() else ys_d[0]
            neck.append([x, int(y) + 700])
    ys = ndi.median_filter(np.array([p[1] for p in neck]), 3, mode='nearest')
    lm['neckline'] = [[p[0], int(y)] for p, y in zip(neck, ys)]
    lm['lights'] = find_lights(lab, label)
    return lm


def find_lights(lab, label):
    """밝은 조명 점(LIGHT_HINTS 근처)의 중심과 빛무리 반경.

    중심은 힌트 40px 안의 가장 밝은 고원 중심, 반경은 밝기가 (중심 + 주변 바탕)/2 아래로 떨어지는 거리.
    """
    L = cv2.GaussianBlur(lab[..., 0] * 100 / 255, (0, 0), 2)
    H, W = L.shape
    core = L > 90
    n, cc, st, cen = cv2.connectedComponentsWithStats(core.astype(np.uint8))
    out = []
    for hx, hy in LIGHT_HINTS:
        best, bd = None, 41
        for i in range(1, n):
            d = np.hypot(cen[i][0] - hx, cen[i][1] - hy)
            if d < bd and st[i, cv2.CC_STAT_AREA] >= 20:
                best, bd = i, d
        cx, cy = (cen[best][0], cen[best][1]) if best else (hx, hy)
        angs = np.linspace(0, 2 * np.pi, 24, endpoint=False)

        def ring(r):
            xs = np.clip((cx + r * np.cos(angs)).astype(int), 0, W - 1)
            ys = np.clip((cy + r * np.sin(angs)).astype(int), 0, H - 1)
            return L[ys, xs]
        base = float(np.median(ring(90)))
        peak = float(L[int(np.clip(cy, 0, H - 1)), int(np.clip(cx, 0, W - 1))])
        half = (peak + base) / 2
        r = 4
        while r < 120 and float(np.median(ring(r))) > half:
            r += 2
        out.append([int(round(cx)), int(round(cy)), int(r)])
    return out


# ── 팔레트 ────────────────────────────────────────────
def lab_to_hex(lab_pts):
    px = np.clip(np.round(lab_pts), 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    rgb = cv2.cvtColor(px, cv2.COLOR_LAB2RGB).reshape(-1, 3)
    return ['#%02x%02x%02x' % tuple(int(v) for v in c) for c in rgb]


def kmeans_palette(lab, mask, k=6):
    pts = lab[mask].reshape(-1, 3).astype(np.float32)
    rng = np.random.default_rng(1)
    if len(pts) > 60000:
        pts = pts[rng.choice(len(pts), 60000, replace=False)]
    cv2.setRNGSeed(1)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.2)
    _, lbl, cen = cv2.kmeans(pts, k, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    w = np.bincount(lbl.ravel(), minlength=k) / len(pts)
    order = np.argsort(cen[:, 0])
    hexes = lab_to_hex(cen[order])
    return [{'hex': h, 'w': round(float(w[i]), 3)} for h, i in zip(hexes, order)]


def median_hex(img, m):
    if m.sum() < 10:
        return '#000000'
    c = np.median(img[m].reshape(-1, 3), axis=0)
    return '#%02x%02x%02x' % (int(c[2]), int(c[1]), int(c[0]))


def palette(img, lab, label, face, parts):
    H, W = label.shape
    L = lab[..., 0] * 100 / 255
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hue = hsv[..., 0].astype(np.int32) * 2
    sat = hsv[..., 1]
    pal = {}
    for c in (SKIN, HAIR, DRESS, BG):
        pal[NAMES[c]] = kmeans_palette(lab, label == c)
    skin = label == SKIN
    sl = L[skin]
    named = {}
    named['skinLight'] = median_hex(img, skin & (L >= np.percentile(sl, 70)))
    named['skinMid'] = median_hex(img, skin & (L >= np.percentile(sl, 35)) & (L < np.percentile(sl, 65)))
    named['skinShadow'] = median_hex(img, skin & (L < np.percentile(sl, 15)) & (L > 40))
    cheeks = poly_mask([[(790, 275), (845, 275), (845, 310), (790, 310)],
                        [(985, 295), (1030, 295), (1030, 330), (985, 330)]], (H, W))
    named['blush'] = median_hex(img, cheeks & skin & (a > np.percentile(a[cheeks & skin], 60)))
    edges = cv2.Canny(img, 60, 160) > 0
    line = cv2.dilate(edges.astype(np.uint8), ell(1)).astype(bool) & (L < 25)
    line &= (label != BG) & (label != DRESS)
    named['lineArt'] = median_hex(img, line & (cv2.erode(face.astype(np.uint8), ell(3)) > 0)) \
        if (line & face).sum() > 50 else median_hex(img, line)
    hair = label == HAIR
    hl = L[hair]
    named['hairDark'] = median_hex(img, hair & (L < np.percentile(hl, 25)))
    named['hairMid'] = median_hex(img, hair & (L >= np.percentile(hl, 40)) & (L < np.percentile(hl, 60)))
    rim = hair & (L > np.percentile(hl, 85))
    named['hairRimWarm'] = median_hex(img, rim & ((hue < 40) | (hue > 350)) & (b > 5))
    named['hairRimPink'] = median_hex(img, rim & (hue > 290) & (hue <= 350))
    dress = label == DRESS
    dl = L[dress]
    named['dressBase'] = median_hex(img, dress & (L < np.percentile(dl, 50)))
    named['sequinBright'] = median_hex(img, dress & (L > np.percentile(dl, 95)))
    bg = label == BG
    named['bgIndigo'] = median_hex(img, bg & (hue >= 225) & (hue < 265) & (sat > 120) & (L < 45))
    named['bgMagenta'] = median_hex(img, bg & (hue >= 300) & (hue < 340) & (sat > 150) & (L > 35) & (L < 70))
    named['bgRed'] = median_hex(img, bg & ((hue >= 345) | (hue < 8)) & (sat > 170) & (L > 35))
    led = poly_mask([[(0, 350), (200, 350), (200, 560), (0, 560)], [(1100, 90), (1254, 90), (1254, 290),
                                                                     (1100, 290)]], (H, W))
    named['ledPink'] = median_hex(img, led & bg & (L > 60) & (hue >= 290))
    pal['named'] = named
    return pal


# ── 출력 ──────────────────────────────────────────────
def write_js(data, path):
    body = json.dumps(data, separators=(',', ':'))
    # 고리 배열은 길어서 줄바꿈을 조금 넣어 둔다
    body = body.replace('],[', '],\n[')
    with open(path, 'w') as f:
        f.write('// tools/analyze.py가 만든다. 직접 고치지 않는다.\n')
        f.write('// 원본 그림의 영역 윤곽(evenodd 고리), 파츠, 기준점, 팔레트. 좌표는 1254×1254 원본 픽셀.\n')
        f.write('(window.ConcertProc = window.ConcertProc || {}).data = ')
        f.write(body)
        f.write(';\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', help='확인용 겹침 이미지를 쓸 폴더')
    args = ap.parse_args()
    img = cv2.imread(REF)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    H, W = lab.shape[:2]
    P, _ = classify(img, lab)
    label, face, strap, sash = segment(img, lab, P)
    parts = make_parts(label, face, strap, sash)

    os.makedirs(OUT_MASK, exist_ok=True)
    masks = {NAMES[c]: label == c for c in (SKIN, HAIR, DRESS, BG)}
    masks['face'] = face
    for k, m in masks.items():
        cv2.imwrite(os.path.join(OUT_MASK, 'mask_%s.png' % k), (m * 255).astype(np.uint8))

    regions = {k: rings(masks[k]) for k in ('skin', 'face', 'hair', 'dress', 'bg')}
    part_rings = {k: rings(m) for k, m in parts.items()}
    data = {
        'version': 1,
        'size': [W, H],
        'regions': regions,
        'parts': part_rings,
        'landmarks': landmarks(img, lab, label, face, parts),
        'palette': palette(img, lab, label, face, parts),
    }
    write_js(data, OUT_JS)

    report = {'share': {k: round(float(m.mean()), 4) for k, m in masks.items()}}
    report['ringIoU'] = {}
    for k, rs in regions.items():
        r = raster(rs, (H, W))
        report['ringIoU'][k] = round(float((r & masks[k]).sum() / max(1, (r | masks[k]).sum())), 4)
    report['bytes'] = os.path.getsize(OUT_JS)
    print(json.dumps(report))
    if args.debug:
        debug_images(img, label, face, parts, data['landmarks'], args.debug)


def debug_images(img, label, face, parts, lm, out):
    os.makedirs(out, exist_ok=True)
    cols = np.array([[255, 120, 0], [0, 200, 255], [255, 0, 255], [0, 255, 0]], np.uint8)
    ov = (img * 0.55 + cols[label] * 0.45).astype(np.uint8)
    edge = np.zeros(label.shape, bool)
    edge[:-1] |= label[:-1] != label[1:]
    edge[:, :-1] |= label[:, :-1] != label[:, 1:]
    ov[edge] = (255, 255, 255)
    fe = face ^ cv2.erode(face.astype(np.uint8), ell(1)).astype(bool)
    ov[fe] = (0, 0, 255)
    for k, v in lm.items():
        if k in ('lights',):
            for x, y, r in v:
                cv2.circle(ov, (x, y), r, (255, 255, 255), 1)
                cv2.drawMarker(ov, (x, y), (0, 0, 255), cv2.MARKER_CROSS, 10, 2)
        elif k in ('neckline', 'strapL'):
            cv2.polylines(ov, [np.array(v, np.int32)], False, (0, 0, 255), 2)
        else:
            cv2.drawMarker(ov, tuple(v), (0, 0, 255), cv2.MARKER_CROSS, 12, 2)
    cv2.imwrite(os.path.join(out, 'ov.png'), ov)
    pc = np.zeros(img.shape, np.uint8)
    rng = np.random.default_rng(3)
    for k, m in parts.items():
        pc[m] = rng.integers(60, 255, 3)
    cv2.imwrite(os.path.join(out, 'parts.png'), (img * 0.4 + pc * 0.6).astype(np.uint8))


if __name__ == '__main__':
    main()
