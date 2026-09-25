import { wasRead, type NamedFunction } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';
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
}

/** How many wrappers deep a request is followed before it is left where it is written. */
const FORWARD_DEPTH = 3;

const isRead = (address: ApiUrl): boolean => address.path !== null && wasRead(address.path);

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
    return declaration !== undefined && parameters.has(declaration);
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
 * Every call to a function of this repository, found by name.
 *
 * The core has this for a class method, where the call is always a property
 * access on something. A module function is called bare — `getOrder(id)` — or
 * through the namespace of the module it was imported from — `api.getOrder(id)`
 * — and both have to be recognised, because an API module imported wholesale is
 * how half of these repositories are written.
 */
const callSitesOf = (fn: NamedFunction): CallExpression[] => {
  const declaration = fn.declaration;
  const nameNode = Node.isFunctionDeclaration(declaration)
    ? declaration.getNameNode()
    : Node.isVariableDeclaration(declaration)
      ? declaration.getNameNode()
      : undefined;
  if (nameNode === undefined || !Node.isIdentifier(nameNode)) return [];

  const sites: CallExpression[] = [];
  const seen = new Set<string>();
  for (const reference of nameNode.findReferencesAsNodes()) {
    const parent = reference.getParent();
    if (parent === undefined) continue;
    const call = Node.isPropertyAccessExpression(parent)
      ? parent.getNameNode() === reference
        ? parent.getParent()
        : undefined
      : parent;
    if (call === undefined || !Node.isCallExpression(call)) continue;
    // A reference that is the callee, not one that is an argument: passing a
    // function to something else is not calling it here.
    const callee = call.getExpression();
    if (callee !== reference && callee.getParent() !== call) continue;
    if (callee !== reference && !(Node.isPropertyAccessExpression(callee) && callee.getNameNode() === reference)) {
      continue;
    }
    const key = `${call.getSourceFile().getFilePath()}:${call.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(call);
  }
  return sites;
};

/** What a call passed for each of the called function's parameters. */
const bindingsAt = (fn: NamedFunction, call: CallExpression): Bindings => {
  const values = new Map<TsNode, TsNode>();
  const args = call.getArguments();
  parametersOf(fn).forEach((parameter, index) => {
    const argument = args[index];
    if (argument !== undefined) values.set(parameter, argument);
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
const enclosingIndexed = (
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
      );
      for (const request of found) {
        if (isRead(request.address)) out.push(request);
        else unread += 1;
      }
    }
    if (out.length === 0 || unread > 0) out.push(inPlace);
    return out;
  };

  return outward(owner, undefined, 0, new Set([owner.id]), site.call);
};
