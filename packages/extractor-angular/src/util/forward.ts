import {
  callSitesOf,
  enclosingMethod,
  finiteLookups,
  parametersOf,
  readsParameterOf,
  remembersParametersOf,
  wasRead,
  type CallFrame,
  type ClassMethod,
} from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { analyzeApiUrl, analyzeForwardedApiUrl, type ApiUrl } from './url.js';

/** Where a request is attributed: the call, and the method it is written in. */
export interface RequestSite {
  call: TsNode;
  methodId: string;
  file: string;
}

/** One request, read at the call that decides it. */
export interface ReadRequest {
  site: RequestSite;
  address: ApiUrl;
  /** The wrappers it was followed out through, innermost first; empty when read in place. */
  frames: readonly CallFrame[];
  /** The table entry it stands for, when a lookup was enumerated. */
  choice?: string;
}

/**
 * The id of one request as it is read at one call site.
 *
 * Read in place it is the leaf itself. Read at a caller it also carries where
 * the network is reached, because one wrapper can write several requests and
 * every one of them is read at the same call; and the table entry, when a
 * lookup was enumerated.
 */
export const requestIdOf = (
  leaf: string,
  network: TsNode,
  request: Pick<ReadRequest, 'frames' | 'choice'>,
): string => {
  const at = network.getSourceFile().getLineAndColumnAtPos(network.getStart());
  const via = request.frames.length === 0 ? '' : `@${at.line}:${at.column}`;
  return `${leaf}${via}${request.choice === undefined ? '' : `#${request.choice}`}`;
};

/** `Class.method` of the wrapper a request is written in. */
export const wrapperOf = (network: TsNode): string | null => {
  const method = enclosingMethod(network);
  const owner = method?.getParent();
  if (method === undefined || owner === undefined || !Node.isClassDeclaration(owner)) return null;
  return `${owner.getName() ?? '?'}.${method.getName()}`;
};

/** The most requests one call is enumerated into through tables it looks up. */
const MOST_ENUMERATED = 16;

/** How many wrappers deep a request is followed before it is left where it is written. */
const FORWARD_DEPTH = 4;

const isRead = (address: ApiUrl): boolean => address.path !== null && wasRead(address.path);

/**
 * The requests an address stands for once every table it looks up is
 * enumerated, or nothing when that does not settle it.
 *
 * Each comes back marked as guessed: the call reaches one of them per run and
 * nothing here says which, so an edge drawn from any of them is `heuristic`.
 */
const enumerated = (
  urlArg: TsNode,
  frames: readonly CallFrame[],
): Array<{ address: ApiUrl; choice: string }> => {
  const lookups = finiteLookups(urlArg);
  if (lookups.length === 0) return [];
  let combinations: Array<Map<TsNode, string>> = [new Map()];
  for (const lookup of lookups) {
    combinations = combinations.flatMap((picked) =>
      lookup.values.map((value) => new Map([...picked, [lookup.node, value]])),
    );
    if (combinations.length > MOST_ENUMERATED) return [];
  }
  const out: Array<{ address: ApiUrl; choice: string }> = [];
  for (const picked of combinations) {
    const address = analyzeForwardedApiUrl(urlArg, frames, picked);
    if (!isRead(address)) return [];
    out.push({ address: { ...address, guessed: true }, choice: [...picked.values()].join(',') });
  }
  return out;
};

/**
 * Whether an argument leaves the address where its caller put it.
 *
 * `this.post(path, body)` passes its caller's path along untouched, so the
 * address is still undecided. `this.open(`${base}?token=${token}`)` writes text
 * around what it was given, and that is deciding it. An object a method
 * remembered its own parameters in is the first case wearing a field: nothing
 * about the address was decided by putting it there.
 */
const passesOn = (argument: TsNode, outer: ClassMethod): boolean => {
  // `this.open(this.params)`, where `this.params` is where `connect` put what it
  // was given. The object is the parameters, so passing it is passing them on.
  if (remembersParametersOf(argument, outer)) return true;
  let value = argument;
  for (;;) {
    if (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value)) {
      value = value.getExpression();
    } else if (
      Node.isBinaryExpression(value) &&
      value.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken
    ) {
      value = value.getLeft();
    } else break;
  }
  if (!Node.isIdentifier(value)) return false;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  return parametersOf(outer).some((parameter) => parameter === declaration);
};

/**
 * Every call a wrapper's request is made from, each with the frames that lead
 * out to it.
 *
 * A call written in the wrapper's own class that hands on its own parameters
 * whole — `postAction(path, body) { return this.post(path, body); }` — is the wrapper
 * layered on itself, so it is followed one more step out. A call from any other
 * class, a subclass included, is where the address is decided and the request
 * is attributed. A layer nothing calls stands for no request at all and is
 * dropped.
 */
