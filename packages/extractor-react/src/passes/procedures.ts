import {
  applicationOfFile,
  forEachCall,
  hasAnyDependency,
  makeLeafId,
  siteOf,
  startLineOf,
  writtenKeysOf,
} from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import {
  PROCEDURE_CLIENTS,
  type ProcedureClient,
  type ProcedureLink,
  type ProcedureOperation,
} from '../procedure-clients.js';
import { analyzeApiUrl } from '../util/url.js';
import { definePass } from './types.js';

/** How far a name is followed to the value it was assigned, before giving up. */
const MAX_ALIASES = 4;

/** How many names a tree is followed through to the procedure a value names. */
const MAX_TREE_STEPS = 16;

/** The expression a cast, a bang or a pair of brackets is wrapped round. */
const unwrap = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isAwaitExpression(at)
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

/** The value a name was declared with, through an import, or nothing. */
const initializerOf = (identifier: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) return unwrap(initializer);
  }
  return undefined;
};

/**
 * The call to one of the client's proxy factories a value was made by.
 *
 * Asked of the value itself where the chain starts with a call —
 * `useTRPC().orders.list.queryOptions()` — and of whatever a name was assigned
 * otherwise, following it through imports and through plain renamings. A name
 * that is a parameter, or anything else with no initializer to read, is not a
 * proxy as far as this can tell, and nothing is said about it: a row on every
 * chain of four names in a repository would be noise, and the chains that are
 * requests are nearly always spelled on a module-level proxy or a hook's result.
 */
