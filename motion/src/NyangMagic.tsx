// 15초 세로 영상: 사진 → 고양이와 하이파이브 → 빛 속 변신 → 고양이 마법소녀 등장 → 대사.
// 그림 좌표(원본 1086×1448)로 만든 '월드'를 카메라가 확대·이동하며 1080×1920 화면에 담는다.
import '@fontsource/jua';
import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  continueRender,
  delayRender,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import layers from '../public/layers.json';
import { BGM_SRC, T } from './cues';
import { CostumeBack, CostumeFront, Pops } from './Costume';
import { Kind, PASTEL, Shape } from './shapes';

const IW = 1086;
const IH = 1448;
const VW = 1080;
const VH = 1920;
const BASE = VW / IW;
const CHILD = layers.child as number[]; // [x, y, w, h]
const CAT = layers.cat as number[];
const HAND = { x: 392, y: 774 }; // 하이파이브가 닿는 점
const CORE = { x: 735, y: 760 }; // 아이 몸 중심 (파티클 회전축)

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// 카메라 키: [프레임, 줌, 초점x, 초점y]
const CAM: [number, number, number, number][] = [
  [0, 1.0, 543, 724],
  [88, 1.1, 560, 720],
  [100, 1.1, 560, 720],
  [130, 1.3, 470, 790],
  [150, 1.24, 520, 780],
  [235, 1.12, 720, 720],
  [300, 1.0, 650, 740],
  [340, 1.07, 690, 700],
  [450, 1.04, 690, 720],
];

function camera(f: number) {
  let i = 0;
  while (i < CAM.length - 2 && f > CAM[i + 1][0]) i++;
  const [f0, z0, x0, y0] = CAM[i];
  const [f1, z1, x1, y1] = CAM[i + 1];
  const t = ease(Math.min(1, Math.max(0, (f - f0) / (f1 - f0))));
  const z = z0 + (z1 - z0) * t;
  const fx = x0 + (x1 - x0) * t;
  const fy = y0 + (y1 - y0) * t;
  const k = BASE * z;
  let tx = VW / 2 - fx * k;
  const ty = VH / 2 - fy * k;
  tx = Math.min(0, Math.max(VW - IW * k, tx));
  return { k, tx, ty };
}

// 변신 빛의 세기 0..1
function glowAt(f: number) {
  return interpolate(f, [165, 225, T.glowPeak, 252, 292], [0, 0.75, 1, 1, 0], { ...clamp, easing: ease });
}

function pops(f: number, fps: number): Pops {
  const p = (start: number) => spring({ frame: f - start, fps, config: { damping: 9, stiffness: 160, mass: 0.6 } });
  return { cape: p(252), collar: p(258), skirt: p(264), ribbon: p(270), ears: p(276), tail: p(282), cat: p(T.reveal + 6) };
}

const Layer: React.FC<{ src: string; box: number[]; style?: React.CSSProperties }> = ({ src, box, style }) => (
  <Img
    src={staticFile(src)}
    style={{ position: 'absolute', left: box[0], top: box[1], width: box[2], height: box[3], ...style }}
  />
);

// 화면을 가득 채우는 흐린 배경 (세로 화면 위아래 여백용)
const Backdrop: React.FC<{ f: number }> = ({ f }) => {
  const magic = interpolate(f, [T.transformStart, 230], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Img
        src={staticFile('source.png')}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(36px) saturate(1.2) brightness(1.08)', transform: 'scale(1.15)' }}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg,#ffd6ea,#e7d4ff 50%,#ffd9ec)', opacity: 0.35 + 0.45 * magic }} />
    </AbsoluteFill>
  );
};

