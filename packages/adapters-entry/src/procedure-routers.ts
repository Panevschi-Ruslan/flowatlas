import type {
  EntryAdapter,
  EntryHandler,
  EntryKind,
  EntryNode,
  EntryWrapping,
  ExtractContext,
  StatedSignature,
} from '@flowatlas/core';
import {
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizePath,
  placedFunction,
  suppliedTypes,
  startLineOf,
} from '@flowatlas/core';
import type {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node as TsNode,
  SourceFile,
  Symbol as TsSymbol,
  Type,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ProcedureDialect, ProcedureMount } from './procedure-dialects.js';
import { ORPC, TRPC } from './procedure-dialects.js';
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

/**
 * How a guard is named: a function written in place by where it is, and
 * anything else by how it is spelled.
 *
 * A function written in place has no name, and it used to be labelled with the
 * first forty characters of its text - `async ({ ctx, input, next }) => { // End`
 * on a scheduling app - which named nothing and matched nothing. It is named instead the
 * way the walk over bodies names it (`placedFunction`), so the node drawn in
 * front of the way in and the node its queries hang off are one node (R157).
 */
const guardLabel = (argument: TsNode): string => {
  const value = unwrapValue(argument);
  return Node.isArrowFunction(value) || Node.isFunctionExpression(value)
    ? placedFunction(value).name
    : label(argument);
};

/** Where something was written, kept so a folded row still points somewhere. */
interface Site {
  file: string;
  line: number;
}

const siteOf = (node: TsNode, ctx: ExtractContext): Site => ({
  file: fileOfNode(node, ctx),
  line: startLineOf(node),
});

/**
 * What a name stands for, asked the way the position it sits in requires.
 *
 * One function because there is one question, and one branch because a shorthand
 * property is the position where asking it the ordinary way gives the wrong
 * answer without failing: `{ loggedInViewerRouter }` declares a member *and*
 * refers to an import, the name node carries the member's symbol, and following
 * it leads back to the literal it was written in rather than to the tree it
 * names. Nine of a scheduling app's ways in lost their address that way, and the checker
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

/** The chain one named starting point was declared with, and the name. */
interface Step {
  links: Link[];
  name: string;
}

/** A contract a chain implements, and which of its members the chain names (P58). */
interface Implemented {
  call: TsNode;
  names: string[];
}

/** Everything a chain starts from, the root first. */
interface Origin {
  steps: Step[];
  implemented?: Implemented;
}

/**
 * Everything a chain starts from, including what is nowhere near it.
 *
 * Nobody writes the guard at the procedure. They write one guarded starting
 * point — `const authedProcedure = procedure.use(perf).use(errors).use(isAuthed)`
 * — and start every guarded chain from that name, in another file. So this
 * follows the name and reads the chain it was declared with, and then follows
 * whatever *that* one starts from, because a project usually has two or three
 * built on each other. What is read off the steps is the guards, and the
 * failures a starting point declares (P58).
 *
 * A chain may also start from a contract's member - `os.orders.list.handler(fn)`
 * with `os` made by `implement(contract)` - and the names between the root and
 * the chain are then the member's path in the contract (P58). They are carried
 * up to the call that was handed the contract.
 *
 * Depth is bounded by the set of names already followed rather than by a number:
 * the thing that could go on for ever is a cycle, and a cycle is exactly what
 * the set catches.
 */
const originOf = (
  expr: TsNode,
  dialect: ProcedureDialect,
  seen: ReadonlySet<string> = new Set(),
): Origin => {
  const names: string[] = [];
  let at = unwrapValue(expr);
  while (Node.isPropertyAccessExpression(at)) {
    names.unshift(at.getName());
    at = unwrapValue(at.getExpression());
  }
  if (Node.isCallExpression(at)) {
    const called = calleeName(at);
    return called !== undefined && dialect.implementedBy.includes(called)
      ? { steps: [], implemented: { call: at, names } }
      : { steps: [] };
  }
  if (!Node.isIdentifier(at)) return { steps: [] };
  const name = at.getText();
  if (seen.has(name)) return { steps: [] };
  const value = declaredValue(at);
  if (value === undefined) return { steps: [] };
  const { links, base } = chainOf(value);
  const inner = originOf(base, dialect, new Set([...seen, name]));
  return {
    steps: [...inner.steps, { links, name }],
    ...(inner.implemented === undefined
      ? {}
      : { implemented: { call: inner.implemented.call, names: [...inner.implemented.names, ...names] } }),
  };
};

/**
 * The guards a chain's starting points install, the root's first.
 *
 * Installed on a starting point, which is a prefix of every chain begun from
 * it: that is the scope, and the name it was installed on is how.
 */
const guardsBefore = (origin: Origin, dialect: ProcedureDialect, ctx: ExtractContext): EntryWrapping[] =>
  origin.steps.flatMap((step) => guardsOn(step.links, dialect, 'prefix', step.name, ctx));

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
        label: guardLabel(argument),
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
  /** Where the input's schema is written, for the refusal of an input that does not match it (P58). */
  inputSite?: Site;
  /** The shape it answers with, as it is spelled, where a schema says so (P58). */
  output?: string;
  /** What it takes and answers, as the schema and the resolver say (P35). */
  signature: StatedSignature;
  /** Everything installed in front of it, in the order it applies. */
  guards: EntryWrapping[];
  /** The failures it declares it may answer with, by code (P58). */
  errors: DeclaredError[];
  /** Its own HTTP route, where one is written (P58). */
  route?: ProcedureRoute;
  /** The contract's member could not be followed, and what it is called (P58). */
  contractUnread?: { site: Site; named: string };
  site: Site;
}

