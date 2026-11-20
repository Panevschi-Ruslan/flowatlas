import { evaluateExpression, isDiscriminatorField, type Confidence } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The channels a per-scope object is handed by name, through the project's own
 * publish helper (P362).
 *
 * A hub that holds streams open and subscribes to no broker is often fed by
 * the code that publishes: `bus.publish(channel, message)` posts the message,
 * with its channel, to the hub's stub, and the hub writes it to every stream
 * whose scope the channel is in. The hub then relays every channel the helper
 * is handed, and which ones that is can be read: the write through the stub is
 * handed a parameter of the function it is written in (`body:
 * JSON.stringify({ channel, message })`), that function is called with a
 * parameter of its caller, and so on out to the calls the broker reader drew
 * as producers, each naming its channel. A test of the channel on the way - `if
 * (channel.startsWith('board:'))`, `if (!FAMILIES.some((f) => channel.startsWith(f))) return;`
 * - narrows which channels get through.
 *
 * Pure reading of the syntax and the checker; the pass that draws the edges
 * hands in how a call is resolved and what a producer at a call emits.
 */

/** How many functions out a channel handed in as a parameter is followed. */
const FEED_DEPTH = 4;

/** What one test of a channel says of one channel name. */
export type Passes = 'yes' | 'no' | 'maybe';

/** A test of a channel, as a function of the name: `undefined` where the condition does not read the channel. */
export type ChannelTest = (name: string) => Passes;

const unwrap = (value: TsNode): TsNode => {
  let at = value;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isAwaitExpression(at) || Node.isSatisfiesExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

const opensBody = (node: TsNode): boolean =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isConstructorDeclaration(node);

/** The function a node is written in, closest first. */
export const enclosingFunction = (node: TsNode): TsNode | undefined => node.getFirstAncestor((at) => opensBody(at));

const parametersOf = (fn: TsNode): ParameterDeclaration[] =>
  Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isConstructorDeclaration(fn) ? fn.getParameters() : [];

/** Whether an identifier written in a function is its parameter: by the checker, or a shorthand member repeating its name. */
const isParameter = (identifier: TsNode, parameter: ParameterDeclaration): boolean => {
  const parent = identifier.getParent();
  if (parent !== undefined && Node.isShorthandPropertyAssignment(parent)) {
    return parent.getValueSymbol()?.getDeclarations()[0] === parameter;
  }
  return identifier.getSymbol()?.getDeclarations()[0] === parameter;
};

/** A parameter handed on: the parameter, and the function that declares it. */
export interface HandedParameter {
  readonly fn: TsNode;
  readonly parameter: ParameterDeclaration;
}

/**
 * The parameters a value holds, anywhere inside it: of the function it is
 * written in, or of one around it - `transports.map((t) => handlers[t](channel))`
 * hands on the `channel` of the function the callback is written in.
 */
const parametersIn = (value: TsNode): HandedParameter[] => {
  const found: HandedParameter[] = [];
  for (const node of [value, ...value.getDescendants()]) {
    if (!Node.isIdentifier(node)) continue;
    const parent = node.getParent();
    const symbol = parent !== undefined && Node.isShorthandPropertyAssignment(parent) ? parent.getValueSymbol() : node.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration === undefined || !Node.isParameterDeclaration(declaration) || !Node.isIdentifier(declaration.getNameNode())) continue;
    const fn = declaration.getParent();
    if (fn === undefined || !opensBody(fn) || fn.getSourceFile() !== value.getSourceFile() || !fn.containsRange(value.getPos(), value.getEnd())) continue;
    if (!found.some((each) => each.parameter === declaration)) found.push({ fn, parameter: declaration });
  }
  return found;
};

/** The parameters a call is handed in its arguments, of the function it is written in or one around it. */
export const parametersHanded = (call: CallExpression): HandedParameter[] => {
  const found: HandedParameter[] = [];
  for (const argument of call.getArguments()) {
    for (const each of parametersIn(argument)) if (!found.some((known) => known.parameter === each.parameter)) found.push(each);
  }
  return found;
};