// 변신 중 배경: 파스텔 물들임 + 회전하는 빛살
const MagicSky: React.FC<{ f: number }> = ({ f }) => {
  const a = interpolate(f, [T.transformStart, 230, T.reveal, 330], [0, 0.72, 0.72, 0.55], clamp);
  const rays = interpolate(f, [T.transformStart + 20, 230, T.reveal + 10, 450], [0, 0.4, 0.75, 0.55], clamp);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: IW,
          height: IH,
          background: 'radial-gradient(circle at 66% 48%, #fff4fb 0%, #ffc7e4 35%, #d9c2ff 70%, #b9a8ff 100%)',
          opacity: a,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: CORE.x - 1100,
          top: CORE.y - 1100,
          width: 2200,
          height: 2200,
          borderRadius: '50%',
          background:
            'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.75) 0deg 6deg, rgba(255,255,255,0) 6deg 18deg)',
          WebkitMaskImage: 'radial-gradient(circle, black 0%, black 25%, transparent 62%)',
          transform: `rotate(${f * 0.6}deg)`,
          opacity: rays,
        }}
      />
    </>
  );
};

// 고양이 앞발 (하이파이브용). 가슴에서 뻗어 나와 HAND 쪽으로 올라간다.
const CatPaw: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const up = spring({ frame: f - T.pawUp, fps, config: { damping: 11, stiffness: 120 } });
  const down = interpolate(f, [158, 180], [0, 1], { ...clamp, easing: ease });
  const t = up * (1 - down);
  if (t <= 0.01) return null;
  const base = { x: 262, y: 905 };
  const rest = { x: 250, y: 960 };
  const tip = { x: rest.x + (HAND.x - 22 - rest.x) * t, y: rest.y + (HAND.y + 4 - rest.y) * t };
  const ang = (Math.atan2(tip.y - base.y, tip.x - base.x) * 180) / Math.PI;
  const len = Math.hypot(tip.x - base.x, tip.y - base.y);
  // 털이 북슬한 둥근 앞다리: 흰 바탕에 옅은 회색 줄무늬 두 개, 끝에 분홍 젤리
  const fur = Array.from({ length: 7 }, (_, i) => `M${(len * i) / 7} -33 q8 -10 16 0`).join(' ');
  return (
    <svg viewBox={`0 0 ${IW} ${IH}`} width={IW} height={IH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <g transform={`translate(${base.x} ${base.y}) rotate(${ang})`}>
        <rect x={-30} y={-34} width={len + 30} height={68} rx={34} fill="#fbf8f6" stroke="#7a6a64" strokeWidth={3} />
        <path d={fur} stroke="#ffffff" strokeWidth={6} fill="none" strokeLinecap="round" />
        {[0.42, 0.68].map((q) => (
          <path key={q} d={`M${len * q} -32 q-12 32 0 64`} stroke="#9a9290" strokeWidth={8} fill="none" opacity={0.55} strokeLinecap="round" />
        ))}
        <g transform={`translate(${len} 0) rotate(${-ang - 15})`}>
          <ellipse rx={44} ry={40} fill="#fffdfc" stroke="#7a6a64" strokeWidth={3} />
          <ellipse cx={2} cy={11} rx={17} ry={13} fill="#ffa9c4" />
          {[
            [-22, -11],
            [-8, -23],
            [9, -23],
            [23, -10],
          ].map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx={8} ry={9} fill="#ffa9c4" />
          ))}
          <ellipse cx={-8} cy={6} rx={5} ry={3} fill="#ffffff" opacity={0.7} />
        </g>
      </g>
    </svg>
  );
};

