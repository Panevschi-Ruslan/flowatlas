import {
  callSitesOf,
  enclosingMethod,
  finiteLookups,
  literalChoices,
  PARAM_PLACEHOLDER,
  parametersOf,
  readsParameterOf,
  remembersParametersOf,
  wasRead,
  type CallFrame,
  type ClassMethod,
  type FiniteLookup,
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
  /**
   * The address once per value a finite segment of it can take.
   *
   * Recorded rather than enumerated into a node each: the address reads
   * perfectly well as `:param`, and most of the time matching it that way is
   * right. It is wrong exactly when a route spells the values out, and only
   * the joiner knows that (R31).
   */
  pathChoices?: readonly string[];
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
 * Whether anything in the address was filled in rather than read.
 *
 * The one cheap question worth asking before the expensive one: an address with
 * no hole in it has nothing to spread, and asking the type system about every
 * segment of every request that already reads perfectly well is work for
 * nothing.
 */
const hasHole = (address: ApiUrl): boolean => address.path?.includes(PARAM_PLACEHOLDER) === true;

/**
 * The paths a set of enumerated addresses comes to, or nothing when it is not a
 * choice between paths.
 *
 * Every candidate has to be readable end to end and they have to differ from
 * the plain reading; a set holding one address the reader gave up on is not a
 * choice, it is a guess wearing a list.
 */
const pathsOf = (
  choices: ReadonlyArray<{ address: ApiUrl }>,
  plain: ApiUrl,
): readonly string[] | undefined => {
  if (choices.length < 2) return undefined;
  const paths = [...new Set(choices.map((each) => each.address.path))];
  if (paths.some((path) => path === null || !wasRead(path))) return undefined;
  if (paths.length < 2) return undefined;
  return (paths as string[]).every((path) => path === plain.path) ? undefined : (paths as string[]).sort();
};

/**
 * Everything the address could have been written in, out to the last caller.
 *
 * A wrapper's own argument is rarely a name: `this.url(path, opts)` is a call,
 * and the parameter that decides the address is one level inside it. Rather
 * than walk the same road the address reader already walks, this asks the whole
 * of every argument each caller passed. A choice found in an argument the
 * address does not use costs nothing: every combination then reads to the same
 * address, and a set of identical addresses is not a choice (R31).
 */
const writtenAcross = (urlArg: TsNode, frames: readonly CallFrame[]): TsNode[] => [
  urlArg,
  ...frames.flatMap((frame) => frame.call.getArguments()),
];

/**
 * Every finite choice the address depends on, wherever on the way out it was
 * written.
 *
 * A table written down first, because it is a fact about a value and the surer
 * of the two. Only where there is none is the type asked, and then only of a
 * parameter — a segment somebody declared as one of a handful of strings.
 */
const choicesAcross = (urlArg: TsNode, frames: readonly CallFrame[]): FiniteLookup[] => {
  const written = writtenAcross(urlArg, frames);
  const tables = written.flatMap((each) => finiteLookups(each));
  if (tables.length > 0) return tables;
  return written.flatMap((each) => literalChoices(each));
};

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
  const lookups = choicesAcross(urlArg, frames);
  if (lookups.length === 0) return [];
  let combinations: Array<Map<TsNode, string>> = [new Map()];
  for (const lookup of lookups) {
    combinations = combinations.flatMap((picked) =>
      lookup.values.map((value) => new Map([...picked, [lookup.node, value]])),
    );
    if (combinations.length > MOST_ENUMERATED) return [];
  }
  // Keyed by the address, because a combination that comes to an address
  // another combination already came to is not a second request: it is the same
  // request reached by a table the address never reads. `choicesAcross` asks
  // every argument of every frame, so a `sort: 'asc' | 'desc'` beside the path
  // multiplies the combinations without moving the address, and each one of
  // them used to become its own node and its own heuristic edge to one route
  // (R43). `pathsOf` has always deduped this way; only the branch that turns a
  // combination into a request did not.
  const byAddress = new Map<string, { address: ApiUrl; choice: string }>();
  for (const picked of combinations) {
    const address = analyzeForwardedApiUrl(urlArg, frames, picked);
    if (!isRead(address)) return [];
    const key = JSON.stringify(address);
    // The first combination to reach an address names it. Which of the
    // combinations that is, is not arbitrary: the lookups come back in the
    // order they were found and each one's values sorted, so the same source
    // reads to the same ids on every run.
    if (byAddress.has(key)) continue;
    byAddress.set(key, {
      address: { ...address, guessed: true },
      choice: [...picked.values()].join(','),
    });
  }
  return [...byAddress.values()];
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
  if (isRead(here)) {
    // Read, and possibly read as a hole where somebody wrote a closed set.
    const spread = hasHole(here) ? pathsOf(enumerated(urlArg, []), here) : undefined;
    return [spread === undefined ? inPlace : { ...inPlace, pathChoices: spread }];
  }

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
    const choices = isRead(address) && !hasHole(address) ? [] : enumerated(urlArg, frames);
    // The address could not be read at all, and the choices settle it: one
    // request per value, each marked as the guess it is.
    if (!isRead(address)) {
      if (choices.length > 0) {
        for (const { address: one, choice } of choices) {
          out.push({ site: caller, address: one, frames, choice });
        }
        continue;
      }
      unread += 1;
      continue;
    }
    // The address reads, and a segment of it is a closed set. Both are true at
    // once: `/orders/:param` is a fair reading and `/fulfilment/ship` is
    // a better one where a route spells it out. Both are carried out, and the
    // joiner decides (R31).
    const spread = hasHole(address) ? pathsOf(choices, address) : undefined;
    // A wrapper writing several requests picks one per run, and nothing at the
    // call site says which: each one read there is a guess.
    out.push({
      site: caller,
      address: siblings > 1 ? { ...address, guessed: true } : address,
      frames,
      ...(spread === undefined ? {} : { pathChoices: spread }),
    });
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
