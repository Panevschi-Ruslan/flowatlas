import type { Attribute, Block, Body, Expression, HclFile, ObjectItem, Position } from './ast.js';
import { HclSyntaxError, parseHclTemplate } from './parse.js';

/**
 * Terraform's JSON syntax, read into the tree the native syntax is read into
 * (R174).
 *
 * A `*.tf.json` file is the same configuration written as JSON, usually by a
 * program, and everything downstream of the parser - the loader, the evaluator,
 * the resource readers - is written against the tree in `ast.ts`. So this is an
 * Adapter and nothing more: JSON is read with a file and a line on every member,
 * and each member becomes the block, the attribute or the expression the native
 * syntax would have written there.
 *
 * JSON has one kind of object where the native syntax has two, a block and an
 * object value, and which one a member is depends on where it is. Terraform
 * decides that by the provider's schema; this reader has none, and decides it by
 * the language's own blocks, stated below. A member of a resource that the
 * provider calls a nested block (`environment`) is read as an object value,
 * which every resource reader already accepts in its place.
 */

/** How many labels each top-level block type has, which is how deep its member objects go before its body. */
const TOP_LEVEL: Readonly<Record<string, number>> = {
  resource: 2,
  data: 2,
  module: 1,
  variable: 1,
  output: 1,
  provider: 1,
  check: 1,
  locals: 0,
  terraform: 0,
  moved: 0,
  import: 0,
  removed: 0,
};

/**
 * The blocks the language itself nests inside each kind of block, with their
 * labels. A member of a body named here is a block; any other member is an
 * argument.
 */
const NESTED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  resource: { lifecycle: 0, provisioner: 1, connection: 0, dynamic: 1 },
  data: { lifecycle: 0, dynamic: 1 },
  variable: { validation: 0 },
  output: { precondition: 0 },
  check: { assert: 0 },
  terraform: { backend: 1, cloud: 0 },
  cloud: { workspaces: 0 },
  dynamic: { content: 0 },
  provisioner: { connection: 0 },
};

/** Members that hold a value as written, not an expression: a variable's default is JSON, not a template. */
const LITERAL: Readonly<Record<string, ReadonlySet<string>>> = {
  variable: new Set(['default']),
};

/** A member Terraform reads as a comment. */
const COMMENT = '//';

type Json =
  | { readonly kind: 'object'; readonly members: readonly Member[]; readonly pos: Position; readonly from: number; readonly to: number }
  | { readonly kind: 'array'; readonly items: readonly Json[]; readonly pos: Position; readonly from: number; readonly to: number }
  | { readonly kind: 'string'; readonly value: string; readonly pos: Position; readonly from: number; readonly to: number }
  | { readonly kind: 'literal'; readonly value: number | boolean | null; readonly pos: Position; readonly from: number; readonly to: number };

interface Member {
  readonly key: string;
  readonly pos: Position;
  readonly value: Json;
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** JSON with the place of every value. RFC 8259 and nothing more. */
class JsonReader {
  pos = 0;
  #line = 1;
  #lineStart = 0;

  constructor(
    readonly src: string,
    readonly file: string,
  ) {}

  position(): Position {
    return { file: this.file, line: this.#line, column: this.pos - this.#lineStart + 1 };
  }

  fail(reason: string): never {
    const at = this.position();
    throw new HclSyntaxError(this.file, at.line, at.column, reason);
  }

  space(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === '\n') {
        this.pos += 1;
        this.#line += 1;
        this.#lineStart = this.pos;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') {
        this.pos += 1;
      } else {
        return;
      }
    }
  }

  whole(): Json {
    this.space();
    const value = this.value();
    this.space();
    if (this.pos < this.src.length) this.fail('unexpected text after the document');
    return value;
  }

  value(): Json {
    const pos = this.position();
    const from = this.pos;
    const c = this.src[this.pos];
    if (c === '{') {
      this.pos += 1;
      const members: Member[] = [];
      this.space();
      if (this.src[this.pos] === '}') {
        this.pos += 1;
        return { kind: 'object', members, pos, from, to: this.pos };
      }
      for (;;) {
        this.space();
        const keyPos = this.position();
        if (this.src[this.pos] !== '"') this.fail('expected a member name');
        const key = this.string();
        this.space();
        if (this.src[this.pos] !== ':') this.fail('expected ":"');
        this.pos += 1;
        this.space();
        members.push({ key, pos: keyPos, value: this.value() });
        this.space();
        if (this.src[this.pos] === ',') {
          this.pos += 1;
          continue;
        }
        if (this.src[this.pos] !== '}') this.fail('expected "," or "}"');
        this.pos += 1;
        return { kind: 'object', members, pos, from, to: this.pos };
      }
    }
    if (c === '[') {
      this.pos += 1;
      const items: Json[] = [];
      this.space();
      if (this.src[this.pos] === ']') {
        this.pos += 1;
        return { kind: 'array', items, pos, from, to: this.pos };
      }
      for (;;) {
        this.space();
        items.push(this.value());
        this.space();
        if (this.src[this.pos] === ',') {
          this.pos += 1;
          continue;
        }
        if (this.src[this.pos] !== ']') this.fail('expected "," or "]"');
        this.pos += 1;
        return { kind: 'array', items, pos, from, to: this.pos };
      }
    }
    if (c === '"') return { kind: 'string', value: this.string(), pos, from, to: this.pos };
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.src.startsWith(word, this.pos)) {
        this.pos += word.length;
        return { kind: 'literal', value: literal, pos, from, to: this.pos };
      }
    }
    NUMBER.lastIndex = this.pos;
    const number = NUMBER.exec(this.src);
    if (number === null) this.fail('expected a value');
    this.pos += number[0].length;
    return { kind: 'literal', value: Number(number[0]), pos, from, to: this.pos };
  }

  string(): string {
    const start = this.pos;
    this.pos += 1;
    for (;;) {
      const c = this.src[this.pos];
      if (c === undefined || c === '\n') this.fail('unterminated string');
      if (c === '"') break;
      this.pos += c === '\\' ? 2 : 1;
    }
    this.pos += 1;
    try {
      return JSON.parse(this.src.slice(start, this.pos)) as string;
    } catch {
      return this.fail('malformed string');
    }
  }
}

