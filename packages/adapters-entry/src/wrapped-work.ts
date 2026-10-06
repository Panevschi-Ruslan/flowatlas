import { boundDeclaration, originOfValue, type Confidence, type Origin } from '@flowatlas/core';
import {
  Node,
  VariableDeclarationKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node as TsNode,
  type ParameterDeclaration,
} from 'ts-morph';
import { isWrittenFunction, packageOfCall, repoFunctionOf, unwrapValue } from './shared.js';

/**
 * A call that wraps one function, and how far that is known.
 *
 * `traced('createLoan', createLoan)`, `withRetry({ attempts: 3 }, recordReturn)`
 * and `instrument(placeHold, { segment: 'holds' })` are one shape: a call handed
 * exactly one function, among names and options, that hands back the function
 * that runs. Where the function sits among the arguments is the wrapper's
 * business and says nothing about whether it is one (R167).
 */
export interface Wrapped {
  readonly call: CallExpression;
  /** The one function argument, as written. */
  readonly argument: TsNode;
  /**
   * `static` when the wrapper's own source was read and visibly hands the
   * function on, or when the package it is declared in says it hands back a
   * function; `heuristic` when nothing of the wrapper, or of a wrapper it hands
   * the function to, could be read.
   */
  readonly confidence: Confidence;
  /** Why it is `heuristic`, said so that the reader can do something about it. */
  readonly why?: string;
}

/** What reading a wrapper said about it, short of the call it was read for. */
type Evidence = Pick<Wrapped, 'confidence' | 'why'>;

type FunctionLike = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;

/**
 * How deep wrappers inside wrappers, names bound to them, and wrappers that hand
 * their function to another wrapper are followed.
 */
const WRAP_DEPTH = 8;

const STATIC: Evidence = Object.freeze({ confidence: 'static' });

const heuristic = (why: string): Evidence => ({ confidence: 'heuristic', why });

const isFunctionLike = (node: TsNode): node is FunctionLike =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node);

/** The function a node is written in, nearest first. */
const enclosingFunction = (node: TsNode): FunctionLike | undefined =>
  node.getFirstAncestor(isFunctionLike) as FunctionLike | undefined;

/** Whether the checker gives a value a call signature. */
const isCallable = (node: TsNode): boolean => {
  try {
    return node.getType().getCallSignatures().length > 0;
  } catch {
    return false;
  }
};

const calleeText = (call: CallExpression): string => call.getExpression().getText().replace(/\s+/g, ' ');

/**
 * The call a `const` holds, when a name stands for the value a call built.
 *
 * `const createLoanLogic = traced('createLoan', async (event) => …)` and then
 * `middy(createLoanLogic)`: the name is the wrapped function as far as anything
 * that runs it is concerned. Only a `const`, because a name assigned twice holds
 * whichever value the program got to last. The name may be a member of a
 * namespace, `middy(logic.createLoan)`, and may be bound to other names on the
 * way to the call (R168).
 */
export const boundCall = (node: TsNode): CallExpression | undefined => {
  const origin = originOfValue(unwrapValue(node));
  if (origin.kind !== 'local') return undefined;
  const declaration = boundDeclaration(origin.declaration);
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const list = declaration.getParent();
  if (!Node.isVariableDeclarationList(list) || list.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return undefined;
  }
  const initializer = declaration.getInitializer();
  const bound = initializer === undefined ? undefined : unwrapValue(initializer);
  return bound !== undefined && Node.isCallExpression(bound) ? bound : undefined;
};

/** A wrapped function, written as the wrapper call or as a name bound to one. */
const wrappedValue = (node: TsNode, depth: number): Wrapped | undefined => {
  const value = unwrapValue(node);
  const call = Node.isCallExpression(value) ? value : boundCall(value);
  return call === undefined ? undefined : wrappedBy(call, depth + 1);
};

/**
 * Whether an argument is a function: written in place, a function this
 * repository declares, a function a wrapper built, or anything the checker types
 * as callable.
 *
 * The last is what keeps the count honest. A call handed two functions is not a
 * wrapper of either, and a callback from a package is as much one of the two as
 * a function written here, though only the second can be landed on.
 */