const forwardChains = (
  method: ClassMethod,
  depth: number,
  seen: ReadonlySet<ClassMethod>,
): CallFrame[][] => {
  const declaring = method.getParent();
  const chains: CallFrame[][] = [];
  for (const call of callSitesOf(method)) {
    const frame: CallFrame = { call, method };
    const outer = enclosingMethod(call);
    const layered =
      outer !== undefined &&
      outer.getParent() === declaring &&
      !seen.has(outer) &&
      call.getArguments().some((argument) => passesOn(argument, outer));
    if (!layered) {
      chains.push([frame]);
      continue;
    }
    if (depth <= 1) continue;
    for (const chain of forwardChains(outer, depth - 1, new Set([...seen, outer]))) {
      chains.push([frame, ...chain]);
    }
  }
  return chains;
};

/**
 * What one request written at `urlArg` stands for, and where each is attributed.
 *
 * Read in place when it can be. A lookup into a table written down becomes one
 * request per entry. Otherwise, when what is missing is what the enclosing
 * method was called with, the request is a wrapper's and belongs to each of its
 * callers: one readable request per caller rather than one dead end standing in
 * for all of them. A caller whose request still cannot be read settles nothing
 * the wrapper did not, so it is left with the wrapper's single request, which
 * is where the unreadable part is written.
 */
export const requestsOf = (
  ctx: AngularExtractContext,
  urlArg: TsNode,
  method: ClassMethod,
  site: RequestSite,
  /** How many requests the wrapper method writes in all. */
  siblings = 1,
): ReadRequest[] => {
  const here = analyzeApiUrl(urlArg, ctx.config.sharedPackages);
  const inPlace: ReadRequest = { site, address: here, frames: [] };
  if (isRead(here)) return [inPlace];

  const tables = enumerated(urlArg, []);
  if (tables.length > 0) {
    return tables.map(({ address, choice }) => ({ site, address, frames: [], choice }));
  }
  if (!readsParameterOf(urlArg, method)) return [inPlace];

  const siteAt = (call: TsNode): RequestSite | undefined => {
    const outer = enclosingMethod(call);
    const owner = outer?.getParent();
    if (outer === undefined || owner === undefined || !Node.isClassDeclaration(owner)) return undefined;
    const indexed = ctx.classes.get(owner);
    const methodId = ctx.methodIdOf(outer);
    if (indexed === undefined || indexed.role === 'module' || methodId === undefined) return undefined;
    ctx.ensureMethodNode(outer);
    return { call, methodId, file: indexed.file };
  };

  const out: ReadRequest[] = [];
  let unread = 0;
  for (const frames of forwardChains(method, FORWARD_DEPTH, new Set([method]))) {
    const outermost = frames[frames.length - 1];
    const caller = outermost === undefined ? undefined : siteAt(outermost.call);
    // A caller outside any class method — a constructor, a field initializer, a
    // resolver function — is still a caller. It cannot be attributed here, so
    // the wrapper keeps its own row rather than the request vanishing.
    if (caller === undefined) {
      unread += 1;
      continue;
    }
    const address = analyzeForwardedApiUrl(urlArg, frames);
    const choices = isRead(address) ? [] : enumerated(urlArg, frames);
    if (choices.length > 0) {
      for (const { address: one, choice } of choices) {
        out.push({ site: caller, address: one, frames, choice });
      }
      continue;
    }
    if (!isRead(address)) {
      unread += 1;
      continue;
    }
    // A wrapper writing several requests picks one per run, and nothing at the
    // call site says which: each one read there is a guess.
    out.push({ site: caller, address: siblings > 1 ? { ...address, guessed: true } : address, frames });
  }
  if (out.length === 0 || unread > 0) out.push(inPlace);
  return out;
};

/**
 * Marks the method a request is attributed to when nothing anywhere names it.
 *
 * Asked of the compiler rather than of the graph: the graph draws calls from
 * methods, and a constructor, a field initializer, a template or a resolver
 * function is a caller too. Only a method with no reference at all is one nobody
 * runs, and that is what a contract check may soften a finding for.
 */
export const noteIfUnreferenced = (ctx: AngularExtractContext, site: RequestSite): void => {
  const method = enclosingMethod(site.call);
  if (method === undefined) return;
  const name = method.getNameNode();
  const referenced = method.findReferencesAsNodes().some((reference) => reference !== name);
  if (referenced) return;
  const node = ctx.ensureMethodNode(method);
  if (node !== undefined) ctx.builder.addNode({ ...node, meta: { ...node.meta, unreferenced: true } });
};