/** A failure a way in declares it may answer with (P58). */
export interface DeclaredError {
  code: string;
  /** The status written in the declaration; absent where the framework's own table answers. */
  status?: number;
}

/** The HTTP route a way in gives itself (P58). */
export interface ProcedureRoute {
  method?: string;
  path?: string;
}

/** A string a reader can name, from a literal or a template with no holes. */
const literalText = (node: TsNode | undefined): string | undefined => {
  if (node === undefined) return undefined;
  const value = unwrapValue(node);
  return Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ? value.getLiteralText() : undefined;
};

/** The value written under one key of an object literal, or nothing. */
const propertyValue = (literal: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(literal)) return undefined;
  const property = literal.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

/**
 * The codes an errors link declares: the keys of its object literal, each with
 * the `status` its definition writes, where it writes one as a number.
 */
const errorsDeclared = (links: readonly Link[], dialect: ProcedureDialect): DeclaredError[] => {
  if (dialect.errorsMethod === undefined) return [];
  const found: DeclaredError[] = [];
  for (const link of links) {
    if (link.method !== dialect.errorsMethod) continue;
    const [argument] = link.args;
    const literal = argument === undefined ? undefined : unwrapValue(argument);
    if (literal === undefined || !Node.isObjectLiteralExpression(literal)) continue;
    for (const property of literal.getProperties()) {
      if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) continue;
      const code = property.getName().replace(/^['"]|['"]$/g, '');
      const definition = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      const status = definition === undefined ? undefined : propertyValue(unwrapValue(definition), 'status');
      const written = status !== undefined && Node.isNumericLiteral(unwrapValue(status)) ? Number(unwrapValue(status).getText()) : undefined;
      found.push({ code, ...(written === undefined ? {} : { status: written }) });
    }
  }
  return found;
};

/** The route a chain's route links write, the later link's word winning. */
const routeWritten = (links: readonly Link[], dialect: ProcedureDialect, into: ProcedureRoute = {}): ProcedureRoute => {
  if (dialect.routeMethod === undefined) return into;
  let route = into;
  for (const link of links) {
    if (link.method !== dialect.routeMethod) continue;
    const [argument] = link.args;
    const literal = argument === undefined ? undefined : unwrapValue(argument);
    if (literal === undefined) continue;
    const method = literalText(propertyValue(literal, 'method'));
    const path = literalText(propertyValue(literal, 'path'));
    route = { ...route, ...(method === undefined ? {} : { method: method.toUpperCase() }), ...(path === undefined ? {} : { path }) };
  }
  return route;
};

/** Every declared failure once, the nearest declaration's status winning, by code. */
const settleErrors = (errors: readonly DeclaredError[]): DeclaredError[] => {
  const byCode = new Map<string, DeclaredError>();
  for (const error of errors) byCode.set(error.code, { ...byCode.get(error.code), ...error });
  return [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
};

/** The links of a contract's member, and the route prefix the contract's trees above it add. */
interface ContractMember {
  links: Link[];
  prefix: string;
}

/** How many names a contract is followed through before giving up. */
const MOST_CONTRACT_STEPS = 16;

/**
 * The member of a contract a chain implements (P58).
 *
 * The contract is the first argument of the call that was handed it, followed
 * through names and imports to an object literal - or to a call that assembles
 * one, whose own prefix link is read on the way down - and each name is a key
 * of the literal it reaches. The member is a chain, and its links are what the
 * way in's input, output, errors and route are read from.
 */
const contractMemberOf = (
  implemented: Implemented,
  dialect: ProcedureDialect,
  ctx: ExtractContext,
): ContractMember | undefined => {
  if (!Node.isCallExpression(implemented.call)) return undefined;
  const [argument] = implemented.call.getArguments();
  if (argument === undefined) return undefined;
  let at: TsNode = unwrapValue(argument);
  let prefix = '';
  const literalOf = (value: TsNode): TsNode | undefined => {
    let node = unwrapValue(value);
    for (let step = 0; step < MOST_CONTRACT_STEPS; step += 1) {
      if (Node.isObjectLiteralExpression(node)) return node;
      if (Node.isIdentifier(node)) {
        const declared = declaredValue(node);
        if (declared === undefined) return undefined;
        node = declared;
        continue;
      }
      if (Node.isCallExpression(node)) {
        const name = calleeName(node);
        if (name === undefined || !dialect.assembledBy.includes(name)) return undefined;
        const callee = node.getExpression();
        if (Node.isPropertyAccessExpression(callee)) {
          const { links } = chainOf(callee.getExpression());
          prefix += routePrefixOf(links, dialect);
        }
        const [tree] = node.getArguments();
        if (tree === undefined) return undefined;
        node = unwrapValue(tree);
        continue;
      }
      return undefined;
    }
    return undefined;
  };
  for (const name of implemented.names) {
    const literal = literalOf(at);
    if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return undefined;
    const property = literal.getProperty(name);
    if (property === undefined) return undefined;
    const member = memberOf(property, ctx);
    if (member === undefined) return undefined;
    at = valueOf(member, dialect);
  }
  const { links } = chainOf(at);
  return links.length === 0 ? undefined : { links, prefix };
};

/** The prefix a tree's assembling chain writes for the routes under it. */
const routePrefixOf = (links: readonly Link[], dialect: ProcedureDialect): string =>
  dialect.prefixMethod === undefined
    ? ''
    : links
        .filter((link) => link.method === dialect.prefixMethod)
        .map((link) => literalText(link.args[0]) ?? '')
        .join('');

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

/**
 * What a schema hands the resolver once it has checked the input, by how the
 * library says it: zod and its kin carry it as `_output`, a schema with a
 * `parse` method returns it, and a plain object or a function validator is
 * read as what it is or returns (P35).
 */
const SCHEMA_OUTPUT: ReadonlyArray<(type: Type, site: TsNode) => Type | undefined> = [
  (type, site) => type.getProperty('_output')?.getTypeAtLocation(site),
  (type, site) => type.getProperty('parse')?.getTypeAtLocation(site).getCallSignatures()[0]?.getReturnType(),
  (type) => type.getCallSignatures()[0]?.getReturnType(),
  (type) => type,
];

const schemaOutput = (schema: TsNode): Type => {
  const type = schema.getType();
  for (const read of SCHEMA_OUTPUT) {
    const found = read(type, schema);
    if (found !== undefined) return found;
  }
  return type;
};

/** A procedure's input, and what its resolver answers - the promise it returns settled by the collector. */
const procedureSignature = (input: TsNode | undefined, resolver: TsNode, output?: TsNode): StatedSignature => {
  // A schema the answer is checked against is what a caller gets, where one is
  // written (P58); otherwise what the resolver returns.
  const answered =
    output === undefined
      ? resolver.getType().getCallSignatures()[0]?.getReturnType()
      : schemaOutput(output);
  return {
    params: input === undefined ? [] : [{ name: 'input', type: schemaOutput(input), site: input }],
    ...(answered === undefined ? {} : { returns: { type: answered, site: output ?? resolver } }),
  };
};

/** The first argument of the first link of a chain that is called this. */
const argumentOf = (links: readonly Link[], method: string | undefined): TsNode | undefined =>
  method === undefined ? undefined : links.find((link) => link.method === method)?.args[0];

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
  const origin = originOf(base, dialect);
  // A contract's member carries what the implementation leaves out (P58): its
  // input, output, errors and route are read there, the chain's own winning.
  const contract =
    origin.implemented === undefined ? undefined : contractMemberOf(origin.implemented, dialect, ctx);
  const contractLinks = contract?.links ?? [];
  const input = argumentOf(links, dialect.inputMethod) ?? argumentOf(contractLinks, dialect.inputMethod);
  const output = argumentOf(links, dialect.outputMethod) ?? argumentOf(contractLinks, dialect.outputMethod);
  const onChain =
    dialect.guardMethod === undefined
      ? []
      : guardsOn(links, dialect, 'route', `.${dialect.guardMethod}`, ctx);
  const startingLinks = origin.steps.flatMap((step) => step.links);
  const errors = settleErrors([
    ...errorsDeclared(contractLinks, dialect),
    ...errorsDeclared(startingLinks, dialect),
    ...errorsDeclared(links, dialect),
  ]);
  const routed = routeWritten(links, dialect, routeWritten(startingLinks, dialect, routeWritten(contractLinks, dialect)));
  const route =
    routed.path !== undefined && contract !== undefined && contract.prefix !== ''
      ? { ...routed, path: `${contract.prefix}${routed.path}` }
      : routed;

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
    ...(input === undefined ? {} : { input: label(input), inputSite: siteOf(input, ctx) }),
    ...(output === undefined ? {} : { output: label(output) }),
    signature: procedureSignature(input, handlerArg, output),
    guards: [...guardsBefore(origin, dialect, ctx), ...onChain],
    errors,
    ...(route.method === undefined && route.path === undefined ? {} : { route }),
    ...(origin.implemented !== undefined && contract === undefined
      ? {
          contractUnread: {
            site: siteOf(origin.implemented.call, ctx),
            named: [label(origin.implemented.call), ...origin.implemented.names].join('.'),
          },
        }
      : {}),
    site: siteOf(node, ctx),
  };
};

