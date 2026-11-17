import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type ClassDeclaration,
  type ClassExpression,
  type Decorator,
  type NewExpression,
  type Node as TsNode,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type PropertyDeclaration,
  type VariableDeclaration,
} from 'ts-morph';
import { classMembersOf } from '../di/class-members.js';
import { functionOf, methodNamedOn } from '../di/member-call.js';
import { evaluateExpression } from '../static-value.js';
import { registryOf } from '../stated-origin.js';
import { callSitesOf, returnedExpression } from '../trace.js';

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
  | {
      kind: 'argument-property';
      index: number;
      key: string;
      /**
       * The argument that names the value where the call hands no object at
       * `index`, or one written out without `key` and with nothing spread into
       * it: `upsertJobScheduler(id, repeat, { data })` names its job by the
       * scheduler's id (P298). An object the call holds in a name, or one with
       * a spread, may carry the key, and is read as it always was.
       */
      otherwise?: number;
    }
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
   * `protected readonly collectionName = 'products'`. The class itself first,
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
   * A key of a tree written in an argument, at its root and at every node
   * under it: `add({ name, queueName, children: [{ queueName, … }] })`, one
   * address per node, the root first and each child after its parent (P286).
   * `children` is the key a node keeps the nodes under it in.
   */
  | { kind: 'argument-tree'; index: number; key: string; children: string; path?: readonly string[] }
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
  | { kind: 'origin-call-argument'; call: string; path: readonly string[]; index?: number }
  /**
   * A path inside what the receiver was constructed with.
   *
   * A helper built for one operation and then run - `new Upload({ client,
   * params: { Bucket, Key } }).done()` - is told where it acts when it is made,
   * and the call that acts says nothing. Followed through `const` bindings,
   * as a command a statement earlier is; a receiver made any other way reaches
   * nothing here (P52). `index` is the constructor's argument the path starts
   * in, the first by default.
   */
  | { kind: 'receiver-constructed-path'; class: string; path: readonly string[]; index?: number }
  /**
   * The key the receiver is looked up by in a registry whose every entry is
   * constructed with its own key.
   *
   * A service that keeps one client per queue writes the queue once, where
   * the client is made - `this.queues[name] = new Queue(name)` - and every
   * call after that is made on `this.queues[name]`, so the key the call looks
   * the client up by is the name the client was made with. Only where every
   * write into the registry the class or module makes is such a construction,
   * with the argument at `index` (the first by default) the very key it is
   * stored under; a registry filled any other way reaches nothing here (P267).
   */
  | { kind: 'receiver-registry-key'; class: string; index?: number };

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
export type LocatedSlot =
  | {
      readonly expression: TsNode;
      readonly reached: boolean;
      /**
       * A key written as a bare word, `{ orders: [...] }` or `{ orders }`: it
       * names itself, as text, and is no expression of anything (P55).
       */
      readonly key?: string;
      /**
       * Where the walk stopped at a member of a record of values or factories
       * chosen by a parameter of the function the call is written in -
       * `events[name](data)` - or at a record that parameter is, that
       * parameter (P268). Which record is decided by whoever calls the
       * function, and a reader that follows the parameter out to each caller
       * reads the slot again there, with the parameter
       * {@link LocatorContext.bound bound} to what that caller hands it.
       */
      readonly selector?: ParameterDeclaration;
      /** The parameters the walk bound on its way here, which what is left of the path is read with. */
      readonly bound?: Bindings;
      /**
       * Where the walk stopped short, the steps of the path it did not take,
       * the one it stopped at first (P286): a reader that follows the place
       * it stopped at - a parameter out to its callers - reads them there.
       */
      readonly rest?: readonly string[];
      /**
       * The field the value was read out of, where a name may stand for
       * several classes each declaring the field of its own (P332):
       * `Queues.mail`, one slot per class.
       */
      readonly heldIn?: string;
    }
  | undefined;

/**
 * Values handed to parameters, by the parameter's declaration: what a caller
 * passes a function the walk reads inside, and what a factory the walk steps
 * into is called with (P268).
 */
export type Bindings = ReadonlyMap<TsNode, TsNode>;

const NO_BINDINGS: Bindings = new Map();

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
  /**
   * What parameters of the function the call is written in are handed, by a
   * caller the reader followed one out to (P268): a member chosen by one of
   * them is then the member that caller chooses.
   */
  readonly bound?: Bindings;
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
  // One helper per chain: what a helper hands out is read, and a helper that
  // hands out another helper's answer is further than this follows (P88).
  let stepped = false;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    if (Node.isCallExpression(current)) {
      calls.push(current);
      const handed: TsNode | undefined = stepped ? undefined : helperAnswer(current);
      stepped ||= handed !== undefined;
      current = handed ?? current.getExpression();
      continue;
    }
    if (Node.isPropertyAccessExpression(current)) {
      const handed: TsNode | undefined = stepped ? undefined : getterAnswer(current);
      stepped ||= handed !== undefined;
      current = handed ?? current.getExpression();
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

/** The class a node is written in, and each class it extends, nearest first. */
const classesAround = (node: TsNode): ClassDeclaration[] => {
  const chain: ClassDeclaration[] = [];
  let current = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  while (current !== undefined && chain.length < 8) {
    chain.push(current);
    current = current.getBaseClass();
  }
  return chain;
};

/** Whether an expression mentions any of a function's parameters. */
const mentionsParameter = (expression: TsNode, parameters: readonly TsNode[]): boolean =>
  parameters.length > 0 &&
  [expression, ...expression.getDescendantsOfKind(SyntaxKind.Identifier)].some((node) => {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    return declaration !== undefined && parameters.includes(declaration);
  });

/**
 * What a same-class helper called as a link of a chain hands out: the one
 * expression `this.coll()` returns, so that `this.coll().find()` is read as
 * `this.db.collection(COMMENTS).find()` is (P88).
 *
 * A helper with no arguments is `returnedExpression`'s case. One handed only
 * constants is read too, when what it returns mentions none of its
 * parameters: then the arguments cannot change the answer. A helper that
 * builds its answer from a parameter - `coll(name)` - is a table chosen by its
 * caller, and nothing is handed out.
 */
const helperAnswer = (link: CallExpression): TsNode | undefined => {
  const callee = link.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !Node.isThisExpression(callee.getExpression())) {
    return undefined;
  }
  const written = link.getArguments();
  if (written.length === 0) return returnedExpression(link) ?? undefined;
  if (!written.every((argument) => evaluateExpression(argument).resolved)) return undefined;
  for (const owner of classesAround(link)) {
    const method = methodNamedOn(owner, callee.getName());
    const fn = method === undefined ? undefined : functionOf(method);
    if (fn === undefined) continue;
    const body = fn.getBody();
    if (body === undefined) continue;
    const answer = Node.isBlock(body) ? soleReturn(body) : body;
    if (answer === undefined) return undefined;
    return mentionsParameter(answer, fn.getParameters()) ? undefined : answer;
  }
  return undefined;
};

/** The expression a body returns when its only statement is that return. */
const soleReturn = (body: TsNode): TsNode | undefined => {
  if (!Node.isBlock(body)) return undefined;
  const [only, ...rest] = body.getStatements();
  if (only === undefined || rest.length > 0 || !Node.isReturnStatement(only)) return undefined;
  return only.getExpression();
};

/**
 * What a getter of the same class read as a link of a chain hands out:
 * `this.collection.find()` over `get collection() { return
 * this.db.collection(COMMENTS) }` (P88). Only a getter whose body is that one
 * return; a field is a value somebody else may assign.
 */
const getterAnswer = (link: TsNode): TsNode | undefined => {
  if (!Node.isPropertyAccessExpression(link) || !Node.isThisExpression(link.getExpression())) {
    return undefined;
  }
  for (const owner of classesAround(link)) {
    const getter = classMembersOf(owner).getAccessor(link.getName());
    if (getter === undefined) continue;
    const body = getter.getBody();
    return body === undefined ? undefined : soleReturn(body);
  }
  return undefined;
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

/** Whether an object written out holds no `key`, and nothing spread in that might. */
const lacksKey = (node: TsNode, key: string): boolean => {
  const value = peeled(node);
  if (!Node.isObjectLiteralExpression(value)) return false;
  return value.getProperties().every((property) => {
    if (Node.isSpreadAssignment(property)) return false;
    const name = property.getNameNode();
    return !Node.isComputedPropertyName(name) && keyOf(name.getText()) !== key;
  });
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
    const initialiser = classMembersOf(current).property(key)?.getInitializer();
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

/**
 * One step of a path that stands for every key of a record, as the key is
 * written: a record keyed by what it addresses - a batch keyed by the table
 * each list of writes goes to - names its addresses in its keys (P51).
 */
export const EVERY_KEY = '[key]';

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
  // An imported `const` is the one its module declares (P268).
  const declaration = declarationNamed(node);
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return undefined;
  }
  return declaration.getInitializer();
};

/** How many classes up a class's bases are followed. */
const MOST_BASES = 8;

/** Whether a class is `owner` or extends it, however far up (P316). */
const derivesFrom = (cls: TsNode | undefined, owner: TsNode): boolean => {
  let current = cls;
  for (let depth = 0; depth < MOST_BASES && current !== undefined; depth += 1) {
    if (current === owner) return true;
    if (!Node.isClassDeclaration(current) && !Node.isClassExpression(current)) return false;
    current = current.getBaseClass();
  }
  return false;
};

/** The class member a node is written in: what `this` is there. */
const memberAround = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor(
    (each) => Node.isMethodDeclaration(each) || Node.isConstructorDeclaration(each) || Node.isPropertyDeclaration(each) || Node.isGetAccessorDeclaration(each) || Node.isSetAccessorDeclaration(each) || Node.isClassStaticBlockDeclaration(each),
  );

/**
 * The text a key is, where it is written as text or a `const` holding text:
 * `'queue'`, `` `queue` ``, `KEY` of `const KEY = 'queue'` (P328).
 */
const keyText = (key: TsNode): string | undefined => {
  const value = writtenValue(key);
  if (Node.isNumericLiteral(value)) return value.getText();
  return Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ? value.getLiteralText() : undefined;
};

/**
 * A member access, by name (P328): `x.queue`, and `x['queue']` or `x[KEY]`
 * with the key text (a number as written) - `name` left out where the key is not read, which may
 * then be any member.
 */
const accessed = (node: TsNode): { readonly object: TsNode; readonly name?: string } | undefined => {
  if (Node.isPropertyAccessExpression(node)) return { object: node.getExpression(), name: node.getName() };
  if (!Node.isElementAccessExpression(node)) return undefined;
  const key = node.getArgumentExpression();
  const name = key === undefined ? undefined : keyText(key);
  return { object: node.getExpression(), ...(name === undefined ? {} : { name }) };
};

/** Whether the member a node is written in is a static one: what `this` is there is the class itself. */
const inStaticMember = (member: TsNode): boolean =>
  Node.isClassStaticBlockDeclaration(member) || (!Node.isConstructorDeclaration(member) && (member as PropertyDeclaration).isStatic());

/**
 * The classes a value may stand for, where each it may be is one (P328):
 * the class it names - past parentheses and assertions, `Registry as any` -
 * a `const` given one, a `let` each value it is given, an alias of any of
 * these, and a parameter what each caller hands it, the walk bounded as the
 * writes through such names are (`MOST_ALIASES`). `undefined` where any
 * value it may be is not a class this program declares.
 */
const classesStoodFor = (expression: TsNode): (ClassDeclaration | ClassExpression)[] | undefined => {
  const out: (ClassDeclaration | ClassExpression)[] = [];
  const seen = new Set<TsNode>();
  const queue: TsNode[] = [expression];
  while (queue.length > 0) {
    const at = peeled(queue.shift() as TsNode);
    if (Node.isClassExpression(at)) {
      if (!out.includes(at)) out.push(at);
      continue;
    }
    const declared = declarationNamed(at);
    if (declared === undefined) return undefined;
    if (seen.has(declared)) continue;
    if (seen.size >= MOST_ALIASES) return undefined;
    seen.add(declared);
    if (Node.isClassDeclaration(declared)) {
      if (!out.includes(declared)) out.push(declared);
    } else if (Node.isVariableDeclaration(declared)) {
      const values = isConstDeclaration(declared) ? [declared.getInitializer()] : valuesGiven(declared);
      if (values === undefined || values.some((value) => value === undefined)) return undefined;
      queue.push(...(values as TsNode[]));
    } else if (Node.isParameterDeclaration(declared)) {
      const callable = callableOf(declared);
      const owner = declared.getParent();
      if (declared.isRestParameter() || callable === undefined || !Node.isParametered(owner)) return undefined;
      const index = owner.getParameters().indexOf(declared);
      const sites = callSitesOf(callable);
      if (sites.length === 0) return undefined;
      for (const site of sites) {
        const handed = site.getArguments();
        if (handed.slice(0, index + 1).some((each) => Node.isSpreadElement(each))) return undefined;
        const value = handed[index] ?? declared.getInitializer();
        if (value === undefined) return undefined;
        queue.push(value);
      }
    } else {
      return undefined;
    }
  }
  return out;
};

