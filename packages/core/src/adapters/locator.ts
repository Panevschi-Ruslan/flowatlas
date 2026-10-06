import {
  Node,
  VariableDeclarationKind,
  type CallExpression,
  type Decorator,
  type NewExpression,
  type Node as TsNode,
  type ObjectLiteralExpression,
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
  | { kind: 'provider-decorator'; decorator: string; index: number }
  /**
   * A path of properties inside an argument of this call.
   *
   * `argument-property` reaches one key in; a client whose input is a record of
   * records writes the name two and three keys in, often inside a list:
   * `put({ Entries: [{ DetailType: 'LoanCreated' }] })`. A step written `*` is
   * every element of an array, and each element is a name of its own — a list
   * of three entries is three addresses, not one address and two leftovers.
   */
  | { kind: 'argument-path'; index: number; path: readonly string[] }
  /**
   * A path of properties inside what a class is constructed with, where the
   * construction is an argument of this call.
   *
   * A client that sends commands is handed `new SendCommand({ ... })`, built in
   * the call or in a constant a statement earlier, and the name is inside the
   * command's input. `index` is the argument of the *constructor* the path
   * starts in, the first by default.
   *
   * Naming the class makes this locator a condition as well as a place: a call
   * handed some other command has no address of this shape at all, which is
   * different from an address that could not be read. `locatorApplies` is that
   * question.
   */
  | { kind: 'constructed-argument-path'; class: string; path: readonly string[]; index?: number }
  /**
   * A path inside an argument of the earlier call that produced a value this
   * call is handed.
   *
   * A helper that records what to start in one call and starts it in the next -
   * `const run = await orchestrator.create({ process: Process.LoanApproval });
   * await orchestrator.start({ runId: run.id })` - writes the name one call
   * before the call that acts on it, and the second call's arguments hold only
   * an id. `call` is the method or function that produced the value, made on
   * the same receiver or imported from the same module as this call; `index` is
   * its argument the path starts in, the first by default. Followed only
   * through `const` bindings in the body this call is written in, and only to
   * one such call: anything else reaches nothing, which a reader reports as a
   * name it could not read rather than guessing at (R171).
   */
  | { kind: 'origin-call-argument'; call: string; path: readonly string[]; index?: number };

/**
 * What one locator found at one element of the address.
 *
 * `reached` is false where the walk stopped short of the end of the path: the
 * value there is not written out — a parameter, a call, a spread — and
 * `expression` is the place it stopped. A name read from there is a refusal
 * naming that place, which is the honest answer; a payload read from there
 * would be the type of something else, so a reader of payloads asks `reached`.
 *
 * `undefined` is a path that ended at a record which does not have the key:
 * nothing is written there, which a description may fill with what the library
 * does when it is left out.
 */
export type LocatedSlot = { readonly expression: TsNode; readonly reached: boolean } | undefined;

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

/** One step of a path that stands for every element of an array. */
export const EVERY_ELEMENT = '*';

const stopped = (expression: TsNode): LocatedSlot => ({ expression, reached: false });

/**
 * The value a `const` was bound to, for a name that is one.
 *
 * A shorthand property names the variable it copies, which the checker answers
 * as a symbol of its own; asking the property's symbol would answer with the
 * property. An annotation is no reason to stop here, unlike in a chain: the
 * value is still the one written, whatever the binding says its type is.
 */
const constValue = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent)
      ? parent.getValueSymbol()
      : node.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return undefined;
  }
  return declaration.getInitializer();
};

/**
 * What a value is written as, past what does not change it.
 *
 * Parentheses and the assertions TypeScript lets a value carry say nothing about
 * the value, and a `const` names the value it was bound to once and for good.
 * Asked only of the records and lists a path walks through: the name at the end
 * of a path is handed over as it is written, because whether it is a literal, a
 * constant or a member of a shared enum is a fact its reader wants to know.
 */
const writtenValue = (node: TsNode): TsNode => {
  let current = node;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    const bound = constValue(current);
    if (bound === undefined) return current;
    current = bound;
  }
  return current;
};

/** A key as the source spells it, with any quotes taken off. */
const keyOf = (name: string): string => name.replace(/^['"`]|['"`]$/g, '');

/**
 * What an object literal holds under one key, read the way the language reads it.
 *
 * The last property written wins, so the walk is from the end. A spread or a
 * computed key met before the key is found may be where the key comes from, and
 * nothing here can say: the walk stops there rather than calling the key absent,
 * because "absent" lets a description fill in a default, and filling in a
 * default for a key a spread supplies is a guess.
 */
const writtenProperty = (record: ObjectLiteralExpression, key: string): LocatedSlot => {
  const properties = record.getProperties();
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];
    if (property === undefined) continue;
    if (Node.isSpreadAssignment(property)) return stopped(property.getExpression());
    const nameNode = property.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) return stopped(nameNode);
    if (keyOf(nameNode.getText()) !== key) continue;
    if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      return initializer === undefined ? stopped(property) : { expression: initializer, reached: true };
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      return { expression: property.getNameNode(), reached: true };
    }
    // A method or an accessor computes the value when it is asked for.
    return stopped(property);
  }
  return undefined;
};

