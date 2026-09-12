/**
 * Type references.
 *
 * A reference is a string, because it has to travel inside a graph that stays
 * readable and small. Anything with a name lives in the registry once and is
 * referenced by id; everything else is written out in place.
 *
 * Grammar:
 *
 *   ref         := union
 *   union       := intersection ( '|' intersection )*
 *   intersection:= postfix ( '&' postfix )*
 *   postfix     := primary ( '[]' )*
 *   primary     := '(' ref ')'
 *                | '[' ref ( ',' ref )* ']'                  tuple
 *                | '{' field ( ';' field )* '}'              inline object
 *                | "'" text "'" | number | 'true' | 'false'  literal
 *                | 'type:' <repo> '#' <Name> ( '<' args '>' )?
 *                | name ( '<' args '>' )?                    primitive or generic
 *   field       := name '?'? ':' ref
 *
 * Primitives are written verbatim. A promise never appears: an asynchronous
 * return is unwrapped before it is recorded.
 */

export type TypeRef = string;

export const PRIMITIVES = [
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'any',
  'unknown',
  'never',
  'Date',
  'Buffer',
  'object',
] as const;

export type PrimitiveName = (typeof PRIMITIVES)[number];

const PRIMITIVE_SET: ReadonlySet<string> = new Set(PRIMITIVES);

export const isPrimitiveName = (name: string): name is PrimitiveName => PRIMITIVE_SET.has(name);

export interface TypeRefField {
  name: string;
  optional: boolean;
  type: TypeRefAst;
}

export type TypeRefAst =
  | { kind: 'primitive'; name: string }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'id'; id: string; args?: TypeRefAst[] }
  | { kind: 'array'; element: TypeRefAst }
  | { kind: 'union'; members: TypeRefAst[] }
  | { kind: 'intersection'; members: TypeRefAst[] }
  | { kind: 'tuple'; elements: TypeRefAst[] }
  | { kind: 'generic'; name: string; args: TypeRefAst[] }
  | { kind: 'object'; fields: TypeRefField[] };

export class TypeRefParseError extends Error {
  readonly ref: string;
  readonly position: number;

  constructor(ref: string, position: number, message: string) {
    super(`${message} at ${position} in ${JSON.stringify(ref)}`);
    this.name = 'TypeRefParseError';
    this.ref = ref;
    this.position = position;
  }
}

/** Characters that end an unquoted name or id. */
const DELIMITERS = new Set([...'<>,;:?[]{}|&()', ' ', '\t', '\n']);

class Parser {
  readonly #text: string;
  #at = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): TypeRefAst {
    const value = this.#union();
    this.#skip();
    if (this.#at < this.#text.length) this.#fail('unexpected trailing text');
    return value;
  }

  #fail(message: string): never {
    throw new TypeRefParseError(this.#text, this.#at, message);
  }

  #skip(): void {
    while (this.#at < this.#text.length && /\s/.test(this.#text[this.#at] ?? '')) this.#at += 1;
  }