/** The members of an object, or of each object of an array of them, as Terraform repeats a block. */
const objectsOf = (json: Json, what: string, reader: JsonReader): Extract<Json, { kind: 'object' }>[] => {
  if (json.kind === 'object') return [json];
  if (json.kind === 'array' && json.items.every((item) => item.kind === 'object')) return json.items as Extract<Json, { kind: 'object' }>[];
  throw new HclSyntaxError(reader.file, json.pos.line, json.pos.column, `${what} must be an object`);
};

/**
 * A string in expression mode: a template, so `"${aws_lambda_function.x.arn}"`
 * is the reference and `"loans-${var.stage}"` is the interpolation it reads as.
 */
const template = (json: Extract<Json, { kind: 'string' }>, file: string): Expression => ({
  ...parseHclTemplate(json.value, file, json.pos.line),
  pos: json.pos,
});

/** A value in expression mode, or as written where the language takes it literally. */
const expressionOf = (json: Json, file: string, literal: boolean): Expression => {
  switch (json.kind) {
    case 'string':
      return literal ? { type: 'literal', value: json.value, pos: json.pos } : template(json, file);
    case 'literal':
      return { type: 'literal', value: json.value, pos: json.pos };
    case 'array':
      return { type: 'tuple', items: json.items.map((item) => expressionOf(item, file, literal)), pos: json.pos };
    case 'object': {
      const items: ObjectItem[] = json.members
        .filter((member) => member.key !== COMMENT)
        .map((member) => ({
          key:
            !literal && member.key.includes('${')
              ? template({ kind: 'string', value: member.key, pos: member.pos, from: 0, to: 0 }, file)
              : { type: 'literal', value: member.key, pos: member.pos },
          value: expressionOf(member.value, file, literal),
        }));
      return { type: 'object', items, pos: json.pos };
    }
  }
};

/** The body of one block of a type, its members split into nested blocks and arguments. */
const bodyOf = (type: string, json: Extract<Json, { kind: 'object' }>, reader: JsonReader): Body => {
  const attributes: Attribute[] = [];
  const blocks: Block[] = [];
  const nested = NESTED[type] ?? {};
  const literal = LITERAL[type];
  for (const member of json.members) {
    if (member.key === COMMENT) continue;
    const labels = nested[member.key];
    if (labels !== undefined) {
      blocks.push(...blocksOf(member.key, member.value, labels, [], member.pos, reader));
      continue;
    }
    attributes.push({
      name: member.key,
      expression: expressionOf(member.value, reader.file, literal?.has(member.key) === true),
      source: reader.src.slice(member.value.from, member.value.to),
      pos: member.pos,
    });
  }
  return { attributes, blocks };
};

/** Every block a member stands for: one per label path, and one per object where an array repeats it. */
const blocksOf = (
  type: string,
  json: Json,
  labelsLeft: number,
  labels: readonly string[],
  pos: Position,
  reader: JsonReader,
): Block[] => {
  if (labelsLeft === 0) {
    return objectsOf(json, `the body of ${[type, ...labels].join(' ')}`, reader).map((object) => ({
      type,
      labels,
      body: bodyOf(type, object, reader),
      pos,
    }));
  }
  return objectsOf(json, `${type} ${labels.join(' ')}`.trim(), reader).flatMap((object) =>
    object.members
      .filter((member) => member.key !== COMMENT)
      .flatMap((member) => blocksOf(type, member.value, labelsLeft - 1, [...labels, member.key], member.pos, reader)),
  );
};

/** Parses one file of Terraform's JSON syntax into the native syntax's tree. Throws {@link HclSyntaxError}. */
export const parseHclJson = (text: string, file: string): HclFile => {
  const reader = new JsonReader(text, file);
  const document = reader.whole();
  const [top] = objectsOf(document, 'the document', reader);
  const blocks: Block[] = [];
  for (const member of top?.members ?? []) {
    const labels = TOP_LEVEL[member.key];
    if (labels === undefined) continue;
    blocks.push(...blocksOf(member.key, member.value, labels, [], member.pos, reader));
  }
  return { file, body: { attributes: [], blocks } };
};