/** One member of a tree: a key, and whatever was written under it. */
interface Member {
  /** The key, when it was written as one a reader can name. */
  key?: string;
  /** How a key nobody can name is written, `[section]`, for the row about it. */
  computed?: string;
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
  /**
   * What the assembling call's own chain installs in front of every way in
   * under it - `os.use(auth).router({...})` - the root's first (P58).
   */
  guards: EntryWrapping[];
  /** What it declares every way in under it may fail with (P58). */
  errors: DeclaredError[];
  /** The prefix its chain writes for the HTTP route of every way in under it (P58). */
  routePrefix: string;
}

/**
 * The key a property is written under, or nothing when it is computed.
 *
 * A shorthand property — `{ loggedInViewerRouter }` — is a key as much as a
 * written one, and a scheduling app's own root uses both spellings in one literal.
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
    ...(key === undefined ? { computed: nameNode.getText() } : { key }),
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
  /** The literals a call assembles, so a literal is never also a tree of its own. */
  const assembled = new Set<TsNode>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (name === undefined || !dialect.assembledBy.includes(name)) continue;
    const [argument] = call.getArguments();
    if (argument === undefined) continue;
    const literal = unwrapValue(argument);
    if (!Node.isObjectLiteralExpression(literal)) continue;
    assembled.add(literal);
    const callee = call.getExpression();
    // `os.use(auth).prefix('/orders').router({...})`: what the chain in front
    // of the call installs applies to every member, and is read the way a
    // procedure's own chain is (P58).
    const { links, base } = Node.isPropertyAccessExpression(callee)
      ? chainOf(callee.getExpression())
      : { links: [] as Link[], base: callee };
    const origin = originOf(base, dialect);
    const guards =
      dialect.guardMethod === undefined
        ? []
        : [...guardsBefore(origin, dialect, ctx), ...guardsOn(links, dialect, 'prefix', `${name}({ … })`, ctx)];
    const errors = errorsDeclared([...origin.steps.flatMap((step) => step.links), ...links], dialect);
    yield {
      call,
      site: siteOf(call, ctx),
      registration: `${name}({ … })`,
      members: membersOf(literal, ctx),
      guards,
      errors,
      routePrefix: routePrefixOf(links, dialect),
    };
  }
  if (!dialect.plainTrees) return;
  // A literal is a tree when its members say so (P58). Every one is a
  // candidate, and the evidence the forest asks for decides.
  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    if (assembled.has(literal)) continue;
    // Handed to a call, a literal is the call's options rather than a tree
    // somebody declared: `createRouterClient(router, { context })`.
    const parent = literal.getParent();
    if (parent !== undefined && (Node.isCallExpression(parent) || Node.isNewExpression(parent))) continue;
    const members = membersOf(literal, ctx);
    if (members.length === 0) continue;
    yield { call: literal, site: siteOf(literal, ctx), registration: '{ … }', members, guards: [], errors: [], routePrefix: '' };
  }
};

