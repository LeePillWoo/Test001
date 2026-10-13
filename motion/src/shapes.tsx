// 반짝이·하트·별 모양. 모두 (0,0) 중심, 반지름 1 기준 경로라 transform으로 크기만 바꿔 쓴다.
import React from 'react';

export const SPARKLE = 'M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1Z';
export const HEART =
  'M0 0.9 C-0.2 0.72 -1 0.25 -1 -0.28 C-1 -0.7 -0.62 -0.95 -0.3 -0.88 C-0.14 -0.85 -0.04 -0.74 0 -0.62 C0.04 -0.74 0.14 -0.85 0.3 -0.88 C0.62 -0.95 1 -0.7 1 -0.28 C1 0.25 0.2 0.72 0 0.9Z';

function star5() {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(Math.cos(a) * r).toFixed(3)} ${(Math.sin(a) * r).toFixed(3)}`);
  }
  return 'M' + pts.join(' L') + 'Z';
}
export const STAR = star5();

export type Kind = 'sparkle' | 'heart' | 'star';
const PATHS: Record<Kind, string> = { sparkle: SPARKLE, heart: HEART, star: STAR };

export const Shape: React.FC<{
  kind: Kind;
  x: number;
  y: number;
  r: number;
  color: string;
  rot?: number;
  opacity?: number;
  glow?: boolean;
}> = ({ kind, x, y, r, color, rot = 0, opacity = 1, glow = true }) => (
  <path
    d={PATHS[kind]}
    transform={`translate(${x} ${y}) rotate(${rot}) scale(${r})`}
    fill={color}
    opacity={opacity}
    stroke={kind === 'sparkle' ? 'none' : '#ffffff'}
    strokeWidth={kind === 'sparkle' ? 0 : 0.12}
    style={glow ? { filter: `drop-shadow(0 0 ${Math.max(2, r * 0.6)}px ${color})` } : undefined}
  />
);

export const PASTEL = ['#ff8fc7', '#ffd36e', '#ffffff', '#c9a6ff', '#8fe3ff', '#ffb3d9'];
