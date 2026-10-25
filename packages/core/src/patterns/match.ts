import { Node, type CallExpression, type Decorator, type Node as TsNode } from 'ts-morph';
import { evaluateExpression } from '../static-value.js';
import type { PatternNode, ParsedPattern } from './parse.js';

/**
 * A pattern held against one call of the source, part by part (P121).
 *
 * Not how the build reads a pattern: the build reads the description a rule
 * compiles into, through the readers that read every description. This is the
 * view a person needs beside that - which holes caught what in a test's code,
 * and, for a call a rule was meant to read and did not, how far it got and the
 * first part that did not fit: the method's name, the receiver's type, an
 * argument, a key, a literal. `flowatlas patterns test` and `explain` print it.
 */
export interface MatchStep {
  /** The part of the pattern: `callee`, `receiver type`, `argument 1`, `topic in argument 0`. */
  readonly part: string;
  readonly ok: boolean;
  /** What was found there, or what was wanted and not found. */
  readonly detail: string;
}

export interface PatternFit {
  /** Whether every part fit. */
  readonly matched: boolean;
  /** The source text each hole caught, by the hole's name. */
  readonly captures: Readonly<Record<string, string>>;
  /** Each part, in the order it was asked, up to and including the first that did not fit. */
  readonly steps: readonly MatchStep[];
}

export interface MatchOptions {
  /**
   * The receiver's type as the reader would name it, when a rule names one:
   * the checker's, or what the source states. Without it the type is not
   * asked, and the step says so.
   */
  readonly receiverTypeOf?: (receiver: TsNode) => string | undefined;
  /** The types the rule accepts the receiver as. */
  readonly receiverTypes?: readonly string[];
}

class Mismatch extends Error {}

const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isAwaitExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

