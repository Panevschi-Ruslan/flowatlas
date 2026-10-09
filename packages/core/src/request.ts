import { Node, SyntaxKind, type Node as TsNode, type ParameterDeclaration, type SourceFile, type Type } from 'ts-morph';
import { z } from 'zod';
import { pathFrom, sameKeys } from './envelope.js';
import type { GraphEdge } from './model/edges.js';
import { functionLikeOf, type FunctionLike } from './types/signatures.js';
import { formatTypeRef, parseTypeRef, type TypeRef, type TypeRefField } from './types/type-ref.js';

/**
 * What a request carries and what it is answered with, read from a handler a
 * framework calls with a request (P29).
 *
 * A NestJS controller says it in its signature: `@Body() dto: CreateOrderDto`
 * and a return type. Almost nothing else does. A handler registered by a
 * call is `(req, res) => void` whatever it reads and answers, and the shape is
 * somewhere inside: a type argument on `req`, a validator's parse of
 * `req.body`, the value handed to `res.json`. Every framework puts it somewhere
 * different, and every one of those places is a *place* - a parameter, a
 * path of keys, a method called on it - so a framework is described by where,
 * and this one reading is the only code that looks. A new framework is a
 * description; so is a framework a project describes in its own configuration.
 *
 * Precision first (I3). A type stated by a type argument, a validator's checked
 * output or the value an answering call is handed is the code's own; a cast
 * (`req.body as CreateOrder`) is only what the author says it is, and is
 * recorded as claimed. A framework's default - `any`, `unknown`, a dictionary
 * of strings - is no type at all, and nothing is invented in its place.
 */

/** The parts of a request, in the order a route's edge records them. */
export const REQUEST_PARTS = ['body', 'params', 'query', 'headers'] as const;

export type RequestPart = (typeof REQUEST_PARTS)[number];

const partSchema = z.enum(REQUEST_PARTS);

const keysSchema = z.array(z.string().min(1)).default([]);

/**
 * Where a part of the request sits in what the handler is handed: a parameter,
 * keys from it, and whether it is text there that the code parses.
 */
export const requestPlaceSchema = z.strictObject({
  param: z.number().int().min(0),
  at: keysSchema,
  text: z.boolean().default(false),
});

/**
 * A method that hands back a part of the request: `await req.json()`,
 * `c.req.valid('json')`.
 *
 * Called on `at` of parameter `param`. `byArgument` maps the string a call
 * passes first to the part it stands for; without it the call takes no
 * arguments and hands back `part`. `claim` says the type it hands back is only
 * what the code asked for - a type argument nothing checks.
 */
export const requestCallSchema = z.strictObject({
  param: z.number().int().min(0),
  at: keysSchema,
  method: z.string().min(1),
  part: partSchema.optional(),
  byArgument: z.record(z.string().min(1), partSchema).optional(),
  claim: z.boolean().default(false),
});

/**
 * A function a handler calls by name: one of the project's own, or one a
 * package exports (P30).
 *
 * With `package`, the call is matched by the import that brings the name in -
 * `import { respond } from '@acme/http-kit'`, or `http.respond` on a namespace
 * imported from it - which needs nothing installed, since the import is
 * written in the handler's own file. Without it, by a declaration of that name
 * in the repository.
 */
const helperFields = {
  name: z.string().min(1),
  package: z.string().min(1).optional(),
};

/**
 * A function that hands back a part of the request: `parseBody(event)`,
 * `readJson<CreateOrder>(req)`.
 *
 * `arg` is the argument that must be the request - read off parameter `param`
 * of the handler - so a helper of that name called on anything else is not
 * mistaken for a read. What it hands back is typed by a type argument written
 * at the call, else by what it is declared to return; `claim` says that is only
 * what the code asks for, which is true of a helper that parses without
 * checking and is the default.
 */
export const requestHelperSchema = z.strictObject({
  ...helperFields,
  part: partSchema,
  param: z.number().int().min(0).default(0),
  arg: z.number().int().min(0).default(0),
  claim: z.boolean().default(true),
});

/** Where a status code is written beside an answer, when it is. */
const statusFields = {
  /** Methods in front of the answering one that set the status: `res.status(404).json(…)`. */
  statusMethods: z.array(z.string().min(1)).default([]),
  /** An argument of the answering call that is the status: `c.json(body, 404)`. */
  statusArg: z.number().int().min(0).optional(),
  /** A key of an options argument that is the status: `json(body, { status: 404 })`. */
  statusKey: z.string().min(1).optional(),
};

/**
 * How a handler answers, in the four ways a framework lets it and the one a
 * project adds.
 *
 * `call` a method on `at` of a parameter is handed the answer (`res.json(x)`);
 * `named` a function the framework exports is (`Response.json(x)`); `assign`
 * the answer is assigned to `at` of a parameter (`ctx.body = x`); `return` the
 * handler returns it, or returns an object with it at `at`, as text when the
 * platform carries it as text (`{ statusCode, body: JSON.stringify(x) }`); and
 * `helper` a function the project wrote builds it (P30).
 */
export const requestAnswerSchema = z.discriminatedUnion('by', [
  z.strictObject({
    by: z.literal('call'),
    param: z.number().int().min(0),
    at: keysSchema,
    methods: z.array(z.string().min(1)).min(1),
    arg: z.number().int().min(0).default(0),
    ...statusFields,
  }),
  z.strictObject({
    by: z.literal('named'),
    callee: z.string().min(1),
    arg: z.number().int().min(0).default(0),
    ...statusFields,
  }),
  z.strictObject({
    by: z.literal('assign'),
    param: z.number().int().min(0),
    at: z.array(z.string().min(1)).min(1),
    /** Where the status is assigned beside it: `ctx.status = 201` before `ctx.body = x`. */
    statusAt: z.array(z.string().min(1)).min(1).optional(),
  }),
  /**
   * A function of the project's that builds the answer: `return respond(201,
   * order)`, `sendOk(res, order)`. The answer is argument `arg`, or the value
   * at `at` of an object written there; the status is argument `statusArg`, or
   * `status` when the helper always answers with one.
   *
   * `fields` builds the answer from several arguments instead - `fail(400,
   * 'bad_input', message)` answers `{ code, message }` - each field typed by
   * the argument at its index (P33).
   */
  z.strictObject({
    by: z.literal('helper'),
    ...helperFields,
    arg: z.number().int().min(0).default(0),
    at: keysSchema,
    fields: z.record(z.string().min(1), z.number().int().min(0)).optional(),
    statusArg: z.number().int().min(0).optional(),
    status: z.number().int().min(100).max(599).optional(),
  }),
  z.strictObject({
    by: z.literal('return'),
    at: keysSchema,
    text: z.boolean().default(false),
    statusAt: z.array(z.string().min(1)).optional(),
  }),
]);

