#!/usr/bin/env python3
"""벡터 트레이싱(trace) 데이터 생성기.

원본을 수만 개의 채운 벡터 도형(평면색·선형 그라디언트)으로 바꿔 concert/js/trace/data.js에 쓴다.

    python3 concert/tools/gen_trace.py                  # data.js 생성 (1~2분)
    python3 concert/tools/gen_trace.py --cache DIR      # 분할 결과를 DIR에 캐시 (조정할 때 빠르게)
    python3 concert/tools/gen_trace.py --vtracer x.svg  # 비교용 vtracer 기준선 (pip install vtracer==0.6.15)

필요한 것: numpy, opencv-python, scipy, Pillow, 그리고 C 컴파일러(cc/gcc/clang).
영역 병합기(C, 아래 MERGE_C)는 처음 실행할 때 concert/tools/bin/에 컴파일된다 (git에서 제외되는 폴더).
배경 마스크 tools/analysis/mask_bg.png가 있으면 무대 배경을 따로 층으로 나눈다 (인트로에서 무대가 먼저 켜진다).

알고리즘
  1. 분할: 화소 하나하나를 영역으로 시작해, 이웃 영역 쌍을 '합쳤을 때 늘어나는 오차 − 없어지는 경계 비용
     − 영역 하나의 비용'이 가장 작은 것부터 합친다 (Mumford–Shah 에너지의 탐욕적 최소화, C로 구현).
     영역의 색 모형은 평면색과 아핀 그라디언트(+mu) 중 싼 쪽. 얼굴 쪽 화소는 가중치를 높여 잘게 나뉜다.
     경계 비용(lam)을 낮추고 영역 비용(rho)을 높이면 같은 크기에서 가늘고 긴 머리카락 획이 더 잘 남는다.
  2. 채우기: 영역마다 평면색, 또는 방향 하나짜리 선형 그라디언트(createLinearGradient와 같은 모형)를
     최소제곱으로 맞춘다 (64방향 중 오차를 가장 줄이는 방향).
  3. 칠하는 순서: 배경 층 → 인물 층, 층 안에서는 구멍을 메운 면적이 큰 것부터. 앞 도형은 뒤 도형 밑으로
     1px 더 뻗고, 뒤에 칠할 영역만 든 구멍은 메워서 칠하므로 도형 사이에 틈이 생기지 않는다 ('쌓기').
     앞 층 영역이 든 구멍은 하위 경로(evenodd)로 남긴다.
  4. 외곽선: 2배 확대 마스크의 윤곽을 픽셀 모서리(crack) 좌표로 되돌려 정확한 계단 다각형을 얻고,
     계단의 직선 구간 중점을 이어 매끈하게 한다. 그다음 앞에 칠한 영역과 맞닿은 꼭짓점을 법선 방향으로
     옮겨 원본의 안티앨리어싱 경계(안팎 색의 50% 지점)에 맞추고 (1/4px 정밀도), Douglas–Peucker로 줄인다.
     꺾이는 점은 모서리로 표시하고 나머지는 런타임에 Catmull–Rom 곡선으로 잇는다.
  실험했지만 기본으로 쓰지 않는 것: 2배 확대 분할(--scale 2, 4분·2.6GB에 이득 없음), 별도 선화 층
  (--ink, 이 밀도에서는 영역 층이 이미 선을 담아 오차만 조금 는다), Taubin 다듬기(가는 획이 사라짐),
  배경 층 흐림(--blur 1, 보기에는 부드럽지만 모든 배율에서 오차가 는다), 겹침 층위별 Z-순서 정렬(압축이 나빠짐).

데이터 형식 (zlib 압축 → base64, window.ConcertData.trace)
  머리: 'TRC4', u16 너비, u16 높이, u32 도형 수, u8×3 바탕색, u8 좌표 단위(1/n px), u8 층 수,
        층마다 (u32 도형 수, u8 흐림×10), 스트림 길이(u32) 5개
  스트림 (varint는 7비트씩 LEB128, zz는 지그재그 부호 변환)
    kind   도형마다 1바이트: 0 평면색, 1 그라디언트
    color  평면색 RGB 3바이트, 그라디언트는 RGB 두 개 + 끝점 4개(varint, 반 픽셀 단위 절댓값)
    count  하위 경로마다 (꼭짓점 수 << 2 | 첫 점 모서리 << 1 | 같은 도형의 하위 경로가 더 있음) varint
    start  하위 경로마다 첫 점 (zz varint, 앞 하위 경로 첫 점과의 차, 좌표 단위)
    delta  꼭짓점마다 (zz(dx) << 1 | 모서리) varint, zz(dy) varint (좌표 단위)
"""
import argparse
import base64
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zlib

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
REF = os.path.join(ROOT, 'assets', 'reference.jpg')
OUT = os.path.join(ROOT, 'js', 'trace', 'data.js')
BIN_DIR = os.path.join(HERE, 'bin')

W = H = 1254

# ── 분할 설정 ──
SEG = dict(
    lam=80.0,  # 경계 1px의 비용 (RGB 제곱오차 단위)
    rho=2800.0,  # 영역 하나의 비용
    mu=2800.0,  # 그라디언트 채우기의 추가 비용 (음수면 평면색만)
    eps=4.0,  # 그라디언트 적합 릿지 (px^2)
)
FACE_WEIGHT = 24.0  # 얼굴 타원 안 화소의 오차 가중치
SCALE = 1  # 원본을 이 배율로 (바이큐빅) 키운 그림을 분할한다 → 경계가 1/SCALE px 정밀도

# ── 도형 설정 ──
GRAD_MIN_AREA = 24  # 이보다 작은 영역은 평면색
GRAD_MIN_GAIN = 2000.0  # 그라디언트가 줄여야 하는 최소 제곱오차 (mu보다 작으면 mu)
CORNER_RUN = 3  # 양쪽 직선 구간이 이 길이 이상이면 계단 모서리를 살린다
DP_EPS = 0.4  # Douglas–Peucker 허용 오차(px)
COORD_UNIT = 4  # 꼭짓점 좌표 단위: 1/COORD_UNIT px
CORNER_ANGLE = 70.0  # 이보다 크게 꺾이면 모서리로 표시(도)
SMOOTH_ITERS = 0  # 경계 잔떨림을 줄이는 Taubin 다듬기 횟수 (모서리는 고정) — 가는 획이 사라져서 끔
REFINE = dict(
    reach=1.5,  # 법선 방향으로 이만큼(px) 앞뒤를 훑어 원본 경계(안팎 색의 50% 지점)를 찾는다
    move=0.75,  # 꼭짓점을 옮기는 최대 거리(px)
    contrast=24.0,  # 안팎 색 차이(RGB 거리)가 이보다 작으면 옮기지 않는다
)

