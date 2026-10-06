import type {
  Attribute,
  BinaryOperator,
  Block,
  Body,
  Expression,
  HclFile,
  ObjectItem,
  Position,
  Step,
  TemplatePart,
} from './ast.js';

/**
 * HCL native syntax, read by hand.
 *
 * The whole of the native syntax, not the part this tool evaluates: heredocs,
 * template directives, `for` expressions, splats, provider-namespaced calls and
 * `...` expansion all parse, so a file never fails to read because it uses a
 * construct nothing downstream evaluates. Evaluating is a separate question with
 * a separate answer (`eval/`), and "unknown" is an answer there; a parse failure
 * would leave the whole file unread, which is a much worse one.
 *
 * Written as a recursive descent over characters rather than a lexer and a
 * parser, because HCL's templates nest expressions inside strings inside
 * expressions, and its newlines mean different things in different places: an
 * attribute ends at one, an object item may end at one, and inside brackets and
 * parentheses they are ignored. A stack says which of those applies here.
 */

export class HclSyntaxError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    readonly column: number,
    readonly reason: string,
  ) {
    super(`${file}:${line}:${column}: ${reason}`);
    this.name = 'HclSyntaxError';
  }
}

const IDENTIFIER = /[\p{L}_][\p{L}\p{N}_-]*/uy;
const NUMBER = /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Operators by binding strength, weakest first. Longer spellings before their prefixes. */
const LEVELS: readonly (readonly BinaryOperator[])[] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<=', '>=', '<', '>'],
  ['+', '-'],
  ['*', '/', '%'],
];

const lineStartsOf = (text: string): number[] => {
  const starts = [0];
  for (let at = 0; at < text.length; at += 1) if (text[at] === '\n') starts.push(at + 1);
  return starts;
};

interface TemplateRun {
  parts: TemplatePart[];
  /** The directive keyword that ended the run, when one did. */
  stop?: string;
}

class Parser {
  pos = 0;
  readonly #lines: number[];
  /** Whether a newline ends what is being read here; the top of the stack decides. */
  readonly #newlines: boolean[] = [true];

  constructor(
    readonly src: string,
    readonly file: string,
    /** The line of the enclosing file this text starts on, for a heredoc read apart. */
    readonly lineBase = 1,
  ) {
    this.#lines = lineStartsOf(src);
  }

  // ------------------------------------------------------------- positions