/**
 * The class a read of a field is made through: the class whose member says
 * `this.queue`, or the class named in `Reports.queue`, where it is the
 * field's class or one extending it (P308, P316) - also `this['queue']` and
 * `this[KEY]`, and the class through whatever stands for it, `R.queue` of
 * `const R: any = Reports` (P328). `undefined` where the read is not of that
 * field of that class.
 */
const readerOf = (target: TsNode, name: string, owner: TsNode, isStatic: boolean): TsNode | undefined => {
  const access = accessed(target);
  if (access === undefined || access.name !== name) return undefined;
  const object = peeled(access.object);
  if (Node.isThisExpression(object)) {
    const member = memberAround(target);
    const cls = member?.getParent();
    if (member === undefined || !derivesFrom(cls, owner)) return undefined;
    return inStaticMember(member) === isStatic ? cls : undefined;
  }
  if (!isStatic || !Node.isIdentifier(object)) return undefined;
  const named = declarationNamed(object);
  if (derivesFrom(named, owner)) return named;
  const classes = classesStoodFor(object);
  return classes !== undefined && classes.length > 0 && classes.every((each) => derivesFrom(each, owner)) ? classes[0] : undefined;
};

/** A member of a class, or of one it extends, by name: a field declared, or a constructor's parameter property. */
const memberUp = (cls: TsNode, name: string, isStatic: boolean): TsNode | undefined => {
  let current: TsNode | undefined = cls;
  for (let depth = 0; depth < MOST_BASES && current !== undefined; depth += 1) {
    if (!Node.isClassDeclaration(current) && !Node.isClassExpression(current)) return undefined;
    const field = current.getMembers().find((each) => Node.isPropertyDeclaration(each) && each.isStatic() === isStatic && each.getName() === name);
    if (field !== undefined) return field;
    if (!isStatic) {
      const kept = current.getConstructors().flatMap((each) => each.getParameters()).find((each) => each.isParameterProperty() && each.getName() === name);
      if (kept !== undefined) return kept;
    }
    current = current.getBaseClass();
  }
  return undefined;
};

/**
 * The field a member access reads (P328): what the checker links it to, else
 * - where it reads through `any`, or by a key - the field of that name of
 * the class `this` is in, or the static one of each class the object may
 * stand for, where they are one.
 */
const fieldDeclared = (node: TsNode, object: TsNode, name: string): TsNode | undefined => {
  const key = Node.isElementAccessExpression(node) ? node.getArgumentExpression() : undefined;
  const linked = Node.isPropertyAccessExpression(node)
    ? node.getNameNode().getSymbol()?.getDeclarations()[0]
    : key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))
      ? key.getSymbol()?.getDeclarations()[0]
      : undefined;
  if (linked !== undefined) return linked;
  if (Node.isThisExpression(object)) {
    const member = memberAround(node);
    return member === undefined ? undefined : memberUp(member.getParent() as TsNode, name, inStaticMember(member));
  }
  const fields = staticFieldsStoodFor(object, name);
  return fields?.length === 1 ? fields[0] : undefined;
};

/**
 * The static field `name` each class a value may stand for declares, or
 * takes from a class it extends, each field once (P328, P332): one where the
 * classes share it, several where each declares its own. `undefined` where
 * the value is not known to stand for classes, or one of them has no such
 * field.
 */
const staticFieldsStoodFor = (object: TsNode, name: string): PropertyDeclaration[] | undefined => {
  const classes = classesStoodFor(object);
  if (classes === undefined || classes.length === 0) return undefined;
  const out: PropertyDeclaration[] = [];
  for (const cls of classes) {
    const field = memberUp(cls, name, true);
    if (field === undefined || !Node.isPropertyDeclaration(field)) return undefined;
    if (!out.includes(field)) out.push(field);
  }
  return out;
};

/** A field as the source names it, by its class: `Queues.mail` (P332). */
const fieldNamed = (field: PropertyDeclaration): string => {
  const cls = field.getParent();
  const name = Node.isClassDeclaration(cls) || Node.isClassExpression(cls) ? cls.getName() : undefined;
  return `${name ?? 'class'}.${field.getName()}`;
};

/**
 * Each field a read of a static member may be, where the name it is read
 * through may stand for several classes that each declare a field of that
 * name (P332): `target.mail` of a function handed `Queues` by one caller and
 * `Archive` by another is either class's `mail`. Each is read as the field
 * of its own it is - its one value, or where it is given several or changed,
 * the field itself, not read further - and says which class's it is.
 */
const fieldChoices = (node: TsNode): Followed[] | undefined => {
  const access = accessed(node);
  if (access === undefined || access.name === undefined) return undefined;
  const object = peeled(access.object);
  if (!Node.isIdentifier(object)) return undefined;
  const fields = staticFieldsStoodFor(object, access.name);
  if (fields === undefined || fields.length < 2) return undefined;
  return fields.map((field) => {
    const { values, changed } = staticWrites(field);
    const [only, ...more] = values;
    const value = !changed && only !== undefined && more.length === 0 ? only : field.getNameNode();
    return { value, bound: NO_BINDINGS, heldIn: fieldNamed(field) };
  });
};

/**
 * Every field a member access may read (P328, P332): the one field, or each
 * static field of the classes the object may stand for where each declares
 * its own - what states the class of a receiver the checker sees only as
 * `any`, which is that class where every field states the same one.
 */
export const fieldsRead = (node: TsNode): TsNode[] => {
  const one = fieldRead(node);
  if (one !== undefined) return [one];
  const access = accessed(node);
  if (access === undefined || access.name === undefined) return [];
  const object = peeled(access.object);
  return Node.isIdentifier(object) ? (staticFieldsStoodFor(object, access.name) ?? []) : [];
};

/**
 * The field a member access reads, where it is one (P328): `R.queue` of
 * `const R: any = Registry`, `Registry[KEY]`, `this['queue']` - what
 * states the class of a receiver the checker sees only as `any`.
 */
export const fieldRead = (node: TsNode): TsNode | undefined => {
  const access = accessed(node);
  if (access === undefined || access.name === undefined) return undefined;
  const object = peeled(access.object);
  if (!Node.isThisExpression(object) && !Node.isIdentifier(object)) return undefined;
  const field = fieldDeclared(node, object, access.name);
  return field !== undefined && (Node.isPropertyDeclaration(field) || Node.isParameterDeclaration(field)) ? field : undefined;
};

/** Whether a node is written in a member of a class extending `owner`, static or not as asked: where `this` is the class or one of its instances (P328). */
const thisOfClass = (node: TsNode, owner: TsNode, isStatic: boolean): boolean => {
  const member = memberAround(node);
  return member !== undefined && derivesFrom(member.getParent(), owner) && inStaticMember(member) === isStatic;
};

/** Whether a node writes a member of `this` by a key not read, `this[key] = value`, in a member of a class extending `owner` (P328). */
const unreadKeyWrite = (node: TsNode, owner: TsNode, isStatic: boolean): boolean => {
  const access = accessed(node);
  if (access === undefined || access.name !== undefined || !Node.isThisExpression(peeled(access.object))) return false;
  return thisOfClass(node, owner, isStatic) && writeAt(node) !== undefined;
};

/**
 * What `Object.assign(this, ...sources)` in a member of a class extending
 * `owner` gives the field `name` (P332): each key its sources write, nothing
 * where none writes it. `undefined` where the node is no such `this`.
 */
const assignedThis = (node: TsNode, name: string, owner: TsNode, isStatic: boolean): Given | undefined => {
  if (!Node.isThisExpression(node) || !thisOfClass(node, owner, isStatic)) return undefined;
  const call = assignedOver(node);
  return call === undefined ? undefined : laidOver(call.getArguments().slice(1), name, NO_BINDINGS, 0);
};

/** How a reference to a field is written to, where it is: given a value, or changed in place. */
type FieldWrite = { readonly value: TsNode } | 'changed' | undefined;

/**
 * Whether the access `access` is written to (P286, P308): the left of a
 * plain `=` gives the field a value; `+=`, `++` or a part of a destructuring
 * changes it in place, to a value none written is.
 */
const writeAt = (access: TsNode): FieldWrite => {
  let at = access;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    const parent = at.getParent();
    if (parent === undefined || peeled(parent) !== access) break;
    at = parent;
  }
  const parent = at.getParent();
  if (parent !== undefined && Node.isBinaryExpression(parent) && parent.getLeft() === at) {
    const operator = parent.getOperatorToken().getKind();
    if (operator === SyntaxKind.EqualsToken) return { value: parent.getRight() };
    if (operator >= SyntaxKind.FirstCompoundAssignment && operator <= SyntaxKind.LastCompoundAssignment) return 'changed';
  }
  if (
    parent !== undefined &&
    (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
    (parent.getOperatorToken() === SyntaxKind.PlusPlusToken || parent.getOperatorToken() === SyntaxKind.MinusMinusToken)
  ) {
    return 'changed';
  }
  return destructuredInto(at) ? 'changed' : undefined;
};

/** What a field is given, everywhere it may be: every value, and whether it is also changed in place. */
interface FieldValues {
  readonly values: readonly TsNode[];
  readonly changed: boolean;
}

/** What each static field met is given, worked out once: finding its writes asks for every reference to it. */
const STATIC_WRITES = new WeakMap<TsNode, FieldValues>();

/**
 * Every value a static field is given (P316): its initializer and each write
 * to it anywhere in the program - through the class in another module, as a
 * setup file writes `Queues.mail = new Queue('mail')`, or through anything
 * else the checker says is the same field.
 */
const staticWrites = (declaration: PropertyDeclaration): FieldValues => {
  const known = STATIC_WRITES.get(declaration);
  if (known !== undefined) return known;
  const initializer = declaration.getInitializer();
  const values: TsNode[] = initializer === undefined ? [] : [initializer];
  let changed = false;
  const nameNode = declaration.getNameNode();
  // A field named by a string or a computed key is not looked for: its writes stay unknown.
  if (!Node.isIdentifier(nameNode) && !Node.isPrivateIdentifier(nameNode)) changed = true;
  const references = Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode) ? nameNode.findReferencesAsNodes() : [];
  const accesses = new Set<TsNode>();
  for (const reference of references) {
    if (reference === nameNode) continue;
    const access = reference.getParent();
    if (access === undefined) continue;
    // `Queues['mail']`, which the checker links by its text (P328).
    if ((Node.isPropertyAccessExpression(access) && access.getNameNode() === reference) || (Node.isElementAccessExpression(access) && access.getArgumentExpression() === reference)) {
      accesses.add(access);
    }
  }
  // What the checker does not link to the field: a write through the class
  // under `any` - an alias, an assertion, a parameter handed it (P322) - and
  // one through `this` in a static member by a key written apart from it,
  // `this[KEY]` (P328). A write by a key not read may be to it.
  const owner = declaration.getParent();
  if (Node.isIdentifier(nameNode) && (Node.isClassDeclaration(owner) || Node.isClassExpression(owner))) {
    const name = nameNode.getText();
    for (const access of aliasedAccesses(owner, name)) accesses.add(access);
    for (const cls of [owner, ...derivedOf(owner)]) {
      cls.forEachDescendant((each) => {
        // `Object.assign(this, { mail })` in a static member (P332).
        const assigned = assignedThis(each, name, owner, true);
        if (assigned !== undefined) {
          values.push(...assigned.values);
          changed ||= assigned.changed;
        } else if (readerOf(each, name, owner, true) !== undefined) accesses.add(each);
        else if (unreadKeyWrite(each, owner, true)) changed = true;
      });
    }
  }
  for (const access of accesses) {
    // `Object.assign(Queues, { mail })`, through the class or what stands for it: each key its sources write (P332).
    const over = accessed(access) === undefined ? assignedOver(access) : undefined;
    if (over !== undefined) {
      const assigned = laidOver(over.getArguments().slice(1), declaration.getName(), NO_BINDINGS, 0);
      values.push(...assigned.values);
      changed ||= assigned.changed;
      continue;
    }
    const write = writeAt(access);
    // `R[key] = value` through what stands for the class: any of its fields (P328).
    if (write !== undefined && accessed(access)?.name === undefined) {
      changed = true;
      continue;
    }
    if (write === 'changed') changed = true;
    else if (write !== undefined) values.push(write.value);
  }
  // A write met twice - `this` in a static member is also a reference to the class - is one write.
  const found = { values: [...new Set(values)], changed };
  STATIC_WRITES.set(declaration, found);
  return found;
};

/** How many names standing for a class are followed: an alias of an alias, a parameter handed one (P322). */
const MOST_ALIASES = 16;

/** The outermost of the parentheses and assertions around a node: what its parent sees of it. */
const wrapped = (node: TsNode): TsNode => {
  let at = node;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    const parent = at.getParent();
    if (parent === undefined || peeled(parent) !== node) break;
    at = parent;
  }
  return at;
};