const isFunctionArgument = (argument: TsNode, depth: number): boolean => {
  const value = unwrapValue(argument);
  return (
    isWrittenFunction(value) ||
    repoFunctionOf(value) !== undefined ||
    wrappedValue(value, depth) !== undefined ||
    isCallable(value)
  );
};

/** What a function hands back: its concise body, or what its own `return`s say. */
const returnedBy = (fn: FunctionLike): TsNode[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [unwrapValue(body)];
  const out: TsNode[] = [];
  for (const statement of body.getDescendants()) {
    if (!Node.isReturnStatement(statement) || enclosingFunction(statement) !== fn) continue;
    const expression = statement.getExpression();
    if (expression !== undefined) out.push(unwrapValue(expression));
  }
  return out;
};

/** Whether a name is the parameter, rather than something else spelled the same. */
const isParameter = (node: TsNode, parameter: ParameterDeclaration): boolean => {
  const value = unwrapValue(node);
  if (!Node.isIdentifier(value)) return false;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  return declaration === undefined ? value.getText() === parameter.getName() : declaration === parameter;
};

/** How a call runs the function it was handed: `fn(…)`, `fn.call(this, …)` or `fn.apply(this, list)`. */
type CallForm = 'direct' | 'call' | 'apply';

/** A call that runs the parameter, in what form, and how sure that is. */
interface Run {
  readonly form: CallForm;
  readonly evidence: Evidence;
}

/**
 * How a call runs the parameter, or undefined when it does not run it.
 *
 * `fn(…)`, `fn.call(…)` and `fn.apply(…)` run it outright; `withSpan(name,
 * fn)(…)` runs what another wrapper made of it, and is as sure as that wrapper.
 */
const runOf = (call: CallExpression, parameter: ParameterDeclaration, depth: number): Run | undefined => {
  const callee = unwrapValue(call.getExpression());
  if (isParameter(callee, parameter)) return { form: 'direct', evidence: STATIC };
  if (Node.isCallExpression(callee)) {
    const inner = wrappedBy(callee, depth + 1);
    return inner !== undefined && isParameter(inner.argument, parameter) ? { form: 'direct', evidence: evidenceOf([inner]) } : undefined;
  }
  if (!Node.isPropertyAccessExpression(callee) || !isParameter(callee.getExpression(), parameter)) return undefined;
  const method = callee.getName();
  return method === 'call' || method === 'apply' ? { form: method, evidence: STATIC } : undefined;
};

/**
 * Whether a call hands on every argument the function it is written in was
 * given: `fn(event, context)` inside `async (event, context) => …`, `fn(...args)`
 * inside `(...args) => …`, and `fn.apply(this, arguments)`.
 *
 * That is what delegating looks like, and it is what tells a wrapper from a
 * factory that also calls what it was handed: `listFactory`'s `ownerOf(req)` is
 * given one of a request handler's arguments, and answers nothing (R137).
 *
 * A function of one argument proves nothing this way - `pick(event)` inside
 * `(event) => …` is as much a factory using its function as a wrapper running
 * it - so there only what the function returns can say (`isReturnedFrom`).
 */
const forwardsAll = (call: CallExpression, form: CallForm, around: FunctionLike): boolean => {
  const parameters = around.getParameters();
  const args = call.getArguments().slice(form === 'direct' ? 0 : 1);
  if (form === 'apply') {
    const list = args[0];
    const rest = parameters.at(-1);
    return list !== undefined && (list.getText() === 'arguments' || (rest?.isRestParameter() === true && isParameter(list, rest)));
  }
  if (args.some((arg) => Node.isSpreadElement(arg) && arg.getExpression().getText() === 'arguments')) return true;
  if (parameters.length === 0) return false;
  if (parameters.length === 1 && !(parameters[0] as ParameterDeclaration).isRestParameter()) return false;
  return parameters.every((parameter, index) => {
    const arg = args[index];
    if (arg === undefined) return false;
    if (parameter.isRestParameter()) return Node.isSpreadElement(arg) && isParameter(arg.getExpression(), parameter);
    return isParameter(arg, parameter);
  });
};

