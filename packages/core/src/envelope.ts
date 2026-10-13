import { Node, SyntaxKind, type Node as TsNode, type ParameterDeclaration, type Type } from 'ts-morph';

/**
 * Where a message sits in what the code receiving it is handed (R172).
 *
 * A message published to a channel rarely reaches its handler as itself: the
 * platform that delivers it wraps it, often as text inside a record inside a
 * list, and a handler that wants the message reaches into the wrapping and
 * parses it. Comparing what a publisher sends with what a handler is given
 * therefore compares nothing until the wrapping is taken off, and taking it
 * off is data - a path and whether the message is text there - rather than
 * code per platform. The platforms' own tables live with the readers that know
 * them; this is only the shape every such table has.
 */
export interface Envelope {
  /** Keys from the top of what is handed over; {@link ELEMENT} steps into each element of a list. */
  readonly at: readonly string[];
  /** True when the message is text there, which the receiving code parses back into a shape. */
  readonly text: boolean;
  /**
   * Keys carried beside the message, for a wrapping that is handed on whole -
   * to another channel rather than to code - so that whatever reads it next
   * is compared with the wrapping and not with the message inside it.
   */
  readonly beside?: readonly string[];
}

/** The step into each element of a list. */
export const ELEMENT = '[]';

/**
 * The key of a node's `meta` saying how a delivery wraps what it hands over:
 * an {@link Envelope}, on a consumer a deployment declares, or on a call that
 * starts something by its deployed name.
 */
export const ENVELOPE_META = 'envelope';

/**
 * The key of an entry's `meta` saying what the code behind it takes from what
 * it is handed: type references by {@link envelopePath}, `''` for the whole of
 * it. A path whose message is text holds what the code parses it into.
 */
export const READS_META = 'reads';

/**
 * The key of an entry's `meta` set when what it reads is only part of what it
 * needs: the rest of what it is handed travels on whole, and later steps may
 * read it, so a key it does not read here is not one nobody reads.
 */
export const CARRIES_ON_META = 'carriesOn';

/** A path as the contract report spells a field: `Records[].body`. */
export const envelopePath = (at: readonly string[]): string =>
  at.reduce((path, step) => (step === ELEMENT ? `${path}${ELEMENT}` : path === '' ? step : `${path}.${step}`), '');

/** How far a value is followed back to the parameter it came from. */
const MOST_HOPS = 16;

/** Calls that hand each element of a list to the function they are given. */
const PER_ELEMENT = new Set(['map', 'forEach', 'filter', 'flatMap', 'some', 'every', 'find', 'findIndex']);

const parametersOf = (fn: TsNode): ParameterDeclaration[] =>
  Node.isFunctionDeclaration(fn) ||
  Node.isArrowFunction(fn) ||
  Node.isFunctionExpression(fn) ||
  Node.isMethodDeclaration(fn)
    ? fn.getParameters()
    : [];

/**
 * The path from a function's first parameter to an expression, or nothing
 * when the expression is not reached from it by keys, elements and names.
 *
 * `JSON.parse(record.body)` inside `for (const record of event.Records)` is
 * `Records[].body`; so is the same written with `.map(record => …)`, with a
 * destructured `{ body }`, or with `event.Records[0].body`.
 */