  position(at = this.pos): Position {
    let low = 0;
    let high = this.#lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.#lines[mid] ?? 0) <= at) low = mid;
      else high = mid - 1;
    }
    return { file: this.file, line: low + this.lineBase, column: at - (this.#lines[low] ?? 0) + 1 };
  }

  fail(reason: string, at = this.pos): never {
    const where = this.position(at);
    throw new HclSyntaxError(this.file, where.line, where.column, reason);
  }

  // ------------------------------------------------------------- characters

  get eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  at(text: string): boolean {
    return this.src.startsWith(text, this.pos);
  }

  expect(text: string): void {
    if (!this.at(text)) this.fail(`expected ${JSON.stringify(text)}`);
    this.pos += text.length;
  }

  pushNewlines(significant: boolean): void {
    this.#newlines.push(significant);
  }

  popNewlines(): void {
    this.#newlines.pop();
  }

  get newlinesMatter(): boolean {
    return this.#newlines[this.#newlines.length - 1] ?? true;
  }

  /** Spaces and comments, and newlines too where they mean nothing. */
  skipSpace(): void {
    this.#skip(!this.newlinesMatter);
  }

  /** Spaces, comments and newlines, wherever this is. */
  skipAll(): void {
    this.#skip(true);
  }

  #skip(newlines: boolean): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') {
        this.pos += 1;
      } else if (c === '\n' && newlines) {
        this.pos += 1;
      } else if (c === '#' || this.at('//')) {
        while (!this.eof && this.peek() !== '\n') this.pos += 1;
      } else if (this.at('/*')) {
        const end = this.src.indexOf('*/', this.pos + 2);
        if (end === -1) this.fail('unterminated comment');
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  isIdentifierStart(c = this.peek()): boolean {
    return /[\p{L}_]/u.test(c);
  }

  isKeyword(word: string): boolean {
    if (!this.at(word)) return false;
    const after = this.src[this.pos + word.length] ?? '';
    return !/[\p{L}\p{N}_-]/u.test(after);
  }

  identifier(): string {
    IDENTIFIER.lastIndex = this.pos;
    const match = IDENTIFIER.exec(this.src);
    if (match === null) this.fail('expected a name');
    this.pos += match[0].length;
    return match[0];
  }

  // ------------------------------------------------------------------ body

  whole(): HclFile {
    const body = this.body(false);
    return { file: this.file, body };
  }

  body(closed: boolean): Body {
    const attributes: Attribute[] = [];
    const blocks: Block[] = [];
    for (;;) {
      this.skipAll();
      if (this.eof) {
        if (closed) this.fail('expected "}" to close the block');
        break;
      }
      if (closed && this.peek() === '}') break;
      const start = this.pos;
      if (!this.isIdentifierStart()) this.fail('expected an attribute or a block');
      const name = this.identifier();
      this.skipSpace();
      if (this.peek() === '=' && this.peek(1) !== '=') {
        this.pos += 1;
        this.skipSpace();
        const from = this.pos;
        const expression = this.expression();
        attributes.push({
          name,
          expression,
          source: this.src.slice(from, this.pos).trim(),
          pos: this.position(start),
        });
      } else {
        const labels: string[] = [];
        for (;;) {
          this.skipSpace();
          if (this.peek() === '"') {
            const label = this.quoted();
            labels.push(templateText(label) ?? this.fail('a block label cannot hold an interpolation'));
          } else if (this.isIdentifierStart()) {
            labels.push(this.identifier());
          } else {
            break;
          }
        }
        this.skipSpace();
        this.expect('{');
        this.pushNewlines(true);
        const inner = this.body(true);
        this.expect('}');
        this.popNewlines();
        blocks.push({ type: name, labels, body: inner, pos: this.position(start) });
      }
      this.#endOfItem(closed);
    }
    return { attributes, blocks };
  }

  #endOfItem(closed: boolean): void {
    this.#skip(false);
    if (this.eof || this.peek() === '\n' || (closed && this.peek() === '}')) return;
    this.fail('expected a new line after this item');
  }

  // ----------------------------------------------------------- expressions

  expression(): Expression {
    const start = this.pos;
    const condition = this.binary(0);
    const save = this.pos;
    this.skipSpace();
    if (this.peek() !== '?') {
      this.pos = save;
      return condition;
    }
    this.pos += 1;
    this.skipSpace();
    const then = this.expression();
    this.skipSpace();
    this.expect(':');
    this.skipSpace();
    const otherwise = this.expression();
    return { type: 'conditional', condition, then, otherwise, pos: this.position(start) };
  }

  binary(level: number): Expression {
    const operators = LEVELS[level];
    if (operators === undefined) return this.unary();
    const start = this.pos;
    let left = this.binary(level + 1);
    for (;;) {
      const save = this.pos;
      this.skipSpace();
      const operator = operators.find((op) => this.#operatorHere(op));
      if (operator === undefined) {
        this.pos = save;
        return left;
      }
      this.pos += operator.length;
      this.skipSpace();
      const right = this.binary(level + 1);
      left = { type: 'binary', operator, left, right, pos: this.position(start) };
    }
  }

  #operatorHere(operator: BinaryOperator): boolean {
    if (!this.at(operator)) return false;
    const next = this.peek(operator.length);
    // `/` that starts a comment, `<` that starts a heredoc, `>` that ends `=>`,
    // and `<`/`>` that are the first half of `<=`/`>=` are not this operator.
    if (operator === '/' && (next === '/' || next === '*')) return false;
    if ((operator === '<' || operator === '>') && next === '=') return false;
    if (operator === '<' && next === '<') return false;
    return true;
  }

  unary(): Expression {
    const start = this.pos;
    const c = this.peek();
    if (c === '!' && this.peek(1) !== '=') {
      this.pos += 1;
      this.skipSpace();
      return { type: 'unary', operator: '!', operand: this.unary(), pos: this.position(start) };
    }
    if (c === '-') {
      this.pos += 1;
      this.skipSpace();
      return { type: 'unary', operator: '-', operand: this.unary(), pos: this.position(start) };
    }
    return this.postfix(this.primary());
  }