/** The parameters of what a call or `new` calls, where it is a function, a method or a class this program declares. */
const calleeParameters = (call: CallExpression | NewExpression): TsNode[] => {
  const callee = peeled(call.getExpression());
  let declaration = Node.isPropertyAccessExpression(callee) ? callee.getNameNode().getSymbol()?.getDeclarations()[0] : declarationNamed(callee);
  if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    declaration = initializer === undefined ? undefined : peeled(initializer);
  }
  if (declaration !== undefined && Node.isClassDeclaration(declaration)) declaration = declaration.getConstructors()[0];
  if (
    declaration === undefined ||
    !(
      Node.isFunctionDeclaration(declaration) ||
      Node.isMethodDeclaration(declaration) ||
      Node.isArrowFunction(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isConstructorDeclaration(declaration)
    )
  ) {
    return [];
  }
  return declaration.getParameters();
};

/**
 * Every access to the static field `name` made through something that
 * stands for its class but that the checker does not link to the field
 * (P322): the class under an assertion, `(Registry as any).queue`; a
 * variable given the class, `const R: any = Registry` or `R = Registry`; an
 * alias of such a variable; a parameter a call hands any of these - and
 * `R['queue']` written with the name as a string or a `const` holding it,
 * `R[key]` by a key not read as one that may be any field (P328). A class extending it is
 * followed the same way, a write through it being one the field's readers
 * through that class may see. Each access is a write the field may be given:
 * where the alias may also stand for something else, the write still may
 * reach the class, so it is counted.
 */
const aliasedAccesses = (owner: ClassDeclaration | ClassExpression, name: string): TsNode[] => {
  const starts: TsNode[] = [];
  const nameOf = (cls: TsNode): TsNode | undefined => {
    if (Node.isClassDeclaration(cls)) return cls.getNameNode();
    const holder = wrapped(cls).getParent();
    return holder !== undefined && Node.isVariableDeclaration(holder) ? holder.getNameNode() : undefined;
  };
  const own = nameOf(owner);
  if (own !== undefined) starts.push(own);
  for (const derived of derivedOf(owner)) starts.push(derived.getNameNode() ?? derived);
  const seen = new Set<TsNode>();
  const queue = starts.filter((each) => Node.isIdentifier(each));
  const accesses: TsNode[] = [];
  const follow = (declared: TsNode | undefined): void => {
    if (declared === undefined) return;
    const named = Node.isVariableDeclaration(declared) || Node.isParameterDeclaration(declared) ? declared.getNameNode() : declared;
    if (Node.isIdentifier(named) && !seen.has(named) && seen.size + queue.length < MOST_ALIASES) queue.push(named);
  };
  while (queue.length > 0) {
    const start = queue.shift() as TsNode;
    if (seen.has(start) || !Node.isIdentifier(start)) continue;
    seen.add(start);
    for (const reference of start.findReferencesAsNodes()) {
      if (reference === start) continue;
      const at = wrapped(reference);
      const parent = at.getParent();
      if (parent === undefined) continue;
      if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === at) {
        if (parent.getName() === name) accesses.push(parent);
        continue;
      }
      if (Node.isElementAccessExpression(parent) && parent.getExpression() === at) {
        // `R['queue']`, `R[KEY]`, and `R[key]` by a key not read, which may be it (P328).
        const keyed = accessed(parent)?.name;
        if (keyed === undefined || keyed === name) accesses.push(parent);
        continue;
      }
      // `Object.assign(R, { queue })`, which writes each key its sources give (P332).
      if (assignedOver(at) !== undefined) {
        accesses.push(at);
        continue;
      }
      if (Node.isVariableDeclaration(parent) && parent.getInitializer() === at) follow(parent);
      else if (Node.isBinaryExpression(parent) && parent.getRight() === at && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
        follow(declarationNamed(peeled(parent.getLeft())));
      } else if ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getArguments().includes(at)) {
        const parameter = calleeParameters(parent)[parent.getArguments().indexOf(at)];
        if (parameter !== undefined && Node.isParameterDeclaration(parameter) && !parameter.isRestParameter()) follow(parameter);
      }
    }
  }
  return accesses;
};

/**
 * Every value an instance field is given, read through `reader` (P286,
 * P308, P316): its initializer, if it has one, and each `this.<field> =` the
 * members of `reader` and of each class between it and the field's class
 * write - a base class's own `this.queue = new Queue('x')` read in a class
 * extending it included, `this['queue'] =` and `this[KEY] =` as well, and one
 * by a key not read changing it (P328) - and, below `reader`, each class extending it whose
 * instances run the member the read is made in (P322): its own `this.queue =`
 * and a field it declares again with a value, one it takes as a parameter
 * property being whatever it is built with.
 */
const instanceWrites = (name: string, owner: TsNode, initializer: TsNode | undefined, reader: TsNode, read: TsNode): FieldValues => {
  const values: TsNode[] = initializer === undefined ? [] : [initializer];
  let changed = false;
  const writesIn = (cls: TsNode): void => {
    cls.forEachDescendant((each) => {
      // `this[key] = value` by a key not read may be to it (P328).
      if (unreadKeyWrite(each, owner, false)) changed = true;
      // `Object.assign(this, options)`: each key its sources write (P332).
      const assigned = assignedThis(each, name, owner, false);
      if (assigned !== undefined) {
        values.push(...assigned.values);
        changed ||= assigned.changed;
        return;
      }
      if (readerOf(each, name, owner, false) === undefined) return;
      const write = writeAt(each);
      if (write === 'changed') changed = true;
      else if (write !== undefined) values.push(write.value);
    });
  };
  let current: TsNode | undefined = reader;
  for (let depth = 0; depth < MOST_BASES && current !== undefined; depth += 1) {
    if (!Node.isClassDeclaration(current) && !Node.isClassExpression(current)) break;
    writesIn(current);
    if (current === owner) break;
    current = current.getBaseClass();
  }
  for (const below of runningBelow(reader, memberAround(read))) {
    writesIn(below);
    for (const member of below.getMembers()) {
      if (!Node.isPropertyDeclaration(member) || member.isStatic() || member.getName() !== name || member.hasDeclareKeyword()) continue;
      const value = member.getInitializer();
      if (value !== undefined) values.push(value);
    }
    for (const constructor of below.getConstructors()) {
      if (constructor.getParameters().some((parameter) => parameter.isParameterProperty() && parameter.getName() === name)) changed = true;
    }
  }
  return { values, changed };
};

/** The name a class member is called by, where it is a method, an accessor or a field: what a class extending it overrides. */
const memberName = (member: TsNode | undefined): string | undefined =>
  member !== undefined && (Node.isMethodDeclaration(member) || Node.isPropertyDeclaration(member) || Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member))
    ? member.getName()
    : undefined;

/** The classes extending each class met, found once: finding them asks for every reference to it. */
const DERIVED = new WeakMap<TsNode, ClassDeclaration[]>();

/** The classes extending a class declared by name, however far down. */
const derivedOf = (cls: TsNode): ClassDeclaration[] => {
  if (!Node.isClassDeclaration(cls)) return [];
  const derived = DERIVED.get(cls) ?? cls.getDerivedClasses();
  DERIVED.set(cls, derived);
  return derived;
};

/**
 * The classes extending `reader`, however far down, whose instances run
 * `member` of it (P322): each, unless it - or a class between - declares a
 * member of that name again and nowhere calls `super.<name>`. A constructor
 * runs on every instance.
 */
const runningBelow = (reader: TsNode, member: TsNode | undefined): ClassDeclaration[] => {
  if (!Node.isClassDeclaration(reader)) return [];
  const overridden = memberName(member);
  const out: ClassDeclaration[] = [];
  const derived = derivedOf(reader);
  const visit = (cls: ClassDeclaration, depth: number): void => {
    if (depth >= MOST_BASES) return;
    for (const child of derived) {
      if (child.getBaseClass() !== cls || out.includes(child)) continue;
      if (overridden !== undefined && overrides(child, overridden)) continue;
      out.push(child);
      visit(child, depth + 1);
    }
  };
  visit(reader, 0);
  return out;
};

/** Whether a class declares a member of a name again without calling its base's: `super.<name>` nowhere in it. */
const overrides = (cls: ClassDeclaration, name: string): boolean => {
  if (!cls.getMembers().some((each) => memberName(each) === name && !(Node.isPropertyDeclaration(each) && each.hasDeclareKeyword()))) return false;
  let calls = false;
  cls.forEachDescendant((each, traversal) => {
    if (Node.isPropertyAccessExpression(each) && each.getExpression().getKind() === SyntaxKind.SuperKeyword && each.getName() === name) {
      calls = true;
      traversal.stop();
    }
  });
  return !calls;
};

/** The `super(...)` call a constructor makes. */
const superCallIn = (constructor: TsNode): CallExpression | undefined => {
  let call: CallExpression | undefined;
  constructor.forEachDescendant((node, traversal) => {
    if (Node.isCallExpression(node) && node.getExpression().getKind() === SyntaxKind.SuperKeyword) {
      call = node;
      traversal.stop();
    }
  });
  return call;
};

/**
 * What an instance of `reader` hands its base class's constructor for the
 * argument `index` of `holder`'s constructor (P316): `super(new Queue('mail'))`
 * in a class extending the one that keeps the queue, through each class
 * between - one with no constructor of its own built with its base's, one
 * that takes the value as its own constructor's argument handing that on.
 * `undefined` where `reader` itself takes it, which whoever builds it decides.
 */
const handedToSuper = (reader: TsNode, holder: TsNode, index: number): TsNode | undefined => {
  const lineage: ClassDeclaration[] = [];
  let current: TsNode | undefined = reader;
  while (current !== undefined && current !== holder && lineage.length < MOST_BASES) {
    if (!Node.isClassDeclaration(current)) return undefined;
    lineage.unshift(current);
    current = current.getBaseClass();
  }
  if (current !== holder) return undefined;
  let at = index;
  for (const each of lineage) {
    const [constructor] = each.getConstructors();
    if (constructor === undefined) continue;
    const handed = superCallIn(constructor)?.getArguments()[at];
    if (handed === undefined || Node.isSpreadElement(handed)) return undefined;
    const kept = declarationNamed(peeled(handed));
    if (kept !== undefined && Node.isParameterDeclaration(kept) && kept.getParent() === constructor) {
      at = constructor.getParameters().indexOf(kept);
      continue;
    }
    return handed;
  }
  return undefined;
};

/** The constructor parameter a value is, where it is one: the class it is of and where it is taken. */
const constructorParameter = (value: TsNode): { cls: TsNode; index: number } | undefined => {
  const kept = declarationNamed(peeled(value));
  if (kept === undefined || !Node.isParameterDeclaration(kept)) return undefined;
  const constructor = kept.getParent();
  if (!Node.isConstructorDeclaration(constructor)) return undefined;
  return { cls: constructor.getParent(), index: constructor.getParameters().indexOf(kept) };
};

/**
 * What a field of the class is set to, where it is given one value only:
 * `this.queue = new Queue(name)` in the method that opens the queue, or the
 * value it is declared with - `private readonly queue = new Queue('emails')`,
 * a static field read as `Reports.queue` included - read wherever the field
 * is used (P286, P308). A static field's writes are read wherever the
 * program makes them, another module's included; a field a base class
 * declares is read in a class extending it, and one the base keeps from its
 * constructor is what the extending class hands `super(...)` (P316). A
 * static field written through the class under `any` - an alias, an
 * assertion, a parameter - is written all the same, and an instance field
 * read in a class is also what each class extending it sets, where its
 * instances run the member the read is made in (P322). A read through what
 * stands for the class the checker does not link - `R.queue` of
 * `const R: any = Reports`, `(Reports as any).queue`, a parameter each
 * caller hands the class - and a read by a key, `this['queue']` or
 * `Reports[KEY]`, are read the same (P328). A field set in two places holds
 * whichever ran last, which nothing here can say.
 */
const assignedField = (node: TsNode): TsNode | undefined => {
  const access = accessed(node);
  if (access === undefined || access.name === undefined) return undefined;
  const object = peeled(access.object);
  if (!Node.isThisExpression(object) && !Node.isIdentifier(object)) return undefined;
  const name = access.name;
  const declaration = fieldDeclared(node, object, name);
  if (declaration === undefined) return undefined;
  // `constructor(protected queue: Queue)`: what a class extending it hands `super(...)`.
  if (Node.isParameterDeclaration(declaration)) {
    const constructor = declaration.getParent();
    if (!declaration.isParameterProperty() || !Node.isConstructorDeclaration(constructor)) return undefined;
    const owner = constructor.getParent();
    const reader = readerOf(node, name, owner, false);
    if (reader === undefined || reader === owner) return undefined;
    const { values, changed } = instanceWrites(name, owner, undefined, reader, node);
    if (changed || values.length > 0) return undefined;
    return handedToSuper(reader, owner, constructor.getParameters().indexOf(declaration));
  }
  if (!Node.isPropertyDeclaration(declaration)) return undefined;
  const owner = declaration.getParent();
  if (!Node.isClassDeclaration(owner) && !Node.isClassExpression(owner)) return undefined;
  const reader = readerOf(node, name, owner, declaration.isStatic());
  if (reader === undefined) return undefined;
  const { values, changed } = declaration.isStatic() ? staticWrites(declaration) : instanceWrites(name, owner, declaration.getInitializer(), reader, node);
  const [only, ...more] = values;
  if (changed || only === undefined || more.length > 0) return undefined;
  // A field the constructor keeps a parameter of in is what each instance was
  // built with, which the reader of a publish follows to whoever built it -
  // unless the instance is of a class extending the one whose constructor
  // keeps it, which hands it to `super(...)` (P316).
  const kept = constructorParameter(only);
  if (kept === undefined) return only;
  return kept.cls === reader ? undefined : handedToSuper(reader, kept.cls, kept.index);
};

