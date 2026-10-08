import { Node, SyntaxKind, type Node as TsNode, type ParameterDeclaration, type Type } from 'ts-morph';
import { z } from 'zod';
import { pathFrom, sameKeys } from './envelope.js';
import type { GraphEdge } from './model/edges.js';
import { functionLikeOf, type FunctionLike } from './types/signatures.js';
import type { TypeRef } from './types/type-ref.js';

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
 * How a handler answers, in the four ways a framework lets it.
 *
 * `call` a method on `at` of a parameter is handed the answer (`res.json(x)`);
 * `named` a function the framework exports is (`Response.json(x)`); `assign`
 * the answer is assigned to `at` of a parameter (`ctx.body = x`); `return` the
 * handler returns it, or returns an object with it at `at`, as text when the
 * platform carries it as text (`{ statusCode, body: JSON.stringify(x) }`).
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
 * library checked it - `schema.parse(req.body)`, `parse(schema, req.body)`.
 */
export const requestValidatorSchema = z.strictObject({
  package: z.string().min(1),
  methods: z.array(z.string().min(1)).min(1),
  arg: z.number().int().min(0).default(0),
});

/** Where a framework puts what a request carries and how a handler answers it. */
export const requestReadingSchema = z.strictObject({
  parts: z.partialRecord(partSchema, z.array(requestPlaceSchema)).default({}),
  calls: z.array(requestCallSchema).default([]),
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
  const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  const symbol = name.getSymbol();
  const target = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations() ?? [];
};

const declaredIn = (declaration: TsNode, pkg: string): boolean => {
  const file = declaration.getSourceFile().getFilePath();
  return file.includes(`/node_modules/${pkg}/`) || file.includes(`/node_modules/@types/${pkg}/`);
};

/** The validator call a value is handed to, when it is handed to one. */
const validatedBy = (value: TsNode, validators: readonly RequestValidator[]): TsNode | undefined => {
  const parent = value.getParent();
  if (parent === undefined || !Node.isCallExpression(parent)) return undefined;
  const callee = parent.getExpression();
  const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
  const position = parent.getArguments().indexOf(value as never);
  for (const validator of validators) {
    if (!validator.methods.includes(method) || position !== validator.arg) continue;
    if (calleeDeclarations(callee).some((declaration) => declaredIn(declaration, validator.package))) return parent;
  }
  return undefined;
};

/**
 * What the code says a value is, from where it uses it: what a validator
 * checked it into, or what a cast or an annotation claims it is.
 */
const saidOf = (value: TsNode, validators: readonly RequestValidator[]): Candidate | undefined => {
  const outer = outermost(value);
  const checked = validatedBy(outer, validators);
  if (checked !== undefined) {
    const site = outermost(checked);
    return { type: settled(site.getType()), site, claimed: false };
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
      (Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node.getParent()));
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

/** What a function reads at one place, as the parameter declares it or as the code says it. */
const atPlace = (
  fn: FunctionLike,
  place: RequestPlace,
  reading: RequestReading,
  defaults: ReadonlySet<string>,
): Candidate[] => {
  const parameter = fn.getParameters()[place.param];
  if (parameter === undefined) return [];
  const declared = typeAt(parameter.getType(), place.at, fn);
  if (declared !== undefined) {
    const value = settled(declared);
    const isText = value.getNonNullableType().isString();
    if (saysSomething(value, defaults) && !(place.text && isText)) return [{ type: value, site: parameter, claimed: false }];
  }
  const out: Candidate[] = [];
  for (const read of readsOf(fn, parameter, place.at)) {
    const value = place.text ? parsedBy(read) : read;
    if (value === undefined) continue;
    const said = saidOf(value, reading.validators);
    if (said !== undefined) out.push(said);
  }
  return out;
};

/** What a function reads through the calls that hand back a part. */
const byCalls = (
  fn: FunctionLike,
  call: RequestCall,
  reading: RequestReading,
  defaults: ReadonlySet<string>,
): Array<{ part: RequestPart; found: Candidate }> => {
  const parameter = fn.getParameters()[call.param];
  const body = fn.getBody();
  if (parameter === undefined || body === undefined) return [];
  const out: Array<{ part: RequestPart; found: Candidate }> = [];
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
    }
    if (part === undefined) continue;
    const said = saidOf(site, reading.validators);
    if (said !== undefined) {
      out.push({ part, found: said });
      continue;
    }
    const own = settled(site.getReturnType());
    if (saysSomething(own, defaults)) out.push({ part, found: { type: own, site, claimed: call.claim } });
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

/** A status written as a number, or nothing where it is not one. */
const literalStatus = (node: TsNode | undefined): number | undefined => {
  if (node === undefined) return undefined;
  const at = innermost(node);
  return Node.isNumericLiteral(at) ? Number(at.getLiteralValue()) : undefined;
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
  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  if (Node.isCallExpression(body)) calls.unshift(body);

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
      for (const site of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        if (site.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
        const path = pathFrom(site.getLeft(), parameter);
        if (path !== undefined && sameKeys(path, answer.at)) sent.push({ value: site.getRight(), status: null, handed: false });
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
): RouteShape | undefined => {
  const fn = functionLikeOf(declaration);
  if (fn === undefined) return undefined;
  const defaults = new Set(reading.defaults);

  const found = new Map<RequestPart, Candidate[]>();
  for (const part of REQUEST_PARTS) {
    for (const place of reading.parts[part] ?? []) {
      const here = atPlace(fn, place, reading, defaults);
      if (here.length === 0) continue;
      found.set(part, [...(found.get(part) ?? []), ...here]);
      // The first place that holds the part is where the framework keeps it.
      break;
    }
  }
  for (const call of reading.calls) {
    for (const { part, found: candidate } of byCalls(fn, call, reading, defaults)) {
      found.set(part, [...(found.get(part) ?? []), candidate]);
    }
  }
  const parts: Partial<Record<RequestPart, FoundType>> = {};
  for (const part of REQUEST_PARTS) {
    const agreedOn = agreed(found.get(part) ?? [], collect);
    if (agreedOn !== undefined) parts[part] = agreedOn;
  }

  const success = new Set<TypeRef>();
  let claimed = false;
  const failures: Record<string, Set<TypeRef>> = {};
  for (const sent of sentBy(fn, reading.answers)) {
    // A status that is not a number could be either; precision first.
    if (sent.status === undefined) continue;
    const type = answerType(sent, defaults);
    if (type === undefined) continue;
    const ref = collect(type.type, type.site);
    if (SAYS_NOTHING.has(ref)) continue;
    if (sent.status !== null && sent.status >= 400) {
      (failures[String(sent.status)] ??= new Set()).add(ref);
      continue;
    }
    success.add(ref);
    claimed ||= type.claimed;
  }
  const response = oneOf(success);
  return {
    parts,
    ...(response === undefined ? {} : { response: { ref: response, claimed } }),
    failures: Object.fromEntries(
      Object.entries(failures)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([status, refs]) => [status, oneOf(refs) as TypeRef]),
    ),
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
    },
    ...(shape.response === undefined ? {} : { returns: shape.response.ref }),
  };
};