# ── 배경 층 ──
BG_MASK = os.path.join(HERE, 'analysis', 'mask_bg.png')  # 배경(무대) 마스크, 없으면 층을 나누지 않는다
# 배경 층을 칠한 뒤 한 번에 거는 가우시안 흐림 반지름(px). 아웃포커스 무대처럼 보이지만 재 보면
# 원본 배경에도 또렷한 무늬가 많아서, 배경만 따로 재도 1px 흐림이 모든 배율에서 오차를 늘렸다 → 0.
# (크롬은 1px 미만의 캔버스 흐림을 무시한다.)
SOFT_BLUR = 0.0

# ── 선화(잉크) 층 설정 ──
INK = dict(
    close_r=3,  # 닫힘 연산 반지름(px): 이보다 가는 어두운 획을 선으로 본다
    min_depth=18.0,  # 선으로 볼 최소 대비 (회색조 0..255)
    min_bg=150.0,  # 선 둘레 바탕(닫힘)이 이보다 밝아야 한다 — 눈동자 속 무늬 같은 어두운 바탕은 뺀다
    up=4,  # 윤곽을 뽑는 배율 (1/up px 정밀도)
    eps=0.3,  # Douglas–Peucker 허용 오차(px)
    min_area=1.5,  # 이보다 작은 조각은 버린다 (px^2)
    roi=1.15,  # 얼굴 타원 반지름 배수 — 이 안에서만 선을 뽑는다
)

