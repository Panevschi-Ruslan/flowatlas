import { resolve as resolvePath, sep } from 'node:path';
import type { CallExpression, NewExpression, Node as TsNode, ObjectLiteralExpression, Project, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import { PLATFORM_HEADERS } from './built-query.js';
import { headersAHookAdds, type HookHanded } from './hook-headers.js';
import type { GraphNode } from './model/nodes.js';
import { definePass, type ExtractorPass } from './passes.js';

/**
 * What a request says about itself beyond its address (P388): the statuses
 * the code around it branches on, and, for a browser's request, whether it
 * sends credentials, which headers it sets and whether its body is JSON.
 *
 * Read the same way by every reader that draws a request (a browser's
 * `ui_api_call`, a server's `http_out`), after the requests are drawn, from
 * the place each one is written: the facts the other side's settings are held
 * against - a status no route answers, a credentialed request to a server that
 * allows any origin, a header its CORS settings do not allow.
 *
 * Only what is written out: a status compared as a number (or a constant the
 * checker gives a number), an options object written in the call or in a
 * constant it names. What is not read is simply not said, and nothing here is
 * judged: the judging is the linker's, against what the other side says.
 *
 * What is particular to one HTTP client - whether it sends an object body as
 * JSON itself, which settings reach every one of its requests - is not known
 * here: it is a `RequestClient` the package that knows the client describes,
 * handed in through `requestFactsPassOf` (P394).
 */

/** On a request: the statuses the code that sends it, or the one caller that waits for it, branches on. */
export const STATUS_CHECKS_META = 'statusChecks';
/** On a browser's request: it sends credentials (cookies), and where that is said. */
export const CREDENTIALS_META = 'credentials';
/** On a browser's request: the headers it sets, lower case. */
export const HEADERS_META = 'headers';
/** On a browser's request: its body goes as JSON, so the browser asks before sending it cross-origin. */
export const SENDS_JSON_META = 'sendsJson';

/** One status a request's answer is compared with. */
export interface StatusCheck {
  readonly status: number;
  /** Where the comparison is written, `file:line`. */
  readonly at: string;
  /** The function it is written in, where that is the caller rather than the code that sends. */
  readonly in?: string;
}

/** Where a browser's request was said to carry credentials. */
export interface CredentialsSaid {
  /** `file:line` of the option, or of the setting that gives it to every request. */
  readonly at: string;
  /** `call` where the request's own options say it, else what gives it to every request. */
  readonly via: 'call' | 'interceptor' | 'defaults' | 'instance';
}

/** The statuses read off a request, defensively. */
export const statusChecksOf = (node: { meta?: Record<string, unknown> } | undefined): StatusCheck[] => {
  const raw = node?.meta?.[STATUS_CHECKS_META];
  return Array.isArray(raw)
    ? raw.filter((each): each is StatusCheck => typeof each === 'object' && each !== null && typeof (each as StatusCheck).status === 'number' && typeof (each as StatusCheck).at === 'string')
    : [];
};

/** What a reader hands in: the repository and the graph it drew. */
export interface RequestFactsHost {
  readonly repo: string;
  readonly repoDir: string;
  readonly project: Project;
  readonly builder: GraphBuilder;
}

/**
 * Settings that reach every request of one client, as the package that knows
 * the client describes where they are written (P394).
 */
export interface EveryRequestSettings {
  /**
   * Text one of the settings cannot be written without: a source file holding
   * none of any client's marks is not walked.
   */
  readonly marks: RegExp;
  /**
   * A method called with options on each request on its way out, by name: an
   * interceptor handing on a copy of the request with credentials or headers
   * set. Its options' `setHeaders` and `headers` name the headers.
   */
  readonly perRequest?: string;
  /**
   * A factory making an instance with options: its method's name, and the
   * text of what it is called on; several where a client makes them in more
   * than one way (`ky.create`, `api.extend`, P402).
   */
  readonly instance?: InstanceMade | readonly InstanceMade[];
  /** Assignments to `<client>.defaults.withCredentials` and `<client>.defaults.headers[.common]…`. */
  readonly defaults?: boolean;
}

/** One way a client makes an instance whose options reach every request it sends. */
export interface InstanceMade {
  readonly method: string;
  readonly receiver: RegExp;
  /**
   * Where among the options the functions it runs before each request are
   * written (`hooks.beforeRequest`, `onRequest`), a function or a list of
   * them, and how each is handed the request: the headers they add are the
   * instance's too (P402).
   */
  readonly hooks?: { readonly at: readonly string[]; readonly handed: HookHanded };
}

/**
 * One HTTP client a request can be sent with, described by the package that
 * knows it (P394): how its reader marks the requests it draws, and what the
 * client does on its own that the call does not spell out.
 */
export interface RequestClient {
  /** The meta key and value its reader writes on every request sent with it. */
  readonly drawnWith: { readonly key: string; readonly value: string };
  /**
   * It sends an object body as JSON, setting the content type itself, and a
   * verb with a body takes the body as its second argument.
   */
  readonly jsonByDefault?: boolean;
  /** Type names of the bodies it sends as they are, beside the platform's own (`FormData`, `Blob`, …). */
  readonly bodiesAsIs?: readonly string[];
  /** Settings that reach every one of its requests. */
  readonly every?: EveryRequestSettings;
}

/** The client a request was sent with: the first described whose mark its reader wrote on it. */
const clientOf = (clients: readonly RequestClient[], node: GraphNode): RequestClient | undefined =>
  clients.find((client) => node.meta?.[client.drawnWith.key] === client.drawnWith.value);

const REQUEST_TYPES: ReadonlySet<string> = new Set(['ui_api_call', 'http_out']);

/** The statuses that are an answer's status: a three-digit HTTP status. */
const isStatus = (value: number): boolean => Number.isInteger(value) && value >= 100 && value <= 599;

/** A value with the parentheses, casts and `!` around it taken off. */
const bare = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at) || Node.isTypeAssertion(at)) {
    at = at.getExpression();
  }
  return at;
};

