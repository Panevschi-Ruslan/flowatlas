import { callSitesOf as callSitesOfFunction, evaluateExpression, wasRead, type NamedFunction } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ObjectLiteralExpression, ParameterDeclaration } from 'ts-morph';
import { Node, VariableDeclarationKind } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { analyzeApiUrl, type ApiUrl, type Bindings } from './url.js';

/** Where a request is attributed: the call, and the function it is written in. */
export interface RequestSite {
  call: TsNode;
  /** Id of the function node the `calls` edge is drawn from. */
  ownerId: string;
  file: string;
}

/** One request, read at the call that decides it. */
export interface ReadRequest {
  site: RequestSite;
  address: ApiUrl;
  /**
   * How far out the address had to be followed before it could be read.
   *
   * Zero when it was written where the request is made, which is the ordinary
   * case and the only one where the node's position and the network's are the
   * same.
   */
  depth: number;
  /** `name` of the function the network is actually reached in, when not this one. */
  through?: string;
  /**
   * The calls the address was followed out through, innermost first (P91):
   * what else a wrapper is handed - its verb - is read along the same calls.
   */
  calls: readonly CallExpression[];
}

/** How many wrappers deep a request is followed before it is left where it is written. */
const FORWARD_DEPTH = 3;

const isRead = (address: ApiUrl): boolean => address.path !== null && wasRead(address.path);

/**
 * The parameter a name was declared in: the parameter itself, or a member taken
 * out of it where it is written - `({ url = '', method = 'GET' }: Options)`,
 * which is how a wrapper that takes its request as one object is commonly
 * written (P269).
 */
const parameterOf = (declaration: TsNode): TsNode | undefined => {
  let at: TsNode | undefined = declaration;
  while (at !== undefined && Node.isBindingElement(at)) at = at.getParent()?.getParent();
  return at !== undefined && Node.isParameterDeclaration(at) ? at : undefined;
};

/** The object a caller writes for an options parameter: in place, or held by a `const` it names. */
const objectHandedAs = (argument: TsNode): ObjectLiteralExpression | undefined => {
  let value: TsNode | undefined = argument;
  for (let step = 0; value !== undefined && step < 4; step += 1) {
    if (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isSatisfiesExpression(value)) {
      value = value.getExpression();
      continue;
    }
    if (Node.isObjectLiteralExpression(value)) return value;
    if (!Node.isIdentifier(value)) return undefined;
    const declaration: TsNode | undefined = value.getSymbol()?.getDeclarations()[0];
    value =
      declaration !== undefined &&
      Node.isVariableDeclaration(declaration) &&
      declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
        ? declaration.getInitializer()
        : undefined;
  }
  return undefined;
};

/**
 * What a caller hands each member a parameter takes out of its object, where it
 * takes them out where it is written (P269).
 *
 * `request({ url: `${basePath}/cart`, method: 'POST' })` into `({ url = '',
 * method = 'GET' }) => fetch(url, { method })`: `url` is what the caller wrote
 * under `url`, and a member the caller leaves out holds the default the wrapper
 * writes - only a constant one, as for a parameter left out. An object that
 * spreads another may carry any member, so a member it does not write is left
 * unbound rather than given the default.
 */
const membersBound = (parameter: ParameterDeclaration, argument: TsNode | undefined, values: Map<TsNode, TsNode>): void => {
  const pattern = parameter.getNameNode();
  if (!Node.isObjectBindingPattern(pattern)) return;
  const object = argument === undefined ? undefined : objectHandedAs(argument);
  // Handed something that is not an object written here: what it holds is not
  // written anywhere this can read, so nothing is bound.
  if (argument !== undefined && object === undefined) return;
  const spreads = object?.getProperties().some((property) => Node.isSpreadAssignment(property)) === true;
  for (const element of pattern.getElements()) {
    if (element.getDotDotDotToken() !== undefined || !Node.isIdentifier(element.getNameNode())) continue;
    const key = element.getPropertyNameNode()?.getText() ?? element.getName();
    const property = object?.getProperty(key);
    const written = property === undefined
      ? undefined
      : Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : undefined;
    if (written !== undefined) {
      values.set(element, written);
      continue;
    }
    if (property !== undefined || spreads) continue;
    const fallback = element.getInitializer();
    if (fallback !== undefined && evaluateExpression(fallback).resolved) values.set(element, fallback);
  }
};