export const pathFrom = (expression: TsNode, parameter: ParameterDeclaration): string[] | undefined => {
  const walk = (node: TsNode, hops: number): string[] | undefined => {
    if (hops > MOST_HOPS) return undefined;
    if (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node)) {
      return walk(node.getExpression(), hops + 1);
    }
    // `record.body ?? '{}'` is the body when there is one.
    if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
      return walk(node.getLeft(), hops + 1);
    }
    if (Node.isPropertyAccessExpression(node)) {
      const above = walk(node.getExpression(), hops + 1);
      return above === undefined ? undefined : [...above, node.getName()];
    }
    if (Node.isElementAccessExpression(node)) {
      const above = walk(node.getExpression(), hops + 1);
      const key = node.getArgumentExpression();
      if (above === undefined || key === undefined) return undefined;
      if (Node.isNumericLiteral(key)) return [...above, ELEMENT];
      if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) return [...above, key.getLiteralValue()];
      return undefined;
    }
    if (!Node.isIdentifier(node)) return undefined;
    const declaration = node.getSymbol()?.getDeclarations()[0];
    return declaration === undefined ? undefined : bound(declaration, hops + 1);
  };

  /** Where a name gets its value from. */
  const bound = (declaration: TsNode, hops: number): string[] | undefined => {
    if (declaration === parameter) return [];
    if (Node.isBindingElement(declaration)) {
      const pattern = declaration.getParentOrThrow();
      const key = Node.isArrayBindingPattern(pattern)
        ? ELEMENT
        : (declaration.getPropertyNameNode()?.getText() ?? declaration.getName());
      const owner = pattern.getParent();
      const above = owner === undefined ? undefined : bound(owner, hops + 1);
      return above === undefined ? undefined : [...above, key];
    }
    if (Node.isVariableDeclaration(declaration)) {
      const loop = declaration.getParent()?.getParent();
      if (loop !== undefined && Node.isForOfStatement(loop)) {
        const above = walk(loop.getExpression(), hops + 1);
        return above === undefined ? undefined : [...above, ELEMENT];
      }
      const initializer = declaration.getInitializer();
      return initializer === undefined ? undefined : walk(initializer, hops + 1);
    }
    if (Node.isParameterDeclaration(declaration)) {
      // The first parameter of a function handed to `list.map(…)` is an element of the list.
      const fn = declaration.getParent();
      const call = fn?.getParent();
      if (fn === undefined || call === undefined || !Node.isCallExpression(call)) return undefined;
      if (parametersOf(fn)[0] !== declaration) return undefined;
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || !PER_ELEMENT.has(callee.getName())) return undefined;
      if (call.getArguments()[0] !== fn) return undefined;
      const above = walk(callee.getExpression(), hops + 1);
      return above === undefined ? undefined : [...above, ELEMENT];
    }
    return undefined;
  };

  return walk(expression, 0);
};

/** The type `JSON.parse(…)` is said to produce, by an assertion or by the variable it is stored in. */
const parsedAs = (call: TsNode): Type | undefined => {
  let node = call;
  let parent = node.getParent();
  while (parent !== undefined && Node.isParenthesizedExpression(parent)) {
    node = parent;
    parent = node.getParent();
  }
  if (parent !== undefined && Node.isAsExpression(parent)) return parent.getTypeNode()?.getType();
  if (parent !== undefined && Node.isVariableDeclaration(parent) && parent.getInitializer() === node) {
    return parent.getTypeNode()?.getType();
  }
  return undefined;
};

export const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((step, index) => step === b[index]);

/** The type at a path of keys and elements, or nothing where the path does not fit. */
const typeAtPath = (type: Type, at: readonly string[], site: TsNode): Type | undefined => {
  let current: Type | undefined = type;
  for (const step of at) {
    if (current === undefined) return undefined;
    if (step === ELEMENT) {
      current = current.getArrayElementType() ?? current.getNumberIndexType();
      continue;
    }
    current = current.getProperty(step)?.getTypeAtLocation(site);
  }
  return current;
};

/**
 * The type a function takes as its message, when its message is wrapped as the
 * envelope says.
 *
 * Read off the first parameter's declared type where the message is a value,
 * and off what the function parses it into where the message is text: an
 * assertion on `JSON.parse` at that path, or the declared type of the variable
 * it is stored in. Two different answers for one path are no answer, because
 * picking one would compare the message with half of what the code reads.
 */
export const messageTypeAt = (fn: TsNode, envelope: Envelope): Type | undefined => {
  const [parameter] = parametersOf(fn);
  if (parameter === undefined) return undefined;
  if (!envelope.text) return typeAtPath(parameter.getType(), envelope.at, fn);
  const found = new Map<string, Type>();
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'JSON.parse') continue;
    const [text] = call.getArguments();
    const path = text === undefined ? undefined : pathFrom(text, parameter);
    if (path === undefined || !sameKeys(path, envelope.at)) continue;
    const type = parsedAs(call);
    if (type !== undefined) found.set(type.getText(), type);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
};
