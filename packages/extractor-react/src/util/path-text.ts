import { evaluateExpression } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The addresses a front end's path expression spells (P288), read the way a
 * route table and a navigation write them: a literal, a template, text joined
 * with `+`, a `const`, and a call of a function of the repository that hands
 * back text - `startPath()`, `adminPath('teams', id, 'members')` - its
 * parameters bound to the call's arguments, a rest parameter's `join(...)`
 * and `length` read off the arguments written. A value read at run time is
 * kept as a hole, `${team.id}`.
 *
 * A condition the arguments decide is decided; one they do not
 * (`env.ROOT_SHARE_ID ? '/' : '/home'`) is one address per branch, each
 * marked `guessed`, as a request written under one is (P280).
 */
export interface SpelledPath {
  readonly text: string;
  /** Arrived at through a branch nothing written decides. */
  readonly guessed?: true;
}

/** At most this many addresses from one expression; past it, the expression is code. */
const MOST = 8;
/** How many calls deep a function handing back text is followed. */
const DEPTH = 4;

/** What a parameter holds in one call: its values, the values of a rest parameter, or nothing passed. */
type Bound = { readonly values: readonly SpelledPath[] } | { readonly rest: ReadonlyArray<readonly SpelledPath[]> } | { readonly absent: true };
type Env = ReadonlyMap<TsNode, Bound>;

const NO_ENV: Env = new Map();

const bare = (node: TsNode): TsNode => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isSatisfiesExpression(value) || Node.isTypeAssertion(value)) value = value.getExpression();
  return value;
};

/** A value read at run time, spelled as a hole a reader of addresses knows: `${…}` with no braces of its own. */
const hole = (node: TsNode): SpelledPath => ({ text: `\${${node.getText().replace(/\s+/g, ' ').replace(/[{}]/g, '')}}` });

/** Every way of putting pieces together, one choice from each, or nothing past `MOST`. */
const joined = (pieces: ReadonlyArray<readonly SpelledPath[]>, separator = ''): SpelledPath[] | undefined => {
  let out: SpelledPath[] = [{ text: '' }];
  pieces.forEach((choices, index) => {
    const next: SpelledPath[] = [];
    for (const left of out) {
      for (const right of choices) {
        next.push({ text: `${left.text}${index === 0 ? '' : separator}${right.text}`, ...(left.guessed === true || right.guessed === true ? { guessed: true as const } : {}) });
      }
    }
    out = next;
  });
  return out.length > MOST ? undefined : out;
};

const guessedAll = (paths: readonly SpelledPath[]): SpelledPath[] => paths.map((path) => ({ ...path, guessed: true as const }));

/** The parameter a name is, where it is one of a function being read. */
const parameterOf = (node: TsNode, env: Env): Bound | undefined => {
  if (!Node.isIdentifier(node) || env.size === 0) return undefined;
  for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
    const bound = env.get(declaration);
    if (bound !== undefined) return bound;
  }
  return undefined;
};

/** `args.length` of a rest parameter, where it is bound. */
const restLength = (node: TsNode, env: Env): number | undefined => {
  const value = bare(node);
  if (!Node.isPropertyAccessExpression(value) || value.getName() !== 'length') return undefined;
  const bound = parameterOf(value.getExpression(), env);
  return bound !== undefined && 'rest' in bound ? bound.rest.length : undefined;
};

/** Whether a condition is settled by what the call wrote: a rest parameter's length, a parameter passed or not. */
const decided = (condition: TsNode, env: Env): boolean | undefined => {
  const value = bare(condition);
  if (Node.isPrefixUnaryExpression(value) && value.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const inner = decided(value.getOperand(), env);
    return inner === undefined ? undefined : !inner;
  }
  const length = restLength(value, env);
  if (length !== undefined) return length > 0;
  const bound = parameterOf(value, env);
  if (bound !== undefined) {
    if ('absent' in bound) return false;
    if ('rest' in bound) return true;
    // A text written in place is there; one read at run time may be empty.
    return bound.values.every((path) => !path.text.includes('${') && path.text !== '') ? true : undefined;
  }
  if (Node.isBinaryExpression(value)) {
    const left = restLength(value.getLeft(), env);
    const right = evaluateExpression(value.getRight());
    if (left === undefined || !right.resolved || typeof right.value !== 'number') return undefined;
    const number = right.value;
    switch (value.getOperatorToken().getText()) {
      case '>':
        return left > number;
      case '>=':
        return left >= number;
      case '<':
        return left < number;
      case '<=':
        return left <= number;
      case '===':
      case '==':
        return left === number;
      case '!==':
      case '!=':
        return left !== number;
      default:
        return undefined;
    }
  }
  return undefined;
};