/**
 * Whether a call's result is what the function it is written in hands back,
 * directly or through a `const` that is returned:
 * `const result = await fn(event); span.end(); return result;`.
 */
const isReturnedFrom = (call: CallExpression, around: FunctionLike): boolean => {
  let at: TsNode = call;
  for (let parent = at.getParent(); parent !== undefined; parent = at.getParent()) {
    if (!Node.isAwaitExpression(parent) && !Node.isParenthesizedExpression(parent) && !Node.isAsExpression(parent)) break;
    at = parent;
  }
  const returned = returnedBy(around);
  if (returned.includes(at)) return true;
  const holder = at.getParent();
  if (holder === undefined || !Node.isVariableDeclaration(holder)) return false;
  return returned.some((value) => Node.isIdentifier(value) && value.getSymbol()?.getDeclarations()[0] === holder);
};

/**
 * What a wrapper's body says about the function it was handed, when its body
 * is in this repository.
 *
 * It hands the function on when it returns it, when a function it builds calls
 * it - or what another wrapper made of it - with everything that function was
 * called with or returns what it returns, or when it hands it to another
 * wrapper and returns what that one built. Going through another wrapper takes
 * that wrapper's evidence, so a helper of this repository around a package
 * nobody installed is no more certain than the package.
 *
 * Calling it while the wrapper is being built is not handing it on, and neither
 * is passing it one piece of a request: both are what a factory does with a
 * function it was given, and a factory is not a wrapper (R137).
 */
const handsOn = (fn: FunctionLike, parameter: ParameterDeclaration, depth: number): Evidence | undefined => {
  const returned = returnedBy(fn);
  if (returned.some((value) => isParameter(value, parameter))) return STATIC;
  for (const call of fn.getDescendants()) {
    if (!Node.isCallExpression(call)) continue;
    const run = runOf(call, parameter, depth);
    if (run === undefined) continue;
    const around = enclosingFunction(call);
    if (around === undefined || around === fn) continue;
    if (forwardsAll(call, run.form, around) || isReturnedFrom(call, around)) return run.evidence;
  }
  for (const value of returned) {
    const inner = Node.isCallExpression(value) ? wrappedBy(value, depth + 1) : undefined;
    if (inner !== undefined && isParameter(inner.argument, parameter)) return evidenceOf([inner]);
  }
  return undefined;
};

/**
 * The function a declaration of this repository is, through the names it was
 * bound to; undefined when the wrapper is a value something built at run time.
 */
const wrapperFunction = (declaration: TsNode, depth: number): FunctionLike | undefined => {
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) return declaration;
  const initializer = Node.isExportAssignment(declaration)
    ? declaration.getExpression()
    : Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)
      ? declaration.getInitializer()
      : undefined;
  const value = initializer === undefined ? undefined : unwrapValue(initializer);
  if (value === undefined) return undefined;
  if (isFunctionLike(value)) return value;
  if (depth >= WRAP_DEPTH || !Node.isIdentifier(value)) return undefined;
  const origin = originOfValue(value);
  return origin.kind === 'local' ? wrapperFunction(origin.declaration, depth + 1) : undefined;
};

type ReadWrapper = (call: CallExpression, index: number, origin: Origin, depth: number) => Evidence | undefined;

/**
 * How a wrapper is read, by where it is declared.
 *
 * A table, because the answers are of equal standing and differ only in what
 * there is to read: a body in this repository, a declaration in a package that
 * is installed, or nothing at all.
 */
