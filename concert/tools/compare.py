#!/usr/bin/env python3
"""렌더 결과를 원본과 비교해 수치와 비교 이미지를 만든다.

    python3 concert/tools/compare.py render.png --out-prefix out/render
    python3 concert/tools/compare.py render.png --crops face,eyes --out-prefix out/r

출력(JSON, 표준출력)
    ssim        전체 해상도 흑백 SSIM. 선과 질감까지 본다.
    ssim_small  1/4 크기(314px) 컬러 SSIM. 눈으로 본 전체 인상에 가깝다. 페이지 점수로 쓴다.
    psnr        전체 해상도 PSNR(dB)
    dE          1/8 크기 Lab 평균 색차(ΔE76). 구도와 색이 얼마나 맞는지 본다. 낮을수록 좋다.
    regions     이름 붙은 영역(아래 CROPS)별 ssim, dE
    masks       tools/analysis/mask_*.png가 있으면 마스크 영역별 ssim, dE

--out-prefix를 주면 다음 이미지를 쓴다.
    <prefix>_side.png         원본 | 렌더 | 차이 (절반 크기)
    <prefix>_crop_<이름>.png  원본 | 렌더 (원래 크기, 작은 영역은 2배)
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from skimage.color import rgb2lab
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'assets', 'reference.jpg')
MASK_DIR = os.path.join(HERE, 'analysis')

# (x0, y0, x1, y1) — 원본 좌표
CROPS = {
    'face': (640, 120, 1100, 480),
    'eyes': (760, 190, 1060, 300),
    'mouth': (800, 310, 1000, 420),
    'ears': (680, 280, 1080, 440),
    'shoulder': (400, 430, 800, 800),
    'dress': (0, 750, 950, 1254),
    'hairtop': (560, 0, 1150, 260),
    'hairleft': (150, 300, 620, 960),
    'hairright': (900, 250, 1254, 1254),
    'bgleft': (0, 0, 640, 700),
    'bgright': (1000, 0, 1254, 700),
    'crowd': (0, 560, 300, 900),
}


def load(path, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return im


def ssim_gray(a, b):
    ga = np.asarray(a.convert('L'), dtype=np.float64)
    gb = np.asarray(b.convert('L'), dtype=np.float64)
    return structural_similarity(ga, gb, data_range=255.0)


def ssim_map_gray(a, b):
    ga = np.asarray(a.convert('L'), dtype=np.float64)
    gb = np.asarray(b.convert('L'), dtype=np.float64)
    _, m = structural_similarity(ga, gb, data_range=255.0, full=True)
    return m


def delta_e(a, b):
    la = rgb2lab(np.asarray(a, dtype=np.float64) / 255.0)
    lb = rgb2lab(np.asarray(b, dtype=np.float64) / 255.0)
    return np.sqrt(((la - lb) ** 2).sum(axis=2))


def side_by_side(ref, out, path, with_diff=True, scale=0.5):
    w, h = ref.size
    sw, sh = max(1, int(w * scale)), max(1, int(h * scale))
    panels = [ref.resize((sw, sh), Image.LANCZOS), out.resize((sw, sh), Image.LANCZOS)]
    if with_diff:
        d = np.abs(np.asarray(ref, dtype=np.int16) - np.asarray(out, dtype=np.int16)).sum(axis=2)
        d = np.clip(d / 3.0 * 2.0, 0, 255).astype(np.uint8)
        heat = np.stack([d, (d * 0.35).astype(np.uint8), 255 - d], axis=2)
        panels.append(Image.fromarray(heat).resize((sw, sh), Image.LANCZOS))
    gap = 6
    canvas = Image.new('RGB', (sw * len(panels) + gap * (len(panels) - 1), sh), (255, 255, 255))
    for i, p in enumerate(panels):
        canvas.paste(p, (i * (sw + gap), 0))
    canvas.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('render')
    ap.add_argument('--ref', default=REF)
    ap.add_argument('--out-prefix')
    ap.add_argument('--crops', default='', help='쉼표로 구분한 영역 이름, all이면 전부')
    args = ap.parse_args()

    ref = load(args.ref)
    out = load(args.render, ref.size)
    W, H = ref.size

    res = {}
    res['ssim'] = round(ssim_gray(ref, out), 4)
    small = (W // 4, H // 4)
    rs, os_ = ref.resize(small, Image.LANCZOS), out.resize(small, Image.LANCZOS)
    res['ssim_small'] = round(
        structural_similarity(np.asarray(rs), np.asarray(os_), channel_axis=2, data_range=255), 4
    )
    res['psnr'] = round(peak_signal_noise_ratio(np.asarray(ref), np.asarray(out), data_range=255), 2)
    tiny = (W // 8, H // 8)
    res['dE'] = round(float(delta_e(ref.resize(tiny, Image.LANCZOS), out.resize(tiny, Image.LANCZOS)).mean()), 2)

    regions = {}
    for name, box in CROPS.items():
        a, b = ref.crop(box), out.crop(box)
        bw, bh = (box[2] - box[0]) // 4, (box[3] - box[1]) // 4
        regions[name] = {
            'ssim': round(ssim_gray(a, b), 4),
            'dE': round(float(delta_e(a.resize((bw, bh)), b.resize((bw, bh))).mean()), 2),
        }
    res['regions'] = regions

    if os.path.isdir(MASK_DIR):
        smap = ssim_map_gray(ref, out)
        de = delta_e(ref.resize(tiny, Image.LANCZOS), out.resize(tiny, Image.LANCZOS))
        masks = {}
        for fn in sorted(os.listdir(MASK_DIR)):
            if not (fn.startswith('mask_') and fn.endswith('.png')):
                continue
            m = np.asarray(Image.open(os.path.join(MASK_DIR, fn)).convert('L').resize((W, H))) > 127
            if m.sum() == 0:
                continue
            mt = np.asarray(Image.open(os.path.join(MASK_DIR, fn)).convert('L').resize(tiny)) > 127
            masks[fn[5:-4]] = {
                'ssim': round(float(smap[m].mean()), 4),
                'dE': round(float(de[mt].mean()) if mt.sum() else float('nan'), 2),
            }
        if masks:
            res['masks'] = masks

    if args.out_prefix:
        os.makedirs(os.path.dirname(os.path.abspath(args.out_prefix)), exist_ok=True)
        side_by_side(ref, out, args.out_prefix + '_side.png')
        names = list(CROPS) if args.crops == 'all' else [c for c in args.crops.split(',') if c]
        for name in names:
            box = CROPS[name]
            a, b = ref.crop(box), out.crop(box)
            sc = 2.0 if (box[2] - box[0]) < 360 else 1.0
            side_by_side(a, b, f'{args.out_prefix}_crop_{name}.png', with_diff=False, scale=sc)

    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == '__main__':
    main()
