// primitive.c — 반투명 도형을 하나씩 더해 원본 그림을 근사하는 최적화기.
//
// 1단계 (탐욕적 추가, fogleman/primitive·Geometrize와 같은 방식)
//   원본의 평균색으로 칠한 캔버스에서 시작한다. 매 단계 무작위 후보를 많이 만들고(오차가 큰 곳을
//   더 자주 고른다), 상위 몇 개를 언덕 오르기로 다듬어, 오차를 가장 많이 줄이는 도형 하나를 확정한다.
//   도형의 색은 주어진 알파에서 오차를 최소로 하는 값을 닫힌 식으로 구한다.
//
// 2단계 (다시 맞추기 sweep)
//   도형 k 하나만 빼고 나머지를 고정하면, k 주변 창에서 최종 화면은 τ·X + R 꼴이다.
//   (X = k까지 그린 화면, τ = k 위에 올라간 도형들의 투과율, R = 그 도형들이 더한 색)
//   그래서 목표 (t − R)/τ, 가중치 w·τ²로 바꾸면 1단계와 똑같은 문제가 되고, k의 모양·색·알파를
//   다시 언덕 오르기로 고칠 수 있다. 모든 도형을 차례로 돌며 몇 바퀴 반복한다.
//
// 속도의 핵심: 도형이 덮는 화소를 행별 구간(span)으로 나타내고, 행 누적합(prefix sum)으로
// Σw, Σw·t, Σw·c, Σw·c², Σw·t·c를 구하면 최적색과 오차 변화량이 행마다 O(1)에 나온다.
// 그래서 화면을 다 덮는 도형도 평가 비용이 넓이가 아니라 행 수에만 비례한다.
//
// 오차는 YCbCr(오프셋 없는 선형 변환) 공간에서 채널 가중치 λ를 둔 가중 제곱오차다.
// 합성은 캔버스처럼 sRGB 값 공간의 알파 블렌딩이고, 선형 변환과 교환되므로 YCbCr에서 그대로 계산된다.
// 좌표 단위는 원본 1254px의 반 픽셀(0.5px)이다. 저장 형식과 같아서 최적화한 값이 그대로 그려진다.
//
// 빌드: gcc -O3 -ffp-contract=off -o primitive primitive.c -lm
// 사용: primitive --target t.rgb --weight w.f32 --size 1254 --n 5000 --out shapes.bin [옵션]
//   t.rgb   size×size RGB 바이트, w.f32 size×size float32 중요도
//
// 출력 바이너리 (리틀 엔디언)
//   'PRM2', u32 개수, u8 배경 r,g,b, u8 단위 분모(2), u16 좌표 오프셋(627)
//   도형마다 u8 종류, u8 r,g,b,a, 그 뒤 종류별 인자. 값은 12비트이고 두 개씩 3바이트에 담는다
//   (v0 = b0 | (b1 & 15) << 8, v1 = b1 >> 4 | b2 << 4). 좌표는 오프셋을 더해 0..4095로 저장한다.
//     0 삼각형   x1,y1,x2,y2,x3,y3
//     1 타원     cx,cy,rx,ry, u8 각도(π/256 단위)
//     2 사각형   cx,cy,hw,hh, u8 각도
//     3 곡선 획  x0,y0,cx,cy,x1,y1, u8 굵기 (2차 베지어, 둥근 끝)
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define FULL 1254
#define UNITS (FULL * 2)
#define NQ 13
#define MAXSEG 20
#define CLO (-UNITS / 4)
#define CHI (UNITS + UNITS / 4)
#define RMAX 4000  // 반지름 상한 (12비트 저장)

enum { T_TRI = 0, T_ELL = 1, T_RECT = 2, T_STROKE = 3, NTYPES = 4 };
static const int NPARAM[NTYPES] = {6, 5, 5, 7};
static const char *TNAME[NTYPES] = {"tri", "ell", "rect", "stroke"};

typedef struct {
  int type;
  int p[7];
  int a;
  int rgb[3];
  double delta;
} Shape;

typedef struct {
  int y, x0, x1;
} Span;

// 평가 문맥: 화면 전체 또는 창 하나. 누적합 P는 h행 × (w+1)열 × NQ.
typedef struct {
  int ox, oy, w, h;
  int local;  // 창이면 1: 창 밖으로 나가는 도형은 평가하지 않는다
  double *P;
  double *cdf;
} Ctx;

// ── 설정 ──────────────────────────────────────────────
static int S = 1254;           // 작업 해상도
static double F;               // 단위 → 작업 화소
static int NSHAPES = 5000;
static int CANDS = 2000;       // 단계마다 무작위 후보 수
static int TOPK = 6;           // 언덕 오르기로 다듬을 후보 수
static int AGE = 250;          // 연속 실패 허용 횟수
static int MAXIT = 3000;       // 후보 하나당 최대 변이 횟수
static int ALPHA0 = 128;       // 처음 알파
static int AMIN = 24;          // 알파 하한
static double PERR = 0.75;     // 오차 지도로 위치를 고를 확률 (나머지는 균등)
static double TYPEW[NTYPES] = {0.35, 0.25, 0.15, 0.25};
static double LAM[3] = {1.0, 1.0, 1.0};
static int SWEEPS = 4;         // 끝에 2단계를 반복하는 횟수
static int SW_CANDS = 150;     // 2단계: 창 안 무작위 후보 수
static int SW_TOPK = 3;
static int SW_AGE = 200;
static int SW_EVERY = 500;     // 1단계 중 이만큼 더할 때마다 한 바퀴씩 다시 맞춘다 (0이면 끝에만)
static uint64_t SEED = 1254;