MERGE_C = r'''
// 영역 병합 분할 (Mumford-Shah 근사). gen_trace.py가 컴파일해서 쓴다.
// 입력: int32 W, H, float32 [H*W*4] (r, g, b, 가중치) / 출력: int32 N, int32 [H*W] 라벨
// 인자: in out lambda rho mu eps target maxcost
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  double w, sx, sy, sxx, sxy, syy, sc[3], sxc[3], syc[3], scc;
} Stats;
typedef struct {
  int32_t *k;
  float *v;
  int cap, cnt, used;
} Nb;
typedef struct {
  float cost;
  int32_t a, b;
  uint32_t va, vb;
} Edge;

static Stats *st;
static Nb *nb;
static uint32_t *ver;
static int32_t *par;
static Edge *heap;
static size_t hn, hcap;
static double LAMBDA, RHO, MU, EPS;

// 이웃 해시표 (열린 주소법, -1 빈칸, -2 지운 칸)
static void nb_init(Nb *t, int cap) {
  t->cap = cap;
  t->cnt = t->used = 0;
  t->k = malloc(sizeof(int32_t) * cap);
  t->v = malloc(sizeof(float) * cap);
  for (int i = 0; i < cap; i++) t->k[i] = -1;
}
static void nb_put(Nb *t, int32_t key, float add);
static void nb_grow(Nb *t) {
  int oc = t->cap, nc = oc;
  int32_t *ok = t->k;
  float *ov = t->v;
  while (nc < (t->cnt + 1) * 3) nc *= 2;
  nb_init(t, nc);
  for (int i = 0; i < oc; i++)
    if (ok[i] >= 0) nb_put(t, ok[i], ov[i]);
  free(ok);
  free(ov);
}
static inline uint32_t hsh(int32_t k) { return (uint32_t)k * 2654435761u; }
static void nb_put(Nb *t, int32_t key, float add) {
  if ((t->used + 1) * 3 > t->cap * 2) nb_grow(t);
  uint32_t m = t->cap - 1, i = hsh(key) & m;
  int tomb = -1;
  while (t->k[i] != -1) {
    if (t->k[i] == key) {
      t->v[i] += add;
      return;
    }
    if (t->k[i] == -2 && tomb < 0) tomb = i;
    i = (i + 1) & m;
  }
  if (tomb >= 0) i = tomb;
  else t->used++;
  t->k[i] = key;
  t->v[i] = add;
  t->cnt++;
}
static float nb_get(const Nb *t, int32_t key) {
  uint32_t m = t->cap - 1, i = hsh(key) & m;
  while (t->k[i] != -1) {
    if (t->k[i] == key) return t->v[i];
    i = (i + 1) & m;
  }
  return 0;
}
static void nb_del(Nb *t, int32_t key) {
  uint32_t m = t->cap - 1, i = hsh(key) & m;
  while (t->k[i] != -1) {
    if (t->k[i] == key) {
      t->k[i] = -2;
      t->cnt--;
      return;
    }
    i = (i + 1) & m;
  }
}

// 영역 에너지 = min(평면색 오차, 아핀 그라디언트 오차 + MU)
static double sse_flat(const Stats *s) {
  if (s->w <= 0) return 0;
  double t = s->scc;
  for (int k = 0; k < 3; k++) t -= s->sc[k] * s->sc[k] / s->w;
  return t > 0 ? t : 0;
}
static double energy(const Stats *s) {
  double f = sse_flat(s);
  if (MU < 0) return f;
  double w = s->w, mx = s->sx / w, my = s->sy / w;
  double a = s->sxx - s->sx * mx + EPS, b = s->sxy - s->sx * my, d = s->syy - s->sy * my + EPS;
  double det = a * d - b * b;
  if (det <= 1e-9) return f;
  double red = 0;
  for (int k = 0; k < 3; k++) {
    double bx = s->sxc[k] - mx * s->sc[k], by = s->syc[k] - my * s->sc[k];
    double gx = (d * bx - b * by) / det, gy = (-b * bx + a * by) / det;
    red += gx * bx + gy * by + EPS * (gx * gx + gy * gy);
  }
  double g = f - red;
  if (g < 0) g = 0;
  g += MU;
  return g < f ? g : f;
}
static inline void add_stats(Stats *a, const Stats *b) {
  double *pa = (double *)a;
  const double *pb = (const double *)b;
  for (size_t i = 0; i < sizeof(Stats) / sizeof(double); i++) pa[i] += pb[i];
}
static double merge_cost(int32_t a, int32_t b, float len) {
  Stats m = st[a];
  add_stats(&m, &st[b]);
  return energy(&m) - energy(&st[a]) - energy(&st[b]) - LAMBDA * len - RHO;
}

static void hpush(float cost, int32_t a, int32_t b) {
  if (hn == hcap) {
    hcap *= 2;
    heap = realloc(heap, sizeof(Edge) * hcap);
  }
  Edge e = {cost, a, b, ver[a], ver[b]};
  size_t i = hn++;
  while (i > 0) {
    size_t p = (i - 1) / 2;
    if (heap[p].cost <= cost) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = e;
}
static Edge hpop(void) {
  Edge top = heap[0], last = heap[--hn];
  size_t i = 0;
  for (;;) {
    size_t l = 2 * i + 1, r = l + 1, s = i;
    float sc = last.cost;
    if (l < hn && heap[l].cost < sc) {
      s = l;
      sc = heap[l].cost;
    }
    if (r < hn && heap[r].cost < sc) s = r;
    if (s == i) break;
    heap[i] = heap[s];
    i = s;
  }
  if (hn) heap[i] = last;
  return top;
}
static int32_t find(int32_t x) {
  while (par[x] != x) {
    par[x] = par[par[x]];
    x = par[x];
  }
  return x;
}

int main(int argc, char **argv) {
  if (argc < 9) return 2;
  LAMBDA = atof(argv[3]);
  RHO = atof(argv[4]);
  MU = atof(argv[5]);
  EPS = atof(argv[6]);
  long target = atol(argv[7]);
  double maxcost = atof(argv[8]);
  FILE *f = fopen(argv[1], "rb");
  int32_t W, H;
  if (!f || fread(&W, 4, 1, f) != 1 || fread(&H, 4, 1, f) != 1) return 3;
  long N = (long)W * H;
  float *px = malloc(sizeof(float) * 4 * N);
  if (fread(px, sizeof(float), 4 * N, f) != (size_t)(4 * N)) return 3;
  fclose(f);

  st = calloc(N, sizeof(Stats));
  nb = calloc(N, sizeof(Nb));
  ver = calloc(N, sizeof(uint32_t));
  par = malloc(sizeof(int32_t) * N);
  for (long i = 0; i < N; i++) {
    double x = (double)(i % W) + 0.5, y = (double)(i / W) + 0.5, w = px[4 * i + 3];
    Stats *s = &st[i];
    s->w = w;
    s->sx = w * x;
    s->sy = w * y;
    s->sxx = w * x * x;
    s->sxy = w * x * y;
    s->syy = w * y * y;
    for (int k = 0; k < 3; k++) {
      double c = px[4 * i + k];
      s->sc[k] = w * c;
      s->sxc[k] = w * x * c;
      s->syc[k] = w * y * c;
      s->scc += w * c * c;
    }
    par[i] = i;
    nb_init(&nb[i], 8);
  }
  hcap = 4 * N;
  heap = malloc(sizeof(Edge) * hcap);
  for (long i = 0; i < N; i++) {
    long x = i % W, y = i / W;
    if (x + 1 < W) {
      nb_put(&nb[i], i + 1, 1);
      nb_put(&nb[i + 1], i, 1);
      hpush(merge_cost(i, i + 1, 1), i, i + 1);
    }
    if (y + 1 < H) {
      nb_put(&nb[i], i + W, 1);
      nb_put(&nb[i + W], i, 1);
      hpush(merge_cost(i, i + W, 1), i, i + W);
    }
  }
  long count = N;
  while (hn && count > target) {
    Edge e = hpop();
    int32_t a = find(e.a), b = find(e.b);
    if (a == b) continue;
    float len = nb_get(&nb[a], b);
    if (len <= 0) continue;
    if (a != e.a || b != e.b || e.va != ver[a] || e.vb != ver[b]) {
      // 낡은 항목: 지금의 대표 영역끼리 비용을 다시 계산해서 넣는다
      hpush(merge_cost(a, b, len), a, b);
      continue;
    }
    if (e.cost > maxcost) break;
    if (nb[a].cnt < nb[b].cnt) {  // 이웃이 많은 쪽이 살아남는다
      int32_t t = a;
      a = b;
      b = t;
    }
    add_stats(&st[a], &st[b]);
    Nb *tb = &nb[b];
    for (int i = 0; i < tb->cap; i++) {
      int32_t n = tb->k[i];
      if (n < 0 || n == a) continue;
      float l = tb->v[i];
      nb_del(&nb[n], b);
      nb_put(&nb[n], a, l);
      nb_put(&nb[a], n, l);
    }
    nb_del(&nb[a], b);
    free(tb->k);
    free(tb->v);
    tb->k = NULL;
    tb->cap = tb->cnt = 0;
    par[b] = a;
    ver[a]++;
    count--;
    // 이웃이 적으면 바로 새 비용을 넣고, 많으면 꺼낼 때 다시 계산한다
    Nb *ta = &nb[a];
    if (ta->cnt <= 48) {
      for (int i = 0; i < ta->cap; i++)
        if (ta->k[i] >= 0) hpush(merge_cost(a, ta->k[i], ta->v[i]), a, ta->k[i]);
    }
  }
  int32_t *lab = malloc(sizeof(int32_t) * N), *remap = malloc(sizeof(int32_t) * N), nl = 0;
  for (long i = 0; i < N; i++) remap[i] = -1;
  for (long i = 0; i < N; i++) {
    int32_t r = find(i);
    if (remap[r] < 0) remap[r] = nl++;
    lab[i] = remap[r];
  }
  FILE *o = fopen(argv[2], "wb");
  fwrite(&nl, 4, 1, o);
  fwrite(lab, 4, N, o);
  fclose(o);
  return 0;
}
'''


# ── 공용 ─────────────────────────────────────────────
def log(*a):
    print(*a, flush=True)


def build_merger():
    """C 병합기를 (소스가 바뀌었을 때만) 컴파일한다."""
    tag = hashlib.sha1(MERGE_C.encode()).hexdigest()[:10]
    exe = os.path.join(BIN_DIR, f'trace_merge_{tag}')
    if os.path.exists(exe):
        return exe
    cc = shutil.which('cc') or shutil.which('gcc') or shutil.which('clang')
    if not cc:
        sys.exit('C 컴파일러(cc/gcc/clang)가 필요합니다.')
    os.makedirs(BIN_DIR, exist_ok=True)
    src = os.path.join(BIN_DIR, f'trace_merge_{tag}.c')
    with open(src, 'w') as f:
        f.write(MERGE_C)
    subprocess.run([cc, '-O2', '-o', exe, src, '-lm'], check=True)
    return exe