/** A number written out, or a constant (an enum member, a `const`) the checker types as one. */
const numberOf = (node: TsNode): number | undefined => {
  const at = bare(node);
  if (Node.isNumericLiteral(at)) return at.getLiteralValue();
  if (!Node.isPropertyAccessExpression(at) && !Node.isIdentifier(at)) return undefined;
  try {
    const type = at.getType();
    if (type.isNumberLiteral()) {
      const value = type.getLiteralValue();
      return typeof value === 'number' ? value : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

/** Names of the types an answer or an error of a request is: the receiver of `.status` must be one. */
const ANSWER_TYPE = /Response|Error|Exception|Result|Reply/;

/**
 * Whether an expression reads the status of an answer: `err.status`,
 * `res.statusCode`, `e.response?.status`. The receiver must be untyped (a
 * caught error, a callback's parameter) or of a type named as an answer or an
 * error, so an order's own numeric `status` is not taken for one.
 */
const readsStatus = (node: TsNode): boolean => {
  const at = bare(node);
  if (!Node.isPropertyAccessExpression(at)) return false;
  const name = at.getName();
  if (name !== 'status' && name !== 'statusCode') return false;
  try {
    const type = at.getExpression().getType();
    if (type.isAny() || type.isUnknown()) return true;
    const named = (type.getSymbol() ?? type.getAliasSymbol())?.getName() ?? type.getText();
    return ANSWER_TYPE.test(named);
  } catch {
    return false;
  }
};

const EQUALITY: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);

/** The statuses a body compares an answer's status with, each with its line. */
export const statusComparisonsIn = (body: TsNode): Array<{ status: number; line: number }> => {
  const found: Array<{ status: number; line: number }> = [];
  const add = (value: number | undefined, at: TsNode): void => {
    if (value !== undefined && isStatus(value)) found.push({ status: value, line: at.getStartLineNumber() });
  };
  body.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node) && EQUALITY.has(node.getOperatorToken().getKind())) {
      const left = node.getLeft();
      const right = node.getRight();
      if (readsStatus(left)) add(numberOf(right), node);
      else if (readsStatus(right)) add(numberOf(left), node);
      return;
    }
    if (Node.isSwitchStatement(node) && readsStatus(node.getExpression())) {
      for (const clause of node.getCaseBlock().getClauses()) {
        if (Node.isCaseClause(clause)) add(numberOf(clause.getExpression()), clause);
      }
    }
  });
  return found;
};

