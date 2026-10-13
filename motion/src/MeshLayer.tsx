// 라이브2D 느낌의 메시 변형 레이어.
// 오린 그림 위에 삼각형 격자를 씌우고, 꼭짓점마다 시간에 따라 움직인 위치로 그림을 휘어서 그린다.
// 변형은 원본 그림 좌표(1086×1448) 기준 함수 deform(x, y, t) → [dx, dy]로 준다.
import React, { useEffect, useRef, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

export type Deform = (x: number, y: number, t: number) => [number, number];
export type Overlay = (
  ctx: CanvasRenderingContext2D,
  t: number,
  map: (x: number, y: number) => [number, number],
  img: HTMLImageElement,
  box: number[]
) => void;

const cache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  if (!cache.has(src)) {
    cache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = staticFile(src);
      })
    );
  }
  return cache.get(src)!;
}

const PAD = 60; // 변형으로 밀려 나가는 여백
const STEP = 22; // 격자 간격(px)

// 원본 삼각형 (s0,s1,s2) → 대상 삼각형 (d0,d1,d2) 로 그림을 옮겨 그린다.
function drawTri(ctx: CanvasRenderingContext2D, img: HTMLImageElement, s: number[], d: number[]) {
  const [sx0, sy0, sx1, sy1, sx2, sy2] = s;
  const [dx0, dy0, dx1, dy1, dx2, dy2] = d;
  const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(den) < 1e-6) return;
  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / den;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / den;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / den;
  const dd = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / den;
  const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / den;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / den;
  // 이음매가 보이지 않게 대상 삼각형을 무게중심에서 0.6px 넓힌다
  const cx = (dx0 + dx1 + dx2) / 3;
  const cy = (dy0 + dy1 + dy2) / 3;
  const grow = (x: number, y: number): [number, number] => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * 0.6, y + ((y - cy) / l) * 0.6];
  };
  const p0 = grow(dx0, dy0);
  const p1 = grow(dx1, dy1);
  const p2 = grow(dx2, dy2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export const MeshLayer: React.FC<{
  src: string;
  box: number[]; // [x, y, w, h] 원본 좌표
  t: number;
  deform: Deform;
  overlay?: Overlay;
  style?: React.CSSProperties;
}> = ({ src, box, t, deform, overlay, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [handle] = useState(() => delayRender(`이미지 ${src}`));
  useEffect(() => {
    loadImage(src).then((im) => {
      setImg(im);
      continueRender(handle);
    });
  }, [src, handle]);

  const [bx, by, bw, bh] = box;
  const W = bw + PAD * 2;
  const H = bh + PAD * 2;

  useEffect(() => {
    const cv = ref.current;
    if (!img || !cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 캔버스 좌표 = 원본 좌표 - (bx - PAD, by - PAD). 그림 좌표 = 원본 좌표 - (bx, by)
    const ox = bx - PAD;
    const oy = by - PAD;
    const nx = Math.ceil(bw / STEP);
    const ny = Math.ceil(bh / STEP);
    const sx = (i: number) => Math.min(bw, i * STEP);
    const sy = (j: number) => Math.min(bh, j * STEP);
    const dst: number[][] = [];
    for (let j = 0; j <= ny; j++) {
      const row: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const X = bx + sx(i);
        const Y = by + sy(j);
        const [dx, dy] = deform(X, Y, t);
        row.push(X + dx - ox, Y + dy - oy);
      }
      dst.push(row);
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s00 = [sx(i), sy(j)];
        const s10 = [sx(i + 1), sy(j)];
        const s01 = [sx(i), sy(j + 1)];
        const s11 = [sx(i + 1), sy(j + 1)];
        const d00 = [dst[j][i * 2], dst[j][i * 2 + 1]];
        const d10 = [dst[j][i * 2 + 2], dst[j][i * 2 + 3]];
        const d01 = [dst[j + 1][i * 2], dst[j + 1][i * 2 + 1]];
        const d11 = [dst[j + 1][i * 2 + 2], dst[j + 1][i * 2 + 3]];
        drawTri(ctx, img, [...s00, ...s10, ...s11], [...d00, ...d10, ...d11]);
        drawTri(ctx, img, [...s00, ...s11, ...s01], [...d00, ...d11, ...d01]);
      }
    }
    if (overlay) {
      ctx.setTransform(1, 0, 0, 1, -ox, -oy);
      overlay(ctx, t, (x, y) => {
        const [dx, dy] = deform(x, y, t);
        return [x + dx, y + dy];
      }, img, [bx, by, bw, bh]);
    }
  }, [img, t, deform, overlay, bx, by, bw, bh, W, H]);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      style={{ position: 'absolute', left: bx - PAD, top: by - PAD, width: W, height: H, ...style }}
    />
  );
};

