import {
  Node,
  VariableDeclarationKind,
  type CallExpression,
  type Decorator,
  type Node as TsNode,
} from 'ts-morph';

/**
 * Where a library writes the name of the thing a call is addressed to.
 *
 * Two halves of the graph ask this and they ask exactly the same question. A
 * stored collection is named in an argument of the call, in an argument of
 * another call in the same chain, on the receiver, in the type the receiver was
 * declared as, or on the decorator that provided the receiver. A channel is
 * named in precisely that list of places, which is why there is one list and not
 * two: two lists that agree today are one idea written twice, and the second
 * copy is the one that stops being updated.
 *
 * A locator says *where* the name is written and nothing about how the
 * expression found there becomes a name. That second half is not shared and must
 * not be: a collection's name is followed through the declaration that states
 * it, while an address is folded over the closed set of values a template hole
 * can hold and refused outright when it cannot be read. Keeping the two halves
 * apart is what lets one mechanism serve both and what keeps supporting one more
 * library a record rather than a parser.
 */
export type NameLocator =
  /** An argument of this call: `send('orders.created', body)`. */
  | { kind: 'argument'; index: number }
  /**
   * A property of an object argument: `send({ name: 'orders.created', data })`.
   *
   * The shape the house style of a large application converges on, and the one
   * an index alone can never reach. Reading the whole object instead is not a
   * near miss but a different answer: the record stringifies into a name nothing
   * at the other end of the wire could ever write (R83).
   */
  | { kind: 'argument-property'; index: number; key: string }
  /** An argument of the call named `method`, anywhere in this chain. */
  | { kind: 'chain-call'; method: string; index: number }
  /** An argument of the call this chain started from. */
  | { kind: 'chain-root-argument'; index: number }
  /** The expression the call was made on. */
  | { kind: 'receiver' }
  /** The declaration of the type the receiver was declared as. */
  | { kind: 'receiver-type' }
  /**
   * An argument of the base-constructor call in the receiver's declared type.
   *
   * One class per name, each handing the name to a shared base, is how a large
   * application wraps a library it uses everywhere: `queue.add(job)` says nothing
   * about which queue, and the class the receiver is typed as says it once, in the
   * `super(...)` every instance of it goes through. Nothing at the call site can
   * be read, and the name is not hidden — it is written down, one indirection
   * away, which is exactly what a locator is for.
   */
  | { kind: 'base-constructor-argument'; index: number }
  /**
   * The value a property is initialised to on the receiver's declared class.
   *
   * The other way a class per name states the name once: not by handing it to
   * `super(...)` but by setting a field the base reads,
   * `protected readonly collectionName = 'menuItems'`. The class itself first,
   * then each class it extends, so a name stated on an intermediate base is
   * found as readily as one on the leaf (R165).
   */
  | { kind: 'receiver-type-property'; key: string }
  /**
   * An argument of the decorator on whatever provided the receiver.
   *
   * A receiver handed to a class through its constructor carries no name at the
   * call site at all: the name was written once, on the parameter that asked for
   * it. Reading it is the same question as every other locator's — which
   * expression holds the name — asked of a node the caller resolved rather than
   * of one reachable from the call.
   */
  | { kind: 'provider-decorator'; decorator: string; index: number };

/**
 * Whether a method name is one of the library's own operations.
 *
 * The one thing a locator needs from the description it belongs to, and the
 * reason it is asked rather than assumed: `connect('users').first()` and
 * `connect.count('*').first()` are the same shape and only the first of them
 * starts from a name. What tells them apart is that `count` is an operation and
 * `connect` is not.
 */
export type IsOperation = (method: string) => boolean;

/**
 * What the locators are allowed to ask about the site they are reading.
 *
 * Everything reachable from the call is read here; everything that needed
 * resolving is the caller's answer rather than one worked out here, because
 * resolving a type or an injection is work the reader has already done by the
 * time a call is being classified.
 */
export interface LocatorContext {
  /** Answers no for everything when the description has no operations. */
  readonly isOperation?: IsOperation;
  /** Declaration of the receiver's type, when the caller resolved one. */
  readonly typeDeclaration?: TsNode | undefined;
  /** Declaration that provided the receiver — a parameter, when there is one. */
  readonly providerDeclaration?: TsNode | undefined;
}

/**
 * What a locator reads.
 *
 * A call, or a decorator — which is a call that happens to be written with an
 * `@`. Both carry arguments, and an argument or one of its properties is where
 * most descriptions put the name, so accepting either is what lets the shape a
 * publishing call writes and the shape a handler's decorator writes be described
 * in one vocabulary instead of two. Only a call has a receiver and a chain; a
 * locator that asks a decorator for one gets nothing, which is the right answer.
 */
export type LocatorSite = CallExpression | Decorator;

/** How far a walk of nested expressions goes before it gives up. */
const MOST_LINKS = 32;

const argumentsOf = (site: LocatorSite): TsNode[] => site.getArguments();

