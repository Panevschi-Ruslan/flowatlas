import { lineOf, type AnswerWrap } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type MethodDeclaration, type Type } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { bare, isRx, returnedBy, type InterceptorInFront } from './interceptors.js';

/*
 * What the interceptors around a route do to its answer on the way out
 * (P400), where the error side of the same interceptors is `interceptors.ts`'s.
 *
 * An interceptor's `next.handle().pipe(...)` sees the handler's answer before
 * the caller does. A `map((data) => ({ success: true, data }))` hands the
 * caller an envelope with the answer inside; the framework's
 * `ClassSerializerInterceptor` leaves out every field the answer's class marks
 * `@Exclude()`. A client reading the answer meets that shape, not the one the
 * handler declares, so `check_contract` and `answer-field-never-returned`
 * compare its reads against it. What cannot be read - an operator that swaps
 * the answer for another stream, a `map` whose result is worked out by a call,
 * an interceptor from a package - is said, and the comparison held back.
 */

/** The serializer that leaves out the fields a class marks `@Exclude()`. */
const SERIALIZER = 'ClassSerializerInterceptor';

/** Interceptors the framework ships that hand the answer on as it is. */
const UNCHANGED: ReadonlySet<string> = new Set([
  'CacheInterceptor',
  'FileInterceptor',
  'FilesInterceptor',
  'FileFieldsInterceptor',
  'AnyFilesInterceptor',
  'NoFilesInterceptor',
]);

/** RxJS operators that put another value or stream in the answer's place, which this does not follow. */
const SWAPPING = ['switchMap', 'mergeMap', 'concatMap', 'exhaustMap', 'flatMap', 'scan', 'reduce', 'mapTo', 'toArray'] as const;

/** The decorator a field is left out of the answer by. */
const EXCLUDE = 'Exclude';

/** A class's own name and those of the classes it extends, nearest first. */
const lineageOf = (declaration: ClassDeclaration, depth = 0): string[] => {
  const own = declaration.getName() ?? '';
  if (depth > 4) return [own];
  const base = declaration.getBaseClass();
  if (base !== undefined) return [own, ...lineageOf(base, depth + 1)];
  const written = declaration.getExtends()?.getExpression();
  return written === undefined ? [own] : [own, written.getText()];
};

/** The `intercept` method a class runs: its own, or the nearest class it extends that writes one. */
const interceptOf = (declaration: ClassDeclaration, depth = 0): MethodDeclaration | undefined => {
  const own = declaration.getInstanceMethod('intercept');
  if (own !== undefined || depth > 4) return own;
  const base = declaration.getBaseClass();
  return base === undefined ? undefined : interceptOf(base, depth + 1);
};

/**
 * What one `intercept` body does to the answer: nothing (a `tap`, a
 * `catchError`, a `timeout`), an envelope a `map` builds around it, or why
 * that is not read.
 */
