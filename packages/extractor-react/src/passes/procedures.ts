import {
  applicationOfFile,
  forEachCall,
  hasAnyDependency,
  makeLeafId,
  siteOf,
  writtenKeysOf,
} from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import { PROCEDURE_CLIENTS, type ProcedureClient } from '../procedure-clients.js';
import { definePass } from './types.js';

/** How far a name is followed to the value it was assigned, before giving up. */
const MAX_ALIASES = 4;

/** The expression a cast, a bang or a pair of brackets is wrapped round. */
const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isSatisfiesExpression(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** The name a call is made by: `f()` is `f`, and `a.b.f()` is `f` too. */
const calleeName = (call: CallExpression): string | undefined => {
  const callee = unwrap(call.getExpression());
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/**
 * Whether a value was made by one of the client's proxy factories.
 *
 * Asked of the value itself where the chain starts with a call —
 * `useTRPC().orders.list.queryOptions()` — and of whatever a name was assigned
 * otherwise, following it through imports and through plain renamings. A name
 * that is a parameter, or anything else with no initializer to read, is not a
 * proxy as far as this can tell, and nothing is said about it: a row on every
 * chain of four names in a repository would be noise, and the chains that are
 * requests are nearly always spelled on a module-level proxy or a hook's result.
 */
const isProxy = (expression: TsNode, client: ProcedureClient, depth = 0): boolean => {
  const at = unwrap(expression);
  if (Node.isCallExpression(at)) {
    const name = calleeName(at);
    return name !== undefined && client.proxies.includes(name);
  }
  if (!Node.isIdentifier(at) || depth >= MAX_ALIASES) return false;
  const symbol = at.getSymbol();
  if (symbol === undefined) return false;
  for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer !== undefined && isProxy(initializer, client, depth + 1)) return true;
  }
  return false;
};

/** The names between a proxy and the method that ends the chain. */
interface Path {
  readonly root: TsNode;
  readonly names: readonly string[];
  /** Set when one of the steps is computed, so the path cannot be named. */
  readonly dynamic: boolean;
}

const pathOf = (receiver: TsNode): Path => {
  const names: string[] = [];
  let dynamic = false;
  let at = unwrap(receiver);
  for (;;) {
    if (Node.isPropertyAccessExpression(at)) {
      names.unshift(at.getName());
      at = unwrap(at.getExpression());
      continue;
    }
    if (Node.isElementAccessExpression(at)) {
      const key = at.getArgumentExpression();
      if (key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key))) {
        names.unshift(key.getLiteralText());
      } else {
        dynamic = true;
        names.unshift(`[${key?.getText() ?? '?'}]`);
      }
      at = unwrap(at.getExpression());
      continue;
    }
    return { root: at, names, dynamic };
  }
};

/**
 * Procedures a client asks for by name.
 *
 * The server half reads a tree of procedures and names each by its path,
 * `orders.list`, rather than by a URL, because the URL is the client's link's
 * business and one tree is served at many. This is the half that reads the same
 * string where a caller writes it — `trpc.orders.list.useQuery(…)` — and makes it
 * a request node carrying the path and what the call does. Joining the two is
 * the linker's, as it is for every other request with an address: the procedure
 * may be served by the repository the call is written in or by another one the
 * configuration names, and only the linker can see both.
 *
 * The node is an ordinary `ui_api_call` with kind `rpc`, so everything that asks
 * who calls what already sees it. It carries no verb and no path, because there
 * is none: a procedure path in `meta.path` would be read as a URL by everything
 * that reads `meta.path`, and joined to routes it has nothing to do with.
 */
export const proceduresPass = definePass('procedures', (ctx: ReactExtractContext) => {
  const clients = PROCEDURE_CLIENTS.filter((client) => hasAnyDependency(ctx.pkg, client.packages));
  if (clients.length === 0) return;

  const record = (
    ownerId: string,
    file: string,
    call: CallExpression,
    client: ProcedureClient,
    operation: string,
    path: Path,
  ): void => {
    const shape = client.operations[operation];
    if (shape === undefined) return;
    const at = siteOf(call);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const procedure = path.dynamic ? null : path.names.join(client.separator);
    const input = shape.inputAt === undefined ? undefined : call.getArguments()[shape.inputAt];
    const inputKeys = input === undefined ? undefined : writtenKeysOf([input]);
    const application = applicationOfFile(ctx.meta, file);

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `rpc ${procedure ?? path.names.join(client.separator)}`,
      repo: ctx.repo,
      file,
      line: at.line,
      kind: 'rpc',
      meta: {
        // The string the server's entry carries as `meta.key`, and the whole of
        // what the join matches on.
        procedure,
        // What the server has to have declared it as, in the server's own word.
        call: shape.call,
        // How it was spelled here, which is what a reader searching the source
        // for this call will type.
        operation,
        client: client.name,
        ...(inputKeys === undefined ? {} : { inputKeys }),
        ...(application === undefined ? {} : { application }),
      },
    });
    ctx.builder.addEdge({
      from: ownerId,
      to: id,
      type: 'calls',
      confidence: procedure === null ? 'heuristic' : 'static',
      file,
      line: at.line,
    });

    if (procedure === null) {
      ctx.report({
        file,
        line: at.line,
        reason: 'procedure-path-dynamic',
        hint: 'A step of the path is computed, so the procedure it reaches cannot be named. Write each step as a name.',
        symbol: call.getText().slice(0, 80),
      });
    }
  };

  const seen = new Set<CallExpression>();
  for (const indexed of ctx.functions.all()) {
    forEachCall(indexed.fn.body, (node) => {
      if (!Node.isCallExpression(node) || seen.has(node)) return;
      const callee = unwrap(node.getExpression());
      if (!Node.isPropertyAccessExpression(callee)) return;
      const operation = callee.getName();
      for (const client of clients) {
        if (client.operations[operation] === undefined) continue;
        const path = pathOf(callee.getExpression());
        if (path.names.length === 0 || !isProxy(path.root, client)) continue;
        seen.add(node);
        ctx.ensureFunctionNode(indexed.fn);
        record(indexed.id, indexed.file, node, client, operation, path);
        return;
      }
    });
  }
});