/** The repository-relative path of a source file, with forward slashes. */
const relativeOf = (host: RequestFactsHost, source: SourceFile): string => {
  const path = source.getFilePath();
  const root = resolvePath(host.repoDir);
  return path.startsWith(root + sep) || path.startsWith(`${root}/`) ? path.slice(root.length + 1).split(sep).join('/') : path;
};

/** Where a request's id says it is written: `file`, line and column. */
const siteOfId = (id: string): { file: string; line: number; column: number } | undefined => {
  const hash = id.indexOf('#');
  if (hash < 0) return undefined;
  const found = /^(.*?):(\d+):(\d+)/.exec(id.slice(hash + 1));
  if (found === null) return undefined;
  return { file: found[1]!, line: Number(found[2]), column: Number(found[3]) };
};

/** The call (or construction) a request is written as: the one starting at its line and column. */
const callAt = (host: RequestFactsHost, file: string, line: number, column: number): CallExpression | NewExpression | undefined => {
  const source = host.project.getSourceFile(resolvePath(host.repoDir, file));
  if (source === undefined) return undefined;
  let position: number;
  try {
    position = source.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    return undefined;
  }
  let found: CallExpression | NewExpression | undefined;
  for (let at: TsNode | undefined = source.getDescendantAtPos(position); at !== undefined && at.getStart() === position; at = at.getParent()) {
    if (Node.isCallExpression(at) || Node.isNewExpression(at)) found = at;
  }
  if (found !== undefined) return found;
  // The id names the token the request starts at, inside the call: the nearest call around it.
  const inside = source.getDescendantAtPos(position);
  return inside?.getFirstAncestor((at): at is CallExpression | NewExpression => Node.isCallExpression(at) || Node.isNewExpression(at));
};

/** The outermost function a node is written in: a method, a declared function, a function a name holds. */
const outermostFunction = (node: TsNode): TsNode | undefined => {
  let found: TsNode | undefined;
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isMethodDeclaration(at) || Node.isFunctionDeclaration(at) || Node.isConstructorDeclaration(at) || Node.isGetAccessorDeclaration(at)) return at;
    if (Node.isArrowFunction(at) || Node.isFunctionExpression(at)) found = at;
    if (Node.isClassDeclaration(at) || Node.isSourceFile(at)) break;
  }
  return found;
};

/** The function declared at a node's line in its file: how a caller's body is found from its node. */
const functionAtNode = (host: RequestFactsHost, node: GraphNode): TsNode | undefined => {
  if (node.file === undefined || node.line === undefined) return undefined;
  const source = host.project.getSourceFile(resolvePath(host.repoDir, node.file));
  if (source === undefined) return undefined;
  return source.getDescendants().find(
    (at) =>
      (Node.isMethodDeclaration(at) || Node.isFunctionDeclaration(at) || Node.isArrowFunction(at) || Node.isFunctionExpression(at)) &&
      at.getStartLineNumber() === node.line,
  );
};

/** An object literal an argument is, or the one a `const` it names holds. */
const objectOf = (node: TsNode | undefined): ObjectLiteralExpression | undefined => {
  if (node === undefined) return undefined;
  const at = bare(node);
  if (Node.isObjectLiteralExpression(at)) return at;
  if (!Node.isIdentifier(at)) return undefined;
  const declaration = at.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  return initializer === undefined ? undefined : Node.isObjectLiteralExpression(bare(initializer)) ? (bare(initializer) as ObjectLiteralExpression) : undefined;
};