// ── 상태 ──────────────────────────────────────────────
static double *tgt;   // 3*N YCbCr 목표
static double *cur;   // 3*N YCbCr 현재 화면
static double *gw;    // N 중요도
static double *gwt;   // 3*N w·t
static double *P;     // 누적합 (전체와 창이 함께 쓴다)
static double *cdf;
static double *lw, *lwt, *lc, *ltau, *lR;  // 창 배열
static Span *spans;
static unsigned char *rowMark;
static int clipY0, clipY1;  // 래스터화할 행 범위
static double bgc[3];
static int bg[3];

typedef struct {
  int x0, y0, x1, y1;
} Box;

// ── 난수 (xorshift64*) ───────────────────────────────
static uint64_t rs = 88172645463325252ULL;
static inline uint64_t rnext(void) {
  rs ^= rs >> 12;
  rs ^= rs << 25;
  rs ^= rs >> 27;
  return rs * 2685821657736338717ULL;
}
static inline double rnd(void) { return (double)(rnext() >> 11) * (1.0 / 9007199254740992.0); }
static inline double rgauss(void) {
  double u = rnd(), v = rnd();
  if (u < 1e-300) u = 1e-300;
  return sqrt(-2.0 * log(u)) * cos(2.0 * M_PI * v);
}
static inline int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline int maxi(int a, int b) { return a > b ? a : b; }
static inline int mini(int a, int b) { return a < b ? a : b; }

// ── 색 변환 ───────────────────────────────────────────
static inline void rgb2ycc(double r, double g, double b, double *o) {
  o[0] = 0.299 * r + 0.587 * g + 0.114 * b;
  o[1] = -0.168736 * r - 0.331264 * g + 0.5 * b;
  o[2] = 0.5 * r - 0.418688 * g - 0.081312 * b;
}
static inline void ycc2rgb(const double *c, double *o) {
  o[0] = c[0] + 1.402 * c[2];
  o[1] = c[0] - 0.344136 * c[1] - 0.714136 * c[2];
  o[2] = c[0] + 1.772 * c[1];
}

// ── 래스터화: 화소 중심 (x+0.5, y+0.5)이 도형 안에 드는 화소를 행별 구간으로 ──
static inline int emit(Span *sp, int n, int y, double xl, double xr) {
  int x0 = (int)ceil(xl - 0.5), x1 = (int)ceil(xr - 0.5) - 1;
  if (x0 < 0) x0 = 0;
  if (x1 > S - 1) x1 = S - 1;
  if (x0 <= x1) {
    sp[n].y = y;
    sp[n].x0 = x0;
    sp[n].x1 = x1;
    n++;
  }
  return n;
}

static inline void yRange(double lo, double hi, int *y0, int *y1) {
  *y0 = (int)ceil(lo - 0.5);
  *y1 = (int)ceil(hi - 0.5) - 1;
  if (*y0 < clipY0) *y0 = clipY0;
  if (*y1 > clipY1) *y1 = clipY1;
}

