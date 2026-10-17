import { compareChoices, findDecorators, lineOf, type Failure, type FailureChoice } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type MethodDeclaration } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { NEST_COMMON } from '../index-classes.js';
import { resolveClassExpression } from '../util/resolve-class.js';
import type { WrapperRef } from '../bootstrap.js';
import type { EntryRecord } from '../wrapping/types.js';
import { classNamed, MOST_CHOICES, statusWritten } from './throws.js';

/*
 * What an exception filter answers a throw with (P87).
 *
 * A project's own error class may say it is a 404, but the framework answers
 * anything that is not one of its exceptions with a 500. What turns the 404
 * into the answer is a filter: one that catches the class and hands the
 * response the status it reads off the exception. So a route's failures are
 * read through the filters in front of it, the way the framework picks one:
 * the handler's first, then its controller's, then the application's, and the
 * first whose `@Catch(...)` takes the exception decides.
 *
 * Filters are not drawn in the graph; they only change what a throw is
 * answered with.
 */

/** What a filter's `catch()` hands the response as its status. */
export type FilterAnswer =
  /** Always the same status, whatever was caught. */
  | { kind: 'fixed'; status: number }
  /**
   * The status the exception carries (`exception.status`, `getStatus()`),
   * and `fallback` where it carries none or is not of the class named in
   * `only` (`exception instanceof HttpException ? exception.getStatus() : 500`).
   */
  | { kind: 'fromException'; fallback?: number; only?: string }
  /** Handed back to the framework (`super.catch(...)`): its own answer stands. */
  | { kind: 'framework' }
  /** Something this reader cannot follow. */
  | { kind: 'unread' };

/** One filter that can answer for a route. */
export interface FilterInFront {
  name: string;
  /** The classes its `@Catch(...)` names; none catches everything. */
  catches: readonly string[];
  answer: FilterAnswer;
}

/** Every filter the application installs, by where it is installed. */
export interface FilterReading {
  globals: FilterInFront[];
  byClass: Map<ClassDeclaration, FilterInFront[]>;
  byMethod: Map<MethodDeclaration, FilterInFront[]>;
}

/** One way a route fails, with what a filter needs to answer it. */
export interface Site {
  failure: Failure;
  /** The thrown class and every class it extends, nearest first. */
  lineage: readonly string[];
  /** The status the exception carries itself. */
  own?: number;
  /**
   * What a helper can choose to throw (P90), each answered through the
   * filters on its own, since a filter may catch one of them and not another.
   */
  choices?: readonly ChoiceSite[];
}

/** One exception a helper can give, as a filter sees it (P90). */
export interface ChoiceSite {
  exception: string;
  status?: number;
  assumed?: true;
  lineage: readonly string[];
  own?: number;
}

/** The calls a response is given its status with: Express, Fastify, the HTTP adapter, plain Node. */
const STATUS_CALLS: ReadonlyMap<string, number> = new Map([
  ['status', 0],
  ['code', 0],
  ['sendStatus', 0],
  ['writeHead', 0],
  // `httpAdapter.reply(response, body, status)`
  ['reply', 2],
]);

/** The names an exception keeps its status under. */
const STATUS_NAMES: ReadonlySet<string> = new Set(['status', 'statusCode']);

const UNREAD: FilterAnswer = { kind: 'unread' };

const bare = (node: Node): Node => {
  let at = node;
  while (Node.isAsExpression(at) || Node.isParenthesizedExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) {
    at = at.getExpression();
  }
  return at;
};

/** How much one answer is followed through names before it is called unreadable. */
const MAX_DEPTH = 4;

/**
 * Answers that can each be the one given, as one: all the same status; or the
 * exception's own with one status for the rest. Anything else is a choice
 * this reader would be guessing at.
 */
const together = (answers: readonly FilterAnswer[], fallsBack = false): FilterAnswer => {
  if (answers.length === 0 || answers.some((answer) => answer.kind === 'unread' || answer.kind === 'framework')) return UNREAD;
  const fixed = new Set(answers.flatMap((answer) => (answer.kind === 'fixed' ? [answer.status] : [])));
  const read = answers.filter((answer): answer is Extract<FilterAnswer, { kind: 'fromException' }> => answer.kind === 'fromException');
  if (read.length === 0) return fixed.size === 1 ? (answers[0] as FilterAnswer) : UNREAD;
  // Two places that set a status, one from the exception and one fixed, are a
  // choice between them; only a test of the exception's class (`only`) or an
  // operator that falls back (`??`, `||`) says which applies when.
  if (!fallsBack && fixed.size > 0 && read.some((answer) => answer.only === undefined)) return UNREAD;
  for (const answer of read) if (answer.fallback !== undefined) fixed.add(answer.fallback);
  const only = new Set(read.map((answer) => answer.only));
  if (fixed.size > 1 || only.size > 1) return UNREAD;
  const [fallback] = fixed;
  const [named] = only;
  return { kind: 'fromException', ...(fallback === undefined ? {} : { fallback }), ...(named === undefined ? {} : { only: named }) };
};