def load_ref():
    return np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)


def face_weight(scale):
    """얼굴 타원(눈·입 포함) 안쪽 화소의 가중치를 높인다."""
    yy, xx = (np.mgrid[0 : H * scale, 0 : W * scale].astype(np.float32) + 0.5) / scale
    d = face_ellipse(xx, yy)
    wgt = 1.0 + (FACE_WEIGHT - 1.0) * np.clip((1.25 - d) / 0.5, 0, 1)
    return wgt.astype(np.float32)


# ── 1. 분할 ──────────────────────────────────────────
def segment(img, wgt, cache=None):
    key = hashlib.sha1(
        repr(sorted(SEG.items())).encode() + img.tobytes()[::997] + wgt.tobytes()[::997] + MERGE_C.encode()
    ).hexdigest()[:12]
    if cache:
        path = os.path.join(cache, f'labels_{key}.npy')
        if os.path.exists(path):
            log(f'분할: 캐시 {path}')
            return np.load(path)
    exe = build_merger()
    t0 = time.time()
    hh, ww = img.shape[:2]
    with tempfile.TemporaryDirectory() as tmp:
        fin, fout = os.path.join(tmp, 'in.bin'), os.path.join(tmp, 'out.bin')
        buf = np.concatenate([img, wgt[..., None]], axis=2).astype(np.float32)
        with open(fin, 'wb') as f:
            f.write(np.array([ww, hh], np.int32).tobytes())
            f.write(buf.tobytes())
        args = [SEG['lam'], SEG['rho'], SEG['mu'], SEG['eps'], 0, 0]
        subprocess.run([exe, fin, fout] + [str(a) for a in args], check=True)
        d = np.fromfile(fout, np.int32)
    lab = d[1:].reshape(hh, ww)
    log(f'분할: 영역 {d[0]}개, {time.time() - t0:.1f}s')
    if cache:
        os.makedirs(cache, exist_ok=True)
        np.save(path, lab)
    return lab


# ── 2. 채우기 ─────────────────────────────────────────
def fit_fills(img, lab, scale):
    """영역마다 평면색 또는 선형 그라디언트를 맞춘다.

    img·lab은 scale배 크기. 좌표와 면적, 오차는 원본 픽셀 단위로 돌려준다.
    돌려주는 값: kind(0/1), c0(RGB), c1(RGB), p0(x,y), p1(x,y)  — 모두 영역 번호로 색인
    """
    n = int(lab.max()) + 1
    flat = lab.ravel()
    hh, ww = lab.shape
    yy, xx = np.mgrid[0:hh, 0:ww]
    x = (xx.ravel().astype(np.float64) + 0.5) / scale
    y = (yy.ravel().astype(np.float64) + 0.5) / scale
    sw = 1.0 / (scale * scale)  # 확대 화소 하나의 원본 면적
    cnt = np.bincount(flat, minlength=n).astype(np.float64) * sw

    def bc(v):
        return np.bincount(flat, weights=v, minlength=n) * sw

    mx, my = bc(x) / cnt, bc(y) / cnt
    cxx = bc(x * x) - cnt * mx * mx + 1e-6
    cxy = bc(x * y) - cnt * mx * my
    cyy = bc(y * y) - cnt * my * my + 1e-6
    mean = np.zeros((n, 3))
    bx = np.zeros((n, 3))
    by = np.zeros((n, 3))
    sse = np.zeros(n)
    for k in range(3):
        c = img[..., k].ravel().astype(np.float64)
        m = bc(c) / cnt
        mean[:, k] = m
        bx[:, k] = bc(x * c) - cnt * mx * m
        by[:, k] = bc(y * c) - cnt * my * m
        sse += bc(c * c) - cnt * m * m
    # 방향 d(각도 θ)마다 오차 감소량 = Σ_k (d·b_k)^2 / (dᵀ C d). 64방향 중 최선을 고른다.
    best_gain = np.zeros(n)
    best_t = np.zeros(n)
    for t in np.linspace(0, np.pi, 64, endpoint=False):
        dx, dy = np.cos(t), np.sin(t)
        den = dx * dx * cxx + 2 * dx * dy * cxy + dy * dy * cyy
        num = ((dx * bx + dy * by) ** 2).sum(axis=1)
        gain = num / den
        upd = gain > best_gain
        best_gain[upd] = gain[upd]
        best_t[upd] = t
    min_gain = GRAD_MIN_GAIN if SEG['mu'] < 0 else max(GRAD_MIN_GAIN, SEG['mu'])
    use = (cnt >= GRAD_MIN_AREA) & (best_gain >= min_gain)
    dx, dy = np.cos(best_t), np.sin(best_t)
    den = dx * dx * cxx + 2 * dx * dy * cxy + dy * dy * cyy
    v = (dx[:, None] * bx + dy[:, None] * by) / den[:, None]  # 투영 1px당 색 변화
    s = dx[flat] * (x - mx[flat]) + dy[flat] * (y - my[flat])
    idx = np.arange(n)
    smin = ndi.minimum(s, flat, idx)
    smax = ndi.maximum(s, flat, idx)
    c0 = np.clip(mean + v * smin[:, None], 0, 255)
    c1 = np.clip(mean + v * smax[:, None], 0, 255)
    p0 = np.stack([mx + dx * smin, my + dy * smin], axis=1)
    p1 = np.stack([mx + dx * smax, my + dy * smax], axis=1)
    kind = use.astype(np.uint8)
    c0[~use] = mean[~use]
    log(f'채우기: 그라디언트 {int(use.sum())}개 / {n}')
    return dict(kind=kind, c0=c0, c1=c1, p0=p0, p1=p1, area=cnt, sse=sse, gain=best_gain)


