/**
 * The GraphQL language, read (P232): an operation a client sends and the
 * schema a server declares, in one parser for the specification's grammar.
 *
 * Written here rather than taken from the reference implementation because
 * the tool reads repositories without installing anything, and the parts of
 * the language this reads - definitions, selections, arguments, types - are
 * a small, fixed grammar. Every node keeps the offset it starts at in the
 * document's text, so a field selected in a template literal is named at its
 * own line of the file the literal is in. What is not read is kept as text:
 * directive arguments, default values.
 */

export type TypeRef = { readonly kind: 'named'; readonly name: string } | { readonly kind: 'list'; readonly of: TypeRef } | { readonly kind: 'nonNull'; readonly of: TypeRef };

export interface Argument {
  readonly name: string;
  /** The value as written. */
  readonly value: string;
  /** The variable the value is, when it is one: `$id`. */
  readonly variable?: string;
  readonly at: number;
}

export interface FieldSelection {
  readonly kind: 'field';
  readonly name: string;
  readonly alias?: string;
  readonly arguments: readonly Argument[];
  readonly selections: readonly Selection[];
  readonly at: number;
}

export interface FragmentSpread {
  readonly kind: 'spread';
  readonly name: string;
  readonly at: number;
}

export interface InlineFragment {
  readonly kind: 'inline';
  readonly on?: string;
  readonly selections: readonly Selection[];
  readonly at: number;
}

export type Selection = FieldSelection | FragmentSpread | InlineFragment;

export interface VariableDefinition {
  readonly name: string;
  readonly type: TypeRef;
  readonly hasDefault: boolean;
}

export interface OperationDefinition {
  readonly kind: 'operation';
  readonly operation: 'query' | 'mutation' | 'subscription';
  readonly name?: string;
  readonly variables: readonly VariableDefinition[];
  readonly selections: readonly Selection[];
  readonly at: number;
}

export interface FragmentDefinition {
  readonly kind: 'fragment';
  readonly name: string;
  readonly on: string;
  readonly selections: readonly Selection[];
  readonly at: number;
}

export interface InputValue {
  readonly name: string;
  readonly type: TypeRef;
  readonly hasDefault: boolean;
  readonly at: number;
}

export interface FieldDefinition {
  readonly name: string;
  readonly arguments: readonly InputValue[];
  readonly type: TypeRef;
  readonly at: number;
}

export interface TypeDefinition {
  readonly kind: 'type';
  readonly of: 'object' | 'interface' | 'input' | 'enum' | 'union' | 'scalar';
  readonly name: string;
  readonly extend: boolean;
  readonly fields: readonly FieldDefinition[];
  /** An input type's fields, an enum's values, a union's members, an object's interfaces. */
  readonly inputs: readonly InputValue[];
  readonly values: readonly string[];
  readonly members: readonly string[];
  readonly interfaces: readonly string[];
  /** The directives written on it, by name: `key` for a federated entity. */
  readonly directives: readonly string[];
  readonly at: number;
}

export interface SchemaDefinition {
  readonly kind: 'schema';
  readonly roots: Readonly<Partial<Record<'query' | 'mutation' | 'subscription', string>>>;
  readonly at: number;
}

export type Definition = OperationDefinition | FragmentDefinition | TypeDefinition | SchemaDefinition | { readonly kind: 'directive'; readonly name: string; readonly at: number };

export interface Document {
  readonly definitions: readonly Definition[];
}

export class GraphqlSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

type Token = { kind: 'punct' | 'name' | 'number' | 'string' | 'eof'; value: string; at: number };