/** The string values an expression the code states holds: a literal, a constant list or set. */
const stringsOf = (node: TsNode, depth = 0): string[] | undefined => {
  if (depth > 3) return undefined;
  const bare = unwrap(node);
  // `new Set(['hub'])`, `new Set<Transport>([...])`
  if (Node.isNewExpression(bare) && /^(?:Readonly)?Set$/.test(bare.getExpression().getText())) {
    const [list] = bare.getArguments();
    return list === undefined ? [] : stringsOf(list, depth + 1);
  }
  const value = evaluateExpression(bare);
  if (value.resolved && typeof value.value === 'string') return [value.value];
  if (value.resolved && Array.isArray(value.value) && value.value.every((each) => typeof each === 'string')) return value.value as string[];
  // A constant held in a name whose declaration says more than its type: `const FAMILIES: readonly string[] = ['board:']`.
  const at = unwrap(node);
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && initializer !== node) return stringsOf(initializer, depth + 1);
    }
  }
  return undefined;
};

/** The parts of a channel name around its placeholders: `board:*:events` is `board:`, `:events`. */
const fixedEnds = (name: string): { head: string; tail: string; open: boolean } => {
  const first = name.indexOf('*');
  if (first < 0) return { head: name, tail: name, open: false };
  return { head: name.slice(0, first), tail: name.slice(name.lastIndexOf('*') + 1), open: true };
};

const startsWithTest = (literal: string): ChannelTest => (name) => {
  const { head, open } = fixedEnds(name);
  if (head.startsWith(literal)) return 'yes';
  return open && literal.startsWith(head) ? 'maybe' : 'no';
};

const endsWithTest = (literal: string): ChannelTest => (name) => {
  const { tail, open } = fixedEnds(name);
  if (tail.endsWith(literal)) return 'yes';
  return open && literal.endsWith(tail) ? 'maybe' : 'no';
};

const includesTest = (literal: string): ChannelTest => (name) => {
  if (name.split('*').some((part) => part.includes(literal))) return 'yes';
  return name.includes('*') ? 'maybe' : 'no';
};

const equalsTest = (literal: string): ChannelTest => (name) => {
  if (name === literal) return 'yes';
  if (!name.includes('*')) return 'no';
  const pattern = new RegExp(`^${name.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^]*')}$`);
  return pattern.test(literal) ? 'maybe' : 'no';
};

const anyOf = (tests: readonly ChannelTest[]): ChannelTest => (name) => {
  const answers = tests.map((test) => test(name));
  return answers.includes('yes') ? 'yes' : answers.includes('maybe') ? 'maybe' : 'no';
};

const allOf = (tests: readonly ChannelTest[]): ChannelTest => (name) => {
  const answers = tests.map((test) => test(name));
  return answers.includes('no') ? 'no' : answers.includes('maybe') ? 'maybe' : 'yes';
};

const not = (test: ChannelTest): ChannelTest => (name) => {
  const answer = test(name);
  return answer === 'yes' ? 'no' : answer === 'no' ? 'yes' : 'maybe';
};

const MAYBE: ChannelTest = () => 'maybe';

const STRING_TESTS: Record<string, (literal: string) => ChannelTest> = { startsWith: startsWithTest, endsWith: endsWithTest, includes: includesTest };

/**
 * What a condition says of the channel a name holds: a method of the string
 * with a literal, a comparison, a pattern tested against it, a constant list
 * it is in or some member of which it starts with; joined by `&&`, `||` and
 * `!`. A condition that names the channel in a way not read is `maybe` for
 * every channel; one that does not name it is `undefined`.
 */