/**
 * The outermost expression of the chain a call belongs to.
 *
 * A chain is read from whichever of its links the operation happened to be on,
 * and the name can be on a link before or after that one, so the search starts
 * from the top and works down rather than from the call in one direction.
 */
const chainTop = (call: CallExpression): TsNode => {
  let top: TsNode = call;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    const parent = top.getParent();
    if (parent === undefined) return top;
    const links =
      (Node.isPropertyAccessExpression(parent) || Node.isCallExpression(parent)) &&
      parent.getExpression() === top;
    if (!links) return top;
    top = parent;
  }
  return top;
};

/**
 * Every call in one chain, outermost first.
 *
 * The step down is from a call or a property access to what it was made on,
 * which is what makes `a().b().c()` three calls of one chain and `a(b()).c()`
 * two chains.
 */
const chainCalls = (call: CallExpression): CallExpression[] => {
  const calls: CallExpression[] = [];
  let current: TsNode = chainTop(call);
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    if (Node.isCallExpression(current)) {
      calls.push(current);
      current = current.getExpression();
      continue;
    }
    if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }
    // A link kept in a constant is still a link of the chain:
    // `const users = db.collection('users'); users.find()` names the collection
    // exactly as `db.collection('users').find()` does. Only a `const` with no
    // annotation, because a binding that can be reassigned, or that states its
    // own type, is not the call it was first given (R165).
    const bound = Node.isIdentifier(current) ? constInitialiser(current) : undefined;
    if (bound !== undefined) {
      current = bound;
      continue;
    }
    return calls;
  }
  return calls;
};

/** What a name was bound to, when it is an unannotated `const` bound once. */
const constInitialiser = (name: TsNode): TsNode | undefined => {
  const symbol = name.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getTypeNode() !== undefined) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return undefined;
  }
  const initialiser = declaration.getInitializer();
  return initialiser !== undefined && Node.isCallExpression(initialiser) ? initialiser : undefined;
};

/**
 * The argument of the call named `method`, anywhere in this chain.
 *
 * `db.select().from(orders)` and `db.select('id').from('users').first()` are the
 * same fact reached from two different links: in the first the operation is
 * before the `from` and in the second it is after it. Searching the whole chain
 * rather than one direction is what reads both, and it is how one real
 * repository — where every query is written the second way — stopped reporting
 * the selected column as the name.
 */
const chainArgument = (
  call: CallExpression,
  method: string,
  index: number,
): TsNode | undefined => {
  for (const each of chainCalls(call)) {
    const callee = each.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== method) continue;
    const argument = each.getArguments()[index];
    if (argument !== undefined) return argument;
  }
  return undefined;
};

/**
 * The call a chain of method calls started from, when it started somewhere else.
 *
 * `db('orders').where({ id }).first()` names the thing in the call that made the
 * builder, however many methods were chained onto it afterwards. Walking down the
 * receivers until one is not itself a call is what finds it without caring which
 * methods were in between.
 *
 * The step is "a call made on a call", not "a call made on a property": the
 * builder is as often reached through `this.db(...)` as through a bare `db`, and
 * a walk that treated `this.db` as another link of the chain walked past the root
 * and off the end of every real query.
 *
 * A root that is itself an operation is no root. `db.count('*').first()` ends its
 * walk at the `count`, and reading that call's first argument reported the
 * counted column as a name — a name that looks like an answer and is not, which
 * is worse than saying nothing. The connection a real chain starts from is
 * invoked rather than called by name, so its callee is never an operation.
 */
const chainRoot = (
  call: CallExpression,
  isOperation: IsOperation,
): CallExpression | undefined => {
  let current = call;
  for (let depth = 0; depth < MOST_LINKS / 2; depth += 1) {
    const callee = current.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    const receiver = callee.getExpression();
    if (!Node.isCallExpression(receiver)) break;
    current = receiver;
  }
  if (current === call) return undefined;
  const callee = current.getExpression();
  const named = Node.isPropertyAccessExpression(callee) ? callee.getName() : null;
  return named !== null && isOperation(named) ? undefined : current;
};

const receiverOf = (site: LocatorSite): TsNode | undefined => {
  if (!Node.isCallExpression(site)) return undefined;
  const callee = site.getExpression();
  return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
};

/**
 * What an object literal states under one key.
 *
 * A shorthand property is the answer as readily as a written one: `{ name, data }`
 * says the same thing `{ name: name, data: data }` says, and the name node is an
 * identifier the caller resolves exactly as it resolves any other.
 */
const propertyOf = (node: TsNode | undefined, key: string): TsNode | undefined => {
  if (node === undefined || !Node.isObjectLiteralExpression(node)) return undefined;
  const property = node.getProperty(key);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
};

/**
 * The argument the base constructor of a class is called with.
 *
 * The constructor of the class itself first, and its base's if it declares none:
 * a subclass without a constructor inherits the one above it, and the `super`
 * call that states the name is then written a level up. Bounded, because a chain
 * of bases is a chain and a cycle in one would otherwise not end.
 */
