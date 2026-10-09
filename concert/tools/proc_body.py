#!/usr/bin/env python3
"""body 레이어용 측정 도우미: 원본에서 몸·드레스의 '기하'만 잰다 (색 화소는 내보내지 않는다).

    python3 concert/tools/proc_body.py [--debug DIR]

출력: js/procedural/data/body.js  (window.ConcertProc.bodyData)
    shapes   부위별 윤곽(evenodd 고리). 보이는 곳은 분석 마스크(tools/analysis)의 경계를 따른다.
             얼굴·드레스·팔처럼 반드시 위에 그려지는 것 밑으로는 손으로 잰 보충 다각형만큼 이어 그리고,
             머리카락 밑으로는 몇 px만 넓힌다(뒷머리는 hair 레이어가 몸 밑까지 이어 그린다).
    edges    윤곽 가운데 실제로 보이는 구간(먹선을 그을 곳). 위 레이어가 덮는 구간은 뺀다.
    bands    피부 부위별 명암 단계 모양(하이라이트, 셀 그림자 1~4단의 경계선). 원본 피부의 밝기 축을
             몇 단계로 나눈 경계만 남기고 부드럽게 다듬는다. 가린 곳은 주변 단계를 이어 칠한다(inpaint).
             단계별 색은 body.js의 팔레트가 정한다.
    strapL   왼쪽 어깨끈 중심선
같은 입력이면 언제나 같은 출력이 나온다.
"""
import argparse
import json
import os

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
MASKS = os.path.join(HERE, 'analysis')
ANALYSIS_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'analysis.js')
OUT_JS = os.path.join(HERE, '..', 'js', 'procedural', 'data', 'body.js')

# ── 손으로 잰 다각형 (원본 픽셀 좌표) ──────────────────────
# part: 이 안의 같은 종류(피부/드레스) 화소가 그 부위다 — 같은 종류 부위끼리의 경계를 정한다.
# ext:  가려진 곳(hide)과 겹치는 만큼 부위를 넓힌다 — 머리카락 밑으로 이어지는 몸.
# 왼쪽 어깨끈 중심선(팔과 몸통의 경계)
STRAP_L = [(641, 470), (651, 510), (658, 535), (661, 570), (657, 600), (647, 630), (633, 670), (623, 690),
           (608, 710), (591, 730), (582, 745)]