const PUNCT = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] as string;
    if (char === '﻿' || char === ',' || /\s/.test(char)) {
      at += 1;
      continue;
    }
    if (char === '#') {
      while (at < text.length && text[at] !== '\n' && text[at] !== '\r') at += 1;
      continue;
    }
    if (text.startsWith('...', at)) {
      tokens.push({ kind: 'punct', value: '...', at });
      at += 3;
      continue;
    }
    if (PUNCT.has(char)) {
      tokens.push({ kind: 'punct', value: char, at });
      at += 1;
      continue;
    }
    if (/[_A-Za-z]/.test(char)) {
      const start = at;
      while (at < text.length && /[_0-9A-Za-z]/.test(text[at] as string)) at += 1;
      tokens.push({ kind: 'name', value: text.slice(start, at), at: start });
      continue;
    }
    if (/[-0-9]/.test(char)) {
      const start = at;
      at += 1;
      while (at < text.length && /[0-9.eE+-]/.test(text[at] as string)) at += 1;
      tokens.push({ kind: 'number', value: text.slice(start, at), at: start });
      continue;
    }
    if (char === '"') {
      const start = at;
      if (text.startsWith('"""', at)) {
        const close = text.indexOf('"""', at + 3);
        if (close === -1) throw new GraphqlSyntaxError('unterminated block string', at);
        at = close + 3;
      } else {
        at += 1;
        while (at < text.length && text[at] !== '"') {
          if (text[at] === '\\') at += 1;
          if (text[at] === '\n') throw new GraphqlSyntaxError('unterminated string', start);
          at += 1;
        }
        if (at >= text.length) throw new GraphqlSyntaxError('unterminated string', start);
        at += 1;
      }
      tokens.push({ kind: 'string', value: text.slice(start, at), at: start });
      continue;
    }
    throw new GraphqlSyntaxError(`unexpected character ${JSON.stringify(char)}`, at);
  }
  tokens.push({ kind: 'eof', value: '', at: text.length });
  return tokens;
};

class Parser {
  readonly #tokens: Token[];
  #at = 0;

  constructor(text: string) {
    this.#tokens = tokenize(text);
  }