/** Whether a `return` can be reached as the call's arguments decide the `if`s it is written under. */
const reachable = (statement: TsNode, body: TsNode, env: Env): boolean => {
  for (let child: TsNode = statement, at = statement.getParent(); at !== undefined && at !== body; child = at, at = at.getParent()) {
    if (!Node.isIfStatement(at) || child === at.getExpression()) continue;
    const settled = decided(at.getExpression(), env);
    if (settled === undefined) continue;
    if (child === at.getThenStatement() ? !settled : settled) return false;
  }
  return true;
};

/** The expressions a function hands back: its concise body, or each of its own `return`s. */
const returnedBy = (fn: TsNode, env: Env): TsNode[] | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return [body];
  const found: TsNode[] = [];
  let bad = false;
  body.forEachDescendant((node, traversal) => {
    if (Node.isFunctionLikeDeclaration(node) || Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      traversal.skip();
      return;
    }
    if (!Node.isReturnStatement(node)) return;
    if (!reachable(node, body, env)) return;
    const value = node.getExpression();
    if (value === undefined) bad = true;
    else found.push(value);
  });
  return bad || found.length === 0 ? undefined : found;
};

/** The function of this repository a callee names, written with a body. */
const calledFunction = (callee: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(callee)) return undefined;
  const symbol = callee.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().getFilePath().includes('/node_modules/')) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const') {
    const value = declaration.getInitializer();
    const fn = value === undefined ? undefined : bare(value);
    return fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn : undefined;
  }
  return undefined;
};

const spell = (node: TsNode, env: Env, depth: number): SpelledPath[] | undefined => {
  const value = bare(node);
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return [{ text: value.getLiteralValue() }];
  if (Node.isNumericLiteral(value)) return [{ text: String(value.getLiteralValue()) }];
  if (Node.isTemplateExpression(value)) {
    return joined([
      [{ text: value.getHead().getLiteralText() }],
      ...value.getTemplateSpans().flatMap((span) => [spell(span.getExpression(), env, depth) ?? [hole(span.getExpression())], [{ text: span.getLiteral().getLiteralText() }]]),
    ]);
  }
  if (Node.isBinaryExpression(value) && value.getOperatorToken().getText() === '+') {
    const pieces: TsNode[] = [];
    const collect = (piece: TsNode): void => {
      const inner = bare(piece);
      if (Node.isBinaryExpression(inner) && inner.getOperatorToken().getText() === '+') {
        collect(inner.getLeft());
        collect(inner.getRight());
      } else pieces.push(inner);
    };
    collect(value);
    const read = pieces.map((piece) => spell(piece, env, depth));
    // Text joined to values: a sum of values none of which is text is no address, and a number added to one (`page + 1`) is a sum (P291).
    if (read.every((each, index) => each === undefined || Node.isNumericLiteral(pieces[index] as TsNode))) return undefined;
    return joined(read.map((each, index) => each ?? [hole(pieces[index] as TsNode)]));
  }
  if (Node.isConditionalExpression(value)) {
    const settled = decided(value.getCondition(), env);
    if (settled !== undefined) return spell(settled ? value.getWhenTrue() : value.getWhenFalse(), env, depth);
    const yes = spell(value.getWhenTrue(), env, depth);
    const no = spell(value.getWhenFalse(), env, depth);
    if (yes === undefined || no === undefined) return undefined;
    const both = [...yes, ...no];
    const distinct = both.filter((path, index) => both.findIndex((other) => other.text === path.text) === index);
    if (distinct.length > MOST) return undefined;
    // Branches that are one address but for the query (`/search${q ? `?${q}` : ''}`) are that address, as a request's are (P279):
    // the one without it, so text written after it (`${findPath()}/:query?`) follows the path.
    const route = (path: SpelledPath): string => beforeQuery(path.text);
    if (distinct.every((path) => route(path) === route(distinct[0] as SpelledPath))) {
      const shortest = distinct.reduce((a, b) => (b.text.length < a.text.length ? b : a));
      return [shortest];
    }
    return distinct.length === 1 ? distinct : guessedAll(distinct);
  }
  const bound = parameterOf(value, env);
  if (bound !== undefined) return 'values' in bound ? [...bound.values] : undefined;
  if (Node.isCallExpression(value)) return spellCall(value, env, depth);
  if (Node.isIdentifier(value)) {
    const symbol = value.getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const') {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && depth < DEPTH) return spell(initializer, NO_ENV, depth + 1);
    }
  }
  if (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value) || Node.isElementAccessExpression(value)) {
    const evaluated = evaluateExpression(value);
    if (evaluated.resolved && (typeof evaluated.value === 'string' || typeof evaluated.value === 'number')) return [{ text: String(evaluated.value) }];
  }
  return undefined;
};

