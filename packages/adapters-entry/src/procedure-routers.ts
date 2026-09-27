import type {
  EntryAdapter,
  EntryHandler,
  EntryKind,
  EntryNode,
  EntryWrapping,
  ExtractContext,
} from '@flowatlas/core';
import { hasAnyDependency, makeEntryId } from '@flowatlas/core';
import type { Node as TsNode, SourceFile, Symbol as TsSymbol } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ProcedureDialect } from './procedure-dialects.js';
import { TRPC } from './procedure-dialects.js';
import {
  enclosingClass,
  fileOfNode,
  handlerOfFunction,
  handlerReturned,
  inlineHandlerOf,
  repoFunctionOf,
  repoSources,
  unwrapValue,
} from './shared.js';

/** How much of an expression is quoted when it is named rather than followed. */
const LABEL_LENGTH = 40;

const label = (node: TsNode | undefined): string =>
  node === undefined ? '<none>' : node.getText().replace(/\s+/g, ' ').slice(0, LABEL_LENGTH);

/** Where something was written, kept so a folded row still points somewhere. */
interface Site {
  file: string;
  line: number;
}

const siteOf = (node: TsNode, ctx: ExtractContext): Site => ({
  file: fileOfNode(node, ctx),
  line: node.getStartLineNumber(),
});

/**
 * What a name stands for, asked the way the position it sits in requires.
 *
 * One function because there is one question, and one branch because a shorthand
 * property is the position where asking it the ordinary way gives the wrong
 * answer without failing: `{ loggedInViewerRouter }` declares a member *and*
 * refers to an import, the name node carries the member's symbol, and following
 * it leads back to the literal it was written in rather than to the tree it
 * names. Nine of cal.com's ways in lost their address that way, and the checker
 * has a question for precisely this case.
 */
const symbolOf = (expr: TsNode): TsSymbol | undefined => {
  const parent = expr.getParent();
  if (
    parent !== undefined &&
    Node.isShorthandPropertyAssignment(parent) &&
    parent.getNameNode().getStart() === expr.getStart()
  ) {
    return parent.getValueSymbol();
  }
  return expr.getSymbol();
};

/** The value a name was declared with, following imports and default exports. */
const declaredValue = (expr: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(expr)) return undefined;
  const symbol = symbolOf(expr);
  const target = symbol?.getAliasedSymbol() ?? symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return unwrapValue(initializer);
    }
    // `export default authedProcedure`, which is how a guarded starting point is
    // usually published, so the guards on it are only reachable through this.
    if (Node.isExportAssignment(declaration)) return unwrapValue(declaration.getExpression());
  }
  return undefined;
};

/** One link of a chain of calls, as written. */
interface Link {
  method: string;
  args: TsNode[];
}

/**
 * A chain of method calls, walked back to whatever it starts from.
 *
 * Both halves of a procedure are read through this: the chain written at the way
 * in, and the chain the name it starts from was itself declared with. That is
 * what makes one walk enough for a guard nobody wrote near the thing it guards.
 * The links come back in source order, which is the order the framework applies
 * them in.
 */
const chainOf = (expr: TsNode): { links: Link[]; base: TsNode } => {
  const links: Link[] = [];
  let at = unwrapValue(expr);
  while (Node.isCallExpression(at)) {
    const callee = at.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    links.unshift({ method: callee.getName(), args: at.getArguments() });
    at = unwrapValue(callee.getExpression());
  }
  return { links, base: at };
};

/**
 * Everything installed in front of a way in, including what is nowhere near it.
 *
 * Nobody writes the guard at the procedure. They write one guarded starting
 * point — `const authedProcedure = procedure.use(perf).use(errors).use(isAuthed)`
 * — and start every guarded chain from that name, in another file. So this
 * follows the name and reads the chain it was declared with, and then follows
 * whatever *that* one starts from, because a project usually has two or three
 * built on each other.
 *
 * Depth is bounded by the set of names already followed rather than by a number:
 * the thing that could go on for ever is a cycle, and a cycle is exactly what
 * the set catches.
 */
