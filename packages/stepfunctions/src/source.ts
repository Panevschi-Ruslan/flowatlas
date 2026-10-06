import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node as YamlNode } from 'yaml';

/**
 * A definition read as plain values, with where each of them was written.
 *
 * A state machine is written in JSON or in YAML, and once it is read nothing
 * downstream should care which: the walk over its states asks for values and,
 * beside them, for a line to put on a node. So each format is adapted to this
 * one shape and the rest of the package is written against the shape. A third
 * spelling - the value a deployment file builds in place, with no text of its
 * own - is the same shape again, with one position for everything (`fromValue`).
 */

/** Where something is written, 1-based, as an editor counts. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** One step down into a document: a key of a mapping or an index of a list. */
export type PathStep = string | number;

export interface PositionedDocument {
  readonly value: unknown;
  /**
   * Where the value at `path` is written: for a member of a mapping, where its
   * key is. `undefined` when the path names nothing, or when the format kept no
   * position for it.
   */
  at(path: readonly PathStep[]): Position | undefined;
}

/** Text that is not a document of the format it claims to be. */
export class DocumentSyntaxError extends Error {
  readonly position: Position;

  constructor(message: string, position: Position) {
    super(message);
    this.name = 'DocumentSyntaxError';
    this.position = position;
  }
}

const keyOf = (path: readonly PathStep[]): string => JSON.stringify(path);

/** A table of positions keyed by path, which is what every reader below fills. */
const positioned = (value: unknown, positions: ReadonlyMap<string, Position>): PositionedDocument => ({
  value,
  at: (path) => positions.get(keyOf(path)),
});

/**
 * Reads JSON, keeping the position of every key and every list item.
 *
 * Written here rather than borrowed from the YAML reader below, although JSON
 * is nearly YAML: "nearly" is a file indented with tabs, which YAML refuses and
 * JSON does not mind, and a reader of definitions that rejected a valid JSON
 * file would be wrong about the one format nobody argues over. Strings and
 * numbers are handed to `JSON.parse` once their extent is found, so what a value
 * *is* is decided by the language's own parser and only where it *is* is
 * decided here.
 */
export const readJson = (text: string): PositionedDocument => {
  const positions = new Map<string, Position>();
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let lineStart = at;

  const here = (): Position => ({ line, column: at - lineStart + 1 });
  const fail = (message: string): never => {
    throw new DocumentSyntaxError(message, here());
  };

  const skipSpace = (): void => {
    while (at < text.length) {
      const char = text[at];
      if (char === '\n') {
        at += 1;
        line += 1;
        lineStart = at;
      } else if (char === ' ' || char === '\t' || char === '\r') {
        at += 1;
      } else {
        return;
      }
    }
  };

  const expect = (char: string): void => {
    if (text[at] !== char) fail(`expected ${JSON.stringify(char)}`);
    at += 1;
  };

  const readString = (): string => {
    const start = at;
    at += 1;
    while (at < text.length && text[at] !== '"') {
      if (text[at] === '\n') fail('a string may not run over the end of a line');
      at += text[at] === '\\' ? 2 : 1;
    }
    if (at >= text.length) fail('a string is not closed');
    at += 1;
    try {
      return JSON.parse(text.slice(start, at)) as string;
    } catch {
      return fail('a string holds an escape JSON does not have');
    }
  };

  const readWord = (): unknown => {
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at, at + 64));
    if (match === null) return fail('expected a value');
    at += match[0].length;
    return JSON.parse(match[0]) as unknown;
  };

  const readValue = (path: PathStep[]): unknown => {
    skipSpace();
    const char = text[at];
    if (char === '{') return readObject(path);
    if (char === '[') return readArray(path);
    if (char === '"') return readString();
    return readWord();
  };

  const readObject = (path: PathStep[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    expect('{');
    skipSpace();
    if (text[at] === '}') {
      at += 1;
      return out;
    }
    for (;;) {
      skipSpace();
      if (text[at] !== '"') fail('expected a key');
      const position = here();
      const key = readString();
      skipSpace();
      expect(':');
      const inner = [...path, key];
      positions.set(keyOf(inner), position);
      out[key] = readValue(inner);
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      expect('}');
      return out;
    }
  };

  const readArray = (path: PathStep[]): unknown[] => {
    const out: unknown[] = [];
    expect('[');
    skipSpace();
    if (text[at] === ']') {
      at += 1;
      return out;
    }
    for (;;) {
      skipSpace();
      const inner = [...path, out.length];
      positions.set(keyOf(inner), here());
      out.push(readValue(inner));
      skipSpace();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      expect(']');
      return out;
    }
  };

  skipSpace();
  positions.set(keyOf([]), here());
  const value = readValue([]);
  skipSpace();
  if (at < text.length) fail('text follows the end of the document');
  return positioned(value, positions);
};

/**
 * Reads YAML, keeping the position of every key and every list item.
 *
 * Only the first error is reported, and as a refusal: a definition that is half
 * read is a workflow with steps missing, and saying nothing about which is
 * worse than saying the file could not be read.
 */
export const readYaml = (text: string): PositionedDocument => {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  const error = document.errors[0];
  if (error !== undefined) {
    const { line, col } = lineCounter.linePos(error.pos[0]);
    throw new DocumentSyntaxError(error.message.split('\n')[0] ?? 'not YAML', { line, column: col });
  }

  const positions = new Map<string, Position>();
  const record = (path: PathStep[], offset: number | undefined): void => {
    if (offset === undefined) return;
    const { line, col } = lineCounter.linePos(offset);
    positions.set(keyOf(path), { line, column: col });
  };
  const walk = (node: YamlNode | null | undefined, path: PathStep[]): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
        if (key === undefined) continue;
        const inner = [...path, key];
        record(inner, (pair.key as YamlNode).range?.[0]);
        walk(pair.value as YamlNode | null, inner);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => {
        const inner = [...path, index];
        record(inner, (item as YamlNode | null)?.range?.[0]);
        walk(item as YamlNode | null, inner);
      });
    }
  };
  record([], document.contents?.range?.[0]);
  walk(document.contents, []);
  return positioned(document.toJS() as unknown, positions);
};

/**
 * A value built somewhere other than in text of its own, with one position for
 * all of it: where it was built.
 *
 * A definition written inside a deployment file as an expression has no lines
 * of its own; every step is truthfully "written here", and saying so is better
 * than a step with no place at all.
 */
export const fromValue = (value: unknown, position: Position): PositionedDocument => ({
  value,
  at: () => position,
});

/**
 * A document read out of a larger file, placed where it sits in that file:
 * text that starts `lines` lines further down than its own first line.
 */
export const shifted = (document: PositionedDocument, lines: number): PositionedDocument =>
  lines === 0
    ? document
    : {
        value: document.value,
        at: (path) => {
          const found = document.at(path);
          return found === undefined ? undefined : { line: found.line + lines, column: found.column };
        },
      };

/** The formats a definition file is written in, by what its name ends in. */
export type DefinitionFormat = 'json' | 'yaml';

/**
 * One reader per format. Keyed by a type rather than by a word out of a file,
 * so a record is exhaustive here and a `Map` would only add a cast.
 */
const READERS: Readonly<Record<DefinitionFormat, (text: string) => PositionedDocument>> = {
  json: readJson,
  yaml: readYaml,
};

/** Reads text written in one of the formats. */
export const readDocument = (text: string, format: DefinitionFormat): PositionedDocument =>
  READERS[format](text);