// 하이파이브 순간의 핑크·금색 빛 폭발
const Burst: React.FC<{ f: number }> = ({ f }) => {
  const d = f - T.highFive;
  if (d < 0 || d > 45) return null;
  const p = d / 45;
  const ring = (delay: number, color: string, w: number) => {
    const q = Math.max(0, (d - delay) / 30);
    if (q <= 0 || q > 1) return null;
    return <circle cx={HAND.x} cy={HAND.y} r={20 + 320 * Easing.out(Easing.cubic)(q)} fill="none" stroke={color} strokeWidth={w * (1 - q)} opacity={1 - q} />;
  };
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2 + random(`ray${i}`) * 0.3;
    const l = (140 + random(`rl${i}`) * 200) * Easing.out(Easing.cubic)(Math.min(1, d / 12));
    const w = 10 * (1 - p);
    const col = i % 2 ? '#ffd36e' : '#ff8fc7';
    return (
      <path
        key={i}
        d={`M${HAND.x} ${HAND.y} L${HAND.x + Math.cos(a - 0.04) * l} ${HAND.y + Math.sin(a - 0.04) * l} L${HAND.x + Math.cos(a) * (l + 40)} ${HAND.y + Math.sin(a) * (l + 40)} L${HAND.x + Math.cos(a + 0.04) * l} ${HAND.y + Math.sin(a + 0.04) * l}Z`}
        fill={col}
        opacity={(1 - p) * 0.9}
        strokeWidth={w}
      />
    );
  });
  const bits = Array.from({ length: 34 }, (_, i) => {
    const a = random(`ba${i}`) * Math.PI * 2;
    const v = 6 + random(`bv${i}`) * 12;
    const x = HAND.x + Math.cos(a) * v * d;
    const y = HAND.y + Math.sin(a) * v * d + 0.12 * d * d;
    const kinds: Kind[] = ['sparkle', 'star', 'heart'];
    return (
      <Shape
        key={i}
        kind={kinds[i % 3]}
        x={x}
        y={y}
        r={(10 + random(`br${i}`) * 16) * (1 - p * 0.6)}
        color={['#ff8fc7', '#ffd36e', '#ffffff'][i % 3]}
        rot={d * 6 * (random(`bt${i}`) - 0.5)}
        opacity={1 - p}
        glow={false}
      />
    );
  });
  return (
    <svg viewBox={`0 0 ${IW} ${IH}`} width={IW} height={IH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <circle cx={HAND.x} cy={HAND.y} r={150 * (1 - p) + 30} fill="url(#core)" opacity={1 - p} />
      <defs>
        <radialGradient id="core">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#ffe9a8" stopOpacity={0.9} />
          <stop offset="1" stopColor="#ff8fc7" stopOpacity={0} />
        </radialGradient>
      </defs>
      <g style={{ filter: 'drop-shadow(0 0 10px #ffd36e)' }}>{rays}</g>
      {ring(0, '#ffffff', 22)}
      {ring(4, '#ffd36e', 16)}
      {ring(9, '#ff8fc7', 12)}
      <g style={{ filter: 'drop-shadow(0 0 6px #ffffff)' }}>{bits}</g>
    </svg>
  );
};

// 아이를 감싸고 도는 반짝이·하트·별. 앞쪽 절반(front)은 아이 위에, 뒤쪽 절반은 아이 뒤에 그린다.
const N_ORBIT = 90;
const Orbit: React.FC<{ f: number; front: boolean }> = ({ f, front }) => {
  if (f < T.transformStart || f > T.reveal + 40) return null;
  const items: React.ReactNode[] = [];
  const kinds: Kind[] = ['sparkle', 'sparkle', 'heart', 'star'];
  const out = interpolate(f, [T.reveal - 6, T.reveal + 40], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  for (let i = 0; i < N_ORBIT; i++) {
    const born = T.transformStart + random(`ob${i}`) * 70;
    if (f < born) continue;
    const age = (f - born) / 30;
    const h = random(`oh${i}`); // 0 = 발, 1 = 머리
    const speed = 0.35 + random(`os${i}`) * 0.35 + interpolate(f, [150, 240], [0, 0.4], clamp);
    const ang = random(`oa${i}`) * Math.PI * 2 + age * speed * Math.PI * 2;
    const depth = Math.sin(ang);
    if (front !== depth > 0) continue;
    const spread = 1 + out * 2.6;
    const rx = (300 + 90 * Math.sin(h * Math.PI)) * spread;
    const y = 1290 - h * 1080 - age * 18 + depth * 60;
    const x = CORE.x + Math.cos(ang) * rx;
    const appear = Math.min(1, age * 3);
    const r = (9 + random(`or${i}`) * 15) * (0.75 + 0.35 * depth) * appear;
    items.push(
      <Shape
        key={i}
        kind={kinds[i % kinds.length]}
        x={x}
        y={y}
        r={r}
        color={PASTEL[i % PASTEL.length]}
        rot={age * 90 * (i % 2 ? 1 : -1)}
        opacity={(front ? 1 : 0.75) * (1 - out)}
        glow={false}
      />
    );
  }
  return (
    <svg viewBox={`0 0 ${IW} ${IH}`} width={IW} height={IH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: 'drop-shadow(0 0 7px rgba(255,255,255,0.95))' }}>
      {items}
    </svg>
  );
};

