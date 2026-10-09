#!/usr/bin/env python3
"""도형 최적화 데이터 만들기: primitive.c를 빌드해 돌리고 js/primitives/data.js를 쓴다.

    python3 concert/tools/gen_primitives.py                  # 기본 설정으로 다시 만든다 (한 코어로 몇 분)
    python3 concert/tools/gen_primitives.py --size 627 --n 500 --sweeps 1 --work /tmp/p --no-js  # 빠른 시험

순서
    1) 원본을 작업 해상도(기본 1254 = 원본 그대로)의 RGB 바이트로 쓴다.
       캔버스가 1254px에서 안티에일리어싱으로 그리므로, 같은 해상도에서 맞춰야 눈·입 같은 작은 부분이 정확하다.
    2) 중요도 지도를 만든다. 얼굴 < 입 < 눈 순으로 가중치를 높여 표정이 먼저 또렷해지게 한다.
    3) gcc로 primitive.c를 빌드해(concert/tools/bin/, git 제외) 돌린다.
       도형을 하나씩 더하는 1단계 중간중간과 끝에 모든 도형을 다시 맞추는 2단계를 섞는다.
       난수 시드가 고정이라 같은 기계에서는 결과가 늘 같다.
    4) 도형 바이너리를 base64로 바꿔 data.js에 넣는다.
"""
import argparse
import base64
import os
import resource
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(ROOT, 'assets', 'reference.jpg')
SRC = os.path.join(HERE, 'primitive.c')
BIN = os.path.join(HERE, 'bin', 'primitive')
OUT_JS = os.path.join(ROOT, 'js', 'primitives', 'data.js')
FULL = 1254

# 중요도 영역 (원본 좌표, 가중치). 겹치면 큰 값을 쓴다. 가장자리는 흐려서 부드럽게 잇는다.
WEIGHT_BOXES = [
    ((700, 110, 1100, 480), 3.0),   # 얼굴 전체
    ((790, 200, 890, 270), 6.0),    # 왼눈
    ((925, 225, 1030, 300), 6.0),   # 오른눈
    ((810, 310, 960, 420), 5.0),    # 입
]


def build():
    os.makedirs(os.path.dirname(BIN), exist_ok=True)
    if os.path.exists(BIN) and os.path.getmtime(BIN) >= os.path.getmtime(SRC):
        return
    cmd = ['gcc', '-O3', '-ffp-contract=off', '-o', BIN, SRC, '-lm']
    print('빌드:', ' '.join(cmd), file=sys.stderr)
    subprocess.run(cmd, check=True)