export const channelTestOf = (condition: TsNode, isChannel: (node: TsNode) => boolean): ChannelTest | undefined => {
  const node = unwrap(condition);
  const names = (at: TsNode): boolean => isChannel(unwrap(at));
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const inner = channelTestOf(node.getOperand(), isChannel);
    return inner === undefined ? undefined : not(inner);
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
      const sides = [channelTestOf(node.getLeft(), isChannel), channelTestOf(node.getRight(), isChannel)];
      const read = sides.filter((side): side is ChannelTest => side !== undefined);
      if (read.length === 0) return undefined;
      // A side about something else: under `&&` it narrows nothing of the channel; under `||` it may let any through.
      if (operator === SyntaxKind.AmpersandAmpersandToken) return allOf(read);
      return read.length === sides.length ? anyOf(read) : anyOf([...read, MAYBE]);
    }
    const equal = operator === SyntaxKind.EqualsEqualsEqualsToken || operator === SyntaxKind.EqualsEqualsToken;
    const unequal = operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken;
    if (equal || unequal) {
      const [left, right] = [node.getLeft(), node.getRight()];
      const other = names(left) ? right : names(right) ? left : undefined;
      if (other === undefined) return undefined;
      const literals = stringsOf(other);
      const test = literals === undefined || literals.length !== 1 ? MAYBE : equalsTest(literals[0] as string);
      return unequal ? not(test) : test;
    }
    return [node.getLeft(), node.getRight()].some(names) ? MAYBE : undefined;
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrap(node.getExpression());
    const [first] = node.getArguments();
    if (Node.isPropertyAccessExpression(callee)) {
      const method = callee.getName();
      const receiver = callee.getExpression();
      // `channel.startsWith('board:')`
      if (names(receiver) && STRING_TESTS[method] !== undefined) {
        const literals = first === undefined ? undefined : stringsOf(first);
        return literals === undefined ? MAYBE : anyOf(literals.map((literal) => (STRING_TESTS[method] as (l: string) => ChannelTest)(literal)));
      }
      // `/^board:/.test(channel)`
      if ((method === 'test' || method === 'exec') && first !== undefined && names(first)) {
        const pattern = unwrap(receiver);
        if (!Node.isRegularExpressionLiteral(pattern)) return MAYBE;
        const text = pattern.getText();
        let regex: RegExp;
        try {
          regex = new RegExp(text.slice(1, text.lastIndexOf('/')), text.slice(text.lastIndexOf('/') + 1).replace(/[gy]/g, ''));
        } catch {
          return MAYBE;
        }
        return (name) => (regex.test(name.replace(/\*/g, 'x')) ? (name.includes('*') ? 'maybe' : 'yes') : name.includes('*') ? 'maybe' : 'no');
      }
      // `FAMILIES.includes(channel)`
      if (method === 'includes' && first !== undefined && names(first)) {
        const literals = stringsOf(receiver);
        return literals === undefined ? MAYBE : anyOf(literals.map(equalsTest));
      }
      // `FAMILIES.some((family) => channel.startsWith(family))`
      if ((method === 'some' || method === 'find') && first !== undefined) {
        const predicate = unwrap(first);
        if (!Node.isArrowFunction(predicate) && !Node.isFunctionExpression(predicate)) return undefined;
        const [element] = predicate.getParameters();
        const body = predicate.getBody();
        const expression = Node.isBlock(body)
          ? (() => {
              const statements = body.getStatements();
              const [only] = statements;
              return statements.length === 1 && only !== undefined && Node.isReturnStatement(only) ? only.getExpression() : undefined;
            })()
          : body;
        if (expression === undefined || element === undefined) return undefined;
        const literals = stringsOf(receiver);
        const elementName = element.getName();
        // The predicate read with each member of the list put where its element is.
        const inner = (literal: string): ChannelTest | undefined => {
          const memberTest = (at: TsNode): ChannelTest | undefined => {
            const bare = unwrap(at);
            if (Node.isCallExpression(bare)) {
              const call = unwrap(bare.getExpression());
              const [argument] = bare.getArguments();
              if (Node.isPropertyAccessExpression(call) && names(call.getExpression()) && argument !== undefined && unwrap(argument).getText() === elementName) {
                const make = STRING_TESTS[call.getName()];
                return make === undefined ? MAYBE : make(literal);
              }
            }
            if (Node.isBinaryExpression(bare)) {
              const [left, right] = [unwrap(bare.getLeft()), unwrap(bare.getRight())];
              const op = bare.getOperatorToken().getKind();
              if ((op === SyntaxKind.EqualsEqualsEqualsToken || op === SyntaxKind.EqualsEqualsToken) && ((names(left) && right.getText() === elementName) || (names(right) && left.getText() === elementName))) {
                return equalsTest(literal);
              }
            }
            return [bare, ...bare.getDescendants()].some((each) => isChannel(each)) ? MAYBE : undefined;
          };
          return memberTest(expression);
        };
        if (!(expression.getDescendants().some((each) => isChannel(each)) || isChannel(expression))) return undefined;
        if (literals === undefined) return MAYBE;
        const tests = literals.map(inner).filter((test): test is ChannelTest => test !== undefined);
        return tests.length === 0 ? MAYBE : anyOf(tests);
      }
    }
    return node.getArguments().some(names) ? MAYBE : undefined;
  }
  return names(node) ? MAYBE : undefined;
};

