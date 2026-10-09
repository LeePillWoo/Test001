#!/usr/bin/env python3
"""절차적 face 레이어가 쓸 얼굴 윤곽 기하를 원본에서 잰다. (색은 내보내지 않는다)

    python3 concert/tools/proc_face.py [--debug DIR]

출력
    js/procedural/data/face.js   window.ConcertProc.faceData

잰 것
    head      얼굴 피부 윤곽(귀 제외). 머리카락이 덮는 쪽은 4픽셀 넓혀 이음매 틈을 막는다.
    contour   보이는 턱선·볼선 위의 점과 그 자리의 선 굵기 [x, y, w, ...]
    mouthDark 입 안 어두운 구석(입술 영역 안의 어두운 색)
    noseHl    콧등 하이라이트
    metal     인이어·귀걸이 금속 부분 윤곽 (귀마다)
모두 색 임계로 고른 영역을 흐림·문턱으로 다듬은 뒤 단순화한 다각형이다. 같은 입력이면 같은 결과.
"""
import argparse
import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
MASK_FACE = os.path.join(HERE, 'analysis', 'mask_face.png')
OUT_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'face.js')

# 귀 자리(analyze.py와 같은 힌트) — 얼굴 피부에서 뺀다
EARS = [
    [(722, 284), (742, 282), (755, 292), (762, 310), (764, 368), (752, 372), (745, 380), (735, 380),
     (727, 368), (719, 352), (712, 333), (710, 310), (713, 293)],
    [(1018, 351), (1035, 347), (1048, 359), (1054, 380), (1051, 398), (1041, 410), (1031, 418),
     (1026, 433), (1011, 434), (1005, 421), (1002, 405), (1004, 385), (1010, 365)],
]
# 윤곽선이 드러나는 곳(볼·턱·오른쪽 턱). 여기서는 피부를 넓히지 않고 선을 잰다.
VISIBLE = [(745, 280), (790, 280), (800, 330), (880, 420), (960, 400), (1000, 330), (1030, 300),
           (1060, 330), (1060, 420), (1000, 470), (880, 500), (800, 470), (740, 400)]
MOUTH_BOX = (818, 326, 962, 420)
NOSE_BOX = (905, 262, 935, 306)
METAL_BOX = [(715, 300, 760, 382), (1000, 362, 1045, 436)]


def poly_mask(polys, shape):
    m = np.zeros(shape, np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m.astype(bool)


def box_mask(box, shape):
    m = np.zeros(shape, bool)
    x0, y0, x1, y1 = box
    m[y0:y1, x0:x1] = True
    return m


def smooth(mask, sigma):
    return cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma) > 0.5


def rings(mask, eps=0.8, min_area=6, sigma=1.0):
    """마스크 → 단순화한 바깥 윤곽들 [[x, y, ...], ...] (넓이 큰 것부터)"""
    m = smooth(mask, sigma) if sigma else mask
    cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
    out = []
    for c in cnts:
        if cv2.contourArea(c) < min_area:
            continue
        a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        out.append([int(v) for v in a.reshape(-1)])
    return out


def biggest(mask):
    n, lbl, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return mask
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    return lbl == i


def fill_holes(mask):
    m = mask.astype(np.uint8)
    h, w = m.shape
    ff = m.copy()
    pad = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, pad, (0, 0), 1)
    return mask | (ff == 0)


def smooth1d(v, sigma, closed):
    """곡선을 따라 가우스 흐림 (닫힌 곡선이면 둘러 감는다)"""
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    mode = 'wrap' if closed else 'edge'
    pad = np.pad(v, [(r, r)] + [(0, 0)] * (v.ndim - 1), mode=mode)
    if v.ndim == 1:
        return np.convolve(pad, k, mode='valid')
    return np.stack([np.convolve(pad[:, i], k, mode='valid') for i in range(v.shape[1])], 1)