def weight_map(size, face_scale):
    """작업 해상도의 float32 중요도 지도."""
    w = np.ones((FULL, FULL), np.float32)
    for (x0, y0, x1, y1), v in WEIGHT_BOXES:
        v = 1.0 + (v - 1.0) * face_scale
        w[y0:y1, x0:x1] = np.maximum(w[y0:y1, x0:x1], v)
    w = gaussian_filter(w, 18)
    return np.asarray(Image.fromarray(w).resize((size, size), Image.BOX), np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=1254, help='작업 해상도')
    ap.add_argument('--n', type=int, default=5000, help='도형 개수')
    ap.add_argument('--cands', type=int, default=2000, help='1단계: 단계마다 무작위 후보 수')
    ap.add_argument('--topk', type=int, default=6, help='1단계: 언덕 오르기로 다듬을 후보 수')
    ap.add_argument('--age', type=int, default=250, help='언덕 오르기: 연속 실패 허용 횟수')
    ap.add_argument('--maxit', type=int, default=3000)
    ap.add_argument('--alpha', type=int, default=128)
    ap.add_argument('--amin', type=int, default=24)
    ap.add_argument('--perr', type=float, default=0.75)
    ap.add_argument('--sweeps', type=int, default=4, help='끝에 모든 도형을 다시 맞추는 바퀴 수')
    ap.add_argument('--sw-cands', type=int, default=150, help='2단계: 도형 주변 창의 무작위 후보 수')
    ap.add_argument('--sw-topk', type=int, default=3)
    ap.add_argument('--sw-age', type=int, default=200)
    ap.add_argument('--sw-every', type=int, default=500, help='1단계 중 이만큼 더할 때마다 한 바퀴 다시 맞추기')
    ap.add_argument('--lam', default='1,1,1', help='Y,Cb,Cr 오차 가중치')
    ap.add_argument('--types', default='0.35,0.25,0.15,0.25', help='삼각형,타원,사각형,곡선 비율')
    ap.add_argument('--face', type=float, default=1.0, help='얼굴 가중치 배율 (0이면 균등)')
    ap.add_argument('--seed', type=int, default=1254)
    ap.add_argument('--checkpoints', default='', help='중간 저장할 개수들, 쉼표 구분')
    ap.add_argument('--work', help='중간 파일 폴더 (기본: 임시 폴더)')
    ap.add_argument('--out-js', default=OUT_JS)
    ap.add_argument('--no-js', action='store_true', help='data.js를 쓰지 않는다')
    args = ap.parse_args()

    build()
    if args.work:
        os.makedirs(args.work, exist_ok=True)
        run(args, args.work)
    else:
        with tempfile.TemporaryDirectory(prefix='primitives_') as work:
            run(args, work)


def run(args, work):
    S = args.size

    ref = Image.open(REF).convert('RGB')
    tgt = ref.resize((S, S), Image.BOX if FULL % S == 0 else Image.LANCZOS)
    tpath = os.path.join(work, 'target.rgb')
    wpath = os.path.join(work, 'weight.f32')
    np.asarray(tgt, np.uint8).tofile(tpath)
    weight_map(S, args.face).tofile(wpath)

    shapes = os.path.join(work, 'shapes.bin')
    cmd = [
        BIN, '--target', tpath, '--weight', wpath, '--size', str(S), '--n', str(args.n),
        '--cands', str(args.cands), '--topk', str(args.topk), '--age', str(args.age),
        '--maxit', str(args.maxit), '--alpha', str(args.alpha), '--amin', str(args.amin),
        '--perr', str(args.perr), '--lam', args.lam, '--types', args.types,
        '--sweeps', str(args.sweeps), '--sw-cands', str(args.sw_cands), '--sw-topk', str(args.sw_topk),
        '--sw-age', str(args.sw_age), '--sw-every', str(args.sw_every),
        '--seed', str(args.seed), '--out', shapes, '--preview', os.path.join(work, 'preview.ppm'),
    ]
    if args.checkpoints:
        cmd += ['--checkpoints', args.checkpoints]
    t0 = time.time()
    subprocess.run(cmd, check=True)
    cpu = resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime
    print(f'최적화 {time.time() - t0:.1f}s (CPU {cpu:.1f}s)' + (f', 중간 파일: {work}' if args.work else ''),
          file=sys.stderr)

    if args.no_js:
        return
    raw = open(shapes, 'rb').read()
    count = int.from_bytes(raw[4:8], 'little')
    b64 = base64.b64encode(raw).decode('ascii')
    with open(args.out_js, 'w', encoding='utf-8') as f:
        f.write('// 자동 생성: concert/tools/gen_primitives.py — 직접 고치지 않는다.\n')
        f.write(f'// 도형 {count}개, 바이너리 {len(raw):,} B (형식은 tools/primitive.c 머리말 참고)\n')
        f.write('window.ConcertData = window.ConcertData || {};\n')
        f.write(f"window.ConcertData.primitives = '{b64}';\n")
    print(f'썼음: {args.out_js} — 도형 {count}개, 바이너리 {len(raw):,} B, '
          f'파일 {os.path.getsize(args.out_js):,} B', file=sys.stderr)


if __name__ == '__main__':
    main()