// 몸을 나선으로 감싸며 올라가는 빛 리본
const LightRibbons: React.FC<{ f: number }> = ({ f }) => {
  const a = interpolate(f, [175, 205, 255, 285], [0, 1, 1, 0], clamp);
  if (a <= 0) return null;
  const rise = interpolate(f, [175, 255], [0, 1], { ...clamp, easing: ease });
  const bands = [0, 1, 2].map((j) => {
    const pts: string[] = [];
    for (let s = 0; s <= 60; s++) {
      const u = s / 60;
      const y = 1330 - u * 1150 * (0.25 + rise * 0.85);
      const ang = u * Math.PI * 5 + j * 2.1 + f * 0.09;
      const x = CORE.x + Math.cos(ang) * (250 + 40 * Math.sin(u * 7));
      pts.push(`${x.toFixed(1)} ${(y + Math.sin(ang) * 40).toFixed(1)}`);
    }
    return <path key={j} d={'M' + pts.join(' L')} fill="none" stroke={['#ffffff', '#ffd36e', '#ffb3d9'][j]} strokeWidth={14} strokeLinecap="round" />;
  });
  return (
    <svg viewBox={`0 0 ${IW} ${IH}`} width={IW} height={IH} style={{ position: 'absolute', left: 0, top: 0, opacity: a, filter: 'blur(3px) drop-shadow(0 0 16px #ffd1ea)' }}>
      {bands}
    </svg>
  );
};

// 아이 레이어: 변신 전/후 + 빛에 싸인 모습 + 등장 포즈
const Child: React.FC<{ f: number; fps: number; p: Pops }> = ({ f, fps, p }) => {
  const g = glowAt(f);
  const after = f >= T.glowPeak + 4;
  const hop = spring({ frame: f - T.highFive, fps, config: { damping: 10 } }) * interpolate(f, [T.highFive, 160], [1, 0], clamp);
  const pose = spring({ frame: f - T.reveal, fps, config: { damping: 8, stiffness: 140, mass: 0.7 } });
  const lift = interpolate(f, [175, 235, 292, 310], [0, -40, -40, 0], { ...clamp, easing: ease });
  const scale = after ? 0.96 + 0.04 * pose + (f < T.reveal ? 0.04 : 0) : 1;
  const rot = after && f >= T.reveal ? (1 - pose) * -4 : 0;
  const breathe = f > T.reveal + 30 ? Math.sin((f - T.reveal) / 9) * 0.006 : 0;
  const anchor = `${CHILD[0] + CHILD[2] / 2}px ${CHILD[1] + CHILD[3]}px`;
  const tf = `translateY(${lift - hop * 14}px) rotate(${rot}deg) scale(${scale + breathe})`;
  const lightFill = 'linear-gradient(170deg, #ffffff 10%, #ffe6f3 45%, #fff3c4 75%, #ffffff 100%)';
  const mask = `url(${staticFile(after ? 'child_magic.png' : 'child.png')})`;
  return (
    <div style={{ position: 'absolute', inset: 0, width: IW, height: IH, transform: tf, transformOrigin: anchor }}>
      {after && (
        <div style={{ position: 'absolute', inset: 0, filter: `brightness(${1 + g * 1.6})` }}>
          <CostumeBack pops={p} />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, filter: g > 0 ? `drop-shadow(0 0 ${20 + g * 50}px rgba(255,170,215,${0.4 + g * 0.6}))` : undefined }}>
        <Layer src={after ? 'child_magic.png' : 'child.png'} box={CHILD} />
        {g > 0 && (
          <div
            style={{
              position: 'absolute',
              left: CHILD[0],
              top: CHILD[1],
              width: CHILD[2],
              height: CHILD[3],
              background: lightFill,
              WebkitMaskImage: mask,
              WebkitMaskSize: '100% 100%',
              opacity: Math.min(0.94, g * 1.05),
            }}
          />
        )}
      </div>
      {after && (
        <div style={{ position: 'absolute', inset: 0, filter: `brightness(${1 + g * 1.6})` }}>
          <CostumeFront pops={{ ...p, cat: 0 }} />
        </div>
      )}
    </div>
  );
};

