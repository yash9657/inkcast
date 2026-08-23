import { paint } from './ui.js';

export function usage(color: boolean): string {
  const c = paint(color);
  const h = (s: string) => c.bold(s);
  const f = (s: string) => c.cyan(s);
  return `${c.bold('inkcast')} — open-source AI explainer videos. A topic in, a hand-drawn whiteboard lesson out.

${h('START HERE')}
  ${f('inkcast keys set anthropic')}               store a key — this is what makes the lessons good
  ${f('inkcast teach')} "gradient descent"         teach a topic from scratch
  ${f('inkcast teach')} "the Krebs cycle" --short  a 9:16 vertical short

${h('USAGE')}
  ${f('inkcast teach')} <topic> [options]          design a lesson and render it
  ${f('cast')} <file|url|topic|lesson.json|->      same pipeline, from a source you already have
  ${f('inkcast lesson')} <id>                      print what a project teaches, and how to edit it
  ${f('inkcast keys')} [list|set|validate|delete]  manage API keys (shared with the studio)
  ${f('inkcast list')}                             list projects on disk
  ${f('inkcast open')} <id>                        open a project's video in your player
  ${f('inkcast edit')} <id> "<instruction>"        patch the storyboard in plain English
  ${f('inkcast rerender')} <id>                    rebuild the video from the storyboard
  ${f('inkcast preview')} <id> [--port 4321]       serve a preview page on localhost
  ${f('inkcast providers')}                        show which provider each stage will use

${h('LESSON')}
      --depth <level>    quick | standard | deep — how thorough    (default standard)
      --objective <text> what the learner must be able to DO afterwards
      --audience <text>  who it is pitched at, e.g. "a first-year undergrad"
      --brief <text>     extra direction for the lesson author
      --seconds <n>      hard runtime target; overrides --depth and the preset
      --lesson <path>    render a hand-authored *.lesson.json (no model, no key)

${h('FORMAT')}
      --short            9:16 vertical with short-form pacing
      --aspect <ratio>   16:9 | 9:16 | 1:1                          (default 16:9)
      --preset <name>    standard | short | square | explainer
      --board <mode>     accumulate | wipe — one idea per card     (default accumulate)
  -t, --title <text>     title for the video (default: the lesson's topic)
      --voice <id>       voice id, e.g. af_heart, am_puck           (default af_heart)
      --lang <code>      narration language, e.g. en, es, fr        (default en)
      --style <style>    marker | pencil | chalk | ink              (default marker)
      --palette <name>   mono | color                              (default color)

${h('OPTIONS')}
  -o, --out <path>       also copy the finished mp4 to this path
      --project <id>     reuse (and resume) a specific project directory
  -f, --force            redo every stage, ignoring the cache
      --degrade          render through detected quality defects (they are
                         recorded instead of blocking; the default is strict)
      --open             open the video when it is done
      --json             machine-readable result on stdout, no progress bar
      --verbose          debug logging instead of the progress bar
      --quiet            errors only
      --port <n>         port for \`preview\`                        (default 4321)
      --via <route>      lesson (default) | document — see below
  -h, --help             show this help
      --version          print the version

${h('EXAMPLES')}
  inkcast teach "why the sky is blue" --objective "explain Rayleigh scattering without maths"
  inkcast teach "compound interest" --short --depth quick --out shorts/
  cast examples/gradient-descent.md --depth deep
  cast examples/lessons/gradient-descent.lesson.json      # no key needed at all
  cast https://en.wikipedia.org/wiki/Backpropagation --aspect 9:16 --style pencil
  pbpaste | cast - --title "Sprint review"
  inkcast lesson last                                     # then edit lesson.json
  inkcast keys validate

${h('THE PIPELINE')}
  ${c.dim('ingest → lesson → storyboard → voice → visuals → render')}
  ${c.dim('The lesson stage decides what to teach before anything is drawn; voice runs')}
  ${c.dim('before visuals because it resolves each element onto the words that introduce it.')}
  ${c.dim('`--via document` skips the lesson stage and summarises instead. It is the')}
  ${c.dim("renderer's zero-key test fixture, not a route to a video worth watching.")}

${c.dim(`Everything runs with no API keys, but not equally well: without an Anthropic key the
lesson is derived from document structure instead of taught, and the CLI will say so.
Exit codes: 0 success, 1 failed, 2 bad usage.`)}
`;
}