/** The parameters of a function, however the function was written. */
const parametersOf = (fn: NamedFunction): ParameterDeclaration[] => {
  const declaration = fn.declaration;
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) {
    return declaration.getParameters();
  }
  const written = Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)
    ? declaration.getInitializer()
    : declaration;
  if (written === undefined) return [];
  return Node.isArrowFunction(written) || Node.isFunctionExpression(written)
    ? written.getParameters()
    : [];
};

/**
 * Whether anything in an expression stands for one of a function's parameters.
 *
 * The one cheap question worth asking before the expensive one: an address with
 * nothing of the caller's in it is decided here, and going looking for callers
 * would be work for nothing.
 */
const readsParameter = (value: TsNode, fn: NamedFunction): boolean => {
  const parameters = new Set<TsNode>(parametersOf(fn));
  if (parameters.size === 0) return false;
  const named = (node: TsNode): boolean => {
    if (!Node.isIdentifier(node)) return false;
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return false;
    const parameter = parameterOf(declaration);
    return parameter !== undefined && parameters.has(parameter);
  };
  if (named(value)) return true;
  let found = false;
  value.forEachDescendant((node, traversal) => {
    if (named(node)) {
      found = true;
      traversal.stop();
    }
  });
  return found;
};

/**
 * Every call to a function of this repository: bare, by a name it was imported
 * as, or through the namespace of its module - `api.getOrder(id)` - because an
 * API module imported wholesale is how half of these repositories are written.
 * The core's answer, the one every reader that follows a parameter outward asks.
 */
const callSitesOf = (fn: NamedFunction): CallExpression[] => {
  const declaration = fn.declaration;
  return Node.isFunctionDeclaration(declaration) || Node.isVariableDeclaration(declaration)
    ? callSitesOfFunction(declaration)
    : [];
};

/** What a call passed for each of the called function's parameters. */
const bindingsAt = (fn: NamedFunction, call: CallExpression): Bindings => {
  const values = new Map<TsNode, TsNode>();
  const args = call.getArguments();
  parametersOf(fn).forEach((parameter, index) => {
    const argument = args[index];
    membersBound(parameter, argument, values);
    if (argument !== undefined) {
      values.set(parameter, argument);
      return;
    }
    // Nothing passed: the parameter holds its default, `url(suffix = '')`
    // called as `url()` (P91). Only a constant default is taken; one that
    // reads anything else is a hole, as any unread value is.
    const fallback = parameter.getInitializer();
    if (fallback !== undefined && evaluateExpression(fallback).resolved) values.set(parameter, fallback);
  });
  return { values };
};

/**
 * Hangs one more frame on the outside of a chain of bindings.
 *
 * Outside, not inside, and that is the whole subtlety of following an address
 * through two wrappers. The innermost frame binds the parameters of the
 * function the request is written in, and what they are bound to is written in
 * its caller — so the caller's own parameters are settled one link further out,
 * not one link further in. Getting this the wrong way round reads the second
 * wrapper as unread, which is the shape most repositories actually have.
 */
const withOuter = (bindings: Bindings | undefined, outer: Bindings): Bindings =>
  bindings === undefined
    ? outer
    : { values: bindings.values, under: withOuter(bindings.under, outer) };

/** The expressions at the far end of a chain, which is where the next hole is. */
const outermostValues = (bindings: Bindings): TsNode[] =>
  bindings.under === undefined ? [...bindings.values.values()] : outermostValues(bindings.under);

/** The indexed function a call is written inside, when this repository declares it. */
export const enclosingIndexed = (
  ctx: ReactExtractContext,
  call: TsNode,
): IndexedFunction | undefined => {
  for (let at = call.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isSourceFile(at)) return undefined;
    const indexed =
      Node.isFunctionDeclaration(at) || Node.isVariableDeclaration(at) || Node.isPropertyAssignment(at)
        ? ctx.functions.get(at)
        : undefined;
    if (indexed !== undefined) return indexed;
    // An arrow written inside another function belongs to whatever declares
    // that one, so the walk carries on rather than stopping at it.
  }
  return undefined;
};

/**
 * What one request written at `urlArg` stands for, and where each is attributed.
 *
 * Read in place when it can be. Otherwise, when what is missing is what the
 * enclosing function was called with, the request belongs to each of its
 * callers: one readable request per caller rather than one dead end standing in
 * for all of them. This is the same conclusion the other front-end reader comes
 * to and the same shape of answer; what differs is that there is no class graph
 * to walk, only functions calling functions.
 *
 * A caller whose request still cannot be read settles nothing the wrapper did
 * not, so it is left with the wrapper's single request, which is where the
 * unreadable part is written — and that one row is the whole of what "a request
 * whose address only the caller knows" looks like in the output.
 */