const guardsBefore = (
  expr: TsNode,
  dialect: ProcedureDialect,
  seen: ReadonlySet<string>,
  ctx: ExtractContext,
): EntryWrapping[] => {
  if (dialect.guardMethod === undefined || !Node.isIdentifier(expr)) return [];
  const name = expr.getText();
  if (seen.has(name)) return [];
  const value = declaredValue(expr);
  if (value === undefined) return [];
  const { links, base } = chainOf(value);
  // Installed on a starting point, which is a prefix of every chain begun from
  // it: that is the scope, and the name it was installed on is how.
  const here = guardsOn(links, dialect, 'prefix', name, ctx);
  return [...guardsBefore(base, dialect, new Set([...seen, name]), ctx), ...here];
};

/**
 * The guards one chain installs, described for the extractor to draw.
 *
 * Described rather than listed on the way in: each becomes a node and a
 * `guarded_by` edge in the order it runs, the shape every other reader draws. A
 * list on the entry read as an unguarded way in to everything that walks the
 * graph as a graph (R109). The node is where the argument is written, so a
 * guard installed once on a starting point is one node however many ways in
 * begin from it.
 */
const guardsOn = (
  links: readonly Link[],
  dialect: ProcedureDialect,
  scope: 'prefix' | 'route',
  source: string,
  ctx: ExtractContext,
): EntryWrapping[] =>
  links
    .filter((link) => link.method === dialect.guardMethod)
    .flatMap((link) =>
      link.args.map((argument) => ({
        label: label(argument),
        layer: 'middleware' as const,
        scope,
        source,
        ...siteOf(argument, ctx),
        kind: 'function',
      })),
    );

/** Whether an argument is a function, however it was written. */
const isFunctionArg = (argument: TsNode | undefined): boolean => {
  if (argument === undefined) return false;
  if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) return true;
  return repoFunctionOf(argument) !== undefined;
};

/** One way in, as declared. */
interface Procedure {
  kind: EntryKind;
  /** The method that ended the chain, as it is spelled. */
  call: string;
  handler?: EntryHandler;
  handlerVia: 'function' | 'call' | 'inline';
  /**
   * The function written in the declaration, when that is what answers.
   *
   * Carried rather than turned into a handler here, because a function written in
   * place has no name and the only thing that can stand for one is the address it
   * answers at — which this does not know yet, and the walk does.
   */
  inlineAt?: TsNode;
  /** The shape a caller sends, as it is spelled. */
  input?: string;
  /** Everything installed in front of it, in the order it applies. */
  guards: EntryWrapping[];
  site: Site;
}

/** A chain that ends the way a way in does, and nothing about what answers it. */
interface Ending {
  call: TsNode;
  method: string;
  kind: EntryKind;
  handlerArg: TsNode;
  receiver: TsNode;
}

/**
 * Whether a value is a way in, and nothing more than whether.
 *
 * This is the whole of what separates a tree of ways in from any other object
 * literal, so it is deliberately strict: the last link of the chain is a method
 * the description names, and it was handed exactly one function. Neither half is
 * a fact about tRPC — every framework of this family ends a builder the same way
 * — and together they are a shape a repository does not write by accident, which
 * is why nothing here needs a type to be resolvable.
 *
 * Separate from reading the way in because the question is asked twice for two
 * different purposes and the second half of the answer is expensive. Deciding
 * whether a call assembled a tree means asking this of every member of every
 * candidate; finding the code behind a way in means walking a function body. Only
 * the members of a confirmed tree are worth the second.
 */
