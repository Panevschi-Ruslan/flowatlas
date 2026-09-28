import { forEachCall, lineOf, type GraphBuilder, type NamedFunction, type NodeType } from '@flowatlas/core';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { scopesOf, type Scope } from '../scopes.js';
import { functionNamedBy, memberFunctionCalled } from './called-function.js';
import { definePass } from './types.js';

/** One call from a body to a function of this service. */
interface Hop {
  to: Scope;
  line: number;
}

/**
 * Every call each body makes to a function of this service, by name or through
 * a module of functions. A call into anything else - a method, an installed
 * package, a function declared inside another one - is the call walk's to read,
 * or nobody's.
 */
const hopsOf = (scopes: readonly Scope[]): Map<Scope, Hop[]> => {
  const byDeclaration = new Map<NamedFunction['declaration'], Scope>();
  for (const scope of scopes) if (scope.fn !== undefined) byDeclaration.set(scope.fn.declaration, scope);

  const hops = new Map<Scope, Hop[]>();
  for (const scope of scopes) {
    const found: Hop[] = [];
    forEachCall(scope.body, (call) => {
      const callee = call.getExpression();
      const fn = Node.isIdentifier(callee)
        ? functionNamedBy(callee)
        : Node.isPropertyAccessExpression(callee)
          ? memberFunctionCalled(callee)
          : undefined;
      const to = fn === undefined ? undefined : byDeclaration.get(fn.declaration);
      // A function that calls itself says nothing about the shape of the system.
      if (to !== undefined && to !== scope) found.push({ to, line: lineOf(call) });
    });
    if (found.length > 0) hops.set(scope, found);
  }
  return hops;
};

/**
 * The functions a call into is worth drawing: the ones that hold something, and
 * every function that reaches one of those through calls of its own.
 *
 * Walked backwards from what is held, so the answer is exactly the functions on
 * some path to a node and nothing that only ends in a helper.
 */
const leadingTo = (scopes: readonly Scope[], hops: ReadonlyMap<Scope, Hop[]>, held: (scope: Scope) => boolean): Set<Scope> => {
  const callers = new Map<Scope, Scope[]>();
  for (const [from, list] of hops) {
    for (const { to } of list) {
      const known = callers.get(to);
      if (known === undefined) callers.set(to, [from]);
      else known.push(from);
    }
  }
  const leads = new Set<Scope>();
  const queue = scopes.filter((scope) => scope.fn !== undefined && held(scope));
  for (const scope of queue) leads.add(scope);
  for (let at = 0; at < queue.length; at += 1) {
    for (const caller of callers.get(queue[at] as Scope) ?? []) {
      if (leads.has(caller) || caller.fn === undefined) continue;
      leads.add(caller);
      queue.push(caller);
    }
  }
  return leads;
};

/**
 * What a function can be joined to that makes it more than code: a way in, or a
 * leaf - a request, a query, a cache operation, a setting, a message.
 *
 * Code joined to code is not on the list. A helper the call walk followed into
 * from a handler is a node, and it holds nothing; counting it would make every
 * function that calls `exists()` lead somewhere. On peertube that made 594
 * functions nodes rather than 151, most of them validators no entry point
 * reaches.
 */
const HOLDS: ReadonlySet<NodeType> = new Set<NodeType>([
  'entry',
  'ui_action',
  'db_query',
  'cache_op',
  'channel',
  'producer',
  'consumer',
  'http_out',
  'ui_api_call',
  'config_key',
]);

/** The ids of the nodes the graph already joins to something it holds. */
const holding = (builder: GraphBuilder): Set<string> => {
  const found = new Set<string>();
  const holds = (id: string): boolean => {
    const type = builder.getNode(id)?.type;
    return type !== undefined && HOLDS.has(type);
  };
  for (const edge of builder.edges) {
    if (holds(edge.to)) found.add(edge.from);
    if (holds(edge.from)) found.add(edge.to);
  }
  return found;
};

/**
 * Calls into the functions the graph holds (R156).
 *
 * The call walk reads every method, and every function an entry point names and
 * what that reaches. It runs before the readers that hang leaves on a body - a
 * request, a query, a configuration read, a publish - and those read every
 * module-level function whether anything reaches it or not, because unreached is
 * not unwritten. So a function could hold a request and be in the graph with no
 * call into it and none out of it: novu's `streamTarballToParser` held the
 * request to GitHub and called `assertPublicRepository`, which held another, and
 * the only reader that drew that call was the browser reader, walking server code
 * it had no business reading (R145).
 *
 * The rule: **a call to a function of this service is drawn when that function
 * leads to something the graph holds** - it is joined already to a way in or to
 * a leaf (`HOLDS`), or it calls, at any depth, a function that is. Every body is asked: a method, a module-level
 * function, a function in an object of functions, a handler written in place. A
 * helper that holds nothing and reaches nothing held stays out, which is the
 * line the call walk has always drawn: a node for every function in a repository
 * is not what anybody asked the graph for, and a helper that touches nothing is
 * not a hop in any flow.
 *
 * It runs last, after every reader that can make a function a node, so what it
 * is told is held is the whole answer.
 */
export const heldCallsPass = definePass('held-calls', (ctx: NestExtractContext) => {
  const scopes = [...scopesOf(ctx)];
  const hops = hopsOf(scopes);
  const held = holding(ctx.builder);
  const leads = leadingTo(scopes, hops, (scope) => held.has(scope.id));

  for (const [from, list] of hops) {
    for (const { to, line } of list) {
      if (!leads.has(to)) continue;
      from.ensure();
      to.ensure();
      ctx.builder.addEdge({ from: from.id, to: to.id, type: 'calls', confidence: 'static', file: from.file, line });
    }
  }
});