export const requestsOf = (
  ctx: ReactExtractContext,
  urlArg: TsNode,
  owner: IndexedFunction,
  site: RequestSite,
): ReadRequest[] => {
  const sharedPackages = ctx.config.sharedPackages;

  const outward = (
    at: IndexedFunction,
    bindings: Bindings | undefined,
    depth: number,
    seen: ReadonlySet<string>,
    callSite: TsNode,
    chain: readonly CallExpression[],
  ): ReadRequest[] => {
    const here = analyzeApiUrl(urlArg, {
      sharedPackages,
      ...(bindings === undefined ? {} : { bindings }),
    });
    const inPlace: ReadRequest = {
      site: { call: callSite, ownerId: at.id, file: at.file },
      address: here,
      depth,
      ...(depth === 0 ? {} : { through: owner.name }),
      calls: chain,
    };
    if (isRead(here)) return [inPlace];
    if (depth >= FORWARD_DEPTH) return [inPlace];

    // What is still missing is written in `at`, whether that is the argument
    // the request was given or the argument the last frame passed on.
    const frontier = bindings === undefined ? [urlArg] : outermostValues(bindings);
    if (!frontier.some((expression) => readsParameter(expression, at.fn))) return [inPlace];

    const out: ReadRequest[] = [];
    let unread = 0;
    for (const call of callSitesOf(at.fn)) {
      const caller = enclosingIndexed(ctx, call);
      // A caller outside any function this repository indexes — a value written
      // at the top of a module, a call inside markup — is still a caller. It
      // cannot be attributed, so the wrapper keeps its own row rather than the
      // request vanishing.
      if (caller === undefined || seen.has(caller.id)) {
        unread += 1;
        continue;
      }
      const found = outward(
        caller,
        withOuter(bindings, bindingsAt(at.fn, call)),
        depth + 1,
        new Set([...seen, caller.id]),
        call,
        [...chain, call],
      );
      for (const request of found) {
        if (isRead(request.address)) out.push(request);
        else unread += 1;
      }
    }
    if (out.length === 0 || unread > 0) out.push(inPlace);
    return out;
  };

  return outward(owner, undefined, 0, new Set([owner.id]), site.call, []);
};

/** A value a function was handed, read at one of its callers (P275). */
export interface HandedAtCaller {
  /** The call that hands it: the outermost one it was followed out to. */
  readonly call: CallExpression;
  /** The function that call is written in, where the repository declares one. */
  readonly caller: IndexedFunction | undefined;
  /** What the caller hands, where it hands something this can point at. */
  readonly value: TsNode | undefined;
  /** The calls followed out through, innermost first. */
  readonly calls: readonly CallExpression[];
  /** The function the value is used in, innermost. */
  readonly through: string;
}

/**
 * Functions of a reactivity library that answer the object they are handed:
 * `const args = reactive(options)` reads `args.query` as `options.query`.
 */
const SAME_OBJECT = new Set(['reactive', 'readonly', 'shallowReactive', 'shallowReadonly', 'toRaw', 'markRaw']);
const SAME_OBJECT_FROM = /^(vue|@vue\/(reactivity|runtime-core|composition-api))$/;

const unwrapped = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isSatisfiesExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  return at;
};

/** Whether a callee is one of {@link SAME_OBJECT}, imported from its library. */
const answersWhatItIsHanded = (callee: TsNode): boolean => {
  if (!Node.isIdentifier(callee)) return false;
  for (const declaration of callee.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    return SAME_OBJECT.has(declaration.getName()) && SAME_OBJECT_FROM.test(declaration.getImportDeclaration().getModuleSpecifierValue());
  }
  return false;
};

/**
 * The parameter a value is, or the member of one it reads: `doc`, `args.query`,
 * `({ query })`'s `query`, through a `const` that names it or holds what a
 * reactivity function made of it.
 */