/**
 * A validation library: a call to one of `methods` declared by `package`,
 * handed a part of the request at argument `arg`, hands back the part as the
 * library checked it - `schema.parse(req.body)`, `parse(schema, req.body)` - or
 * a result holding it at `at`.
 */
export const requestValidatorSchema = z.strictObject({
  package: z.string().min(1),
  methods: z.array(z.string().min(1)).min(1),
  arg: z.number().int().min(0).default(0),
  /**
   * Where the checked value sits in what the call hands back, when it is not
   * the whole of it: `['data']` for `schema.safeParse(x).data`.
   */
  at: keysSchema,
});

/** Where a framework puts what a request carries and how a handler answers it. */
export const requestReadingSchema = z.strictObject({
  parts: z.partialRecord(partSchema, z.array(requestPlaceSchema)).default({}),
  calls: z.array(requestCallSchema).default([]),
  /** Functions of the project's that hand back a part of the request (P30). */
  helpers: z.array(requestHelperSchema).default([]),
  answers: z.array(requestAnswerSchema).default([]),
  /**
   * Type names the framework gives a part when the code said nothing narrower:
   * declared, and no shape anybody wrote. A dictionary of strings needs no row,
   * since a type with nothing but an index says nothing either.
   */
  defaults: z.array(z.string().min(1)).default([]),
  validators: z.array(requestValidatorSchema).default([]),
});

export type RequestReading = z.infer<typeof requestReadingSchema>;
export type RequestReadingDescription = z.input<typeof requestReadingSchema>;
type RequestPlace = z.infer<typeof requestPlaceSchema>;
type RequestCall = z.infer<typeof requestCallSchema>;
type RequestAnswer = z.infer<typeof requestAnswerSchema>;
type RequestValidator = z.infer<typeof requestValidatorSchema>;
type RequestHelper = z.infer<typeof requestHelperSchema>;

/**
 * The key of a `handles` edge's `meta` set when the route's request and answer
 * were read by a description, so its absence of a type is "not stated" rather
 * than "declares none".
 */
export const REQUEST_READ_META = 'requestRead';

/** The key of a `handles` edge's `meta` listing the parts - and `response` - only a cast says. */
export const CLAIMED_META = 'claimed';

/** The key of a `handles` edge's `meta` holding the answers sent with a failure status, by status. */
export const FAILURES_META = 'failures';

/**
 * The key of a `handles` edge's `meta` holding what is answered with a status
 * the code computes, so it could be a success or a failure (P30).
 */
export const STATUS_UNKNOWN_META = 'statusUnknown';

/** One part or the answer, as found: its type and whether only a cast says so. */
export interface FoundType {
  ref: TypeRef;
  claimed: boolean;
}

/** What a route's handler reads and answers. */
export interface RouteShape {
  parts: Partial<Record<RequestPart, FoundType>>;
  response?: FoundType;
  /** Answers sent with a literal status of 400 or more, by status. */
  failures: Record<string, TypeRef>;
  /** What is answered with a status the code computes, which could be either. */
  statusUnknown?: TypeRef;
}

/** A type found in the source, before it is collected. */
interface Candidate {
  type: Type;
  site: TsNode;
  claimed: boolean;
}

type Collect = (type: Type, site: TsNode) => TypeRef;

/** References that say nothing, whatever wrote them. */
const SAYS_NOTHING = new Set(['any', 'unknown', 'never', 'void', 'undefined', 'null', 'object']);

/** The value a promise settles to, or the type itself. */
const settled = (type: Type): Type => {
  const name = type.getSymbol()?.getName();
  if (name !== 'Promise' && name !== 'PromiseLike') return type;
  return type.getTypeArguments()[0] ?? type;
};

/**
 * Whether a type says anything about a shape: not a keyword that admits
 * everything, not a dictionary with nothing but an index, and not a type the
 * framework hands over when the code declared nothing.
 */
const saysSomething = (type: Type, defaults: ReadonlySet<string>): boolean => {
  const solid = type.getNonNullableType();
  if (solid.isAny() || solid.isUnknown() || solid.isNever() || solid.isVoid() || solid.isUndefined() || solid.isNull()) {
    return false;
  }
  if (solid.isTypeParameter()) return false;
  // A list of nothing in particular says no more than nothing does.
  const element = solid.isArray() ? solid.getArrayElementType() : undefined;
  if (element !== undefined) return saysSomething(element, defaults);
  if (solid.getText() === 'object' || solid.getText() === '{}') return false;
  const name = solid.getAliasSymbol()?.getName() ?? solid.getSymbol()?.getName();
  if (name !== undefined && defaults.has(name)) return false;
  if (solid.isObject() && !solid.isArray() && solid.getProperties().length === 0) {
    return solid.getStringIndexType() === undefined && solid.getNumberIndexType() === undefined
      ? solid.getCallSignatures().length > 0
      : false;
  }
  return true;
};

/** The type at a path of keys, or nothing where the path does not fit. */
const typeAt = (type: Type, at: readonly string[], site: TsNode): Type | undefined => {
  let current: Type | undefined = type;
  for (const key of at) {
    current = current?.getNonNullableType().getProperty(key)?.getTypeAtLocation(site);
  }
  return current;
};

/** The expression a value is, out through brackets, `!` and `await`. */
const outermost = (node: TsNode): TsNode => {
  let at = node;
  for (let parent = at.getParent(); parent !== undefined; parent = at.getParent()) {
    if (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent) || Node.isAwaitExpression(parent)) {
      at = parent;
      continue;
    }
    return at;
  }
  return at;
};

