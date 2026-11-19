import {
  forwardedFrom,
  functionOf,
  importOf,
  loopOver,
  methodNamedOn,
  namedFunction,
  originOfValue,
  packageOfSpecifier,
  recordEntriesOf,
  type ClassMethod,
  type FlowatlasConfig,
  type NamedFunction,
  type TakenElement,
} from '@flowatlas/core';
import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type ClassDeclaration,
  type NewExpression,
  type Node as TsNode,
  type ParameterDeclaration,
} from 'ts-morph';
import { isResolved, resolveChannelName, type ChannelResolution } from './channel-name.js';
import { fieldIndex } from './forwarded.js';

/**
 * A worker started by a construction, read once per queue it is started on
 * (P271).
 *
 * `new Worker('mail', processor)` starts receiving where it is written, as a
 * subscribe call does; the queue is the first argument and the handler the
 * second. A service with a queue per kind of job writes it once, in a
 * function handed the queue's name, called in a loop over a record of
 * handlers - `for (const name of Object.keys(handlers)) this.start(name)` -
 * the processor looking the handler up by the same name:
 * `handlers[name](job)`. Read where it is written, the name is a parameter
 * and every queue had producers and no consumer. So the name is followed out
 * to each caller and through each loop it is a variable of, to every element
 * the code states, and each element is read as a queue of its own, its
 * handler the member of the record the processor looks it up in.
 */

/** What each loop variable and parameter a reading went through holds. */
export type Bound = ReadonlyMap<TsNode, TakenElement>;

/** One queue a construction's name argument stands for. */
export interface NameReading {
  readonly resolution: ChannelResolution;
  /** What every loop variable on the way holds for this reading. */
  readonly bound: Bound;
  /** The functions the name was handed out of, innermost first. */
  readonly through: readonly string[];
  /** A call on the way may run another function instead (R158). */
  readonly undecided: boolean;
  /** The calls the name was handed out through, innermost first (P290). */
  readonly hops?: readonly CallExpression[];
  /**
   * The class whose instances this queue is, where a field kept from the
   * constructor decided it: the class whose `super(...)` hands it, or whose
   * `new` does (P290). What else the worker is handed is read off the same
   * instances.
   */
  readonly instance?: ClassDeclaration;
  /** Whether the instances are of that class alone: a `new` of it made them, not a class extending it. */
  readonly exact?: boolean;
}

/** How many calls out a name is followed. */
const MOST_HOPS = 4;
/** How many readings one construction is read as, at most. */
const MOST_READINGS = 512;

const unwrapped = (node: TsNode): TsNode => {
  let current = node;
  for (let step = 0; step < 8; step += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

/** The declaration a name stands for, the variable a shorthand copies included. */
const declarationOf = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node)) return undefined;
  const parent = node.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
      ? parent.getValueSymbol()
      : node.getSymbol();
  return symbol?.getDeclarations()[0];
};

/** A function as a reader names it: `Class.method`, or the function's own name. */
const labelOfParameter = (parameter: ParameterDeclaration): string => {
  const owner = parameter.getParent();
  const name = Node.isMethodDeclaration(owner) || Node.isFunctionDeclaration(owner) ? owner.getName() : undefined;
  const cls = owner.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
  const holder = owner.getParent();
  const kept = Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) ? holder.getName() : undefined;
  const own = name ?? kept ?? '?';
  return cls === undefined ? own : `${cls}.${own}`;
};

const unread = (expression: TsNode, why: string | undefined, bound: Bound, through: readonly string[], undecided = false): NameReading => ({
  resolution: {
    unresolved: 'channel-dynamic',
    text: expression.getText().slice(0, 60),
    ...(why === undefined ? {} : { why }),
  },
  bound,
  through,
  undecided,
});

/**
 * Every queue a name handed to a construction stands for: read where it is
 * written, through each loop it is a variable of, and out to each caller of
 * the function it is a parameter of.
 */
