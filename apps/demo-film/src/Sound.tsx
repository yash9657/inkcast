import { Audio, Sequence, staticFile } from 'remotion';

import { s, word } from './theme';

type Cue = readonly [file: string, at: number, volume: number];

/** Effects follow what is drawn; every time is a spoken word or a camera move. */
const CUES: readonly Cue[] = [
  ['whoosh', 2.5, 0.15],
  ['type', word('topic'), 0.125],
  ['pop', word('Type') - 0.1, 0.175],
  ['pop', word('PDF') - 0.15, 0.175],
  ['pop', word('link') - 0.15, 0.175],
  ['whoosh', 6.1, 0.15],
  ['pop', word('hook') - 0.12, 0.19],
  ['pop', word('example') - 0.15, 0.19],
  ['pop', word('mistake') - 0.1, 0.19],
  ['stamp', 14.45, 0.2],
  ['whoosh', 14.8, 0.15],
  ['whoosh', 20.0, 0.15],
  ['pop', word('voice', 1) - 0.1, 0.15],
  ['pop', word('style') - 0.1, 0.15],
  ['pop', word('shape') - 0.1, 0.15],
  ['whoosh', 23.1, 0.15],
  ['type', word('change') + 0.1, 0.125],
  ['whoosh', 27.5, 0.15],
  ['pop', word('Download') - 0.12, 0.175],
  ['pop', word('share') - 0.12, 0.175],
  ['type', word('host') - 0.1, 0.1],
  ['stamp', word('open'), 0.175],
  ['whoosh', 32.7, 0.2],
  ['chime', word('Inkcast', 1) - 0.2, 0.175],
];

export function SoundTrack(): React.ReactElement {
  return (
    <>
      <Audio src={staticFile('audio/bed.wav')} volume={0.12} />
      {CUES.map(([file, at, volume], i) => (
        <Sequence key={i} from={Math.max(0, s(at))} layout="none">
          <Audio src={staticFile(`audio/${file}.wav`)} volume={volume} />
        </Sequence>
      ))}
    </>
  );
}