/** The expression inside brackets, `!`, `await` and casts. */
const innermost = (node: TsNode): TsNode => {
  let at = node;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isAwaitExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isSatisfiesExpression(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** The declaration a called name resolves to, through an import. */
const calleeDeclarations = (callee: TsNode): TsNode[] => {
  const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : Node.isQualifiedName(callee) ? callee.getRight() : callee;
  const symbol = name.getSymbol();
  const target = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations() ?? [];
};

const declaredIn = (declaration: TsNode, pkg: string): boolean => {
  const file = declaration.getSourceFile().getFilePath();
  return file.includes(`/node_modules/${pkg}/`) || file.includes(`/node_modules/@types/${pkg}/`);
};

/** The validator call a value is handed to, and the validator, when it is handed to one. */
const validatedBy = (
  value: TsNode,
  validators: readonly RequestValidator[],
): { call: TsNode; validator: RequestValidator } | undefined => {
  const parent = value.getParent();
  if (parent === undefined || !Node.isCallExpression(parent)) return undefined;
  const callee = parent.getExpression();
  const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
  const position = parent.getArguments().indexOf(value as never);
  for (const validator of validators) {
    if (!validator.methods.includes(method) || position !== validator.arg) continue;
    if (calleeDeclarations(callee).some((declaration) => declaredIn(declaration, validator.package))) {
      return { call: parent, validator };
    }
  }
  return undefined;
};

/**
 * The type at a key of a type that may be a choice: `safeParse` hands back a
 * success holding `data` or a failure holding none, and the value is the one
 * member that says something there.
 */
const keyedType = (type: Type, at: readonly string[], site: TsNode): Type | undefined => {
  if (at.length === 0) return type;
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const found = new Map<string, Type>();
  for (const member of members) {
    const value = typeAt(member, at, site)?.getNonNullableType();
    if (value !== undefined && saysSomething(value, new Set())) found.set(value.getText(), value);
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
};

/**
 * What the code says a value is, from where it uses it: what a validator
 * checked it into, or what a cast or an annotation claims it is.
 */
const saidOf = (value: TsNode, validators: readonly RequestValidator[]): Candidate | undefined => {
  const outer = outermost(value);
  const checked = validatedBy(outer, validators);
  if (checked !== undefined) {
    const site = outermost(checked.call);
    const type = keyedType(settled(site.getType()), checked.validator.at, site);
    return type === undefined ? undefined : { type, site, claimed: false };
  }
  let parent = outer.getParent();
  // `req.body as unknown as CreateOrder` claims the last type it is cast to.
  while (parent !== undefined && Node.isAsExpression(parent) && Node.isAsExpression(parent.getParent())) {
    parent = parent.getParent();
  }
  if (parent !== undefined && Node.isAsExpression(parent)) {
    const written = parent.getTypeNode();
    if (written === undefined || written.getText() === 'const') return undefined;
    return { type: written.getType(), site: parent, claimed: true };
  }
  if (parent !== undefined && Node.isVariableDeclaration(parent) && parent.getInitializer() === outer) {
    const written = parent.getTypeNode();
    return written === undefined ? undefined : { type: written.getType(), site: parent, claimed: true };
  }
  return undefined;
};

/** Whether a name is the key of an access, `x.name`, rather than a value of its own. */
const isAccessedName = (node: TsNode): boolean => {
  const parent = node.getParent();
  return parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node;
};

/** Every expression in a function that reads a path of keys off one of its parameters. */
const readsOf = (fn: FunctionLike, parameter: ParameterDeclaration, at: readonly string[]): TsNode[] => {
  const out: TsNode[] = [];
  const body = fn.getBody();
  if (body === undefined) return out;
  const last = at[at.length - 1];
  for (const node of body.getDescendants()) {
    const fits =
      (Node.isPropertyAccessExpression(node) && node.getName() === last) ||
      (Node.isElementAccessExpression(node) && last !== undefined) ||
      // A name read as itself or as the object of an access - `params.id`,
      // where `params` was bound in the parameter list (P38) - but not the
      // name an access reads off something else.
      (Node.isIdentifier(node) && !isAccessedName(node));
    if (!fits) continue;
    if (Node.isIdentifier(node)) {
      // A name bound to the part - `const { body } = req` - and read: its
      // declaration is the binding, which is not itself a read.
      const parent = node.getParent();
      if (parent !== undefined && (Node.isBindingElement(parent) || Node.isParameterDeclaration(parent))) continue;
      if (parent !== undefined && Node.isVariableDeclaration(parent) && parent.getNameNode() === node) continue;
    }
    const path = pathFrom(node, parameter);
    if (path !== undefined && sameKeys(path, at)) out.push(node);
  }
  return out;
};

/**
 * The call `JSON.parse(value)`, when a value is handed to it - as itself or as
 * the side of a fallback that is the value when there is one,
 * `JSON.parse(event.body ?? '{}')`.
 */
const parsedBy = (value: TsNode): TsNode | undefined => {
  let at = outermost(value);
  for (let parent = at.getParent(); parent !== undefined; parent = at.getParent()) {
    if (!Node.isBinaryExpression(parent) || parent.getLeft() !== at) break;
    if (!['??', '||'].includes(parent.getOperatorToken().getText())) break;
    at = outermost(parent);
  }
  const parent = at.getParent();
  return parent !== undefined && Node.isCallExpression(parent) && parent.getExpression().getText() === 'JSON.parse'
    ? parent
    : undefined;
};

/** What a function reads at one place: what it found, and whether it reads the place at all. */
interface AtPlace {
  found: Candidate[];
  read: boolean;
}

/** What a function reads at one place, as the parameter declares it or as the code says it. */
const atPlace = (
  fn: FunctionLike,
  place: RequestPlace,
  reading: RequestReading,
  defaults: ReadonlySet<string>,
): AtPlace => {
  const parameter = fn.getParameters()[place.param];
  if (parameter === undefined) return { found: [], read: false };
  const declared = typeAt(parameter.getType(), place.at, fn);
  if (declared !== undefined) {
    const value = settled(declared);
    const isText = value.getNonNullableType().isString();
    if (saysSomething(value, defaults) && !(place.text && isText)) {
      return { found: [{ type: value, site: parameter, claimed: false }], read: true };
    }
  }
  const found: Candidate[] = [];
  const reads = readsOf(fn, parameter, place.at);
  for (const read of reads) {
    const parsed = place.text ? parsedBy(read) : read;
    const said = parsed === undefined ? undefined : saidOf(parsed, reading.validators);
    if (said !== undefined) {
      found.push(said);
      continue;
    }
    // A body parser in front of the function - a middleware that turns the
    // text into the value - hands it the shape rather than the text, and the
    // code says which with a cast on the read itself (P30). Text cast to text
    // is not that.
    if (place.text && parsed === undefined) {
      const direct = saidOf(read, reading.validators);
      if (direct !== undefined && !direct.type.getNonNullableType().isString()) found.push(direct);
    }
  }
  return { found, read: reads.length > 0 };
};

/** What a function reads through the calls that hand back a part. */
const byCalls = (
  fn: FunctionLike,
  call: RequestCall,
  reading: RequestReading,
  defaults: ReadonlySet<string>,
): Array<{ part: RequestPart; found?: Candidate }> => {
  const parameter = fn.getParameters()[call.param];
  const body = fn.getBody();
  if (parameter === undefined || body === undefined) return [];
  const out: Array<{ part: RequestPart; found?: Candidate }> = [];
  for (const site of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = site.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== call.method) continue;
    const path = pathFrom(callee.getExpression(), parameter);
    if (path === undefined || !sameKeys(path, call.at)) continue;
    const args = site.getArguments();
    let part: RequestPart | undefined;
    if (call.byArgument !== undefined) {
      const [first] = args;
      const key = first !== undefined && Node.isStringLiteral(first) ? first.getLiteralValue() : undefined;
      part = key === undefined ? undefined : call.byArgument[key];
    } else if (args.length === 0) {
      part = call.part;
    } else if (call.part !== undefined) {
      // `c.req.param('id')` reads one of the part's values: a read of the part,
      // though what it hands back is one value of it, not its shape.
      out.push({ part: call.part });
      continue;
    }
    if (part === undefined) continue;
    const said = saidOf(site, reading.validators);
    if (said !== undefined) {
      out.push({ part, found: said });
      continue;
    }
    const own = settled(site.getReturnType());
    out.push({ part, ...(saysSomething(own, defaults) ? { found: { type: own, site, claimed: call.claim } } : {}) });
  }
  return out;
};

/**
 * The name and the thing it is a member of, for a name written as a value
 * (`kit.createClient`) or as a type (`kit.DataClient`, P49) alike.
 */
const memberOf = (callee: TsNode): { name: string; object: TsNode } | undefined => {
  if (Node.isPropertyAccessExpression(callee)) return { name: callee.getName(), object: callee.getExpression() };
  if (Node.isQualifiedName(callee)) return { name: callee.getRight().getText(), object: callee.getLeft() };
  return undefined;
};

/** The name a call is made by, and the name its callee is reached from: `respond` and `respond`, or `respond` and `http`. */
const calledBy = (callee: TsNode): { name: string; root: string } | undefined => {
  if (Node.isIdentifier(callee)) return { name: callee.getText(), root: callee.getText() };
  const member = memberOf(callee);
  return member !== undefined && Node.isIdentifier(member.object)
    ? { name: member.name, root: member.object.getText() }
    : undefined;
};

/** Whether a module specifier is a package or a path inside it. */
const fromPackage = (specifier: string, pkg: string): boolean => specifier === pkg || specifier.startsWith(`${pkg}/`);

/**
 * Whether a name at a call is the one an import binds, and not a local of the
 * same name declared nearer: `const findOne = …` inside a function shadows the
 * kit's `findOne` (P37).
 */
const boundByImport = (name: TsNode): boolean =>
  (name.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) => Node.isImportSpecifier(declaration) || Node.isNamespaceImport(declaration) || Node.isImportClause(declaration),
  );

/**
 * Whether a call is one to a helper (P30), or to any function a configuration
 * names the same way - a data kit's `insert('orders', row)` (P37).
 *
 * A helper of a package is matched by the import in the calling file, which is
 * there whether or not the package is installed: a name imported from it under
 * whatever local name, or a property of a namespace or default import of it.
 * A helper of the project's is matched by name and by being declared outside
 * any installed package.
 */
export const callsHelper = (site: TsNode, helper: { name: string; package?: string | undefined }): boolean =>
  Node.isCallExpression(site) && namesHelper(site.getExpression(), helper);

/**
 * Whether a name is the helper's, wherever it is written: the callee of a call,
 * the `createClient` of `ReturnType<typeof createClient>`, or a type the same
 * package exports (P44). Matched the way {@link callsHelper} matches a call.
 */
export const namesHelper = (callee: TsNode, helper: { name: string; package?: string | undefined }): boolean => {
  const called = calledBy(callee);
  if (called === undefined) return false;
  if (helper.package === undefined) {
    if (called.name !== helper.name) return false;
    const declarations = calleeDeclarations(callee);
    return declarations.length > 0 && declarations.every((declaration) => !declaration.getSourceFile().getFilePath().includes('/node_modules/'));
  }
  const pkg = helper.package;
  const isHelper = (declared: Declared | undefined): boolean =>
    declared !== undefined && declared.name === helper.name && fromPackage(declared.module, pkg);
  for (const declaration of callee.getSourceFile().getImportDeclarations()) {
    const module = declaration.getModuleSpecifierValue();
    const barrel = isRelative(module) ? declaration.getModuleSpecifierSourceFile() : undefined;
    if (!fromPackage(module, pkg) && barrel === undefined) continue;
    // What a name imported from here is, by the package that declares it: the
    // package itself, or the one a barrel of the repository's re-exports it from.
    const declaredAs = (name: string): Declared | undefined =>
      barrel === undefined ? { module, name } : reexported(barrel, name, 0);
    if (called.root === called.name && Node.isIdentifier(callee)) {
      if (!boundByImport(callee)) continue;
      const named = declaration
        .getNamedImports()
        .some((specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === called.name && isHelper(declaredAs(specifier.getName())));
      // A default import called itself: the row names it `default`.
      const byDefault = declaration.getDefaultImport()?.getText() === called.name && isHelper(declaredAs('default'));
      if (named || byDefault) return true;
      continue;
    }
    const member = memberOf(callee);
    if (member === undefined || !boundByImport(member.object)) continue;
    if (declaration.getNamespaceImport()?.getText() === called.root && isHelper(declaredAs(called.name))) return true;
    if (barrel === undefined && declaration.getDefaultImport()?.getText() === called.root && called.name === helper.name) return true;
  }
  return false;
};

/** A name as the module that declares it spells it. */
interface Declared {
  readonly module: string;
  readonly name: string;
}

const isRelative = (specifier: string): boolean => specifier.startsWith('.');

/** How many barrels a re-export is followed through. */
const MOST_BARRELS = 4;

/**
 * Where a barrel of the repository's gets a name it exports, when that is a
 * package: `export { respond } from '@acme/http-kit'`, `export * from …`, or an
 * import of the package exported again. A name the barrel declares itself is
 * its own and not the package's, whatever it is called.
 */
const reexported = (barrel: SourceFile, name: string, hops: number): Declared | undefined => {
  if (hops > MOST_BARRELS) return undefined;
  const onward = (module: string, from: SourceFile | undefined, as: string): Declared | undefined => {
    if (!isRelative(module)) return { module, name: as };
    return from === undefined ? undefined : reexported(from, as, hops + 1);
  };
  for (const declaration of barrel.getExportDeclarations()) {
    const module = declaration.getModuleSpecifierValue();
    const named = declaration
      .getNamedExports()
      .find((specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name);
    if (named !== undefined) {
      const original = named.getName();
      if (module !== undefined) return onward(module, declaration.getModuleSpecifierSourceFile(), original);
      // `import respond from '@acme/http-kit'; export { respond }`: the package's default.
      const byDefault = barrel.getImportDeclarations().find((candidate) => candidate.getDefaultImport()?.getText() === original);
      if (byDefault !== undefined) {
        return onward(byDefault.getModuleSpecifierValue(), byDefault.getModuleSpecifierSourceFile(), 'default');
      }
      const imported = barrel.getImportDeclarations().find((candidate) =>
        candidate.getNamedImports().some((specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === original),
      );
      const specifier = imported?.getNamedImports().find((candidate) => (candidate.getAliasNode()?.getText() ?? candidate.getName()) === original);
      return imported === undefined || specifier === undefined
        ? undefined
        : onward(imported.getModuleSpecifierValue(), imported.getModuleSpecifierSourceFile(), specifier.getName());
    }
  }
  // `export *` passes on every name but the default, and none the barrel declares.
  if (name === 'default' || declaresItself(barrel, name)) return undefined;
  // Two of them passing on one name, from two places, pass on neither: the
  // compiler calls the name ambiguous and exports it from nowhere. A module of
  // the repository's that has the name but not from a package is a place too.
  const places = barrel.getExportDeclarations().flatMap((declaration): Array<Declared | null> => {
    const module = declaration.getModuleSpecifierValue();
    if (module === undefined || declaration.hasNamedExports() || declaration.getNamespaceExport() !== undefined) return [];
    const from = declaration.getModuleSpecifierSourceFile();
    const found = onward(module, from, name);
    if (found !== undefined) return [found];
    return from?.getExportedDeclarations().has(name) === true ? [null] : [];
  });
  const distinct = new Set(places.map((place) => (place === null ? null : `${place.module}\0${place.name}`)));
  return distinct.size === 1 ? (places[0] ?? undefined) : undefined;
};

/** Whether a module declares a name of its own rather than passing one on. */
const declaresItself = (file: SourceFile, name: string): boolean =>
  (file.getExportedDeclarations().get(name) ?? []).some((declaration) => declaration.getSourceFile() === file);

/** Every call in a function's body, the body itself first when it is one. */
const callsIn = (fn: FunctionLike): TsNode[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  const calls: TsNode[] = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  if (Node.isCallExpression(body)) calls.unshift(body);
  return calls;
};

/** What a function reads through helpers of the project's that hand back a part (P30). */
const byHelpers = (
  fn: FunctionLike,
  helper: RequestHelper,
  reading: RequestReading,
  defaults: ReadonlySet<string>,
): Array<{ part: RequestPart; found?: Candidate }> => {
  const parameter = fn.getParameters()[helper.param];
  if (parameter === undefined) return [];
  const out: Array<{ part: RequestPart; found?: Candidate }> = [];
  for (const site of callsIn(fn)) {
    if (!Node.isCallExpression(site) || !callsHelper(site, helper)) continue;
    const handed = site.getArguments()[helper.arg];
    if (handed === undefined || pathFrom(innermost(handed), parameter) === undefined) continue;
    const said = saidOf(site, reading.validators);
    if (said !== undefined) {
      out.push({ part: helper.part, found: said });
      continue;
    }
    const [asked] = site.getTypeArguments();
    if (asked !== undefined) {
      const type = asked.getType();
      out.push({ part: helper.part, ...(saysSomething(type, defaults) ? { found: { type, site, claimed: helper.claim } } : {}) });
      continue;
    }
    const own = settled(site.getReturnType());
    out.push({ part: helper.part, ...(saysSomething(own, defaults) ? { found: { type: own, site, claimed: helper.claim } } : {}) });
  }
  return out;
};

/** The one type several finds agree on: the checked ones first, a claim only where nothing is checked. */
const agreed = (found: readonly Candidate[], collect: Collect): FoundType | undefined => {
  for (const claimed of [false, true]) {
    const refs = new Set<TypeRef>();
    for (const candidate of found) {
      if (candidate.claimed !== claimed) continue;
      const ref = collect(candidate.type, candidate.site);
      if (!SAYS_NOTHING.has(ref)) refs.add(ref);
    }
    // Two different answers for one part are no answer: picking one would
    // compare a caller with half of what the handler reads.
    if (refs.size === 1) return { ref: [...refs][0] as TypeRef, claimed };
    if (refs.size > 1) return undefined;
  }
  return undefined;
};

/** Whether a status says the request failed. */
const failing = (status: number): boolean => status >= 400;

/**
 * A status written as a number, or as a name the checker knows the number of -
 * an enum member, a constant (P30). A name that could be one of several numbers
 * stands for them when they all succeed or all fail, since that is all an
 * answer's status decides here; otherwise it is not known.
 */
const literalStatus = (node: TsNode | undefined): number | undefined => {
  if (node === undefined) return undefined;
  const at = innermost(node);
  if (Node.isNumericLiteral(at)) return Number(at.getLiteralValue());
  const type = at.getType();
  const values = (type.isUnion() ? type.getUnionTypes() : [type]).map((member) =>
    member.isNumberLiteral() ? Number(member.getLiteralValue()) : undefined,
  );
  const [first] = values;
  if (first === undefined || values.some((value) => value === undefined)) return undefined;
  const numbers = values as number[];
  return numbers.every(failing) || !numbers.some(failing) ? first : undefined;
};

/** What is said about an answer's status: a number, `null` when nothing is, or `undefined` when it is not a number. */
type Status = number | null | undefined;

const statusOfCall = (
  site: TsNode,
  answer: { statusArg?: number | undefined; statusKey?: string | undefined },
): Status => {
  if (!Node.isCallExpression(site)) return null;
  const args = site.getArguments();
  if (answer.statusArg !== undefined && args[answer.statusArg] !== undefined) {
    return literalStatus(args[answer.statusArg]);
  }
  if (answer.statusKey !== undefined) {
    for (const argument of args) {
      const literal = innermost(argument);
      if (!Node.isObjectLiteralExpression(literal)) continue;
      const property = literal.getProperty(answer.statusKey);
      if (property === undefined) continue;
      return Node.isPropertyAssignment(property) ? literalStatus(property.getInitializer()) : undefined;
    }
  }
  return null;
};

/** One answer found: what is sent, with which status, and whether it was handed to a call. */
interface Sent {
  value: TsNode;
  status: Status;
  handed: boolean;
  /** The arguments an answer is built from, by the field each becomes (P33). */
  fields?: ReadonlyArray<readonly [string, TsNode]>;
}

/** The expression inside brackets, down to a cast if there is one. */
const innermostCast = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  return at;
};

/**
 * The type of an answer: what the call it is handed to holds it to, where that
 * says something - `Response<OrderDto>` makes `res.json` take an `OrderDto` -
 * and otherwise the value's own. A returned value has only its own.
 */
const answerType = (sent: Sent, defaults: ReadonlySet<string>): Candidate | undefined => {
  const { value } = sent;
  const claimed = Node.isAsExpression(innermostCast(value));
  // An optional parameter - `json(body?: ResBody)` - adds an `undefined` nobody sends.
  const expected = sent.handed && Node.isExpression(value) ? value.getContextualType()?.getNonNullableType() : undefined;
  if (expected !== undefined && saysSomething(expected, defaults)) return { type: expected, site: value, claimed: false };
  // `res.send('ok')` answers with a string, not with the one string it wrote.
  const written = settled(value.getType());
  const own = written.isLiteral() ? written.getBaseTypeOfLiteralType() : written;
  return saysSomething(own, defaults) ? { type: own, site: value, claimed } : undefined;
};

/**
 * An answer as a reference: the type of the value sent, or an object built
 * from the arguments a helper is handed, each field typed by its argument as
 * written there - a literal by its kind - and a field whose argument says
 * nothing left out (P33).
 */
const sentRef = (sent: Sent, defaults: ReadonlySet<string>, collect: Collect): { ref: TypeRef; claimed: boolean } | undefined => {
  if (sent.fields === undefined) {
    const type = answerType(sent, defaults);
    return type === undefined ? undefined : { ref: collect(type.type, type.site), claimed: type.claimed };
  }
  const fields: TypeRefField[] = [];
  for (const [name, argument] of sent.fields) {
    const written = settled(argument.getType());
    const own = written.isLiteral() ? written.getBaseTypeOfLiteralType() : written;
    if (!saysSomething(own, defaults)) continue;
    const ref = collect(own, argument);
    if (SAYS_NOTHING.has(ref)) continue;
    fields.push({ name, optional: false, type: parseTypeRef(ref) });
  }
  if (fields.length === 0) return undefined;
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { ref: formatTypeRef({ kind: 'object', fields }), claimed: false };
};

/** The calls of a function's own body, and the returns that are its own. */
const ownReturns = (fn: FunctionLike): TsNode[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor((at) => functionLikeOf(at) !== undefined) === fn)
    .map((statement) => statement.getExpression())
    .filter((expression): expression is NonNullable<typeof expression> => expression !== undefined);
};

/** Every answer a handler gives, the ways its framework lets it. */
const sentBy = (fn: FunctionLike, answers: readonly RequestAnswer[]): Sent[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  const parameters = fn.getParameters();
  const sent: Sent[] = [];
  const answering = new Set<TsNode>();
  const calls = callsIn(fn).filter(Node.isCallExpression);

  for (const answer of answers) {
    if (answer.by === 'call') {
      const parameter = parameters[answer.param];
      if (parameter === undefined) continue;
      for (const site of calls) {
        const callee = site.getExpression();
        if (!Node.isPropertyAccessExpression(callee) || !answer.methods.includes(callee.getName())) continue;
        // In front of it, the methods that set the status: `res.status(404).json(…)`.
        let receiver = callee.getExpression();
        let status: Status = null;
        while (Node.isCallExpression(receiver)) {
          const inner = receiver.getExpression();
          if (!Node.isPropertyAccessExpression(inner) || !answer.statusMethods.includes(inner.getName())) break;
          status = literalStatus(receiver.getArguments()[0]);
          receiver = inner.getExpression();
        }
        const path = pathFrom(receiver, parameter);
        if (path === undefined || !sameKeys(path, answer.at)) continue;
        answering.add(site);
        const value = site.getArguments()[answer.arg];
        if (value === undefined) continue;
        const own = statusOfCall(site, answer);
        sent.push({ value, status: own === null ? status : own, handed: true });
      }
    }
    if (answer.by === 'named') {
      for (const site of calls) {
        if (site.getExpression().getText() !== answer.callee) continue;
        answering.add(site);
        const value = site.getArguments()[answer.arg];
        if (value !== undefined) sent.push({ value, status: statusOfCall(site, answer), handed: true });
      }
    }
    if (answer.by === 'assign') {
      const parameter = parameters[answer.param];
      if (parameter === undefined) continue;
      const assignments = body
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .filter((site) => site.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
      const assignedAt = (site: TsNode & { getLeft(): TsNode }, at: readonly string[]): boolean => {
        const path = pathFrom(site.getLeft(), parameter);
        return path !== undefined && sameKeys(path, at);
      };
      const statuses = answer.statusAt === undefined ? [] : assignments.filter((site) => assignedAt(site, answer.statusAt ?? []));
      for (const site of assignments) {
        if (!assignedAt(site, answer.at)) continue;
        sent.push({ value: site.getRight(), status: statusBefore(site, statuses), handed: false });
      }
    }
    if (answer.by === 'helper') {
      for (const site of calls) {
        if (!callsHelper(site, answer)) continue;
        answering.add(site);
        const args = site.getArguments();
        const status: Status =
          answer.status !== undefined
            ? answer.status
            : answer.statusArg === undefined
              ? null
              : args[answer.statusArg] === undefined
                ? null
                : literalStatus(args[answer.statusArg]);
        if (answer.fields !== undefined) {
          const fields = Object.entries(answer.fields).flatMap(([name, index]) => {
            const argument = args[index];
            return argument === undefined ? [] : [[name, argument] as const];
          });
          sent.push({ value: site, status, handed: false, fields });
          continue;
        }
        const handed = args[answer.arg];
        const value = handed === undefined ? undefined : answer.at.length === 0 ? handed : valueAt(handed, answer.at);
        if (value === undefined) continue;
        sent.push({ value, status, handed: answer.at.length === 0 });
      }
    }
  }

  for (const answer of answers) {
    if (answer.by !== 'return') continue;
    for (const returned of ownReturns(fn)) {
      // `return res.json(x)` is the call's answer, already counted.
      const inner = innermost(returned);
      if (answering.has(inner) || (Node.isCallExpression(inner) && answeredThrough(inner, answering))) continue;
      if (answer.at.length === 0) {
        sent.push({ value: returned, status: null, handed: false });
        continue;
      }
      if (!Node.isObjectLiteralExpression(inner)) continue;
      let value = valueAt(inner, answer.at);
      if (value === undefined) continue;
      if (answer.text) {
        const stringified = innermost(value);
        if (!Node.isCallExpression(stringified) || stringified.getExpression().getText() !== 'JSON.stringify') continue;
        value = stringified.getArguments()[0];
        if (value === undefined) continue;
      }
      const statusNode = answer.statusAt === undefined ? undefined : valueAt(inner, answer.statusAt);
      sent.push({
        value,
        status: answer.statusAt === undefined || statusNode === undefined ? null : literalStatus(statusNode),
        handed: false,
      });
    }
  }
  return sent;
};

/**
 * The status assigned before an answer, in the block it is assigned in or one
 * around it: `ctx.status = 201; ctx.body = order`. The nearest one before it
 * wins, as it does when the code runs; none means none was said.
 */
const statusBefore = (answer: TsNode, statuses: ReadonlyArray<TsNode & { getRight(): TsNode }>): Status => {
  let found: (TsNode & { getRight(): TsNode }) | undefined;
  for (const status of statuses) {
    if (status.getStart() >= answer.getStart()) continue;
    const block = status.getFirstAncestor((node) => Node.isBlock(node));
    if (block !== undefined && !answer.getAncestors().includes(block)) continue;
    if (found === undefined || status.getStart() > found.getStart()) found = status;
  }
  return found === undefined ? null : literalStatus(found.getRight());
};

/** Whether a call is a link of a chain one of the answering calls ends. */
const answeredThrough = (call: TsNode, answering: ReadonlySet<TsNode>): boolean => {
  for (const site of answering) {
    if (site === call || site.getDescendants().includes(call)) return true;
  }
  return false;
};

/** The value written at a path of keys of an object literal. */
const valueAt = (literal: TsNode, at: readonly string[]): TsNode | undefined => {
  let current: TsNode | undefined = literal;
  for (const key of at) {
    if (current === undefined) return undefined;
    const object = innermost(current);
    if (!Node.isObjectLiteralExpression(object)) return undefined;
    const property = object.getProperty(key);
    if (property === undefined) return undefined;
    if (Node.isPropertyAssignment(property)) current = property.getInitializer();
    else if (Node.isShorthandPropertyAssignment(property)) current = property.getNameNode();
    else return undefined;
  }
  return current;
};

/** Several answers as one reference: each kind once, in a fixed order. */
const oneOf = (refs: ReadonlySet<TypeRef>): TypeRef | undefined => {
  const list = [...refs].sort();
  if (list.length === 0) return undefined;
  return list.map((ref) => (list.length > 1 && ref.includes('|') ? `(${ref})` : ref)).join('|');
};

/**
 * What a handler reads from its request and answers it with, the way its
 * framework says.
 *
 * Undefined for a declaration that is not a function written in place - there
 * is nothing to read - which is a different answer from a function read that
 * states nothing: a shape with no parts and no response.
 */
export const readRequest = (
  declaration: TsNode,
  reading: RequestReading,
  collect: Collect,
  route: { path?: string } = {},
): RouteShape | undefined => {
  const fn = functionLikeOf(declaration);
  if (fn === undefined) return undefined;
  const defaults = new Set(reading.defaults);

  const found = new Map<RequestPart, Candidate[]>();
  const read = new Set<RequestPart>();
  const add = (part: RequestPart, candidates: readonly Candidate[]): void => {
    read.add(part);
    if (candidates.length > 0) found.set(part, [...(found.get(part) ?? []), ...candidates]);
  };
  for (const part of REQUEST_PARTS) {
    for (const place of reading.parts[part] ?? []) {
      const here = atPlace(fn, place, reading, defaults);
      if (here.read) read.add(part);
      if (here.found.length === 0) continue;
      add(part, here.found);
      // The first place that holds the part is where the framework keeps it.
      break;
    }
  }
  for (const call of reading.calls) {
    for (const each of byCalls(fn, call, reading, defaults)) add(each.part, each.found === undefined ? [] : [each.found]);
  }
  for (const helper of reading.helpers) {
    for (const each of byHelpers(fn, helper, reading, defaults)) add(each.part, each.found === undefined ? [] : [each.found]);
  }
  const parts: Partial<Record<RequestPart, FoundType>> = {};
  for (const part of REQUEST_PARTS) {
    const agreedOn = agreed(found.get(part) ?? [], collect);
    if (agreedOn !== undefined) parts[part] = agreedOn;
  }
  // Path params nothing typed are still named by the path, and every framework
  // hands them over as text: a handler that reads them reads that (P30).
  if (parts.params === undefined && read.has('params') && route.path !== undefined) {
    const named = pathParamsOf(route.path);
    if (named !== undefined) parts.params = { ref: named, claimed: false };
  }

  const success = new Set<TypeRef>();
  const unknown = new Set<TypeRef>();
  let claimed = false;
  const failures: Record<string, Set<TypeRef>> = {};
  for (const sent of sentBy(fn, reading.answers)) {
    const type = sentRef(sent, defaults, collect);
    if (type === undefined) continue;
    const { ref } = type;
    if (SAYS_NOTHING.has(ref)) continue;
    // A status the code computes could be either, so the answer is kept apart
    // from both rather than guessed into one (P30).
    if (sent.status === undefined) {
      unknown.add(ref);
      continue;
    }
    if (sent.status !== null && failing(sent.status)) {
      (failures[String(sent.status)] ??= new Set()).add(ref);
      continue;
    }
    success.add(ref);
    claimed ||= type.claimed;
  }
  const response = oneOf(success);
  const statusUnknown = oneOf(unknown);
  return {
    parts,
    ...(response === undefined ? {} : { response: { ref: response, claimed } }),
    failures: Object.fromEntries(
      Object.entries(failures)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([status, refs]) => [status, oneOf(refs) as TypeRef]),
    ),
    ...(statusUnknown === undefined ? {} : { statusUnknown }),
  };
};

/**
 * A segment of a path that names a param, in each spelling frameworks use:
 * `:id` and `:id?`, `{id}` and `{proxy+}`, `[id]` and `[...slug]`.
 */
const PATH_PARAM = /^(?::([A-Za-z_$][\w$]*)(\?)?|\{([A-Za-z_$][\w$]*)\+?\}|\[(?:\.\.\.)?([A-Za-z_$][\w$]*)\])$/;

/** A `:name` inside a segment with literal text around it. */
const EMBEDDED_PARAM = /:([A-Za-z_$][\w$]*)/g;

/** The params a path names, as an object of strings, or nothing when it names none. */
export const pathParamsOf = (path: string): TypeRef | undefined => {
  const fields = new Map<string, boolean>();
  for (const segment of path.split('/')) {
    const match = PATH_PARAM.exec(segment);
    if (match === null) {
      // A name among literal text, as a segment like SvelteKit's `foo-[id]` is written (`foo-:id`).
      for (const embedded of segment.matchAll(EMBEDDED_PARAM)) fields.set(embedded[1] as string, false);
      continue;
    }
    const name = match[1] ?? match[3] ?? match[4];
    if (name !== undefined) fields.set(name, match[2] === '?');
  }
  if (fields.size === 0) return undefined;
  return formatTypeRef({
    kind: 'object',
    fields: [...fields.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, optional]) => ({ name, optional, type: { kind: 'primitive', name: 'string' } })),
  });
};

