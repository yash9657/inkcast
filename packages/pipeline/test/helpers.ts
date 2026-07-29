/**
 * Test fixtures and a temporary projects root.
 *
 * `PROJECTS_ROOT` is read once when `@inkcast/core` loads, so a test that needs
 * its own directory must set `INKCAST_PROJECTS` *before* importing anything from
 * the workspace and then reach the pipeline through a dynamic import. That is why
 * this module exports `withProjects()` rather than a plain constant.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Sandbox = { root: string; cleanup: () => Promise<void> };

/** A fresh projects root, with `INKCAST_PROJECTS` pointed at it. */
export async function withProjects(): Promise<Sandbox> {
  const root = await mkdtemp(path.join(tmpdir(), 'inkcast-pipeline-'));
  process.env.INKCAST_PROJECTS = root;
  // Keep the stage packages' own logging out of the test output.
  process.env.INKCAST_LOG ??= 'error';
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * A hand-authored lesson, the shape `examples/lessons/*.lesson.json` uses.
 *
 * Deliberately complete: hook, everyday anchor, one idea per step with a reason,
 * a worked example with real numbers, the misconception, and a recap. It is also
 * the fixture that proves a lesson renders with no planner and no key.
 *
 * Complete now includes the mapping table. Before it existed this fixture morphed the
 * hill into the plot only because step 1's narration happened to say "the hillside
 * becomes a curve", which a regex over the prose picked up; the morph is now derived
 * from `analogy.maps`, so a fixture without one would quietly stop exercising it.
 */
export function sampleLesson(): unknown {
  return {
    version: 1,
    topic: 'Gradient descent',
    audience: 'someone who has never seen calculus',
    objective: 'explain why the parameter update has a minus sign in front of the slope',
    kind: 'stem',
    strategy: 'analogy',
    coreInsight:
      'The ground under your feet is enough to find the valley, because the slope tells you which way is down.',
    analogy: {
      concrete: 'walking downhill in fog',
      maps: [
        { from: 'the height of the hill', to: 'how wrong you are' },
        { from: 'where you stand', to: 'the setting on the dial' },
        { from: 'the slope underfoot', to: 'which way to turn the dial' },
      ],
    },
    jargonBudget: ['gradient', 'derivative', 'loss function'],
    hook: {
      idea: 'You can reach the valley without ever seeing it',
      because: 'the ground under your feet already tells you which way is down',
      narration:
        'You are standing on a foggy hillside and you want to reach the valley. You cannot see it. What do you do?',
      visuals: [
        { describe: 'a hillside in fog with a small figure high on the slope', kind: 'path' },
      ],
      hold: 1.2,
    },
    anchor: {
      idea: 'Feel the slope, step downhill, repeat',
      because: 'each step only needs local information, which is all the fog leaves you',
      narration:
        'You feel which way the ground drops away, you take a step that way, and then you do it again.',
      visuals: [{ describe: 'three steps walking down the drawn hill', kind: 'path' }],
      hold: 0.6,
    },
    steps: [
      {
        idea: 'The hillside is a graph of how wrong you are',
        because:
          'every setting of the dial gives one number for how badly you are doing, and those numbers trace a curve',
        narration:
          'Turn one dial and you get one number for how wrong you are. Plot every setting against its number and the hillside becomes a curve.',
        visuals: [
          { describe: 'a bowl-shaped curve with the dial on the horizontal axis', kind: 'plot' },
        ],
        hold: 0.5,
      },
      {
        idea: 'Steepness at a point is the slope of the line that just touches the curve there',
        because:
          'a straight line laid against the curve at that point matches how fast it is rising there',
        narration:
          'Lay a straight edge against the curve where you are standing. If it tilts up to the right, then downhill is to the left. That is where the minus sign comes from.',
        visuals: [{ describe: 'a tangent line drawn at the point on the curve', kind: 'plot' }],
        hold: 0.8,
      },
    ],
    worked: {
      idea: 'Real numbers make the step concrete',
      because: 'the arithmetic is the whole rule, and it is one subtraction',
      narration:
        'The dial reads three. The slope there is plus four. Multiply by a step size of one tenth and subtract: the dial moves to two point six.',
      visuals: [
        { describe: 'the point sliding down the curve to the new position', kind: 'motion' },
      ],
      hold: 0.7,
    },
    misconception: {
      idea: 'It finds a valley, not the valley',
      because:
        'each step only sees the ground underfoot, so the first valley you fall into keeps you',
      narration:
        'It is tempting to think this finds the lowest point. It does not. It finds the bottom of whichever valley you started above.',
      visuals: [{ describe: 'a second deeper valley the ball never reaches', kind: 'plot' }],
      hold: 0.9,
    },
    recap: {
      idea: 'Downhill, one step at a time, using only what is under your feet',
      because: 'that is the whole algorithm',
      narration:
        'Feel the slope, step against it, repeat. The minus sign is just the word against.',
      visuals: [{ describe: 'the whole board, camera pulled back', kind: 'text' }],
      hold: 0.4,
    },
  };
}
