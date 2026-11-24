import { resolve as resolvePath, sep } from 'node:path';
import type { CallExpression, NewExpression, Node as TsNode, ObjectLiteralExpression, Project, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
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
  // `new HttpHeaders({ … })`, `new Headers({ … })`.
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

/** Clients that send an object body as JSON, setting the content type themselves. */
const JSON_BY_DEFAULT = (node: GraphNode): boolean =>
  node.meta?.['package'] === '@angular/common/http' || node.meta?.['client'] === 'axios' || node.meta?.['client'] === 'ky' || node.meta?.['client'] === 'ofetch';

/** Whether a body value is one a client sends as is rather than as JSON: text, a form, a file. */
const sentAsIs = (node: TsNode): boolean => {
  const at = bare(node);
  if (Node.isStringLiteral(at) || Node.isTemplateExpression(at) || Node.isNoSubstitutionTemplateLiteral(at)) return true;
  try {
    const type = at.getType();
    if (type.isString() || type.isStringLiteral()) return true;
    const named = (type.getSymbol() ?? type.getAliasSymbol())?.getName() ?? '';
    return /^(FormData|URLSearchParams|Blob|File|ArrayBuffer|HttpParams)$/.test(named);
  } catch {
    return false;
  }
};

/** What one browser request's own call says: credentials, headers, a JSON body. */
const callOptions = (
  call: CallExpression | NewExpression,
  node: GraphNode,
  at: (n: TsNode) => string,
): { credentials?: CredentialsSaid; headers: string[]; json: boolean } => {
  const args = call.getArguments();
  const method = String(node.meta?.['method'] ?? '').toUpperCase();
  const bodyFirst = BODY_VERBS.has(method) && JSON_BY_DEFAULT(node) && args.length >= 2;
  let credentials: CredentialsSaid | undefined;
  const headers: string[] = [];
  let json = false;
  args.forEach((arg, index) => {
    // The body of a client that takes it before its options is not options.
    if (bodyFirst && index === 1) {
      if (!sentAsIs(arg)) json = true;
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
    // A body inside the options (`fetch`'s init, axios's config): JSON only where the client makes it so.
    const body = propertyOf(object, 'body') ?? propertyOf(object, 'data') ?? propertyOf(object, 'json');
    if (body !== undefined && JSON_BY_DEFAULT(node) && !sentAsIs(body)) json = true;
  });
  return { ...(credentials === undefined ? {} : { credentials }), headers, json };
};

/** What a repository gives every request of one client: credentials, headers. */
interface EveryRequest {
  credentials?: CredentialsSaid;
  headers: Set<string>;
}

/**
 * Settings that reach every request of a client (P388): an interceptor that
 * clones each request `withCredentials` or with headers set (Angular's
 * `HttpClient`), a client's defaults (`axios.defaults.withCredentials = true`,
 * `axios.defaults.headers.common['X-Tenant'] = …`), an instance made with
 * them (`axios.create({ withCredentials: true })`).
 */
const everyRequestOf = (host: RequestFactsHost): { angular: EveryRequest; axios: EveryRequest } => {
  const angular: EveryRequest = { headers: new Set() };
  const axios: EveryRequest = { headers: new Set() };
  const root = resolvePath(host.repoDir);
  for (const source of host.project.getSourceFiles()) {
    const path = source.getFilePath();
    if (!path.startsWith(root) || path.includes('/node_modules/') || source.isDeclarationFile()) continue;
    const text = source.getFullText();
    if (!/withCredentials|setHeaders|defaults|axios\.create/.test(text)) continue;
    const file = relativeOf(host, source);
    const where = (node: TsNode): string => `${file}:${node.getStartLineNumber()}`;
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const name = callee.getName();
        const object = objectOf(node.getArguments()[0]);
        if (object === undefined) return;
        const target = name === 'clone' ? angular : name === 'create' && /axios/i.test(callee.getExpression().getText()) ? axios : undefined;
        if (target === undefined) return;
        const said = saysCredentials(object);
        if (said !== undefined && target.credentials === undefined) target.credentials = { at: where(said), via: name === 'clone' ? 'interceptor' : 'instance' };
        for (const header of [...headerNamesIn(propertyOf(object, 'setHeaders')), ...headerNamesIn(propertyOf(object, 'headers'))]) target.headers.add(header);
        return;
      }
      if (!Node.isBinaryExpression(node) || node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return;
      const left = node.getLeft().getText().replace(/\s+/g, '');
      if (/\.defaults\.withCredentials$/.test(left) && bare(node.getRight()).getKind() === SyntaxKind.TrueKeyword) {
        axios.credentials ??= { at: where(node), via: 'defaults' };
        return;
      }
      const header = /\.defaults\.headers(?:\.common)?\[['"]([^'"]+)['"]\]$/.exec(left) ?? /\.defaults\.headers(?:\.common)?\.([A-Za-z_$][\w$]*)$/.exec(left);
      if (header !== null) axios.headers.add(header[1]!.toLowerCase());
    });
  }
  return { angular, axios };
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
export const readRequestFacts = (host: RequestFactsHost): void => {
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
  let every: ReturnType<typeof everyRequestOf> | undefined;
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
      const own = callOptions(call, request, at);
      every ??= everyRequestOf(host);
      const shared = request.meta?.['package'] === '@angular/common/http' ? every.angular : request.meta?.['client'] === 'axios' ? every.axios : undefined;
      const credentials = own.credentials ?? shared?.credentials;
      const headers = [...new Set([...own.headers, ...(shared?.headers ?? [])])].sort(byText);
      if (credentials !== undefined) meta[CREDENTIALS_META] = credentials;
      if (headers.length > 0) meta[HEADERS_META] = headers;
      if (own.json) meta[SENDS_JSON_META] = true;
    }
    if (Object.keys(meta).length > 0) request.meta = { ...request.meta, ...meta };
  }
};

/** The pass every reader that draws requests runs, after it has drawn them. */
export const requestFactsPass: ExtractorPass<RequestFactsHost> = definePass('request-facts', readRequestFacts);
