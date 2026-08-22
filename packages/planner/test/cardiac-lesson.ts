/**
 * The cardiac conduction lesson that produced the only keyed film this repo has rendered
 * — `projects/cardiac8f`, 176.3s, ten scenes — copied out of its `lesson.json` so a test
 * can use it. `projects/` is gitignored, so a real rendered project cannot be a fixture;
 * this is the next best thing, which is the same bytes with the drawings removed.
 *
 * Verbatim except for `visuals`, which are emptied. Nothing tested here reads them: the
 * trimmer's decisions come from `narration`, `idea`, `because`, `hold` and `derivedFrom`,
 * and `pickVisuals` on an empty list is a no-op. Everything else — including the
 * `coreInsight` and the strict `step1 → … → step7` chain that makes the tail of the
 * lesson the trimmer's only legal victim — is what the model actually wrote.
 *
 * Regenerate from a rendered project with:
 *
 *     node -e 'const l=require("./projects/cardiac8f/lesson.json"); …'
 *
 * and re-read the header of `insight.test.ts` before changing a word of it: the numbers
 * asserted there are measurements of *this* text.
 */
import { Lesson } from '@inkcast/core';

export const CARDIAC: Lesson = Lesson.parse({
  "version": 1,
  "topic": "The Cardiac Conduction System",
  "audience": "a first-year medical student with no cardiology background",
  "objective": "Trace the impulse from SA node to Purkinje fibres and explain why the AV node delay is necessary for ventricular filling",
  "kind": "stem",
  "strategy": "first-principles",
  "coreInsight": "The heart's wiring exists to enforce timing: the top chambers must finish squeezing before the bottom ones start, and the bottom ones must squeeze all at once from the base upward.",
  "jargonBudget": [
    "SA node",
    "AV node",
    "bundle of His",
    "bundle branches",
    "Purkinje fibres"
  ],
  "hook": {
    "idea": "Two pumps stacked in a row must never squeeze together",
    "because": "If the top chamber and the bottom chamber squeeze at the same instant, the top pushes into a chamber that is already pushing back, so no blood moves forward",
    "narration": "Picture two bags of water stacked, the top one draining into the bottom one. Squeeze both at the same moment. Nothing goes anywhere. Your heart is those two bags.",
    "from": "given",
    "derivedFrom": [],
    "hold": 0.6,
    "visuals": []
  },
  "anchor": {
    "idea": "The heart is those two pumps: atria on top, ventricles below",
    "because": "The upper chambers empty into the lower ones through valves, so the same stacked-bag problem is built into the real organ",
    "narration": "Here is the real thing. Two thin chambers on top, two thick ones below. The top ones fill the bottom ones through valves. So the heart faces exactly that timing problem, every single beat.",
    "from": "given",
    "derivedFrom": [],
    "hold": 0.5,
    "visuals": []
  },
  "steps": [
    {
      "idea": "A patch of cells at the top fires on its own and starts every beat",
      "because": "Muscle only contracts when an electrical signal reaches it, so something must generate that signal, and the cells that fire fastest set the pace for everyone",
      "narration": "Heart muscle only squeezes when electricity reaches it. A small patch of cells high in the right atrium leaks itself to a spark, over and over, all by itself. That patch is the sinoatrial node.",
      "from": "derived",
      "derivedFrom": [
        "anchor"
      ],
      "hold": 0.4,
      "visuals": []
    },
    {
      "idea": "The spark spreads across the atria and squeezes them",
      "because": "Heart muscle cells are joined electrically, so a signal in one cell passes straight into its neighbours and the whole sheet contracts as one",
      "narration": "Heart cells are wired to their neighbours. So the spark spreads sideways through the atrial muscle like a ripple, and the top chambers squeeze, pushing blood down into the ventricles.",
      "from": "derived",
      "derivedFrom": [
        "step1"
      ],
      "hold": 0.4,
      "visuals": []
    },
    {
      "idea": "A wall of insulation stops the wave from reaching the ventricles",
      "because": "If the ripple could cross straight into the lower muscle, both pumps would squeeze at once, which is the failure from the very first picture",
      "narration": "Now, if that ripple ran straight on into the lower chambers, both pumps would squeeze together. Nothing would move. So a ring of tough, non-conducting tissue separates top from bottom. The wave dies there.",
      "from": "derived",
      "derivedFrom": [
        "hook",
        "step2"
      ],
      "hold": 0.6,
      "visuals": []
    },
    {
      "idea": "One doorway crosses the wall, and it conducts slowly on purpose",
      "because": "A single slow gateway buys time: the atria finish emptying before the signal ever arrives at the ventricles",
      "narration": "There is exactly one doorway through that wall. Its cells pass the signal slowly, holding it for about a tenth of a second. That pause is the whole point. The atria finish emptying first.",
      "from": "derived",
      "derivedFrom": [
        "step3"
      ],
      "hold": 0.7,
      "visuals": []
    },
    {
      "idea": "Below the doorway, a fast cable carries the signal to the bottom of the heart",
      "because": "The ventricles must empty upward into vessels that leave from the top, so the squeeze has to start at the very bottom, which means the signal must be delivered there first",
      "narration": "Below the doorway the signal speeds up again. A cable runs down the wall between the ventricles, splits left and right, and carries the impulse all the way to the bottom tip. That cable is the bundle of His.",
      "from": "derived",
      "derivedFrom": [
        "step4"
      ],
      "hold": 0.4,
      "visuals": []
    },
    {
      "idea": "A fine mesh spreads the signal through the ventricle walls in milliseconds",
      "because": "Muscle-to-muscle spread would be too slow and uneven, so a dedicated fast network makes the whole ventricle contract as one unit",
      "narration": "At the tip, the cable frays into a fine mesh threaded through the muscle. It conducts fast, so the whole lower wall gets the signal almost at once. Those threads are the Purkinje fibres.",
      "from": "derived",
      "derivedFrom": [
        "step5"
      ],
      "hold": 0.4,
      "visuals": []
    },
    {
      "idea": "Starting at the bottom wrings blood upward into the outflow vessels",
      "because": "The exits sit at the top of the ventricles, so a squeeze that begins at the tip and travels upward pushes blood toward the doors rather than away from them",
      "narration": "So the squeeze starts at the tip and travels upward. The exits sit at the top. Squeezing from the bottom up wrings the blood toward the doors, like squeezing a toothpaste tube from the end.",
      "from": "derived",
      "derivedFrom": [
        "step6"
      ],
      "hold": 0.5,
      "visuals": []
    }
  ],
  "worked": {
    "idea": "Add up the timing of one beat",
    "because": "Putting real numbers on each leg shows the delay is the largest single cost in the path, and that it is spent buying filling time",
    "narration": "Count one beat. The atria take about ninety milliseconds to squeeze. The doorway holds the signal for one hundred. Ninety is less than a hundred, so the top finishes before the bottom starts. The mesh then fires the ventricles in thirty.",
    "from": "derived",
    "derivedFrom": [
      "step4",
      "step6"
    ],
    "hold": 0.8,
    "visuals": []
  },
  "misconception": {
    "idea": "The delay is not a flaw in a slow gateway",
    "because": "Learners hear slow and assume weakness, when a fast doorway would actually make the heart pump worse",
    "narration": "You might now say the doorway is slow because those cells are weak. Wrong way round. Speed it up and the ventricles fire while the atria are still emptying. The heart would beat hard and pump almost nothing.",
    "from": "derived",
    "derivedFrom": [
      "worked"
    ],
    "hold": 0.7,
    "visuals": []
  },
  "recap": {
    "idea": "The wiring exists to enforce timing",
    "because": "Every part of the path was chosen by one requirement: top finishes, then bottom squeezes from the tip upward",
    "narration": "So: a patch up top fires. The atria ripple and squeeze. A tough ring blocks the wave. One slow doorway holds it, the atria finish, then the cable and mesh fire the bottom tip upward. Wiring is timing.",
    "from": "derived",
    "derivedFrom": [
      "step1",
      "step2",
      "step3",
      "step4",
      "step5",
      "step6",
      "step7"
    ],
    "hold": 0.5,
    "visuals": []
  }
}
);