const baseConstructorArgument = (
  declaration: TsNode | undefined,
  index: number,
): TsNode | undefined => {
  let current = declaration;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === undefined || !Node.isClassDeclaration(current)) return undefined;
    for (const constructor of current.getConstructors()) {
      const body = constructor.getBody();
      if (body === undefined) continue;
      let found: TsNode | undefined;
      body.forEachDescendant((node, traversal) => {
        if (!Node.isCallExpression(node)) return;
        if (!Node.isSuperExpression(node.getExpression())) return;
        found = node.getArguments()[index];
        traversal.stop();
      });
      if (found !== undefined) return found;
    }
    current = current.getBaseClass();
  }
  return undefined;
};

/**
 * What a property of a class, or of a class it extends, is initialised to.
 *
 * The nearest declaration wins, because that is the one an instance holds: a
 * subclass that sets the field overrides the base that declared it. A property
 * declared with no initialiser - the base's `abstract readonly` - says nothing,
 * so the walk goes on past it. Bounded like the constructor walk above.
 */
const classPropertyValue = (
  declaration: TsNode | undefined,
  key: string,
): TsNode | undefined => {
  let current = declaration;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === undefined || !Node.isClassDeclaration(current)) return undefined;
    const initialiser = current.getProperty(key)?.getInitializer();
    if (initialiser !== undefined) return initialiser;
    current = current.getBaseClass();
  }
  return undefined;
};

const decoratorArgument = (
  declaration: TsNode | undefined,
  name: string,
  index: number,
): TsNode | undefined => {
  if (declaration === undefined || !Node.isDecoratable(declaration)) return undefined;
  const decorator = declaration.getDecorator(name);
  return decorator?.getArguments()[index];
};

type LocatorResolvers = {
  [K in NameLocator['kind']]: (
    site: LocatorSite,
    locator: Extract<NameLocator, { kind: K }>,
    context: LocatorContext,
  ) => TsNode | undefined;
};

const never: IsOperation = () => false;

const resolvers: LocatorResolvers = {
  argument: (site, locator) => argumentsOf(site)[locator.index],
  'argument-property': (site, locator) =>
    propertyOf(argumentsOf(site)[locator.index], locator.key),
  'chain-call': (site, locator) =>
    Node.isCallExpression(site) ? chainArgument(site, locator.method, locator.index) : undefined,
  'chain-root-argument': (site, locator, context) =>
    Node.isCallExpression(site)
      ? chainRoot(site, context.isOperation ?? never)?.getArguments()[locator.index]
      : undefined,
  receiver: (site) => receiverOf(site),
  // Not an expression at all, but the declaration one was resolved to. A method
  // called on an instance — `document.save()` — writes nothing about a name
  // anywhere in the call, and the class the instance is typed as is where the
  // name is stated. A reader that takes a declaration as readily as an
  // expression naming one meets this path immediately.
  'receiver-type': (_site, _locator, context) => context.typeDeclaration,
  'base-constructor-argument': (_site, locator, context) =>
    baseConstructorArgument(context.typeDeclaration, locator.index),
  'receiver-type-property': (_site, locator, context) =>
    classPropertyValue(context.typeDeclaration, locator.key),
  'provider-decorator': (_site, locator, context) =>
    decoratorArgument(context.providerDeclaration, locator.decorator, locator.index),
};

// One cast, because a key and the map it indexes cannot be narrowed together.
// The map above is exhaustive and typed per kind, which is where the checking
// that matters happens.
const expressionFor = (
  site: LocatorSite,
  locator: NameLocator,
  context: LocatorContext,
): TsNode | undefined =>
  (
    resolvers[locator.kind] as (
      s: LocatorSite,
      l: NameLocator,
      c: LocatorContext,
    ) => TsNode | undefined
  )(site, locator, context);

/**
 * Every expression this site's locators point at, in the order they were listed.
 *
 * A list rather than a name, because what a name is differs between the callers
 * and the order does not. One description may hold several locators because one
 * library writes the name in several places — in the call itself when it writes
 * and in the next call of the chain when it reads — and the caller takes the
 * first of these expressions it can make a name of. Which is why the order the
 * description lists them in is the description's to decide and is preserved
 * here: asking the wrong one first is how a reader reports a column as a table
 * or a payload as a channel.
 *
 * A locator that points at nothing contributes nothing, so the list is shorter
 * than the locators whenever the code does not write what the description
 * expected. An empty list means the description reached nothing here at all.
 */
export const locatedExpressions = (
  site: LocatorSite,
  locators: readonly NameLocator[],
  context: LocatorContext = {},
): TsNode[] => {
  const found: TsNode[] = [];
  for (const locator of locators) {
    const expression = expressionFor(site, locator, context);
    if (expression !== undefined) found.push(expression);
  }
  return found;
};