/** Whether a name is written to by a destructuring assignment, `[a, b] = pair`, where it is one part of the left. */
const destructuredInto = (reference: TsNode): boolean => {
  let at = reference;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    const parent = at.getParent();
    if (parent === undefined) return false;
    if (Node.isBinaryExpression(parent)) return parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && parent.getLeft() === at && at !== reference;
    if (
      !Node.isArrayLiteralExpression(parent) &&
      !Node.isObjectLiteralExpression(parent) &&
      !Node.isPropertyAssignment(parent) &&
      !Node.isShorthandPropertyAssignment(parent) &&
      !Node.isSpreadElement(parent) &&
      !Node.isSpreadAssignment(parent) &&
      !Node.isParenthesizedExpression(parent)
    ) {
      return false;
    }
    at = parent;
  }
  return false;
};

/**
 * Every value a `let` is given, where each is given whole (P290): its
 * initialiser and the right side of every plain `=` to it, wherever written -
 * `let last; for (const job of jobs) last = { ...job, children: last ? [last] : [] }`
 * is each record the loop builds. A `let` also changed in place (`+=`, `++`,
 * a destructuring) holds values no one of these is, and is not read.
 */
const assignedValues = (node: TsNode): TsNode[] | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = declarationNamed(node);
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Let) return undefined;
  const known = LET_VALUES.get(declaration);
  if (known !== undefined) return known ?? undefined;
  const values = valuesGiven(declaration);
  LET_VALUES.set(declaration, values ?? null);
  return values;
};

/** What each `let` met is given, worked out once: finding its writes asks for every reference to it. */
const LET_VALUES = new WeakMap<TsNode, TsNode[] | null>();

const valuesGiven = (declaration: VariableDeclaration): TsNode[] | undefined => {
  const nameNode = declaration.getNameNode();
  if (!Node.isIdentifier(nameNode)) return undefined;
  const values: TsNode[] = [];
  const initial = declaration.getInitializer();
  if (initial !== undefined) values.push(initial);
  for (const reference of nameNode.findReferencesAsNodes()) {
    if (reference === nameNode) continue;
    const parent = reference.getParent();
    if (parent === undefined) continue;
    if (Node.isBinaryExpression(parent) && parent.getLeft() === reference) {
      const operator = parent.getOperatorToken().getKind();
      if (operator === SyntaxKind.EqualsToken) {
        values.push(parent.getRight());
        continue;
      }
      if (operator >= SyntaxKind.FirstCompoundAssignment && operator <= SyntaxKind.LastCompoundAssignment) return undefined;
    }
    if (
      (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
      (parent.getOperatorToken() === SyntaxKind.PlusPlusToken || parent.getOperatorToken() === SyntaxKind.MinusMinusToken)
    ) {
      return undefined;
    }
    if (destructuredInto(reference)) return undefined;
  }
  return values.length === 0 ? undefined : values;
};

/** Parentheses and the assertions TypeScript lets a value carry, which say nothing about the value. */
const peeled = (node: TsNode): TsNode => {
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
    return current;
  }
  return current;
};

/**
 * The value an expression is written as, past parentheses, assertions and the
 * `const` bindings it names, with no parameter followed to its callers: what a
 * registry is filled with and the key it is filled under (P267).
 */
const writtenValue = (node: TsNode): TsNode => {
  let current = node;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    current = peeled(current);
    const bound = constValue(current);
    if (bound === undefined) return current;
    current = bound;
  }
  return current;
};

/** The declaration a name stands for: the variable a shorthand property copies, past an import. */
const declarationNamed = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent) ? parent.getValueSymbol() : node.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration !== undefined && Node.isImportSpecifier(declaration)) {
    return symbol?.getAliasedSymbol()?.getDeclarations()[0];
  }
  return declaration;
};

/** What a parameter is handed, where the walk knows: by a caller, or by the call of a factory it stepped into. */
const handedValue = (node: TsNode, bound: Bindings): TsNode | undefined => {
  if (bound.size === 0) return undefined;
  const declaration = declarationNamed(node);
  return declaration === undefined ? undefined : bound.get(declaration);
};

/** A value as the walk followed it, and the parameters bound on the way. */
interface Followed {
  readonly value: TsNode;
  readonly bound: Bindings;
  /** The parameter a member was chosen by, where nothing bound it (P268). */
  readonly selector?: ParameterDeclaration;
  /**
   * The values an element of a list of several stands for, one per element
   * (P272): the walk stops at the element, and whoever asked follows each.
   */
  readonly choices?: readonly Followed[];
  /** The field of one of several classes the value was read out of (P332): `Queues.mail`. */
  readonly heldIn?: string;
}

/** How deep the walk goes into the values a value is made of before it gives up. */
const MOST_NESTED = 8;

/** Whether a declaration is a `const`, whose value is the one it was given. */
const isConstDeclaration = (declaration: TsNode): boolean =>
  Node.isVariableDeclaration(declaration) &&
  declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const;

/** The one value a function answers with: its expression body, or the one `return` of its own it writes. */
const answerOf = (fn: TsNode): TsNode | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn)) {
    return undefined;
  }
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return body;
  const returns = body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor((ancestor) => Node.isFunctionLikeDeclaration(ancestor) || Node.isFunctionExpression(ancestor) || Node.isArrowFunction(ancestor)) === fn);
  const [only, ...rest] = returns;
  return only === undefined || rest.length > 0 ? undefined : only.getExpression();
};

/**
 * What a function called with these arguments answers, its parameters bound
 * to them: a factory of the record a call sends - `events.OrderPlaced(data)`,
 * `entryFor(order)` - read as the record it builds (P268). A function of a
 * declaration file has no body to read.
 */
const calledAnswer = (fn: TsNode, written: readonly TsNode[], bound: Bindings, depth: number): Followed | undefined => {
  const target = followValue(fn, bound, depth + 1).value;
  if (target.getSourceFile().isDeclarationFile()) return undefined;
  const answer = answerOf(target);
  if (answer === undefined || !Node.isFunctionLikeDeclaration(target)) return undefined;
  return { value: answer, bound: handedTo(target, written, bound) };
};

/** A function's parameters, each bound to what a call of it hands it, or to its default. */
const handedTo = (target: TsNode, written: readonly TsNode[], bound: Bindings): Bindings => {
  const handed = new Map(bound);
  if (!Node.isFunctionLikeDeclaration(target)) return handed;
  target.getParameters().forEach((parameter, index) => {
    const argument = written[index] ?? parameter.getInitializer();
    if (argument !== undefined) handed.set(parameter, argument);
  });
  return handed;
};

/** Whether a function's answer says it answers nothing: `return`, `return undefined`, `return null`. */
const answersNothing = (answer: TsNode | undefined): boolean => {
  if (answer === undefined) return true;
  const value = peeled(answer);
  return value.getKind() === SyntaxKind.NullKeyword || (Node.isIdentifier(value) && value.getText() === 'undefined');
};

/**
 * Everything a function called with these arguments may answer, its
 * parameters bound to them (P286): each `return` of its own that answers
 * something, an `async` function's as readily as any other's. A function of
 * a declaration file, or one that answers nothing anywhere, has none.
 */
const calledAnswers = (fn: TsNode, written: readonly TsNode[], bound: Bindings, depth: number): Followed[] | undefined => {
  const target = followValue(fn, bound, depth + 1).value;
  if (target.getSourceFile().isDeclarationFile()) return undefined;
  if (!Node.isArrowFunction(target) && !Node.isFunctionExpression(target) && !Node.isFunctionDeclaration(target) && !Node.isMethodDeclaration(target)) {
    return undefined;
  }
  const body = target.getBody();
  if (body === undefined) return undefined;
  const handed = handedTo(target, written, bound);
  if (!Node.isBlock(body)) return [{ value: body, bound: handed }];
  const answers: Followed[] = [];
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const own =
      statement.getFirstAncestor(
        (ancestor) => Node.isFunctionLikeDeclaration(ancestor) || Node.isFunctionExpression(ancestor) || Node.isArrowFunction(ancestor),
      ) === target;
    const answer = statement.getExpression();
    if (own && answer !== undefined && !answersNothing(answer)) answers.push({ value: answer, bound: handed });
  }
  return answers.length === 0 ? undefined : answers;
};

/**
 * What a call answers, followed into the function it calls: one value, or
 * one choice per answer where it may answer several (P286).
 */
const calledValue = (fn: TsNode, written: readonly TsNode[], bound: Bindings, depth: number): Followed | undefined => {
  const answers = calledAnswers(fn, written, bound, depth);
  const [only, ...more] = answers ?? [];
  if (only === undefined) return undefined;
  return more.length === 0 ? only : { value: fn, bound, choices: answers };
};

/**
 * What a record written out holds under one key, as a value: a property's
 * value, a shorthand's name, a method itself. Nothing past a spread or a
 * computed key met first, which may be where the key comes from.
 */
const memberOf = (record: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const properties = record.getProperties();
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];
    if (property === undefined || Node.isSpreadAssignment(property)) return undefined;
    const nameNode = property.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) return undefined;
    if (keyOf(nameNode.getText()) !== key) continue;
    if (Node.isPropertyAssignment(property)) return property.getInitializer();
    if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
    return Node.isMethodDeclaration(property) ? property : undefined;
  }
  return undefined;
};

/**
 * The member of a record written out that a lookup chooses, and what it
 * answers where it is called (P268): `events[name](data)`, `events.Placed(data)`,
 * `QUEUES[kind]`, and a function called by its name. The key is read where it
 * is written, or from what a caller handed the parameter it is; one that is a
 * parameter nobody bound is the `selector` a reader follows out to each caller.
 */
const chosenMember = (node: TsNode, bound: Bindings, depth: number): Followed | { selector: ParameterDeclaration } | undefined => {
  const called = Node.isCallExpression(node);
  const callee = called ? peeled(node.getExpression()) : node;
  const written = called ? node.getArguments() : [];
  if (called && Node.isIdentifier(callee)) {
    const declaration = declarationNamed(callee);
    if (declaration === undefined) return undefined;
    if (Node.isFunctionDeclaration(declaration)) return calledValue(declaration, written, bound, depth);
    return isConstDeclaration(declaration) ? calledValue(callee, written, bound, depth) : undefined;
  }
  // A method of the class the call is written in, or of one it extends:
  // `this.buildJob(options)` is the record the method builds (P286).
  if (called && Node.isPropertyAccessExpression(callee) && Node.isThisExpression(peeled(callee.getExpression()))) {
    for (const owner of classesAround(callee)) {
      const method = methodNamedOn(owner, callee.getName());
      const fn = method === undefined ? undefined : functionOf(method);
      if (fn !== undefined) return calledValue(fn, written, bound, depth);
    }
    return undefined;
  }
  let key: string;
  let record: TsNode;
  if (Node.isPropertyAccessExpression(callee)) {
    record = callee.getExpression();
    key = callee.getName();
  } else if (Node.isElementAccessExpression(callee)) {
    record = callee.getExpression();
    const argument = callee.getArgumentExpression();
    if (argument === undefined) return undefined;
    const said = followValue(argument, bound, depth + 1).value;
    const value = evaluateExpression(said);
    if (value.resolved && (typeof value.value === 'string' || typeof value.value === 'number')) key = String(value.value);
    else {
      const declaration = declarationNamed(said);
      return declaration !== undefined && Node.isParameterDeclaration(declaration) ? { selector: declaration } : undefined;
    }
  } else {
    return undefined;
  }
  const holder = followValue(record, bound, depth + 1);
  if (!Node.isObjectLiteralExpression(holder.value)) return undefined;
  const member = memberOf(holder.value, key);
  if (member === undefined) return undefined;
  return called ? calledAnswer(member, written, holder.bound, depth) : { value: member, bound: holder.bound };
};

/** The methods of a list that hand each element of it, as it is, to a callback. */
const ITERATING = new Set(['forEach', 'map', 'flatMap', 'filter', 'find', 'findLast', 'some', 'every']);

/** The methods of a list whose answer holds elements of it, as they are. */
const KEEPING = new Set(['filter', 'slice', 'reverse', 'sort', 'toSorted', 'toReversed']);

