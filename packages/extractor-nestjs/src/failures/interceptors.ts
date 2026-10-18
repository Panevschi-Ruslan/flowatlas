import { lineOf, type ClassRef } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type Identifier, type MethodDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { EntryRecord, WrapperApplication } from '../wrapping/types.js';
import { instanceOfTest, type ChoiceSite, type Site } from './filters.js';
import { answerOfClass, classNamed } from './throws.js';

/*
 * What an interceptor does with the errors of the routes behind it (P207).
 *
 * An interceptor wraps the handler's observable, so an error the handler, a
 * pipe or anything they call raises passes through it on the way out, and an
 * RxJS `catchError(...)` in its pipe decides what the caller gets: a new
 * exception (`throwError(() => new BadGatewayException())`, a `throw` in the
 * callback), the same one (`throwError(() => err)`), or a value
 * (`of(fallback)`), in which case the request does not fail at all. A guard
 * runs before every interceptor, so its refusal never passes through one.
 *
 * Interceptors run inside the exception filters: the application's first
 * (outermost), then the controller's, then the handler's, each list in the
 * order it is written, so an error meets the handler's last-written one first.
 * What comes out of the outermost goes to the filters, P87's `throughFilters`.
 *
 * Interceptors are drawn in the graph already; this only changes what a
 * route's failures are.
 */

/** An exception an interceptor gives in place of an error, or raises itself. */
export interface Given {
  exception: string;
  status?: number;
  assumed?: true;
  declared?: number;
  own?: number;
  lineage: readonly string[];
  /** Where it is written. */
  line: number;
}

/** What one `catchError(...)` gives for an error it applies to. */
export type CatchAnswer =
  /** The same error, on its way out: `throwError(() => err)`, `throw err`. */
  | { kind: 'rethrow' }
  /** Another exception in its place. */
  | { kind: 'map'; to: Given }
  /** A value: the caller gets an answer, not a failure (`of(...)`, `EMPTY`). */
  | { kind: 'swallow' }
  /** Something this reader cannot follow. */
  | { kind: 'unread' };

/** One branch of a `catchError(...)`: the class an `instanceof` test narrows to, none for every error. */
export interface CatchRule {
  only?: string;
  answer: CatchAnswer;
}

/** A step of an interceptor's pipe that bears on failures, in the order written. */
export type PipeStep =
  | { kind: 'catch'; rules: readonly CatchRule[] }
  /** `timeout(...)`: raises an error (a `TimeoutError`, or what its `with` gives) the steps after it see. */
  | { kind: 'timeout'; raises: Given };

/** One interceptor that can stand between a route and the filters. */
export interface InterceptorInFront {
  name: string;
  /** The class, when it is written in this project. */
  declaration?: ClassDeclaration;
  /** Where what it gives is written: its `intercept` method's id, or its name. */
  at: string;
  file?: string;
  /** Undefined when what it does with an error cannot be read. */
  steps?: readonly PipeStep[];
}

/** Every interceptor the application installs, by where it is installed. */
export interface InterceptorReading {
  globals: InterceptorInFront[];
  byClass: Map<ClassDeclaration, InterceptorInFront[]>;
  byMethod: Map<MethodDeclaration, InterceptorInFront[]>;
  /**
   * The `throw`s written inside an interceptor's `catchError(...)`: what it
   * gives in place of an error, read as such, and never a failure of the
   * interceptor's own.
   */
  mappingThrows: ReadonlySet<Node>;
}

/**
 * Installed interceptors known to leave an error alone: the framework's own
 * serializer, cache and upload interceptors. Any other installed one is
 * something this reader cannot open.
 */
const PASS_THROUGH: ReadonlySet<string> = new Set([
  'ClassSerializerInterceptor',
  'CacheInterceptor',
  'FileInterceptor',
  'FilesInterceptor',
  'FileFieldsInterceptor',
  'AnyFilesInterceptor',
  'NoFilesInterceptor',
]);

/** The packages those come from. */
const PASS_THROUGH_FROM = /^@nestjs\//;

/** What the RxJS functions read here are imported from. */
const RXJS = /^rxjs(\/|$)/;

/** The error `timeout()` raises unless it is told otherwise. */
const TIMEOUT_ERROR: Pick<Given, 'exception' | 'lineage'> = { exception: 'TimeoutError', lineage: ['TimeoutError', 'Error'] };