/** The members of one object literal a reader can see. */
const membersOf = (literal: TsNode, ctx: ExtractContext): Member[] => {
  if (!Node.isObjectLiteralExpression(literal)) return [];
  const members: Member[] = [];
  for (const property of literal.getProperties()) {
    const member = memberOf(property, ctx);
    if (member !== undefined) members.push(member);
  }
  return members;
};

/**
 * The value a name was declared with, or the value itself when it is written in
 * place.
 *
 * One helper for both, because every member of a tree is one or the other and
 * nothing that looks at a member cares which: a nested literal and an imported
 * one are the same fact spelled differently.
 */
const valueOf = (member: Member, dialect?: ProcedureDialect): TsNode => {
  const written = unwrapValue(member.value);
  const value = declaredValue(written) ?? written;
  return (dialect === undefined ? undefined : loadedTree(value, dialect)) ?? value;
};

/** The `import()` a member that loads its tree lazily calls (P58): `lazy(() => import('./reports'))`. */
const lazyLoad = (value: TsNode, dialect: ProcedureDialect): TsNode | undefined => {
  if (dialect.lazyBy.length === 0 || !Node.isCallExpression(value)) return undefined;
  const name = calleeName(value);
  if (name === undefined || !dialect.lazyBy.includes(name)) return undefined;
  const [loader] = value.getArguments();
  const fn = loader === undefined ? undefined : unwrapValue(loader);
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined;
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getKind() === SyntaxKind.ImportKeyword);
};

/** The path an `import()` names, as written. */
const specifierOf = (loading: TsNode): string | undefined => {
  const [written] = Node.isCallExpression(loading) ? loading.getArguments() : [];
  return written !== undefined && (Node.isStringLiteral(written) || Node.isNoSubstitutionTemplateLiteral(written)) ? written.getLiteralValue() : undefined;
};

/** The endings a module path is written without, in the order a bundler tries them. */
const MODULE_ENDINGS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** A path with `.` and `..` segments folded away. */
const folded = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '.' || (part === '' && parts.length > 0)) continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
};

/**
 * The module an `import()` loads (P252): the one the checker resolves it to,
 * or, where it cannot - an alias with no `paths` behind it, a file the
 * configuration leaves out - the one file of the service its path names. A
 * relative path is taken from the importing file; one under an alias (`@/`,
 * `~/`, `~~/`, `#`) is the file whose path ends with what follows it. Each is
 * tried with the endings a bundler tries and as a folder's `index`; two files
 * that fit are not chosen between.
 */