/** Whether a statement leaves the function on every way through it. */
const leaves = (statement: TsNode): boolean => {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last !== undefined && leaves(last);
  }
  return false;
};

/**
 * The conditions a call is made under, inside the function it is written in:
 * each `if` whose branch holds it (the `else` holding it under the condition
 * failing), each `&&` and `?:` it is the guarded side of, and each early return
 * before it (`if (!ok) return;`), which it is made under the failing of.
 */
export const guardsOf = (call: TsNode, fn: TsNode): { condition: TsNode; holds: boolean }[] => {
  const guards: { condition: TsNode; holds: boolean }[] = [];
  let child: TsNode = call;
  for (let at = call.getParent(); at !== undefined && at !== fn; child = at, at = at.getParent()) {
    if (Node.isIfStatement(at)) {
      if (at.getThenStatement() === child) guards.push({ condition: at.getExpression(), holds: true });
      else if (at.getElseStatement() === child) guards.push({ condition: at.getExpression(), holds: false });
    } else if (Node.isConditionalExpression(at)) {
      if (at.getWhenTrue() === child) guards.push({ condition: at.getCondition(), holds: true });
      else if (at.getWhenFalse() === child) guards.push({ condition: at.getCondition(), holds: false });
    } else if (Node.isBinaryExpression(at) && at.getRight() === child) {
      const operator = at.getOperatorToken().getKind();
      if (operator === SyntaxKind.AmpersandAmpersandToken) guards.push({ condition: at.getLeft(), holds: true });
      else if (operator === SyntaxKind.BarBarToken) guards.push({ condition: at.getLeft(), holds: false });
    }
    if (Node.isBlock(at) || Node.isSourceFile(at)) {
      const statements = at.getStatements() as TsNode[];
      for (const before of statements.slice(0, statements.indexOf(child))) {
        if (Node.isIfStatement(before) && before.getElseStatement() === undefined && leaves(before.getThenStatement())) {
          guards.push({ condition: before.getExpression(), holds: false });
        }
      }
    }
  }
  return guards;
};

/** What a call made under the guards around it says of a channel: one test, all of them together. */
const testUnder = (call: TsNode, fn: TsNode, parameter: ParameterDeclaration): ChannelTest | undefined => {
  const isChannel = (node: TsNode): boolean => Node.isIdentifier(node) && node.getText() === parameter.getName() && isParameter(node, parameter);
  const tests = guardsOf(call, fn).flatMap(({ condition, holds }) => {
    const test = channelTestOf(condition, isChannel);
    return test === undefined ? [] : [holds ? test : not(test)];
  });
  return tests.length === 0 ? undefined : allOf(tests);
};

// ---------------------------------------------------------------------------
// A record of handlers looked up by a key the channel decides

/** A name of the repository's own a call names, as the function it stands for. */
const functionNamed = (callee: TsNode): TsNode | undefined => {
  const at = unwrap(callee);
  const name = Node.isPropertyAccessExpression(at) ? at.getNameNode() : Node.isIdentifier(at) ? at : undefined;
  const symbol = name?.getSymbol();
  const declaration = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile()) return undefined;
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) {
    const value = declaration.getInitializer();
    return value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) ? value : undefined;
  }
  return undefined;
};

/** The keys a channel is routed to: those of the table's entry for it (`sure`), or the default where it has none. */
type Routes = (name: string) => { readonly keys: readonly string[]; readonly sure: boolean } | undefined;

/** A channel name, or a key of a routing table, with its placeholders written alike: `board:{id}:events` is `board:*:events`. */
const family = (name: string): string => name.replace(/\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|\[[^\]]*\]/g, '*');