const bare = (node: Node): Node => {
  let at = node;
  while (Node.isAsExpression(at) || Node.isParenthesizedExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

/** Whether a name is one of RxJS's: imported from it, or written with nothing to say otherwise. */
const isRx = (node: Node, name: string): boolean => {
  if (!Node.isIdentifier(node)) return false;
  const named = classNamed(node as Identifier);
  return named.name === name && named.declaration === undefined && (named.module === undefined || RXJS.test(named.module));
};

/** `new X(...)` as the exception it builds, as a throw of it would be answered. */
const givenBy = (node: Node): Given | undefined => {
  const value = bare(node);
  if (!Node.isNewExpression(value)) return undefined;
  const callee = value.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;
  const named = classNamed(callee);
  const answer = answerOfClass(named, value.getArguments());
  return { exception: named.name, ...answer, line: lineOf(value) };
};

/** The value a function hands back: its expression body, or a block's one `return`. */
const returnedBy = (fn: Node): Node | undefined => {
  const value = bare(fn);
  if (!Node.isArrowFunction(value) && !Node.isFunctionExpression(value)) return undefined;
  const body = value.getBody();
  if (!Node.isBlock(body)) return body;
  const statements = body.getStatements();
  const last = statements[statements.length - 1];
  return last !== undefined && Node.isReturnStatement(last) ? last.getExpression() : undefined;
};

/** Reads one `catchError(callback)`; undefined when its callback cannot be read at all. */
const rulesOfCatch = (callback: Node): CatchRule[] | undefined => {
  const fn = bare(callback);
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  const [parameter] = fn.getParameters();
  const aliases = new Set<Node>(parameter === undefined ? [] : [parameter]);
  const isError = (node: Node): boolean => {
    const value = bare(node);
    if (!Node.isIdentifier(value)) return false;
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return false;
    if (aliases.has(declaration)) return true;
    // `const error = err as HttpException`
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && Node.isIdentifier(bare(initializer)) && isError(initializer)) {
        aliases.add(declaration);
        return true;
      }
    }
    return false;
  };

  /** What an error handed on is: the same one, or a new exception. */
  const errorAnswer = (value: Node | undefined): CatchAnswer => {
    if (value === undefined) return { kind: 'unread' };
    if (isError(value)) return { kind: 'rethrow' };
    const to = givenBy(value);
    return to === undefined ? { kind: 'unread' } : { kind: 'map', to };
  };

  /** What a returned observable gives: an error, a value, or one of two by an `instanceof` test. */
  const ofResult = (node: Node | undefined): CatchRule[] => {
    if (node === undefined) return [{ answer: { kind: 'unread' } }];
    const value = bare(node);
    if (Node.isConditionalExpression(value)) {
      const only = instanceOfTest(value.getCondition(), isError);
      const yes = ofResult(value.getWhenTrue());
      if (only === undefined || yes.length !== 1 || yes[0]?.only !== undefined) return [{ answer: { kind: 'unread' } }];
      return [{ only, answer: (yes[0] as CatchRule).answer }, ...ofResult(value.getWhenFalse())];
    }
    if (isRx(value, 'EMPTY')) return [{ answer: { kind: 'swallow' } }];
    if (Node.isCallExpression(value)) {
      const callee = value.getExpression();
      if (isRx(callee, 'of') || isRx(callee, 'from')) return [{ answer: { kind: 'swallow' } }];
      if (isRx(callee, 'throwError')) {
        const [argument] = value.getArguments();
        if (argument === undefined) return [{ answer: { kind: 'unread' } }];
        const fn = bare(argument);
        const thrown = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? returnedBy(fn) : fn;
        return [{ answer: errorAnswer(thrown) }];
      }
    }
    return [{ answer: { kind: 'unread' } }];
  };

  /** A run of statements, as the branches it ends in; undefined where one cannot be read. */
  const ofStatements = (statements: readonly Node[]): CatchRule[] | undefined => {
    const rules: CatchRule[] = [];
    for (const statement of statements) {
      if (Node.isReturnStatement(statement)) return [...rules, ...ofResult(statement.getExpression())];
      if (Node.isThrowStatement(statement)) return [...rules, { answer: errorAnswer(statement.getExpression()) }];
      if (Node.isIfStatement(statement)) {
        const only = instanceOfTest(statement.getExpression(), isError);
        const then = statement.getThenStatement();
        const branch = ofStatements(Node.isBlock(then) ? then.getStatements() : [then]);
        if (only === undefined || branch === undefined || branch.some((rule) => rule.only !== undefined)) return undefined;
        rules.push(...branch.map((rule) => ({ only, answer: rule.answer })));
        const otherwise = statement.getElseStatement();
        if (otherwise !== undefined) {
          const rest = ofStatements(Node.isBlock(otherwise) ? otherwise.getStatements() : [otherwise]);
          return rest === undefined ? undefined : [...rules, ...rest];
        }
        continue;
      }
      // A log line, a counter, a name for the error: nothing a caller gets.
      if (Node.isExpressionStatement(statement) || Node.isVariableStatement(statement)) continue;
      return undefined;
    }
    // A callback that can end without giving anything hands RxJS `undefined`.
    return undefined;
  };

  const body = fn.getBody();
  return Node.isBlock(body) ? ofStatements(body.getStatements()) : ofResult(body);
};