const Cat: React.FC<{ f: number; fps: number; p: Pops }> = ({ f, fps, p }) => {
  const squash = spring({ frame: f - T.highFive, fps, config: { damping: 7, stiffness: 200 } }) * interpolate(f, [T.highFive, 165], [1, 0], clamp);
  const happy = f > T.reveal ? Math.max(0, Math.sin((f - T.reveal) / 5)) * interpolate(f, [T.reveal, T.reveal + 40], [1, 0], clamp) : 0;
  const anchor = `${CAT[0] + CAT[2] / 2}px ${CAT[1] + CAT[3]}px`;
  return (
    <div style={{ position: 'absolute', inset: 0, width: IW, height: IH, transformOrigin: anchor, transform: `translateY(${-happy * 16}px) scale(${1 + squash * 0.04}, ${1 - squash * 0.03})` }}>
      <Layer src="cat.png" box={CAT} />
      <div style={{ position: 'absolute', inset: 0 }}>
        <CostumeFront pops={{ cape: 0, collar: 0, skirt: 0, ribbon: 0, ears: 0, tail: 0, cat: p.cat }} />
      </div>
    </div>
  );
};

// 화면 기준 반짝이: 등장 순간·엔딩에 터지고 내리는 반짝이
const ScreenGlitter: React.FC<{ f: number }> = ({ f }) => {
  const items: React.ReactNode[] = [];
  const bursts = [
    { at: T.reveal, cx: 700, cy: 820, n: 40 },
    { at: T.ending, cx: 540, cy: 900, n: 70 },
  ];
  bursts.forEach((b, bi) => {
    const d = f - b.at;
    if (d < 0 || d > 60) return;
    for (let i = 0; i < b.n; i++) {
      const a = random(`sa${bi}${i}`) * Math.PI * 2;
      const v = 10 + random(`sv${bi}${i}`) * 26;
      const fall = 0.25 * d * d;
      const x = b.cx + Math.cos(a) * v * d;
      const y = b.cy + Math.sin(a) * v * d + fall;
      const tw = 0.6 + 0.4 * Math.sin(d * 0.8 + i);
      items.push(
        <Shape key={`${bi}-${i}`} kind={i % 5 === 0 ? 'heart' : i % 3 === 0 ? 'star' : 'sparkle'} x={x} y={y} r={(14 + random(`sr${bi}${i}`) * 22) * tw} color={PASTEL[i % PASTEL.length]} rot={d * 5} opacity={1 - d / 60} glow={false} />
      );
    }
  });
  // 등장 이후 계속 내리는 잔잔한 반짝이
  if (f > T.reveal) {
    for (let i = 0; i < 36; i++) {
      const start = T.reveal + random(`gs${i}`) * 150;
      const d = f - start;
      if (d < 0) continue;
      const x = random(`gx${i}`) * VW + Math.sin(d / 12 + i) * 30;
      const y = -40 + ((d * (3 + random(`gv${i}`) * 4)) % (VH + 80));
      const tw = 0.5 + 0.5 * Math.sin(d * 0.35 + i * 1.7);
      items.push(<Shape key={`g${i}`} kind="sparkle" x={x} y={y} r={8 + tw * 14} color={PASTEL[i % PASTEL.length]} opacity={0.85} glow={false} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} style={{ position: 'absolute', inset: 0, overflow: 'visible', filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.9))' }}>
      {items}
    </svg>
  );
};

// 대사 자막
const Lines: React.FC<{ f: number; fps: number }> = ({ f, fps }) => {
  const s1 = spring({ frame: f - T.line1, fps, config: { damping: 9, stiffness: 170 } });
  const s2 = spring({ frame: f - T.line2, fps, config: { damping: 14, stiffness: 120 } });
  if (f < T.line1) return null;
  const text: React.CSSProperties = {
    fontFamily: 'Jua, sans-serif',
    color: '#ffffff',
    WebkitTextStroke: '14px #ff5fa8',
    paintOrder: 'stroke fill',
    textShadow: '0 6px 0 #b9408a, 0 0 30px rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 1.15,
    letterSpacing: '0.01em',
  };
  const twinkle = (x: number, y: number, r: number, i: number) => (
    <Shape key={i} kind="sparkle" x={x} y={y} r={r * (0.7 + 0.3 * Math.sin(f * 0.4 + i))} color={i % 2 ? '#ffd36e' : '#ffffff'} glow={false} />
  );
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1380, display: 'flex', justifyContent: 'center' }}>
        <div style={{ ...text, fontSize: 104, transform: `scale(${s1}) rotate(${(1 - s1) * -6}deg)`, opacity: Math.min(1, s1 * 2) }}>반짝반짝 냥냥 파워!</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1560, display: 'flex', justifyContent: 'center', opacity: s2, transform: `translateY(${(1 - s2) * 60}px)` }}>
        <div style={{ ...text, fontSize: 66, WebkitTextStroke: '11px #a77bff', textShadow: '0 5px 0 #6c4bc2, 0 0 24px rgba(255,255,255,0.9)' }}>
          사랑과 정의를 지키는
          <br />
          고양이 마법소녀, 등장!
        </div>
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} style={{ position: 'absolute', inset: 0, opacity: s1, filter: 'drop-shadow(0 0 8px #fff)' }}>
        {twinkle(70, 1400, 30, 1)}
        {twinkle(1010, 1395, 34, 2)}
        {twinkle(140, 1640, 22, 3)}
        {twinkle(950, 1700, 26, 4)}
      </svg>
    </AbsoluteFill>
  );
};