/** A property of an object literal written out by name. */
const propertyOf = (object: ObjectLiteralExpression, name: string): TsNode | undefined => {
  for (const property of object.getProperties()) {
    if (Node.isPropertyAssignment(property)) {
      const key = property.getNameNode();
      const said = Node.isIdentifier(key) ? key.getText() : Node.isStringLiteral(key) ? key.getLiteralText() : undefined;
      if (said === name) return property.getInitializer();
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === name) return property.getNameNode();
  }
  return undefined;
};

/** The names an object of headers sets, lower case, where they are written out. */
const headerNamesIn = (node: TsNode | undefined): string[] => {
  if (node === undefined) return [];
  let at = bare(node);
  // `new Headers({ … })`, or a client's own class of headers built the same way.
  if (Node.isNewExpression(at)) {
    const [first] = at.getArguments();
    if (first === undefined) return [];
    at = bare(first);
  }
  const object = objectOf(at);
  if (object === undefined) return [];
  return object.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) return [];
    const key = property.getNameNode();
    if (Node.isIdentifier(key)) return [key.getText().toLowerCase()];
    if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) return [key.getLiteralText().toLowerCase()];
    return [];
  });
};

/** Whether a value says credentials go with the request: `withCredentials: true`, `credentials: 'include'`. */
const saysCredentials = (object: ObjectLiteralExpression): TsNode | undefined => {
  const with_ = propertyOf(object, 'withCredentials');
  if (with_ !== undefined && bare(with_).getKind() === SyntaxKind.TrueKeyword) return with_;
  const credentials = propertyOf(object, 'credentials');
  if (credentials !== undefined) {
    const at = bare(credentials);
    if ((Node.isStringLiteral(at) || Node.isNoSubstitutionTemplateLiteral(at)) && at.getLiteralText() === 'include') return credentials;
  }
  return undefined;
};

/** The verbs a body goes with. */
const BODY_VERBS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The platform's own bodies, which every client sends as they are rather than as JSON. */
const PLATFORM_BODIES: readonly string[] = ['FormData', 'URLSearchParams', 'Blob', 'File', 'ArrayBuffer'];

/** Whether a body value is one a client sends as is rather than as JSON: text, a form, a file. */
const sentAsIs = (node: TsNode, bodies: ReadonlySet<string>): boolean => {
  const at = bare(node);
  if (Node.isStringLiteral(at) || Node.isTemplateExpression(at) || Node.isNoSubstitutionTemplateLiteral(at)) return true;
  try {
    const type = at.getType();
    if (type.isString() || type.isStringLiteral()) return true;
    const named = (type.getSymbol() ?? type.getAliasSymbol())?.getName() ?? '';
    return bodies.has(named);
  } catch {
    return false;
  }
};

/** What one browser request's own call says: credentials, headers, a JSON body. */
const callOptions = (
  call: CallExpression | NewExpression,
  node: GraphNode,
  client: RequestClient | undefined,
  bodies: ReadonlySet<string>,
  at: (n: TsNode) => string,
): { credentials?: CredentialsSaid; headers: string[]; json: boolean } => {
  const args = call.getArguments();
  const method = String(node.meta?.['method'] ?? '').toUpperCase();
  const jsonByDefault = client?.jsonByDefault === true;
  const bodyFirst = BODY_VERBS.has(method) && jsonByDefault && args.length >= 2;
  let credentials: CredentialsSaid | undefined;
  const headers: string[] = [];
  let json = false;
  args.forEach((arg, index) => {
    // The body of a client that takes it before its options is not options.
    if (bodyFirst && index === 1) {
      if (!sentAsIs(arg, bodies)) json = true;
      return;
    }
    const object = objectOf(arg);
    if (object === undefined) return;
    const given = saysCredentials(object);
    if (given !== undefined && credentials === undefined) credentials = { at: at(given), via: 'call' };
    headers.push(...headerNamesIn(propertyOf(object, 'headers')));
    const written = propertyOf(object, 'headers');
    const said = written === undefined ? undefined : objectOf(Node.isNewExpression(bare(written)) ? (bare(written) as NewExpression).getArguments()[0] : written);
    const type = said === undefined ? undefined : (propertyOf(said, 'Content-Type') ?? propertyOf(said, 'content-type'));
    if (type !== undefined && /json/i.test(type.getText())) json = true;
    // A body inside the options (the platform's init, a client's config): JSON only where the client makes it so.
    const body = propertyOf(object, 'body') ?? propertyOf(object, 'data') ?? propertyOf(object, 'json');
    if (body !== undefined && jsonByDefault && !sentAsIs(body, bodies)) json = true;
  });
  return { ...(credentials === undefined ? {} : { credentials }), headers, json };
};