# ── 3·4. 칠하는 순서와 외곽선 ─────────────────────────
def crack_contours(mask):
    """마스크의 윤곽을 픽셀 모서리 좌표의 다각형(정수)으로 돌려준다: [(바깥, [구멍, ...]), ...]

    2배 확대한 마스크의 윤곽점 q(확대 화소 중심)는 ceil(q/2)로 원래 격자의 모서리 점이 된다
    (바깥 윤곽과 구멍 윤곽 모두).
    """
    up = np.repeat(np.repeat(mask.astype(np.uint8), 2, axis=0), 2, axis=1)
    cs, hier = cv2.findContours(up, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return []

    def conv(c):
        v = (c[:, 0, :].astype(np.int32) + 1) // 2
        v = v[np.any(v != np.roll(v, 1, axis=0), axis=1)]
        return v if len(v) >= 3 else None

    out = []
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1:
            continue
        outer = conv(c)
        if outer is None:
            continue
        holes = []
        j = hier[i][2]
        while j != -1:
            h = conv(cs[j])
            if h is not None:
                holes.append(h)
            j = hier[j][0]
        out.append((outer, holes))
    return out


def smooth_polygon(v, corner_run):
    """계단 다각형 → 직선 구간 중점을 이은 다각형 (+ 긴 구간 사이의 모서리).

    돌려주는 값: pts (m,2) float, corner (m,) bool
    """
    # 방향이 바뀌는 꼭짓점만 남긴다
    d = np.roll(v, -1, axis=0) - v
    dprev = np.roll(d, 1, axis=0)
    turn = np.any(np.sign(d) != np.sign(dprev), axis=1)
    v = v[turn]
    if len(v) < 3:
        return None, None
    seg = np.roll(v, -1, axis=0) - v
    ln = np.abs(seg).sum(axis=1)
    mid = v + seg / 2.0
    # 꼭짓점 i+1은 구간 i와 i+1 사이에 있다
    keep_corner = (ln >= corner_run) & (np.roll(ln, -1) >= corner_run)
    m = len(v)
    k = keep_corner.astype(np.int64)
    pos = np.arange(m) + np.concatenate([[0], np.cumsum(k)[:-1]])
    pts = np.empty((m + int(k.sum()), 2))
    corner = np.zeros(len(pts), bool)
    pts[pos] = mid
    cpos = pos[keep_corner] + 1
    pts[cpos] = v[(np.nonzero(keep_corner)[0] + 1) % m]
    corner[cpos] = True
    return pts, corner


def taubin(pts, corner, iters):
    """닫힌 다각형을 Taubin(λ|μ) 방식으로 다듬는다: 오그라들지 않고 잔떨림만 준다. 모서리는 고정.

    안티앨리어싱된 경계 화소는 어느 쪽 영역에 붙을지가 들쭉날쭉해서 경계에 ±0.5px 계단 잡음이 남는다.
    """
    if iters <= 0 or len(pts) < 8:
        return pts
    free = ~corner[:, None]
    p = pts.copy()
    for _ in range(iters):
        for f in (0.5, -0.53):
            lap = (np.roll(p, 1, axis=0) + np.roll(p, -1, axis=0)) / 2 - p
            p = p + f * lap * free
    return p


def fill_at(fills, regs, P):
    """영역 regs의 채우기 색을 점 P(원본 px)에서 계산한다 (그라디언트는 투영해서 섞는다)."""
    c0 = fills['c0'][regs]
    out = c0.copy()
    g = fills['kind'][regs] == 1
    if g.any():
        p0, p1 = fills['p0'][regs[g]], fills['p1'][regs[g]]
        d = p1 - p0
        t = np.clip(((P[g] - p0) * d).sum(axis=1) / np.maximum((d * d).sum(axis=1), 1e-9), 0, 1)
        out[g] = c0[g] + t[:, None] * (fills['c1'][regs[g]] - c0[g])
    return out


def refine_edges(pts, corner, r, ctx):
    """꼭짓점을 법선 방향으로 옮겨 원본의 안티앨리어싱 경계(안팎 색의 50% 지점)에 맞춘다.

    앞에 칠한 영역과 맞닿은 쪽만 옮긴다. 뒤에 칠할 영역 쪽은 그 영역이 다시 덮으므로 그대로 두어
    1px 겹침(틈 방지)을 지킨다. pts·결과는 라벨 격자 좌표(scale배).
    """
    n = len(pts)
    if n < 6:
        return pts
    lab, rank, img, fills, scale, mask, ox, oy = ctx
    hh, ww = lab.shape
    tang = np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)
    nrm = np.stack([tang[:, 1], -tang[:, 0]], axis=1)
    nrm /= np.maximum(np.hypot(nrm[:, 0], nrm[:, 1]), 1e-9)[:, None]

    def at(P, arr, off=(0, 0)):
        ix = np.floor(P[:, 0]).astype(np.int64) - off[0]
        iy = np.floor(P[:, 1]).astype(np.int64) - off[1]
        ok = (ix >= 0) & (iy >= 0) & (ix < arr.shape[1]) & (iy < arr.shape[0])
        v = np.full(len(P), -1, np.int64)
        v[ok] = arr[iy[ok], ix[ok]]
        return v, ok

    # 법선이 도형 바깥을 보게 맞춘다
    probe = 0.6 * scale
    ins, _ = at(pts - probe * nrm, mask, (ox, oy))
    outs, _ = at(pts + probe * nrm, mask, (ox, oy))
    if (ins == 1).sum() < (outs == 1).sum():
        nrm = -nrm
    other, ok = at(pts + probe * nrm, lab)
    cand = ok & ~corner & (other >= 0)
    cand[cand] &= rank[other[cand]] < rank[r]
    if not cand.any():
        return pts
    idx = np.nonzero(cand)[0]
    P, N = pts[idx], nrm[idx]
    Po = P / scale
    c_in = fill_at(fills, np.full(len(idx), r), Po)
    c_out = fill_at(fills, other[idx], Po)
    axis = c_out - c_in
    a2 = (axis * axis).sum(axis=1)
    good = a2 >= REFINE['contrast'] ** 2
    ts = np.linspace(-REFINE['reach'], REFINE['reach'], 13) * scale
    S = P[:, None, :] + ts[None, :, None] * N[:, None, :]
    mx = (S[..., 0] - 0.5).astype(np.float32)
    my = (S[..., 1] - 0.5).astype(np.float32)
    col = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
    proj = ((col - c_in[:, None, :]) * axis[:, None, :]).sum(axis=2) / np.maximum(a2, 1e-9)[:, None] - 0.5
    # 0.5를 지나는 곳 중 지금 자리(t=0)에 가장 가까운 곳
    cross = (proj[:, :-1] <= 0) & (proj[:, 1:] > 0)
    tc = ts[:-1] + (ts[1] - ts[0]) * (-proj[:, :-1]) / np.maximum(proj[:, 1:] - proj[:, :-1], 1e-9)
    tc = np.where(cross, tc, np.inf)
    best = np.argmin(np.abs(tc), axis=1)
    t = tc[np.arange(len(idx)), best]
    good &= np.isfinite(t)
    lim = REFINE['move'] * scale
    d = np.where(good, np.clip(t, -lim, lim), 0.0)
    out = pts.copy()
    out[idx] += d[:, None] * N
    return out


