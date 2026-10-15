import { Audio, Sequence, staticFile } from 'remotion';

import { s, word } from './theme';

type Cue = readonly [file: string, at: number, volume: number];

/** Effects follow what is drawn; every time is a spoken word or a camera move. */
const CUES: readonly Cue[] = [
  ['pen_long', 0.7, 0.32],
  ['pen', 2.1, 0.22],
  ['whoosh', 2.5, 0.3],
  ['type', word('topic'), 0.25],
  ['pop', word('Type') - 0.1, 0.35],
  ['pop', word('PDF') - 0.15, 0.35],
  ['pop', word('link') - 0.15, 0.35],
  ['whoosh', 6.1, 0.3],
  ['pen', word('summarize') + 0.25, 0.4],
  ['pen', word('designs'), 0.28],
  ['pop', word('hook') - 0.12, 0.38],
  ['pop', word('example') - 0.15, 0.38],
  ['pop', word('mistake') - 0.1, 0.38],
  ['stamp', 14.45, 0.4],
  ['whoosh', 14.8, 0.3],
  ['pen_long', word('draws') - 0.5, 0.25],
  ['whoosh', 20.0, 0.3],
  ['pop', word('voice', 1) - 0.1, 0.3],
  ['pop', word('style') - 0.1, 0.3],
  ['pop', word('shape') - 0.1, 0.3],
  ['whoosh', 23.1, 0.3],
  ['type', word('change') + 0.1, 0.25],
  ['pen', word('redraws') - 0.35, 0.45],
  ['pen_long', word('redraws') + 0.05, 0.3],
  ['whoosh', 27.5, 0.3],
  ['pop', word('Download') - 0.12, 0.35],
  ['pop', word('share') - 0.12, 0.35],
  ['type', word('host') - 0.1, 0.2],
  ['stamp', word('open'), 0.35],
  ['whoosh', 32.7, 0.4],
  ['chime', word('Inkcast', 1) - 0.2, 0.35],
  ['pen', word('drawn'), 0.35],
];

export function SoundTrack(): React.ReactElement {
  return (
    <>
      <Audio src={staticFile('audio/bed.wav')} volume={0.22} />
      {CUES.map(([file, at, volume], i) => (
        <Sequence key={i} from={Math.max(0, s(at))} layout="none">
          <Audio src={staticFile(`audio/${file}.wav`)} volume={volume} />
        </Sequence>
      ))}
    </>
  );
}
