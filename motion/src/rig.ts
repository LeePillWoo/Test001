// 아이와 고양이의 '리깅': 어느 부위가 어떻게 움직이는지를 원본 좌표 함수로 적는다.
// 주기는 모두 6초를 나누어떨어지게 잡아 6초짜리 반복 영상이 이음매 없이 돈다.
import type { Deform, Overlay } from './MeshLayer';

const TAU = Math.PI * 2;
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// 타원 안쪽 1, 바깥 0 으로 부드럽게
const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, soft = 0.35) => {
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return 1 - sstep(1 - soft, 1, d);
};
const rotate = (x: number, y: number, px: number, py: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a) - 1;
  const s = Math.sin(a);
  return [(x - px) * c - (y - py) * s, (x - px) * s + (y - py) * c];
};

// ── 아이 ──────────────────────────────────────────────
export const NECK = { x: 675, y: 560 };
export const childHeadAngle = (t: number) => 1.8 * Math.sin((TAU * t) / 6);
const breath = (t: number) => Math.sin((TAU * t) / 3);

export const childDeform: Deform = (x, y, t) => {
  let dx = 0;
  let dy = 0;
  // 숨쉬기: 허리(1050) 위가 살짝 늘었다 줄었다 → 가슴과 머리가 오르내림
  const rise = 0.009 * breath(t) * Math.max(0, 1050 - y) * sstep(1120, 1040, y);
  dy -= rise;
  // 브이 손: 손목 근처를 축으로 까딱까딱
  const hand = inEllipse(x, y, 890, 525, 85, 135);
  // 머리: 목을 축으로 천천히 갸웃 (브이 손은 제외)
  const head = sstep(610, 520, y) * (1 - hand);
  const [hx, hy] = rotate(x, y, NECK.x, NECK.y, childHeadAngle(t));
  dx += hx * head;
  dy += hy * head;
  // 머리카락: 얼굴 바깥, 아래로 갈수록 크게 흔들림
  const face = inEllipse(x, y, 655, 385, 118, 150, 0.25);
  const hair = (1 - face) * sstep(330, 470, y) * sstep(640, 520, y) * (1 - hand) * (x < 900 ? 1 : 0);
  dx += hair * (6 * Math.sin((TAU * t) / 2 + y * 0.015) + 3 * Math.sin((TAU * t) / 3 + 1));
  dy += hair * 1.5 * Math.sin((TAU * t) / 2 + 0.8);
  const [rx, ry] = rotate(x, y, 935, 660, 3.5 * Math.sin((TAU * t) / 1.5));
  dx += rx * hand;
  dy += ry * hand;
  // 고양이를 쓰다듬는 손: 살짝 토닥토닥
  const pat = inEllipse(x, y, 430, 785, 70, 45);
  dy += pat * 2.5 * Math.max(0, Math.sin((TAU * t) / 1.5));
  return [dx, dy];
};

// 눈 깜빡임: 6초 동안 두 번. 0→1→0 으로 감겼다 뜸 (한 번에 0.2초)
const blinkAt = (t: number, times: number[], len = 0.2) => {
  const u = ((t % 6) + 6) % 6;
  for (const b of times) {
    const d = (u - b) / len;
    if (d >= 0 && d <= 1) return Math.sin(d * Math.PI);
  }
  return 0;
};

