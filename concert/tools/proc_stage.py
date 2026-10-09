#!/usr/bin/env python3
"""stage 레이어용 측정 도우미: 원본에서 응원봉·빛 점의 '기하'만 잰다 (색 화소는 내보내지 않는다).

    python3 concert/tools/proc_stage.py sticks      # 관객석 응원봉: 양 끝점과 굵기
    python3 concert/tools/proc_stage.py lights      # 배경의 밝은 점 조명: 중심과 반지름
    python3 concert/tools/proc_stage.py glows       # 관객석의 붉은 빛 번짐: 중심과 두 반지름, 기울기
    python3 concert/tools/proc_stage.py crowd       # 관객 실루엣(어두운 덩어리): 깊이별 중심과 두 반지름, 기울기
    python3 concert/tools/proc_stage.py panel       # 왼쪽 큰 LED 판: 가장자리 점들과 밝은 도트(글자 획) 지도
    python3 concert/tools/proc_stage.py truss       # 큰 트러스 가운데 선을 따라 법선 방향 DoG 단면: 띠의 폭과 치우침
    python3 concert/tools/proc_stage.py lines       # 트러스 구간별로 가장 강한 밝은 직선(기울기·높이) 후보
    python3 concert/tools/proc_stage.py fan         # (430,215) 조명 오른쪽 남보라 부채의 위·아래 가장자리
    python3 concert/tools/proc_stage.py gaps        # 왼쪽 머리 덩어리 틈의 파란 빛: 칸 지도와 가운데 선

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


def hair_mask(shape):
    mask = os.path.join(HERE, 'analysis', 'mask_hair.png')
    if os.path.exists(mask):
        return np.asarray(Image.open(mask).convert('L')) > 127
    return np.zeros(shape, bool)


def bg_mask(shape):
    mask = os.path.join(HERE, 'analysis', 'mask_bg.png')
    if os.path.exists(mask):
        return np.asarray(Image.open(mask).convert('L')) > 127
    return np.ones(shape, bool)


def crowd(im):
    """어두운 덩어리를 깊이별로: 2 가까운 줄(아주 어둡다), 1 가운데 줄, 0 먼 줄(주변보다 어두운 머리)."""
    bg = bg_mask(im.shape[:2])
    lum = cv2.GaussianBlur(im.mean(-1), (0, 0), 2.5)
    local = lum - cv2.GaussianBlur(lum, (0, 0), 15)
    levels = [
        (2, lum < 45),
        (1, (lum >= 45) & (lum < 60)),
        (0, (lum >= 60) & (lum < 85) & (local < -10)),
    ]
    out = []
    for depth, sel in levels:
        for (x0, y0, x1, y1) in CROWD_BOXES:
            sub = (sel & bg)[y0:y1, x0:x1].astype(np.uint8)
            sub = cv2.morphologyEx(sub, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
            n, lab, st, _ = cv2.connectedComponentsWithStats(sub)
            for i in range(1, n):
                if st[i, 4] < 250:
                    continue
                ys, xs = np.where(lab == i)
                pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
                (cx, cy), (w, h), ang = cv2.minAreaRect(pts)
                ell = [round(cx), round(cy), round(w / 2), round(h / 2), round(ang)]
                out.append((depth, int(st[i, 4]), ell))
    out.sort(key=lambda o: (-o[0], -o[1]))
    for depth, area, s in out:
        print('    [%d, %d, %d, %d, %d, %d],  // %d' % (*s, depth, area))


def panel(im):
    """왼쪽 큰 LED 판: 판(분홍~흰 도트)이 차지하는 줄마다 왼쪽·오른쪽 끝, 그리고 흰 도트(글자 획) 지도.
    흰 도트는 초록 채널이 높다(분홍 바탕 도트는 초록이 낮다)."""
    b = cv2.GaussianBlur(im, (0, 0), 4)
    on = (b[..., 0] > 190) & (b[..., 2] < b[..., 0] + 8)
    print('// 판 윤곽: y, 판이 시작하는 x, 끝나는 x (x<300)')
    for y in range(370, 570, 8):
        xs = np.where(on[y, :300])[0]
        if len(xs):
            print('//  %d: %d..%d' % (y, xs.min(), xs.max()))
    g = b[..., 1]
    print('// 흰 도트 지도 (5px 칸, # 아주 밝음, + 밝음, . 중간): x 0..260, y 350..600')
    for y in range(350, 600, 6):
        row = ''.join('#' if g[y, x] > 150 else '+' if g[y, x] > 110 else '.' if g[y, x] > 70 else ' '
                      for x in range(0, 260, 5))
        print('// %4d %s' % (y, row))


# stage.js 큰 트러스의 가운데 선 (TRUSSES[0].pts)
TRUSS_PTS = [(40, 238), (150, 214), (250, 190), (330, 158), (420, 119), (520, 68), (610, 24), (700, -22),
             (740, -42)]


def truss(im):
    """큰 트러스 가운데 선(TRUSS_PTS)을 따라가며 법선 방향 DoG 단면을 구간별로 평균한다.
    +오프셋은 위쪽(위 현 방향), -오프셋은 아래. 값이 큰 오프셋 범위가 띠(두 현과 격자)가 차지하는 폭이다."""
    from scipy.ndimage import map_coordinates
    gray = im.mean(-1)
    dog = cv2.GaussianBlur(gray, (0, 0), 1.2) - cv2.GaussianBlur(gray, (0, 0), 4)
    pts = np.array(TRUSS_PTS, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    tot = seg.sum()

    def at(s):
        d = s * tot
        i = 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        p = pts[i] + (pts[i + 1] - pts[i]) * (d / seg[i])
        u = (pts[i + 1] - pts[i]) / seg[i]
        return p, np.array([u[1], -u[0]])

    offs = np.arange(-50, 51, 4)
    ranges = [(0.05, 0.2), (0.2, 0.35), (0.35, 0.5), (0.5, 0.65), (0.65, 0.8), (0.8, 0.92)]
    prof = []
    for s0, s1 in ranges:
        acc = np.zeros(len(offs))
        for s in np.linspace(s0, s1, 60):
            p, n = at(s)
            xy = p[None, :] + n[None, :] * offs[:, None]
            acc += np.abs(map_coordinates(dog, [xy[:, 1], xy[:, 0]], order=1, mode='nearest'))
        prof.append(acc / 60)
    print('// off ' + ' '.join('s%.2f-%.2f' % r for r in ranges))
    for i, o in enumerate(offs):
        print('// %4d ' % o + ' '.join('%9.1f' % prof[k][i] for k in range(len(ranges))))


def lines(im):
    """트러스가 지나는 세 x 구간마다, 머리카락 밖에서 가장 강하게 밝은 직선 y = y0 + k(x - 60)을 찾는다.
    광각이라 구간마다 기울기가 달라진다: 같은 트러스의 현이 구간을 따라 이어지는지 보고 가운데 선과 폭을 정했다."""
    gray = im.mean(-1)
    d = cv2.GaussianBlur(gray, (0, 0), 1.5) - cv2.GaussianBlur(gray, (0, 0), 8)
    hair = hair_mask(d.shape)
    for xa, xb in ((100, 330), (330, 520), (520, 700)):
        xs = np.arange(xa, xb)
        cand = []
        for k in np.arange(-0.50, -0.20, 0.005):
            for y0 in np.arange(150, 320, 1.0):
                ys = np.round(y0 + k * (xs - 60)).astype(int)
                ok = (ys >= 0) & (ys < d.shape[0])
                if ok.sum() < 50:
                    continue
                m = ~hair[ys[ok], xs[ok]]
                if m.sum() < 50:
                    continue
                cand.append((float(d[ys[ok][m], xs[ok][m]].mean()), k, y0))
        cand.sort(reverse=True)
        picked = []
        xm = (xa + xb) / 2
        for v, k, y0 in cand:
            if all(abs((y0 + k * (xm - 60)) - (q[2] + q[1] * (xm - 60))) > 12 for q in picked):
                picked.append((v, k, y0))
            if len(picked) >= 5:
                break
        print('// x %d..%d' % (xa, xb))
        for v, k, y0 in picked:
            print('//   세기 %5.1f  기울기 %.3f  (%d, %.0f) → (%d, %.0f)' % (
                v, k, xa, y0 + k * (xa - 60), xb, y0 + k * (xb - 60)))


def lab_of(im):
    return cv2.cvtColor((im / 255.0).astype(np.float32), cv2.COLOR_RGB2LAB)


def fan(im):
    """(430,215) 조명 오른쪽의 남보라 띠: 열마다 b*가 -45보다 낮은(푸른) 머리카락 밖 행의 위·아래 끝."""
    b = cv2.GaussianBlur(lab_of(im)[..., 2], (0, 0), 3)
    hair = hair_mask(b.shape)
    for x in range(460, 680, 20):
        ys = [y for y in range(160, 260) if b[y, x] < -45 and not hair[y, x]]
        if ys:
            ang = np.degrees(np.arctan2((ys[0] + ys[-1]) / 2 - 215, x - 430))
            print('//  x %d: y %d..%d  (가운데 방향 %.1f°)' % (x, ys[0], ys[-1], ang))


def gaps(im):
    """왼쪽 머리 덩어리 틈의 파란 빛(파랑이 빨강보다 뚜렷이 큰 화소): 6px 칸 지도와 20px 열마다의 가운데 y."""
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    blue = (b > 120) & (b > r + 10)
    x0, y0, x1, y1 = 420, 360, 640, 480
    for y in range(y0, y1, 6):
        cells = [blue[y:y + 6, x:x + 6].mean() for x in range(x0, x1, 6)]
        row = ''.join('#' if c > 0.5 else '+' if c > 0.15 else '.' for c in cells)
        print('// %4d %s' % (y, row))
    for x in range(x0, x1, 20):
        ys = np.where(blue[y0:y1, x:x + 20].any(1))[0]
        if len(ys) >= 3:
            print('//  x %d..%d: 가운데 y %.0f (%d px 행)' % (x, x + 20, np.median(ys) + y0, len(ys)))


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'sticks'
    jobs = {
        'sticks': sticks, 'lights': lights, 'glows': glows, 'crowd': crowd, 'panel': panel,
        'truss': truss, 'lines': lines, 'fan': fan, 'gaps': gaps,
    }
    jobs[what](load())