/**
 * The values a `Map` or a `Set` bound once to a `const` is given: the second
 * member of each pair it is made with and of each `set` on it, or each item
 * it is made with and the argument of each `add` (P268, P272).
 */
const heldIn = (collection: TsNode): TsNode[] | undefined => {
  const declaration = declarationNamed(collection);
  if (declaration === undefined || !Node.isVariableDeclaration(declaration) || !isConstDeclaration(declaration)) return undefined;
  const made = declaration.getInitializer();
  if (made === undefined || !Node.isNewExpression(made)) return undefined;
  const kind = constructedName(made);
  const adds = kind === 'Map' ? { method: 'set', index: 1 } : kind === 'Set' ? { method: 'add', index: 0 } : undefined;
  const nameNode = declaration.getNameNode();
  if (adds === undefined || !Node.isIdentifier(nameNode)) return undefined;
  const values: TsNode[] = [];
  // What it is made with: `new Map([[key, value], ...])`, `new Set([a, b])`, written out.
  const [initial] = made.getArguments();
  if (initial !== undefined) {
    const written = peeled(initial);
    if (!Node.isArrayLiteralExpression(written)) return undefined;
    for (const item of written.getElements()) {
      if (Node.isSpreadElement(item)) return undefined;
      if (kind === 'Set') {
        values.push(item);
        continue;
      }
      const pair = peeled(item);
      const value = Node.isArrayLiteralExpression(pair) ? pair.getElements()[1] : undefined;
      if (value === undefined || Node.isSpreadElement(value)) return undefined;
      values.push(value);
    }
  }
  for (const reference of nameNode.findReferencesAsNodes()) {
    const access = reference.getParent();
    if (access === undefined || !Node.isPropertyAccessExpression(access) || access.getExpression() !== reference || access.getName() !== adds.method) continue;
    const call = access.getParent();
    if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== access) continue;
    const value = call.getArguments()[adds.index];
    if (value !== undefined) values.push(value);
  }
  return values;
};

/** How many elements of a list are read as an address each before the list is too long to stand for any (P272). */
const MOST_ELEMENTS = 16;

/**
 * Every element a list holds, as it is written: the elements of a list
 * written out, an element of a list some others were taken out of, what the
 * callback of a `map` answers for each, the values a `Map` or a `Set` is
 * given (P268). Several elements are several addresses, each read on its own
 * (P272); a list past {@link MOST_ELEMENTS}, or one with a spread nothing
 * reads, stands for none.
 */
const elementsWithin = (list: TsNode, bound: Bindings, depth: number): Followed[] | undefined => {
  if (depth > MOST_NESTED) return undefined;
  const followed = followValue(list, bound, depth + 1);
  const value = followed.value;
  const capped = (found: Followed[] | undefined): Followed[] | undefined =>
    found === undefined || found.length === 0 || found.length > MOST_ELEMENTS ? undefined : found;
  if (Node.isArrayLiteralExpression(value)) {
    const out: Followed[] = [];
    for (const element of value.getElements()) {
      if (!Node.isSpreadElement(element)) {
        out.push({ value: element, bound: followed.bound });
        continue;
      }
      const spread = elementsWithin(element.getExpression(), followed.bound, depth + 1);
      if (spread === undefined) return undefined;
      out.push(...spread);
    }
    return capped(out);
  }
  // A `Map` or a `Set` itself, iterated or handed a callback for each value.
  if (Node.isNewExpression(value)) {
    const values = heldIn(peeled(list));
    return capped(values?.map((each) => ({ value: each, bound: followed.bound })));
  }
  if (!Node.isCallExpression(value)) return undefined;
  const callee = peeled(value.getExpression());
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  const receiver = callee.getExpression();
  if (method === 'from' && receiver.getText() === 'Array') {
    const [source] = value.getArguments();
    return source === undefined ? undefined : elementsWithin(source, followed.bound, depth + 1);
  }
  if (KEEPING.has(method)) return elementsWithin(receiver, followed.bound, depth + 1);
  if (method === 'values' && value.getArguments().length === 0) {
    return capped(heldIn(peeled(receiver))?.map((each) => ({ value: each, bound: followed.bound })));
  }
  if (method === 'map') {
    const [callback] = value.getArguments();
    if (callback === undefined) return undefined;
    const elements = elementsWithin(receiver, followed.bound, depth + 1);
    if (elements === undefined) {
      const answer = calledAnswer(callback, [], followed.bound, depth);
      return answer === undefined ? undefined : [answer];
    }
    const answers = elements.map((element) => calledAnswer(callback, [element.value], element.bound, depth));
    return answers.every((answer): answer is Followed => answer !== undefined) ? capped(answers) : undefined;
  }
  return undefined;
};

/**
 * The elements a name stands for, where it is one: `for (const record of
 * records)`, or the first parameter of a callback a list hands each element
 * to - `records.forEach((record) => ...)` (P268).
 */
const elementsNamed = (node: TsNode, bound: Bindings, depth: number): Followed[] | undefined => {
  const declaration = declarationNamed(node);
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    const list = declaration.getParent();
    const loop = list?.getParent();
    if (
      !Node.isIdentifier(declaration.getNameNode()) ||
      list === undefined ||
      loop === undefined ||
      !Node.isVariableDeclarationList(list) ||
      !Node.isForOfStatement(loop) ||
      list.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return undefined;
    }
    return elementsWithin(loop.getExpression(), bound, depth + 1);
  }
  if (!Node.isParameterDeclaration(declaration) || !Node.isIdentifier(declaration.getNameNode())) return undefined;
  const fn = declaration.getParent();
  if (!(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== declaration) return undefined;
  const call = fn.getParent();
  if (call === undefined || !Node.isCallExpression(call) || call.getArguments()[0] !== fn) return undefined;
  const callee = peeled(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || !ITERATING.has(callee.getName())) return undefined;
  return elementsWithin(callee.getExpression(), bound, depth + 1);
};

/**
 * What `map.get(key)` answers, where the map is a `Map` bound once to a
 * `const`, reached past the parameters the walk bound (P298): each value it
 * is made with or `set` to. `undefined` for any other call.
 */
const storedValues = (node: TsNode, bound: Bindings): Followed[] | undefined => {
  if (!Node.isCallExpression(node) || node.getArguments().length !== 1) return undefined;
  const callee = peeled(node.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'get') return undefined;
  const map = peeled(settled(callee.getExpression(), bound));
  const declaration = declarationNamed(map);
  const made = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  if (made === undefined || !Node.isNewExpression(made) || constructedName(made) !== 'Map') return undefined;
  const values = heldIn(map);
  return values === undefined || values.length === 0 || values.length > MOST_ELEMENTS ? undefined : values.map((value) => ({ value, bound }));
};

/** What `map.get(key)` answers, as the values written for a reader that walks them itself (P298). */
export const mapValuesOf = (node: TsNode, bound: Bindings = NO_BINDINGS): TsNode[] | undefined => storedValues(node, bound)?.map((each) => each.value);

/**
 * What a name taken out of a record by a `const` destructuring holds (P298):
 * `const { later, soon } = this.separate(jobs)` makes `later` the `later` of
 * each record the call may answer, with the function's parameters bound to
 * what the call hands them. One value per place reached; `undefined` where the
 * name is no such binding, or the key was not reached.
 */
const destructuredValues = (node: TsNode, bound: Bindings, depth: number): Followed[] | undefined => {
  if (depth > MOST_NESTED || !Node.isIdentifier(node)) return undefined;
  const declaration = declarationNamed(node);
  if (declaration === undefined || !Node.isBindingElement(declaration) || declaration.getDotDotDotToken() !== undefined) return undefined;
  const pattern = declaration.getParent();
  const variable = pattern?.getParent();
  if (!Node.isObjectBindingPattern(pattern) || variable === undefined || !Node.isVariableDeclaration(variable) || !isConstDeclaration(variable)) return undefined;
  const source = variable.getInitializer();
  if (source === undefined) return undefined;
  const key = keyOf(declaration.getPropertyNameNode()?.getText() ?? declaration.getName());
  const slots = stepInto(source, key, bound);
  const reached = slots.filter((slot): slot is NonNullable<LocatedSlot> => slot !== undefined && slot.reached);
  if (reached.length === 0 || reached.length !== slots.length) return undefined;
  return reached.map((slot) => ({ value: slot.expression, bound: slot.bound ?? bound }));
};

/**
 * What a value is written as, past what does not change it.
 *
 * Parentheses and the assertions TypeScript lets a value carry say nothing about
 * the value, and a `const` names the value it was bound to once and for good.
 * Asked only of the records and lists a path walks through: the name at the end
 * of a path is handed over as it is written, because whether it is a literal, a
 * constant or a member of a shared enum is a fact its reader wants to know.
 *
 * Followed further, to what the value is made by (P268): a parameter to what
 * its caller or a factory's call handed it, an element of a list to the one
 * value the list is written with, a member a lookup chooses to that member,
 * and a factory called to the record it answers with. A member chosen by a
 * parameter nothing bound stops the walk, and says which parameter.
 */
const followValue = (node: TsNode, bound: Bindings = NO_BINDINGS, depth = 0): Followed => {
  let current = peeled(node);
  let held = bound;
  if (depth > MOST_NESTED) return { value: current, bound: held };
  for (let link = 0; link < MOST_LINKS; link += 1) {
    current = peeled(current);
    // What a promise settles to is the value that was awaited (P286).
    if (Node.isAwaitExpression(current)) {
      current = current.getExpression();
      continue;
    }
    const handed = handedValue(current, held);
    if (handed !== undefined) {
      current = handed;
      continue;
    }
    const constant = constValue(current) ?? assignedField(current);
    if (constant !== undefined) {
      current = constant;
      continue;
    }
    // A static field of either of several classes a name may stand for: each one's (P332).
    const fields = fieldChoices(current);
    if (fields !== undefined) return { value: current, bound: held, choices: fields };
    // `const { toQueue } = this.plan(jobs)`: the key of what it was taken out
    // of, each record a function may answer read on its own (P298).
    const taken = destructuredValues(current, held, depth);
    if (taken !== undefined) {
      const [only, ...more] = taken;
      if (only !== undefined && more.length === 0) {
        current = only.value;
        held = only.bound;
        continue;
      }
      return { value: current, bound: held, choices: taken };
    }
    // `byId.get(id)` of a `Map` a `const` holds: each value it is given (P298).
    const stored = storedValues(current, held);
    if (stored !== undefined) {
      const [only, ...more] = stored;
      if (only !== undefined && more.length === 0) {
        current = only.value;
        continue;
      }
      return { value: current, bound: held, choices: stored };
    }
    // A `let` is each value it is given (P290).
    const assigned = assignedValues(current);
    if (assigned !== undefined) {
      const [only, ...more] = assigned;
      if (only !== undefined && more.length === 0) {
        current = only;
        continue;
      }
      return { value: current, bound: held, choices: assigned.map((value) => ({ value, bound: held })) };
    }
    const elements = elementsNamed(current, held, depth);
    // Several elements are several values: each is followed on its own by whoever asked (P272).
    if (elements !== undefined && elements.length > 1) return { value: current, bound: held, choices: elements };
    const element = elements?.[0];
    if (element !== undefined) {
      current = element.value;
      held = element.bound;
      continue;
    }
    const chosen = chosenMember(current, held, depth);
    if (chosen === undefined) {
      // A record or a list the function is handed whole is its caller's to
      // write, and is read at each caller as a member chosen by one is.
      const declaration = declarationNamed(current);
      const handedIn = declaration !== undefined && Node.isParameterDeclaration(declaration) ? declaration : undefined;
      return { value: current, bound: held, ...(handedIn === undefined ? {} : { selector: handedIn }) };
    }
    if ('selector' in chosen) return { value: current, bound: held, selector: chosen.selector };
    // A function that may answer several values is each of them (P286).
    if (chosen.choices !== undefined) return { value: current, bound: held, choices: chosen.choices };
    current = chosen.value;
    held = chosen.bound;
  }
  return { value: current, bound: held };
};

/**
 * The name at the end of a path, past a parameter the walk bound: what the
 * caller or the factory's call handed it, as written there (P268).
 */
const settled = (expression: TsNode, bound: Bindings): TsNode => {
  let current = expression;
  for (let link = 0; link < MOST_LINKS; link += 1) {
    const handed = handedValue(peeled(current), bound);
    if (handed === undefined) return current;
    current = handed;
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
const writtenProperty = (record: ObjectLiteralExpression, key: string, bound: Bindings = NO_BINDINGS, depth = 0): LocatedSlot => {
  const properties = record.getProperties();
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];
    if (property === undefined) continue;
    if (Node.isSpreadAssignment(property)) {
      // A record spread in that is written out - a `const`, or what a function
      // building it answers - holds the key or does not, and one that does
      // not leaves it to what is written before it (P286).
      const spread = depth > MOST_NESTED ? undefined : followValue(property.getExpression(), bound, depth + 1);
      // A parameter no caller hands the key in leaves it to what is written before it (P299).
      if (spread !== undefined && spread.choices === undefined && spreadParameterSilent(spread, key, depth)) continue;
      if (spread === undefined || spread.choices !== undefined || !Node.isObjectLiteralExpression(spread.value)) {
        return stopped(property.getExpression());
      }
      const inner = writtenProperty(spread.value, key, spread.bound, depth + 1);
      if (inner === undefined) continue;
      return inner;
    }
    const nameNode = property.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) return stopped(nameNode);
    if (keyOf(nameNode.getText()) !== key) continue;
    if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      return initializer === undefined ? stopped(property) : carrying({ expression: initializer, reached: true }, bound);
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      return carrying({ expression: property.getNameNode(), reached: true }, bound);
    }
    // A method or an accessor computes the value when it is asked for.
    return stopped(property);
  }
  return undefined;
};

