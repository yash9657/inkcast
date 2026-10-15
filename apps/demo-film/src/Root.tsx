import { Composition, Still } from 'remotion';

import { Film } from './Film';
import { Poster } from './Poster';
import { FPS, H, s, TOTAL, W } from './theme';

export function Root(): React.ReactElement {
  return (
    <>
      <Composition
        id="InkcastDemo"
        component={Film}
        durationInFrames={s(TOTAL)}
        fps={FPS}
        width={W}
        height={H}
      />
      <Still id="Poster" component={Poster} width={W} height={H} />
    </>
  );
}