COMPS = {
    'torso': dict(
        kind='skin',
        part=[(655, 380), (1010, 380), (1010, 880), (600, 880), (585, 748)] + STRAP_L[::-1],
        ext=[(705, 390), (965, 395), (978, 470), (1003, 560), (1018, 660), (1008, 760), (962, 830),
             (900, 862), (600, 856), (566, 760), (596, 700), (622, 640), (634, 560), (628, 482), (676, 440)],
        hide=('hair', 'face', 'straps', 'dress', 'arm'),
        close=9,
        soft=4.5,  # 명암 경계 다듬기(가슴은 부드럽게)
        outline=4.5,  # 가슴 오른쪽은 가닥 사이로 피부가 비친다: 가닥 단위 굴곡은 버린다
        hi=False,
        eps=2.2,  # 각진 셀 그림자
        simplify=3,
    ),
    'arm': dict(
        kind='skin',
        part=[(420, 430)] + STRAP_L + [(560, 790), (500, 930), (470, 1080), (450, 1254), (150, 1254),
                                       (298, 1000), (318, 950), (345, 840), (380, 700), (410, 560)],
        ext=[(445, 560), (468, 503), (520, 468), (566, 458), (612, 464), (646, 480), (656, 540), (520, 560)],
        hide=('hair', 'straps'),
        close=9,
    ),
    'waist': dict(
        kind='skin',
        part=[(170, 830), (350, 830), (322, 950), (300, 1002), (280, 1002), (165, 880)],
        ext=[(176, 868), (215, 850), (262, 842), (346, 836), (322, 955), (300, 1000), (288, 994)],
        hide=('hair',),
        close=7,
        soft=2.6,
    ),
    'fore': dict(
        kind='skin',
        part=[(540, 1254), (600, 1120), (700, 960), (930, 900), (930, 1254)],
        ext=[(556, 1254), (606, 1140), (660, 1060), (712, 990), (800, 890), (900, 800), (985, 735),
             (1045, 770), (1010, 860), (930, 950), (840, 1050), (760, 1150), (700, 1254)],
        hide=('hair',),
        close=7,
        soft=3.0,
        min_edge=60,
        hi=False,
    ),
    'dress': dict(
        kind='dress',
        part=[(500, 690), (590, 735), (700, 760), (950, 690), (1010, 780), (960, 1010), (720, 1008),
              (640, 1030), (570, 1052), (556, 1100), (560, 1254), (255, 1254), (400, 950)],
        ext=[(540, 735), (600, 752), (700, 790), (860, 790), (928, 716), (985, 760), (962, 880),
             (905, 975), (770, 1006), (640, 1030), (570, 1052), (556, 1100), (560, 1254), (262, 1254),
             (420, 900), (480, 780)],
        hide=('hair', 'arm', 'straps'),
        close=9,
    ),
    'skirt': dict(
        kind='dress',
        part=[(0, 880), (166, 850), (186, 866), (300, 985), (345, 905), (420, 905), (262, 1254), (0, 1254)],
        ext=[(0, 905), (170, 862), (300, 988), (338, 940), (392, 980), (265, 1254), (0, 1254)],
        hide=('hair', 'arm', 'sashPart', 'waist'),
        close=7,
    ),
    'sash': dict(
        kind='dress',
        part=[(0, 820), (165, 820), (190, 852), (150, 880), (128, 892), (110, 925), (82, 962), (40, 990),
              (0, 998)],
        ext=[(0, 902), (40, 878), (80, 856), (118, 838), (160, 832), (178, 850), (150, 872), (128, 884),
             (110, 920), (82, 958), (40, 986), (0, 994)],
        hide=('hair',),
        close=5,
    ),
}
ORDER = ['arm', 'torso', 'waist', 'fore', 'dress', 'skirt', 'sash']
SKIN_COMPS = ['torso', 'arm', 'waist', 'fore']
# 머리카락 밑으로 넓히는 폭(px). hair 레이어는 뒷머리를 몸 밑으로 18px 이어 그리므로(이음새 담당),
# 몸은 머리카락을 덮지 않도록 안티에일리어싱 폭만큼만 넓힌다.
MARGIN = 3
# 그림자 단계 수 (하이라이트·바탕 위에 BANDS단)
BANDS = 4


def ell(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def poly(pts, shape):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32).reshape(-1, 2)], 1)
    return m.astype(bool)


def raster(rs, shape):
    acc = np.zeros(shape, np.uint8)
    for r in rs:
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [np.array(r, np.int32).reshape(-1, 2)], 1)
        acc ^= m
    return acc.astype(bool)


def load_analysis():
    src = open(ANALYSIS_JS).read()
    i = src.index('.data = ') + len('.data = ')
    return json.loads(src[i:src.rindex(';')])


def load_mask(name):
    return cv2.imread(os.path.join(MASKS, 'mask_%s.png' % name), cv2.IMREAD_GRAYSCALE) > 127


def smooth(m, sigma=1.6, min_area=120):
    """가장자리를 부드럽게 하고 작은 조각·구멍을 없앤다."""
    f = cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma) > 0.5
    n, lab, st, _ = cv2.connectedComponentsWithStats(f.astype(np.uint8), 8)
    keep = np.zeros_like(f)
    for i in range(1, n):
        if st[i, 4] >= min_area:
            keep |= lab == i
    # 작은 구멍 메우기
    inv = ~keep
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv.astype(np.uint8), 4)
    for i in range(1, n):
        if st[i, 4] < min_area:
            keep |= lab == i
    return keep