function lid(
  ctx: CanvasRenderingContext2D,
  map: (x: number, y: number) => [number, number],
  eye: { x: number; y: number; rx: number; ry: number; tilt: number },
  p: number,
  color: [number, number, number],
  line: string,
  lineW: number
) {
  const [cx, cy] = map(eye.x, eye.y);
  const yLine = -eye.ry + eye.ry * 2 * p; // 위에서부터 덮인 높이
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((eye.tilt * Math.PI) / 180);
  // 위에서 눈꺼풀 선까지만 덮되, 가장자리는 피부/털 색이 부드럽게 사라지게
  ctx.beginPath();
  ctx.rect(-eye.rx * 1.4, -eye.ry * 1.4, eye.rx * 2.8, yLine + eye.ry * 1.4);
  ctx.clip();
  ctx.scale(eye.rx * 1.25, eye.ry * 1.3);
  const [r, g, b] = color;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.72, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 감긴 눈꺼풀 선: 감길수록 아래로 내려오며 웃는 눈처럼 살짝 휜다
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((eye.tilt * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(-eye.rx * 0.9, yLine - eye.ry * 0.12);
  ctx.quadraticCurveTo(0, yLine + eye.ry * 0.3 * p, eye.rx * 0.9, yLine - eye.ry * 0.2);
  ctx.strokeStyle = line;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

export const childOverlay: Overlay = (ctx, t, map) => {
  const p = blinkAt(t, [1.1, 4.2]);
  if (p <= 0.02) return;
  lid(ctx, map, { x: 671, y: 336, rx: 40, ry: 28, tilt: -6 }, p, [249, 196, 157], '#3a1f1a', 5.5);
};

// ── 고양이 ─────────────────────────────────────────────
export const catHeadAngle = (t: number) => 1.6 * Math.sin((TAU * t) / 3 + 1);
export const catDeform: Deform = (x, y, t) => {
  let dx = 0;
  let dy = 0;
  // 숨쉬기: 몸통 윗선이 오르내림
  const body = sstep(330, 420, x) * sstep(1000, 900, y);
  dy -= body * 0.03 * (1 + Math.sin((TAU * t) / 2)) * 0.5 * Math.max(0, 1000 - y);
  // 머리 갸웃: 목(340, 880)을 축으로
  const head = sstep(400, 330, x) * sstep(905, 860, y);
  const [hx, hy] = rotate(x, y, 340, 880, catHeadAngle(t));
  dx += hx * head;
  dy += hy * head;
  // 왼쪽 귀 쫑긋: 3초마다 짧게
  const u = t % 3;
  const twitch = u > 2.2 && u < 2.5 ? Math.sin(((u - 2.2) / 0.3) * Math.PI) : 0;
  const ear = inEllipse(x, y, 165, 670, 45, 55);
  const [ex, ey] = rotate(x, y, 185, 715, -9 * twitch);
  dx += ex * ear;
  dy += ey * ear;
  // 꼬리 쪽(엉덩이 끝)이 살랑
  const tail = sstep(600, 680, x) * sstep(840, 900, y);
  dx += tail * 4 * Math.sin((TAU * t) / 1.5);
  dy += tail * 2 * Math.sin((TAU * t) / 1.5 + 1);
  return [dx, dy];
};

// 고양이 눈꺼풀: 눈 위의 털 무늬를 그대로 끌어내려 덮는다 (단색으로 칠하면 줄무늬 위에서 티가 난다)
function furLid(
  ctx: CanvasRenderingContext2D,
  map: (x: number, y: number) => [number, number],
  img: HTMLImageElement,
  box: number[],
  eye: { x: number; y: number; rx: number; ry: number },
  p: number
) {
  const [cx, cy] = map(eye.x, eye.y);
  const cover = eye.ry * 2 * p;
  const yLine = cy - eye.ry + cover;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, eye.rx, eye.ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(cx - eye.rx - 2, cy - eye.ry - 2, eye.rx * 2 + 4, cover + 2);
  ctx.clip();
  // 원본에서 눈 바로 위 털 띠를 cover만큼 아래로 밀어 그린다
  const sx = eye.x - eye.rx - box[0];
  const sy = eye.y - eye.ry - eye.ry * 2 - box[1];
  ctx.drawImage(img, sx, sy, eye.rx * 2, eye.ry * 2, cx - eye.rx, cy - eye.ry - eye.ry * 2 + cover, eye.rx * 2, eye.ry * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx - eye.rx * 0.85, yLine - 2);
  ctx.quadraticCurveTo(cx, yLine + eye.ry * 0.35 * p, cx + eye.rx * 0.85, yLine - 2);
  ctx.strokeStyle = '#3b302b';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
}

export const catOverlay: Overlay = (ctx, t, map, img, box) => {
  const p = blinkAt(t, [2.6, 5.1], 0.24);
  if (p <= 0.02) return;
  furLid(ctx, map, img, box, { x: 218, y: 768, rx: 21, ry: 18 }, p);
  furLid(ctx, map, img, box, { x: 297, y: 784, rx: 20, ry: 17 }, p);
};

// 머리띠처럼 머리에 붙는 장식이 머리를 따라 움직이도록 쓰는 값
export const childHeadPose = (t: number) => ({ angle: childHeadAngle(t), rise: 0.009 * breath(t) * 820 });