const loadedModule = (loading: TsNode): SourceFile | undefined => {
  const promised = loading.getType().getTypeArguments()[0];
  const resolved = promised?.getSymbol()?.getDeclarations()[0];
  if (resolved !== undefined && Node.isSourceFile(resolved)) return resolved;
  const written = specifierOf(loading);
  if (written === undefined) return undefined;
  const bare = written.replace(/\.(?:[cm]?[jt]sx?)$/, '');
  const from = loading.getSourceFile();
  const files = from.getProject().getSourceFiles().filter((file) => !file.getFilePath().includes('/node_modules/'));
  const stem = (file: SourceFile): string => file.getFilePath().replace(/\.(?:d\.)?(?:[cm]?[jt]sx?)$/, '');
  if (bare.startsWith('.')) {
    const target = folded(`${from.getDirectoryPath()}/${bare}`);
    const found = files.filter((file) => {
      const at = stem(file);
      return MODULE_ENDINGS.some((ending) => file.getFilePath().endsWith(ending)) && (at === target || at === `${target}/index`);
    });
    return found.length === 1 ? found[0] : undefined;
  }
  const aliased = /^(?:~~\/|~\/|@\/|#)(.+)$/.exec(bare)?.[1];
  if (aliased === undefined) return undefined;
  const found = files.filter((file) => {
    const at = stem(file);
    return at.endsWith(`/${aliased}`) || at.endsWith(`/${aliased}/index`);
  });
  return found.length === 1 ? found[0] : undefined;
};

/**
 * The tree a member loads from a module when it is first asked for (P58):
 * `lazy(() => import('./reports'))` is the default export of that module,
 * found by asking the checker which module the `import()` names, or by its
 * path where the checker cannot say (P252).
 */
const loadedTree = (value: TsNode, dialect: ProcedureDialect): TsNode | undefined => {
  const loading = lazyLoad(value, dialect);
  const module = loading === undefined ? undefined : loadedModule(loading);
  return module === undefined ? undefined : defaultExportOf(module);
};

/** What a module's `export default` is, through the name it is declared under. */
const defaultExportOf = (module: SourceFile): TsNode | undefined => {
  for (const declaration of module.getDefaultExportSymbol()?.getDeclarations() ?? []) {
    if (Node.isExportAssignment(declaration)) {
      const exported = unwrapValue(declaration.getExpression());
      return declaredValue(exported) ?? exported;
    }
  }
  return undefined;
};

/**
 * Whether a tree is the default export of a module a lazy branch nothing
 * could follow names (P252): the file whose path ends with what the
 * `import()` writes after its alias or its `./` and `../`. Such a tree is the
 * branch's, under the branch's key, and read as a root of its own it would
 * answer at addresses nobody calls; so it is not read as one, and the
 * branch's row names it.
 */
const standsFor = (tree: Tree, written: string): boolean => {
  const tail = written
    .replace(/\.(?:[cm]?[jt]sx?)$/, '')
    .replace(/^(?:\.{1,2}\/)+/, '')
    .replace(/^(?:~~\/|~\/|@\/|#|@[^/]+\/)/, '');
  if (tail === '' || tail.startsWith('.')) return false;
  const file = tree.call.getSourceFile();
  const stem = file.getFilePath().replace(/\.(?:[cm]?[jt]sx?)$/, '');
  return (stem.endsWith(`/${tail}`) || stem.endsWith(`/${tail}/index`)) && defaultExportOf(file) === tree.call;
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
        const candidate = this.#candidates.get(valueOf(member, this.#dialect));
        if (candidate !== undefined) members.push(candidate);
      }
      nested.set(tree, members);
      if (tree.members.some((member) => endingOf(valueOf(member, this.#dialect), this.#dialect) !== undefined)) {
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
    // Calls only: a plain literal is a candidate of every repository that has
    // one, and counting those would say "calls to a name the description lists"
    // about literals nobody called anything (P58).
    return [...this.#candidates.values()].filter((tree) => Node.isCallExpression(tree.call)).length;
  }

  get size(): number {
    return this.#trees.size;
  }
}

/** A member that is neither a way in nor a tree, and the module it loads lazily, where it is a lazy branch (P252). */
interface UnreadMember {
  site: Site;
  address: string;
  named: string;
  lazily?: string;
  /** The files whose default export may be the tree it loads, and so are not read as roots of their own. */
  stands?: string[];
}

const LAZY_HINT =
  'Write the import() as a relative path to the file in this service, or declare its alias under compilerOptions.paths, so the branch it loads can be read.';

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
  /** How the mount is written, for a reader looking for it again. */
  registration: string;
  /** What its protocol is called, where the description names it (P58). */
  protocol?: string;
  /** Whether it also answers each way in at its own HTTP route (P58). */
  routes: boolean;
  /**
   * The addresses it answers under, as its `handle` calls give them; empty
   * where it says none, which is the root (P58). Absent where the description
   * says it is given one and none could be read.
   */
  prefixes?: string[];
  /** Why no address could be read, where none could (P58). */
  prefixUnread?: string;
}

/**
 * The options object among a call's trailing arguments (P58), written in place
 * or as a name bound to one. An adapter for one runtime hands the request
 * alone, another the request and the response, so the position moves; a name
 * that is a parameter is the request or the response and is passed over.
 * Anything else may be the options and cannot be read.
 */
const optionsAmong = (args: readonly TsNode[]): { options: TsNode } | { unread: TsNode } | undefined => {
  for (const argument of args) {
    const value = unwrapValue(argument);
    if (Node.isObjectLiteralExpression(value)) return { options: value };
    if (Node.isIdentifier(value)) {
      const declaration = (value.getSymbol()?.getAliasedSymbol() ?? value.getSymbol())?.getDeclarations()[0];
      if (declaration !== undefined && Node.isParameterDeclaration(declaration)) continue;
      const bound = declaredValue(value);
      if (bound !== undefined && Node.isObjectLiteralExpression(bound)) return { options: bound };
    }
    return { unread: argument };
  }
  return undefined;
};

/**
 * The addresses a mount built with `new` answers under (P58): the `key` option
 * of every call of `method` on the value it was assigned to, in the file it is
 * written in. A literal is an address; no option, or no options, is the root;
 * anything else cannot be told, and neither can a mount nobody calls here.
 */
const prefixesOf = (
  made: TsNode,
  from: NonNullable<ProcedureMount['prefixFrom']>,
): { prefixes: string[] } | { unread: string } => {
  const holder = made.getParent();
  if (holder === undefined || !Node.isVariableDeclaration(holder)) {
    return { unread: 'it is not assigned to a name, so nothing here can be seen handing it a request' };
  }
  const symbol = holder.getNameNode().getSymbol();
  const prefixes = new Set<string>();
  let calls = 0;
  for (const call of made.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== from.method) continue;
    const receiver = unwrapValue(callee.getExpression());
    if (!Node.isIdentifier(receiver) || receiver.getSymbol() !== symbol) continue;
    calls += 1;
    const found = optionsAmong(call.getArguments().slice(from.arg));
    if (found === undefined) {
      prefixes.add('');
      continue;
    }
    if ('unread' in found) return { unread: `its ${from.method} call is handed ${label(found.unread)}, whose ${from.key} cannot be read` };
    const written = found.options;
    if (!Node.isObjectLiteralExpression(written)) continue;
    const property = written.getProperty(from.key);
    if (property === undefined) {
      prefixes.add('');
      continue;
    }
    const text = Node.isPropertyAssignment(property) ? literalText(property.getInitializer()) : undefined;
    if (text === undefined) return { unread: `its ${from.method} call is given ${from.key} as ${label(property)}, which is not written as text` };
    prefixes.add(text.replace(/\/+$/, ''));
  }
  if (calls === 0) return { unread: `nothing in this file calls its ${from.method}, so the address it answers under is not written here` };
  return { prefixes: [...prefixes].sort() };
};

const mountsIn = function* (
  sourceFile: SourceFile,
  dialect: ProcedureDialect,
  forest: Forest,
  ctx: ExtractContext,
): Generator<Mount> {
  const made = dialect.mounts.some((each) => each.constructed)
    ? sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)
    : [];
  for (const call of [...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression), ...made]) {
    const callee = call.getExpression();
    const name = Node.isNewExpression(call)
      ? Node.isIdentifier(callee)
        ? callee.getText()
        : Node.isPropertyAccessExpression(callee)
          ? callee.getName()
          : undefined
      : calleeName(call);
    if (name === undefined) continue;
    const mount = dialect.mounts.find((each) => each.call === name && each.constructed === Node.isNewExpression(call));
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
    const answered = mount.prefixFrom === undefined ? undefined : prefixesOf(call, mount.prefixFrom);
    yield {
      site: siteOf(call, ctx),
      ...(tree === undefined ? {} : { tree }),
      named: label(value),
      registration: Node.isNewExpression(call) ? `new ${name}(…)` : `${name}(…)`,
      ...(mount.protocol === undefined ? {} : { protocol: mount.protocol }),
      routes: mount.routes,
      ...(answered === undefined ? {} : 'prefixes' in answered ? { prefixes: answered.prefixes } : { prefixUnread: answered.unread }),
    };
  }
};

/** How many steps a chain is followed back towards its root. */
const MOST_ROOT_STEPS = 32;

/**
 * The type a chain's root was given for its context, as the source writes it.
 *
 * Walked back from whatever a link was called on: a call to the call before it,
 * a member to what it is a member of, a name to the value it was declared with -
 * `authedProcedure` to `procedure.use(…)`, `procedure` to `tRPCContext.procedure`,
 * `tRPCContext` to `initTRPC.context<typeof createContextInner>().create()` -
 * until a call of the description's `context.method` is met with a type
 * argument. Anything else ends the walk with no answer, which is what an
 * `app.use(fn)` of any other library comes to: its root is a call of a function,
 * not a context.
 *
 * Remembered per value, because every chain of a repository ends at the same
 * root and a scheduling app has several hundred of them.
 */
const contextWrittenFor = (
  receiver: TsNode,
  method: string,
  memo: Map<TsNode, TsNode | null>,
): TsNode | undefined => {
  const visited: TsNode[] = [];
  let at: TsNode | undefined = unwrapValue(receiver);
  let found: TsNode | null = null;
  for (let step = 0; at !== undefined && step < MOST_ROOT_STEPS; step += 1) {
    const known = memo.get(at);
    if (known !== undefined) {
      found = known;
      break;
    }
    visited.push(at);
    if (Node.isCallExpression(at)) {
      const callee = unwrapValue(at.getExpression());
      if (!Node.isPropertyAccessExpression(callee)) break;
      const [written] = at.getTypeArguments();
      if (callee.getName() === method && written !== undefined) {
        found = createdContext(written) ?? null;
        break;
      }
      at = unwrapValue(callee.getExpression());
      continue;
    }
    if (Node.isPropertyAccessExpression(at)) {
      at = unwrapValue(at.getExpression());
      continue;
    }
    if (Node.isIdentifier(at)) {
      at = declaredValue(at);
      continue;
    }
    break;
  }
  for (const node of visited) memo.set(node, found);
  return found ?? undefined;
};

/**
 * The context a root's type argument describes.
 *
 * A type is the context itself. A function's type - `typeof createContextInner`,
 * which is how a project that builds its context in a function writes it - is
 * the context that function creates: the type its declaration says it returns,
 * awaited when it is a promise of one. A function that does not say what it
 * returns states no context, and none is supplied.
 */
const createdContext = (written: TsNode): TsNode | undefined => {
  if (!Node.isTypeQuery(written)) return written;
  const name = written.getExprName();
  const symbol = name.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    const creates = Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : declaration;
    if (
      creates === undefined ||
      !(
        Node.isFunctionDeclaration(creates) ||
        Node.isArrowFunction(creates) ||
        Node.isFunctionExpression(creates)
      )
    ) {
      continue;
    }
    const returned = creates.getReturnTypeNode();
    if (returned === undefined) return undefined;
    return awaited(returned);
  }
  return undefined;
};

/** `Promise<T>` is `T` once awaited, and every other type is itself. */
const awaited = (written: TsNode): TsNode => {
  if (!Node.isTypeReference(written) || written.getTypeName().getText() !== 'Promise') return written;
  const [inner] = written.getTypeArguments();
  return inner === undefined ? written : inner;
};

/** A function whose parameters can be asked for. */
const isFunctionLike = (
  node: TsNode | undefined,
): node is ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node);