  primary(): Expression {
    const start = this.pos;
    const c = this.peek();
    if (/[0-9]/.test(c)) {
      NUMBER.lastIndex = this.pos;
      const match = NUMBER.exec(this.src);
      if (match === null) this.fail('expected a number');
      this.pos += match[0].length;
      return { type: 'literal', value: Number(match[0]), pos: this.position(start) };
    }
    if (c === '"') return this.quoted();
    if (this.at('<<')) return this.heredoc();
    if (c === '[') return this.tuple();
    if (c === '{') return this.object();
    if (c === '(') {
      this.pos += 1;
      this.pushNewlines(false);
      this.skipAll();
      const inner = this.expression();
      this.skipAll();
      this.expect(')');
      this.popNewlines();
      return { type: 'parens', inner, pos: this.position(start) };
    }
    if (this.isIdentifierStart()) {
      const name = this.identifier();
      if (name === 'true' || name === 'false') {
        return { type: 'literal', value: name === 'true', pos: this.position(start) };
      }
      if (name === 'null') return { type: 'literal', value: null, pos: this.position(start) };
      const save = this.pos;
      let called = name;
      while (this.at('::')) {
        this.pos += 2;
        called = `${called}::${this.identifier()}`;
      }
      let gap = this.pos;
      while (this.src[gap] === ' ' || this.src[gap] === '\t') gap += 1;
      if (this.src[gap] === '(') {
        this.pos = gap;
        return this.call(called, start);
      }
      this.pos = save;
      return { type: 'variable', name, pos: this.position(start) };
    }
    return this.fail(c === '' ? 'unexpected end of file' : `unexpected ${JSON.stringify(c)}`);
  }

  call(name: string, start: number): Expression {
    this.expect('(');
    this.pushNewlines(false);
    const args: Expression[] = [];
    let expandFinal = false;
    for (;;) {
      this.skipAll();
      if (this.peek() === ')') break;
      args.push(this.expression());
      this.skipAll();
      if (this.at('...')) {
        this.pos += 3;
        expandFinal = true;
        this.skipAll();
      }
      if (this.peek() === ',') {
        this.pos += 1;
        continue;
      }
      if (this.peek() !== ')') this.fail('expected "," or ")" in the arguments');
    }
    this.expect(')');
    this.popNewlines();
    return { type: 'call', name, args, expandFinal, pos: this.position(start) };
  }

