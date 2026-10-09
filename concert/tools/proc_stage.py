#!/usr/bin/env python3
"""stage 레이어용 측정 도우미: 원본에서 응원봉·빛 점의 '기하'만 잰다 (색 화소는 내보내지 않는다).

    python3 concert/tools/proc_stage.py sticks      # 관객석 응원봉: 양 끝점과 굵기
    python3 concert/tools/proc_stage.py lights      # 배경의 밝은 점 조명: 중심과 반지름
    python3 concert/tools/proc_stage.py glows       # 관객석의 붉은 빛 번짐: 중심과 두 반지름, 기울기
    python3 concert/tools/proc_stage.py crowd       # 관객 실루엣(어두운 덩어리): 중심과 두 반지름, 기울기

출력은 stage.js에 옮겨 적을 수 있는 JS 배열 문자열이다. 같은 입력이면 언제나 같은 출력.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')

# 관객석 영역 (x0, y0, x1, y1) — 인물 바깥
CROWD_BOXES = [(0, 540, 300, 930), (1090, 940, 1254, 1254)]


def load():
    return np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)


def sticks(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    # 응원봉 심: 밝고(빨강·파랑 높음) 초록도 어느 정도 있는 흰분홍
    core = (r > 215) & (g > 120) & (b > 160)
    core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    out = []
    for (x0, y0, x1, y1) in CROWD_BOXES:
        sub = core[y0:y1, x0:x1]
        n, lab, st, _ = cv2.connectedComponentsWithStats(sub)
        for i in range(1, n):
            if st[i, 4] < 60:
                continue
            ys, xs = np.where(lab == i)
            pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
            (cx, cy), (w, h), ang = cv2.minAreaRect(pts)
            if w < h:
                w, h = h, w
                ang += 90
            if w < 1.6 * h:
                continue
            a = np.deg2rad(ang)
            dx, dy = np.cos(a) * w / 2, np.sin(a) * w / 2
            p0 = (cx - dx, cy - dy)
            p1 = (cx + dx, cy + dy)
            # 아래쪽 끝(손)을 먼저
            if p0[1] < p1[1]:
                p0, p1 = p1, p0
            seg = [round(p0[0]), round(p0[1]), round(p1[0]), round(p1[1]), round(h + 4)]
            out.append((int(st[i, 4]), seg))
    out.sort(key=lambda o: -o[0])
    for area, s in out:
        print('    [%d, %d, %d, %d, %d],  // %d' % (*s, area))


def lights(im):
    gray = im.mean(-1)
    loc = gray - cv2.GaussianBlur(gray, (0, 0), 12)
    m = ((loc > 40) & (gray > 200)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    rows = []
    for i in range(1, n):
        if st[i, 4] < 30:
            continue
        x, y, w, h, a = st[i]
        if w > 3 * h or h > 3 * w:
            continue
        rows.append((a, round(cen[i][0]), round(cen[i][1]), round(np.sqrt(a / np.pi))))
    rows.sort(key=lambda r: -r[0])
    for a, x, y, r in rows[:60]:
        print('    [%d, %d, %d],' % (x, y, r))


def glows(im):
    r, g, b = [cv2.GaussianBlur(im[..., k], (0, 0), 3) for k in range(3)]
    red = ((r > 190) & (g < 90) & (b < 170)).astype(np.uint8)
    out = []
    for (x0, y0, x1, y1) in CROWD_BOXES:
        sub = red[y0:y1, x0:x1]
        n, lab, st, _ = cv2.connectedComponentsWithStats(sub)
        for i in range(1, n):
            if st[i, 4] < 80:
                continue
            ys, xs = np.where(lab == i)
            pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
            (cx, cy), (w, h), ang = cv2.minAreaRect(pts)
            out.append((int(st[i, 4]), [round(cx), round(cy), round(w / 2), round(h / 2), round(ang)]))
    out.sort(key=lambda o: -o[0])
    for area, s in out[:40]:
        print('    [%d, %d, %d, %d, %d],  // %d' % (*s, area))


def crowd(im):
    mask = os.path.join(HERE, 'analysis', 'mask_bg.png')
    if os.path.exists(mask):
        bg = np.asarray(Image.open(mask).convert('L')) > 127
    else:
        bg = np.ones(im.shape[:2], bool)
    lum = cv2.GaussianBlur(im.mean(-1), (0, 0), 4)
    out = []
    for (x0, y0, x1, y1) in CROWD_BOXES:
        sub = ((lum < 70) & bg)[y0:y1, x0:x1].astype(np.uint8)
        sub = cv2.morphologyEx(sub, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(sub)
        for i in range(1, n):
            if st[i, 4] < 150:
                continue
            ys, xs = np.where(lab == i)
            pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
            (cx, cy), (w, h), ang = cv2.minAreaRect(pts)
            out.append((int(st[i, 4]), [round(cx), round(cy), round(w / 2), round(h / 2), round(ang)]))
    out.sort(key=lambda o: -o[0])
    for area, s in out:
        print('    [%d, %d, %d, %d, %d],  // %d' % (*s, area))


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'sticks'
    {'sticks': sticks, 'lights': lights, 'glows': glows, 'crowd': crowd}[what](load())