export const namesHandedTo = (
  expression: TsNode,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
  bound: Bound = new Map(),
  through: readonly string[] = [],
  depth = 0,
): NameReading[] => {
  const node = unwrapped(expression);
  const resolution = resolveChannelName(node, config);
  if (isResolved(resolution)) return [{ resolution, bound, through, undecided: false }];
  // A field the instance keeps from its constructor: what each construction
  // of the class, and each class extending it, hands that constructor (P286).
  if (Node.isPropertyAccessExpression(node) && Node.isThisExpression(unwrapped(node.getExpression()))) {
    const owner = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const index = owner === undefined ? undefined : fieldIndex(owner, node.getName());
    if (owner !== undefined && index !== undefined && depth <= MOST_HOPS * 2) return builtWith(node, owner, index, config, bound, through, depth + 1);
    return [{ resolution, bound, through, undecided: false }];
  }
  const declaration = declarationOf(node);
  if (declaration === undefined || depth > MOST_HOPS * 2) return [{ resolution, bound, through, undecided: false }];
  const held = bound.get(declaration);
  if (held !== undefined) {
    if (held.name !== undefined) return [{ resolution: { name: held.name, names: [held.name], via: 'literal' }, bound, through, undecided: false }];
    if (held.value !== undefined) return namesHandedTo(held.value, config, bound, through, depth + 1);
    return [unread(node, `${node.getText()} is an element nothing here writes out.`, bound, through)];
  }
  const loop = loopOver(declaration);
  if (loop !== undefined) {
    if ('why' in loop) return [unread(node, `${node.getText()} is each element of ${loop.source.getText().slice(0, 60)}, and ${loop.why}`, bound, through)];
    const out: NameReading[] = [];
    for (const element of loop.elements) {
      if (!element.has(declaration)) return [unread(node, `${node.getText()} is a whole entry of ${loop.source.getText().slice(0, 60)}, not its key.`, bound, through)];
      out.push(...namesHandedTo(node, config, new Map([...bound, ...element]), through, depth + 1));
      if (out.length > MOST_READINGS) return [unread(node, `${node.getText()} stands for more queues than are read.`, bound, through)];
    }
    return out;
  }
  // A constructor's parameter is what every construction hands it (P286).
  const constructor = Node.isParameterDeclaration(declaration) ? declaration.getParent() : undefined;
  if (Node.isParameterDeclaration(declaration) && constructor !== undefined && Node.isConstructorDeclaration(constructor)) {
    const owner = constructor.getParent();
    if (Node.isClassDeclaration(owner)) return builtWith(node, owner, constructor.getParameters().indexOf(declaration), config, bound, through, depth + 1);
  }
  if (Node.isParameterDeclaration(declaration) && through.length < MOST_HOPS) {
    const forwarded = forwardedFrom(declaration);
    const named = [...through, labelOfParameter(declaration)];
    if (forwarded.calls.length === 0) {
      return [
        unread(
          node,
          forwarded.undecided
            ? `The queue is the parameter ${declaration.getName()}, handed in by a call that may run another function.`
            : `The queue is the parameter ${declaration.getName()}, and nothing calls its function.`,
          bound,
          through,
          forwarded.undecided,
        ),
      ];
    }
    const out: NameReading[] = [];
    for (const call of forwarded.calls) {
      for (const reading of namesHandedTo(call.argument, config, bound, named, depth + 1)) {
        const hopped = { ...reading, hops: [...call.hops, ...(reading.hops ?? [])] };
        out.push(forwarded.undecided ? { ...hopped, undecided: true } : hopped);
      }
      if (out.length > MOST_READINGS) return [unread(node, `${node.getText()} stands for more queues than are read.`, bound, through)];
    }
    return out;
  }
  return [{ resolution, bound, through, undecided: false }];
};