/** `timeout(5000)`, or `timeout({ each, with: () => throwError(() => new X()) })`: what it raises. */
const raisedBy = (call: Node): Given | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const [argument] = call.getArguments();
  const options = argument === undefined ? undefined : bare(argument);
  const line = lineOf(call);
  if (options === undefined || !Node.isObjectLiteralExpression(options)) return { ...TIMEOUT_ERROR, line };
  const given = options.getProperty('with');
  if (given === undefined) return { ...TIMEOUT_ERROR, line };
  if (!Node.isPropertyAssignment(given)) return undefined;
  const thrown = returnedBy(given.getInitializerOrThrow());
  const value = thrown === undefined ? undefined : bare(thrown);
  if (value === undefined || !Node.isCallExpression(value) || !isRx(value.getExpression(), 'throwError')) return undefined;
  const [inner] = value.getArguments();
  const built = inner === undefined ? undefined : returnedBy(inner) ?? inner;
  return built === undefined ? undefined : givenBy(built);
};

/** Ways an `intercept` can handle an error that are not a `catchError(...)`. */
const handlesOtherwise = (body: Node): boolean =>
  body.getDescendantsOfKind(SyntaxKind.TryStatement).some((statement) => statement.getCatchClause() !== undefined) ||
  body.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'catch') return true;
    return isRx(callee, 'onErrorResumeNext') || isRx(callee, 'onErrorResumeNextWith');
  });

/** What an `intercept` body does with an error, as far as it can be read. */
export interface InterceptPipe {
  /** Undefined when a step cannot be read at all, so no error through it can be answered. */
  steps?: PipeStep[];
  /** Why not everything could be read, for the row that says so. */
  why?: string;
  /** The `throw`s inside its `catchError(...)` callbacks. */
  mappingThrows: Node[];
}

/**
 * Reads an `intercept` body: each `catchError(...)` and `timeout(...)` in the
 * order written. A step that cannot be read at all leaves every error through
 * the interceptor unread; a catch with one branch that cannot be read still
 * answers the errors its other branches take.
 */
export const pipeOfIntercept = (body: Node): InterceptPipe => {
  const steps: PipeStep[] = [];
  const mappingThrows: Node[] = [];
  let readable = true;
  const whys: string[] = [];
  const cannot = (reason: string, whole: boolean): void => {
    whys.push(reason);
    if (whole) readable = false;
  };
  if (handlesOtherwise(body)) cannot('it handles errors other than with catchError(...)', true);
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (isRx(callee, 'timeout')) {
      const raises = raisedBy(call);
      if (raises === undefined) cannot('what its timeout(...) raises cannot be read', true);
      else steps.push({ kind: 'timeout', raises });
      continue;
    }
    if (!isRx(callee, 'catchError')) continue;
    const [callback] = call.getArguments();
    const rules = callback === undefined ? undefined : rulesOfCatch(callback);
    mappingThrows.push(...call.getDescendantsOfKind(SyntaxKind.ThrowStatement));
    if (rules === undefined) {
      cannot('what its catchError(...) gives cannot be read', true);
      continue;
    }
    if (rules.some((rule) => rule.answer.kind === 'unread')) cannot('what its catchError(...) gives cannot be read', false);
    steps.push({ kind: 'catch', rules });
  }
  const [why] = whys;
  return { ...(readable ? { steps } : {}), ...(why === undefined ? {} : { why }), mappingThrows };
};

/** Where an unreadable interceptor is reported. */
interface Unread {
  file: string;
  line: number;
  name: string;
  why: string;
}

