import { Composition } from 'remotion';
import { NyangMagic } from './NyangMagic';
import { FPS, DURATION } from './cues';

export const Root: React.FC = () => (
  <Composition id="NyangMagic" component={NyangMagic} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
);