/** `exception instanceof Name` with the exception on the left. */
const instanceOfTest = (condition: Node, isException: (node: Node) => boolean): string | undefined => {
  const test = bare(condition);
  if (!Node.isBinaryExpression(test) || test.getOperatorToken().getKind() !== SyntaxKind.InstanceOfKeyword) return undefined;
  const right = test.getRight();
  return isException(test.getLeft()) && Node.isIdentifier(right) ? classNamed(right).name : undefined;
};

/** The class an `if (exception instanceof X)` around a statement narrows the exception to. */
const narrowedBy = (node: Node, body: Node, isException: (node: Node) => boolean): string | undefined => {
  for (let at = node.getParent(); at !== undefined && at !== body; at = at.getParent()) {
    const parent = at.getParent();
    if (parent !== undefined && Node.isIfStatement(parent) && parent.getThenStatement() === at) {
      return instanceOfTest(parent.getExpression(), isException);
    }
  }
  return undefined;
};

/** Reads one filter's `catch(exception, host)` body. */
export const answerOfCatch = (method: MethodDeclaration): FilterAnswer => {
  const body = method.getBody();
  const [parameter] = method.getParameters();
  if (body === undefined || parameter === undefined) return UNREAD;

  const aliases = new Set<Node>([parameter]);
  const isException = (node: Node): boolean => {
    const value = bare(node);
    if (!Node.isIdentifier(value)) return false;
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return false;
    if (aliases.has(declaration)) return true;
    // `const error = exception as DomainError`
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && Node.isIdentifier(bare(initializer)) && isException(initializer)) {
        aliases.add(declaration);
        return true;
      }
    }
    return false;
  };

  /** A status read off the exception inside `if (exception instanceof X)` is read for X only. */
  const narrowedAt = (answer: FilterAnswer, at: Node): FilterAnswer => {
    if (answer.kind !== 'fromException' || answer.only !== undefined) return answer;
    const only = narrowedBy(at, body, isException);
    return only === undefined ? answer : { ...answer, only };
  };

  const classify = (node: Node, depth: number): FilterAnswer => {
    const value = bare(node);
    const status = statusWritten(value);
    if (status !== undefined) return { kind: 'fixed', status };
    if (depth > MAX_DEPTH) return UNREAD;
    // `exception.status`, `exception.statusCode`
    if (Node.isPropertyAccessExpression(value) && STATUS_NAMES.has(value.getName()) && isException(value.getExpression())) {
      return { kind: 'fromException' };
    }
    // `exception.getStatus()`
    if (Node.isCallExpression(value)) {
      const callee = value.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'getStatus' && isException(callee.getExpression())) {
        return { kind: 'fromException' };
      }
      return UNREAD;
    }
    // `exception.status ?? 500`
    if (Node.isBinaryExpression(value)) {
      const operator = value.getOperatorToken().getKind();
      if (operator !== SyntaxKind.QuestionQuestionToken && operator !== SyntaxKind.BarBarToken) return UNREAD;
      return together([classify(value.getLeft(), depth + 1), classify(value.getRight(), depth + 1)], true);
    }
    // `exception instanceof HttpException ? exception.getStatus() : 500`
    if (Node.isConditionalExpression(value)) {
      const narrowed = instanceOfTest(value.getCondition(), isException);
      const yes = classify(value.getWhenTrue(), depth + 1);
      const answer = together([
        yes.kind === 'fromException' && narrowed !== undefined ? { ...yes, only: narrowed } : yes,
        classify(value.getWhenFalse(), depth + 1),
      ]);
      return answer;
    }
    if (Node.isIdentifier(value)) return classifyName(value, depth + 1);
    return UNREAD;
  };

  /** A name holding the status: a constant, a variable set in branches, a destructured field. */
  const classifyName = (name: Node, depth: number): FilterAnswer => {
    const declaration = name.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return UNREAD;
    // `const { status } = exception`, `const { statusCode = 500 } = exception`
    if (Node.isBindingElement(declaration)) {
      const holder = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const from = holder?.getInitializer();
      const key = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
      if (from === undefined || !isException(from) || !STATUS_NAMES.has(key)) return UNREAD;
      const fallback = statusWritten(declaration.getInitializer());
      return { kind: 'fromException', ...(fallback === undefined ? {} : { fallback }) };
    }
    if (!Node.isVariableDeclaration(declaration)) return UNREAD;
    // `let status = 500; if (exception instanceof HttpException) status = exception.getStatus();`
    const values: FilterAnswer[] = [];
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) values.push(classify(initializer, depth));
    for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const target = assignment.getLeft();
      if (!Node.isIdentifier(target) || target.getSymbol()?.getDeclarations()[0] !== declaration) continue;
      values.push(narrowedAt(classify(assignment.getRight(), depth), assignment));
    }
    return together(values);
  };

  const answers: FilterAnswer[] = [];
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const position = STATUS_CALLS.get(callee.getName());
    const argument = position === undefined ? undefined : call.getArguments()[position];
    if (argument === undefined || isException(callee.getExpression())) continue;
    answers.push(narrowedAt(classify(argument, 0), call));
  }
  if (answers.length > 0) return together(answers);
  const handsBack = body
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      const callee = call.getExpression();
      return Node.isPropertyAccessExpression(callee) && callee.getName() === 'catch' && callee.getExpression().getKind() === SyntaxKind.SuperKeyword;
    });
  return handsBack ? { kind: 'framework' } : UNREAD;
};

