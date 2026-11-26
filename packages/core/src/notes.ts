/**
 * What a comment above a declaration says about why (P234).
 *
 * A comment that starts with a tag - `// WHY:`, `/** DECISION: … *\/`, `#
 * NOTE:` is not TypeScript, so only `//` and block comments - is kept on the
 * node it stands above, by position, which is a fact: the author put it there.
 * Its words are quoted, never summarised, and bounded: at most `MAX_NOTES`
 * per node, each at most `MAX_NOTE_CHARS`. A comment inside a body is about a
 * line, not the declaration, and is never read. An `@see path.md` in a doc
 * comment is kept the same way, as `SEE: path.md`.
 *
 * Read from the text a reader already holds, with no second parse: from the
 * line above the declaration upward, over decorators, to the first line that
 * is neither a comment nor a decorator.
 */
export const DEFAULT_NOTE_TAGS: readonly string[] = Object.freeze(['WHY', 'NOTE', 'DECISION', 'HACK', 'SEE']);

export const MAX_NOTES = 3;
export const MAX_NOTE_CHARS = 300;

/** The meta key a node's notes are kept under: `TAG: words`, one string each. */
export const NOTES_META = 'notes';

/** Node types a note can stand above: declarations, not the call sites inside a body. */
const NOTED_TYPES: ReadonlySet<string> = new Set(['method', 'function', 'entry', 'consumer', 'class']);

/** A line that is part of a comment: `//`, or a block comment's opening, middle or close. */
const isCommentLine = (line: string): boolean => /^(\/\/|\/\*|\*|\*\/)/.test(line);

/** A decorator, or a line inside one's arguments that closes on the same line. */
const isDecoratorLine = (line: string): boolean => /^@[\w.]+(\(.*\))?\s*$/.test(line);

/** A comment's own words: the markers off. */
const wordsOf = (line: string): string =>
  line
    .replace(/^\/\/+\s?/, '')
    .replace(/^\/\*+\s?/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\*+\s?/, '')
    .trim();

/**
 * The notes of the comment directly above `line` (1-based) in `text`: each
 * tagged paragraph as `TAG: words`, an untagged comment none.
 */
export const leadingNotes = (text: string, line: number, tags: readonly string[] = DEFAULT_NOTE_TAGS): string[] => {
  const lines = text.split(/\r?\n/);
  const above: string[] = [];
  for (let at = line - 2; at >= 0; at -= 1) {
    const trimmed = (lines[at] ?? '').trim();
    if (isDecoratorLine(trimmed)) continue;
    if (!isCommentLine(trimmed)) break;
    above.unshift(wordsOf(trimmed));
  }
  if (above.length === 0) return [];
  const tagged = new RegExp(`^(${tags.map((tag) => tag.replace(/[^A-Za-z]/g, '')).join('|')}):\\s*(.*)$`, 'i');
  const notes: string[] = [];
  let current: { tag: string; words: string[] } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const said = current.words.join(' ').replace(/\s+/g, ' ').trim();
    if (said !== '') notes.push(`${current.tag}: ${said.length > MAX_NOTE_CHARS ? `${said.slice(0, MAX_NOTE_CHARS - 1)}…` : said}`);
    current = undefined;
  };
  for (const words of above) {
    const see = /^@see\s+(\S+)/.exec(words);
    const match = tagged.exec(words);
    if (see !== null && tags.some((tag) => tag.toUpperCase() === 'SEE')) {
      flush();
      notes.push(`SEE: ${see[1]}`);
    } else if (match !== null) {
      flush();
      current = { tag: (match[1] as string).toUpperCase(), words: [match[2] as string] };
    } else if (words === '' || words.startsWith('@') || /^[A-Z]{2,}:/.test(words)) {
      // A blank line, a doc tag, or a tag not asked for ends the paragraph.
      flush();
    } else if (current !== undefined) {
      current.words.push(words);
    }
  }
  flush();
  return notes.slice(0, MAX_NOTES);
};

/** Where a reader finds a file's text, by its repository-relative path; undefined when it cannot. */
export type SourceText = (file: string) => string | undefined;

/**
 * Every declaration node's notes, from the text of its file, read once per
 * file. A node that has none gains nothing.
 */
export const attachNotes = (
  nodes: Iterable<{ type: string; file?: string; line?: number; meta?: Record<string, unknown> }>,
  textOf: SourceText,
  tags: readonly string[] = DEFAULT_NOTE_TAGS,
): void => {
  const texts = new Map<string, string | undefined>();
  for (const node of nodes) {
    if (!NOTED_TYPES.has(node.type) || node.file === undefined || node.line === undefined) continue;
    let text = texts.get(node.file);
    if (!texts.has(node.file)) {
      text = textOf(node.file);
      texts.set(node.file, text);
    }
    if (text === undefined) continue;
    const notes = leadingNotes(text, node.line, tags);
    if (notes.length > 0) node.meta = { ...node.meta, [NOTES_META]: notes };
  }
};

/** A parsed project's text of a repository-relative file, as a reader holds it: no file read twice. */
export const projectText =
  (project: { getSourceFile(path: string): { getFullText(): string } | undefined }, repoDir: string): SourceText =>
  (file) =>
    project.getSourceFile(`${repoDir.replace(/[\\/]+$/, '')}/${file}`)?.getFullText();