/** Reads every interceptor the application installs, saying which cannot be read. */
export const readInterceptors = (ctx: NestExtractContext): InterceptorReading => {
  const read = new Map<ClassDeclaration, InterceptorInFront>();
  const mappingThrows = new Set<Node>();
  const reported = new Set<string>();
  const unread = (row: Unread): void => {
    const key = `${row.file}\u0000${row.line}\u0000${row.name}`;
    if (reported.has(key)) return;
    reported.add(key);
    ctx.report({
      file: row.file,
      line: row.line,
      reason: 'fails-interceptor-unread',
      level: 'info',
      message: `${row.name} handles the errors of the routes behind it in a way that cannot be read (${row.why}); what they fail with is assumed.`,
      hint: 'Map an error in catchError(...) with throwError(() => new SomeException()), a throw, a rethrow (throwError(() => err)) or a value (of(...)).',
      symbol: row.name,
    });
  };

  const ofClass = (declaration: ClassDeclaration, depth = 0): InterceptorInFront => {
    const known = read.get(declaration);
    if (known !== undefined) return known;
    const name = declaration.getName() ?? 'interceptor';
    const file = ctx.fileOf(declaration);
    const method = declaration.getInstanceMethod('intercept');
    const body = method?.getBody();
    let found: InterceptorInFront;
    if (method === undefined || body === undefined) {
      // Inherited: from a class written here, or one the framework ships.
      const base = declaration.getExtends()?.getExpression();
      const named = base !== undefined && Node.isIdentifier(base) ? classNamed(base) : undefined;
      if (named?.declaration !== undefined && depth < 4) {
        found = { ...ofClass(named.declaration, depth + 1), name, declaration };
      } else if (named !== undefined && PASS_THROUGH.has(named.name)) {
        found = { name, declaration, at: ctx.classIdOf(declaration) ?? name, file, steps: [] };
      } else {
        unread({ file, line: lineOf(declaration), name, why: 'its intercept() is not written in this class' });
        found = { name, declaration, at: ctx.classIdOf(declaration) ?? name, file };
      }
    } else {
      const pipe = pipeOfIntercept(body);
      for (const thrown of pipe.mappingThrows) mappingThrows.add(thrown);
      if (pipe.why !== undefined) unread({ file, line: lineOf(method), name, why: pipe.why });
      const at = ctx.methodIdOf(method) ?? ctx.classIdOf(declaration) ?? name;
      found = { name, declaration, at, file, ...(pipe.steps === undefined ? {} : { steps: pipe.steps }) };
    }
    read.set(declaration, found);
    return found;
  };

  /** An interceptor named at a registration: a class written here, one the framework ships, or one this cannot open. */
  const ofRef = (ref: ClassRef, application: WrapperApplication): InterceptorInFront => {
    if (ref.kind === 'local') return ofClass(ref.declaration);
    const name = ref.kind === 'external' ? ref.typeName : ref.text.replace(/\(.*$/s, '');
    if (PASS_THROUGH.has(name) && (ref.kind === 'unknown' || PASS_THROUGH_FROM.test(ref.package))) return { name, at: name, steps: [] };
    unread({
      file: application.file,
      line: application.wrapper.line,
      name,
      why: ref.kind === 'external' ? `it comes from ${ref.package}` : 'it does not name a class',
    });
    return { name, at: name };
  };

  const ofApplications = (applications: readonly WrapperApplication[]): InterceptorInFront[] =>
    applications.filter((application) => application.layer === 'interceptor').map((application) => ofRef(application.wrapper.ref, application));

  const globals = ofApplications(ctx.wrapping.globals);
  const byClass = new Map<ClassDeclaration, InterceptorInFront[]>();
  const byMethod = new Map<MethodDeclaration, InterceptorInFront[]>();
  for (const [declaration, applications] of ctx.wrapping.byClass) {
    const found = ofApplications(applications);
    if (found.length > 0) byClass.set(declaration, found);
  }
  for (const [method, applications] of ctx.wrapping.byMethod) {
    const found = ofApplications(applications);
    if (found.length > 0) byMethod.set(method, found);
  }
  return { globals, byClass, byMethod, mappingThrows };
};

/**
 * The interceptors around one way in, outermost first: the application's,
 * then its controller's, then its handler's, each in the order written.
 */
export const interceptorsFor = (reading: InterceptorReading, entry: EntryRecord): InterceptorInFront[] => {
  if (entry.outsideApplication === true) return [];
  const onClass = entry.handlerClass === undefined ? [] : (reading.byClass.get(entry.handlerClass) ?? []);
  const onMethod = entry.handlerMethod === undefined ? [] : (reading.byMethod.get(entry.handlerMethod) ?? []);
  return [...reading.globals, ...onClass, ...onMethod];
};

/** The failure an interceptor gives in place of an error, written where it writes it. */
const givenSite = (given: Given, interceptor: InterceptorInFront): Site => ({
  failure: {
    ...(given.status === undefined ? {} : { status: given.status }),
    exception: given.exception,
    at: interceptor.at,
    ...(interceptor.file === undefined ? {} : { file: interceptor.file }),
    line: given.line,
    source: 'interceptor',
    ...(given.assumed === true ? { assumed: true as const } : {}),
    ...(given.declared === undefined ? {} : { declared: given.declared }),
  },
  lineage: given.lineage,
  ...(given.own === undefined ? {} : { own: given.own }),
});

/** A failure whose way out could not be read: its status is no longer one anything on the path wrote. */
const assumedSite = (site: Site): Site => ({
  ...site,
  unread: true,
  failure: site.failure.status === undefined ? site.failure : { ...site.failure, assumed: true },
  ...(site.choices === undefined
    ? {}
    : { choices: site.choices.map((choice) => ({ ...choice, ...(choice.status === undefined ? {} : { assumed: true as const }), unread: true as const })) }),
});

const ruleFor = (rules: readonly CatchRule[], lineage: readonly string[]): CatchRule | undefined =>
  rules.find((rule) => rule.only === undefined || lineage.includes(rule.only));

/**
 * What one `catchError(...)` makes of a failure: the same, another, or none.
 * A helper's choices (P90) are each answered on their own: those it hands on
 * stay the helper's, those it maps are failures of the interceptor, and those
 * it swallows are gone.
 */
const throughCatch = (site: Site, rules: readonly CatchRule[], interceptor: InterceptorInFront): Site[] => {
  if (site.choices !== undefined) {
    const kept: ChoiceSite[] = [];
    const given: Site[] = [];
    for (const choice of site.choices) {
      const answer = ruleFor(rules, choice.lineage)?.answer ?? { kind: 'rethrow' };
      if (answer.kind === 'rethrow') kept.push(choice);
      else if (answer.kind === 'unread') kept.push({ ...choice, ...(choice.status === undefined ? {} : { assumed: true as const }), unread: true });
      else if (answer.kind === 'map') given.push(givenSite(answer.to, interceptor));
    }
    return [...(kept.length === 0 ? [] : [{ ...site, choices: kept }]), ...given];
  }
  const answer = ruleFor(rules, site.lineage)?.answer ?? { kind: 'rethrow' };
  if (answer.kind === 'rethrow') return [site];
  if (answer.kind === 'swallow') return [];
  if (answer.kind === 'unread') return [assumedSite(site)];
  return [givenSite(answer.to, interceptor)];
};

/** A failure through one interceptor's pipe, from one of its steps on. */
const throughOne = (site: Site, interceptor: InterceptorInFront, from = 0): Site[] => {
  if (interceptor.steps === undefined) return [assumedSite(site)];
  let sites = [site];
  for (const step of interceptor.steps.slice(from)) {
    if (step.kind === 'catch') sites = sites.flatMap((each) => throughCatch(each, step.rules, interceptor));
  }
  return sites;
};

/**
 * What the filters get for one way a route fails, through the interceptors
 * around it (outermost first), from the innermost of the first `upTo` out: a
 * failure raised inside all of them passes all of them, one an interceptor
 * raises itself only those outside it.
 */
export const throughInterceptors = (
  site: Site,
  interceptors: readonly InterceptorInFront[],
  upTo = interceptors.length,
): Site[] => {
  let sites = [site];
  for (let at = Math.min(upTo, interceptors.length) - 1; at >= 0; at -= 1) {
    const interceptor = interceptors[at] as InterceptorInFront;
    sites = sites.flatMap((each) => throughOne(each, interceptor));
  }
  return sites;
};

/**
 * What the interceptors around a route raise themselves: a `timeout()`'s
 * error, through the steps after it and the interceptors outside it.
 */
export const raisedByInterceptors = (interceptors: readonly InterceptorInFront[]): Site[] =>
  interceptors.flatMap((interceptor, at) =>
    (interceptor.steps ?? []).flatMap((step, index) =>
      step.kind !== 'timeout'
        ? []
        : throughOne(givenSite(step.raises, interceptor), interceptor, index + 1).flatMap((site) =>
            throughInterceptors(site, interceptors, at),
          ),
    ),
  );

/** Where an interceptor that raises a failure of its own stands among those around a route; none outside it when it is not one of them. */
export const outsideOf = (interceptors: readonly InterceptorInFront[], declaration: ClassDeclaration | undefined): number => {
  const at = declaration === undefined ? -1 : interceptors.findIndex((interceptor) => interceptor.declaration === declaration);
  return at === -1 ? 0 : at;
};