/** Where an unreadable answer is reported, so a reader can open it. */
interface Unread {
  file: string;
  line: number;
  name: string;
  why: string;
}

/** Reads every filter the application installs, saying which answers cannot be read. */
export const readFilters = (ctx: NestExtractContext): FilterReading => {
  const read = new Map<ClassDeclaration, FilterInFront>();
  const reported = new Set<string>();
  const unread = (row: Unread): void => {
    const key = `${row.file}\u0000${row.line}\u0000${row.name}`;
    if (reported.has(key)) return;
    reported.add(key);
    ctx.report({
      file: row.file,
      line: row.line,
      reason: 'fails-filter-unread',
      level: 'info',
      message: `${row.name} answers the exceptions it catches in a way that cannot be read (${row.why}); the statuses behind it are assumed.`,
      hint: 'Hand the response a status written in the filter, or one read off the exception (exception.status, exception.getStatus()).',
      symbol: row.name,
    });
  };
  const everything = (name: string): FilterInFront => ({ name, catches: [], answer: UNREAD });

  const ofClass = (declaration: ClassDeclaration): FilterInFront => {
    const known = read.get(declaration);
    if (known !== undefined) return known;
    const name = declaration.getName() ?? 'filter';
    const caught = findDecorators(declaration, { names: ['Catch'], fromModules: NEST_COMMON })[0];
    const catches = (caught?.getArguments() ?? []).map((argument) =>
      Node.isIdentifier(argument) ? classNamed(argument).name : argument.getText(),
    );
    const method = declaration.getInstanceMethod('catch');
    const answer: FilterAnswer =
      method !== undefined
        ? answerOfCatch(method)
        : // A filter with no `catch` of its own is the framework's base filter.
          declaration.getExtends()?.getExpression().getText() === 'BaseExceptionFilter'
          ? { kind: 'framework' }
          : UNREAD;
    if (answer.kind === 'unread') {
      unread({
        file: ctx.fileOf(declaration),
        line: lineOf(method ?? declaration),
        name,
        why: method === undefined ? 'its catch() is not written in this class' : 'the status it sets is not a number, a constant or the exception\'s own',
      });
    }
    const filter: FilterInFront = { name, catches, answer };
    read.set(declaration, filter);
    return filter;
  };

  /** A filter named at a registration: a class written here, or one this reader cannot open. */
  const ofRef = (ref: WrapperRef['ref'], file: string, line: number, text: string): FilterInFront => {
    if (ref.kind === 'local') return ofClass(ref.declaration);
    const name = ref.kind === 'external' ? ref.typeName : text;
    unread({ file, line, name, why: ref.kind === 'external' ? `it comes from ${ref.package}` : 'it does not name a class' });
    return everything(name);
  };

  const bootstrapFile = ctx.bootstrap.file ?? 'main.ts';
  const globals: FilterInFront[] = [];
  // Providers are registered while the modules load, before the entry file installs its own.
  for (const info of ctx.modules.all()) {
    for (const provider of [...info.providers, ...(info.dynamicProviders ?? [])]) {
      if (provider.token !== 'APP_FILTER') continue;
      if (provider.declaration !== undefined) globals.push(ofClass(provider.declaration));
      else {
        const ref = provider.installed === undefined
          ? ({ kind: 'unknown', text: provider.token } as const)
          : ({ kind: 'external', typeName: provider.installed.typeName, package: provider.installed.package } as const);
        globals.push(ofRef(ref, provider.file, provider.line, provider.token));
      }
    }
  }
  for (const wrapper of ctx.bootstrap.filters) globals.push(ofRef(wrapper.ref, bootstrapFile, wrapper.line, wrapper.text));
  for (const dynamic of ctx.bootstrap.dynamicFilters) {
    globals.push(ofRef({ kind: 'unknown', text: dynamic.text }, bootstrapFile, dynamic.line, dynamic.text));
  }

  const decorated = (holder: ClassDeclaration | MethodDeclaration): FilterInFront[] =>
    findDecorators(holder, { names: ['UseFilters'], fromModules: NEST_COMMON }).flatMap((decorator) =>
      decorator.getArguments().map((argument) => {
        const named = Node.isNewExpression(argument) ? argument.getExpression() : argument;
        return ofRef(resolveClassExpression(named), ctx.fileOf(holder), lineOf(argument), argument.getText());
      }),
    );
  const byClass = new Map<ClassDeclaration, FilterInFront[]>();
  const byMethod = new Map<MethodDeclaration, FilterInFront[]>();
  for (const indexed of ctx.classes.all()) {
    const own = decorated(indexed.declaration);
    if (own.length > 0) byClass.set(indexed.declaration, own);
    for (const method of indexed.declaration.getMethods()) {
      const onMethod = decorated(method);
      if (onMethod.length > 0) byMethod.set(method, onMethod);
    }
  }
  return { globals, byClass, byMethod };
};