/** Readings of the instances of a class, where nothing nearer the instance decided them. */
const ofInstances = (readings: readonly NameReading[], cls: ClassDeclaration, exact = false): NameReading[] =>
  readings.map((reading) => (reading.instance === undefined ? { ...reading, instance: cls, ...(exact ? { exact } : {}) } : reading));

/** How many classes down from a base its constructions are looked for. */
const MOST_GENERATIONS = 4;

/**
 * Every value an instance of `owner` is built with at its constructor's
 * argument `index` (P286): what each `new` of it hands there, and what each
 * class extending it hands `super(...)` there - a value that class takes as
 * its own constructor's argument being what its constructions hand it. A
 * class extending it with no constructor of its own is built as it is.
 */
const builtWith = (
  at: TsNode,
  owner: ClassDeclaration,
  index: number,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
  bound: Bound,
  through: readonly string[],
  depth: number,
  generation = 0,
): NameReading[] => {
  const out: NameReading[] = [];
  const name = owner.getName() ?? 'the class';
  const nameNode = owner.getNameNode();
  for (const reference of nameNode?.findReferencesAsNodes() ?? []) {
    const made = reference.getParent();
    if (made === undefined || !Node.isNewExpression(made) || made.getExpression() !== reference) continue;
    const argument = made.getArguments()[index];
    if (argument === undefined) continue;
    out.push(...ofInstances(namesHandedTo(argument, config, bound, [...through, `new ${name}`], depth + 1), owner, true));
  }
  if (generation < MOST_GENERATIONS) {
    for (const derived of owner.getDerivedClasses()) {
      if (derived.getBaseClass() !== owner) continue;
      const constructor = derived.getConstructors()[0];
      if (constructor === undefined) {
        out.push(...builtWith(at, derived, index, config, bound, through, depth + 1, generation + 1));
        continue;
      }
      const handed = constructor
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find((call) => call.getExpression().getKind() === SyntaxKind.SuperKeyword)
        ?.getArguments()[index];
      if (handed === undefined) continue;
      out.push(...ofInstances(namesHandedTo(handed, config, bound, [...through, derived.getName() ?? '?'], depth + 1), derived));
    }
  }
  if (out.length > MOST_READINGS) return [unread(at, `${at.getText()} stands for more queues than are read.`, bound, through)];
  return out.length > 0 ? out : [unread(at, `${at.getText()} is what ${name} is built with, and nothing here builds it.`, bound, through)];
};

/** Whether a class is the other or extends it, however far up. */
const extendsOrIs = (cls: ClassDeclaration, other: ClassDeclaration): boolean => {
  let current: ClassDeclaration | undefined = cls;
  for (let step = 0; step < 8 && current !== undefined; step += 1) {
    if (current === other) return true;
    current = current.getBaseClass();
  }
  return false;
};