/**
 * A key of a record as an expression: what a computed key computes, or the
 * key itself where it is a string. A key written as a bare word - or a
 * shorthand property, whose key is the name it copies - names itself, and is
 * handed over as that text (P55). A spread is whatever it spreads, and stops.
 */
const writtenKey = (property: TsNode): LocatedSlot => {
  if (Node.isShorthandPropertyAssignment(property)) {
    const name = property.getNameNode();
    return { expression: name, reached: true, key: name.getText() };
  }
  if (!Node.isPropertyAssignment(property)) return stopped(property);
  const name = property.getNameNode();
  if (Node.isComputedPropertyName(name)) return { expression: name.getExpression(), reached: true };
  if (Node.isIdentifier(name)) return { expression: name, reached: true, key: name.getText() };
  return Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name) ? { expression: name, reached: true } : stopped(name);
};

/** A slot carrying the parameters bound on the way to it, where any were. */
const carrying = (slot: LocatedSlot, bound: Bindings): LocatedSlot =>
  slot === undefined || bound.size === 0 ? slot : { ...slot, bound };

/** What the callback of `list.map(cb)` answers, its parameters left as they are. */
const mappedElement = (value: TsNode, bound: Bindings): Followed | undefined => {
  if (!Node.isCallExpression(value)) return undefined;
  const callee = peeled(value.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'map') return undefined;
  const [callback] = value.getArguments();
  if (callback === undefined || !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))) return undefined;
  const answer = answerOf(callback);
  // Only an element written out: one that is the list's own element as it
  // came is no more written here than the list is.
  const written = answer === undefined ? undefined : peeled(answer);
  return written !== undefined && (Node.isObjectLiteralExpression(written) || Node.isArrayLiteralExpression(written))
    ? { value: written, bound }
    : undefined;
};

/**
 * The `const` a list written out is bound to, where the walk reaches it
 * through names: the one whose `push` calls add to it (P290).
 */
const listDeclaration = (expression: TsNode, bound: Bindings): TsNode | undefined => {
  let current = peeled(expression);
  for (let link = 0; link < MOST_LINKS; link += 1) {
    const handed = handedValue(current, bound);
    if (handed !== undefined) {
      current = peeled(handed);
      continue;
    }
    const declaration = declarationNamed(current);
    if (declaration === undefined || !isConstDeclaration(declaration) || !Node.isVariableDeclaration(declaration)) return undefined;
    const initial = declaration.getInitializer();
    if (initial === undefined) return undefined;
    if (Node.isArrayLiteralExpression(peeled(initial))) return declaration;
    current = peeled(initial);
  }
  return undefined;
};

/** The `const` a value is written as the initialiser of, past parentheses and assertions. */
const constHolding = (value: TsNode): TsNode | undefined => {
  let at = value;
  for (let link = 0; link < MOST_LINKS; link += 1) {
    const parent = at.getParent();
    if (parent === undefined) return undefined;
    if (Node.isVariableDeclaration(parent)) return parent.getInitializer() === at && isConstDeclaration(parent) ? parent : undefined;
    if (!Node.isParenthesizedExpression(parent) && !Node.isAsExpression(parent) && !Node.isSatisfiesExpression(parent)) return undefined;
    at = parent;
  }
  return undefined;
};

/** The methods of a list that add the values they are handed to it. */
const ADDING = new Set(['push', 'unshift']);

/** An element of a list, or a place in it the walk could not read. */
type Listed = Followed | { readonly stopped: TsNode };

/**
 * What the code adds to a list bound to a `const` with `push` and `unshift`,
 * as written: one value per argument, a spread argument the elements of its
 * list, or one stopped place where they are not written out (P290).
 */
const pushedInto = (declaration: TsNode, bound: Bindings, depth: number): Listed[] => {
  if (!Node.isVariableDeclaration(declaration)) return [];
  const nameNode = declaration.getNameNode();
  if (!Node.isIdentifier(nameNode)) return [];
  const out: Listed[] = [];
  for (const reference of nameNode.findReferencesAsNodes()) {
    const access = reference.getParent();
    if (access === undefined || !Node.isPropertyAccessExpression(access) || access.getExpression() !== reference || !ADDING.has(access.getName())) continue;
    const call = access.getParent();
    if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== access) continue;
    for (const argument of call.getArguments()) {
      if (!Node.isSpreadElement(argument)) {
        out.push({ value: argument, bound });
        continue;
      }
      out.push(...(elementsOfList(argument.getExpression(), bound, depth + 1) ?? [{ stopped: argument }]));
    }
  }
  return out;
};

/**
 * Every element of the list an expression is, followed to where it is
 * written: each list a function may answer (`return []` beside `return
 * [job]`) adding its own (P290).
 */
const elementsOfList = (expression: TsNode, bound: Bindings, depth: number): Listed[] | undefined => {
  if (depth > MOST_NESTED) return undefined;
  const followed = followValue(expression, bound, depth + 1);
  if (followed.choices !== undefined) {
    const each = followed.choices.map((choice) => elementsOfList(choice.value, choice.bound, depth + 1));
    return each.some((one) => one === undefined) ? undefined : each.flatMap((one) => one ?? []);
  }
  return listedElements(expression, followed.value, followed.bound, depth + 1);
};

/**
 * Every element of a list as the code writes it, for a path that steps into
 * each (P290): the elements written out and what is pushed onto the `const`
 * holding them, the elements of a list spread in, each branch of a
 * condition, and what the callback of a `map` answers for each element - or
 * once for all of them where the list mapped is not written out. A list with
 * no elements is none; `undefined` where the list is not written out.
 */
const listedElements = (expression: TsNode, value: TsNode, bound: Bindings, depth: number): Listed[] | undefined => {
  if (depth > MOST_NESTED) return undefined;
  if (Node.isConditionalExpression(value)) {
    const branches = [value.getWhenTrue(), value.getWhenFalse()].map((branch) => elementsOfList(branch, bound, depth + 1));
    return branches.some((each) => each === undefined) ? undefined : branches.flatMap((each) => each ?? []);
  }
  if (Node.isArrayLiteralExpression(value)) {
    const out: Listed[] = [];
    for (const element of value.getElements()) {
      if (!Node.isSpreadElement(element)) {
        out.push({ value: element, bound });
        continue;
      }
      out.push(...(elementsOfList(element.getExpression(), bound, depth + 1) ?? [{ stopped: element }]));
    }
    const declaration = listDeclaration(expression, bound) ?? constHolding(value);
    return declaration === undefined ? out : [...out, ...pushedInto(declaration, bound, depth)];
  }
  if (!Node.isCallExpression(value)) return undefined;
  const elements = elementsWithin(value, bound, depth + 1);
  // A callback answering the element it is handed, of a list not written
  // out, says nothing the list does not: the list is where the walk stops.
  const [only, ...more] = elements ?? [];
  const declaration = only === undefined || more.length > 0 ? undefined : declarationNamed(peeled(only.value));
  return declaration !== undefined && Node.isParameterDeclaration(declaration) && only !== undefined && !only.bound.has(declaration) ? undefined : elements;
};

/** A step that names an element of a list by its place: `jobs[0]`. */
const isIndex = (step: string): boolean => /^\d+$/.test(step);

/**
 * What an instance written out holds in a field, where its class says
 * (P298): the argument a constructor keeps in it - a parameter property, or
 * `this.key = parameter` - or the value the class gives it. An instance whose
 * type has no such field holds nothing there, which is none. `undefined`
 * where the field is set some other way.
 */
const constructedField = (made: NewExpression, key: string, bound: Bindings): LocatedSlot[] | undefined => {
  const callee = peeled(made.getExpression());
  const declaration = Node.isIdentifier(callee) ? declarationNamed(callee) : undefined;
  const cls = declaration !== undefined && Node.isClassDeclaration(declaration) && !declaration.getSourceFile().isDeclarationFile() ? declaration : undefined;
  const absent = (): boolean => made.getType().getProperty(key) === undefined && !made.getType().isAny();
  if (cls === undefined) return absent() ? [] : undefined;
  const constructor = cls.getConstructors()[0];
  const parameters = constructor?.getParameters() ?? [];
  const handed = (parameter: TsNode): LocatedSlot[] | undefined => {
    const index = parameters.findIndex((each) => each === parameter);
    const argument = index < 0 ? undefined : made.getArguments()[index];
    return argument === undefined || Node.isSpreadElement(argument) ? undefined : [carrying({ expression: argument, reached: true }, bound)];
  };
  const kept = parameters.find((parameter) => parameter.isParameterProperty() && parameter.getName() === key);
  if (kept !== undefined) return handed(kept);
  const assigned: TsNode[] = [];
  constructor?.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node) || node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return;
    const left = peeled(node.getLeft());
    if (Node.isPropertyAccessExpression(left) && Node.isThisExpression(peeled(left.getExpression())) && left.getName() === key) assigned.push(node.getRight());
  });
  const [only, ...more] = assigned;
  if (only !== undefined) {
    const parameter = more.length === 0 ? declarationNamed(peeled(only)) : undefined;
    return parameter !== undefined && Node.isParameterDeclaration(parameter) ? handed(parameter) : undefined;
  }
  const initial = cls.getProperty(key)?.getInitializer();
  if (initial !== undefined) return [{ expression: initial, reached: true }];
  return cls.getProperty(key) === undefined && cls.getBaseClass() === undefined && absent() ? [] : undefined;
};

/** One step into what a slot holds. */
const stepInto = (expression: TsNode, step: string, bound: Bindings): LocatedSlot[] => {
  const followed = followValue(expression, bound);
  // An element of a list of several: one step into each (P272).
  if (followed.choices !== undefined) return followed.choices.flatMap((choice) => fromField(stepInto(choice.value, step, choice.bound), choice.heldIn));
  const { value } = followed;
  // Where it stopped, with what the walk bound on the way there (P298): a
  // name a function the walk stepped into destructures is read on with its
  // parameters still bound.
  const halt = (): LocatedSlot[] => [
    carrying({ expression, reached: false, ...(followed.selector === undefined ? {} : { selector: followed.selector }) }, bound),
  ];
  if (step === EVERY_ELEMENT) {
    // A list made by mapping another, `jobs.map(({ data }) => ({ name, data }))`:
    // every element is what the callback answers, read once for all of them (P271).
    const mapped = mappedElement(value, followed.bound);
    if (mapped !== undefined) return [carrying({ expression: mapped.value, reached: true }, mapped.bound)];
    const listed = listedElements(expression, value, followed.bound, 0);
    if (listed === undefined) return halt();
    return listed.map((element) =>
      'stopped' in element ? carrying(stopped(element.stopped), followed.bound) : carrying({ expression: element.value, reached: true }, element.bound),
    );
  }
  // `jobs[0]` of a list written out, where nothing spread in before it moves it (P290).
  if (isIndex(step) && Node.isArrayLiteralExpression(value)) {
    const written = value.getElements();
    const elements = written.slice(0, Number(step) + 1);
    const element = elements.at(-1);
    const declaration = listDeclaration(expression, followed.bound) ?? constHolding(value);
    const added = declaration === undefined ? [] : pushedInto(declaration, followed.bound, 0);
    if (added.length === 0 && !written.some((each) => Node.isSpreadElement(each))) {
      // A list written out whole with no element there holds nothing there.
      return element === undefined || elements.length <= Number(step) ? [] : [carrying({ expression: element, reached: true }, followed.bound)];
    }
    if (element !== undefined && elements.length > Number(step) && !elements.some((each) => Node.isSpreadElement(each))) {
      return [carrying({ expression: element, reached: true }, followed.bound)];
    }
    // A list some of whose elements are spread in or added later holds at
    // that place one of its elements, which are each read (P298).
    const listed = listedElements(expression, value, followed.bound, 0);
    if (listed === undefined) return halt();
    return listed.map((each) =>
      'stopped' in each ? carrying(stopped(each.stopped), followed.bound) : carrying({ expression: each.value, reached: true }, each.bound),
    );
  }
  // A place in a list some call makes - `jobs.filter(...)`, what a `map`
  // answers - holds one of its elements, each read (P298).
  if (isIndex(step) && Node.isCallExpression(value)) {
    const listed = listedElements(expression, value, followed.bound, 0);
    if (listed !== undefined) {
      return listed.map((each) =>
        'stopped' in each ? carrying(stopped(each.stopped), followed.bound) : carrying({ expression: each.value, reached: true }, each.bound),
      );
    }
  }
  // A field of an instance written out: `new PartialSendError(jobs, cause).unsentJobs` (P298).
  if (Node.isNewExpression(value) && step !== EVERY_KEY) {
    const field = constructedField(value, step, followed.bound);
    if (field !== undefined) return field;
  }
  // `Object.assign({ TableName: table, ... }, extra)`: the record it answers (P299).
  const sources = step === EVERY_KEY || step === EVERY_ELEMENT || isIndex(step) ? undefined : assignedSources(value);
  if (sources !== undefined) {
    return [assignedProperty(sources, step, followed.bound, 0)];
  }
  if (!Node.isObjectLiteralExpression(value)) return halt();
  if (step === EVERY_KEY) return value.getProperties().map((property) => carrying(writtenKey(property), followed.bound));
  return [writtenProperty(value, step, followed.bound)];
};

