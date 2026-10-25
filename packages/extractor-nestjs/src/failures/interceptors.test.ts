import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { throughFilters, type FilterInFront, type Site } from './filters.js';
import {
  pipeOfIntercept,
  raisedByInterceptors,
  throughInterceptors,
  type InterceptorInFront,
  type PipeStep,
} from './interceptors.js';

// What whole routes fail with through their interceptors is the snapshot of
// fixtures/nest-fails-intercepted, whose README lists it by hand.

const interceptOf = (source: string) =>
  new Project({ useInMemoryFileSystem: true })
    .createSourceFile('a.ts', `import { catchError, throwError, of, EMPTY, timeout, TimeoutError } from 'rxjs';\n${source}`)
    .getFirstDescendantByKindOrThrow(SyntaxKind.MethodDeclaration)
    .getBodyOrThrow();

/** The rules of each step, as `[only, kind, exception?, status?]`. */
const stepsOf = (source: string) =>
  pipeOfIntercept(interceptOf(source)).steps?.map((step) =>
    step.kind === 'timeout'
      ? ['timeout', step.raises.exception, step.raises.status]
      : step.rules.map((rule) => [
          rule.only,
          rule.answer.kind,
          ...(rule.answer.kind === 'map' ? [rule.answer.to.exception, rule.answer.to.status] : []),
        ]),
  );

describe("what an interceptor's catchError gives (P207)", () => {
  it('reads a new exception, a rethrow and a value', () => {
    expect(
      stepsOf(`
      import { BadGatewayException } from '@nestjs/common';
      class A { intercept(c, next) { return next.handle().pipe(catchError(() => throwError(() => new BadGatewayException()))); } }`),
    ).toEqual([[[undefined, 'map', 'BadGatewayException', 502]]]);
    expect(stepsOf(`class A { intercept(c, next) { return next.handle().pipe(catchError((err) => throwError(() => err))); } }`)).toEqual([
      [[undefined, 'rethrow']],
    ]);
    expect(stepsOf(`class A { intercept(c, next) { return next.handle().pipe(catchError((e) => { throw e; })); } }`)).toEqual([
      [[undefined, 'rethrow']],
    ]);
    expect(stepsOf(`class A { intercept(c, next) { return next.handle().pipe(catchError(() => of(null)), catchError(() => EMPTY)); } }`)).toEqual([
      [[undefined, 'swallow']],
      [[undefined, 'swallow']],
    ]);
  });

  it('reads a branch per instanceof test, in a conditional or in an if, and a throw in the callback', () => {
    expect(
      stepsOf(`
      import { ConflictException, NotFoundException, HttpException } from '@nestjs/common';
      class Taken extends Error {}
      class Missing extends Error {}
      class A {
        intercept(c, next) {
          return next.handle().pipe(
            catchError((err) => {
              console.warn(err);
              if (err instanceof Taken) { return throwError(() => new ConflictException()); }
              if (err instanceof Missing) throw new NotFoundException();
              return throwError(() => err);
            }),
            catchError((err) => (err instanceof HttpException ? throwError(() => err) : throwError(() => new HttpException('x', 503)))),
          );
        }
      }`),
    ).toEqual([
      [
        ['Taken', 'map', 'ConflictException', 409],
        ['Missing', 'map', 'NotFoundException', 404],
        [undefined, 'rethrow'],
      ],
      [
        ['HttpException', 'rethrow'],
        [undefined, 'map', 'HttpException', 503],
      ],
    ]);
  });

  it("reads timeout()'s error, its own or the one its with gives", () => {
    expect(stepsOf(`class A { intercept(c, next) { return next.handle().pipe(timeout(5000)); } }`)).toEqual([
      ['timeout', 'TimeoutError', undefined],
    ]);
    expect(
      stepsOf(`
      import { RequestTimeoutException } from '@nestjs/common';
      class A { intercept(c, next) { return next.handle().pipe(timeout({ each: 100, with: () => throwError(() => new RequestTimeoutException()) })); } }`),
    ).toEqual([['timeout', 'RequestTimeoutException', 408]]);
  });

  it('says what it cannot read, and reads nothing behind a step it cannot read at all', () => {
    const helper = pipeOfIntercept(
      interceptOf(`class A { intercept(c, next) { return next.handle().pipe(catchError((err) => this.translate(err))); } translate(e) { return e; } }`),
    );
    // One branch, for every error, that cannot be read.
    expect(helper.steps).toEqual([{ kind: 'catch', rules: [{ answer: { kind: 'unread' } }] }]);
    expect(helper.why).toBe('what its catchError(...) gives cannot be read');
    const method = pipeOfIntercept(interceptOf(`class A { intercept(c, next) { return next.handle().pipe(catchError(this.translate)); } translate(e) { return e; } }`));
    expect(method.steps).toBeUndefined();

    const branch = pipeOfIntercept(
      interceptOf(`class B extends Error {}
      class A { intercept(c, next) { return next.handle().pipe(catchError((err) => err instanceof B ? throwError(() => make(err)) : throwError(() => err))); } }
      declare function make(e: unknown): Error;`),
    );
    expect(branch.steps?.[0]).toEqual({ kind: 'catch', rules: [{ only: 'B', answer: { kind: 'unread' } }, { answer: { kind: 'rethrow' } }] });
    expect(branch.why).toBe('what its catchError(...) gives cannot be read');

    const tried = pipeOfIntercept(
      interceptOf(`class A { async intercept(c, next) { try { return await next.handle().toPromise(); } catch (e) { return null; } } }`),
    );
    expect(tried.steps).toBeUndefined();
    expect(tried.why).toBe('it handles errors other than with catchError(...)');

    expect(pipeOfIntercept(interceptOf(`class A { intercept(c, next) { return next.handle(); } }`))).toEqual({ steps: [], mappingThrows: [] });
  });

  it('knows the throw in a callback for what it maps an error to', () => {
    const pipe = pipeOfIntercept(
      interceptOf(`import { NotFoundException } from '@nestjs/common';
      class A { intercept(c, next) { if (!c) throw new Error('x'); return next.handle().pipe(catchError(() => { throw new NotFoundException(); })); } }`),
    );
    expect(pipe.mappingThrows.map((node) => node.getText())).toEqual(['throw new NotFoundException();']);
  });
});

