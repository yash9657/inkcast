/**
 * Natural-language storyboard editing.
 *
 * "Edit the video" is really "patch the JSON, then re-render what changed".
 * With no API key that patch comes from `parseInstruction` (regex → ops); with
 * `ANTHROPIC_API_KEY` set, Claude maps the instruction onto the same ops through
 * a forced tool call. Either way `applyOps` is the only thing that touches the
 * IR, and the zod schema is the gate.
 */

import {
  loadStoryboard,
  logger,
  openProject,
  saveStoryboard,
  type Storyboard,
} from '@inkcast/core';
import {
  applyOps,
  coerceOps,
  EditError,
  EDIT_OPS_SCHEMA,
  parseInstruction,
  type EditOp,
} from './ops.js';
import { plannerProvider } from './providers.js';

const log = logger('pipeline:edit');

export type EditResult = {
  storyboard: Storyboard;
  /** One line per change, ready to print. */
  applied: string[];
  /** Which path produced the ops. */
  via: 'local' | 'anthropic';
  ops: EditOp[];
  /**
   * What the edit did to the board's graph — `critiqueStoryboard`, per plan 3.2.
   *
   * Empty on a clean edit. Non-empty means the storyboard on disk now names ink that
   * is not there: this is the one moment a reference can be broken by hand, and the
   * point of reporting it here is that the next thing the user does is re-render, and
   * a dangling morph does not fail a render — it just does not happen.
   */
  problems: string[];
};

/**
 * Apply a plain-English instruction to a saved project's storyboard.
 * The storyboard is saved back; call `rerender(projectId)` to get a new video.
 */
export async function editStoryboard(projectId: string, instruction: string): Promise<Storyboard> {
  return (await editProject(projectId, instruction)).storyboard;
}

/** Same as `editStoryboard`, but tells you what it did. */
export async function editProject(projectId: string, instruction: string): Promise<EditResult> {
  const project = await openProject(projectId);
  let current: Storyboard;
  try {
    current = await loadStoryboard(project.dir);
  } catch (cause) {
    throw new EditError(`project "${projectId}" has no storyboard.json yet`, { cause });
  }

  let ops: EditOp[] | undefined;
  let via: 'local' | 'anthropic' = 'local';
  const planner = plannerProvider();

  if (planner.cloud) {
    try {
      ops = await opsFromClaude(current, instruction, planner.model ?? 'claude-opus-5');
      via = 'anthropic';
    } catch (err) {
      log.warn('Claude edit failed — falling back to the local instruction parser', err);
    }
  }
  if (!ops || ops.length === 0) {
    ops = parseInstruction(current, instruction);
    via = 'local';
  }

  const { storyboard, applied, problems } = applyOps(current, ops);
  await saveStoryboard(project.dir, storyboard);
  log.info(`applied ${applied.length} change(s) via ${via}`);
  if (problems.length > 0) {
    log.warn(
      `the edited storyboard has ${problems.length} broken reference${problems.length === 1 ? '' : 's'}:\n  - ` +
        problems.join('\n  - '),
      'a strict render will stop on these; fix them or re-cast',
    );
  }
  return { storyboard, applied, via, ops, problems };
}

/* ---------------------------------------------------------------- the LLM bit */

const SYSTEM = `You edit a storyboard for a hand-drawn explainer video by emitting edit operations.

You are given a compact summary of the storyboard and one instruction from the user.
Call the \`edit_storyboard\` tool exactly once with the smallest list of operations
that satisfies the instruction. Rules:

- Reference scenes by their id, never by position, when the id is shown.
- Only change what was asked. Do not "improve" narration that was not mentioned.
- Narration is spoken aloud: plain sentences, no markdown, no stage directions.
- One idea per scene. If the user asks for more detail, insert a scene rather than
  making one scene long.
- If the instruction cannot be expressed with these operations, return an empty ops list.`;

/** A short, cheap description of the storyboard — enough to edit it precisely. */
function summarise(sb: Storyboard): string {
  const lines = [
    `title: ${sb.title}`,
    `meta: ${JSON.stringify(sb.meta)}`,
    `canvas: ${JSON.stringify(sb.canvas)}`,
    `assets: ${sb.assets.map((a) => `${a.id}(${a.kind})`).join(', ') || 'none'}`,
    'scenes:',
  ];
  sb.scenes.forEach((s, i) => {
    lines.push(`  ${i + 1}. id=${s.id} camera=${JSON.stringify(s.camera)}`);
    lines.push(`     narration: ${s.narration}`);
    if (s.elements.length > 0) {
      lines.push(
        `     elements: ${s.elements
          .map((e) => `${e.id}:${e.type}${e.type === 'text' ? `("${e.text}")` : ''}`)
          .join(', ')}`,
      );
    }
  });
  return lines.join('\n');
}

async function opsFromClaude(
  sb: Storyboard,
  instruction: string,
  model: string,
): Promise<EditOp[]> {
  const { anthropicClient } = await import('@inkcast/planner');
  const client = await anthropicClient();
  if (!client) throw new Error('No model provider is available for this edit');

  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${summarise(sb)}\n\ninstruction: ${instruction}` }],
    tools: [
      {
        name: 'edit_storyboard',
        description: 'Apply edit operations to the storyboard.',
        input_schema: EDIT_OPS_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'edit_storyboard' },
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Claude returned no tool_use block');
  return coerceOps(block.input);
}

/** The slice of the Anthropic SDK we use, so the import can stay dynamic. */
type AnthropicLike = {
  messages: {
    create(body: unknown): Promise<{
      content: Array<{ type: string; input?: unknown }>;
    }>;
  };
};
