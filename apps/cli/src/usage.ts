import { paint } from './ui.js';

export function usage(color: boolean): string {
  const c = paint(color);
  const h = (s: string) => c.bold(s);
  const f = (s: string) => c.cyan(s);
  return `${c.bold('inkcast')} — open-source AI explainer videos. Documents in, hand-drawn whiteboard video out.

${h('USAGE')}
  ${f('cast')} <file|url|-> [options]            make a video
  ${f('inkcast list')}                           list projects on disk
  ${f('inkcast open')} <id>                      open a project's video in your player
  ${f('inkcast edit')} <id> "<instruction>"      patch the storyboard in plain English
  ${f('inkcast rerender')} <id>                  rebuild the video from the storyboard
  ${f('inkcast preview')} <id> [--port 4321]     serve a preview page on localhost
  ${f('inkcast providers')}                      show which provider each stage will use

${h('OPTIONS')}
  -t, --title <text>     title for the video (default: taken from the source)
      --aspect <ratio>   16:9 | 9:16 | 1:1                       (default 16:9)
      --lang <code>      narration language, e.g. en, es, fr     (default en)
      --voice <id>       voice id, e.g. af_heart, am_puck        (default af_heart)
      --style <style>    marker | pencil | chalk | ink           (default marker)
      --palette <name>   mono | color                            (default color)
  -o, --out <path>       also copy the finished mp4 to this path
      --project <id>     reuse (and resume) a specific project directory
  -f, --force            redo every stage, ignoring the cache
      --open             open the video when it is done
      --json             machine-readable result on stdout, no progress bar
      --verbose          debug logging instead of the progress bar
      --quiet            errors only
      --port <n>         port for \`preview\`                      (default 4321)
  -h, --help             show this help
      --version          print the version

${h('EXAMPLES')}
  cast examples/gradient-descent.md
  cast https://en.wikipedia.org/wiki/Backpropagation --aspect 9:16 --style pencil
  pbpaste | cast - --title "Sprint review"
  cast "Explain why B-trees beat binary trees on disk" --palette mono
  inkcast edit 8f2ac1d0b3e4 "scene 3 narration: slow down and give an example"
  inkcast rerender 8f2ac1d0b3e4 && inkcast open 8f2ac1d0b3e4

${c.dim(`Every stage has a local default, so this works with no API keys and costs $0.00.
Set keys in .env to upgrade individual stages — see .env.example.
Exit codes: 0 success, 1 failed, 2 bad usage.`)}
`;
}
