import {
  forwardedFrom,
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
import { Node, SyntaxKind, type ClassDeclaration, type NewExpression, type Node as TsNode, type ParameterDeclaration } from 'ts-morph';
import { isResolved, resolveChannelName, type ChannelResolution } from './channel-name.js';

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
        out.push(forwarded.undecided ? { ...reading, undecided: true } : reading);
      }
      if (out.length > MOST_READINGS) return [unread(node, `${node.getText()} stands for more queues than are read.`, bound, through)];
    }
    return out;
  }
  return [{ resolution, bound, through, undecided: false }];
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
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'bind') return undefined;
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
export const constructsFrom = (construction: NewExpression, className: string, packages: readonly string[]): boolean => {
  const callee = unwrapped(construction.getExpression());
  const binding = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
  if (!Node.isIdentifier(binding)) return false;
  const imported = importOf(binding);
  if (imported === undefined) return false;
  const module = packages.includes(imported.module) ? imported.module : packageOfSpecifier(imported.module);
  if (module === undefined || !packages.includes(module)) return false;
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : imported.exported;
  return name === className;
};