/** A record spread in that is a parameter no caller hands the key in (P299). */
const spreadParameterSilent = (spread: Followed, key: string, depth: number): boolean => {
  const declaration = declarationNamed(peeled(spread.value));
  return (
    declaration !== undefined &&
    Node.isParameterDeclaration(declaration) &&
    !spread.bound.has(declaration) &&
    !callersMayWrite(declaration, key, depth + 1)
  );
};

/**
 * The records `Object.assign(target, ...sources)` copies, the target first:
 * the record it answers holds each key of the last of them that writes it.
 */
const assignedSources = (value: TsNode): TsNode[] | undefined => {
  if (!Node.isCallExpression(value)) return undefined;
  if (peeled(value.getExpression()).getText().replace(/\s+/g, '') !== 'Object.assign') return undefined;
  const handed = value.getArguments();
  return handed.length === 0 ? undefined : handed;
};

/** Whether a value is written as nothing: `undefined`, `null`, or `void` of anything. */
const isNothing = (node: TsNode): boolean =>
  node.getKind() === SyntaxKind.NullKeyword ||
  node.getKind() === SyntaxKind.UndefinedKeyword ||
  Node.isVoidExpression(node) ||
  (Node.isIdentifier(node) && node.getText() === 'undefined');

/** The function callers call, for a parameter of it: a method, a named function, or the `const` holding an arrow. */
const callableOf = (parameter: ParameterDeclaration): Parameters<typeof callSitesOf>[0] | undefined => {
  const owner = parameter.getParent();
  if (Node.isMethodDeclaration(owner)) return owner;
  if (Node.isFunctionDeclaration(owner)) return owner.getName() === undefined ? undefined : owner;
  if (!Node.isArrowFunction(owner) && !Node.isFunctionExpression(owner)) return undefined;
  const holder = owner.getParent();
  if (Node.isPropertyDeclaration(holder)) return holder;
  return Node.isVariableDeclaration(holder) && isConstDeclaration(holder) ? holder : undefined;
};

/** What each parameter met was found to write of a key, worked out once per parameter and key. */
const CALLERS_WRITE = new WeakMap<ParameterDeclaration, Map<string, boolean>>();

/**
 * Whether any caller may hand a parameter a record writing a key (P299).
 *
 * `Object.assign({ TableName: table }, extra)` keeps the literal's table
 * unless `extra` writes one, and `extra` is what each caller hands: a caller
 * handing nothing, `undefined`, or a record written out without the key
 * leaves it as it was. Any other value - a record not written out, a key
 * computed, a function nothing names the callers of - may write it, and so
 * may a function no call names at all, which is read where it is.
 */
const callersMayWrite = (parameter: ParameterDeclaration, key: string, depth: number): boolean => {
  const known = CALLERS_WRITE.get(parameter)?.get(key);
  if (known !== undefined) return known;
  const answer = ((): boolean => {
    if (parameter.getDotDotDotToken() !== undefined) return true;
    const callable = callableOf(parameter);
    const owner = parameter.getParent();
    if (callable === undefined || !Node.isParametered(owner)) return true;
    const index = owner.getParameters().indexOf(parameter);
    const sites = callSitesOf(callable);
    if (sites.length === 0) return true;
    return sites.some((site) => {
      const handed = site.getArguments();
      if (handed.slice(0, index + 1).some((each) => Node.isSpreadElement(each))) return true;
      const argument = handed[index];
      if (argument === undefined) {
        const initial = parameter.getInitializer();
        return initial === undefined ? false : sourceMayWrite(initial, key, NO_BINDINGS, depth + 1);
      }
      return sourceMayWrite(argument, key, NO_BINDINGS, depth + 1);
    });
  })();
  const keys = CALLERS_WRITE.get(parameter) ?? new Map<string, boolean>();
  keys.set(key, answer);
  CALLERS_WRITE.set(parameter, keys);
  return answer;
};

/** Whether a value handed as a source of a record may write a key: anything not known to leave it as it was. */
const sourceMayWrite = (source: TsNode, key: string, bound: Bindings, depth: number): boolean => {
  if (depth > MOST_NESTED) return true;
  const followed = followValue(source, bound, depth + 1);
  if (followed.choices !== undefined) return followed.choices.some((choice) => sourceMayWrite(choice.value, key, choice.bound, depth + 1));
  const value = peeled(followed.value);
  if (isNothing(value)) return false;
  if (Node.isObjectLiteralExpression(value)) return writtenProperty(value, key, followed.bound, depth + 1) !== undefined;
  const nested = assignedSources(value);
  if (nested !== undefined) return nested.some((each) => Node.isSpreadElement(each) || sourceMayWrite(each, key, followed.bound, depth + 1));
  const declaration = declarationNamed(value);
  if (declaration !== undefined && Node.isParameterDeclaration(declaration) && !followed.bound.has(declaration)) {
    return callersMayWrite(declaration, key, depth + 1);
  }
  return true;
};

/**
 * What the record `Object.assign` answers holds under one key (P299): the
 * last source that writes it, each read as a spread is read. A source that
 * is a parameter no caller hands the key in leaves it to the sources before
 * it; one a caller may write it in stops the walk there, at the parameter,
 * which a reader of each caller reads again with it bound.
 */
const assignedProperty = (sources: readonly TsNode[], key: string, bound: Bindings, depth: number): LocatedSlot => {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (source === undefined) continue;
    if (Node.isSpreadElement(source) || depth > MOST_NESTED) return stopped(source);
    const followed = followValue(source, bound, depth + 1);
    if (followed.choices !== undefined) {
      if (followed.choices.some((choice) => sourceMayWrite(choice.value, key, choice.bound, depth + 1))) return stopped(source);
      continue;
    }
    const value = peeled(followed.value);
    if (isNothing(value)) continue;
    if (Node.isObjectLiteralExpression(value)) {
      const inner = writtenProperty(value, key, followed.bound, depth + 1);
      if (inner === undefined) continue;
      return inner;
    }
    const nested = assignedSources(value);
    if (nested !== undefined) {
      const inner = assignedProperty(nested, key, followed.bound, depth + 1);
      if (inner === undefined) continue;
      return inner;
    }
    const declaration = declarationNamed(value);
    if (declaration !== undefined && Node.isParameterDeclaration(declaration) && !followed.bound.has(declaration)) {
      if (!callersMayWrite(declaration, key, depth + 1)) continue;
      return { expression: source, reached: false, selector: declaration };
    }
    return stopped(source);
  }
  return undefined;
};

/** What the sources of an `Object.assign` give one key of its target (P332): each value, whether one is not read, and whether a value surely is given. */
interface Given {
  readonly values: readonly TsNode[];
  readonly changed: boolean;
  readonly surely: boolean;
}

const GIVES_NOTHING: Given = { values: [], changed: false, surely: false };
const GIVES_UNREAD: Given = { values: [], changed: true, surely: false };

/** One of several sources, as either may be: every value, not read where one is not, given surely where each gives one. */
const eitherGiven = (each: readonly Given[]): Given => ({
  values: each.flatMap((given) => given.values),
  changed: each.some((given) => given.changed),
  surely: each.length > 0 && each.every((given) => given.surely),
});

/** The `Object.assign` call a node is the target of, its first argument past parentheses and assertions (P332). */
const assignedOver = (node: TsNode): CallExpression | undefined => {
  const at = wrapped(node);
  const call = at.getParent();
  if (call === undefined || !Node.isCallExpression(call)) return undefined;
  return assignedSources(call)?.[0] === at ? call : undefined;
};

/**
 * What `Object.assign(target, ...sources)` lays over the target's key (P332):
 * from the last source back, each value a source may write, stopping at one
 * that surely writes it - so `Object.assign(this, defaults, { queue })` gives
 * the field the literal's `queue` only.
 */
const laidOver = (sources: readonly TsNode[], key: string, bound: Bindings, depth: number): Given => {
  const values: TsNode[] = [];
  let changed = false;
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (source === undefined) continue;
    const given = sourceGives(source, key, bound, depth);
    values.push(...given.values);
    changed ||= given.changed;
    if (given.surely) return { values, changed, surely: true };
  }
  return { values, changed, surely: false };
};

/**
 * What one source of `Object.assign` gives a key (P332): the value a record
 * written out holds under it, nothing where it is left out or the source is
 * nothing, what each caller hands a parameter - each `new` of the class, for
 * one its constructor takes - and, for anything else, a value not read: a
 * source not read may write any key, as a write by a key not read may.
 */
const sourceGives = (source: TsNode, key: string, bound: Bindings, depth: number): Given => {
  if (Node.isSpreadElement(source) || depth > MOST_NESTED) return GIVES_UNREAD;
  const followed = followValue(source, bound, depth + 1);
  if (followed.choices !== undefined) return eitherGiven(followed.choices.map((choice) => sourceGives(choice.value, key, choice.bound, depth + 1)));
  const value = peeled(followed.value);
  if (isNothing(value)) return GIVES_NOTHING;
  if (Node.isObjectLiteralExpression(value)) {
    const slot = writtenProperty(value, key, followed.bound, depth + 1);
    if (slot === undefined) return GIVES_NOTHING;
    return slot.reached && slot.bound === undefined ? { values: [slot.expression], changed: false, surely: true } : GIVES_UNREAD;
  }
  const nested = assignedSources(value);
  if (nested !== undefined) return laidOver(nested, key, followed.bound, depth + 1);
  const declaration = declarationNamed(value);
  if (declaration !== undefined && Node.isParameterDeclaration(declaration) && !followed.bound.has(declaration)) return handedGives(declaration, key, depth + 1);
  return GIVES_UNREAD;
};

/** What every caller hands a parameter gives a key, as a source of `Object.assign` (P332): each `new` of the class, for a constructor's. */
const handedGives = (parameter: ParameterDeclaration, key: string, depth: number): Given => {
  const owner = parameter.getParent();
  if (parameter.isRestParameter() || !Node.isParametered(owner)) return GIVES_UNREAD;
  const index = owner.getParameters().indexOf(parameter);
  let sites: (CallExpression | NewExpression)[] | undefined;
  if (Node.isConstructorDeclaration(owner)) {
    sites = constructionsOf(owner.getParent());
  } else {
    if (!callersMayWrite(parameter, key, depth)) return GIVES_NOTHING;
    const callable = callableOf(parameter);
    sites = callable === undefined ? undefined : callSitesOf(callable);
  }
  if (sites === undefined || sites.length === 0) return GIVES_UNREAD;
  return eitherGiven(
    sites.map((site) => {
      const handed = site.getArguments();
      if (handed.slice(0, index + 1).some((each) => Node.isSpreadElement(each))) return GIVES_UNREAD;
      const argument = handed[index] ?? parameter.getInitializer();
      return argument === undefined ? GIVES_NOTHING : sourceGives(argument, key, NO_BINDINGS, depth + 1);
    }),
  );
};

/**
 * Every `new` of a class this program declares, by its name (P332):
 * `undefined` for a class with no name, or one a class extends - whose
 * constructor is also run by each `super(...)` - which is not followed.
 */
const constructionsOf = (cls: TsNode | undefined): NewExpression[] | undefined => {
  if (cls === undefined || !Node.isClassDeclaration(cls) || derivedOf(cls).length > 0) return undefined;
  const name = cls.getNameNode();
  if (name === undefined) return undefined;
  const out: NewExpression[] = [];
  for (const reference of name.findReferencesAsNodes()) {
    if (reference === name) continue;
    const at = wrapped(reference);
    const parent = at.getParent();
    if (parent !== undefined && Node.isNewExpression(parent) && parent.getExpression() === at) out.push(parent);
  }
  return out;
};

/** Slots read out of a field of one of several classes, each saying which (P332). */
const fromField = (slots: LocatedSlot[], field: string | undefined): LocatedSlot[] =>
  field === undefined ? slots : slots.map((slot) => (slot === undefined ? slot : { ...slot, heldIn: field }));