  get #token(): Token {
    return this.#tokens[this.#at] as Token;
  }

  #peek(offset = 1): Token {
    return this.#tokens[Math.min(this.#at + offset, this.#tokens.length - 1)] as Token;
  }

  #is(value: string): boolean {
    const token = this.#token;
    return (token.kind === 'punct' || token.kind === 'name') && token.value === value;
  }

  #skip(value: string): boolean {
    if (!this.#is(value)) return false;
    this.#at += 1;
    return true;
  }

  #expect(value: string): Token {
    const token = this.#token;
    if (!this.#is(value)) throw new GraphqlSyntaxError(`expected ${value}, found ${token.value || 'the end'}`, token.at);
    this.#at += 1;
    return token;
  }

  #name(): Token {
    const token = this.#token;
    if (token.kind !== 'name') throw new GraphqlSyntaxError(`expected a name, found ${token.value || 'the end'}`, token.at);
    this.#at += 1;
    return token;
  }

  document(): Document {
    const definitions: Definition[] = [];
    while (this.#token.kind !== 'eof') definitions.push(this.#definition());
    return { definitions };
  }

  #definition(): Definition {
    if (this.#token.kind === 'string') this.#at += 1;
    const token = this.#token;
    if (this.#is('{')) return { kind: 'operation', operation: 'query', variables: [], selections: this.#selectionSet(), at: token.at };
    if (token.kind !== 'name') throw new GraphqlSyntaxError(`unexpected ${token.value || 'end'}`, token.at);
    switch (token.value) {
      case 'query':
      case 'mutation':
      case 'subscription':
        return this.#operation();
      case 'fragment':
        return this.#fragment();
      case 'extend': {
        this.#at += 1;
        return this.#typeSystem(true);
      }
      default:
        return this.#typeSystem(false);
    }
  }

  #operation(): OperationDefinition {
    const start = this.#name();
    const name = this.#token.kind === 'name' ? this.#name().value : undefined;
    const variables = this.#is('(') ? this.#variables() : [];
    this.#directives();
    return { kind: 'operation', operation: start.value as OperationDefinition['operation'], ...(name === undefined ? {} : { name }), variables, selections: this.#selectionSet(), at: start.at };
  }

  #variables(): VariableDefinition[] {
    this.#expect('(');
    const found: VariableDefinition[] = [];
    while (!this.#skip(')')) {
      this.#expect('$');
      const name = this.#name().value;
      this.#expect(':');
      const type = this.#type();
      const hasDefault = this.#skip('=');
      if (hasDefault) this.#value();
      this.#directives();
      found.push({ name, type, hasDefault });
    }
    return found;
  }

  #fragment(): FragmentDefinition {
    const start = this.#expect('fragment');
    const name = this.#name().value;
    this.#expect('on');
    const on = this.#name().value;
    this.#directives();
    return { kind: 'fragment', name, on, selections: this.#selectionSet(), at: start.at };
  }

  #selectionSet(): Selection[] {
    this.#expect('{');
    const found: Selection[] = [];
    while (!this.#skip('}')) found.push(this.#selection());
    return found;
  }

  #selection(): Selection {
    const token = this.#token;
    if (this.#skip('...')) {
      if (this.#is('on')) {
        this.#at += 1;
        const on = this.#name().value;
        this.#directives();
        return { kind: 'inline', on, selections: this.#selectionSet(), at: token.at };
      }
      if (this.#token.kind === 'name') {
        const name = this.#name().value;
        this.#directives();
        return { kind: 'spread', name, at: token.at };
      }
      this.#directives();
      return { kind: 'inline', selections: this.#selectionSet(), at: token.at };
    }
    const first = this.#name();
    let name = first.value;
    let alias: string | undefined;
    if (this.#skip(':')) {
      alias = first.value;
      name = this.#name().value;
    }
    const args = this.#is('(') ? this.#arguments() : [];
    this.#directives();
    const selections = this.#is('{') ? this.#selectionSet() : [];
    return { kind: 'field', name, ...(alias === undefined ? {} : { alias }), arguments: args, selections, at: first.at };
  }

  #arguments(): Argument[] {
    this.#expect('(');
    const found: Argument[] = [];
    while (!this.#skip(')')) {
      const name = this.#name();
      this.#expect(':');
      const value = this.#value();
      found.push({ name: name.value, value: value.text, ...(value.variable === undefined ? {} : { variable: value.variable }), at: name.at });
    }
    return found;
  }

  /** A value, as written, and the variable it is when it is one. */
  #value(): { text: string; variable?: string } {
    const token = this.#token;
    if (this.#skip('$')) {
      const name = this.#name().value;
      return { text: `$${name}`, variable: name };
    }
    if (this.#skip('[')) {
      const items: string[] = [];
      while (!this.#skip(']')) items.push(this.#value().text);
      return { text: `[${items.join(', ')}]` };
    }
    if (this.#skip('{')) {
      const items: string[] = [];
      while (!this.#skip('}')) {
        const key = this.#name().value;
        this.#expect(':');
        items.push(`${key}: ${this.#value().text}`);
      }
      return { text: `{${items.join(', ')}}` };
    }
    if (token.kind === 'eof' || token.kind === 'punct') throw new GraphqlSyntaxError(`expected a value, found ${token.value || 'the end'}`, token.at);
    this.#at += 1;
    return { text: token.value };
  }

  #directives(): string[] {
    const names: string[] = [];
    while (this.#skip('@')) {
      names.push(this.#name().value);
      if (this.#is('(')) this.#arguments();
    }
    return names;
  }

  #type(): TypeRef {
    let type: TypeRef;
    if (this.#skip('[')) {
      const of = this.#type();
      this.#expect(']');
      type = { kind: 'list', of };
    } else {
      type = { kind: 'named', name: this.#name().value };
    }
    return this.#skip('!') ? { kind: 'nonNull', of: type } : type;
  }

  #typeSystem(extend: boolean): Definition {
    if (this.#token.kind === 'string') this.#at += 1;
    const start = this.#name();
    switch (start.value) {
      case 'schema': {
        this.#directives();
        const roots: Partial<Record<'query' | 'mutation' | 'subscription', string>> = {};
        if (this.#skip('{')) {
          while (!this.#skip('}')) {
            const operation = this.#name().value as 'query' | 'mutation' | 'subscription';
            this.#expect(':');
            roots[operation] = this.#name().value;
          }
        }
        return { kind: 'schema', roots, at: start.at };
      }
      case 'scalar': {
        const name = this.#name().value;
        const directives = this.#directives();
        return this.#typeDefinition('scalar', name, extend, start.at, { directives });
      }
      case 'type':
      case 'interface': {
        const name = this.#name().value;
        const interfaces: string[] = [];
        if (this.#skip('implements')) {
          this.#skip('&');
          interfaces.push(this.#name().value);
          while (this.#skip('&')) interfaces.push(this.#name().value);
        }
        const directives = this.#directives();
        const fields = this.#is('{') ? this.#fieldsDefinition() : [];
        return this.#typeDefinition(start.value === 'type' ? 'object' : 'interface', name, extend, start.at, { fields, interfaces, directives });
      }
      case 'union': {
        const name = this.#name().value;
        const directives = this.#directives();
        const members: string[] = [];
        if (this.#skip('=')) {
          this.#skip('|');
          members.push(this.#name().value);
          while (this.#skip('|')) members.push(this.#name().value);
        }
        return this.#typeDefinition('union', name, extend, start.at, { members, directives });
      }
      case 'enum': {
        const name = this.#name().value;
        const directives = this.#directives();
        const values: string[] = [];
        if (this.#skip('{')) {
          while (!this.#skip('}')) {
            if (this.#token.kind === 'string') this.#at += 1;
            values.push(this.#name().value);
            this.#directives();
          }
        }
        return this.#typeDefinition('enum', name, extend, start.at, { values, directives });
      }
      case 'input': {
        const name = this.#name().value;
        const directives = this.#directives();
        const inputs = this.#is('{') ? this.#inputValues('{', '}') : [];
        return this.#typeDefinition('input', name, extend, start.at, { inputs, directives });
      }
      case 'directive': {
        this.#expect('@');
        const name = this.#name().value;
        if (this.#is('(')) this.#inputValues('(', ')');
        this.#skip('repeatable');
        this.#expect('on');
        this.#skip('|');
        this.#name();
        while (this.#skip('|')) this.#name();
        return { kind: 'directive', name, at: start.at };
      }
      default:
        throw new GraphqlSyntaxError(`unexpected ${start.value}`, start.at);
    }
  }

  #typeDefinition(
    of: TypeDefinition['of'],
    name: string,
    extend: boolean,
    at: number,
    parts: Partial<Pick<TypeDefinition, 'fields' | 'inputs' | 'values' | 'members' | 'interfaces' | 'directives'>>,
  ): TypeDefinition {
    return { kind: 'type', of, name, extend, fields: parts.fields ?? [], inputs: parts.inputs ?? [], values: parts.values ?? [], members: parts.members ?? [], interfaces: parts.interfaces ?? [], directives: parts.directives ?? [], at };
  }

  #fieldsDefinition(): FieldDefinition[] {
    this.#expect('{');
    const found: FieldDefinition[] = [];
    while (!this.#skip('}')) {
      if (this.#token.kind === 'string') this.#at += 1;
      const name = this.#name();
      const args = this.#is('(') ? this.#inputValues('(', ')') : [];
      this.#expect(':');
      const type = this.#type();
      this.#directives();
      found.push({ name: name.value, arguments: args, type, at: name.at });
    }
    return found;
  }

  #inputValues(open: string, close: string): InputValue[] {
    this.#expect(open);
    const found: InputValue[] = [];
    while (!this.#skip(close)) {
      if (this.#token.kind === 'string') this.#at += 1;
      const name = this.#name();
      this.#expect(':');
      const type = this.#type();
      const hasDefault = this.#skip('=');
      if (hasDefault) this.#value();
      this.#directives();
      found.push({ name: name.value, type, hasDefault, at: name.at });
    }
    return found;
  }
}

/** A document, read whole; a `GraphqlSyntaxError` names the offset where it stopped. */
export const parseDocument = (text: string): Document => new Parser(text).document();

/** A document, or undefined where it does not parse. */
export const tryParse = (text: string): Document | undefined => {
  try {
    return parseDocument(text);
  } catch (error) {
    if (error instanceof GraphqlSyntaxError) return undefined;
    throw error;
  }
};

/** The named type at the bottom of a type: `[Order!]!` is `Order`. */
export const namedTypeOf = (type: TypeRef): string => (type.kind === 'named' ? type.name : namedTypeOf(type.of));

/** A type as GraphQL writes it. */
export const typeText = (type: TypeRef): string =>
  type.kind === 'named' ? type.name : type.kind === 'list' ? `[${typeText(type.of)}]` : `${typeText(type.of)}!`;

/** Whether a value of the type may be left out: anything not wrapped in `!`. */
export const isNullable = (type: TypeRef): boolean => type.kind !== 'nonNull';