/** The class a call's method is declared in, where it is a method of a class. */
const classCalled = (call: CallExpression): ClassDeclaration | undefined => {
  const callee = unwrapped(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const declared = callee.getNameNode().getSymbol()?.getDeclarations()[0];
  const owner = declared?.getParent();
  return owner !== undefined && Node.isClassDeclaration(owner) ? owner : undefined;
};

/** The class a `new` makes, where it names a class of the repository. */
const classMade = (made: TsNode): ClassDeclaration | undefined => {
  const node = unwrapped(made);
  if (!Node.isNewExpression(node)) return undefined;
  const declaration = node.getExpression().getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/**
 * The instances a call is made on (P290): of the class it is written in, or
 * one extending it, for `this`; of the class a `new` makes alone, for a `new`
 * the call is made on or a `const` or field holding one; else of the class
 * the receiver is typed as, or one extending it.
 */
const instancesCalledOn = (call: CallExpression): { cls: ClassDeclaration; exact: boolean } | undefined => {
  const callee = unwrapped(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const receiver = unwrapped(callee.getExpression());
  if (Node.isThisExpression(receiver) || receiver.getKind() === SyntaxKind.SuperKeyword) {
    const cls = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    return cls === undefined ? undefined : { cls, exact: false };
  }
  const name = Node.isPropertyAccessExpression(receiver) ? receiver.getNameNode() : receiver;
  const held = name.getSymbol()?.getDeclarations()[0];
  const kept =
    held !== undefined &&
    ((Node.isVariableDeclaration(held) && held.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const) ||
      (Node.isPropertyDeclaration(held) && held.isReadonly()))
      ? held.getInitializer()
      : undefined;
  const made = classMade(receiver) ?? (kept === undefined ? undefined : classMade(kept));
  if (made !== undefined) return { cls: made, exact: true };
  const declaration = receiver
    .getType()
    .getSymbol()
    ?.getDeclarations()
    .find((each) => Node.isClassDeclaration(each));
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? { cls: declaration, exact: false } : undefined;
};

/**
 * Whether a call may run on an instance a reading is of (P290): a call of a
 * method of the instance's lineage made on instances some of which are the
 * reading's - a class and those extending it, or one class alone. Any other
 * call is no call on the instance and is not asked.
 */
const runsOn = (call: CallExpression, reading: NameReading): boolean => {
  const instance = reading.instance;
  const called = classCalled(call);
  if (instance === undefined || called === undefined || !extendsOrIs(instance, called)) return true;
  const on = instancesCalledOn(call);
  if (on === undefined) return true;
  if (reading.exact === true) return on.exact ? on.cls === instance : extendsOrIs(instance, on.cls);
  return on.exact ? extendsOrIs(on.cls, instance) : extendsOrIs(instance, on.cls) || extendsOrIs(on.cls, instance);
};

/** The parameter a value is, where it is a parameter's name. */
const parameterNamed = (value: TsNode): ParameterDeclaration | undefined => {
  const declaration = declarationOf(unwrapped(value));
  return declaration !== undefined && Node.isParameterDeclaration(declaration) ? declaration : undefined;
};

/** Whether a call calls the function a parameter belongs to. */
const callsOwnerOf = (call: CallExpression, parameter: ParameterDeclaration): boolean => {
  const fn = parameter.getParent();
  const callee = unwrapped(call.getExpression());
  const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  const declarations = name.getSymbol()?.getDeclarations() ?? [];
  return declarations.some(
    (declaration) =>
      declaration === fn ||
      ((Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) && declaration.getInitializer() === fn),
  );
};

/**
 * What a worker made where a queue is read is handed at another argument -
 * its processor - for that queue (P290): followed out along the very calls
 * the queue was handed through, then, where it is still a parameter, out to
 * every call that hands it in on an instance the queue is the queue of. A
 * worker a base class makes from what each class extending it hands it is
 * one worker per class, each running what that class hands. `undefined`
 * where nothing out there hands it in.
 */
export const handedAlong = (value: TsNode, reading: NameReading): TsNode[] | undefined => {
  let current = value;
  for (const hop of reading.hops ?? []) {
    const parameter = parameterNamed(current);
    if (parameter === undefined) return [current];
    if (!callsOwnerOf(hop, parameter)) break;
    const fn = parameter.getParent();
    const position = Node.isParametered(fn) ? fn.getParameters().indexOf(parameter) : -1;
    const handed = (position < 0 ? undefined : hop.getArguments()[position]) ?? parameter.getInitializer();
    if (handed === undefined || Node.isSpreadElement(handed)) return undefined;
    current = handed;
  }
  const parameter = parameterNamed(current);
  if (parameter === undefined) return [current];
  const forwarded = forwardedFrom(parameter);
  const calls = forwarded.calls.filter((call) => call.hops.every((hop) => runsOn(hop, reading)));
  return calls.length === 0 ? undefined : calls.map((call) => call.argument);
};

/** The function a handler is: a method of the class, or a function of the repository's own. */
export type HandlerTarget =
  | { readonly kind: 'method'; readonly method: ClassMethod }
  | { readonly kind: 'function'; readonly fn: NamedFunction };

/** Whether a declaration sits at a module's top, where the graph names it. */
const atModuleTop = (declaration: TsNode): boolean =>
  declaration.getFirstAncestor(
    (node) =>
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isConstructorDeclaration(node),
  ) === undefined;

/**
 * The function a value hands over to run: a function of the repository's own
 * named by it, `this.method` (bound or not), or what a loop variable holds.
 */
export const functionBehind = (value: TsNode, owner: ClassDeclaration | undefined, bound: Bound, depth = 0): HandlerTarget | undefined => {
  let node = unwrapped(value);
  if (depth > 4) return undefined;
  if (Node.isCallExpression(node)) {
    const callee = unwrapped(node.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'bind') {
      // A processor a function of the repository makes and answers -
      // `this.processor()` answering `async (job) => ...` - runs as part of
      // the function that writes it (P290).
      const maker = functionBehind(callee, owner, bound, depth + 1);
      const written = maker === undefined ? undefined : maker.kind === 'method' ? functionOf(maker.method) : maker.fn.declaration;
      return written !== undefined && answersFunction(written) ? maker : undefined;
    }
    node = unwrapped(callee.getExpression());
  }
  if (Node.isPropertyAccessExpression(node) && Node.isThisExpression(unwrapped(node.getExpression()))) {
    const method = owner === undefined ? undefined : methodNamedOn(owner, node.getName());
    return method === undefined ? undefined : { kind: 'method', method };
  }
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = declarationOf(node);
  const held = declaration === undefined ? undefined : bound.get(declaration);
  if (held?.value !== undefined) return functionBehind(held.value, owner, bound, depth + 1);
  const origin = originOfValue(node);
  if (origin.kind !== 'local' || !atModuleTop(origin.declaration)) return undefined;
  const fn = namedFunction(origin.declaration);
  return fn === undefined ? undefined : { kind: 'function', fn };
};

/** Whether a function answers a function it writes: a concise arrow body, or a `return` of one of its own. */
const answersFunction = (declaration: TsNode): boolean => {
  const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn))) return false;
  const body = fn.getBody();
  if (body === undefined) return false;
  const isFunction = (node: TsNode | undefined): boolean => node !== undefined && (Node.isArrowFunction(unwrapped(node)) || Node.isFunctionExpression(unwrapped(node)));
  if (!Node.isBlock(body)) return isFunction(body);
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .some(
      (statement) =>
        statement.getFirstAncestor((each) => Node.isFunctionLikeDeclaration(each) || Node.isArrowFunction(each) || Node.isFunctionExpression(each)) === fn &&
        isFunction(statement.getExpression()),
    );
};

