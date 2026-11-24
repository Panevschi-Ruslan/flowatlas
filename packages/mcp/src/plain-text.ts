/**
 * Answers handed to the model as plain text (P382).
 *
 * Claude Code hands the model `JSON.stringify(structuredContent)` when an
 * answer carries one, and the text only when it does not. Code or Markdown
 * inside a JSON string arrives escaped: every newline `\n`, every quote
 * `\"`, the indentation run together on one line, which the model reads
 * worse and pays more for. So the two tools whose answer is a text to read,
 * `get_source` (code) and `describe_for_prompt` (Markdown), answer compact as
 * that text with no structured content: the text first, then each other
 * field on a line of its own (`next: …`). `verbose: true` gives the JSON
 * document as before. An answer with no text to read (candidates, an error)
 * stays JSON.
 */

/** A field's value on its line: a string as it is, a list joined, anything else as JSON. */
const said = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(' · ');
  return JSON.stringify(value);
};

/** The lines after the text: every field not already said, `next` last. */
const fieldLines = (document: Record<string, unknown>, said_: ReadonlySet<string>): string[] => {
  const keys = Object.keys(document).filter((key) => !said_.has(key) && document[key] !== undefined);
  const ordered = [...keys.filter((key) => key !== 'next'), ...keys.filter((key) => key === 'next')];
  return ordered.map((key) => `${key}: ${said(document[key])}`);
};

/** `get_source`: where, then the code, then the rest. */
const sourceText = (document: Record<string, unknown>): string | undefined => {
  if (typeof document['code'] !== 'string' || typeof document['id'] !== 'string') return undefined;
  const { id, file, line, endLine, skeleton } = document;
  const where = typeof file === 'string' ? ` ${file}:${String(line)}${endLine === undefined || endLine === line ? '' : `-${String(endLine)}`}` : '';
  const head = `// ${id}${where}${skeleton === true ? ' (skeleton: each body folded; whole: true for all)' : ''}`;
  const rest = fieldLines(document, new Set(['id', 'file', 'line', 'endLine', 'code', 'skeleton']));
  return [head, document['code'], ...(rest.length === 0 ? [] : ['', ...rest.map((text) => `// ${text}`)])].join('\n');
};

/** `describe_for_prompt`: the Markdown, then the rest. */
const markdownText = (document: Record<string, unknown>): string | undefined => {
  if (typeof document['markdown'] !== 'string') return undefined;
  const text = (document['markdown'] as string).replace(/\n+$/, '');
  // What the Markdown already says (its id, its "Ask next" calls) is not said again under it.
  const unsaid = Object.fromEntries(
    Object.entries(document).flatMap(([key, value]): Array<[string, unknown]> => {
      if (typeof value === 'string') return text.includes(value) ? [] : [[key, value]];
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        const left = value.filter((item) => !text.includes(item));
        return left.length === 0 ? [] : [[key, left]];
      }
      return [[key, value]];
    }),
  );
  const rest = fieldLines(unsaid, new Set(['markdown']));
  return [text, ...(rest.length === 0 ? [] : ['', ...rest])].join('\n');
};

/** The tools that answer compact as plain text, each with how. */
export const PLAIN_TEXT_TOOLS: ReadonlyMap<string, (document: Record<string, unknown>) => string | undefined> = new Map([
  ['get_source', sourceText],
  ['describe_for_prompt', markdownText],
]);

/** A compact answer's plain text, or undefined where the tool answers JSON or this answer holds no text to read. */
export const plainTextOf = (tool: string, document: unknown): string | undefined => {
  const render = PLAIN_TEXT_TOOLS.get(tool);
  if (render === undefined || document === null || typeof document !== 'object' || Array.isArray(document) || 'error' in document) return undefined;
  return render(document as Record<string, unknown>);
};