/**
 * The routing table a function reads, where it looks a channel up in a
 * constant written out: `ROUTES.get(familyOf(channel)) ?? DEFAULT` over
 * `new Map([['board:*:events', HUB_ONLY], …])`, or `TABLE[key] ?? …` over an
 * object; each value a constant list or set of keys.
 */
const routesIn = (fn: TsNode): Routes | undefined => {
  const lookups = fn.getDescendants().filter((node) => {
    if (Node.isCallExpression(node)) {
      const callee = unwrap(node.getExpression());
      return Node.isPropertyAccessExpression(callee) && callee.getName() === 'get' && node.getArguments().length === 1;
    }
    return Node.isElementAccessExpression(node);
  });
  for (const lookup of lookups) {
    const holder = Node.isCallExpression(lookup) ? (unwrap(lookup.getExpression()) as unknown as { getExpression(): TsNode }).getExpression() : (lookup as unknown as { getExpression(): TsNode }).getExpression();
    const at = unwrap(holder);
    const declaration = Node.isIdentifier(at) ? at.getSymbol()?.getDeclarations()[0] : undefined;
    const written = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (written === undefined) continue;
    const table = new Map<string, readonly string[]>();
    const value = unwrap(written);
    if (Node.isNewExpression(value) && /Map$/.test(value.getExpression().getText())) {
      const [list] = value.getArguments();
      const pairs = list === undefined ? undefined : unwrap(list);
      if (pairs === undefined || !Node.isArrayLiteralExpression(pairs)) continue;
      for (const pair of pairs.getElements()) {
        const tuple = unwrap(pair);
        if (!Node.isArrayLiteralExpression(tuple)) continue;
        const [key, keys] = tuple.getElements();
        const name = key === undefined ? undefined : stringsOf(key);
        const routed = keys === undefined ? undefined : stringsOf(keys);
        if (name?.length === 1 && routed !== undefined) table.set(family(name[0] as string), routed);
      }
    } else if (Node.isObjectLiteralExpression(value)) {
      for (const property of value.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;
        const name = property.getNameNode();
        const key = Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name) ? name.getLiteralText() : Node.isIdentifier(name) ? name.getText() : undefined;
        const routed = stringsOf(property.getInitializerOrThrow());
        if (key !== undefined && routed !== undefined) table.set(family(key), routed);
      }
    } else continue;
    if (table.size === 0) continue;
    // `?? DEFAULT`, `|| DEFAULT` on the lookup.
    let around: TsNode = lookup;
    while (around.getParent() !== undefined && (Node.isParenthesizedExpression(around.getParentOrThrow()) || Node.isAsExpression(around.getParentOrThrow()))) around = around.getParentOrThrow();
    const parent = around.getParent();
    const fallback =
      parent !== undefined && Node.isBinaryExpression(parent) && parent.getLeft() === around && [SyntaxKind.QuestionQuestionToken, SyntaxKind.BarBarToken].includes(parent.getOperatorToken().getKind())
        ? stringsOf(parent.getRight())
        : undefined;
    return (name) => {
      const keys = table.get(family(name));
      if (keys !== undefined) return { keys, sure: true };
      return fallback === undefined ? undefined : { keys: fallback, sure: false };
    };
  }
  return undefined;
};

/** The collection a key is drawn from: the list `.map`/`.forEach` walks, or a `for … of`. */
const collectionOf = (key: TsNode): TsNode | undefined => {
  const at = unwrap(key);
  const declaration = Node.isIdentifier(at) ? at.getSymbol()?.getDeclarations()[0] : undefined;
  if (declaration === undefined) return undefined;
  if (Node.isParameterDeclaration(declaration)) {
    const callback = declaration.getParent();
    const call = callback?.getParent();
    if (call === undefined || !Node.isCallExpression(call)) return undefined;
    const callee = unwrap(call.getExpression());
    return Node.isPropertyAccessExpression(callee) && ['map', 'forEach', 'flatMap', 'filter', 'some', 'every'].includes(callee.getName()) ? callee.getExpression() : undefined;
  }
  if (Node.isVariableDeclaration(declaration)) {
    const statement = declaration.getParent()?.getParent();
    if (statement !== undefined && Node.isForOfStatement(statement)) return statement.getExpression();
  }
  return undefined;
};