/** One step into what a slot holds. */
const stepInto = (expression: TsNode, step: string): LocatedSlot[] => {
  const value = writtenValue(expression);
  if (step === EVERY_ELEMENT) {
    if (!Node.isArrayLiteralExpression(value)) return [stopped(expression)];
    return value
      .getElements()
      .map((element) =>
        Node.isSpreadElement(element) ? stopped(element) : { expression: element, reached: true },
      );
  }
  if (!Node.isObjectLiteralExpression(value)) return [stopped(expression)];
  return [writtenProperty(value, step)];
};

/**
 * Every place a path of properties reaches from one expression, in order.
 *
 * One slot per element wherever the path says `*`, so the result is as long as
 * the lists it went through. A slot that stopped stays where it stopped for the
 * rest of the path, and an absent key stays absent: both are answers about that
 * element, and dropping them would shift every later element onto the wrong
 * index of a sibling path walked over the same list.
 */
const walkPath = (start: TsNode, path: readonly string[]): LocatedSlot[] => {
  let slots: LocatedSlot[] = [{ expression: start, reached: true }];
  for (const step of path) {
    slots = slots.flatMap((slot) =>
      slot === undefined || !slot.reached ? [slot] : stepInto(slot.expression, step),
    );
  }
  return slots;
};

/** The name a `new` expression constructs, as written: `X` in `new X()` and in `new sdk.X()`. */
const constructedName = (construction: NewExpression): string | undefined => {
  const callee = construction.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/**
 * The argument of this call that is an instance of a class, by the class's name.
 *
 * Written as a construction — in the call, or in a `const` a statement earlier —
 * it is the construction, and its input can be walked. Anything else the checker
 * says is an instance of the class is still one, handed in from somewhere this
 * cannot see: the call is of the described shape, and its address is not
 * written here.
 */
const instanceArgument = (site: LocatorSite, className: string): TsNode | undefined => {
  const written = argumentsOf(site);
  for (const argument of written) {
    const value = writtenValue(argument);
    if (Node.isNewExpression(value) && constructedName(value) === className) return value;
  }
  return written.find(
    (argument) =>
      argument.getType().getSymbol()?.getName() === className || annotatedName(argument) === className,
  );
};

/**
 * The class a name's declaration is annotated with, as written.
 *
 * What the checker says when the class's package is installed, and the one
 * thing the source still says when it is not: `(command: SendCommand)`
 * names the class whether or not anything declares it.
 */
const annotatedName = (argument: TsNode): string | undefined => {
  if (!Node.isIdentifier(argument)) return undefined;
  const declaration = argument.getSymbol()?.getDeclarations()[0];
  const annotation =
    declaration !== undefined && (Node.isParameterDeclaration(declaration) || Node.isVariableDeclaration(declaration))
      ? declaration.getTypeNode()
      : undefined;
  if (annotation === undefined || !Node.isTypeReference(annotation)) return undefined;
  return annotation.getTypeName().getText().split('.').pop();
};

const one = (expression: TsNode | undefined): LocatedSlot[] =>
  expression === undefined ? [] : [{ expression, reached: true }];

/**
 * Where a value handed to a call was made: the call whose result it is, or is
 * read from, within the body the call is written in.
 */
export interface ValueOrigin {
  /** The call that produced the value. */
  readonly call: CallExpression;
  /** The properties read off that call's result to reach the value: `['id']` for `run.id`. */
  readonly read: readonly string[];
  /** The value as it is written where it is handed over. */
  readonly value: TsNode;
}

/** The body a node is written in: the nearest function, or the file. */
const bodyOf = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor(
    (ancestor) =>
      Node.isFunctionLikeDeclaration(ancestor) || Node.isFunctionExpression(ancestor) || Node.isSourceFile(ancestor),
  );

const isConst = (declaration: TsNode): boolean =>
  Node.isVariableDeclaration(declaration) &&
  declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const;

/**
 * One `const` step back from a name: what it was bound to, and the property a
 * destructuring took off that, in the body given and nowhere else.
 */
const constStep = (name: TsNode, body: TsNode | undefined): { value: TsNode; read?: string } | undefined => {
  const parent = name.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent) ? parent.getValueSymbol() : name.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined || bodyOf(declaration) !== body) return undefined;
  if (isConst(declaration) && Node.isVariableDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode())) {
    const value = declaration.getInitializer();
    return value === undefined ? undefined : { value };
  }
  // `const { id } = await create(...)`: one level of a record taken apart.
  if (!Node.isBindingElement(declaration) || declaration.getDotDotDotToken() !== undefined) return undefined;
  const variable = declaration.getParent().getParent();
  if (!Node.isObjectBindingPattern(declaration.getParent()) || !isConst(variable) || !Node.isVariableDeclaration(variable)) {
    return undefined;
  }
  const value = variable.getInitializer();
  const key = declaration.getPropertyNameNode();
  if (value === undefined || (key !== undefined && !Node.isIdentifier(key))) return undefined;
  return { value, read: key?.getText() ?? declaration.getName() };
};