/** What a repository gives every request of one client: credentials, headers. */
interface EveryRequest {
  credentials?: CredentialsSaid;
  headers: Set<string>;
}

/**
 * Settings that reach every request of a client (P388), for each client
 * described with any: an interceptor that hands on a copy of each request with
 * credentials or headers set, a client's defaults
 * (`<client>.defaults.withCredentials = true`), an instance made with them
 * (`<client>.create({ withCredentials: true })`). A call that fits several
 * descriptions is the first described client's; an assignment to `defaults`
 * is every client's that reads its defaults.
 */
const everyRequestOf = (host: RequestFactsHost, clients: readonly RequestClient[]): Map<RequestClient, EveryRequest> => {
  const found = new Map<RequestClient, EveryRequest>();
  const described = clients.flatMap((client) => (client.every === undefined ? [] : [{ client, every: client.every }]));
  for (const { client } of described) found.set(client, { headers: new Set() });
  if (described.length === 0) return found;
  const byDefaults = described.filter(({ every }) => every.defaults === true).map(({ client }) => found.get(client)!);
  const root = resolvePath(host.repoDir);
  for (const source of host.project.getSourceFiles()) {
    const path = source.getFilePath();
    if (!path.startsWith(root) || path.includes('/node_modules/') || source.isDeclarationFile()) continue;
    const text = source.getFullText();
    if (!described.some(({ every }) => every.marks.test(text))) continue;
    const file = relativeOf(host, source);
    const where = (node: TsNode): string => `${file}:${node.getStartLineNumber()}`;
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const name = callee.getName();
        const object = objectOf(node.getArguments()[0]);
        if (object === undefined) return;
        const receiver = callee.getExpression().getText();
        const madeBy = (every: EveryRequestSettings): InstanceMade | undefined =>
          instancesOf(every).find((made) => made.method === name && made.receiver.test(receiver));
        const viaOf = (every: EveryRequestSettings): CredentialsSaid['via'] | undefined =>
          every.perRequest === name ? 'interceptor' : madeBy(every) !== undefined ? 'instance' : undefined;
        const match = described.find(({ every }) => viaOf(every) !== undefined);
        const via = match === undefined ? undefined : viaOf(match.every);
        if (match === undefined || via === undefined) return;
        const target = found.get(match.client)!;
        const said = saysCredentials(object);
        if (said !== undefined && target.credentials === undefined) target.credentials = { at: where(said), via };
        for (const header of [...headerNamesIn(propertyOf(object, 'setHeaders')), ...headerNamesIn(propertyOf(object, 'headers'))]) target.headers.add(header);
        // The headers the functions it runs before each request add (P402).
        const hooks = via === 'instance' ? madeBy(match.every)?.hooks : undefined;
        if (hooks !== undefined) for (const header of hookHeadersIn(object, hooks)) target.headers.add(header);
        return;
      }
      if (byDefaults.length === 0) return;
      if (!Node.isBinaryExpression(node) || node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return;
      const left = node.getLeft().getText().replace(/\s+/g, '');
      if (/\.defaults\.withCredentials$/.test(left) && bare(node.getRight()).getKind() === SyntaxKind.TrueKeyword) {
        for (const target of byDefaults) target.credentials ??= { at: where(node), via: 'defaults' };
        return;
      }
      const header = /\.defaults\.headers(?:\.common)?\[['"]([^'"]+)['"]\]$/.exec(left) ?? /\.defaults\.headers(?:\.common)?\.([A-Za-z_$][\w$]*)$/.exec(left);
      if (header !== null) for (const target of byDefaults) target.headers.add(header[1]!.toLowerCase());
    });
  }
  return found;
};

