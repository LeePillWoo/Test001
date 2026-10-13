#!/usr/bin/env python3
"""원본 그림에서 아이와 고양이를 따로 오려 public/에 투명 PNG로 쓰고, 둘을 지운 배경판도 만든다.

    python3 tools/cutout.py

GrabCut에 손으로 잡은 힌트(확실한 전경·배경 다각형)를 주고, 가장자리를 살짝 부드럽게 한다.
"""
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'public')
img = cv2.imread(os.path.join(PUB, 'source.png'))
H, W = img.shape[:2]


def poly(mask, pts, val):
    cv2.fillPoly(mask, [np.array(pts, np.int32)], val)


def grabcut(rect, fg_polys, bg_polys, iters=8):
    m = np.full((H, W), cv2.GC_BGD, np.uint8)
    x, y, w, h = rect
    m[y:y + h, x:x + w] = cv2.GC_PR_FGD
    for p in bg_polys:
        poly(m, p, cv2.GC_BGD)
    for p in fg_polys:
        poly(m, p, cv2.GC_FGD)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(img, m, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    out = np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(out)
    if n > 1:  # 가장 큰 덩어리만
        keep = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        out = np.where(lab == keep, 255, 0).astype(np.uint8)
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    return out


# 고양이: 창틀 위에 엎드린 모습. 아이 손은 고양이에서 뺀다.
HAND = [(380, 780), (410, 762), (470, 764), (494, 790), (472, 808), (400, 802)]
cat = grabcut(
    (88, 618, 640, 392),
    fg_polys=[[(160, 700), (330, 700), (330, 850), (160, 850)], [(250, 880), (650, 880), (650, 960), (250, 960)],
              [(110, 940), (260, 940), (260, 985), (110, 985)]],
    bg_polys=[HAND, [(88, 618), (150, 618), (110, 760), (88, 760)], [(380, 618), (728, 618), (728, 800), (520, 800), (420, 740)],
              [(88, 1000), (728, 1000), (728, 1010), (88, 1010)]],
)
# 아이: 머리부터 바지 끝까지. 고양이 몸통은 배경으로.
child = grabcut(
    (425, 140, W - 425, H - 140),
    fg_polys=[[(560, 250), (760, 250), (760, 480), (560, 480)], [(710, 600), (960, 600), (960, 1000), (710, 1000)],
              [(740, 1000), (1000, 1000), (1000, 1440), (740, 1440)], [(870, 440), (920, 440), (920, 600), (870, 600)],
              [(500, 800), (640, 700), (660, 760), (520, 840)], HAND],
    bg_polys=[[(425, 620), (520, 700), (480, 760), (425, 760)], [(425, 860), (690, 880), (690, 1448), (425, 1448)],
              [(500, 690), (600, 650), (640, 640), (610, 700), (520, 745), (495, 745)],
              [(500, 845), (600, 835), (680, 850), (690, 880), (500, 880)],
              [(600, 880), (665, 870), (690, 1000), (600, 1000)], [(369, 805), (470, 815), (500, 845), (369, 845)],
              [(1040, 760), (1086, 760), (1086, 1448), (1065, 1448), (1060, 900), (1045, 880)],
              [(1000, 140), (1086, 140), (1086, 400), (1000, 400)], [(1060, 700), (1086, 700), (1086, 1000), (1060, 1000)]],
)
# 팔 위 창문 조각 정리
poly(child, [(440, 700), (600, 660), (640, 700), (520, 772), (440, 772)], 0)
child[cat > 0] = np.where(cv2.dilate(child, np.ones((3, 3)))[cat > 0] > 0, child[cat > 0], 0)
cat[child > 0] = 0


def save_layer(mask, name):
    a = cv2.GaussianBlur(mask, (0, 0), 1.0)
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = a
    ys, xs = np.where(a > 0)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    cv2.imwrite(os.path.join(PUB, f'{name}.png'), rgba[y0:y1, x0:x1])
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


boxes = {'child': save_layer(child, 'child'), 'cat': save_layer(cat, 'cat')}
# 배경판: 둘을 지우고 주변 색으로 메운 뒤 흐리게 (앞 레이어가 움직여도 겹쳐 보이지 않게)
hole = cv2.dilate(((child > 0) | (cat > 0)).astype(np.uint8) * 255, np.ones((25, 25), np.uint8))
small = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
hs = cv2.resize(hole, (W // 4, H // 4), interpolation=cv2.INTER_NEAREST)
fill = cv2.resize(cv2.inpaint(small, hs, 9, cv2.INPAINT_TELEA), (W, H), interpolation=cv2.INTER_CUBIC)
plate = np.where(hole[..., None] > 0, cv2.GaussianBlur(fill, (0, 0), 6), img)
cv2.imwrite(os.path.join(PUB, 'plate.jpg'), plate, [cv2.IMWRITE_JPEG_QUALITY, 92])
with open(os.path.join(PUB, 'layers.json'), 'w') as f:
    import json
    json.dump({'size': [W, H], **boxes}, f)
print(boxes)

# 변신 후 옷 색: 남색 소매 → 분홍, 베이지 바지 → 흰 라벤더 (얼굴·피부·머리는 그대로)
child_rgba = cv2.imread(os.path.join(PUB, 'child.png'), cv2.IMREAD_UNCHANGED)
x0, y0 = boxes['child'][0], boxes['child'][1]
bgr = child_rgba[..., :3]
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
yy = np.arange(bgr.shape[0])[:, None] + y0
xx = np.arange(bgr.shape[1])[None, :] + x0
hair = ((yy < 545) & (xx < 760)) | (yy < 470)
navy = (h > 95) & (h < 140) & (s > 50) & (v < 140) & ~hair
pants = (yy > 990) & (h > 8) & (h < 35) & (s > 20) & (v > 120)
out = hsv.copy()
out[..., 0] = np.where(navy, 165, out[..., 0])
out[..., 1] = np.where(navy, 120, np.where(pants, s * 0.35, out[..., 1]))
out[..., 2] = np.where(navy, 120 + v * 1.0, out[..., 2])
out[..., 0] = np.where(pants, 140, out[..., 0])
out[..., 2] = np.where(pants, np.minimum(255, v * 1.06 + 10), out[..., 2])
soft = cv2.GaussianBlur((navy | pants).astype(np.float32), (0, 0), 1.2)[..., None]
recol = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
child_rgba[..., :3] = (recol * soft + bgr * (1 - soft)).astype(np.uint8)
cv2.imwrite(os.path.join(PUB, 'child_magic.png'), child_rgba)