/**
 * The filters that can answer for one way in, in the order the framework asks
 * them: the handler's, then its controller's, then the application's, each
 * list last-registered first.
 */
export const filtersFor = (reading: FilterReading, entry: EntryRecord): FilterInFront[] => {
  if (entry.outsideApplication === true) return [];
  const onMethod = entry.handlerMethod === undefined ? [] : (reading.byMethod.get(entry.handlerMethod) ?? []);
  const onClass = entry.handlerClass === undefined ? [] : (reading.byClass.get(entry.handlerClass) ?? []);
  return [...onMethod].reverse().concat([...onClass].reverse(), [...reading.globals].reverse());
};

const catches = (filter: FilterInFront, lineage: readonly string[]): boolean =>
  filter.catches.length === 0 || filter.catches.some((name) => lineage.includes(name));

/**
 * What the caller gets for one way a route fails, through the filters in
 * front of it.
 *
 * A filter that sets a fixed status answers with it; one that reads the
 * exception's own answers with what the exception carries, or its fallback;
 * one that cannot be read leaves the exception's status, assumed. With no
 * filter, the framework's answer stands as the body reader gave it.
 */
export const throughFilters = (site: Site, filters: readonly FilterInFront[]): Failure => {
  if (site.choices !== undefined) return throughFiltersChosen(site, site.choices, filters);
  const filter = filters.find((each) => catches(each, site.lineage));
  if (filter === undefined || filter.answer.kind === 'framework') return site.failure;
  const { status: _status, assumed: _assumed, declared: _declared, ...rest } = site.failure;
  const answer = filter.answer;
  if (answer.kind === 'fixed') return { ...rest, status: answer.status };
  if (answer.kind === 'fromException') {
    const own = answer.only === undefined || site.lineage.includes(answer.only) ? site.own : undefined;
    const status = own ?? answer.fallback;
    return status === undefined ? site.failure : { ...rest, status };
  }
  const status = site.own ?? site.failure.status;
  return status === undefined ? site.failure : { ...rest, status, assumed: true };
};

const choiceKey = (choice: FailureChoice): string => `${choice.exception}\u0000${choice.status ?? ''}\u0000${choice.assumed === true ? 1 : ''}`;

/**
 * What the caller gets for a throw whose exception a helper chooses (P90):
 * every choice through the filters, each once by status then exception, and a
 * status for the throw only where every choice ends in the same one.
 */
const throughFiltersChosen = (site: Site, choices: readonly ChoiceSite[], filters: readonly FilterInFront[]): Failure => {
  const { status: _status, assumed: _assumed, declared: _declared, chosenFrom: _chosen, ...rest } = site.failure;
  const byKey = new Map<string, FailureChoice>();
  for (const choice of choices) {
    const answered = throughFilters(
      {
        failure: {
          ...rest,
          exception: choice.exception,
          ...(choice.status === undefined ? {} : { status: choice.status }),
          ...(choice.assumed === true ? { assumed: true as const } : {}),
        },
        lineage: choice.lineage,
        ...(choice.own === undefined ? {} : { own: choice.own }),
      },
      filters,
    );
    const one: FailureChoice = {
      exception: choice.exception,
      ...(answered.status === undefined ? {} : { status: answered.status }),
      ...(answered.assumed === true ? { assumed: true as const } : {}),
    };
    byKey.set(choiceKey(one), one);
  }
  const chosenFrom = [...byKey.values()].sort(compareChoices).slice(0, MOST_CHOICES);
  const [first] = chosenFrom;
  const agreed = first?.status !== undefined && byKey.size <= MOST_CHOICES && chosenFrom.every((choice) => choice.status === first.status);
  return {
    ...(agreed ? { status: first.status } : {}),
    ...rest,
    ...(agreed && chosenFrom.every((choice) => choice.assumed === true) ? { assumed: true as const } : {}),
    chosenFrom,
  };
};