/** The function an argument hands over, written in place or named. */
const handedFunction = (argument: TsNode): TsNode | undefined => {
  const value = unwrapValue(argument);
  if (isFunctionLike(value)) return value;
  const declaration = repoFunctionOf(value)?.declaration;
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return declaration.getInitializer();
  }
  return declaration;
};

/**
 * Tells the rest of the reading what every guard and every handler is handed as
 * its context (R157).
 *
 * Every call of the guard method or of a terminator, wherever it is written and
 * whether or not a tree was found to hold it: a starting point nobody begins a
 * way in from still holds a guard, and a guard built inside a function that
 * returns a chain is not on any chain the tree walk follows. What decides is the
 * root, and only the root: the call's receiver is followed back until it meets
 * the description's `context` call with a type argument, and a chain that never
 * does is left alone. The type is recorded against the first parameter of each
 * function the call is handed, under the key the description names, for the
 * reader of the data layer to ask (`suppliedTypes`).
 */
const supplyContexts = (
  sources: readonly SourceFile[],
  dialect: ProcedureDialect,
  ctx: ExtractContext,
): void => {
  const context = dialect.context;
  if (context === undefined) return;
  const handing = new Set([
    ...(dialect.guardMethod === undefined ? [] : [dialect.guardMethod]),
    ...dialect.terminators.keys(),
  ]);
  const supplied = suppliedTypes(ctx.project);
  const memo = new Map<TsNode, TsNode | null>();
  for (const sourceFile of sources) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || !handing.has(callee.getName())) continue;
      const functions = call.getArguments().flatMap((argument) => handedFunction(argument) ?? []);
      if (functions.length === 0) continue;
      const written = contextWrittenFor(callee.getExpression(), context.method, memo);
      if (written === undefined) continue;
      for (const fn of functions) {
        if (!isFunctionLike(fn)) continue;
        const [parameter] = fn.getParameters();
        if (parameter !== undefined) supplied.supply(parameter, context.key, written);
      }
    }
  }
};

