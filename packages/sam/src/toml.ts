/**
 * The part of TOML a `samconfig.toml` is written in (P246): tables and dotted
 * table names, keys bare or quoted, strings basic and literal (on one line or
 * several), numbers, booleans, arrays over several lines and inline tables.
 *
 * Written here rather than taken from a package because the file is small and
 * regular, and the tool adds no runtime dependency for one file of settings.
 * Dates are kept as the text they are written as. A line that is none of the
 * above stops the reading with its line number, and the caller says so.
 */

/** Text that is not the TOML read here, and the line it is on. */
export class TomlUnreadable extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'TomlUnreadable';
  }
}

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table => value !== null && typeof value === 'object' && !Array.isArray(value);

const ESCAPES: Readonly<Record<string, string>> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

class Reader {
  #at = 0;

  constructor(readonly text: string) {}

  get line(): number {
    return this.text.slice(0, this.#at).split('\n').length;
  }

  get done(): boolean {
    return this.#at >= this.text.length;
  }

  #peek(length = 1): string {
    return this.text.slice(this.#at, this.#at + length);
  }

  #fail(what: string): never {
    throw new TomlUnreadable(what, this.line);
  }

  /** Spaces and tabs, and with `lines` also line breaks and comments. */
  skip(lines: boolean): void {
    while (!this.done) {
      const char = this.#peek();
      if (char === ' ' || char === '\t' || (lines && (char === '\n' || char === '\r'))) this.#at += 1;
      else if (char === '#' && lines) while (!this.done && this.#peek() !== '\n') this.#at += 1;
      else return;
    }
  }

  /** The end of a line: nothing but a comment before it. */
  endOfLine(): void {
    this.skip(false);
    if (this.#peek() === '#') while (!this.done && this.#peek() !== '\n') this.#at += 1;
    if (this.#peek() === '\r') this.#at += 1;
    if (!this.done && this.#peek() !== '\n') this.#fail('expected the end of the line');
    this.#at += 1;
  }

  expect(char: string): void {
    this.skip(false);
    if (this.#peek() !== char) this.#fail(`expected ${char}`);
    this.#at += 1;
  }

  /** `a`, `"a b"`, `a.b."c"`: a key, split at its dots. */
  key(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.skip(false);
      const char = this.#peek();
      if (char === '"' || char === "'") parts.push(this.#string());
      else {
        const bare = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.#at));
        if (bare === null) this.#fail('expected a key');
        parts.push(bare[0]);
        this.#at += bare[0].length;
      }
      this.skip(false);
      if (this.#peek() !== '.') return parts;
      this.#at += 1;
    }
  }

  #string(): string {
    const triple = this.#peek(3);
    if (triple === '"""' || triple === "'''") {
      this.#at += 3;
      if (this.#peek() === '\n') this.#at += 1;
      const end = this.text.indexOf(triple, this.#at);
      if (end < 0) this.#fail('a string is not closed');
      const body = this.text.slice(this.#at, end);
      this.#at = end + 3;
      return triple === '"""' ? unescape(body.replace(/\\\r?\n\s*/g, '')) : body;
    }
    const quote = this.#peek();
    this.#at += 1;
    let out = '';
    while (!this.done && this.#peek() !== quote) {
      const char = this.#peek();
      if (char === '\n') this.#fail('a string is not closed');
      if (char === '\\' && quote === '"') {
        out += this.text.slice(this.#at, this.#at + 2);
        this.#at += 2;
        continue;
      }
      out += char;
      this.#at += 1;
    }
    if (this.done) this.#fail('a string is not closed');
    this.#at += 1;
    return quote === '"' ? unescape(out) : out;
  }

  value(): unknown {
    this.skip(false);
    const char = this.#peek();
    if (char === '"' || char === "'") return this.#string();
    if (char === '[') {
      this.#at += 1;
      const items: unknown[] = [];
      for (;;) {
        this.skip(true);
        if (this.#peek() === ']') break;
        items.push(this.value());
        this.skip(true);
        if (this.#peek() === ',') this.#at += 1;
        else if (this.#peek() !== ']') this.#fail('expected , or ] in an array');
      }
      this.#at += 1;
      return items;
    }
    if (char === '{') {
      this.#at += 1;
      const table: Table = {};
      this.skip(false);
      if (this.#peek() === '}') {
        this.#at += 1;
        return table;
      }
      for (;;) {
        const key = this.key();
        this.expect('=');
        put(table, key, this.value(), this);
        this.skip(false);
        if (this.#peek() === ',') this.#at += 1;
        else if (this.#peek() === '}') {
          this.#at += 1;
          return table;
        } else this.#fail('expected , or } in an inline table');
      }
    }
    const word = /^[^\s,\]}#]+/.exec(this.text.slice(this.#at));
    if (word === null) this.#fail('expected a value');
    this.#at += word[0].length;
    const written = word[0];
    if (written === 'true' || written === 'false') return written === 'true';
    const number = written.replace(/_/g, '');
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|inf|nan)$/.test(number)) return Number(number);
    // A date or a time, kept as written: nothing read here compares one.
    if (/^\d{4}-\d{2}-\d{2}/.test(written) || /^\d{2}:\d{2}/.test(written)) return written;
    return this.#fail(`${written} is not a value`);
  }

  /** `[a.b]` or `[[a.b]]` at the start of a line, when it is one. */
  header(): { key: string[]; array: boolean } | undefined {
    if (this.#peek() !== '[') return undefined;
    const array = this.#peek(2) === '[[';
    this.#at += array ? 2 : 1;
    const key = this.key();
    this.expect(']');
    if (array) this.expect(']');
    return { key, array };
  }
}

const unescape = (text: string): string =>
  text.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (whole, code: string) =>
    code.length > 1 ? String.fromCodePoint(parseInt(code.slice(1), 16)) : (ESCAPES[code] ?? whole),
  );

/** The table at a key below `root`, made where it is not yet. */
const tableAt = (root: Table, key: readonly string[], reader: Reader): Table => {
  let at = root;
  for (const part of key) {
    const next = at[part];
    if (Array.isArray(next) && isTable(next[next.length - 1])) at = next[next.length - 1] as Table;
    else if (isTable(next)) at = next;
    else if (next === undefined) at = at[part] = {};
    else throw new TomlUnreadable(`${key.join('.')} is a value and a table`, reader.line);
  }
  return at;
};

const put = (table: Table, key: readonly string[], value: unknown, reader: Reader): void => {
  const owner = tableAt(table, key.slice(0, -1), reader);
  owner[key[key.length - 1] as string] = value;
};

/** A TOML document, as plain values. */
export const readToml = (text: string): Table => {
  const reader = new Reader(text);
  const root: Table = {};
  let current = root;
  for (;;) {
    reader.skip(true);
    if (reader.done) return root;
    const header = reader.header();
    if (header !== undefined) {
      if (header.array) {
        const owner = tableAt(root, header.key.slice(0, -1), reader);
        const last = header.key[header.key.length - 1] as string;
        const list = Array.isArray(owner[last]) ? (owner[last] as unknown[]) : (owner[last] = []);
        current = {};
        (list as unknown[]).push(current);
      } else {
        current = tableAt(root, header.key, reader);
      }
      reader.endOfLine();
      continue;
    }
    const key = reader.key();
    reader.expect('=');
    put(current, key, reader.value(), reader);
    if (!reader.done) reader.endOfLine();
  }
};