const parameterRead = (value: TsNode, depth = 0): { parameter: ParameterDeclaration; member?: string } | undefined => {
  if (depth > 4) return undefined;
  const at = unwrapped(value);
  if (Node.isPropertyAccessExpression(at)) {
    const inner = parameterRead(at.getExpression(), depth + 1);
    return inner !== undefined && inner.member === undefined ? { parameter: inner.parameter, member: at.getName() } : undefined;
  }
  if (!Node.isIdentifier(at)) return undefined;
  const holder = at.getParent();
  const symbol = holder !== undefined && Node.isShorthandPropertyAssignment(holder) ? holder.getValueSymbol() : at.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isParameterDeclaration(declaration)) return Node.isIdentifier(declaration.getNameNode()) ? { parameter: declaration } : undefined;
  if (Node.isBindingElement(declaration)) {
    const pattern = declaration.getParent();
    const parameter = pattern?.getParent();
    if (!Node.isObjectBindingPattern(pattern) || parameter === undefined || !Node.isParameterDeclaration(parameter) || declaration.getDotDotDotToken() !== undefined) return undefined;
    return { parameter, member: declaration.getPropertyNameNode()?.getText() ?? declaration.getName() };
  }
  if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
  const initializer = declaration.getInitializer();
  if (initializer === undefined) return undefined;
  const held = unwrapped(initializer);
  if (Node.isIdentifier(held) || Node.isPropertyAccessExpression(held)) return parameterRead(held, depth + 1);
  if (Node.isCallExpression(held) && held.getArguments().length === 1 && answersWhatItIsHanded(held.getExpression())) return parameterRead(held.getArguments()[0] as TsNode, depth + 1);
  return undefined;
};

/** The indexed function a parameter belongs to: a declaration, or the `const` an arrow or a function expression is held by. */
const functionOfParameter = (ctx: ReactExtractContext, parameter: ParameterDeclaration): IndexedFunction | undefined => {
  const fn = parameter.getParent();
  if (Node.isFunctionDeclaration(fn)) return ctx.functions.get(fn);
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  let holder: TsNode | undefined = fn.getParent();
  while (holder !== undefined && (Node.isParenthesizedExpression(holder) || Node.isAsExpression(holder) || Node.isSatisfiesExpression(holder))) holder = holder.getParent();
  return holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyAssignment(holder)) ? ctx.functions.get(holder) : undefined;
};

/** What one caller hands for a parameter, or for the member of it a function reads. */
const handedFor = (call: CallExpression, index: number, member: string | undefined): TsNode | undefined => {
  const argument = call.getArguments()[index];
  if (argument === undefined || member === undefined) return argument;
  const object = objectHandedAs(argument);
  const property = object?.getProperty(member);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
};

/**
 * What each caller of the function a value is used in hands for it, where the
 * value is one of that function's parameters or a member of one (P275):
 * `runQuery({ query: OrdersDocument })` hands `args.query` in
 * `createRequest(args.query)` the document `OrdersDocument`. Followed out
 * again where what a caller hands is its own parameter, as far as
 * {@link FORWARD_DEPTH} calls; `settled` says a value needs no further
 * following. Undefined where the value is not a parameter of a function this
 * repository declares.
 */
export const handedOutward = (
  ctx: ReactExtractContext,
  value: TsNode,
  settled: (value: TsNode) => boolean,
): HandedAtCaller[] | undefined => {
  const outward = (at: TsNode, depth: number, chain: readonly CallExpression[], seen: ReadonlySet<string>, innermost?: string): HandedAtCaller[] | undefined => {
    const read = parameterRead(at);
    if (read === undefined) return undefined;
    const fn = functionOfParameter(ctx, read.parameter);
    if (fn === undefined || seen.has(fn.id)) return undefined;
    const index = parametersOf(fn.fn).indexOf(read.parameter);
    if (index === -1) return undefined;
    const found: HandedAtCaller[] = [];
    for (const call of callSitesOf(fn.fn)) {
      const caller = enclosingIndexed(ctx, call);
      const handed = handedFor(call, index, read.member);
      const calls = [...chain, call];
      const further =
        handed === undefined || settled(handed) || depth + 1 >= FORWARD_DEPTH ? undefined : outward(handed, depth + 1, calls, new Set([...seen, fn.id]), innermost ?? fn.name);
      if (further !== undefined && further.length > 0) found.push(...further);
      else found.push({ call, caller, value: handed, calls, through: innermost ?? fn.name });
    }
    return found;
  };
  return outward(value, 0, [], new Set());
};

/** Whether a value is a parameter of a function this repository declares, or a member of one: what {@link handedOutward} follows. */
export const isHandedParameter = (ctx: ReactExtractContext, value: TsNode): boolean => {
  const read = parameterRead(value);
  return read !== undefined && functionOfParameter(ctx, read.parameter) !== undefined;
};