/** The call one value comes from, through property reads and `const` bindings in `body`. */
const originOf = (value: TsNode, body: TsNode | undefined): ValueOrigin | undefined => {
  const read: string[] = [];
  let current = value;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isAwaitExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    if (Node.isPropertyAccessExpression(current)) {
      read.unshift(current.getName());
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current)) return { call: current, read, value };
    if (!Node.isIdentifier(current)) return undefined;
    const step = constStep(current, body);
    if (step === undefined) return undefined;
    if (step.read !== undefined) read.unshift(step.read);
    current = step.value;
  }
  return undefined;
};

/** Every value written in an argument: the argument, or each value a record or a list written out holds. */
const handedValues = (argument: TsNode, depth = 0): TsNode[] => {
  if (depth > 4) return [];
  if (Node.isObjectLiteralExpression(argument)) {
    return argument.getProperties().flatMap((property) => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer === undefined ? [] : handedValues(initializer, depth + 1);
      }
      if (Node.isShorthandPropertyAssignment(property)) return [property.getNameNode()];
      return [];
    });
  }
  if (Node.isArrayLiteralExpression(argument)) {
    return argument.getElements().flatMap((element) => handedValues(element, depth + 1));
  }
  return [argument];
};

/**
 * Every value this call is handed that a call before it, in the same body,
 * produced.
 *
 * `start({ runId: run.id })` is handed `run.id`, read off what
 * `const run = await create(...)` produced. Only `const` bindings are followed,
 * because a binding that can be reassigned is not the call it was first given,
 * and only in the body the call is written in, because past it the value is a
 * parameter some other call decides.
 */
export const originsOf = (site: CallExpression): ValueOrigin[] => {
  const body = bodyOf(site);
  return site
    .getArguments()
    .flatMap((argument) => handedValues(argument))
    .flatMap((value) => {
      const origin = originOf(value, body);
      return origin === undefined || origin.call === site ? [] : [origin];
    });
};

/**
 * What a call is made by: its method and receiver, or the function and where
 * it comes from - the module it is imported from, or the file declaring it.
 */
const makerOf = (call: CallExpression): { name: string; on: TsNode | undefined; from?: string } | undefined => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return { name: callee.getName(), on: callee.getExpression() };
  if (!Node.isIdentifier(callee)) return undefined;
  const declaration = callee.getSymbol()?.getDeclarations()[0];
  if (declaration !== undefined && Node.isImportSpecifier(declaration)) {
    return {
      name: declaration.getName(),
      on: undefined,
      from: declaration.getImportDeclaration().getModuleSpecifierValue(),
    };
  }
  return { name: callee.getText(), on: undefined, from: declaration?.getSourceFile().getFilePath() };
};

/** Whether two receivers are one: the same symbol, or the same text where neither resolves. */
const sameReceiver = (left: TsNode, right: TsNode): boolean => {
  const [a, b] = [left.getSymbol(), right.getSymbol()];
  return a !== undefined || b !== undefined ? a === b : left.getText() === right.getText();
};

/** Whether `producer` is the call named `name` made through what `site` is made through. */
const madeAlongside = (producer: CallExpression, site: CallExpression, name: string): boolean => {
  const [made, by] = [makerOf(producer), makerOf(site)];
  if (made === undefined || by === undefined || made.name !== name) return false;
  if (made.on !== undefined && by.on !== undefined) return sameReceiver(made.on, by.on);
  return made.on === undefined && by.on === undefined && made.from !== undefined && made.from === by.from;
};

/**
 * The one described call that produced a value this call is handed.
 *
 * Two different calls of that name are two candidates, and choosing between
 * them is a guess, so the answer is then nothing.
 */
const producingCall = (site: CallExpression, name: string): CallExpression | undefined => {
  const producers = new Set(
    originsOf(site)
      .map((origin) => origin.call)
      .filter((call) => madeAlongside(call, site, name)),
  );
  return producers.size === 1 ? [...producers][0] : undefined;
};