/** What a walk carries down a tree from the trees above a member. */
interface Along {
  guards: EntryWrapping[];
  errors: DeclaredError[];
  routePrefix: string;
  /** Every mount of a tree on the way down, and the address that tree is at. */
  mounts: Array<{ mount: Mount; at: string }>;
}

/** Each guard once, where a tree and a chain built from one starting point both install it. */
const onceEach = (guards: readonly EntryWrapping[]): EntryWrapping[] => {
  const seen = new Set<string>();
  return guards.filter((guard) => {
    const key = `${guard.file ?? ''}:${guard.line ?? ''}:${guard.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
 * client was configured with rather than of anything in the tree: a scheduling app hangs
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
    supplyContexts(sources, dialect, ctx);

    const mounts: Mount[] = [];
    for (const sourceFile of sources) {
      mounts.push(...mountsIn(sourceFile, dialect, forest, ctx));
    }
    /** Which mounts serve each tree, so an entry can say where it is answered. */
    const mountsOf = new Map<Tree, Mount[]>();
    for (const mount of mounts) {
      if (mount.tree === undefined) continue;
      const list = mountsOf.get(mount.tree) ?? [];
      list.push(mount);
      mountsOf.set(mount.tree, list);
    }

    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const unread: UnreadMember[] = [];
    let members = 0;

    const emit = (address: string, procedure: Procedure, along: Along, tree: Tree): void => {
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
      const guards = onceEach([...along.guards, ...procedure.guards]);
      const errors = settleErrors([...along.errors, ...procedure.errors]);
      const served = [...new Set(along.mounts.map(({ mount }) => mount.site.file))].sort();
      const mounted = along.mounts.flatMap(({ mount }) =>
        mount.protocol === undefined
          ? []
          : (mount.prefixes ?? [undefined]).map((prefix) => ({
              protocol: mount.protocol as string,
              ...(prefix === undefined ? {} : { prefix: prefix === '' ? '/' : prefix }),
              file: mount.site.file,
            })),
      );
      if (procedure.contractUnread !== undefined) {
        ctx.builder.addUnresolved({
          file: procedure.contractUnread.site.file,
          line: procedure.contractUnread.site.line,
          reason: 'procedure-contract-unread',
          level: 'info',
          message: `${address} implements ${procedure.contractUnread.named}, a member of a contract this could not follow, so its input, output, errors and route are only what the implementation itself writes.`,
          hint: 'Write the contract as object literals of chains, in a file of this service or of a package it declares, so each member can be found by its keys.',
          symbol: address,
          adapter: dialect.name,
        });
      }
      const common = {
        ...(handler === undefined ? {} : { handler }),
        file: procedure.site.file,
        line: procedure.site.line,
        ...(guards.length > 0 ? { wrapping: guards } : {}),
        signature: procedure.signature,
      };
      entries.push({
        id,
        kind: procedure.kind,
        label: `${procedure.kind} ${address}`,
        key: address,
        ...common,
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
          ...(procedure.inputSite === undefined ? {} : { inputAt: `${procedure.inputSite.file}:${procedure.inputSite.line}` }),
          ...(procedure.output === undefined ? {} : { output: procedure.output }),
          ...(errors.length === 0 ? {} : { errors }),
          ...(procedure.route === undefined ? {} : { route: procedure.route }),
          // Read in full, mounts and all: the description says where a guard is
          // installed and the walk follows the name it was installed on, so an
          // audit that found none here really did look.
          middlewareRead: true,
          handlerVia: procedure.handlerVia,
          ...(served.length > 0 ? { served } : {}),
          ...(mounted.length > 0 ? { mounted } : {}),
        },
      });

      // A mount that answers each way in at its own route makes it an HTTP
      // route as well (P58): the route the procedure writes under the prefixes
      // of the trees above it, or its keys below the mounted tree posted to.
      for (const { mount, at } of along.mounts) {
        if (!mount.routes || mount.prefixes === undefined) continue;
        const below = at === '' ? address : address.slice(at.length + dialect.separator.length);
        const own =
          procedure.route?.path === undefined
            ? `/${below.split(dialect.separator).join('/')}`
            : `${along.routePrefix}${procedure.route.path}`;
        const method = procedure.route?.method ?? 'POST';
        for (const prefix of mount.prefixes) {
          const rawPath = `${prefix}${own}`.replace(/\/{2,}/g, '/');
          const path = normalizePath(rawPath);
          const routeId = makeEntryId(ctx.repo, 'http', makeHttpEntryKey(method, path));
          if (seen.has(routeId)) continue;
          seen.add(routeId);
          entries.push({
            id: routeId,
            kind: 'http',
            label: `${method} ${path}`,
            key: makeHttpEntryKey(method, path),
            ...common,
            meta: {
              method,
              path,
              rawPath,
              adapter: dialect.name,
              registration: mount.registration,
              // The procedure this route answers for, so a request to either is a
              // request to both (`dead`, the inventory).
              procedure: address,
              ...(procedure.input === undefined ? {} : { input: procedure.input }),
              ...(procedure.inputSite === undefined ? {} : { inputAt: `${procedure.inputSite.file}:${procedure.inputSite.line}` }),
              ...(errors.length === 0 ? {} : { errors }),
              middlewareRead: true,
              handlerVia: procedure.handlerVia,
              served: [mount.site.file],
            },
          });
        }
      }
    };

    /**
     * Walks one tree, naming each member by every key above it.
     *
     * What is carried down accumulates rather than being the root's alone,
     * because a repository may hang the whole tree in one file and each of its
     * branches in a file of its own — a scheduling app mounts twenty-nine — and a way in
     * really is answered at all of them. So does what a tree's own assembling
     * chain installs, declares and prefixes (P58).
     */
    const walk = (tree: Tree, prefix: string, path: ReadonlySet<Tree>, above: Along): void => {
      const along: Along = {
        guards: [...above.guards, ...tree.guards],
        errors: [...above.errors, ...tree.errors],
        routePrefix: `${above.routePrefix}${tree.routePrefix}`,
        mounts: [...above.mounts, ...(mountsOf.get(tree) ?? []).map((mount) => ({ mount, at: prefix }))],
      };
      for (const member of tree.members) {
        members += 1;
        if (member.key === undefined) {
          ctx.builder.addUnresolved({
            file: member.site.file,
            line: member.site.line,
            reason: 'procedure-key-dynamic',
            hint: 'Write the key as a name or a string, so the way in under it can be named and joined to a caller.',
            symbol: `${prefix === '' ? tree.registration : prefix}.${member.computed ?? label(member.value)}`,
            adapter: dialect.name,
          });
          continue;
        }
        const address = prefix === '' ? member.key : `${prefix}${dialect.separator}${member.key}`;
        const value = valueOf(member, dialect);
        const procedure = procedureOf(value, dialect, ctx);
        if (procedure !== undefined) {
          emit(address, procedure, along, tree);
          continue;
        }
        const nested = forest.at(value);
        if (nested === undefined) {
          const loading = lazyLoad(value, dialect);
          const lazily = loading === undefined ? undefined : specifierOf(loading);
          const stands = lazily === undefined ? undefined : standIns.get(lazily);
          unread.push({ site: member.site, address, named: label(member.value), ...(lazily === undefined ? {} : { lazily }), ...(stands === undefined ? {} : { stands }) });
          continue;
        }
        // A tree that holds itself, directly or through others. The framework
        // would not accept it; reading it would not stop.
        if (path.has(nested)) continue;
        walk(nested, address, new Set([...path, nested]), along);
      }
    };

    // A lazy branch nothing could follow leaves its module's tree as a root of
    // its own unless it is told apart (P252): found before the walk, so the
    // tree is not walked as one, and the branch's row names it.
    const lazilyUnread = new Set<string>();
    const looked = new Set<Tree>();
    const look = (tree: Tree): void => {
      if (looked.has(tree)) return;
      looked.add(tree);
      for (const member of tree.members) {
        const value = valueOf(member, dialect);
        const nested = forest.at(value);
        if (nested !== undefined) look(nested);
        const loading = nested === undefined && procedureOf(value, dialect, ctx) === undefined ? lazyLoad(value, dialect) : undefined;
        const written = loading === undefined ? undefined : specifierOf(loading);
        if (written !== undefined) lazilyUnread.add(written);
      }
    };
    for (const root of forest.roots()) look(root);
    const standIns = new Map<string, string[]>();
    const roots = forest.roots().filter((root) => {
      const named = [...lazilyUnread].filter((written) => standsFor(root, written));
      for (const written of named) standIns.set(written, [...(standIns.get(written) ?? []), root.site.file].sort());
      return named.length === 0;
    });
    for (const root of roots) {
      walk(root, '', new Set([root]), { guards: [], errors: [], routePrefix: '', mounts: [] });
    }

    reportUnreadPrefixes(ctx, mounts, dialect);
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
 * A mount whose address could not be read (P58).
 *
 * The ways in it serves are read all the same; what is missing is where it
 * answers them, which a mount that also answers each at its own route needs
 * to say what those routes are, and a client's link needs to be checked
 * against.
 */
const reportUnreadPrefixes = (
  ctx: ExtractContext,
  mounts: readonly Mount[],
  dialect: ProcedureDialect,
): void => {
  for (const mount of mounts) {
    if (mount.prefixUnread === undefined || mount.tree === undefined) continue;
    ctx.builder.addUnresolved({
      file: mount.site.file,
      line: mount.site.line,
      reason: 'procedure-prefix-unread',
      ...(mount.routes ? {} : { level: 'info' as const }),
      message: `${mount.site.file} serves ${mount.named}, and ${mount.prefixUnread}${mount.routes ? ', so none of the HTTP routes it answers is drawn' : ''}.`,
      hint: 'Hand the request to the mount in the file that builds it, with the prefix written as text.',
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
  unread: readonly UnreadMember[],
  dialect: ProcedureDialect,
): void => {
  for (const member of unread) {
    ctx.builder.addUnresolved({
      file: member.site.file,
      line: member.site.line,
      reason: 'procedure-branch-unread',
      message:
        member.lazily === undefined
          ? `${member.address} is ${member.named}, a name this could follow to neither a way in nor a tree, so nothing under it was read.`
          : `${member.address} loads its tree lazily from ${member.lazily}, a module neither the checker nor its path among this service's files leads to one file of, so nothing under it was read${member.stands === undefined ? '' : `; the tree ${member.stands.join(' and ')} export${member.stands.length === 1 ? 's' : ''} by default may be it, and is not read as a root of its own`}.`,
      hint: member.lazily === undefined ? MOUNT_HINT : LAZY_HINT,
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

export const orpcProceduresAdapter = procedureRoutersAdapter(ORPC);