def seg_dist(p, a, b):
    """점들 p에서 선분 ab까지 거리."""
    ab = b - a
    ll = float(ab @ ab)
    if ll < 1e-12:
        return np.hypot(*(p - a).T)
    t = np.clip(((p - a) @ ab) / ll, 0, 1)
    q = a + t[:, None] * ab
    return np.hypot(*(p - q).T)


def dp_open(chain, eps):
    """열린 사슬의 Douglas–Peucker (선분 거리). 남길 색인 배열을 돌려준다."""
    keep = np.zeros(len(chain), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(chain) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        d = seg_dist(chain[i + 1 : j], chain[i], chain[j])
        k = int(np.argmax(d))
        if d[k] > eps:
            k += i + 1
            keep[k] = True
            stack.append((i, k))
            stack.append((k, j))
    return np.nonzero(keep)[0]


def simplify(pts, corner, eps=None):
    """모서리를 지키며 Douglas–Peucker로 줄인다.

    닫힌 다각형은 기준점(모서리, 없으면 서로 가장 먼 두 점) 사이 사슬로 나눠 각각 줄인다.
    """
    eps = DP_EPS if eps is None else eps
    m = len(pts)
    if m <= 4:
        return pts, corner
    anchors = list(np.nonzero(corner)[0])
    if not anchors:
        anchors = [0]
    if len(anchors) == 1:
        a0 = anchors[0]
        far = int(np.argmax(np.hypot(*(pts - pts[a0]).T)))
        anchors = sorted([a0, far]) if far != a0 else [a0]
    out, oc = [], []
    for j in range(len(anchors)):
        s, e = anchors[j], anchors[(j + 1) % len(anchors)]
        idx = np.arange(s, e + 1) if e > s else np.concatenate([np.arange(s, m), np.arange(0, e + 1)])
        keep = idx[dp_open(pts[idx], eps)]
        out.append(keep[:-1])
    sel = np.concatenate(out)
    return pts[sel], corner[sel]


def mark_corners(pts, corner):
    """많이 꺾이는 꼭짓점도 모서리로 표시한다."""
    a = pts - np.roll(pts, 1, axis=0)
    b = np.roll(pts, -1, axis=0) - pts
    na = np.hypot(a[:, 0], a[:, 1]) + 1e-9
    nb = np.hypot(b[:, 0], b[:, 1]) + 1e-9
    cosang = (a * b).sum(axis=1) / (na * nb)
    return corner | (cosang < np.cos(np.radians(CORNER_ANGLE)))


def build_shapes(lab, scale, group=None, img=None, fills=None):
    """영역 라벨(scale배 크기) → 칠하는 순서대로 (영역, 꼭짓점(원본 px), 모서리) 목록.

    group[r]이 주어지면 그룹 번호가 작은 영역을 먼저 칠한다 (그룹 안에서는 면적순).
    앞 그룹 영역을 품은 구멍은 메우지 않는다.
    """
    n = int(lab.max()) + 1
    hh, ww = lab.shape
    group = np.zeros(n, np.int64) if group is None else group
    objs = ndi.find_objects(lab + 1)
    # 칠하는 순서: 그룹, 그다음 구멍을 메운 면적이 큰 것부터
    filled_area = np.zeros(n)
    for r, sl in enumerate(objs):
        filled_area[r] = ndi.binary_fill_holes(lab[sl] == r).sum()
    order = np.lexsort((np.arange(n), -filled_area, group))
    rank = np.empty(n, np.int64)
    rank[order] = np.arange(n)
    rmap = rank[lab]
    kernel = np.ones((2 * scale + 1, 2 * scale + 1), np.uint8)  # 원본 1px만큼 넓힌다
    pad = scale
    shapes = []
    t0 = time.time()
    for r in order:
        sl = objs[r]
        y0, y1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, hh)
        x0, x1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, ww)
        a = lab[y0:y1, x0:x1] == r
        later = rmap[y0:y1, x0:x1] > rank[r]
        filled = fill_later_holes(a, a, later)
        ring = cv2.dilate(a.astype(np.uint8), kernel).astype(bool) & later
        s = fill_later_holes(filled | ring, a, later)
        rctx = (lab, rank, img, fills, scale, s, x0, y0)
        for outer, holes in crack_contours(s):
            subs = []
            for v in [outer] + holes:
                pts, corner = smooth_polygon(v + (x0, y0), CORNER_RUN * scale)
                if pts is not None:
                    pts = taubin(pts, corner, SMOOTH_ITERS)
                    if img is not None:
                        pts = refine_edges(pts, corner, r, rctx)
                    pts, corner = simplify(pts, corner, DP_EPS * scale)
                if pts is None or len(pts) < 3:
                    if not subs:
                        break  # 바깥 윤곽이 사라지면 구멍도 버린다
                    continue
                subs.append((pts / scale, mark_corners(pts, corner)))
            if subs:
                shapes.append((int(r), subs))
    nv = sum(len(p) for _, subs in shapes for p, _ in subs)
    log(f'외곽선: 도형 {len(shapes)}개, 꼭짓점 {nv}개, {time.time() - t0:.1f}s')
    return shapes


def fill_later_holes(m, own, later):
    """마스크 m의 구멍을 메우되, 앞에 칠한 영역이 든 구멍은 남긴다 (남은 구멍은 하위 경로가 된다).

    뒤에 칠할 영역만 든 구멍은 메워도 그 영역이 다시 덮으므로, 메우는 편이 도형이 단순하다.
    """
    full = ndi.binary_fill_holes(m)
    holes = full & ~m
    if not holes.any():
        return full
    bad = holes & ~later & ~own
    if not bad.any():
        return full
    # 앞 영역이 든 구멍만 남기고 나머지를 메운다
    hl, nh = ndi.label(holes)
    badl = np.unique(hl[bad])
    keep = np.isin(hl, badl)
    return full & ~keep


