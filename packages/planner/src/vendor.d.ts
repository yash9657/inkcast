/**
 * Ambient declaration for the one optional dependency that ships no types.
 *
 * `optional.ts` reaches every optional package through a literal `import()` so a
 * bundler can follow the edge (see the note at the top of that file). That means
 * `tsc` now resolves `turndown`, which is plain JavaScript with no adjacent
 * `.d.ts` and no `@types` entry in this workspace — without this file the
 * planner fails to typecheck under `noImplicitAny`.
 *
 * Only the surface `htmlToMarkdown()` actually calls is declared, deliberately:
 * the alternative is `declare module 'turndown';`, which types the whole package
 * as `any` and would let a typo through silently. Anything else should be added
 * here on purpose.
 */

declare module 'turndown' {
  export interface TurndownOptions {
    headingStyle?: 'setext' | 'atx';
    codeBlockStyle?: 'indented' | 'fenced';
    bulletListMarker?: '-' | '+' | '*';
    emDelimiter?: '_' | '*';
    strongDelimiter?: '__' | '**';
    hr?: string;
    fence?: '```' | '~~~';
    linkStyle?: 'inlined' | 'referenced';
  }

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    /** Drop these elements and their contents entirely. */
    remove(filter: string | string[]): this;
    turndown(html: string): string;
  }
}