const endingOf = (value: TsNode, dialect: ProcedureDialect): Ending | undefined => {
  const node = unwrapValue(value);
  if (!Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  const kind = dialect.terminators.get(method);
  if (kind === undefined) return undefined;
  const args = node.getArguments();
  if (args.length !== 1 || !isFunctionArg(args[0])) return undefined;
  return {
    call: node,
    method,
    kind,
    handlerArg: args[0] as TsNode,
    receiver: callee.getExpression(),
  };
};

/** The way in a value is, with the code behind it and everything in front of it. */
const procedureOf = (
  value: TsNode,
  dialect: ProcedureDialect,
  ctx: ExtractContext,
): Procedure | undefined => {
  const ending = endingOf(value, dialect);
  if (ending === undefined) return undefined;
  const { call: node, kind, handlerArg } = ending;
  const { links, base } = chainOf(ending.receiver);
  const input =
    dialect.inputMethod === undefined
      ? undefined
      : links.find((link) => link.method === dialect.inputMethod)?.args[0];
  const onChain =
    dialect.guardMethod === undefined
      ? []
      : guardsOn(links, dialect, 'route', `.${dialect.guardMethod}`, ctx);

  const named = repoFunctionOf(handlerArg);
  const returned = named === undefined ? handlerReturned(handlerArg, enclosingClass(node), ctx) : undefined;
  const via = named !== undefined ? 'function' : returned !== undefined ? 'call' : 'inline';
  const handler =
    named !== undefined ? handlerOfFunction(named, ctx) : (returned ?? undefined);

  return {
    kind,
    call: ending.method,
    ...(handler === undefined ? {} : { handler }),
    handlerVia: via,
    ...(via === 'inline' ? { inlineAt: handlerArg } : {}),
    ...(input === undefined ? {} : { input: label(input) }),
    guards: [...guardsBefore(base, dialect, new Set(), ctx), ...onChain],
    site: siteOf(node, ctx),
  };
};

/** One member of a tree: a key, and whatever was written under it. */
interface Member {
  /** The key, when it was written as one a reader can name. */
  key?: string;
  value: TsNode;
  site: Site;
}

/** A tree of named ways in, as one call assembled it. */
interface Tree {
  call: TsNode;
  site: Site;
  /** How the call is written, for a reader looking for it again. */
  registration: string;
  members: Member[];
}

/**
 * The key a property is written under, or nothing when it is computed.
 *
 * A shorthand property — `{ loggedInViewerRouter }` — is a key as much as a
 * written one, and cal.com's own root uses both spellings in one literal.
 */
const memberOf = (property: TsNode, ctx: ExtractContext): Member | undefined => {
  if (Node.isShorthandPropertyAssignment(property)) {
    return { key: property.getName(), value: property.getNameNode(), site: siteOf(property, ctx) };
  }
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  if (initializer === undefined) return undefined;
  const nameNode = property.getNameNode();
  const key =
    Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode)
      ? nameNode.getText().replace(/^['"]|['"]$/g, '')
      : undefined;
  return {
    ...(key === undefined ? {} : { key }),
    value: initializer,
    site: siteOf(property, ctx),
  };
};

/** The name a call is made under, whether written bare or through something. */
const calleeName = (call: TsNode): string | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/** Every tree one file assembles, by the call that assembled it. */
const treesIn = function* (
  sourceFile: SourceFile,
  dialect: ProcedureDialect,
  ctx: ExtractContext,
): Generator<Tree> {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (name === undefined || !dialect.assembledBy.includes(name)) continue;
    const [argument] = call.getArguments();
    if (argument === undefined) continue;
    const literal = unwrapValue(argument);
    if (!Node.isObjectLiteralExpression(literal)) continue;
    const members: Member[] = [];
    for (const property of literal.getProperties()) {
      const member = memberOf(property, ctx);
      if (member !== undefined) members.push(member);
    }
    yield { call, site: siteOf(call, ctx), registration: `${name}({ … })`, members };
  }
};

/**
 * The value a name was declared with, or the value itself when it is written in
 * place.
 *
 * One helper for both, because every member of a tree is one or the other and
 * nothing that looks at a member cares which: a nested literal and an imported
 * one are the same fact spelled differently.
 */
const valueOf = (member: Member): TsNode => {
  const written = unwrapValue(member.value);
  return declaredValue(written) ?? written;
};

/**
 * Every call that might have assembled a tree, and which of them did.
 *
 * A candidate is any call to a name the description lists, handed an object
 * literal. That alone is not enough to be a tree — `router({ home: '/' })` in a
 * project with a table of page paths matches it exactly — so a candidate becomes
 * a tree only on evidence: one of its members is a way in, or one of its members
 * is a tree. The second half is what makes this a fixpoint rather than a filter,
 * because a root whose every member is another tree holds no way in of its own
 * and is still the root of all of them.
 *
 * Confirming rather than reporting is the point. A candidate that is not a tree
 * produces nothing at all: no ways in, and no rows about the members of a thing
 * that was never a tree. Two rows per unrelated object literal is worse than
 * silence, because it is the tool being wrong at length.
 */
class Forest {
  readonly #candidates = new Map<TsNode, Tree>();
  readonly #trees = new Set<Tree>();
  readonly #referenced = new Set<Tree>();
  readonly #dialect: ProcedureDialect;

  constructor(dialect: ProcedureDialect) {
    this.#dialect = dialect;
  }

  add(tree: Tree): void {
    this.#candidates.set(tree.call, tree);
  }

  /** The tree a value stands for, whether written in place or named elsewhere. */
  at(value: TsNode): Tree | undefined {
    const candidate = this.#candidates.get(value);
    return candidate !== undefined && this.#trees.has(candidate) ? candidate : undefined;
  }

  /**
   * Which candidates are trees, and which trees are members of another.
   *
   * Asked once, after every file has been read, because a tree may be assembled
   * in a file read after the one that refers to it: a walk that decided as it
   * went would call the same tree a root in one order and a member in another.
   */
  settle(): void {
    const nested = new Map<Tree, Tree[]>();
    for (const tree of this.#candidates.values()) {
      const members: Tree[] = [];
      for (const member of tree.members) {
        const candidate = this.#candidates.get(valueOf(member));
        if (candidate !== undefined) members.push(candidate);
      }
      nested.set(tree, members);
      if (tree.members.some((member) => endingOf(valueOf(member), this.#dialect) !== undefined)) {
        this.#trees.add(tree);
      }
    }
    // A tree of trees is a tree. Repeated because confirming one can confirm the
    // one above it, and the one above that.
    for (let moved = true; moved; ) {
      moved = false;
      for (const [tree, members] of nested) {
        if (this.#trees.has(tree)) continue;
        if (!members.some((member) => this.#trees.has(member))) continue;
        this.#trees.add(tree);
        moved = true;
      }
    }
    for (const [tree, members] of nested) {
      if (!this.#trees.has(tree)) continue;
      for (const member of members) {
        if (this.#trees.has(member)) this.#referenced.add(member);
      }
    }
  }

  /**
   * Every tree nothing else holds, which is where an address starts.
   *
   * A repository usually has one, and a repository with several really does have
   * several: a tree nobody assembled into another is served on its own, and its
   * members' addresses start at its own members. A tree that is a member of
   * another is not a root even if it is also mounted by itself, because the
   * address a caller writes is the one the client's type gives it, and that comes
   * from the top.
   */
  roots(): Tree[] {
    return [...this.#trees].filter((tree) => !this.#referenced.has(tree));
  }

  /** How many calls looked like a tree, and how many turned out to be one. */
  get candidates(): number {
    return this.#candidates.size;
  }

  get size(): number {
    return this.#trees.size;
  }
}

const MOUNT_HINT =
  'Import the tree from a file inside this service, or add the package it comes from to sharedPackages, so the ways in it serves can be read.';

/**
 * A file that serves a tree, and where the tree came from.
 *
 * The one thing a mount is read for. A repository of this shape hangs its tree in
 * a file of three lines, and until now such a file was an address with no handler
 * behind it and nothing anywhere saying that three quarters of the API was under
 * it. Where the tree was followed this records which file serves it; where it was
 * not, the file says so itself.
 */
interface Mount {
  site: Site;
  tree?: Tree;
  named: string;
}

const mountsIn = function* (
  sourceFile: SourceFile,
  dialect: ProcedureDialect,
  forest: Forest,
  ctx: ExtractContext,
): Generator<Mount> {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (name === undefined) continue;
    const mount = dialect.mounts.find((each) => each.call === name);
    if (mount === undefined) continue;
    const args = call.getArguments();
    const at = args[mount.treeAt];
    if (at === undefined) continue;
    // The options spelling first, because a wrapper that takes the tree alone is
    // recognised by the object not being there rather than by a second row.
    const written = unwrapValue(at);
    const keyed =
      mount.treeKey !== undefined && Node.isObjectLiteralExpression(written)
        ? written.getProperty(mount.treeKey)
        : undefined;
    const value = keyed === undefined ? written : (memberOf(keyed, ctx)?.value ?? written);
    const resolved = unwrapValue(value);
    const tree = forest.at(resolved) ?? forest.at(declaredValue(resolved) ?? resolved);
    yield { site: siteOf(call, ctx), ...(tree === undefined ? {} : { tree }), named: label(value) };
  }
};

export interface ProcedureRoutersOptions {
  /**
   * Whether reading nothing is something somebody should act on.
   *
   * The same distinction the route reader draws, for the same reason. Reading
   * nothing is always worth a row, and the level is what differs: on for a
   * description somebody wrote, where silence is a spelling mistake with a fix;
   * off for the row shipped with the tool, where it is a limit of this reading
   * and the reader is stating it rather than asking for anything.
   */
  readonly reportSilence?: boolean;
}

/**
 * Ways into a repository that keeps them in a tree of object literals.
 *
 * A procedure is a way into a service exactly as much as a route is: a named
 * thing a caller asks for, with a shape it sends, a body, and callers on the
 * other side of a boundary. So these are ordinary entry points, and the address
 * is the one a caller actually writes — every key from the root of the tree down
 * to the procedure, joined the way the client's own type joins them.
 *
 * Not an HTTP address, and that is a decision rather than an omission. Such a
 * tree is served over HTTP, but *at which URL* is a property of the link the
 * client was configured with rather than of anything in the tree: cal.com hangs
 * twenty-nine slices of one tree at twenty-nine different paths and its client
 * still names every one of them `viewer.<slice>.<procedure>`. Publishing a URL
 * would be publishing a guess, and a wrong address is worse than none. The
 * dotted path is the string both ends really write, and it is on the entry twice
 * — as the key of the id and as `meta.key` — so whatever joins the two halves
 * later joins on the thing that is actually shared.
 *
 * What this reads and what a description says is the split argued in
 * `procedure-dialects.ts`. What is here and nowhere else is the walk: that keys
 * name members, that a member is a way in or another tree, that an address is
 * every key above it, and that a tree nothing else holds is where an address
 * starts. None of those is a fact about any one framework, which is why none of
 * them is a field.
 */
export const procedureRoutersAdapter = (
  dialect: ProcedureDialect,
  options: ProcedureRoutersOptions = {},
): EntryAdapter => ({
  name: dialect.name,
  // The tree answers before the application the extractor reads is asked
  // anything — a handler built from it and exported, or a worker in front of it —
  // so that application's guards and pipes never run for these and none are drawn.
  // What does stand in front of them is on the chain, and is read.
  outsideApplication: true,
  detect: (pkg) => hasAnyDependency(pkg, dialect.packages),
  extractEntries: (ctx: ExtractContext): EntryNode[] => {
    const sources = [...repoSources(ctx)];
    const forest = new Forest(dialect);
    for (const sourceFile of sources) {
      for (const tree of treesIn(sourceFile, dialect, ctx)) forest.add(tree);
    }
    forest.settle();

    const mounts: Mount[] = [];
    for (const sourceFile of sources) {
      mounts.push(...mountsIn(sourceFile, dialect, forest, ctx));
    }
    /** Which files serve each tree, so an entry can say where it is answered. */
    const servedBy = new Map<Tree, string[]>();
    for (const mount of mounts) {
      if (mount.tree === undefined) continue;
      const files = servedBy.get(mount.tree) ?? [];
      files.push(mount.site.file);
      servedBy.set(mount.tree, files);
    }

    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const unread: Array<{ site: Site; address: string; named: string }> = [];
    let members = 0;

    const emit = (address: string, procedure: Procedure, served: readonly string[], tree: Tree): void => {
      const id = makeEntryId(ctx.repo, procedure.kind, address);
      if (seen.has(id)) return;
      seen.add(id);
      // A function written in the declaration is still the code that runs, and a
      // node of its own is what lets a walk from the way in go on into it. The
      // address is its name, because it is the only name there is.
      //
      // So a way in never wants a row saying nothing can be pointed at, which is
      // where the route reader has one and this does not: a way in is only
      // recognised at all when a function was handed over, and there are exactly
      // two ways to hand one over — a name, or a function written here. Both end
      // in something the graph can point at, so the third case a row would be
      // about cannot arise.
      const inline =
        procedure.inlineAt === undefined
          ? undefined
          : inlineHandlerOf(procedure.inlineAt, address, ctx);
      const handler = procedure.handler ?? inline;
      entries.push({
        id,
        kind: procedure.kind,
        label: `${procedure.kind} ${address}`,
        key: address,
        ...(handler === undefined ? {} : { handler }),
        file: procedure.site.file,
        line: procedure.site.line,
        ...(procedure.guards.length > 0 ? { wrapping: procedure.guards } : {}),
        meta: {
          // How a person names this way in, and the one string a caller of it
          // writes too: `viewer.bookings.get`.
          key: address,
          adapter: dialect.name,
          // Which of the chain's endings this was, so a reader can tell the one
          // that reads from the one that writes. Two spellings, one kind.
          call: procedure.call,
          registration: tree.registration,
          ...(procedure.input === undefined ? {} : { input: procedure.input }),
          // Read in full, mounts and all: the description says where a guard is
          // installed and the walk follows the name it was installed on, so an
          // audit that found none here really did look.
          middlewareRead: true,
          handlerVia: procedure.handlerVia,
          ...(served.length > 0 ? { served: [...new Set(served)].sort() } : {}),
        },
      });
    };

    /**
     * Walks one tree, naming each member by every key above it.
     *
     * `served` accumulates down the path rather than being the root's alone,
     * because a repository may hang the whole tree in one file and each of its
     * branches in a file of its own — cal.com mounts twenty-nine — and a way in
     * really is answered at all of them.
     */
    const walk = (
      tree: Tree,
      prefix: string,
      path: ReadonlySet<Tree>,
      served: readonly string[],
    ): void => {
      for (const member of tree.members) {
        members += 1;
        if (member.key === undefined) {
          ctx.builder.addUnresolved({
            file: member.site.file,
            line: member.site.line,
            reason: 'procedure-key-dynamic',
            hint: 'Write the key as a name or a string, so the way in under it can be named and joined to a caller.',
            symbol: `${prefix === '' ? tree.registration : prefix}.${label(member.value)}`,
            adapter: dialect.name,
          });
          continue;
        }
        const address = prefix === '' ? member.key : `${prefix}${dialect.separator}${member.key}`;
        const value = valueOf(member);
        const procedure = procedureOf(value, dialect, ctx);
        if (procedure !== undefined) {
          emit(address, procedure, served, tree);
          continue;
        }
        const nested = forest.at(value);
        if (nested === undefined) {
          unread.push({ site: member.site, address, named: label(member.value) });
          continue;
        }
        // A tree that holds itself, directly or through others. The framework
        // would not accept it; reading it would not stop.
        if (path.has(nested)) continue;
        walk(nested, address, new Set([...path, nested]), [
          ...served,
          ...(servedBy.get(nested) ?? []),
        ]);
      }
    };

    for (const root of forest.roots()) {
      walk(root, '', new Set([root]), servedBy.get(root) ?? []);
    }

    reportUnmounted(ctx, mounts, dialect);
    if (unread.length > 0) reportUnreadMembers(ctx, unread, dialect);
    if (entries.length === 0) {
      reportSilence(ctx, dialect, forest.candidates, members, options.reportSilence === true);
    }
    return entries;
  },
});

/**
 * A file that serves a tree nobody could follow.
 *
 * The row the ticket asked for first, and the one that is most of the value. A
 * repository of this shape is a handful of three-line files, each turning a tree
 * into a handler, and each of them read — correctly, and uselessly — as one
 * address answering every verb with no handler behind it. One row per such file,
 * naming itself, because each is a different tree and a different quarter of the
 * API: folding them would say "some of your ways in are missing" to somebody who
 * needs to know which.
 */
const reportUnmounted = (
  ctx: ExtractContext,
  mounts: readonly Mount[],
  dialect: ProcedureDialect,
): void => {
  for (const mount of mounts) {
    if (mount.tree !== undefined) continue;
    ctx.builder.addUnresolved({
      file: mount.site.file,
      line: mount.site.line,
      reason: 'procedure-router-unread',
      message: `${mount.site.file} serves ${mount.named}, a tree of ways in that could not be followed from here, so nothing says which ways in this file answers.`,
      hint: MOUNT_HINT,
      symbol: mount.named,
      adapter: dialect.name,
    });
  }
};

/**
 * A member of a tree that is neither a way in nor another tree.
 *
 * Nearly always a tree imported from somewhere outside what was read, and the
 * address is the interesting half: it says which branch of the API went missing,
 * which is what a reader needs in order to decide whether it matters.
 */
const reportUnreadMembers = (
  ctx: ExtractContext,
  unread: ReadonlyArray<{ site: Site; address: string; named: string }>,
  dialect: ProcedureDialect,
): void => {
  for (const member of unread) {
    ctx.builder.addUnresolved({
      file: member.site.file,
      line: member.site.line,
      reason: 'procedure-branch-unread',
      message: `${member.address} is ${member.named}, a name this could follow to neither a way in nor a tree, so nothing under it was read.`,
      hint: MOUNT_HINT,
      symbol: member.address,
      adapter: dialect.name,
    });
  }
};

/**
 * A reader that read nothing, and which part of it read nothing.
 *
 * The failure mode of any reader driven by a description is silence that looks
 * like a clean repository, and there are two silences here wanting different
 * answers. No tree at all means nothing in the repository is assembled by a
 * function the description names — the likeliest cause being a project that
 * renamed the builder on the way out of its own module. Trees with members and no
 * way in among them means the assembling names are right and the chain endings
 * are not.
 *
 * Informational, because this row ships with the tool rather than describing
 * somebody's configuration: a repository that depends on the library and declares
 * no tree is an ordinary thing, and what the reader is doing here is stating a
 * limit rather than asking for a fix.
 */
const reportSilence = (
  ctx: ExtractContext,
  dialect: ProcedureDialect,
  candidates: number,
  members: number,
  actionable: boolean,
): void => {
  const assemblers = dialect.assembledBy.join(', ');
  const endings = [...dialect.terminators.keys()].join(', ');
  const named = actionable ? `${dialect.name} description` : `${dialect.name} reader`;
  ctx.builder.addUnresolved({
    file: 'package.json',
    line: 1,
    reason: candidates === 0 ? 'procedure-trees-unmatched' : 'procedure-members-unmatched',
    ...(actionable ? {} : { level: 'info' as const }),
    message:
      candidates === 0
        ? `Nothing here is assembled by any of the functions the ${named} names, so no way in was read from a tree.`
        : `${candidates} call${candidates === 1 ? '' : 's'} to one of those functions ${candidates === 1 ? 'was' : 'were'} handed an object literal, and no member of any of them ended a chain the way a way in does — so none of them was a tree.`,
    hint:
      candidates === 0
        ? actionable
          ? `Check assembledBy on that description; it looks for ${assemblers}.`
          : `Ordinary where ${dialect.packages[0] as string} is a dependency and no tree is assembled here — a client-only repository, or one whose tree lives in another. It looks for ${assemblers}.`
        : actionable
          ? `Check terminators on that description; it recognises a way in by a chain ending in ${endings} with one function handed to it.`
          : `The trees match and their members do not. This reader recognises a way in by a chain ending in ${endings} with one function handed to it; something here ends them another way.`,
    symbol: dialect.name,
    adapter: dialect.name,
  });
};

export const trpcProceduresAdapter = procedureRoutersAdapter(TRPC);
