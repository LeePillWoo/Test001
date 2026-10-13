// 6초 반복 대기 동작: 원래 그림 그대로, 아이와 고양이만 숨쉬고 갸웃하고 깜빡인다.
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import layers from '../public/layers.json';
import { MeshLayer } from './MeshLayer';
import { catDeform, catOverlay, childDeform, childOverlay } from './rig';

const IW = 1086;
const IH = 1448;

export const Idle: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = f / fps;
  const scale = width / IW;
  const top = (height - IH * scale) / 2;
  return (
    <AbsoluteFill style={{ background: '#fde7f1', overflow: 'hidden' }}>
      <Img
        src={staticFile('source.png')}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(36px) saturate(1.2) brightness(1.08)', transform: 'scale(1.15)' }}
      />
      <div style={{ position: 'absolute', left: (width - IW * scale) / 2, top, width: IW, height: IH, transformOrigin: '0 0', transform: `scale(${scale})` }}>
        <Img src={staticFile('plate.jpg')} style={{ position: 'absolute', left: 0, top: 0, width: IW, height: IH }} />
        <MeshLayer src="cat.png" box={layers.cat} t={t} deform={catDeform} overlay={catOverlay} />
        <MeshLayer src="child.png" box={layers.child} t={t} deform={childDeform} overlay={childOverlay} />
        <div style={{ position: 'absolute', inset: 0, boxShadow: '0 0 60px 30px rgba(255,220,238,0.55)' }} />
      </div>
    </AbsoluteFill>
  );
};