def trace_line(L, head, c, idx):
    """윤곽점 c[idx]마다 바깥 법선을 따라 가장 어두운 선의 중심과 굵기를 잰다."""
    cs = smooth1d(c.astype(np.float64), 4.0, True)
    tan = np.roll(cs, -2, 0) - np.roll(cs, 2, 0)
    nrm = np.stack([tan[:, 1], -tan[:, 0]], 1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    # 바깥쪽을 향하게
    h, w = L.shape
    probe = cs[idx] + nrm[idx] * 4
    pi = np.clip(np.round(probe).astype(int), 0, [w - 1, h - 1])
    if head[pi[:, 1], pi[:, 0]].mean() > 0.5:
        nrm = -nrm
    ts = np.arange(-8, 6.01, 0.5)
    offs, widths = [], []
    for j in idx:
        q = cs[j][None, :] + nrm[j][None, :] * ts[:, None]
        prof = cv2.remap(L, q[:, 0].astype(np.float32).reshape(1, -1), q[:, 1].astype(np.float32).reshape(1, -1),
                         cv2.INTER_LINEAR).ravel()
        skin = np.percentile(prof[ts < -3], 80)
        dark = skin - prof
        k = int(np.argmax(dark))
        if dark[k] < 15:
            offs.append(np.nan)
            widths.append(0.0)
            continue
        half = dark[k] * 0.5
        lo = k
        while lo > 0 and dark[lo - 1] > half:
            lo -= 1
        hi = k
        while hi < len(ts) - 1 and dark[hi + 1] > half:
            hi += 1
        offs.append((ts[lo] + ts[hi]) / 2)
        widths.append((ts[hi] - ts[lo] + 0.5) * min(1.0, dark[k] / 60))
    offs = np.array(offs)
    widths = np.array(widths)
    # 빈 곳은 이웃 값으로 메우고, 튀는 값은 중앙값으로 누른 뒤 곡선을 따라 흐린다
    ok = ~np.isnan(offs)
    if ok.sum() < 3:
        return None
    ii = np.arange(len(offs))
    offs = np.interp(ii, ii[ok], offs[ok])
    from scipy.ndimage import median_filter
    offs = smooth1d(median_filter(offs, 7, mode='nearest'), 3.0, False)
    # 선 밖이 바로 어두운 머리카락이면 폭이 부풀므로 위쪽을 자른다
    widths = smooth1d(np.clip(median_filter(widths, 7, mode='nearest'), 0.8, 3.4), 3.0, False)
    pts = cs[idx] + nrm[idx] * offs[:, None]
    return pts, widths, nrm[idx]


def head_parts(face, L):
    shape = face.shape
    ears = poly_mask(EARS, shape)
    vis = poly_mask([VISIBLE], shape)
    head = smooth(fill_holes(biggest(face & ~ears)), 1.5)
    # 머리카락이 덮는 쪽(보이는 윤곽과 귀 밖)만 4픽셀 넓힌다: 이음매에 틈이 안 생기게
    grow = cv2.dilate(head.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    head_big = smooth(head | (grow & ~vis & ~ears), 1.5)

    # 보이는 윤곽: 얼굴 경계 중 VISIBLE 안의 연속 구간 → 선화 중심선
    cnts, _ = cv2.findContours(head_big.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea).reshape(-1, 2)
    keep = np.array([vis[y, x] for x, y in c])
    start = int(np.argmin(keep))
    c = np.roll(c, -start, axis=0)
    keep = np.roll(keep, -start)
    run = np.nonzero(keep)[0]
    res = trace_line(L, head_big, c, run)
    lines = []
    poly = c.astype(np.float64)
    if res is not None:
        pts, widths, nrm = res
        # 얼굴 피부는 선의 바깥 가장자리까지 (선이 이음매를 덮는다)
        poly[run] = pts + nrm * (np.maximum(widths, 1.0)[:, None] * 0.5)
        step = 4
        sel = list(range(0, len(run), step))
        if sel[-1] != len(run) - 1:
            sel.append(len(run) - 1)
        out = []
        for k in sel:
            out += [round(float(pts[k][0]), 1), round(float(pts[k][1]), 1), round(float(widths[k]), 2)]
        lines.append(out)
    poly_i = cv2.approxPolyDP(np.round(poly).astype(np.int32).reshape(-1, 1, 2), 1.0, True).reshape(-1)
    return [int(v) for v in poly_i], lines, head_big


def mouth_parts(L, A, C, shape):
    roi = box_mask(MOUTH_BOX, shape)
    lips = biggest(smooth(roi & (A > 24), 1.2))
    lips = smooth(fill_holes(lips), 2.0)
    dark = smooth(roi & (L < 42) & lips, 1.2)
    return lips, dark


def metal_parts(L, B, shape):
    out = []
    for box in METAL_BOX:
        roi = box_mask(box, shape)
        m = roi & (B < 4) & (L > 30)
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
        out.append(m)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug')
    args = ap.parse_args()
    img = cv2.imread(REF)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0] * 100 / 255
    A = lab[..., 1] - 128
    B = lab[..., 2] - 128
    C = np.sqrt(A * A + B * B)
    shape = L.shape
    face = cv2.imread(MASK_FACE, 0) > 127
    head_poly, contour, head = head_parts(face, L)
    lips, dark = mouth_parts(L, A, C, shape)
    nose = biggest(smooth(box_mask(NOSE_BOX, shape) & (L > 93), 1.6))
    metals = metal_parts(L, B, shape)

    data = {
        'head': head_poly,
        'contour': contour,
        'mouthDark': rings(dark, eps=0.7, min_area=8, sigma=0),
        'noseHl': rings(nose, eps=0.7, sigma=0)[0],
        'metal': [rings(m, eps=0.6, min_area=10, sigma=0.9) for m in metals],
    }
    body = json.dumps(data, separators=(',', ':'))
    body = body.replace('],[', '],\n[').replace(']],"', ']],\n"')
    with open(OUT_JS, 'w') as f:
        f.write('// tools/proc_face.py가 만든다. 직접 고치지 않는다.\n')
        f.write('// 얼굴 피부·턱선·입·콧등·인이어 금속의 윤곽(좌표만, 1254×1254 원본 픽셀).\n')
        f.write('(window.ConcertProc = window.ConcertProc || {}).faceData = ' + body + ';\n')
    print('wrote', OUT_JS, os.path.getsize(OUT_JS), 'bytes')

    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
        vis = img.copy()
        cols = [(0, 255, 0), (255, 0, 255), (0, 255, 255), (255, 128, 0), (0, 0, 255), (255, 255, 0)]
        for i, m in enumerate([head, lips, dark, nose] + metals):
            cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            cv2.drawContours(vis, cnts, -1, cols[i % len(cols)], 1)
        for seg in contour:
            for k in range(0, len(seg), 3):
                cv2.circle(vis, (int(seg[k]), int(seg[k + 1])), max(1, int(round(seg[k + 2]))), (0, 0, 255), -1)
        crop = vis[80:500, 640:1100]
        cv2.imwrite(os.path.join(args.debug, 'proc_face_debug.png'),
                    cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))


if __name__ == '__main__':
    main()