type LocatorResolvers = {
  [K in NameLocator['kind']]: (
    site: LocatorSite,
    locator: Extract<NameLocator, { kind: K }>,
    context: LocatorContext,
  ) => readonly LocatedSlot[];
};

const never: IsOperation = () => false;

const resolvers: LocatorResolvers = {
  argument: (site, locator) => one(argumentsOf(site)[locator.index]),
  'argument-property': (site, locator) =>
    one(propertyOf(argumentsOf(site)[locator.index], locator.key)),
  'chain-call': (site, locator) =>
    one(Node.isCallExpression(site) ? chainArgument(site, locator.method, locator.index) : undefined),
  'chain-root-argument': (site, locator, context) =>
    one(
      Node.isCallExpression(site)
        ? chainRoot(site, context.isOperation ?? never)?.getArguments()[locator.index]
        : undefined,
    ),
  receiver: (site) => one(receiverOf(site)),
  // Not an expression at all, but the declaration one was resolved to. A method
  // called on an instance — `document.save()` — writes nothing about a name
  // anywhere in the call, and the class the instance is typed as is where the
  // name is stated. A reader that takes a declaration as readily as an
  // expression naming one meets this path immediately.
  'receiver-type': (_site, _locator, context) => one(context.typeDeclaration),
  'base-constructor-argument': (_site, locator, context) =>
    one(baseConstructorArgument(context.typeDeclaration, locator.index)),
  'receiver-type-property': (_site, locator, context) =>
    one(classPropertyValue(context.typeDeclaration, locator.key)),
  'provider-decorator': (_site, locator, context) =>
    one(decoratorArgument(context.providerDeclaration, locator.decorator, locator.index)),
  'argument-path': (site, locator) => {
    const argument = argumentsOf(site)[locator.index];
    return argument === undefined ? [] : walkPath(argument, locator.path);
  },
  'constructed-argument-path': (site, locator) => {
    const instance = instanceArgument(site, locator.class);
    if (instance === undefined) return [];
    if (!Node.isNewExpression(instance)) return [stopped(instance)];
    const input = instance.getArguments()[locator.index ?? 0];
    return input === undefined ? [undefined] : walkPath(input, locator.path);
  },
  'origin-call-argument': (site, locator) => {
    const producer = Node.isCallExpression(site) ? producingCall(site, locator.call) : undefined;
    const argument = producer?.getArguments()[locator.index ?? 0];
    if (argument === undefined) return [];
    // A path that stopped short stopped at something this body does not write -
    // a parameter, a spread - and a reader handed it would follow it out to
    // whoever called this body, which is further than this locator reaches.
    const slots = walkPath(argument, locator.path);
    return slots.some((slot) => slot !== undefined && !slot.reached) ? [] : slots;
  },
};

/**
 * Every place one locator reaches at this site, one per element of the address.
 *
 * Most locators reach one place or none. A path through a list reaches one per
 * element, and the caller reads each as an address of its own; two paths
 * through the same list — the name and the message of each entry — line up by
 * index, which is why a slot that reached nothing is kept rather than dropped.
 */
export const locatedSlots = (
  site: LocatorSite,
  locator: NameLocator,
  context: LocatorContext = {},
): readonly LocatedSlot[] =>
  // One cast, because a key and the map it indexes cannot be narrowed together.
  // The map above is exhaustive and typed per kind, which is where the checking
  // that matters happens.
  (
    resolvers[locator.kind] as (
      s: LocatorSite,
      l: NameLocator,
      c: LocatorContext,
    ) => readonly LocatedSlot[]
  )(site, locator, context);

/**
 * Whether the shape a locator describes is present at this site at all.
 *
 * Every locator but one is a place and nothing more, and applies wherever its
 * pattern matched. A locator naming the class an argument is constructed from
 * is also a condition: a client that sends commands sends every kind of them
 * through one method, and a call sending another kind is not an address
 * written somewhere unreadable — it is not this kind of call. Asked before a
 * call is read, so that a call it does not apply to produces nothing rather
 * than a row about a name it never had.
 */
export const locatorApplies = (site: LocatorSite, locator: NameLocator): boolean =>
  locator.kind !== 'constructed-argument-path' || instanceArgument(site, locator.class) !== undefined;

/** Whether a locator is a condition on the call as well as a place in it. */
export const locatorIsCondition = (locator: NameLocator): boolean =>
  locator.kind === 'constructed-argument-path';

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
 * A path through a list contributes every element it reached, in order; a
 * reader that needs each element as an address of its own asks `locatedSlots`.
 */
export const locatedExpressions = (
  site: LocatorSite,
  locators: readonly NameLocator[],
  context: LocatorContext = {},
): TsNode[] =>
  locators
    .flatMap((locator) => locatedSlots(site, locator, context))
    .flatMap((slot) => (slot === undefined ? [] : [slot.expression]));