  postfix(source: Expression): Expression {
    let expression = source;
    let steps: Step[] = [];
    const flush = (): void => {
      if (steps.length === 0) return;
      expression =
        expression.type === 'traversal'
          ? { ...expression, steps: [...expression.steps, ...steps] }
          : { type: 'traversal', source: expression, steps, pos: expression.pos };
      steps = [];
    };
    for (;;) {
      const save = this.pos;
      this.skipSpace();
      if (this.peek() === '.' && !this.at('...')) {
        const next = this.peek(1);
        if (next === '*') {
          this.pos += 2;
          flush();
          expression = { type: 'splat', source: expression, steps: this.#splatSteps(false), pos: expression.pos };
          continue;
        }
        if (/[0-9]/.test(next)) {
          this.pos += 1;
          const digits = /[0-9]+/y;
          digits.lastIndex = this.pos;
          const match = digits.exec(this.src);
          this.pos += match?.[0].length ?? 0;
          steps.push({
            kind: 'index',
            key: { type: 'literal', value: Number(match?.[0] ?? 0), pos: this.position(save) },
          });
          continue;
        }
        if (this.isIdentifierStart(next)) {
          this.pos += 1;
          steps.push({ kind: 'attr', name: this.identifier() });
          continue;
        }
        this.fail('expected a name after "."');
      }
      if (this.peek() === '[') {
        const full = /\[\s*\*\s*\]/y;
        full.lastIndex = this.pos;
        const splat = full.exec(this.src);
        if (splat !== null) {
          this.pos += splat[0].length;
          flush();
          expression = { type: 'splat', source: expression, steps: this.#splatSteps(true), pos: expression.pos };
          continue;
        }
        this.pos += 1;
        this.pushNewlines(false);
        this.skipAll();
        const key = this.expression();
        this.skipAll();
        this.expect(']');
        this.popNewlines();
        steps.push({ kind: 'index', key });
        continue;
      }
      this.pos = save;
      break;
    }
    flush();
    return expression;
  }

  /** The steps a splat applies to every element: names, and for `[*]` indexes too. */
  #splatSteps(full: boolean): Step[] {
    const steps: Step[] = [];
    for (;;) {
      const save = this.pos;
      this.skipSpace();
      if (this.peek() === '.' && this.isIdentifierStart(this.peek(1))) {
        this.pos += 1;
        steps.push({ kind: 'attr', name: this.identifier() });
        continue;
      }
      if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
        this.pos += 1;
        const digits = /[0-9]+/y;
        digits.lastIndex = this.pos;
        const match = digits.exec(this.src);
        this.pos += match?.[0].length ?? 0;
        steps.push({ kind: 'index', key: { type: 'literal', value: Number(match?.[0] ?? 0), pos: this.position(save) } });
        continue;
      }
      if (full && this.peek() === '[' && !/\[\s*\*/y.test(this.src.slice(this.pos, this.pos + 4))) {
        this.pos += 1;
        this.pushNewlines(false);
        this.skipAll();
        const key = this.expression();
        this.skipAll();
        this.expect(']');
        this.popNewlines();
        steps.push({ kind: 'index', key });
        continue;
      }
      this.pos = save;
      return steps;
    }
  }

  tuple(): Expression {
    const start = this.pos;
    this.expect('[');
    this.pushNewlines(false);
    this.skipAll();
    if (this.isKeyword('for')) {
      const result = this.forExpression('tuple', ']', start);
      this.popNewlines();
      return result;
    }
    const items: Expression[] = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === ']') break;
      items.push(this.expression());
      this.skipAll();
      if (this.peek() === ',') {
        this.pos += 1;
        continue;
      }
      if (this.peek() !== ']') this.fail('expected "," or "]" in the list');
    }
    this.expect(']');
    this.popNewlines();
    return { type: 'tuple', items, pos: this.position(start) };
  }

  object(): Expression {
    const start = this.pos;
    this.expect('{');
    const save = this.pos;
    this.skipAll();
    if (this.isKeyword('for')) {
      this.pushNewlines(false);
      const result = this.forExpression('object', '}', start);
      this.popNewlines();
      return result;
    }
    this.pos = save;
    this.pushNewlines(true);
    const items: ObjectItem[] = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === '}') break;
      const keyStart = this.pos;
      let key: Expression | undefined;
      // A bare name is the key itself, not a variable: `{ name = "x" }`. Anything
      // else is an expression, which is how a computed key is written.
      if (this.isIdentifierStart()) {
        const name = this.identifier();
        const after = this.pos;
        this.skipSpace();
        if ((this.peek() === '=' && this.peek(1) !== '=') || this.peek() === ':') {
          key = { type: 'literal', value: name, pos: this.position(keyStart) };
          this.pos = after;
        } else {
          this.pos = keyStart;
        }
      }
      key ??= this.expression();
      this.skipSpace();
      if ((this.peek() === '=' && this.peek(1) !== '=') || this.peek() === ':') this.pos += 1;
      else this.fail('expected "=" or ":" after an object key');
      this.skipSpace();
      const value = this.expression();
      items.push({ key, value });
      this.#skip(false);
      if (this.peek() === ',') {
        this.pos += 1;
        continue;
      }
      if (this.peek() === '\n' || this.peek() === '}') continue;
      this.fail('expected ",", a new line or "}" after an object item');
    }
    this.expect('}');
    this.popNewlines();
    return { type: 'object', items, pos: this.position(start) };
  }

  forExpression(result: 'tuple' | 'object', closing: string, start: number): Expression {
    this.pos += 3;
    this.skipAll();
    const first = this.identifier();
    this.skipAll();
    let keyName: string | undefined;
    let valueName = first;
    if (this.peek() === ',') {
      this.pos += 1;
      this.skipAll();
      keyName = first;
      valueName = this.identifier();
      this.skipAll();
    }
    if (!this.isKeyword('in')) this.fail('expected "in" in a for expression');
    this.pos += 2;
    this.skipAll();
    const collection = this.expression();
    this.skipAll();
    this.expect(':');
    this.skipAll();
    let key: Expression | undefined;
    if (result === 'object') {
      key = this.expression();
      this.skipAll();
      this.expect('=>');
      this.skipAll();
    }
    const value = this.expression();
    this.skipAll();
    let group = false;
    if (this.at('...')) {
      this.pos += 3;
      group = true;
      this.skipAll();
    }
    let condition: Expression | undefined;
    if (this.isKeyword('if')) {
      this.pos += 2;
      this.skipAll();
      condition = this.expression();
      this.skipAll();
    }
    this.expect(closing);
    return {
      type: 'for',
      result,
      ...(keyName === undefined ? {} : { keyName }),
      valueName,
      collection,
      ...(key === undefined ? {} : { key }),
      value,
      ...(condition === undefined ? {} : { condition }),
      group,
      pos: this.position(start),
    };
  }

  // ------------------------------------------------------------- templates

  quoted(): Expression {
    const start = this.pos;
    this.expect('"');
    const run = this.template(true, new Set());
    this.expect('"');
    return { type: 'template', parts: run.parts, pos: this.position(start) };
  }

  heredoc(): Expression {
    const start = this.pos;
    this.pos += 2;
    const indented = this.peek() === '-';
    if (indented) this.pos += 1;
    const marker = this.identifier();
    while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') this.pos += 1;
    if (this.peek() !== '\n') this.fail('expected a new line after the heredoc marker');
    this.pos += 1;
    const contentStart = this.pos;
    let lineStart = contentStart;
    let end = -1;
    while (lineStart <= this.src.length) {
      const newline = this.src.indexOf('\n', lineStart);
      const lineEnd = newline === -1 ? this.src.length : newline;
      if (this.src.slice(lineStart, lineEnd).replace(/\r$/, '').trim() === marker) {
        end = lineStart;
        this.pos = lineStart + this.src.slice(lineStart, lineEnd).indexOf(marker) + marker.length;
        break;
      }
      if (newline === -1) break;
      lineStart = newline + 1;
    }
    if (end === -1) this.fail(`heredoc ${marker} is never closed`, start);
    let content = this.src.slice(contentStart, end);
    if (indented) content = dedent(content);
    const inner = new Parser(content, this.file, this.position(contentStart).line);
    const run = inner.template(false, new Set());
    return { type: 'template', parts: run.parts, pos: this.position(start) };
  }

  /**
   * The parts of a template up to its end, or up to one of `stops`.
   *
   * `quoted` is a template between double quotes, where a backslash escapes and
   * a new line is an error; a heredoc and a template file are neither.
   */
  template(quoted: boolean, stops: ReadonlySet<string>): TemplateRun {
    const parts: TemplatePart[] = [];
    let text = '';
    let trimNext = false;
    const flush = (): void => {
      if (trimNext) text = text.replace(/^\s+/, '');
      trimNext = false;
      if (text !== '') parts.push({ kind: 'text', text });
      text = '';
    };
    const trimBefore = (): void => {
      text = text.replace(/\s+$/, '');
      if (text === '') {
        const last = parts[parts.length - 1];
        if (last?.kind === 'text') last.text = last.text.replace(/\s+$/, '');
      }
    };
    for (;;) {
      if (this.eof) {
        if (quoted) this.fail('unterminated string');
        break;
      }
      const c = this.peek();
      if (quoted && c === '"') break;
      if (quoted && c === '\n') this.fail('a quoted string cannot span lines');
      if (quoted && c === '\\') {
        text += this.#escape();
        continue;
      }
      if (this.at('$${')) {
        text += '${';
        this.pos += 3;
        continue;
      }
      if (this.at('%%{')) {
        text += '%{';
        this.pos += 3;
        continue;
      }
      if (this.at('${')) {
        this.pos += 2;
        const stripBefore = this.peek() === '~';
        if (stripBefore) {
          this.pos += 1;
          trimBefore();
        }
        flush();
        this.pushNewlines(false);
        this.skipAll();
        const expression = this.expression();
        this.skipAll();
        const stripAfter = this.peek() === '~';
        if (stripAfter) this.pos += 1;
        this.expect('}');
        this.popNewlines();
        parts.push({ kind: 'interpolation', expression, stripBefore, stripAfter });
        trimNext = stripAfter;
        continue;
      }
      if (this.at('%{')) {
        const directiveAt = this.pos;
        this.pos += 2;
        if (this.peek() === '~') {
          this.pos += 1;
          trimBefore();
        }
        this.pushNewlines(false);
        this.skipAll();
        const word = this.identifier();
        if (word === 'else' || word === 'endif' || word === 'endfor') {
          this.skipAll();
          const strip = this.peek() === '~';
          if (strip) this.pos += 1;
          this.expect('}');
          this.popNewlines();
          if (!stops.has(word)) this.fail(`unexpected %{${word}}`, directiveAt);
          flush();
          return { parts, stop: word };
        }
        if (word === 'if') {
          this.skipAll();
          const condition = this.expression();
          this.skipAll();
          const strip = this.peek() === '~';
          if (strip) this.pos += 1;
          this.expect('}');
          this.popNewlines();
          flush();
          trimNext = false;
          const then = this.template(quoted, new Set(['else', 'endif']));
          let otherwise: TemplatePart[] = [];
          if (then.stop === 'else') otherwise = this.template(quoted, new Set(['endif'])).parts;
          else if (then.stop !== 'endif') this.fail('%{if} is never closed', directiveAt);
          parts.push({ kind: 'if', condition, then: then.parts, otherwise });
          continue;
        }
        if (word === 'for') {
          this.skipAll();
          const first = this.identifier();
          this.skipAll();
          let keyName: string | undefined;
          let valueName = first;
          if (this.peek() === ',') {
            this.pos += 1;
            this.skipAll();
            keyName = first;
            valueName = this.identifier();
            this.skipAll();
          }
          if (!this.isKeyword('in')) this.fail('expected "in" in %{for}');
          this.pos += 2;
          this.skipAll();
          const collection = this.expression();
          this.skipAll();
          const strip = this.peek() === '~';
          if (strip) this.pos += 1;
          this.expect('}');
          this.popNewlines();
          flush();
          const body = this.template(quoted, new Set(['endfor']));
          if (body.stop !== 'endfor') this.fail('%{for} is never closed', directiveAt);
          parts.push({
            kind: 'for',
            ...(keyName === undefined ? {} : { keyName }),
            valueName,
            collection,
            body: body.parts,
          });
          continue;
        }
        this.fail(`unknown template directive %{${word}}`, directiveAt);
      }
      text += c;
      this.pos += 1;
    }
    flush();
    if (stops.size > 0) this.fail(`expected %{${[...stops].join('} or %{')}}`);
    return { parts };
  }

  #escape(): string {
    const next = this.peek(1);
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
    if (Object.hasOwn(simple, next)) {
      this.pos += 2;
      return simple[next] ?? '';
    }
    if (next === 'u' || next === 'U') {
      const length = next === 'u' ? 4 : 8;
      const hex = this.src.slice(this.pos + 2, this.pos + 2 + length);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) this.fail('malformed unicode escape');
      this.pos += 2 + length;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    this.fail(`unknown escape \\${next}`);
  }
}