const READ_WRAPPER: Readonly<Record<Origin['kind'], ReadWrapper>> = Object.freeze({
  local: (call, index, origin, depth) => {
    if (origin.kind !== 'local') return undefined;
    const fn = wrapperFunction(origin.declaration, depth);
    if (fn === undefined) {
      return heuristic(`${calleeText(call)} is a value built at run time, so whether it runs the function it is handed was not read`);
    }
    const parameter = fn.getParameters()[index];
    if (parameter === undefined || parameter.isRestParameter() || !Node.isIdentifier(parameter.getNameNode())) return undefined;
    const evidence = handsOn(fn, parameter, depth);
    return evidence?.why === undefined ? evidence : heuristic(`${calleeText(call)} hands it on, and ${evidence.why}`);
  },
  // An installed package is read as far as its declarations go: a wrapper whose
  // types say it hands back a function is taken at its word, as a package's
  // types are everywhere else in this tool.
  external: (call, _index, origin) =>
    isCallable(call)
      ? STATIC
      : heuristic(
          `${calleeText(call)} is declared in ${origin.kind === 'external' ? origin.package : 'a package'} without saying it hands back a function`,
        ),
  builtin: (call) => (isCallable(call) ? STATIC : undefined),
  unknown: (call) => {
    const pkg = packageOfCall(call);
    return heuristic(
      pkg === undefined
        ? `${calleeText(call)} resolves to no declaration, so whether it runs the function it is handed was not read`
        : `${calleeText(call)} comes from ${pkg}, which is not installed, so whether it runs the function it is handed was not read`,
    );
  },
});

/**
 * The one function a call wraps, or undefined when it wraps none or several.
 *
 * The one rule every reader that follows a handler through a wrapper asks: the
 * deployed-function reader for `middy(traced('createLoan', createLoan))`, and the
 * Express, Fastify, Koa and Hono reader for `get('/loans', withSpan('listLoans',
 * listLoans))`. Two rules would land the same handler in one reader and not in
 * the other.
 *
 * Two or more functions handed over is not a wrapper: `either(listLoans,
 * listHolds)` runs one of them, and which is not in the call. A function of this
 * repository whose body does not hand the function on is not one either; it is
 * a factory given a function to use, and what it builds is its own.
 */
export const wrappedBy = (node: TsNode, depth = 0): Wrapped | undefined => {
  const call = unwrapValue(node);
  if (depth > WRAP_DEPTH || !Node.isCallExpression(call)) return undefined;
  const functions = functionArguments(call, depth);
  if (functions.length !== 1) return undefined;
  const index = functions[0] as number;
  const origin = originOfValue(call.getExpression());
  const evidence = READ_WRAPPER[origin.kind](call, index, origin, depth);
  return evidence === undefined ? undefined : { call, argument: call.getArguments()[index] as TsNode, ...evidence };
};

/** Where among a call's arguments the functions are, by position. */
export const functionArguments = (call: CallExpression, depth = 0): number[] =>
  call.getArguments().flatMap((arg, index) => (isFunctionArgument(arg, depth) ? [index] : []));

/** A value with its wrappers taken off. */
export interface Unwrapped {
  /** What is left once every wrapper is taken off. */
  readonly work: TsNode;
  /** The wrappers taken off, outermost first. */
  readonly through: readonly Wrapped[];
}

/**
 * What a value is once every wrapper around it is taken off, through names bound
 * to wrapped values.
 *
 * Stops at the first thing that is not a wrapper: a function written in place,
 * one named here, or a call that wraps nothing, which a reader may still ask
 * `builtByFactory` about.
 */
export const unwrapWork = (start: TsNode): Unwrapped => {
  const through: Wrapped[] = [];
  let work = unwrapValue(start);
  for (let depth = 0; depth < WRAP_DEPTH; depth += 1) {
    const call = Node.isCallExpression(work) ? work : boundCall(work);
    const wrapped = call === undefined ? undefined : wrappedBy(call);
    if (wrapped === undefined) break;
    through.push(wrapped);
    work = unwrapValue(wrapped.argument);
  }
  return { work, through };
};

/** Every wrapper's evidence, as one confidence and one sentence. */
export const evidenceOf = (through: readonly Wrapped[]): Evidence => {
  const reasons = through.flatMap((step) => (step.why === undefined ? [] : [step.why]));
  return reasons.length === 0 ? STATIC : heuristic(reasons.join('; '));
};
