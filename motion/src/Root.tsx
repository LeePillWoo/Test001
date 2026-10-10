import { Composition } from 'remotion';
import { NyangMagic } from './NyangMagic';
import { Idle } from './Idle';
import { FPS, DURATION } from './cues';

export const Root: React.FC = () => (
  <>
    <Composition id="NyangMagic" component={NyangMagic} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="IdleLoop" component={Idle} durationInFrames={6 * FPS} fps={FPS} width={1080} height={1920} />
  </>
);