export const answerShapeOf = (body: Node): Pick<AnswerWrap, 'envelope' | 'unread'> | undefined => {
  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  const swapping = calls.find((call) => SWAPPING.some((name) => isRx(call.getExpression(), name)));
  if (swapping !== undefined) return { unread: `${swapping.getExpression().getText()}(...) puts another value in the answer's place` };
  const maps = calls.filter((call) => isRx(call.getExpression(), 'map'));
  if (maps.length === 0) return undefined;
  if (maps.length > 1) return { unread: 'it maps the answer more than once' };
  const [callback] = maps[0]!.getArguments();
  const fn = callback === undefined ? undefined : bare(callback);
  if (fn === undefined || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn))) return { unread: 'its map(...) is handed a function not written there' };
  const [parameter] = fn.getParameters();
  const value = returnedBy(fn);
  const answer = value === undefined ? undefined : bare(value);
  if (parameter === undefined || answer === undefined) return { unread: 'what its map(...) answers is not read' };
  const isAnswer = (node: Node): boolean => {
    const at = bare(node);
    return Node.isIdentifier(at) && at.getSymbol()?.getDeclarations()[0] === parameter;
  };
  if (isAnswer(answer)) return undefined;
  if (!Node.isObjectLiteralExpression(answer)) return { unread: `its map(...) answers ${answer.getText().slice(0, 60)}, not an object written out` };
  const fields: string[] = [];
  let into: string | undefined;
  for (const property of answer.getProperties()) {
    if (Node.isPropertyAssignment(property)) {
      const name = property.getName();
      fields.push(name);
      if (isAnswer(property.getInitializerOrThrow())) into = name;
    } else if (Node.isShorthandPropertyAssignment(property)) {
      const name = property.getName();
      fields.push(name);
      if (property.getNameNode().getSymbol()?.getDeclarations()[0] === parameter || (property.getValueSymbol()?.getDeclarations()[0] ?? undefined) === parameter) into = name;
    } else {
      return { unread: 'its map(...) answers an object with a spread or a method' };
    }
  }
  if (into === undefined) return { unread: 'its map(...) answers an object that does not hold the answer by name' };
  return { envelope: { fields: [...new Set(fields)].sort(), into } };
};

/** A type with the promise, observable or list it comes in taken off. */
const unwrapped = (type: Type, depth = 0): Type => {
  if (depth > 4) return type;
  const element = type.getArrayElementType();
  if (element !== undefined) return unwrapped(element, depth + 1);
  const name = type.getSymbol()?.getName();
  const [arg] = type.getTypeArguments();
  if (arg !== undefined && (name === 'Promise' || name === 'Observable')) return unwrapped(arg, depth + 1);
  return type;
};

/** The fields of the class a handler answers that are marked `@Exclude()`, the classes it extends included. */
const excludedOf = (handler: MethodDeclaration | undefined): string[] => {
  if (handler === undefined) return [];
  const symbol = unwrapped(handler.getReturnType()).getSymbol();
  const declaration = symbol?.getDeclarations().find((each): each is ClassDeclaration => Node.isClassDeclaration(each));
  const out = new Set<string>();
  for (let at: ClassDeclaration | undefined = declaration, depth = 0; at !== undefined && depth < 5; at = at.getBaseClass(), depth += 1) {
    for (const property of at.getProperties()) if (property.getDecorators().some((decorator) => decorator.getName() === EXCLUDE)) out.add(property.getName());
  }
  return [...out].sort();
};

/**
 * What the interceptors around one route do to its answer, in the order the
 * answer passes through them (the handler's own first, the application's
 * last). An interceptor that hands the answer on as it is says nothing.
 */
export const answerWrapsFor = (ctx: NestExtractContext, interceptors: readonly InterceptorInFront[], handler: MethodDeclaration | undefined): AnswerWrap[] => {
  const wraps: AnswerWrap[] = [];
  for (const interceptor of [...interceptors].reverse()) {
    const lineage = interceptor.declaration === undefined ? [interceptor.name] : lineageOf(interceptor.declaration);
    if (lineage.includes(SERIALIZER)) {
      const excluded = excludedOf(handler);
      if (excluded.length > 0) wraps.push({ by: interceptor.name, excluded });
      continue;
    }
    if (lineage.some((name) => UNCHANGED.has(name))) continue;
    if (interceptor.declaration === undefined) {
      wraps.push({ by: interceptor.name, unread: 'it is not code of the project' });
      continue;
    }
    const method = interceptOf(interceptor.declaration);
    const body = method?.getBody();
    const place = { by: interceptor.name, file: ctx.fileOf(interceptor.declaration), line: lineOf(method ?? interceptor.declaration) };
    if (body === undefined) {
      wraps.push({ ...place, unread: 'its intercept() is not written in the project' });
      continue;
    }
    const shape = answerShapeOf(body);
    if (shape !== undefined) wraps.push({ ...place, ...shape });
  }
  return wraps;
};
