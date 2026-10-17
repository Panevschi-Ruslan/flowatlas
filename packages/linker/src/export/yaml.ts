/**
 * A small YAML writer for the documents an export writes (P119): mappings in
 * the order they were built, block sequences, plain scalars where a reader
 * cannot take them for anything else and JSON-quoted strings everywhere else,
 * and a literal block for text of several lines. Enough for a catalogue
 * entity; never a general serialiser. Kept here, without a dependency,
 * because the linker writes files as strings and holds no YAML library.
 */
export type YamlValue = string | number | boolean | null | readonly YamlValue[] | { readonly [key: string]: YamlValue | undefined };

/** Words a YAML reader turns into something other than a string. */
const RESERVED = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;
/**
 * A scalar safe to write bare in block context: words of `[A-Za-z0-9_./@+$-]`
 * (and `{}` after the first character, as in `/orders/{id}`) joined by single
 * spaces or colons, starting with a letter, digit, `_`, `.`, `/` or `$`.
 */
const PLAIN = /^[A-Za-z0-9_./$][A-Za-z0-9_./@+${}-]*(?:[ :][A-Za-z0-9_./@+${}-]+)*$/;

const isNumberLike = (text: string): boolean => text.trim() !== '' && !Number.isNaN(Number(text));

/** A string as one scalar: bare when nothing could misread it, JSON-quoted otherwise. */
export const yamlScalar = (text: string): string =>
  PLAIN.test(text) && !RESERVED.test(text) && !isNumberLike(text) && !/^[-.]{3}/.test(text) ? text : JSON.stringify(text);

const keyOf = (key: string): string => yamlScalar(key);

const scalarOf = (value: string | number | boolean | null): string =>
  value === null ? 'null' : typeof value === 'string' ? yamlScalar(value) : String(value);

const isMapping = (value: YamlValue): value is { readonly [key: string]: YamlValue | undefined } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A multi-line string as a literal block: `|` keeps one final newline, `|-` none. */
const blockOf = (text: string, indent: string): string[] => {
  const ending = text.endsWith('\n') ? '|' : '|-';
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return [ending, ...body.split('\n').map((line) => (line === '' ? '' : `${indent}${line}`))];
};

const linesOf = (value: YamlValue, indent: string): string[] => {
  if (Array.isArray(value)) {
    const items = value as readonly YamlValue[];
    if (items.length === 0) return ['[]'];
    return items.flatMap((item) => {
      if (isMapping(item) || Array.isArray(item)) {
        const inner = linesOf(item, `${indent}  `);
        if (inner.length === 1 && (inner[0] === '{}' || inner[0] === '[]')) return [`${indent}- ${inner[0]}`];
        return [`${indent}- ${(inner[0] as string).slice(indent.length + 2)}`, ...inner.slice(1)];
      }
      if (typeof item === 'string' && item.includes('\n')) {
        const [head, ...rest] = blockOf(item, `${indent}  `);
        return [`${indent}- ${head}`, ...rest];
      }
      return [`${indent}- ${scalarOf(item as string | number | boolean | null)}`];
    });
  }
  if (isMapping(value)) {
    const entries = Object.entries(value).filter((entry): entry is [string, YamlValue] => entry[1] !== undefined);
    if (entries.length === 0) return ['{}'];
    return entries.flatMap(([key, item]) => {
      if (isMapping(item) || Array.isArray(item)) {
        const inner = linesOf(item, `${indent}  `);
        if (inner.length === 1 && (inner[0] === '{}' || inner[0] === '[]')) return [`${indent}${keyOf(key)}: ${inner[0]}`];
        return [`${indent}${keyOf(key)}:`, ...inner];
      }
      if (typeof item === 'string' && item.includes('\n')) {
        const [head, ...rest] = blockOf(item, `${indent}  `);
        return [`${indent}${keyOf(key)}: ${head}`, ...rest];
      }
      return [`${indent}${keyOf(key)}: ${scalarOf(item as string | number | boolean | null)}`];
    });
  }
  return [`${indent}${scalarOf(value as string | number | boolean | null)}`];
};

/** One YAML document, ending in a newline. */
export const yamlDocument = (value: YamlValue): string => `${linesOf(value, '').join('\n')}\n`;

/** Several documents in one file, separated by `---`. */
export const yamlDocuments = (values: readonly YamlValue[]): string => values.map(yamlDocument).join('---\n');