/**
 * The route a way in stands for, as the reading uses it: the path as written
 * at its registration, where the reader kept it, so its params keep their
 * names. Only that one - the path a way in is keyed by has every param renamed
 * `:param`, and naming a handler's params from it would invent the name.
 */
export const routeOf = (entry: { meta?: Record<string, unknown> | undefined }): { path?: string } => {
  const path = entry.meta?.['rawPath'];
  return typeof path === 'string' ? { path } : {};
};

/**
 * A framework's reading with a project's own added to it (P30).
 *
 * A project that answers through its own helper does so whatever framework
 * calls the handler, so what it describes once under
 * `adapters.entry.request` is read beside every framework's own places.
 */
export const extendReading = (reading: RequestReading, extra: RequestReading | undefined): RequestReading => {
  if (extra === undefined) return reading;
  const parts: RequestReading['parts'] = {};
  for (const part of REQUEST_PARTS) {
    const places = [...(reading.parts[part] ?? []), ...(extra.parts[part] ?? [])];
    if (places.length > 0) parts[part] = places;
  }
  return {
    parts,
    calls: [...reading.calls, ...extra.calls],
    helpers: [...reading.helpers, ...extra.helpers],
    answers: [...reading.answers, ...extra.answers],
    defaults: [...reading.defaults, ...extra.defaults],
    validators: [...extra.validators, ...reading.validators],
  };
};

/**
 * A route's shape as the `handles` edge onto its handler carries it: each part
 * under its own key, as a NestJS route's has always been, the answer as the
 * edge's `returns`, and beside them what only a cast says and what is sent on
 * failure.
 */
export const routeShapeEdge = (shape: RouteShape): Pick<GraphEdge, 'meta'> & { returns?: TypeRef } => {
  const claimed = [
    ...REQUEST_PARTS.filter((part) => shape.parts[part]?.claimed === true),
    ...(shape.response?.claimed === true ? ['response'] : []),
  ];
  return {
    meta: {
      [REQUEST_READ_META]: true,
      ...Object.fromEntries(REQUEST_PARTS.flatMap((part) => (shape.parts[part] === undefined ? [] : [[part, shape.parts[part]?.ref]]))),
      ...(claimed.length === 0 ? {} : { [CLAIMED_META]: claimed }),
      ...(Object.keys(shape.failures).length === 0 ? {} : { [FAILURES_META]: shape.failures }),
      ...(shape.statusUnknown === undefined ? {} : { [STATUS_UNKNOWN_META]: shape.statusUnknown }),
    },
    ...(shape.response === undefined ? {} : { returns: shape.response.ref }),
  };
};