/** The routing a collection of keys is built by: `[...resolve(channel)]`, `Array.from(resolve(channel))`, a name holding either. */
const routesOfCollection = (collection: TsNode, depth = 0): Routes | undefined => {
  if (depth > 4) return undefined;
  const at = unwrap(collection);
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    const value = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    return value === undefined ? undefined : routesOfCollection(value, depth + 1);
  }
  if (Node.isArrayLiteralExpression(at)) {
    const [only] = at.getElements();
    return at.getElements().length === 1 && only !== undefined && Node.isSpreadElement(only) ? routesOfCollection(only.getExpression(), depth + 1) : undefined;
  }
  if (Node.isCallExpression(at)) {
    const callee = unwrap(at.getExpression());
    const [first] = at.getArguments();
    if (callee.getText() === 'Array.from' && first !== undefined) return routesOfCollection(first, depth + 1);
    const fn = functionNamed(callee);
    return fn === undefined ? undefined : routesIn(fn);
  }
  return undefined;
};

/**
 * What a call through a record of handlers, looked up by a key worked out when
 * the code runs - `this.handlers[t](channel, message)` - says of the channels
 * that reach the member `member`: the keys the routing table gives each
 * channel, where the key is drawn from one; `maybe` for every channel where
 * that is not read.
 */
export const keyTestOf = (call: CallExpression, member: string): ChannelTest => {
  const callee = unwrap(call.getExpression());
  if (!Node.isElementAccessExpression(callee)) return MAYBE;
  const key = callee.getArgumentExpression();
  if (key === undefined) return MAYBE;
  const written = stringsOf(key);
  if (written !== undefined && written.length === 1) return () => (written[0] === member ? 'yes' : 'no');
  const collection = collectionOf(key);
  const routes = collection === undefined ? undefined : routesOfCollection(collection);
  if (routes === undefined) return MAYBE;
  return (name) => {
    const routed = routes(name);
    if (routed === undefined) return 'maybe';
    if (!routed.keys.includes(member)) return 'no';
    return routed.sure ? 'yes' : 'maybe';
  };
};

/** One channel handed to a hub, and how it was followed there. */
export interface FedChannel {
  readonly channel: string;
  readonly confidence: Confidence;
  /** The producer call the channel was named at. */
  readonly file: string;
  readonly line: number;
  /** The functions it was handed through, outermost first: `BusService.publish`, `BusService.fanoutToHub`. */
  readonly through: readonly string[];
}

/** One call of a function: made by name, or through a record of handlers by the member's key (`member`). */
export interface FeedCall {
  readonly call: CallExpression;
  /** The member of a record of handlers the function is, where the call looks it up by a key worked out when the code runs. */
  readonly member?: string;
}

export interface FeedLookup {
  /** Every call of the function given, across the repository. */
  callsOf(fn: TsNode): readonly FeedCall[];
  /** The channels an argument names, read as the broker reader reads a producer's channel, where it is one the code states. */
  named(argument: TsNode): readonly string[] | undefined;
  /** The name a function is known by, for `through`. */
  nameOf(fn: TsNode): string;
  fileOf(node: TsNode): string;
}

const lineOf = (node: TsNode): number => node.getStartLineNumber();

/** The names a value handed to a hub under is read as its channel by: `{ channel, message }`. */
const CHANNEL_KEY = /^(?:channel|channelName|topic|room|subject)$/i;

/** A parameter a function's channel is held in, where nothing names the channel's place in what it sends. */
const CHANNEL_NAME = /channel|topic|room/i;

/** How deep an argument is searched for the value the hub reads as the channel: `{ body: JSON.stringify({ channel }) }`. */
const KEY_DEPTH = 4;

/**
 * The value a write to a hub hands it as the channel (P362): the member of the
 * object it sends (`body: JSON.stringify({ channel, message })`) named as a
 * channel is; failing that, a parameter of the function the write is written
 * in that is named as one and handed to the write. Undefined where neither is
 * read - nothing else the write is handed is taken for the channel.
 */