def rings(mask, eps=1.0, min_area=40, pad=16):
    """evenodd 고리. 화면 가장자리에 닿은 부위는 바깥으로 pad만큼 늘려 잰다 → 다듬어도 모서리가 안 깎인다."""
    mp = cv2.copyMakeBorder(mask.astype(np.uint8), pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    cs, _ = cv2.findContours(mp, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < min_area:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2) - pad
        if len(ap) < 3:
            continue
        out.append([int(v) for v in ap.ravel()])
    return out


def edges(mask, covered, min_len=24, eps=1.0):
    """윤곽 가운데 보이는 구간만 열린 선으로: 바깥쪽이 주로 covered(위 레이어가 덮는 곳)면 뺀다."""
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out_side = (~mask).astype(np.float32)
    cov = cv2.blur((covered & ~mask).astype(np.float32), (7, 7))
    tot = cv2.blur(out_side, (7, 7)) + 1e-3
    frac = cov / tot
    out = []
    for c in cs:
        if abs(cv2.contourArea(c)) < 40:
            continue
        pts = c.reshape(-1, 2)
        vis = frac[pts[:, 1], pts[:, 0]] < 0.45
        h, w = mask.shape
        vis &= (pts[:, 0] > 1) & (pts[:, 1] > 1) & (pts[:, 0] < w - 2) & (pts[:, 1] < h - 2)  # 화면 가장자리는 선이 아니다
        if vis.all():
            runs = [np.vstack([pts, pts[:1]])]
        else:
            k = int(np.argmin(vis))  # 가려진 점에서 시작하면 구간이 끝에서 안 잘린다
            pts, vis = np.roll(pts, -k, 0), np.roll(vis, -k)
            runs, cur = [], []
            for p, v in zip(pts, vis):
                if v:
                    cur.append(p)
                elif cur:
                    runs.append(np.array(cur))
                    cur = []
            if cur:
                runs.append(np.array(cur))
        for r in runs:
            if len(r) < min_len:
                continue
            ap = cv2.approxPolyDP(r.reshape(-1, 1, 2).astype(np.int32), eps, False).reshape(-1, 2)
            out.append([int(v) for v in ap.ravel()])
    return out


def shade_axis(img, skin):
    """피부의 밝은 색 → 어두운 색 축 위의 위치(0..1)와 단계 문턱. 색은 내보내지 않는다.
    단계: 하이라이트 / 바탕 / 그림자 1..BANDS (k-means 중심 사이의 중간값이 문턱)."""
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.2), cv2.COLOR_BGR2LAB).astype(np.float32)
    X = lab[skin]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.2)
    cv2.setRNGSeed(1)
    _, _, cent = cv2.kmeans(X, BANDS + 2, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    cent = cent[np.argsort(-cent[:, 0])]
    a, b = cent[1], cent[-1]
    axis = (b - a) / np.dot(b - a, b - a)
    t = ((lab - a) * axis).sum(-1)
    # 피부를 가로지르는 가는 머리카락 가닥(어두운 선)은 지운다: 5px보다 가는 진한 선을 여는 연산
    t = cv2.morphologyEx(t, cv2.MORPH_OPEN, ell(2))
    proj = ((cent - a) * axis).sum(-1)
    thr = (proj[:-1] + proj[1:]) / 2
    return t, thr


def build(debug=None):
    img = cv2.imread(REF)
    H, W = img.shape[:2]
    shape = (H, W)
    an = load_analysis()
    m = {k: load_mask(k) for k in ('skin', 'dress', 'hair', 'face', 'bg')}
    m['straps'] = raster(an['parts']['straps'][0:1], shape) | raster(an['parts']['straps'][1:], shape)
    m['straps'] = cv2.dilate(m['straps'].astype(np.uint8), ell(2)).astype(bool)
    m['sashPart'] = raster(an['parts']['sash'], shape)

    # hair 레이어와 같은 규칙: 몸 덩어리(hull) 안의 머리카락은 몸 '앞'에 그려진다(두꺼우면 채운 다발,
    # 가늘면 가닥 선). 그 밑은 몸으로 채워야 가닥 사이로 배경이나 뒷머리가 비치지 않는다.
    body = (m['skin'] | m['dress'] | m['face']).astype(np.uint8)
    hull = ndi.binary_fill_holes(cv2.morphologyEx(body, cv2.MORPH_CLOSE, ell(22)))
    infront = m['hair'] & hull

    comps = {}
    for name in ORDER:
        c = COMPS[name]
        part = poly(c['part'], shape)
        vis = part & m[c['kind']]
        hide = np.zeros(shape, bool)
        for h in c['hide']:
            hide |= comps[h] if h in comps else m[h]
        closed = cv2.morphologyEx(vis.astype(np.uint8), cv2.MORPH_CLOSE, ell(c['close'])).astype(bool)
        # 머리카락 밑은 보이는 곳에서 MARGIN px까지만 넓힌다 (머리카락이 덮어 줄지 모르는 곳은 아껴 둔다).
        # 얼굴·드레스·팔처럼 반드시 위에 그려지는 것 밑으로는 보충 다각형 전체를 쓴다.
        near = cv2.dilate(vis.astype(np.uint8), ell(MARGIN)).astype(bool)
        soft = hide & m['hair']
        ext = poly(c['ext'], shape)
        full = vis | (closed & hide & part) | (ext & hide & ~soft) | (ext & soft & near) | (infront & part & ext)
        # 몸 부위 안의 구멍은 늘 머리카락 그림자다. outline이 크면 가닥 하나하나의 들쭉날쭉함을 지운다
        full = ndi.binary_fill_holes(smooth(full, sigma=c.get('outline', 1.6)))
        comps[name] = full

    # 선을 긋지 않을 곳: 머리카락·얼굴(위 레이어)과, 이 부위보다 나중에 그려 덮는 부위
    above = m['hair'] | m['face'] | m['straps']
    hair_near = cv2.dilate(m['hair'].astype(np.uint8), ell(6)).astype(bool)
    cover = {
        'torso': above | comps['dress'] | comps['arm'],
        'arm': m['face'] | m['straps'],  # 팔 둘레의 머리카락은 대부분 팔 뒤에 있다
        'waist': above | comps['arm'] | comps['skirt'] | comps['sash'],
        'fore': above | hair_near,  # 가닥 사이 틈의 가장자리는 선이 아니다
        'dress': above | comps['arm'],
        'skirt': above | comps['arm'] | comps['sash'],
        'sash': above,
    }

    # 피부 명암 단계: 보이는 피부에서 재고, 가린 곳은 주변에서 이어 칠한다
    skin_vis = m['skin'] & ~m['face']
    t, thr = shade_axis(img, skin_vis)
    # 피부 위를 지나는 가는 머리카락 가닥: 주변보다 확 어두운 가는 선(blackhat). 가린 곳으로 친다.
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, ell(5))
    strands = cv2.dilate(((bh > 22) & skin_vis).astype(np.uint8), ell(2)).astype(bool)
    # 머리카락 가장자리의 어두운 번짐(그림자·안티에일리어싱)도 빼고 잰다
    hair_halo = cv2.dilate(m['hair'].astype(np.uint8), ell(3)).astype(bool)
    skin_vis &= ~strands & ~hair_halo
    bands = {}
    for name in SKIN_COMPS:
        full = comps[name]
        vis = full & skin_vis
        # 단계 번호: 0 하이라이트, 1 바탕, 2.. 그림자
        q = np.zeros(shape, np.uint8)
        for k, th in enumerate(thr):
            q[t > th] = k + 1
        hole = (full & ~vis).astype(np.uint8)
        q = cv2.inpaint((q * 40).astype(np.uint8), hole, 9, cv2.INPAINT_TELEA)
        q = cv2.medianBlur(q, 7).astype(np.float32) / 40
        q = cv2.GaussianBlur(q, (0, 0), 2.2)
        sg = COMPS[name].get('soft', 1.4)
        ma = int(90 * sg * sg / 2)
        hi = smooth((q < 0.5) & vis, sigma=sg, min_area=ma) if COMPS[name].get('hi', True) else vis & False
        lv = [rings(hi, eps=1.2, min_area=90)]
        simp = COMPS[name].get('simplify', 0)
        for k in range(2, BANDS + 2):
            bm = (q > k - 0.5) & full
            if simp:  # 가는 돌기와 틈을 지워 단순한 셀 그림자 모양으로
                bm = cv2.morphologyEx(bm.astype(np.uint8), cv2.MORPH_OPEN, ell(simp))
                bm = cv2.morphologyEx(bm, cv2.MORPH_CLOSE, ell(simp)).astype(bool) & full
            bm = smooth(bm, sigma=sg, min_area=ma)
            lv.append(rings(bm, eps=COMPS[name].get('eps', 1.2), min_area=90))
        bands[name] = lv

    data = {
        'version': 1,
        'shapes': {k: rings(v, min_area=150) for k, v in comps.items()},
        'edges': {k: edges(v, cover[k], COMPS[k].get('min_edge', 24)) for k, v in comps.items()},
        'bands': bands,
        'strapL': [list(p) for p in STRAP_L],
    }
    if debug:
        os.makedirs(debug, exist_ok=True)
        cols = {'torso': (0, 255, 255), 'arm': (0, 255, 0), 'waist': (255, 0, 255), 'fore': (255, 255, 0),
                'dress': (255, 255, 255), 'skirt': (0, 128, 255), 'sash': (255, 0, 0)}
        out = (img * 0.5).astype(np.uint8)
        for k, v in data['shapes'].items():
            for r in v:
                cv2.polylines(out, [np.array(r, np.int32).reshape(-1, 2)], True, cols[k], 2)
        cv2.imwrite(os.path.join(debug, 'body_shapes.png'), out)
        out = np.zeros_like(img)
        shades = [(230, 243, 252), (171, 190, 250), (150, 162, 239), (132, 132, 212), (103, 100, 173)]
        for name in SKIN_COMPS:
            cv2.fillPoly(out, [np.array(r, np.int32).reshape(-1, 2) for r in data['shapes'][name]],
                         (198, 220, 251))
            for k, lv in enumerate(bands[name]):
                for r in lv:
                    cv2.fillPoly(out, [np.array(r, np.int32).reshape(-1, 2)], shades[k])
        cv2.imwrite(os.path.join(debug, 'body_bands.png'), out)
    return data


def write_js(data, path):
    body = json.dumps(data, separators=(',', ':')).replace('],[', '],\n[')
    with open(path, 'w') as f:
        f.write('// tools/proc_body.py가 만든다. 직접 고치지 않는다.\n')
        f.write('// body 레이어의 기하: 부위 윤곽, 피부 명암 단계 모양, 어깨끈 중심선. 색은 없다.\n')
        f.write('(window.ConcertProc = window.ConcertProc || {}).bodyData = ')
        f.write(body)
        f.write(';\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', help='확인용 겹침 이미지를 쓸 폴더')
    args = ap.parse_args()
    data = build(args.debug)
    write_js(data, OUT_JS)
    n = sum(len(r) // 2 for v in data['shapes'].values() for r in v)
    nb = sum(len(r) // 2 for v in data['bands'].values() for lv in v for r in lv)
    print('shapes %d pts, bands %d pts, %d bytes' % (n, nb, os.path.getsize(OUT_JS)))


if __name__ == '__main__':
    main()