/** The text of a template that is only text, or undefined when it holds anything else. */
export const templateText = (expression: Expression): string | undefined => {
  if (expression.type === 'literal' && typeof expression.value === 'string') return expression.value;
  if (expression.type !== 'template') return undefined;
  let out = '';
  for (const part of expression.parts) {
    if (part.kind !== 'text') return undefined;
    out += part.text;
  }
  return out;
};

/** `<<-` strips the indentation every non-blank line shares. */
const dedent = (content: string): string => {
  const lines = content.split('\n');
  let common = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    common = Math.min(common, indent);
  }
  if (!Number.isFinite(common) || common === 0) return content;
  return lines.map((line) => line.slice(Math.min(common, /^[ \t]*/.exec(line)?.[0].length ?? 0))).join('\n');
};

/** Parses one file of HCL native syntax. Throws {@link HclSyntaxError}. */
export const parseHcl = (text: string, file: string): HclFile => new Parser(text, file).whole();

/** Parses one expression, as written in a description or on a command line. */
export const parseHclExpression = (text: string, file = '<expression>'): Expression => {
  const parser = new Parser(text, file);
  parser.pushNewlines(false);
  parser.skipAll();
  const expression = parser.expression();
  parser.skipAll();
  if (!parser.eof) parser.fail('unexpected text after the expression');
  return expression;
};

/**
 * Parses a template file, as `templatefile()` reads one: text with
 * interpolations and directives and no escapes.
 */
export const parseHclTemplate = (text: string, file: string): Expression => {
  const parser = new Parser(text, file);
  const run = parser.template(false, new Set());
  return { type: 'template', parts: run.parts, pos: { file, line: 1, column: 1 } };
};