  #peek(): string | undefined {
    this.#skip();
    return this.#text[this.#at];
  }

  #eat(char: string): boolean {
    if (this.#peek() === char) {
      this.#at += 1;
      return true;
    }
    return false;
  }

  #expect(char: string): void {
    if (!this.#eat(char)) this.#fail(`expected ${JSON.stringify(char)}`);
  }

  #union(): TypeRefAst {
    const members = [this.#intersection()];
    while (this.#eat('|')) members.push(this.#intersection());
    return members.length === 1 ? (members[0] as TypeRefAst) : { kind: 'union', members };
  }

  #intersection(): TypeRefAst {
    const members = [this.#postfix()];
    while (this.#eat('&')) members.push(this.#postfix());
    return members.length === 1 ? (members[0] as TypeRefAst) : { kind: 'intersection', members };
  }

  #postfix(): TypeRefAst {
    let value = this.#primary();
    for (;;) {
      const save = this.#at;
      if (!this.#eat('[')) break;
      if (!this.#eat(']')) {
        this.#at = save;
        break;
      }
      value = { kind: 'array', element: value };
    }
    return value;
  }

  #args(): TypeRefAst[] {
    const args = [this.#union()];
    while (this.#eat(',')) args.push(this.#union());
    this.#expect('>');
    return args;
  }

  #name(): string {
    this.#skip();
    const start = this.#at;
    while (this.#at < this.#text.length && !DELIMITERS.has(this.#text[this.#at] ?? '')) {
      this.#at += 1;
    }
    if (this.#at === start) this.#fail('expected a name');
    return this.#text.slice(start, this.#at);
  }

  /**
   * A registry id, read as one token.
   *
   * It contains a colon, which otherwise separates a field name from its type,
   * so it cannot be read by the general name rule.
   */
  #typeId(): string | undefined {
    this.#skip();
    if (!this.#text.startsWith('type:', this.#at)) return undefined;
    this.#at += 'type:'.length;
    const start = this.#at;
    while (this.#at < this.#text.length && !DELIMITERS.has(this.#text[this.#at] ?? '')) {
      this.#at += 1;
    }
    if (this.#at === start) this.#fail('expected a type id');
    return `type:${this.#text.slice(start, this.#at)}`;
  }

  #primary(): TypeRefAst {
    const next = this.#peek();
    if (next === undefined) this.#fail('unexpected end');

    if (next === '(') {
      this.#at += 1;
      const inner = this.#union();
      this.#expect(')');
      return inner;
    }

    if (next === '[') {
      this.#at += 1;
      const elements: TypeRefAst[] = [];
      if (!this.#eat(']')) {
        elements.push(this.#union());
        while (this.#eat(',')) elements.push(this.#union());
        this.#expect(']');
      }
      return { kind: 'tuple', elements };
    }

    if (next === '{') {
      this.#at += 1;
      const fields: TypeRefField[] = [];
      if (!this.#eat('}')) {
        for (;;) {
          const name = this.#name();
          const optional = this.#eat('?');
          this.#expect(':');
          fields.push({ name, optional, type: this.#union() });
          if (this.#eat(';') || this.#eat(',')) {
            if (this.#peek() === '}') break;
            continue;
          }
          break;
        }
        this.#expect('}');
      }
      return { kind: 'object', fields };
    }

    if (next === "'") {
      this.#at += 1;
      const start = this.#at;
      while (this.#at < this.#text.length && this.#text[this.#at] !== "'") this.#at += 1;
      const value = this.#text.slice(start, this.#at);
      this.#expect("'");
      return { kind: 'literal', value };
    }

    if (/[0-9-]/.test(next)) {
      const start = this.#at;
      this.#at += 1;
      while (this.#at < this.#text.length && /[0-9._eE+-]/.test(this.#text[this.#at] ?? '')) {
        this.#at += 1;
      }
      return { kind: 'literal', value: Number(this.#text.slice(start, this.#at)) };
    }

    const id = this.#typeId();
    if (id !== undefined) {
      if (this.#eat('<')) return { kind: 'id', id, args: this.#args() };
      return { kind: 'id', id };
    }

    const name = this.#name();
    if (name === 'true') return { kind: 'literal', value: true };
    if (name === 'false') return { kind: 'literal', value: false };

    if (this.#eat('<')) return { kind: 'generic', name, args: this.#args() };
    if (isPrimitiveName(name)) return { kind: 'primitive', name };
    // A name with no arguments that is not a primitive is still a name; keeping
    // it verbatim beats losing it.
    return { kind: 'primitive', name };
  }
}

export const parseTypeRef = (ref: TypeRef): TypeRefAst => new Parser(ref).parse();

const needsParens = (ast: TypeRefAst): boolean =>
  ast.kind === 'union' || ast.kind === 'intersection';

export const formatTypeRef = (ast: TypeRefAst): TypeRef => {
  switch (ast.kind) {
    case 'primitive':
      return ast.name;
    case 'literal':
      return typeof ast.value === 'string' ? `'${ast.value}'` : String(ast.value);
    case 'id':
      return ast.args === undefined || ast.args.length === 0
        ? ast.id
        : `${ast.id}<${ast.args.map(formatTypeRef).join(',')}>`;
    case 'array': {
      const inner = formatTypeRef(ast.element);
      return needsParens(ast.element) ? `(${inner})[]` : `${inner}[]`;
    }
    case 'union':
      return ast.members.map(formatTypeRef).join('|');
    case 'intersection':
      return ast.members.map(formatTypeRef).join('&');
    case 'tuple':
      return `[${ast.elements.map(formatTypeRef).join(',')}]`;
    case 'generic':
      return `${ast.name}<${ast.args.map(formatTypeRef).join(',')}>`;
    case 'object':
      return `{${ast.fields
        .map((field) => `${field.name}${field.optional ? '?' : ''}:${formatTypeRef(field.type)}`)
        .join(';')}}`;
  }
};

/** Every registry id a reference mentions, at any depth. */
export const idsOfTypeRef = (ast: TypeRefAst, out: string[] = []): string[] => {
  switch (ast.kind) {
    case 'id':
      out.push(ast.id);
      for (const argument of ast.args ?? []) idsOfTypeRef(argument, out);
      break;
    case 'array':
      idsOfTypeRef(ast.element, out);
      break;
    case 'union':
    case 'intersection':
      for (const member of ast.members) idsOfTypeRef(member, out);
      break;
    case 'tuple':
      for (const element of ast.elements) idsOfTypeRef(element, out);
      break;
    case 'generic':
      for (const argument of ast.args) idsOfTypeRef(argument, out);
      break;
    case 'object':
      for (const field of ast.fields) idsOfTypeRef(field.type, out);
      break;
    default:
      break;
  }
  return out;
};
