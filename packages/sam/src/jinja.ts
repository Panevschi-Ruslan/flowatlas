/**
 * The part of Jinja sceptre renders its files with that the files settle
 * (P261): an expression `{{ var.x }}`, `{{ environment_variable.X }}` or
 * `{{ sceptre_user_data.x }}` - a name, its members by `.` or `['key']`, and
 * an optional `| default(<literal>)` - written as the value the files give
 * it. Anything else - a filter, an operator, a call, a statement `{% %}` - is
 * not rendered here, and neither is an expression whose value the files do
 * not give: each is kept, by a stand-in, as an expression not rendered. A
 * comment `{# #}` is taken out, as Jinja takes it out.
 */

/** What an expression of the kind read here is: a path of members, and the literal it falls back to. */
const EXPRESSION =
  /^\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[\s*(?:'[^']*'|"[^"]*"|\d+)\s*\])*)\s*(?:\|\s*default\s*\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|True|False)\s*\)\s*)?$/;

/** One member of a path: `.name` or `['name']`. */
const MEMBER = /\.\s*([A-Za-z_]\w*)|\[\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*\]/g;

/** The value a literal of Jinja's is, as it renders. */
const literalText = (written: string): string => {
  if (/^['"]/.test(written)) return written.slice(1, -1).replace(/\\(.)/g, '$1');
  if (/^(true|True)$/.test(written)) return 'True';
  if (/^(false|False)$/.test(written)) return 'False';
  return written;
};

/** A value as Jinja writes it into the text, where it is one it writes plainly; `undefined` otherwise. */
const rendered = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** What renders an expression read here: `undefined` where the files do not give its value. */
export type Lookup = (root: string, path: readonly string[]) => unknown;

/** A lookup into plain records by root name: the stack's `var`, `environment_variable` or `sceptre_user_data`. */
export const lookupIn =
  (roots: Readonly<Record<string, unknown>>): Lookup =>
  (root, path) => {
    let at: unknown = roots[root];
    for (const step of path) {
      if (Array.isArray(at) && /^\d+$/.test(step)) at = at[Number(step)];
      else if (isRecord(at)) at = at[step];
      else return undefined;
    }
    return at;
  };

/** A text rendered as far as the files settle it. */
export interface Rendering {
  readonly text: string;
  /** Each expression or statement not rendered, as written, by its stand-in in the text. */
  readonly unrendered: ReadonlyMap<string, string>;
}

/** The stand-in an expression not rendered is kept by: text YAML reads as plain, that nothing else holds, distinct per file. */
const unrenderedAt = (file: number, index: number): string => `__jinja_${file}_${index}__`;

/** A stand-in of an expression not rendered, in a text. */
export const UNRENDERED = /__jinja_\d+_\d+__/;

/** One expression, rendered where the files give its value. */
const expressionValue = (inner: string, lookup: Lookup): string | undefined => {
  const match = EXPRESSION.exec(inner);
  if (match === null) return undefined;
  const written = match[1] as string;
  const root = /^[A-Za-z_]\w*/.exec(written)?.[0] as string;
  const path = [...written.slice(root.length).matchAll(MEMBER)].map((member) => member[1] ?? member[2] ?? member[3] ?? member[4] ?? '');
  const value = rendered(lookup(root, path));
  if (value !== undefined) return value;
  // A default is what Jinja writes where nothing gives the value, and only there.
  return match[2] !== undefined && lookup(root, path) === undefined ? literalText(match[2]) : undefined;
};

/**
 * A text with each expression the files settle written as its value; every
 * other expression and every statement kept by a stand-in, numbered under
 * `file` so the stand-ins of several files read together stay apart;
 * comments taken out.
 */
export const renderJinja = (text: string, lookup: Lookup, file = 0): Rendering => {
  const unrendered = new Map<string, string>();
  const keep = (whole: string): string => {
    const at = unrenderedAt(file, unrendered.size);
    unrendered.set(at, whole.replace(/\s+/g, ' ').trim());
    return at;
  };
  const out = text
    .replace(/\{#[\s\S]*?#\}/g, '')
    .replace(/\{%[\s\S]*?%\}/g, keep)
    .replace(/\{\{-?([\s\S]*?)-?\}\}/g, (whole, inner: string) => expressionValue(inner, lookup) ?? keep(whole));
  return { text: out, unrendered };
};