// 볼록 다각형과 행 중심선의 교차 구간
static inline int polyRow(const double *xs, const double *ys, int nv, double yc, double *xl, double *xr) {
  double lo = 1e30, hi = -1e30;
  for (int i = 0; i < nv; i++) {
    int j = i + 1 == nv ? 0 : i + 1;
    double ya = ys[i], yb = ys[j];
    if ((ya <= yc && yc < yb) || (yb <= yc && yc < ya)) {
      double x = xs[i] + (yc - ya) * (xs[j] - xs[i]) / (yb - ya);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  *xl = lo;
  *xr = hi;
  return lo < hi;
}

static int rasterConvex(const double *xs, const double *ys, int nv, Span *sp) {
  double miny = ys[0], maxy = ys[0];
  for (int i = 1; i < nv; i++) {
    if (ys[i] < miny) miny = ys[i];
    if (ys[i] > maxy) maxy = ys[i];
  }
  int y0, y1, n = 0;
  yRange(miny, maxy, &y0, &y1);
  for (int y = y0; y <= y1; y++) {
    double xl, xr;
    if (polyRow(xs, ys, nv, y + 0.5, &xl, &xr)) n = emit(sp, n, y, xl, xr);
  }
  return n;
}

static int rasterEllipse(double cx, double cy, double rx, double ry, double th, Span *sp) {
  double c = cos(th), s = sin(th);
  double irx2 = 1.0 / (rx * rx), iry2 = 1.0 / (ry * ry);
  double A = c * c * irx2 + s * s * iry2;
  double Bk = 2.0 * c * s * (irx2 - iry2);
  double Ck = s * s * irx2 + c * c * iry2;
  double hh = sqrt(rx * rx * s * s + ry * ry * c * c);
  int y0, y1, n = 0;
  yRange(cy - hh, cy + hh, &y0, &y1);
  for (int y = y0; y <= y1; y++) {
    double dy = y + 0.5 - cy;
    double B = Bk * dy, C = Ck * dy * dy - 1.0;
    double disc = B * B - 4.0 * A * C;
    if (disc <= 0) continue;
    double sq = sqrt(disc);
    n = emit(sp, n, y, cx + (-B - sq) / (2.0 * A), cx + (-B + sq) / (2.0 * A));
  }
  return n;
}

// 둥근 끝 선분(캡슐)과 행 중심선의 교차 구간. 캡슐은 볼록하므로 한 구간이다.
typedef struct {
  double ax, ay, bx, by, ylo, yhi;
  double qx[4], qy[4];
  int body;
} Capsule;

static int capsuleRow(const Capsule *k, double r, double yc, double *xl, double *xr) {
  double lo = 1e30, hi = -1e30, d, h;
  d = yc - k->ay;
  if (d * d <= r * r) {
    h = sqrt(r * r - d * d);
    if (k->ax - h < lo) lo = k->ax - h;
    if (k->ax + h > hi) hi = k->ax + h;
  }
  d = yc - k->by;
  if (d * d <= r * r) {
    h = sqrt(r * r - d * d);
    if (k->bx - h < lo) lo = k->bx - h;
    if (k->bx + h > hi) hi = k->bx + h;
  }
  if (k->body) {
    double a, b;
    if (polyRow(k->qx, k->qy, 4, yc, &a, &b)) {
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
  }
  *xl = lo;
  *xr = hi;
  return lo < hi;
}

static int rasterStroke(const double *px, const double *py, double r, Span *sp) {
  // 2차 베지어를 짧은 선분으로 나눈다. 캔버스의 둥근 끝·둥근 이음 선과 같은 모양이 된다.
  double len = hypot(px[1] - px[0], py[1] - py[0]) + hypot(px[2] - px[1], py[2] - py[1]);
  int m = (int)(len / 5.0) + 1;
  if (m > MAXSEG) m = MAXSEG;
  double xs[MAXSEG + 1], ys[MAXSEG + 1];
  for (int i = 0; i <= m; i++) {
    double t = (double)i / m, u = 1.0 - t;
    xs[i] = u * u * px[0] + 2 * u * t * px[1] + t * t * px[2];
    ys[i] = u * u * py[0] + 2 * u * t * py[1] + t * t * py[2];
  }
  Capsule caps[MAXSEG];
  double miny = 1e30, maxy = -1e30;
  for (int i = 0; i < m; i++) {
    Capsule *k = &caps[i];
    k->ax = xs[i];
    k->ay = ys[i];
    k->bx = xs[i + 1];
    k->by = ys[i + 1];
    k->ylo = fmin(k->ay, k->by) - r;
    k->yhi = fmax(k->ay, k->by) + r;
    double dx = k->bx - k->ax, dy = k->by - k->ay, L = hypot(dx, dy);
    k->body = L > 1e-9;
    if (k->body) {
      double nx = -dy / L * r, ny = dx / L * r;
      k->qx[0] = k->ax + nx, k->qy[0] = k->ay + ny;
      k->qx[1] = k->bx + nx, k->qy[1] = k->by + ny;
      k->qx[2] = k->bx - nx, k->qy[2] = k->by - ny;
      k->qx[3] = k->ax - nx, k->qy[3] = k->ay - ny;
    }
    if (k->ylo < miny) miny = k->ylo;
    if (k->yhi > maxy) maxy = k->yhi;
  }
  int y0, y1, n = 0;
  yRange(miny, maxy, &y0, &y1);
  for (int y = y0; y <= y1; y++) {
    double yc = y + 0.5;
    int ix0[MAXSEG], ix1[MAXSEG], cnt = 0;
    for (int i = 0; i < m; i++) {
      const Capsule *k = &caps[i];
      if (yc < k->ylo || yc > k->yhi) continue;
      double xl, xr;
      if (!capsuleRow(k, r, yc, &xl, &xr)) continue;
      int a = (int)ceil(xl - 0.5), b = (int)ceil(xr - 0.5) - 1;
      if (a < 0) a = 0;
      if (b > S - 1) b = S - 1;
      if (a > b) continue;
      int j = cnt++;  // x0 순으로 삽입
      while (j > 0 && ix0[j - 1] > a) {
        ix0[j] = ix0[j - 1];
        ix1[j] = ix1[j - 1];
        j--;
      }
      ix0[j] = a;
      ix1[j] = b;
    }
    // 겹치는 구간을 합친다 (겹친 곳을 두 번 칠하지 않게)
    for (int i = 0; i < cnt;) {
      int a = ix0[i], b = ix1[i];
      int j = i + 1;
      while (j < cnt && ix0[j] <= b + 1) {
        if (ix1[j] > b) b = ix1[j];
        j++;
      }
      sp[n].y = y;
      sp[n].x0 = a;
      sp[n].x1 = b;
      n++;
      i = j;
    }
  }
  return n;
}

static int raster(const Shape *s, Span *sp) {
  const int *p = s->p;
  switch (s->type) {
    case T_TRI: {
      double xs[3] = {p[0] * F, p[2] * F, p[4] * F};
      double ys[3] = {p[1] * F, p[3] * F, p[5] * F};
      return rasterConvex(xs, ys, 3, sp);
    }
    case T_ELL:
      return rasterEllipse(p[0] * F, p[1] * F, p[2] * F, p[3] * F, p[4] * M_PI / 256.0, sp);
    case T_RECT: {
      double th = p[4] * M_PI / 256.0, c = cos(th), s_ = sin(th);
      double cx = p[0] * F, cy = p[1] * F, hw = p[2] * F, hh = p[3] * F;
      double xs[4], ys[4];
      const double sx[4] = {-1, 1, 1, -1}, sy[4] = {-1, -1, 1, 1};
      for (int i = 0; i < 4; i++) {
        xs[i] = cx + sx[i] * hw * c - sy[i] * hh * s_;
        ys[i] = cy + sx[i] * hw * s_ + sy[i] * hh * c;
      }
      return rasterConvex(xs, ys, 4, sp);
    }
    default: {
      double px[3] = {p[0] * F, p[2] * F, p[4] * F};
      double py[3] = {p[1] * F, p[3] * F, p[5] * F};
      return rasterStroke(px, py, p[6] * F * 0.5, sp);
    }
  }
}

static Box spanBox(const Span *sp, int n) {
  Box b = {S, S, -1, -1};
  for (int k = 0; k < n; k++) {
    b.x0 = mini(b.x0, sp[k].x0);
    b.x1 = maxi(b.x1, sp[k].x1);
    b.y0 = mini(b.y0, sp[k].y);
    b.y1 = maxi(b.y1, sp[k].y);
  }
  return b;
}

// ── 누적합 ────────────────────────────────────────────
// 문맥의 한 행을 다시 만든다. w, wt(3), c(3)는 문맥 안 좌표의 화소 배열이다.
static void buildRow(Ctx *cx, int ly, const double *w, const double *wt, const double *c) {
  double acc[NQ] = {0};
  double *row = cx->P + (size_t)ly * (cx->w + 1) * NQ;
  memset(row, 0, sizeof(double) * NQ);
  for (int lx = 0; lx < cx->w; lx++) {
    size_t i = (size_t)ly * cx->w + lx;
    double wi = w[i];
    acc[0] += wi;
    for (int ch = 0; ch < 3; ch++) {
      double ti = wt[3 * i + ch], ci = c[3 * i + ch];
      acc[1 + ch] += ti;
      acc[4 + ch] += wi * ci;
      acc[7 + ch] += wi * ci * ci;
      acc[10 + ch] += ti * ci;
    }
    memcpy(row + (size_t)(lx + 1) * NQ, acc, sizeof(acc));
  }
}

// 오차 지도 누적분포: 화소 오차 w·Σλ(t−c)² = Σλ(wt − w·c)²/w
static void buildCdf(Ctx *cx, const double *w, const double *wt, const double *c) {
  double acc = 0;
  size_t n = (size_t)cx->w * cx->h;
  for (size_t i = 0; i < n; i++) {
    if (w[i] > 1e-12) {
      double e = 0;
      for (int ch = 0; ch < 3; ch++) {
        double d = wt[3 * i + ch] - w[i] * c[3 * i + ch];
        e += LAM[ch] * d * d;
      }
      acc += e / w[i];
    }
    cx->cdf[i] = acc;
  }
}

// 색을 정하고(solve=0이면 지금 색 그대로) 오차 변화량(음수일수록 좋음)을 돌려준다.
static double evalColor(Shape *s, const Ctx *cx, int solve) {
  int n = raster(s, spans);
  if (n == 0) return s->delta = 1e30;
  double sum[NQ] = {0};
  const size_t rs_ = (size_t)(cx->w + 1) * NQ;
  for (int k = 0; k < n; k++) {
    int ly = spans[k].y - cx->oy, lx0 = spans[k].x0 - cx->ox, lx1 = spans[k].x1 - cx->ox;
    if (cx->local && (ly < 0 || ly >= cx->h || lx0 < 0 || lx1 >= cx->w)) return s->delta = 1e30;
    const double *row = cx->P + ly * rs_;
    const double *p1 = row + (size_t)(lx1 + 1) * NQ, *p0 = row + (size_t)lx0 * NQ;
    for (int q = 0; q < NQ; q++) sum[q] += p1[q] - p0[q];
  }
  double W0 = sum[0];
  if (W0 <= 1e-9) return s->delta = 1e30;
  double a = s->a / 255.0, c[3], rgb[3];
  if (solve) {
    for (int ch = 0; ch < 3; ch++) c[ch] = (sum[1 + ch] - (1.0 - a) * sum[4 + ch]) / (a * W0);
    ycc2rgb(c, rgb);
    for (int ch = 0; ch < 3; ch++) s->rgb[ch] = clampi((int)lround(rgb[ch]), 0, 255);
  }
  rgb2ycc(s->rgb[0], s->rgb[1], s->rgb[2], c);
  double d = 0;
  for (int ch = 0; ch < 3; ch++) {
    double T1 = sum[1 + ch], C1 = sum[4 + ch], C2 = sum[7 + ch], TC = sum[10 + ch], cc = c[ch];
    d += LAM[ch] * (2 * a * (TC - cc * T1 - C2 + cc * C1) + a * a * (C2 - 2 * cc * C1 + cc * cc * W0));
  }
  return s->delta = d;
}

static double evalShape(Shape *s, const Ctx *cx) { return evalColor(s, cx, 1); }

// 도형 하나를 화면 배열 img(3ch, 문맥 좌표)에 합성한다. 창 밖 부분은 버린다.
static void applyShape(const Shape *s, const Box *win, double *img, double *tau, double *R) {
  int n = raster(s, spans);
  double a = s->a / 255.0, c[3];
  rgb2ycc(s->rgb[0], s->rgb[1], s->rgb[2], c);
  int ww = win->x1 - win->x0 + 1;
  for (int k = 0; k < n; k++) {
    int y = spans[k].y;
    if (y < win->y0 || y > win->y1) continue;
    int x0 = maxi(spans[k].x0, win->x0), x1 = mini(spans[k].x1, win->x1);
    for (int x = x0; x <= x1; x++) {
      size_t i = (size_t)(y - win->y0) * ww + (x - win->x0);
      if (img)
        for (int ch = 0; ch < 3; ch++) img[3 * i + ch] = (1.0 - a) * img[3 * i + ch] + a * c[ch];
      if (tau) tau[i] *= 1.0 - a;
      if (R)
        for (int ch = 0; ch < 3; ch++) R[3 * i + ch] = (1.0 - a) * R[3 * i + ch] + a * c[ch];
    }
  }
}

static double totalError(void) {
  double e = 0;
  for (size_t i = 0; i < (size_t)S * S; i++)
    for (int ch = 0; ch < 3; ch++) {
      double d = tgt[3 * i + ch] - cur[3 * i + ch];
      e += gw[i] * LAM[ch] * d * d;
    }
  return e;
}

static void compositeAll(const Shape *sh, int n) {
  for (size_t i = 0; i < (size_t)S * S; i++)
    for (int ch = 0; ch < 3; ch++) cur[3 * i + ch] = bgc[ch];
  Box full = {0, 0, S - 1, S - 1};
  for (int j = 0; j < n; j++) applyShape(&sh[j], &full, cur, NULL, NULL);
}

// ── 무작위 도형과 변이 ────────────────────────────────
static void samplePoint(const Ctx *cx, int *ux, int *uy) {
  size_t N = (size_t)cx->w * cx->h;
  size_t i;
  if (rnd() < PERR && cx->cdf[N - 1] > 0) {
    double r = rnd() * cx->cdf[N - 1];
    size_t lo = 0, hi = N - 1;
    while (lo < hi) {
      size_t mid = (lo + hi) >> 1;
      if (cx->cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    i = lo;
  } else {
    i = (size_t)(rnd() * N);
    if (i >= N) i = N - 1;
  }
  double x = cx->ox + (i % cx->w) + rnd(), y = cx->oy + (i / cx->w) + rnd();
  *ux = (int)lround(x / F);
  *uy = (int)lround(y / F);
}

static int pickType(void) {
  double tot = 0;
  for (int t = 0; t < NTYPES; t++) tot += TYPEW[t];
  double r = rnd() * tot;
  for (int t = 0; t < NTYPES; t++) {
    if (r < TYPEW[t]) return t;
    r -= TYPEW[t];
  }
  return T_TRI;
}

static void randomShape(Shape *s, const Ctx *cx) {
  int cx_, cy_;
  samplePoint(cx, &cx_, &cy_);
  // 크기: 단위 4(2px)부터 문맥 크기(전체면 800px)까지 로그 균등
  double rmax = fmin(1600.0, 0.5 * maxi(cx->w, cx->h) / F);
  if (rmax < 6.0) rmax = 6.0;
  double r = 4.0 * pow(rmax / 4.0, rnd());
  s->type = pickType();
  s->a = ALPHA0;
  int *p = s->p;
  switch (s->type) {
    case T_TRI: {
      double ph = rnd() * 2 * M_PI;
      for (int k = 0; k < 3; k++) {
        double ang = ph + k * 2 * M_PI / 3 + 0.5 * rgauss();
        double d = r * (0.4 + 0.6 * rnd());
        p[2 * k] = clampi((int)lround(cx_ + d * cos(ang)), CLO, CHI);
        p[2 * k + 1] = clampi((int)lround(cy_ + d * sin(ang)), CLO, CHI);
      }
      break;
    }
    case T_ELL:
    case T_RECT: {
      double a = r * (0.3 + 0.7 * rnd());
      double b = a * pow(2.0, -3.0 * rnd());
      p[0] = cx_;
      p[1] = cy_;
      p[2] = clampi((int)lround(a), 2, RMAX);
      p[3] = clampi((int)lround(b), 2, RMAX);
      p[4] = (int)(rnd() * 256) & 255;
      break;
    }
    default: {
      double ph = rnd() * 2 * M_PI, c = cos(ph), sn = sin(ph), bend = 0.5 * rgauss() * r;
      p[0] = clampi((int)lround(cx_ - r * c), CLO, CHI);
      p[1] = clampi((int)lround(cy_ - r * sn), CLO, CHI);
      p[2] = clampi((int)lround(cx_ - bend * sn), CLO, CHI);
      p[3] = clampi((int)lround(cy_ + bend * c), CLO, CHI);
      p[4] = clampi((int)lround(cx_ + r * c), CLO, CHI);
      p[5] = clampi((int)lround(cy_ + r * sn), CLO, CHI);
      double wmax = fmin(80.0, fmax(4.0, r));
      p[6] = clampi((int)lround(4.0 * pow(wmax / 4.0, rnd())), 4, 255);
      break;
    }
  }
}

static double shapeSize(const Shape *s) {
  const int *p = s->p;
  if (s->type == T_ELL || s->type == T_RECT) return 2.0 * (p[2] > p[3] ? p[2] : p[3]);
  int x0 = p[0], x1 = p[0], y0 = p[1], y1 = p[1];
  for (int k = 1; k < 3; k++) {
    x0 = mini(x0, p[2 * k]);
    x1 = maxi(x1, p[2 * k]);
    y0 = mini(y0, p[2 * k + 1]);
    y1 = maxi(y1, p[2 * k + 1]);
  }
  return maxi(x1 - x0, y1 - y0) + 1;
}

static void mutate(Shape *s) {
  int np = NPARAM[s->type];
  int k = (int)(rnd() * (np + 1));
  if (k > np) k = np;
  if (k == np) {
    s->a = clampi(s->a + (int)lround(rgauss() * 20.0), AMIN, 255);
    return;
  }
  // 걸음 크기: 도형 크기에 비례하되 2^-5배까지 고르게 섞는다
  double sig = fmax(2.0, shapeSize(s) * 0.5 * pow(2.0, -5.0 * rnd()));
  int *p = s->p;
  switch (s->type) {
    case T_TRI: {
      int v = k >> 1;  // 꼭짓점 하나를 2D로 움직인다
      p[2 * v] = clampi(p[2 * v] + (int)lround(rgauss() * sig), CLO, CHI);
      p[2 * v + 1] = clampi(p[2 * v + 1] + (int)lround(rgauss() * sig), CLO, CHI);
      break;
    }
    case T_ELL:
    case T_RECT:
      if (k < 2) {
        p[0] = clampi(p[0] + (int)lround(rgauss() * sig), CLO, CHI);
        p[1] = clampi(p[1] + (int)lround(rgauss() * sig), CLO, CHI);
      } else if (k < 4) {
        double sg = fmax(1.0, p[k] * 0.5 * pow(2.0, -5.0 * rnd()));
        p[k] = clampi(p[k] + (int)lround(rgauss() * sg), 2, RMAX);
      } else {
        p[4] = (p[4] + (int)lround(rgauss() * pow(2.0, 5.0 * rnd())) + 256 * 16) & 255;
      }
      break;
    default:
      if (k < 6) {
        int v = k >> 1;
        p[2 * v] = clampi(p[2 * v] + (int)lround(rgauss() * sig), CLO, CHI);
        p[2 * v + 1] = clampi(p[2 * v + 1] + (int)lround(rgauss() * sig), CLO, CHI);
      } else {
        double sg = fmax(1.0, p[6] * 0.4 * pow(2.0, -3.0 * rnd()));
        p[6] = clampi(p[6] + (int)lround(rgauss() * sg), 4, 255);
      }
      break;
  }
}

static void climb(Shape *s, const Ctx *cx, int maxAge) {
  Shape t;
  int age = 0;
  for (int it = 0; it < MAXIT && age < maxAge; it++) {
    t = *s;
    mutate(&t);
    if (evalShape(&t, cx) < s->delta) {
      *s = t;
      age = 0;
    } else {
      age++;
    }
  }
}

// 무작위 후보 ncand개 중 상위 topk개를 다듬어 가장 좋은 것을 best에 넣는다.
// best에 이미 값이 있으면(delta < 1e29) 그것도 경쟁에 넣는다.
static int search(Shape *best, const Ctx *cx, int ncand, int topk, int maxAge) {
  Shape top[32];
  int nt = 0;
  if (topk > 32) topk = 32;
  for (int c = 0; c < ncand; c++) {
    Shape s;
    randomShape(&s, cx);
    if (evalShape(&s, cx) >= 0) continue;
    if (nt < topk) {
      top[nt++] = s;
    } else if (s.delta < top[nt - 1].delta) {
      top[nt - 1] = s;
    } else {
      continue;
    }
    for (int j = nt - 1; j > 0 && top[j].delta < top[j - 1].delta; j--) {
      Shape tmp = top[j];
      top[j] = top[j - 1];
      top[j - 1] = tmp;
    }
  }
  int found = 0;
  for (int j = 0; j < nt; j++) {
    climb(&top[j], cx, maxAge);
    if (top[j].delta < best->delta) {
      *best = top[j];
      found = 1;
    }
  }
  return found;
}

// ── 2단계: 도형 k를 나머지를 고정한 채 다시 맞춘다 ─────────
static Box *boxes;

static void setBox(const Shape *sh, int k) {
  int n = raster(&sh[k], spans);
  boxes[k] = spanBox(spans, n);
}

// 창 win 안에서 도형 k를 뺀 문제를 만든다: 아래(B)와 위(τ, R)를 창 안에서만 합성하고 누적합을 쌓는다.
static void buildWindow(const Shape *sh, int n, int k, Box win, Ctx *cx) {
  int ww = win.x1 - win.x0 + 1, wh = win.y1 - win.y0 + 1;
  size_t wn = (size_t)ww * wh;
  for (size_t i = 0; i < wn; i++) {
    ltau[i] = 1.0;
    for (int ch = 0; ch < 3; ch++) {
      lc[3 * i + ch] = bgc[ch];
      lR[3 * i + ch] = 0.0;
    }
  }
  clipY0 = win.y0;
  clipY1 = win.y1;
  for (int j = 0; j < n; j++) {
    if (j == k) continue;
    const Box *o = &boxes[j];
    if (o->x1 < win.x0 || o->x0 > win.x1 || o->y1 < win.y0 || o->y0 > win.y1) continue;
    if (j < k) applyShape(&sh[j], &win, lc, NULL, NULL);
    else applyShape(&sh[j], &win, NULL, ltau, lR);
  }
  clipY0 = 0;
  clipY1 = S - 1;

  // 바뀐 문제: 가중치 w·τ², 가중 목표 w·τ·(t − R)
  for (int y = 0; y < wh; y++)
    for (int x = 0; x < ww; x++) {
      size_t i = (size_t)y * ww + x, g = (size_t)(y + win.y0) * S + (x + win.x0);
      double tau = ltau[i];
      lw[i] = gw[g] * tau * tau;
      for (int ch = 0; ch < 3; ch++) lwt[3 * i + ch] = gw[g] * tau * (tgt[3 * g + ch] - lR[3 * i + ch]);
    }
  cx->ox = win.x0;
  cx->oy = win.y0;
  cx->w = ww;
  cx->h = wh;
  cx->local = 1;
  for (int y = 0; y < wh; y++) buildRow(cx, y, lw, lwt, lc);
  buildCdf(cx, lw, lwt, lc);
}

static int reoptimize(Shape *sh, int n, int k, Ctx *cx) {
  Box b = boxes[k];
  if (b.x1 < b.x0) return 0;
  int m = maxi(4, (int)(0.3 * maxi(b.x1 - b.x0, b.y1 - b.y0)));
  Box win = {maxi(0, b.x0 - m), maxi(0, b.y0 - m), mini(S - 1, b.x1 + m), mini(S - 1, b.y1 + m)};
  buildWindow(sh, n, k, win, cx);

  // 지금 모양·색 그대로의 기여와 비교한다 (색만 다시 풀어도 나아지면 받아들인다)
  Shape best = sh[k];
  double d0 = evalColor(&best, cx, 0);
  evalShape(&best, cx);
  climb(&best, cx, SW_AGE);
  search(&best, cx, SW_CANDS, SW_TOPK, SW_AGE);
  if (best.delta < d0 - 1e-6) {
    sh[k] = best;
    setBox(sh, k);
    return 1;
  }
  return 0;
}

// 모든 도형을 한 바퀴 다시 맞추고 화면(cur)을 새로 합성한다. 바뀐 도형 수를 돌려준다.
static int sweep(Shape *sh, int n) {
  static double *lcdf = NULL;
  static int cap = 0;
  if (!lcdf) lcdf = malloc(sizeof(double) * S * S);
  if (cap < n) {
    boxes = realloc(boxes, sizeof(Box) * n);
    cap = n;
  }
  for (int k = 0; k < n; k++) setBox(sh, k);
  Ctx loc = {0, 0, S, S, 1, P, lcdf};
  int changed = 0;
  for (int k = 0; k < n; k++) changed += reoptimize(sh, n, k, &loc);
  compositeAll(sh, n);
  return changed;
}

// ── 입출력 ────────────────────────────────────────────
static void *readFile(const char *path, size_t want) {
  FILE *f = fopen(path, "rb");
  if (!f) {
    fprintf(stderr, "열 수 없음: %s\n", path);
    exit(1);
  }
  void *buf = malloc(want);
  if (fread(buf, 1, want, f) != want) {
    fprintf(stderr, "크기가 맞지 않음: %s\n", path);
    exit(1);
  }
  fclose(f);
  return buf;
}

// 12비트 값 두 개를 3바이트로
static void put12x2(FILE *f, int a, int b) {
  a = clampi(a, 0, 4095);
  b = clampi(b, 0, 4095);
  fputc(a & 255, f);
  fputc((a >> 8) | ((b & 15) << 4), f);
  fputc(b >> 4, f);
}

static void writeShapes(const char *path, const Shape *sh, int n) {
  const int off = -CLO;
  FILE *f = fopen(path, "wb");
  fwrite("PRM2", 1, 4, f);
  uint32_t cnt = (uint32_t)n;
  for (int b = 0; b < 4; b++) fputc((cnt >> (8 * b)) & 255, f);
  for (int ch = 0; ch < 3; ch++) fputc(bg[ch], f);
  fputc(2, f);
  fputc(off & 255, f);
  fputc(off >> 8, f);
  for (int i = 0; i < n; i++) {
    const Shape *s = &sh[i];
    const int *p = s->p;
    fputc(s->type, f);
    for (int ch = 0; ch < 3; ch++) fputc(s->rgb[ch], f);
    fputc(s->a, f);
    if (s->type == T_ELL || s->type == T_RECT) {
      put12x2(f, p[0] + off, p[1] + off);
      put12x2(f, p[2], p[3]);
      fputc(p[4] & 255, f);
    } else {
      for (int k = 0; k < 6; k += 2) put12x2(f, p[k] + off, p[k + 1] + off);
      if (s->type == T_STROKE) fputc(p[6] & 255, f);
    }
  }
  fclose(f);
}

static void writePreview(const char *path) {
  FILE *f = fopen(path, "wb");
  fprintf(f, "P6\n%d %d\n255\n", S, S);
  for (size_t i = 0; i < (size_t)S * S; i++) {
    double rgb[3];
    ycc2rgb(cur + 3 * i, rgb);
    for (int ch = 0; ch < 3; ch++) fputc(clampi((int)lround(rgb[ch]), 0, 255), f);
  }
  fclose(f);
}

static double now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec * 1e-9;
}

static int inList(const char *list, int v) {
  char key[32];
  snprintf(key, sizeof key, "%d", v);
  for (const char *c = list; *c;) {
    int len = (int)strcspn(c, ",");
    if ((int)strlen(key) == len && !strncmp(c, key, len)) return 1;
    c += len;
    if (*c == ',') c++;
  }
  return 0;
}

static void logTypes(const Shape *sh, int n) {
  int counts[NTYPES] = {0};
  for (int i = 0; i < n; i++) counts[sh[i].type]++;
  fprintf(stderr, "[");
  for (int t = 0; t < NTYPES; t++)
    fprintf(stderr, "%s %d%s", TNAME[t], counts[t], t < NTYPES - 1 ? ", " : "]\n");
}

int main(int argc, char **argv) {
  const char *tpath = NULL, *wpath = NULL, *out = "shapes.bin", *prev = NULL, *ckpt = "";
  for (int i = 1; i + 1 < argc; i += 2) {
    const char *k = argv[i], *v = argv[i + 1];
    if (!strcmp(k, "--target")) tpath = v;
    else if (!strcmp(k, "--weight")) wpath = v;
    else if (!strcmp(k, "--out")) out = v;
    else if (!strcmp(k, "--preview")) prev = v;
    else if (!strcmp(k, "--checkpoints")) ckpt = v;  // 1단계 중간 저장할 개수들, 쉼표 구분
    else if (!strcmp(k, "--size")) S = atoi(v);
    else if (!strcmp(k, "--n")) NSHAPES = atoi(v);
    else if (!strcmp(k, "--cands")) CANDS = atoi(v);
    else if (!strcmp(k, "--topk")) TOPK = atoi(v);
    else if (!strcmp(k, "--age")) AGE = atoi(v);
    else if (!strcmp(k, "--maxit")) MAXIT = atoi(v);
    else if (!strcmp(k, "--alpha")) ALPHA0 = atoi(v);
    else if (!strcmp(k, "--amin")) AMIN = atoi(v);
    else if (!strcmp(k, "--perr")) PERR = atof(v);
    else if (!strcmp(k, "--sweeps")) SWEEPS = atoi(v);
    else if (!strcmp(k, "--sw-cands")) SW_CANDS = atoi(v);
    else if (!strcmp(k, "--sw-topk")) SW_TOPK = atoi(v);
    else if (!strcmp(k, "--sw-age")) SW_AGE = atoi(v);
    else if (!strcmp(k, "--sw-every")) SW_EVERY = atoi(v);
    else if (!strcmp(k, "--seed")) SEED = strtoull(v, NULL, 10);
    else if (!strcmp(k, "--lam")) sscanf(v, "%lf,%lf,%lf", &LAM[0], &LAM[1], &LAM[2]);
    else if (!strcmp(k, "--types"))
      sscanf(v, "%lf,%lf,%lf,%lf", &TYPEW[0], &TYPEW[1], &TYPEW[2], &TYPEW[3]);
    else {
      fprintf(stderr, "알 수 없는 옵션: %s\n", k);
      return 1;
    }
  }
  if (!tpath || !wpath) {
    fprintf(stderr, "사용: primitive --target t.rgb --weight w.f32 [--size 1254 --n 5000 --out shapes.bin]\n");
    return 1;
  }
  F = (double)S / UNITS;
  clipY0 = 0;
  clipY1 = S - 1;
  rs ^= SEED * 0x9E3779B97F4A7C15ULL;
  for (int i = 0; i < 16; i++) rnext();

  size_t N = (size_t)S * S;
  unsigned char *trgb = readFile(tpath, N * 3);
  float *wf = readFile(wpath, N * sizeof(float));
  tgt = malloc(sizeof(double) * 3 * N);
  cur = malloc(sizeof(double) * 3 * N);
  gw = malloc(sizeof(double) * N);
  gwt = malloc(sizeof(double) * 3 * N);
  P = calloc((size_t)S * (S + 1) * NQ, sizeof(double));
  cdf = malloc(sizeof(double) * N);
  lw = malloc(sizeof(double) * N);
  ltau = malloc(sizeof(double) * N);
  lwt = malloc(sizeof(double) * 3 * N);
  lc = malloc(sizeof(double) * 3 * N);
  lR = malloc(sizeof(double) * 3 * N);
  spans = malloc(sizeof(Span) * (S * MAXSEG + 16));
  rowMark = calloc(S, 1);

  // 배경: 원본 평균색
  double mean[3] = {0, 0, 0};
  for (size_t i = 0; i < N; i++)
    for (int ch = 0; ch < 3; ch++) mean[ch] += trgb[3 * i + ch];
  for (int ch = 0; ch < 3; ch++) bg[ch] = clampi((int)lround(mean[ch] / N), 0, 255);
  rgb2ycc(bg[0], bg[1], bg[2], bgc);
  double wsum = 0;
  for (size_t i = 0; i < N; i++) {
    double c[3];
    rgb2ycc(trgb[3 * i], trgb[3 * i + 1], trgb[3 * i + 2], c);
    gw[i] = wf[i];
    wsum += gw[i];
    for (int ch = 0; ch < 3; ch++) {
      tgt[3 * i + ch] = c[ch];
      gwt[3 * i + ch] = gw[i] * c[ch];
      cur[3 * i + ch] = bgc[ch];
    }
  }
  Ctx full = {0, 0, S, S, 0, P, cdf};
  for (int y = 0; y < S; y++) buildRow(&full, y, gw, gwt, cur);

  double err = totalError();
  fprintf(stderr, "시작: %dpx, 도형 %d개, 오차 %.3f\n", S, NSHAPES, sqrt(err / wsum));

  // ── 1단계: 탐욕적 추가 ──
  Shape *shapes = malloc(sizeof(Shape) * NSHAPES);
  double t0 = now();
  int n = 0;
  for (; n < NSHAPES; n++) {
    buildCdf(&full, gw, gwt, cur);
    Shape best;
    best.delta = 1e30;
    if (!search(&best, &full, CANDS, TOPK, AGE)) {
      fprintf(stderr, "더 줄일 수 없음: %d단계\n", n);
      break;
    }
    shapes[n] = best;
    // 화면과 바뀐 행의 누적합을 갱신한다
    Box all = {0, 0, S - 1, S - 1};
    applyShape(&best, &all, cur, NULL, NULL);
    memset(rowMark, 0, S);
    int ns = raster(&best, spans);
    for (int k = 0; k < ns; k++) rowMark[spans[k].y] = 1;
    for (int y = 0; y < S; y++)
      if (rowMark[y]) buildRow(&full, y, gw, gwt, cur);
    err += best.delta;
    int n1 = n + 1;
    if (n1 % 500 == 0 || n1 == NSHAPES) {
      fprintf(stderr, "%5d  오차 %.3f  %.1fs  ", n1, sqrt(err / wsum), now() - t0);
      logTypes(shapes, n1);
    }
    if (SW_EVERY > 0 && n1 % SW_EVERY == 0 && n1 < NSHAPES) {
      // 지금까지의 도형을 한 바퀴 다시 맞추고, 화면과 누적합을 새로 만든다
      int changed = sweep(shapes, n1);
      for (int y = 0; y < S; y++) buildRow(&full, y, gw, gwt, cur);
      err = totalError();
      fprintf(stderr, "  sweep @%d  오차 %.3f  바뀐 도형 %d  %.1fs\n", n1, sqrt(err / wsum), changed, now() - t0);
    }
    if (inList(ckpt, n1)) {
      char path[1024];
      snprintf(path, sizeof path, "%s.%d", out, n1);
      writeShapes(path, shapes, n1);
    }
  }
  NSHAPES = n;

  // ── 2단계: 다시 맞추기 (sweep()이 화면 cur도 새로 합성한다) ──
  for (int sw = 0; sw < SWEEPS; sw++) {
    int changed = sweep(shapes, NSHAPES);
    err = totalError();
    fprintf(stderr, "sweep %d  오차 %.3f  바뀐 도형 %d  %.1fs  ", sw + 1, sqrt(err / wsum), changed, now() - t0);
    logTypes(shapes, NSHAPES);
  }

  writeShapes(out, shapes, NSHAPES);
  if (SWEEPS == 0) compositeAll(shapes, NSHAPES);
  if (prev) writePreview(prev);
  fprintf(stderr, "끝: %d개, 오차 %.3f, %.1fs\n", NSHAPES, sqrt(totalError() / wsum), now() - t0);
  return 0;
}