/**
 * Every place a path of properties reaches from one expression, in order.
 *
 * One slot per element wherever the path says `*`, and per key where it says
 * `[key]`, so the result is as long as
 * the lists it went through. A slot that stopped stays where it stopped for the
 * rest of the path, and an absent key stays absent: both are answers about that
 * element, and dropping them would shift every later element onto the wrong
 * index of a sibling path walked over the same list.
 */
export const walkPath = (start: TsNode, path: readonly string[], bound: Bindings = NO_BINDINGS): LocatedSlot[] => {
  let slots: LocatedSlot[] = [carrying({ expression: start, reached: true }, bound)];
  for (const [index, step] of path.entries()) {
    slots = slots.flatMap((slot) =>
      slot === undefined || !slot.reached
        ? [slot]
        : stepInto(slot.expression, step, slot.bound ?? NO_BINDINGS).map((next) =>
            next === undefined || next.reached || next.rest !== undefined ? next : { ...next, rest: path.slice(index) },
          ),
    );
  }
  // A name a parameter the walk bound holds is what that parameter was handed;
  // a name that is an element of a list of several is each element (P272).
  return slots.flatMap((slot): LocatedSlot[] => {
    if (slot === undefined || !slot.reached) return [slot];
    const expression = slot.bound === undefined ? slot.expression : settled(slot.expression, slot.bound);
    // A parameter the walk bound is what it was handed, and no element of anything.
    const elements = handedValue(peeled(slot.expression), slot.bound ?? NO_BINDINGS) === undefined ? elementsNamed(peeled(expression), slot.bound ?? NO_BINDINGS, 0) : undefined;
    if (elements !== undefined && elements.length > 1) {
      return elements.map((element) => carrying({ ...slot, expression: settled(element.value, element.bound) }, element.bound));
    }
    return [slot.bound === undefined ? slot : { ...slot, expression }];
  });
};

/** How deep a tree of nodes is read before the rest of it is left unread. */
const MOST_TREE_DEPTH = 4;

/**
 * A key of every node of a tree, the root first and each node's children
 * after it (P286). A list of children not written out is one place that
 * stopped, which a reader says it could not read.
 */
const treeSlots = (node: TsNode, key: string, children: string, bound: Bindings, depth: number, seen = new Set<string>()): LocatedSlot[] => {
  // A node met before is read once: a tree built in a `let` the loop
  // reassigns holds the record it was before as its child (P290).
  const met = writtenAt(followValue(node, bound), node);
  if (seen.has(met)) return [];
  seen.add(met);
  const own = walkPath(node, [key], bound);
  if (depth >= MOST_TREE_DEPTH) return own;
  const under = walkPath(node, [children, EVERY_ELEMENT], bound);
  return [
    ...own,
    ...under.flatMap((child): LocatedSlot[] => {
      if (child === undefined) return [];
      // A node that is no record written out is already the place its key stopped.
      if (!child.reached) return (child.rest?.length ?? 0) > 1 ? [] : [child];
      return treeSlots(child.expression, key, children, child.bound ?? NO_BINDINGS, depth + 1, seen);
    }),
  ];
};

/** Where a value followed is written, with what the walk bound on the way: one place in the source per value. */
const writtenAt = (followed: Followed, asked: TsNode): string => {
  const at = (node: TsNode): string => `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
  const value = followed.choices === undefined ? followed.value : asked;
  const bound = [...followed.bound].map(([parameter, handed]) => `${at(parameter)}=${at(handed)}`).join(',');
  return `${at(value)}|${bound}`;
};

/**
 * The list a name is each element of, where it is one (P290): the list a
 * `for (const job of jobs)` loop goes through, or the list whose `map`,
 * `forEach` or other callback is handed it as its first parameter. A reader
 * that cannot read the element where it is named reads it as an element of
 * that list, which a caller may write out.
 */
export const listOfElement = (node: TsNode): TsNode | undefined => {
  const declaration = declarationNamed(peeled(node));
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    const list = declaration.getParent();
    const loop = list?.getParent();
    return Node.isIdentifier(declaration.getNameNode()) && list !== undefined && Node.isVariableDeclarationList(list) && loop !== undefined && Node.isForOfStatement(loop)
      ? loop.getExpression()
      : undefined;
  }
  if (!Node.isParameterDeclaration(declaration) || !Node.isIdentifier(declaration.getNameNode())) return undefined;
  const fn = declaration.getParent();
  if (!(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) || fn.getParameters()[0] !== declaration) return undefined;
  const call = fn.getParent();
  if (call === undefined || !Node.isCallExpression(call) || call.getArguments()[0] !== fn) return undefined;
  const callee = peeled(call.getExpression());
  return Node.isPropertyAccessExpression(callee) && ITERATING.has(callee.getName()) ? callee.getExpression() : undefined;
};

/** The name a `new` expression constructs, as written: `X` in `new X()` and in `new sdk.X()`. */
const constructedName = (construction: NewExpression): string | undefined => {
  const callee = construction.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/**
 * Every class a `new` may make, as the code names them: the class itself, or
 * past a `const` holding the class, each branch of the condition that chooses
 * it - `const Made = pro ? QueuePro : Queue` (P286).
 */
export const constructedNames = (callee: TsNode): string[] => {
  const names: string[] = [];
  const visit = (node: TsNode, depth: number): void => {
    const written = peeled(node);
    if (depth > 4) return;
    if (Node.isConditionalExpression(written)) {
      visit(written.getWhenTrue(), depth + 1);
      visit(written.getWhenFalse(), depth + 1);
      return;
    }
    if (Node.isBinaryExpression(written)) {
      const operator = written.getOperatorToken().getKind();
      if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
        visit(written.getLeft(), depth + 1);
        visit(written.getRight(), depth + 1);
      }
      return;
    }
    if (Node.isPropertyAccessExpression(written)) {
      names.push(written.getName());
      return;
    }
    if (!Node.isIdentifier(written)) return;
    const held = constValue(written);
    if (held === undefined) names.push(written.getText());
    else visit(held, depth + 1);
  };
  visit(callee, 0);
  return names;
};

/** Whether a `new` makes the class of this name, or may, where a condition chooses the class (P286). */
const constructs = (construction: NewExpression, className: string): boolean =>
  constructedNames(construction.getExpression()).includes(className);

/**
 * The argument of this call that is an instance of a class, by the class's name.
 *
 * Written as a construction — in the call, or in a `const` a statement earlier —
 * it is the construction, and its input can be walked. Anything else the checker
 * says is an instance of the class is still one, handed in from somewhere this
 * cannot see: the call is of the described shape, and its address is not
 * written here.
 */
const instanceArgument = (
  site: LocatorSite,
  className: string,
  bound: Bindings = NO_BINDINGS,
): { readonly instance: TsNode; readonly bound: Bindings } | undefined => {
  const written = argumentsOf(site);
  for (const argument of written) {
    const followed = followValue(argument, bound);
    if (Node.isNewExpression(followed.value) && constructedName(followed.value) === className) {
      return { instance: followed.value, bound: followed.bound };
    }
  }
  const instance = written.find(
    (argument) =>
      argument.getType().getSymbol()?.getName() === className || annotatedName(argument) === className,
  );
  return instance === undefined ? undefined : { instance, bound };
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

/** Two expressions that name the same binding: the key a value is stored under and an argument it was made with. */
const sameBinding = (left: TsNode | undefined, right: TsNode | undefined): boolean => {
  if (left === undefined || right === undefined) return false;
  const a = writtenValue(left);
  const b = writtenValue(right);
  if (!Node.isIdentifier(a) || !Node.isIdentifier(b)) return false;
  const declaration = a.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && declaration === b.getSymbol()?.getDeclarations()[0];
};

/** One write into a registry: the key and the value stored under it. */
interface RegistryWrite {
  readonly key: TsNode | undefined;
  readonly value: TsNode | undefined;
}

/**
 * Every write into a registry, where the registry is a field of the class or
 * a binding of the module the read is written in: `registry[key] = value` and
 * `registry.set(key, value)`, and an initialiser that is not empty, which is a
 * write nothing here can line up with a key.
 */
const registryWrites = (registry: TsNode): RegistryWrite[] | undefined => {
  const text = registry.getText();
  const field = Node.isPropertyAccessExpression(registry) && Node.isThisExpression(registry.getExpression());
  const scope: TsNode | undefined = field ? classesAround(registry)[0] : registry.getSourceFile();
  if (scope === undefined) return undefined;
  if (!field && !Node.isIdentifier(registry)) return undefined;
  const writes: RegistryWrite[] = [];
  scope.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const left = node.getLeft();
      if (Node.isElementAccessExpression(left) && left.getExpression().getText() === text) {
        writes.push({ key: left.getArgumentExpression(), value: node.getRight() });
      }
      return;
    }
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'set' && callee.getExpression().getText() === text) {
        const [key, value] = node.getArguments();
        writes.push({ key, value });
      }
    }
  });
  const declaration = registry.getSymbol()?.getDeclarations()[0];
  const initial =
    declaration !== undefined && (Node.isPropertyDeclaration(declaration) || Node.isVariableDeclaration(declaration))
      ? declaration.getInitializer()
      : undefined;
  if (initial !== undefined) {
    const value = writtenValue(initial);
    const empty =
      (Node.isObjectLiteralExpression(value) && value.getProperties().length === 0) ||
      (Node.isNewExpression(value) && (value.getArguments().length === 0));
    if (!empty) writes.push({ key: undefined, value });
  }
  return writes;
};

/**
 * The key a receiver is looked up by, where the registry it is looked up in
 * holds only clients made with their own key ({@link NameLocator}
 * `receiver-registry-key`).
 */
const registryKey = (site: LocatorSite, className: string, index: number): LocatedSlot[] => {
  const receiver = receiverOf(site);
  if (receiver === undefined) return [];
  let read = writtenValue(receiver);
  if (Node.isNonNullExpression(read)) read = read.getExpression();
  const found = registryOf(read);
  if (found === undefined) return [];
  const writes = registryWrites(found.registry);
  if (writes === undefined || writes.length === 0) return [];
  const made = writes.every(({ key, value }) => {
    const construction = value === undefined ? undefined : writtenValue(value);
    return (
      construction !== undefined &&
      Node.isNewExpression(construction) &&
      constructs(construction, className) &&
      sameBinding(key, construction.getArguments()[index])
    );
  });
  return made ? one(found.key) : [stopped(receiver)];
};

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
  // An element of a list of several written in its place is each element (P272).
  argument: (site, locator) => {
    const argument = argumentsOf(site)[locator.index];
    return argument === undefined ? [] : walkPath(argument, []);
  },
  'argument-property': (site, locator) => {
    const argument = argumentsOf(site)[locator.index];
    const fallback = locator.otherwise === undefined ? undefined : argumentsOf(site)[locator.otherwise];
    if (fallback !== undefined && (argument === undefined || lacksKey(argument, locator.key))) return walkPath(fallback, []);
    return one(propertyOf(argument, locator.key));
  },
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
  'argument-path': (site, locator, context) => {
    const argument = argumentsOf(site)[locator.index];
    return argument === undefined ? [] : walkPath(argument, locator.path, context.bound);
  },
  'argument-tree': (site, locator, context) => {
    const argument = argumentsOf(site)[locator.index];
    if (argument === undefined) return [];
    const bound = context.bound ?? NO_BINDINGS;
    // Each root a path reaches - every tree of a list of them - read in turn.
    const roots = locator.path === undefined ? [carrying({ expression: argument, reached: true }, bound)] : walkPath(argument, locator.path, bound);
    return roots.flatMap((root): LocatedSlot[] =>
      root === undefined || !root.reached ? [root] : treeSlots(root.expression, locator.key, locator.children, root.bound ?? bound, 0),
    );
  },
  'constructed-argument-path': (site, locator, context) => {
    const found = instanceArgument(site, locator.class, context.bound);
    if (found === undefined) return [];
    const { instance, bound } = found;
    if (!Node.isNewExpression(instance)) return [stopped(instance)];
    const input = instance.getArguments()[locator.index ?? 0];
    return input === undefined ? [undefined] : walkPath(input, locator.path, bound);
  },
  'receiver-constructed-path': (site, locator, context) => {
    const receiver = receiverOf(site);
    if (receiver === undefined) return [];
    const made = followValue(receiver, context.bound);
    const read = (instance: Followed, at: TsNode): LocatedSlot[] => {
      if (!Node.isNewExpression(instance.value) || !constructs(instance.value, locator.class)) return [stopped(at)];
      const input = instance.value.getArguments()[locator.index ?? 0];
      return input === undefined ? [undefined] : walkPath(input, locator.path, instance.bound);
    };
    // A static field of either of several classes: each one's instance, saying which (P332).
    if (made.choices !== undefined && made.choices.every((choice) => choice.heldIn !== undefined)) {
      return made.choices.flatMap((choice) => fromField(read(followValue(choice.value, choice.bound), choice.value), choice.heldIn));
    }
    return read(made, receiver);
  },
  'receiver-registry-key': (site, locator) => registryKey(site, locator.class, locator.index ?? 0),
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