/** The body a declaration is visible in: the function that declares it, or its module. */
const scopeOfDeclaration = (declaration: TsNode): TsNode =>
  declaration.getFirstAncestor(
    (node) =>
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isConstructorDeclaration(node),
  ) ?? declaration.getSourceFile();

/** How many local functions a processor is followed through. */
const MOST_LOCALS = 8;

/**
 * The processor and the functions of the body it is written in that it runs
 * or hands on, by name: `const processor = (job) => run(handler, job)` with
 * `const handler = (job) => handlers[name](job)` beside it.
 */
const processorBodies = (processor: TsNode, scope: TsNode): TsNode[] => {
  const reached: TsNode[] = [];
  const pending: TsNode[] = [processor];
  while (pending.length > 0 && reached.length < MOST_LOCALS) {
    const node = pending.shift() as TsNode;
    if (reached.includes(node)) continue;
    reached.push(node);
    const names = Node.isIdentifier(node) ? [node] : node.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const name of names) {
      const declaration = declarationOf(name);
      if (declaration === undefined || declaration.getFirstAncestor((each) => each === scope) === undefined) continue;
      const written = Node.isVariableDeclaration(declaration)
        ? declaration.getInitializer()
        : Node.isFunctionDeclaration(declaration)
          ? declaration
          : undefined;
      if (written === undefined) continue;
      const fn = unwrapped(written);
      if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn)) && !reached.includes(fn)) pending.push(fn);
    }
  }
  return reached;
};