const spellCall = (call: TsNode, env: Env, depth: number): SpelledPath[] | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  const args = call.getArguments();
  // `segments.join('/')` on a rest parameter: the segments the call wrote.
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'join') {
    const bound = parameterOf(callee.getExpression(), env);
    if (bound === undefined || !('rest' in bound)) return undefined;
    const [separator] = args;
    const by = separator === undefined ? [{ text: ',' }] : spell(separator, env, depth);
    if (by === undefined || by.length !== 1) return undefined;
    return bound.rest.length === 0 ? [{ text: '' }] : joined(bound.rest, (by[0] as SpelledPath).text);
  }
  if (depth >= DEPTH) return undefined;
  const fn = calledFunction(callee);
  if (fn === undefined || !Node.isFunctionLikeDeclaration(fn)) return undefined;
  const scope = new Map<TsNode, Bound>();
  fn.getParameters().forEach((parameter, index) => {
    if (parameter.isRestParameter()) {
      scope.set(parameter, { rest: args.slice(index).map((arg) => spell(arg, env, depth) ?? [hole(arg)]) });
      return;
    }
    const arg = args[index];
    const fallback = parameter.getInitializer();
    if (arg !== undefined) scope.set(parameter, { values: spell(arg, env, depth) ?? [hole(arg)] });
    else if (fallback !== undefined) scope.set(parameter, { values: spell(fallback, NO_ENV, depth) ?? [hole(fallback)] });
    else scope.set(parameter, { absent: true });
  });
  const returned = returnedBy(fn, scope);
  if (returned === undefined) return undefined;
  const out: SpelledPath[] = [];
  for (const expression of returned) {
    const read = spell(expression, scope, depth + 1);
    if (read === undefined) return undefined;
    for (const path of returned.length > 1 ? guessedAll(read) : read) if (!out.some((other) => other.text === path.text)) out.push(path);
  }
  return out.length > MOST ? undefined : out;
};

/**
 * The addresses an expression spells, or nothing where it is not text (a
 * value read at run time on its own, an object, a call of a package).
 */
export const spelledPaths = (node: TsNode): SpelledPath[] | undefined => {
  const read = spell(node, NO_ENV, 0);
  // A hole and nothing else is a value read at run time, not an address.
  if (read === undefined || read.every((path) => /^\$\{[^}]*\}$/.test(path.text))) return undefined;
  return read;
};

/**
 * An address before its query and its fragment. A `?` that ends a parameter
 * (`/home/:tab?`) is the parameter's, optional, and a hole's own text is
 * passed over.
 */
export const beforeQuery = (text: string): string => {
  for (let at = 0; at < text.length; at += 1) {
    if (text.startsWith('${', at)) {
      const end = text.indexOf('}', at);
      if (end === -1) return text;
      at = end;
      continue;
    }
    const char = text[at];
    if (char === '#') return text.slice(0, at);
    if (char !== '?') continue;
    const next = text[at + 1];
    if (text[text.lastIndexOf('/', at) + 1] === ':' && (next === undefined || next === '/')) continue;
    return text.slice(0, at);
  }
  return text;
};

/** Whether an address holds a value read at run time. */
export const holdsHole = (text: string): boolean => text.includes('${');