const factoryOf = (expression: TsNode, client: ProcedureClient, depth = 0): CallExpression | undefined => {
  const at = unwrap(expression);
  if (Node.isCallExpression(at)) {
    const name = calleeName(at);
    return name !== undefined && client.proxies.includes(name) ? at : undefined;
  }
  if (!Node.isIdentifier(at) || depth >= MAX_ALIASES) return undefined;
  const initializer = initializerOf(at);
  return initializer === undefined ? undefined : factoryOf(initializer, client, depth + 1);
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

/** Where a client sends, as its link writes it (P58). */
type LinkReading =
  | { readonly kind: 'read'; readonly protocol: string; readonly url: TsNode }
  | { readonly kind: 'dynamic'; readonly protocol: string; readonly why: string };

/**
 * The link a proxy's factory was handed, followed through the proxies it was
 * made from: `createTanstackQueryUtils(client)` to `createORPCClient(link)` to
 * `new RPCLink({ url })`. Nothing where no link the description names is
 * found, which says nothing about the address rather than something wrong.
 */
const linkOf = (factory: CallExpression, client: ProcedureClient, depth = 0): LinkReading | undefined => {
  const links = client.links ?? [];
  if (links.length === 0 || depth >= MAX_ALIASES) return undefined;
  for (const argument of factory.getArguments()) {
    let at = unwrap(argument);
    if (Node.isIdentifier(at)) at = initializerOf(at) ?? at;
    if (Node.isNewExpression(at)) {
      const link = linkNamed(at, links);
      if (link === undefined) continue;
      return urlOf(at, link);
    }
    const inner = factoryOf(at, client);
    if (inner !== undefined) {
      const found = linkOf(inner, client, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const linkNamed = (made: TsNode, links: readonly ProcedureLink[]): ProcedureLink | undefined => {
  if (!Node.isNewExpression(made)) return undefined;
  const callee = made.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
  return links.find((link) => link.name === name);
};

/** The URL a link's options carry, or why it cannot be read as an address. */
const urlOf = (made: TsNode, link: ProcedureLink): LinkReading => {
  if (!Node.isNewExpression(made)) return { kind: 'dynamic', protocol: link.protocol, why: 'the link is not built here' };
  const options = made.getArguments()[link.optionsAt];
  let written = options === undefined ? undefined : unwrap(options);
  if (written !== undefined && Node.isIdentifier(written)) written = initializerOf(written) ?? written;
  if (written === undefined || !Node.isObjectLiteralExpression(written)) {
    return { kind: 'dynamic', protocol: link.protocol, why: 'its options are not written where it is built' };
  }
  const property = written.getProperty(link.urlKey);
  if (property === undefined) return { kind: 'dynamic', protocol: link.protocol, why: `its options name no ${link.urlKey}` };
  const value = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
  const url = value === undefined ? undefined : unwrap(value);
  if (url === undefined || Node.isArrowFunction(url) || Node.isFunctionExpression(url) || Node.isMethodDeclaration(property)) {
    return { kind: 'dynamic', protocol: link.protocol, why: `its ${link.urlKey} is worked out when each request is sent` };
  }
  return { kind: 'read', protocol: link.protocol, url };
};

/**
 * The procedure a value names, by where it is declared (P58): a tree's member
 * followed through names and the calls that assemble trees, down to the chain
 * the member is. The declaration's file and line are what the server's entry
 * carries, so the request joins it exactly even where its path is relative to
 * a tree below the root.
 */
const declaredAt = (root: TsNode, names: readonly string[], ctx: ReactExtractContext): string | undefined => {
  let at: TsNode | undefined = unwrap(root);
  const next = (value: TsNode): TsNode | undefined => {
    let node: TsNode | undefined = unwrap(value);
    for (let step = 0; node !== undefined && step < MAX_TREE_STEPS; step += 1) {
      if (Node.isIdentifier(node)) {
        node = initializerOf(node);
        continue;
      }
      return node;
    }
    return undefined;
  };
  at = next(at);
  for (const name of names) {
    if (at === undefined) return undefined;
    // A call assembling a tree hands back the literal it was given.
    if (Node.isCallExpression(at)) {
      const [tree] = at.getArguments();
      at = tree === undefined ? undefined : next(tree);
    }
    if (at === undefined || !Node.isObjectLiteralExpression(at)) return undefined;
    const property = at.getProperty(name);
    if (property === undefined) return undefined;
    if (Node.isShorthandPropertyAssignment(property)) {
      const symbol = property.getValueSymbol();
      const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
      const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      at = initializer === undefined ? undefined : next(initializer);
      continue;
    }
    at = Node.isPropertyAssignment(property) ? next(property.getInitializerOrThrow()) : undefined;
  }
  if (at === undefined || !Node.isCallExpression(at)) return undefined;
  return `${ctx.fileOf(at)}:${startLineOf(at)}`;
};

/** One request for a procedure, as the pass found it. */
interface Asked {
  readonly operation: string;
  readonly shape: ProcedureOperation;
  readonly path: Path;
  readonly factory?: CallExpression;
  /** The procedure's declaration, where its value could be followed (P58). */
  readonly procedureAt?: string;
  readonly inProcess?: boolean;
}

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
 * that reads `meta.path`, and joined to routes it has nothing to do with. The
 * address the client's link sends to is `meta.link`, apart from it (P58).
 */
export const proceduresPass = definePass('procedures', (ctx: ReactExtractContext) => {
  const clients = PROCEDURE_CLIENTS.filter((client) => hasAnyDependency(ctx.pkg, client.packages));
  if (clients.length === 0) return;
  /** A link read once per proxy factory, however many requests go through it. */
  const links = new Map<CallExpression, LinkReading | undefined>();
  const linkFor = (factory: CallExpression, client: ProcedureClient): LinkReading | undefined => {
    if (!links.has(factory)) links.set(factory, linkOf(factory, client));
    return links.get(factory);
  };

  const record = (ownerId: string, file: string, call: CallExpression, client: ProcedureClient, asked: Asked): void => {
    const { shape, path, operation } = asked;
    const at = siteOf(call);
    const id = makeLeafId('ui_api_call', ctx.repo, file, at.line, at.column);
    const procedure = path.dynamic || path.names.length === 0 ? null : path.names.join(client.separator);
    const argument = shape.inputAt === undefined ? undefined : call.getArguments()[shape.inputAt];
    const options = argument === undefined ? undefined : unwrap(argument);
    const input =
      shape.inputKey === undefined
        ? argument
        : options !== undefined && Node.isObjectLiteralExpression(options)
          ? (() => {
              const property = options.getProperty(shape.inputKey);
              return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
            })()
          : undefined;
    const inputKeys = input === undefined ? undefined : writtenKeysOf([input]);
    const application = applicationOfFile(ctx.meta, file);
    const link = asked.factory === undefined || asked.inProcess === true ? undefined : linkFor(asked.factory, client);
    const address =
      link?.kind === 'read' ? analyzeApiUrl(link.url, { sharedPackages: ctx.config.sharedPackages }) : undefined;
    const linkMeta =
      link === undefined
        ? undefined
        : address !== undefined && address.path !== null
          ? {
              protocol: link.protocol,
              path: address.path,
              ...(address.baseUrlEnv === null ? {} : { baseUrlEnv: address.baseUrlEnv }),
              ...(address.host === null ? {} : { host: address.host }),
            }
          : { protocol: link.protocol, dynamic: true };
    const named = procedure ?? (path.names.length > 0 ? path.names.join(client.separator) : unwrap(path.root).getText().slice(0, 60));

    ctx.builder.addNode({
      id,
      type: 'ui_api_call',
      label: `rpc ${named}`,
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
        ...(linkMeta === undefined ? {} : { link: linkMeta }),
        ...(asked.procedureAt === undefined ? {} : { procedureAt: asked.procedureAt }),
        ...(asked.inProcess === true ? { inProcess: true } : {}),
      },
    });
    const known = procedure !== null || asked.procedureAt !== undefined;
    ctx.builder.addEdge({
      from: ownerId,
      to: id,
      type: 'calls',
      confidence: known ? 'static' : 'heuristic',
      file,
      line: at.line,
    });

    if (!known) {
      ctx.report({
        file,
        line: at.line,
        reason: 'procedure-path-dynamic',
        hint: 'A step of the path is computed, so the procedure it reaches cannot be named. Write each step as a name.',
        symbol: call.getText().slice(0, 80),
      });
    }
    if (link?.kind === 'dynamic' || (link?.kind === 'read' && address?.path === null)) {
      ctx.report({
        file,
        line: at.line,
        reason: 'procedure-link-dynamic',
        level: 'info',
        message: `${named} is sent through a link whose address cannot be read: ${link.kind === 'dynamic' ? link.why : 'its URL is not written as text or a setting'}, so the service it reaches is the one apiTarget names.`,
        hint: 'Write the link URL as text, or as a setting followed by a path, where the link is built.',
        symbol: asked.factory === undefined ? named : asked.factory.getText().slice(0, 80),
      });
    }
  };

  /** What one call asks, of the first client that recognises it. */
  const askedBy = (node: CallExpression, client: ProcedureClient): Asked | undefined => {
    const callee = unwrap(node.getExpression());
    if (Node.isIdentifier(callee)) {
      const caller = client.callers?.find((each) => each.name === callee.getText());
      if (caller === undefined || !importedFrom(callee, client.packages)) return undefined;
      const handed = node.getArguments()[caller.procedureAt];
      if (handed === undefined) return undefined;
      const path = pathOf(handed);
      const procedureAt = declaredAt(path.root, path.names, ctx);
      return {
        operation: caller.name,
        shape: { call: caller.call, inputAt: caller.inputAt },
        path,
        ...(procedureAt === undefined ? {} : { procedureAt }),
        inProcess: true,
      };
    }
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const operation = callee.getName();
    const shape = client.operations[operation];
    if (shape !== undefined) {
      const path = pathOf(callee.getExpression());
      const factory = path.names.length === 0 ? undefined : factoryOf(path.root, client);
      if (factory !== undefined) return { operation, shape, path, factory };
    }
    // The path itself called, on a proxy that is a client (P58).
    if (client.direct === undefined) return undefined;
    const path = pathOf(callee);
    const factory = factoryOf(path.root, client);
    const made = factory === undefined ? undefined : calleeName(factory);
    if (factory === undefined || made === undefined || !client.direct.proxies.includes(made)) return undefined;
    const inProcess = client.inProcess?.includes(made) === true;
    const [tree] = factory.getArguments();
    const procedureAt = inProcess && tree !== undefined && !path.dynamic ? declaredAt(tree, path.names, ctx) : undefined;
    return {
      operation: 'call',
      shape: client.direct.operation,
      path,
      factory,
      ...(procedureAt === undefined ? {} : { procedureAt }),
      ...(inProcess ? { inProcess } : {}),
    };
  };

  const seen = new Set<CallExpression>();
  for (const indexed of ctx.functions.all()) {
    forEachCall(indexed.fn.body, (node) => {
      if (!Node.isCallExpression(node) || seen.has(node)) return;
      for (const client of clients) {
        const asked = askedBy(node, client);
        if (asked === undefined) continue;
        seen.add(node);
        ctx.ensureFunctionNode(indexed.fn);
        record(indexed.id, indexed.file, node, client, asked);
        return;
      }
    });
  }
});

/** Whether a name is imported from one of these packages, or from a module below one. */
const importedFrom = (identifier: TsNode, packages: readonly string[]): boolean => {
  const declaration = identifier.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isImportSpecifier(declaration)) return false;
  const module = declaration.getImportDeclaration().getModuleSpecifierValue();
  return packages.some((name) => module === name || module.startsWith(`${name}/`));
};