const short = (node: TsNode): string => {
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/**
 * Holds a pattern against a call, or against a decorator for a pattern
 * written as one. Read-only and total: a call it cannot read is a step that
 * did not fit, never an exception.
 */
export const matchPatternAt = (pattern: ParsedPattern, site: CallExpression | Decorator, options: MatchOptions = {}): PatternFit => {
  const steps: MatchStep[] = [];
  const captures: Record<string, string> = {};
  const step = (part: string, ok: boolean, detail: string): void => {
    steps.push({ part, ok, detail });
    if (!ok) throw new Mismatch(part);
  };

  const value = (want: PatternNode, got: TsNode | undefined, part: string): void => {
    switch (want.kind) {
      case 'any':
        return;
      case 'hole':
        if (got === undefined) return step(part, false, `${want.name} wants a value and nothing is written`);
        captures[want.name] = short(got);
        return step(part, true, `${want.name} = ${short(got)}`);
      case 'literal': {
        if (got === undefined) return step(part, false, `wants ${JSON.stringify(want.value)} and nothing is written`);
        const read = evaluateExpression(got);
        const ok = read.resolved && read.value === want.value;
        return step(part, ok, ok ? `${JSON.stringify(want.value)}` : `wants ${JSON.stringify(want.value)}, the call writes ${short(got)}`);
      }
      case 'object': {
        if (got === undefined) return step(part, false, 'wants an object and nothing is written');
        const object = unwrap(got);
        if (!Node.isObjectLiteralExpression(object)) {
          // Not written in place: every key is a place the reader follows the
          // value to, so the shape is not a reason to stop here.
          return step(part, true, `${short(got)} is not written in place; its keys are read where it is made`);
        }
        for (const entry of want.entries) {
          const property = object.getProperty(entry.key);
          const at = `${entry.key} in ${part}`;
          if (property === undefined) {
            if (entry.value.kind === 'literal') step(at, false, `wants ${entry.key}: ${JSON.stringify(entry.value.value)} and the object has no ${entry.key}`);
            steps.push({ part: at, ok: true, detail: `not written; ${entry.value.kind === 'hole' ? `${entry.value.name} is empty` : 'nothing to read'}` });
            continue;
          }
          const written = Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : Node.isShorthandPropertyAssignment(property)
              ? property.getNameNode()
              : undefined;
          value(entry.value, written, at);
        }
        return;
      }
      case 'array': {
        if (got === undefined) return step(part, false, 'wants a list and nothing is written');
        const list = unwrap(got);
        if (!Node.isArrayLiteralExpression(list)) return step(part, true, `${short(got)} is not written in place`);
        const [element] = want.elements;
        const [first] = list.getElements();
        if (element !== undefined && first !== undefined) value(element, first, `each element of ${part}`);
        return;
      }
      case 'new': {
        if (got === undefined) return step(part, false, `wants new ${want.className ?? '?'}(...) and nothing is written`);
        const made = unwrap(got);
        if (!Node.isNewExpression(made) || made.getExpression().getText() !== want.className) {
          return step(part, false, `wants new ${want.className ?? '?'}(...), the call writes ${short(got)}`);
        }
        args(want.args, made.getArguments(), `new ${want.className}()`);
        return;
      }
      default:
        return step(part, false, `the pattern writes ${'text' in want ? want.text : want.kind} here, which nothing is matched against`);
    }
  };

  const args = (wanted: readonly PatternNode[], written: readonly TsNode[], within: string): void => {
    for (const [index, want] of wanted.entries()) {
      if (want.kind === 'run') {
        captures[want.name] = written.slice(index).map(short).join(', ');
        steps.push({ part: `arguments ${index}.. of ${within}`, ok: true, detail: `${want.name} = ${written.length - index} argument(s)` });
        return;
      }
      value(want, written[index], `argument ${index} of ${within}`);
    }
  };

  /** The callee of a call against what the pattern calls, down the chain. */
  const callee = (want: PatternNode, got: TsNode, isTop: boolean): void => {
    if (want.kind === 'name' || want.kind === 'hole') {
      const name = Node.isIdentifier(got) ? got.getText() : Node.isPropertyAccessExpression(got) ? got.getName() : undefined;
      if (want.kind === 'hole') {
        captures[want.name] = name ?? short(got);
        return step('callee', name !== undefined, `${want.name} = ${name ?? short(got)}`);
      }
      return step('callee', name === want.text, name === want.text ? want.text : `wants ${want.text}(...), the call is ${short(got)}(...)`);
    }
    if (want.kind !== 'member') return step('callee', false, 'the pattern\'s callee is not a name or a method');
    if (!Node.isPropertyAccessExpression(got)) return step('method', false, `wants .${want.name}(...), the call is ${short(got)}(...)`);
    step(isTop ? 'method' : `method ${want.name} in the chain`, got.getName() === want.name, got.getName() === want.name ? want.name : `wants .${want.name}, the call is .${got.getName()}`);
    receiver(want.object, got.getExpression(), isTop);
  };

  const receiver = (want: PatternNode, got: TsNode, isTop: boolean): void => {
    if (isTop && options.receiverTypes !== undefined && options.receiverTypes.length > 0) {
      const type = options.receiverTypeOf?.(got);
      if (options.receiverTypeOf === undefined) steps.push({ part: 'receiver type', ok: true, detail: 'not asked here' });
      else step('receiver type', type !== undefined && options.receiverTypes.includes(type), type === undefined ? `nothing says what ${short(got)} is; wants ${options.receiverTypes.join(' or ')}` : type);
    }
    if (want.kind === 'hole') {
      captures[want.name] = short(got);
      return step('receiver', true, `${want.name} = ${short(got)}`);
    }
    if (want.kind === 'any') return;
    if (want.kind === 'call') {
      const call = unwrap(got);
      if (!Node.isCallExpression(call)) return step('receiver', false, `wants ${want.text}, the receiver is ${short(got)}`);
      callee(want.callee, call.getExpression(), false);
      args(want.args, call.getArguments(), `${want.callee.kind === 'member' ? want.callee.name : 'the root'}()`);
      return;
    }
    if (want.kind === 'new') {
      value(want, got, 'the receiver');
      return;
    }
    return step('receiver', false, `the pattern names the receiver ${'text' in want ? want.text : want.kind}, which nothing is matched against`);
  };

  try {
    const root = pattern.root;
    if (root.kind !== 'call') step('pattern', false, 'not a call');
    const call = root as PatternNode & { kind: 'call' };
    if (Node.isDecorator(site)) {
      const name = site.getName();
      const want = call.callee.kind === 'name' ? call.callee.text : '?';
      step('decorator', name === want, name === want ? `@${name}` : `wants @${want}, the decorator is @${name}`);
      args(call.args, site.getArguments(), `@${name}`);
    } else {
      callee(call.callee, site.getExpression(), true);
      args(call.args, site.getArguments(), call.callee.kind === 'member' ? `${call.callee.name}()` : `${call.callee.kind === 'name' ? call.callee.text : '?'}()`);
    }
    return { matched: true, captures, steps };
  } catch (error) {
    if (error instanceof Mismatch) return { matched: false, captures, steps };
    throw error;
  }
};