// 순간 섬광 (하이파이브, 빛 최고점, 등장, 엔딩)
const Flash: React.FC<{ f: number }> = ({ f }) => {
  const at = (s: number, len: number, peak: number) => (f >= s && f <= s + len ? peak * (1 - (f - s) / len) : 0);
  const a = Math.max(at(T.highFive, 10, 0.55), at(T.glowPeak - 2, 16, 0.7), at(T.reveal, 12, 0.6), at(T.ending, 14, 0.5));
  if (a <= 0) return null;
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 60% 45%, #ffffff, #ffe7f3 60%, #fff4cf)', opacity: a }} />;
};

const useFont = () => {
  const [handle] = useState(() => delayRender('Jua 글꼴'));
  useEffect(() => {
    document.fonts.load('100px Jua', '반짝냥').then(() => continueRender(handle), () => continueRender(handle));
  }, [handle]);
};

export const NyangMagic: React.FC = () => {
  useFont();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = camera(f);
  const p = pops(f, fps);
  const photo = interpolate(f, [T.photoEnd - 6, T.photoEnd + 2], [1, 0], clamp);
  const intro = interpolate(f, [0, 10], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: '#fde7f1', overflow: 'hidden' }}>
      <Backdrop f={f} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: IW, height: IH, transformOrigin: '0 0', transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})` }}>
        <Img src={staticFile('plate.jpg')} style={{ position: 'absolute', left: 0, top: 0, width: IW, height: IH }} />
        <MagicSky f={f} />
        <Orbit f={f} front={false} />
        <Cat f={f} fps={fps} p={p} />
        <CatPaw f={f} fps={fps} />
        <Child f={f} fps={fps} p={p} />
        <LightRibbons f={f} />
        <Orbit f={f} front />
        <Burst f={f} />
        {photo > 0 && <Img src={staticFile('source.png')} style={{ position: 'absolute', left: 0, top: 0, width: IW, height: IH, opacity: photo }} />}
        {/* 사진 테두리: 세로 화면 위아래 흐린 배경과 경계를 부드럽게 */}
        <div style={{ position: 'absolute', inset: 0, boxShadow: '0 0 60px 30px rgba(255,220,238,0.55)', pointerEvents: 'none' }} />
      </div>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(255,214,234,0.5), transparent 18%, transparent 78%, rgba(231,212,255,0.55))' }} />
      <ScreenGlitter f={f} />
      <Lines f={f} fps={fps} />
      <Flash f={f} />
      {intro > 0 && <AbsoluteFill style={{ background: '#fff', opacity: intro }} />}
      {BGM_SRC && <Audio src={staticFile(BGM_SRC)} />}
    </AbsoluteFill>
  );
};