const site = (exception: string, status: number | undefined, lineage: string[], own = status): Site => ({
  failure: { ...(status === undefined ? {} : { status }), exception, at: 'svc#src/a.ts:A.f', file: 'src/a.ts', line: 3, source: 'throw' },
  lineage,
  ...(own === undefined ? {} : { own }),
});

const interceptor = (name: string, steps?: PipeStep[]): InterceptorInFront => ({
  name,
  at: `svc#src/${name}.ts:${name}.intercept`,
  file: `src/${name}.ts`,
  ...(steps === undefined ? {} : { steps }),
});

const given = (exception: string, status: number | undefined, lineage: string[], line = 9) => ({
  exception,
  ...(status === undefined ? {} : { status, own: status }),
  lineage,
  line,
});

const mapsTo = (exception: string, status: number, only?: string): PipeStep => ({
  kind: 'catch',
  rules: [
    { ...(only === undefined ? {} : { only }), answer: { kind: 'map', to: given(exception, status, [exception, 'HttpException', 'Error']) } },
    ...(only === undefined ? [] : [{ answer: { kind: 'rethrow' as const } }]),
  ],
});

const swallows: PipeStep = { kind: 'catch', rules: [{ answer: { kind: 'swallow' } }] };

const said = (sites: readonly Site[]) =>
  sites.map((each) => [each.failure.exception, each.failure.status, each.failure.source, each.failure.assumed ?? false]);

describe('a failure through the interceptors around a route (P207)', () => {
  const missing = site('NotFoundException', 404, ['NotFoundException', 'HttpException', 'Error']);

  it('meets the innermost first, and an exception one gives goes on to those outside it', () => {
    const outer = interceptor('Outer', [mapsTo('ServiceUnavailableException', 503, 'BadGatewayException')]);
    const inner = interceptor('Inner', [mapsTo('BadGatewayException', 502)]);
    expect(said(throughInterceptors(missing, [outer, inner]))).toEqual([['ServiceUnavailableException', 503, 'interceptor', false]]);
    // The other way round, the outer one sees a 502 it does not test for.
    expect(said(throughInterceptors(missing, [inner, outer]))).toEqual([['BadGatewayException', 502, 'interceptor', false]]);
  });

  it('is gone where one answers it with a value, and passes one that hands it on', () => {
    expect(throughInterceptors(missing, [interceptor('Mapper', [mapsTo('BadGatewayException', 502)]), interceptor('Fallback', [swallows])])).toEqual([]);
    expect(throughInterceptors(missing, [interceptor('Plain', [])])).toEqual([missing]);
  });

  it('is assumed through one that cannot be read, whatever a filter makes of it', () => {
    const [through] = throughInterceptors(missing, [interceptor('Unread')]);
    expect(through?.failure.assumed).toBe(true);
    const fixed: FilterInFront = { name: 'Fixed', catches: [], answer: { kind: 'fixed', status: 400 } };
    expect(throughFilters(through as Site, [fixed])).toMatchObject({ status: 400, assumed: true });
  });

  it('passes only the interceptors outside the one that raised it', () => {
    const outer = interceptor('Outer', [mapsTo('BadGatewayException', 502)]);
    const timed = interceptor('Timed', [{ kind: 'timeout', raises: given('TimeoutError', undefined, ['TimeoutError', 'Error']) }, mapsTo('RequestTimeoutException', 408, 'TimeoutError')]);
    const inner = interceptor('Inner', [swallows]);
    expect(said(raisedByInterceptors([timed, inner]))).toEqual([['RequestTimeoutException', 408, 'interceptor', false]]);
    expect(said(raisedByInterceptors([outer, timed, inner]))).toEqual([['BadGatewayException', 502, 'interceptor', false]]);
    expect(said(throughInterceptors(missing, [outer, timed, inner], 1))).toEqual([['BadGatewayException', 502, 'interceptor', false]]);
  });

  it("answers each of a helper's choices on its own", () => {
    const helper: Site = {
      failure: { exception: 'toHttpError', at: 'svc#src/a.ts:A.f', source: 'throw', via: 'helper' },
      lineage: [],
      choices: [
        { exception: 'NotFoundException', status: 404, lineage: ['NotFoundException', 'HttpException', 'Error'], own: 404 },
        { exception: 'ConflictException', status: 409, lineage: ['ConflictException', 'HttpException', 'Error'], own: 409 },
      ],
    };
    const out = throughInterceptors(helper, [interceptor('Mapper', [mapsTo('GoneException', 410, 'ConflictException')])]);
    expect(out.map((each) => [each.failure.exception, each.choices?.map((choice) => choice.exception)])).toEqual([
      ['toHttpError', ['NotFoundException']],
      ['GoneException', undefined],
    ]);
  });
});