/**
 * The record a processor looks its handler up in by the queue's own name,
 * where it does: `handlers[name](job)` in the processor or a function of the
 * body it runs, `name` the same binding the construction is handed. One
 * record, or none.
 */
export const dispatchRecord = (nameArgument: TsNode, processor: TsNode | undefined): TsNode | undefined => {
  const name = unwrapped(nameArgument);
  const declaration = declarationOf(name);
  if (declaration === undefined || processor === undefined) return undefined;
  const records = new Map<string, TsNode>();
  for (const body of processorBodies(processor, scopeOfDeclaration(declaration))) {
    for (const call of [body, ...body.getDescendantsOfKind(SyntaxKind.CallExpression)]) {
      if (!Node.isCallExpression(call)) continue;
      const callee = unwrapped(call.getExpression());
      if (!Node.isElementAccessExpression(callee)) continue;
      const key = callee.getArgumentExpression();
      if (key === undefined || declarationOf(unwrapped(key)) !== declaration) continue;
      const record = callee.getExpression();
      records.set(record.getText(), record);
    }
  }
  const [only, ...more] = [...records.values()];
  return more.length === 0 ? only : undefined;
};

/** The handler a record holds under a queue's name, where it is one of the repository's functions. */
export const handlerInRecord = (record: TsNode, key: string, owner: ClassDeclaration | undefined): HandlerTarget | undefined => {
  const entries = recordEntriesOf(record);
  if ('why' in entries) return undefined;
  const value = entries.entries.find((entry) => entry.key === key)?.value;
  return value === undefined ? undefined : functionBehind(value, owner, new Map());
};

/** Whether a construction makes the transport's class: imported by that name from one of its packages. */
export const constructsFrom = (construction: NewExpression, className: string, packages: readonly string[]): boolean =>
  classesConstructed(construction.getExpression()).some((callee) => isTransportClass(callee, className, packages));

/**
 * The classes a `new` may make, as written: the callee, or past a `const`
 * holding a class, each branch of the condition choosing it - `const Made =
 * pro ? WorkerPro : Worker` (P286).
 */
const classesConstructed = (callee: TsNode, depth = 0): TsNode[] => {
  const node = unwrapped(callee);
  if (depth > 4) return [node];
  if (Node.isConditionalExpression(node)) return [...classesConstructed(node.getWhenTrue(), depth + 1), ...classesConstructed(node.getWhenFalse(), depth + 1)];
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    return operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken
      ? [...classesConstructed(node.getLeft(), depth + 1), ...classesConstructed(node.getRight(), depth + 1)]
      : [];
  }
  if (!Node.isIdentifier(node)) return [node];
  const declaration = node.getSymbol()?.getDeclarations()[0];
  const held =
    declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
      ? declaration.getInitializer()
      : undefined;
  // A `const` bound to `require('pkg')` is the package's import, read as one.
  if (held === undefined || (Node.isCallExpression(held) && held.getExpression().getText() === 'require')) return [node];
  return classesConstructed(held, depth + 1);
};

/** Whether a class as written is the transport's: imported by that name from one of its packages. */
const isTransportClass = (written: TsNode, className: string, packages: readonly string[]): boolean => {
  const callee = unwrapped(written);
  const binding = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
  if (!Node.isIdentifier(binding)) return false;
  const imported = importOf(binding);
  if (imported === undefined) return false;
  const module = packages.includes(imported.module) ? imported.module : packageOfSpecifier(imported.module);
  if (module === undefined || !packages.includes(module)) return false;
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : imported.exported;
  return name === className;
};