/** The ways a client's description says it makes instances. */
const instancesOf = (every: EveryRequestSettings): readonly InstanceMade[] =>
  every.instance === undefined ? [] : Array.isArray(every.instance) ? (every.instance as readonly InstanceMade[]) : [every.instance as InstanceMade];

/** A function written in place, or the one a name holds: a hook the options hand the client. */
const hookFunctionOf = (node: TsNode): TsNode | undefined => {
  const at = bare(node);
  if (Node.isArrowFunction(at) || Node.isFunctionExpression(at)) return at;
  if (!Node.isIdentifier(at)) return undefined;
  const declaration = at.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  const value = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  return value !== undefined && (Node.isArrowFunction(bare(value)) || Node.isFunctionExpression(bare(value))) ? bare(value) : undefined;
};

/** The header names the hooks written among an instance's options set unconditionally (P402). */
const hookHeadersIn = (object: ObjectLiteralExpression, hooks: NonNullable<InstanceMade['hooks']>): string[] => {
  let at: TsNode | undefined = object;
  for (const key of hooks.at) {
    const holder: ObjectLiteralExpression | undefined = at === undefined ? undefined : objectOf(at);
    at = holder === undefined ? undefined : propertyOf(holder, key);
  }
  if (at === undefined) return [];
  const written = bare(at);
  const fns = (Node.isArrayLiteralExpression(written) ? written.getElements() : [written]).flatMap((each) => {
    const fn = hookFunctionOf(each);
    return fn === undefined ? [] : [fn];
  });
  return fns.flatMap((fn) => [...headersAHookAdds(fn, hooks.handed, [PLATFORM_HEADERS]).keys]);
};