export const channelValueOf = (call: CallExpression): TsNode | undefined => {
  const search = (value: TsNode, depth: number): TsNode | undefined => {
    if (depth > KEY_DEPTH) return undefined;
    const at = unwrap(value);
    if (Node.isCallExpression(at)) {
      // `JSON.stringify({ channel, message })`, `new Request(url, { body: … })` written as a call.
      for (const argument of at.getArguments()) {
        const found = search(argument, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (Node.isNewExpression(at)) {
      for (const argument of at.getArguments() ?? []) {
        const found = search(argument, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!Node.isObjectLiteralExpression(at)) return undefined;
    for (const property of at.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property) && CHANNEL_KEY.test(property.getName())) return property.getNameNode();
      if (Node.isPropertyAssignment(property)) {
        const name = property.getNameNode();
        const key = Node.isIdentifier(name) ? name.getText() : Node.isStringLiteral(name) ? name.getLiteralText() : undefined;
        if (key !== undefined && CHANNEL_KEY.test(key)) return property.getInitializerOrThrow();
      }
    }
    for (const property of at.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const found = search(property.getInitializerOrThrow(), depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const argument of call.getArguments()) {
    const found = search(argument, 0);
    if (found !== undefined) return found;
  }
  const named = parametersHanded(call).find(({ parameter }) => CHANNEL_NAME.test(parameter.getName()));
  return named?.parameter.getNameNode();
};

/** The declaration a value names: a shorthand member's value, else what the checker answers. */
const declarationNamed = (value: TsNode): TsNode | undefined => {
  const parent = value.getParent();
  const symbol = parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === value ? parent.getValueSymbol() : value.getSymbol();
  return symbol?.getDeclarations()[0];
};

/**
 * Whether a parameter is also written as the type of a message in its function
 * - `{ type }`, `{ type: kind }` - which a channel is not: a value that reaches
 * the type is never followed out as a channel.
 */
const isTypeWritten = (parameter: ParameterDeclaration, fn: TsNode): boolean =>
  fn.getDescendants().some((node) => {
    if (Node.isShorthandPropertyAssignment(node)) return isDiscriminatorField(node.getName()) && node.getValueSymbol()?.getDeclarations()[0] === parameter;
    if (!Node.isPropertyAssignment(node)) return false;
    const name = node.getNameNode();
    if (!Node.isIdentifier(name) || !isDiscriminatorField(name.getText())) return false;
    const value = unwrap(node.getInitializerOrThrow());
    return Node.isIdentifier(value) && value.getSymbol()?.getDeclarations()[0] === parameter;
  });

/**
 * Whether a name read where a channel is handed on can be one: not a value
 * written as a type of message (`CARD_ADDED`: capitals and underscores alone),
 * not empty.
 */
const channelShaped = (name: string): boolean => name.trim() !== '' && !/^[A-Z][A-Z0-9_]*$/.test(name);

/** A parameter a message is handed in beside its channel, by name. */
const PAYLOAD_NAME = /message|payload|event|data|body/i;

/**
 * A call that hands a function of the project's own a channel the walk reads
 * there (P362): a publish of that channel through the function, whichever
 * transport the function ends at - `this.bus.publish(`board:${id}:orders`,
 * { type: … })` where `bus` is no broker the configuration names.
 */
export interface HelperPublish {
  readonly call: CallExpression;
  readonly channels: readonly string[];
  readonly confidence: Confidence;
  /** The function called, by name: `BusService.publish`. */
  readonly helper: string;
  /** The argument the message is handed in, where the function takes one beside the channel. */
  readonly payload?: TsNode;
}

/** What a walk out from a transport reads: the channels, and the calls that name each. */
export interface Fed {
  readonly channels: readonly FedChannel[];
  readonly publishes: readonly HelperPublish[];
}

/**
 * The channels a value in a transport's channel place is handed (P362). Only
 * that value is followed, through the names it is held in: where it is worked
 * out in place - a template, a helper of the project's own - it is read there
 * as the broker reader reads a producer's channel, and the walk ends; where it
 * is a parameter, every call of the function that declares it is asked for
 * the argument in that place, and so on out; each such call that names the
 * channel is a publish through the function. A parameter also written as a
 * message's type is no channel; an object, a list, or a name shaped like a
 * type of message is not read as one. A call through a record of handlers by
 * a computed key is a test of its own: the routing table the key is drawn
 * from. A channel a test on the way rules out is not handed on; one it may
 * rule out is handed on as a guess.
 */
export const channelsFrom = (value: TsNode, at: TsNode, lookup: FeedLookup): Fed => {
  const out = new Map<string, FedChannel>();
  const publishes: HelperPublish[] = [];
  const record = (names: readonly string[], tests: readonly ChannelTest[], straight: boolean, site: TsNode, through: readonly string[], helper?: { fn: TsNode; index: number }): void => {
    const kept: string[] = [];
    let sureAll = true;
    for (const channel of names) {
      if (!channelShaped(channel)) continue;
      const answers = tests.map((test) => test(channel));
      if (answers.includes('no')) continue;
      const sure = straight && !answers.includes('maybe');
      kept.push(channel);
      if (!sure) sureAll = false;
      const known = out.get(channel);
      if (known !== undefined && (known.confidence === 'static' || !sure)) continue;
      out.set(channel, { channel, confidence: sure ? 'static' : 'heuristic', file: lookup.fileOf(site), line: lineOf(site), through });
    }
    if (helper === undefined || kept.length === 0 || !Node.isCallExpression(site)) return;
    const parameters = parametersOf(helper.fn);
    const byName = parameters.findIndex((parameter, index) => index !== helper.index && PAYLOAD_NAME.test(parameter.getName()));
    const payloadIndex = byName >= 0 ? byName : helper.index + 1;
    const payload = site.getArguments()[payloadIndex];
    publishes.push({ call: site, channels: kept, confidence: sureAll ? 'static' : 'heuristic', helper: lookup.nameOf(helper.fn), ...(payload === undefined ? {} : { payload }) });
  };
  /** One value in the channel's place, used at `site`, under the tests met so far; `helper` the function it was handed to there. */
  const track = (
    value: TsNode,
    site: TsNode,
    tests: readonly ChannelTest[],
    through: readonly string[],
    straight: boolean,
    depth: number,
    helper?: { fn: TsNode; index: number },
  ): void => {
    if (depth >= FEED_DEPTH * 2) return;
    const bare = unwrap(value);
    if (Node.isObjectLiteralExpression(bare) || Node.isArrayLiteralExpression(bare)) return;
    const declaration = Node.isIdentifier(bare) ? declarationNamed(bare) : undefined;
    if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
      const fn = declaration.getParent();
      if (fn === undefined || !opensBody(fn) || isTypeWritten(declaration, fn)) return;
      const index = parametersOf(fn).indexOf(declaration);
      const own = testUnder(site, fn, declaration);
      const under = own === undefined ? tests : [...tests, own];
      const here = [lookup.nameOf(fn), ...through];
      for (const { call: caller, member } of lookup.callsOf(fn)) {
        const argument = caller.getArguments()[index];
        if (argument === undefined) continue;
        const tested = member === undefined ? under : [...under, keyTestOf(caller, member)];
        // A member of a record of handlers is no function a caller names: the call through the record is not a publish of its own.
        track(argument, caller, tested, here, straight, depth + 1, member === undefined ? { fn, index } : undefined);
      }
      return;
    }
    const named = lookup.named(bare);
    if (named !== undefined && named.length > 0) {
      record(named, tests, straight, site, through.length === 0 ? [lookup.nameOf(enclosingFunction(site) ?? site)] : through, helper);
      return;
    }
    // Held in a name of the function: followed to what it was given.
    if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) track(initializer, site, tests, through, straight, depth + 1, helper);
    }
  };
  track(value, at, [], [], true, 0);
  return { channels: [...out.values()].sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0)), publishes };
};

/** The channels a write through a stub, at `call`, hands on, and the calls that name them. */
export const fedFrom = (call: CallExpression, lookup: FeedLookup): Fed => {
  const value = channelValueOf(call);
  return value === undefined ? { channels: [], publishes: [] } : channelsFrom(value, call, lookup);
};

/** The channels a write through a stub, at `call`, hands on (P362). */
export const fedChannels = (call: CallExpression, lookup: FeedLookup): FedChannel[] => [...fedFrom(call, lookup).channels];