# ── 선화(잉크) 층 ─────────────────────────────────────
def face_ellipse(xx, yy):
    """얼굴 타원 정규화 거리^2 (1이면 타원 경계)."""
    return ((xx - 885) / 215) ** 2 + ((yy - 290) / 200) ** 2


def ink_layer(ref):
    """얇고 어두운 획(선화)을 1/up px 정밀도의 채운 도형으로 뽑는다.

    깊이 = (회색조 닫힘 − 회색조): 닫힘 반지름보다 가는 어두운 획에서만 커진다.
    획의 경계는 깊이가 국소 최대 깊이의 절반이 되는 곳(안티앨리어싱된 선의 50% 지점)이다.
    돌려주는 값: 도형 목록 [(색, [(꼭짓점, 모서리), ...])], 1x 잉크 마스크
    """
    t0 = time.time()
    up = INK['up']
    gray = (ref @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)
    r = INK['close_r']
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    closed = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, k)
    depth = np.clip(closed - gray, 0, None)
    depth[closed < INK['min_bg']] = 0
    dloc = cv2.dilate(depth, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    # 관심 영역(얼굴 타원)의 상자만 확대한다
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    roi = face_ellipse(xx, yy) < INK['roi'] ** 2
    ys, xs = np.nonzero(roi)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    size = ((x1 - x0) * up, (y1 - y0) * up)
    d4 = cv2.resize(depth[y0:y1, x0:x1], size, interpolation=cv2.INTER_CUBIC)
    l4 = cv2.resize(dloc[y0:y1, x0:x1], size, interpolation=cv2.INTER_LINEAR)
    r4 = cv2.resize(roi[y0:y1, x0:x1].astype(np.uint8), size, interpolation=cv2.INTER_NEAREST) > 0
    mask = ((d4 >= 0.5 * l4) & (l4 >= INK['min_depth']) & r4).astype(np.uint8)
    # 조각별 색: 도형이 덮는 자리의 원본 평균 (평면색 하나로 칠할 때 제곱오차가 가장 작다)
    ncomp, comp = cv2.connectedComponents(mask, connectivity=8)
    big = cv2.resize(ref[y0:y1, x0:x1], size, interpolation=cv2.INTER_CUBIC)
    wgt = mask.astype(np.float64)
    cols = np.zeros((ncomp, 3))
    wsum = np.bincount(comp.ravel(), weights=wgt.ravel(), minlength=ncomp) + 1e-9
    for c in range(3):
        cols[:, c] = np.bincount(comp.ravel(), weights=(wgt * big[..., c]).ravel(), minlength=ncomp) / wsum
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    shapes = []
    if hier is not None:
        hier = hier[0]
        for i, c in enumerate(cs):
            if hier[i][3] != -1:
                continue  # 구멍은 바깥 윤곽과 함께 처리
            subs = [c]
            j = hier[i][2]
            while j != -1:
                subs.append(cs[j])
                j = hier[j][0]
            area = (cv2.contourArea(c) - sum(cv2.contourArea(h) for h in subs[1:])) / up**2
            if area < INK['min_area']:
                continue
            q = c[0, 0]
            col = cols[comp[q[1], q[0]]]
            out = []
            for sc in subs:
                pts = (sc[:, 0, :].astype(np.float64) + 0.5) / up + (x0, y0)
                if len(pts) < 3:
                    continue
                pts, corner = simplify(pts, np.zeros(len(pts), bool), INK['eps'])
                if len(pts) < 3:
                    continue
                out.append((pts, mark_corners(pts, corner)))
            if out:
                shapes.append((col, out))
    ink1 = cv2.resize(mask, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA) > 0
    full = np.zeros((H, W), bool)
    full[y0:y1, x0:x1] = ink1
    nv = sum(len(p) for _, subs in shapes for p, _ in subs)
    log(f'선화: 도형 {len(shapes)}개, 꼭짓점 {nv}개, {time.time() - t0:.1f}s')
    return shapes, full


# ── 5. 인코딩 ─────────────────────────────────────────
def varints(vals):
    """음이 아닌 정수 배열 → LEB128 바이트열."""
    vals = np.asarray(vals, dtype=np.int64)
    if vals.size and vals.min() < 0:
        raise ValueError('음수 varint')
    out = bytearray()
    for v in vals.tolist():
        while v >= 0x80:
            out.append((v & 0x7F) | 0x80)
            v >>= 7
        out.append(v)
    return bytes(out)


def zz(v):
    v = np.asarray(v, dtype=np.int64)
    return np.where(v >= 0, v * 2, -v * 2 - 1)


def encode(layers, base, blurs):
    """도형 층들 → zlib 압축 바이너리.

    layers: [[도형, ...], ...]. 도형 = (채우기, [(꼭짓점(원본 px), 모서리), ...])
    blurs: 층마다 합성할 때 거는 흐림 반지름(px)
    채우기 = ('flat', rgb) 또는 ('lin', rgb0, rgb1, p0, p1)
    """
    kind = bytearray()
    color = bytearray()
    counts = []
    starts = []
    deltas = []
    prev = np.zeros(2, np.int64)
    nshape = 0
    for layer in layers:
        for fill, subs in layer:
            nshape += 1
            kind.append(1 if fill[0] == 'lin' else 0)
            color += bytes(np.clip(np.round(fill[1]), 0, 255).astype(np.uint8))
            if fill[0] == 'lin':
                color += bytes(np.clip(np.round(fill[2]), 0, 255).astype(np.uint8))
                ends = np.round(np.r_[fill[3], fill[4]] * 2).astype(np.int64)
                color += varints(np.clip(ends, 0, None))
            for si, (pts, corner) in enumerate(subs):
                q = np.round(pts * COORD_UNIT).astype(np.int64)
                more = 1 if si + 1 < len(subs) else 0
                # 꼭짓점 수 · 첫 점의 모서리 표시 · 같은 도형의 하위 경로가 더 있는지
                counts.append((len(q) << 2) | (int(corner[0]) << 1) | more)
                starts.append(q[0] - prev)
                prev = q[0]
                d = np.diff(q, axis=0)
                dv = np.empty((len(d), 2), np.int64)
                dv[:, 0] = (zz(d[:, 0]) << 1) | corner[1:].astype(np.int64)
                dv[:, 1] = zz(d[:, 1])
                deltas.append(dv.ravel())
    streams = [
        bytes(kind),
        bytes(color),
        varints(counts),
        varints(zz(np.array(starts).ravel())),
        varints(np.concatenate(deltas)),
    ]
    head = b'TRC4' + np.array([W, H], '<u2').tobytes() + np.array([nshape], '<u4').tobytes()
    head += bytes(np.clip(np.round(base), 0, 255).astype(np.uint8)) + bytes([COORD_UNIT, len(layers)])
    for layer, blur in zip(layers, blurs):
        head += np.array([len(layer)], '<u4').tobytes() + bytes([int(round(blur * 10))])
    head += np.array([len(s) for s in streams], '<u4').tobytes()
    raw = head + b''.join(streams)
    comp = zlib.compress(raw, 9)
    names = 'kind color count start delta'.split()
    log('스트림 바이트: ' + ', '.join(f'{n}={len(s)}' for n, s in zip(names, streams)))
    log(f'인코딩: 원본 {len(raw)} B → zlib {len(comp)} B')
    return comp


def region_layer(shapes, fills):
    """영역 도형 → encode용 도형 목록."""
    out = []
    for r, subs in shapes:
        if fills['kind'][r] == 1:
            fill = ('lin', fills['c0'][r], fills['c1'][r], fills['p0'][r], fills['p1'][r])
        else:
            fill = ('flat', fills['c0'][r])
        out.append((fill, subs))
    return out


def vtracer_baseline(path):
    """비교용 기준선: vtracer(0.6.15에서 확인)로 원본을 SVG로 바꿔 path에 쓴다.

    최종 데이터는 vtracer를 쓰지 않는다. 같은 렌더·비교 도구로 쟀을 때 (path_precision=1)
    vtracer 기본 설정은 7.7MB SVG에 ssim_small 0.904 / dE 5.43, 이 생성기는 1MB 안쪽에 0.98대였다.
    """
    try:
        import vtracer  # pip install vtracer==0.6.15
    except ImportError:
        sys.exit('vtracer가 없습니다: pip install vtracer==0.6.15')
    t0 = time.time()
    vtracer.convert_image_to_svg_py(
        REF, path, colormode='color', hierarchical='stacked', mode='spline', path_precision=1
    )
    log(f'vtracer: {path} ({os.path.getsize(path)} B), {time.time() - t0:.1f}s')


def write_js(comp, path):
    b64 = base64.b64encode(comp).decode('ascii')
    with open(path, 'w') as f:
        f.write('// tools/gen_trace.py가 만든다. 직접 고치지 않는다.\n')
        f.write('window.ConcertData = window.ConcertData || {};\n')
        f.write(f"window.ConcertData.trace = '{b64}';\n")
    log(f'썼음: {path} ({os.path.getsize(path)} B)')


def main():
    global DP_EPS
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--cache', help='분할 결과 캐시 폴더')
    ap.add_argument('--scale', type=int, default=SCALE)
    ap.add_argument('--ink', action='store_true', help='선화(잉크) 층을 더한다 (실험: 지금 밀도에서는 오차가 조금 늘어 기본은 끔)')
    ap.add_argument('--inpaint', action='store_true', help='선 아래를 메운 그림으로 분할한다')
    ap.add_argument('--no-soft', action='store_true', help='배경 층을 나누지 않는다')
    ap.add_argument('--no-refine', action='store_true', help='경계를 원본의 50%% 지점으로 옮기지 않는다')
    ap.add_argument('--blur', type=float, default=SOFT_BLUR, help='배경 층 흐림 반지름(px, 1 이상이어야 효과)')
    for k in SEG:
        ap.add_argument('--' + k, type=float, default=None, help=f'분할 설정 (기본 {SEG[k]})')
    ap.add_argument('--dp-eps', type=float, default=None, help=f'외곽선 단순화 허용 오차 px (기본 {DP_EPS})')
    ap.add_argument('--vtracer', metavar='SVG', help='비교용 vtracer SVG만 만들고 끝낸다')
    args = ap.parse_args()
    if args.dp_eps is not None:
        DP_EPS = args.dp_eps
    if args.vtracer:
        vtracer_baseline(args.vtracer)
        return
    for k in SEG:
        if getattr(args, k) is not None:
            SEG[k] = getattr(args, k)
    t0 = time.time()
    ref = load_ref()
    sc = args.scale
    log(f'설정: scale {sc}, ' + ', '.join(f'{k} {v:g}' for k, v in SEG.items()))
    ink, inkmask = ink_layer(ref) if args.ink else ([], None)
    src = ref
    if inkmask is not None and args.inpaint:
        # 선 아래의 바탕색을 메워서 분할한다 (선은 잉크 층이 그린다)
        m = cv2.dilate(inkmask.astype(np.uint8), np.ones((3, 3), np.uint8))
        src = cv2.inpaint(np.clip(ref, 0, 255).astype(np.uint8), m, 3, cv2.INPAINT_TELEA).astype(np.float32)
    img = cv2.resize(src, (W * sc, H * sc), interpolation=cv2.INTER_CUBIC) if sc > 1 else src
    img = np.clip(img, 0, 255)
    lab = segment(img, face_weight(sc), args.cache)
    fills = fit_fills(img, lab, sc)
    # 배경 마스크에 절반 넘게 든 영역은 배경 층(그룹 0), 나머지는 인물 층(그룹 1)
    group = np.ones(int(lab.max()) + 1, np.int64)
    if os.path.exists(BG_MASK) and not args.no_soft:
        bgm = np.asarray(Image.open(BG_MASK).convert('L').resize((W * sc, H * sc), Image.NEAREST)) > 127
        frac = np.bincount(lab.ravel(), weights=bgm.ravel()) / np.bincount(lab.ravel())
        group = (frac < 0.5).astype(np.int64)
    else:
        log('배경 마스크를 쓰지 않음: 배경·인물 층을 나누지 않는다')
    shapes = build_shapes(lab, sc, group, None if args.no_refine else img.astype(np.float32), fills)
    soft = [sh for sh in shapes if group[sh[0]] == 0]
    sharp = [sh for sh in shapes if group[sh[0]] == 1]
    layers = [region_layer(soft, fills), region_layer(sharp, fills), [(('flat', c), subs) for c, subs in ink]]
    blurs = [args.blur, 0, 0]
    log(f'층: 배경 {len(soft)}, 인물 {len(sharp)}, 선화 {len(ink)}')
    comp = encode(layers, ref.reshape(-1, 3).mean(axis=0), blurs)
    write_js(comp, args.out)
    log(f'끝: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