/** The request ids each node calls, and who calls each node. */
const callIndex = (
  builder: GraphBuilder,
): { requestsOf: Map<string, Set<string>>; holdersOf: Map<string, Set<string>>; callersOf: Map<string, Set<string>>; calleesOf: Map<string, Set<string>> } => {
  const requestsOf = new Map<string, Set<string>>();
  const holdersOf = new Map<string, Set<string>>();
  const callersOf = new Map<string, Set<string>>();
  const calleesOf = new Map<string, Set<string>>();
  for (const edge of builder.edges) {
    if (edge.type !== 'calls') continue;
    const target = builder.getNode(edge.to);
    if (target === undefined) continue;
    if (REQUEST_TYPES.has(target.type)) {
      requestsOf.set(edge.from, (requestsOf.get(edge.from) ?? new Set()).add(edge.to));
      holdersOf.set(edge.to, (holdersOf.get(edge.to) ?? new Set()).add(edge.from));
      continue;
    }
    if (target.type !== 'method' && target.type !== 'function') continue;
    callersOf.set(edge.to, (callersOf.get(edge.to) ?? new Set()).add(edge.from));
    calleesOf.set(edge.from, (calleesOf.get(edge.from) ?? new Set()).add(edge.to));
  }
  return { requestsOf, holdersOf, callersOf, calleesOf };
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reads the facts of every request the reader drew (P388) and writes them on
 * the request's node: `statusChecks`, and on a browser's request
 * `credentials`, `headers` and `sendsJson`.
 *
 * The statuses are read in the function the request is written in, where it
 * sends that one request and no other, and in each function that calls it
 * where that caller waits on no other request (a component subscribing to the
 * one service method that sends it): a comparison there could be about
 * another request's answer, and is then left unread rather than guessed.
 */
export const readRequestFacts = (host: RequestFactsHost, clients: readonly RequestClient[] = []): void => {
  const { builder } = host;
  const requests = builder.nodes.filter((node) => REQUEST_TYPES.has(node.type) && node.repo === host.repo);
  if (requests.length === 0) return;
  const { requestsOf, holdersOf, callersOf, calleesOf } = callIndex(builder);
  const sendsOne = (id: string): boolean => (requestsOf.get(id)?.size ?? 0) === 1;
  // How many of the functions a caller calls send requests, and how many it sends itself.
  const waitsOnOnly = (caller: string, callee: string): boolean => {
    if ((requestsOf.get(caller)?.size ?? 0) > 0) return false;
    const sending = [...(calleesOf.get(caller) ?? [])].filter((each) => (requestsOf.get(each)?.size ?? 0) > 0);
    return sending.length === 1 && sending[0] === callee;
  };
  const bodies: ReadonlySet<string> = new Set([...PLATFORM_BODIES, ...clients.flatMap((client) => client.bodiesAsIs ?? [])]);
  let every: Map<RequestClient, EveryRequest> | undefined;
  for (const request of requests) {
    const site = siteOfId(request.id);
    if (site === undefined) continue;
    const call = callAt(host, site.file, site.line, site.column);
    if (call === undefined) continue;
    const file = relativeOf(host, call.getSourceFile());
    const at = (node: TsNode): string => `${file}:${node.getStartLineNumber()}`;
    const checks: StatusCheck[] = [];
    const holders = [...(holdersOf.get(request.id) ?? [])];
    const holder = holders.length === 1 ? holders[0] : undefined;
    if (holder !== undefined && sendsOne(holder)) {
      const own = outermostFunction(call);
      if (own !== undefined) for (const found of statusComparisonsIn(own)) checks.push({ status: found.status, at: `${file}:${found.line}` });
      for (const caller of [...(callersOf.get(holder) ?? [])].sort(byText)) {
        if (!waitsOnOnly(caller, holder)) continue;
        const node = builder.getNode(caller);
        if (node === undefined) continue;
        const body = functionAtNode(host, node);
        if (body === undefined) continue;
        for (const found of statusComparisonsIn(body)) checks.push({ status: found.status, at: `${node.file}:${found.line}`, in: node.label });
      }
    }
    const meta: Record<string, unknown> = {};
    if (checks.length > 0) {
      const seen = new Set<string>();
      meta[STATUS_CHECKS_META] = checks
        .filter((each) => {
          const key = `${each.status}|${each.at}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.status - b.status || byText(a.at, b.at));
    }
    if (request.type === 'ui_api_call') {
      const client = clientOf(clients, request);
      const own = callOptions(call, request, client, bodies, at);
      every ??= everyRequestOf(host, clients);
      const shared = client === undefined ? undefined : every.get(client);
      const credentials = own.credentials ?? shared?.credentials;
      const headers = [...new Set([...own.headers, ...(shared?.headers ?? [])])].sort(byText);
      if (credentials !== undefined) meta[CREDENTIALS_META] = credentials;
      if (headers.length > 0) meta[HEADERS_META] = headers;
      if (own.json) meta[SENDS_JSON_META] = true;
    }
    if (Object.keys(meta).length > 0) request.meta = { ...request.meta, ...meta };
  }
};

/**
 * The pass every reader that draws requests runs, after it has drawn them,
 * knowing the clients it is handed (P394): the package that describes the
 * clients builds it once, and every reader runs that one.
 */
export const requestFactsPassOf = (clients: readonly RequestClient[]): ExtractorPass<RequestFactsHost> =>
  definePass('request-facts', (host) => readRequestFacts(host, clients));
