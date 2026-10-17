import type { Failure } from '@flowatlas/core';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { answerOfCatch, throughFilters, type FilterInFront, type Site } from './filters.js';
import { guardRefusals } from './guards.js';
import { validatesDto } from './pass.js';
import { answerOfClass, classNamed, MOST_CHOICES, statusDeclaredBy, throwsIn } from './throws.js';

// What a whole route fails with is the snapshot of fixtures/nest-failures and
// fixtures/nest-fails-accurate; the variant without its filter is read in
// cli/src/commands/fails-accurate.test.ts, which has the entry readers.

const fileOf = (source: string) => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);

const bodyOf = (source: string) => fileOf(source).getFirstDescendantByKindOrThrow(SyntaxKind.FunctionDeclaration).getBodyOrThrow();

const statuses = (source: string) =>
  throwsIn(bodyOf(source)).map(({ exception, status, assumed, declared }) => [exception, status, assumed ?? false, declared]);

describe('what a body throws', () => {
  it('reads the status of the framework exceptions and of HttpException with a status', () => {
    const body = bodyOf(`
      import { NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
      function f(a: number) {
        if (a === 1) throw new NotFoundException();
        if (a === 2) throw new HttpException('x', HttpStatus.CONFLICT);
        if (a === 3) throw new HttpException('x', 418);
        if (a === 4) throw new HttpException('x', a);
      }`);
    expect(throwsIn(body).map(({ exception, status }) => [exception, status])).toEqual([
      ['NotFoundException', 404],
      ['HttpException', 409],
      ['HttpException', 418],
      ['HttpException', undefined],
    ]);
  });

  it('follows a class written here to the status it hands its base', () => {
    const body = bodyOf(`
      import { HttpException, ForbiddenException } from '@nestjs/common';
      class Locked extends HttpException { constructor() { super('locked', 423); } }
      class NotYours extends ForbiddenException {}
      class Coded extends HttpException { constructor(message: string, status: number) { super(message, status); } }
      function f(a: number) {
        if (a === 1) throw new Locked();
        if (a === 2) throw new Coded('gone', 410);
        throw new NotYours();
      }`);
    expect(throwsIn(body).map(({ exception, status, lineage }) => [exception, status, lineage])).toEqual([
      ['Locked', 423, ['Locked', 'HttpException', 'Error']],
      ['Coded', 410, ['Coded', 'HttpException', 'Error']],
      ['NotYours', 403, ['NotYours', 'ForbiddenException', 'HttpException', 'Error']],
    ]);
  });

  it('answers a plain error with an assumed 500 and leaves out what it catches and what it rethrows', () => {
    const body = bodyOf(`
      function f(a: number) {
        try { throw new TypeError('caught'); } catch (error) { if (a) throw error; }
        throw new Error('boom');
      }`);
    expect(throwsIn(body)).toEqual([{ exception: 'Error', status: 500, assumed: true, line: 4, lineage: ['Error'] }]);
  });

  it('gives no status for an exception of a transport that has none', () => {
    const body = bodyOf(`
      import { RpcException } from '@nestjs/microservices';
      function f() { throw new RpcException('no'); }`);
    expect(throwsIn(body)).toEqual([{ exception: 'RpcException', line: 3, lineage: ['RpcException', 'Error'] }]);
  });
});

describe('the status a domain error states (P87)', () => {
  it('reads a property, a member of HttpStatus, a getter, a getStatus() and a stored constructor argument', () => {
    expect(
      statuses(`
      import { HttpStatus } from '@nestjs/common';
      class DomainError extends Error {}
      class Missing extends DomainError { readonly status = 404; }
      class Taken extends DomainError { statusCode = HttpStatus.CONFLICT; }
      class Locked extends DomainError { get status() { return 423; } }
      class Gone extends DomainError { getStatus(): number { return 410; } }
      class Keeps extends DomainError { readonly status: number; constructor(m: string, status: number) { super(m); this.status = status; } }
      class Overdue extends Keeps { constructor() { super('overdue', 409); } }
      class Held extends DomainError { constructor(m: string, readonly status: number) { super(m); } }
      function f(a: number) {
        if (a === 1) throw new Missing();
        if (a === 2) throw new Taken();
        if (a === 3) throw new Locked();
        if (a === 4) throw new Gone();
        if (a === 5) throw new Overdue();
        if (a === 6) throw new Keeps('x', 402);
        if (a === 7) throw new Held('x', 451);
      }`),
    ).toEqual([
      ['Missing', 500, true, 404],
      ['Taken', 500, true, 409],
      ['Locked', 500, true, 423],
      ['Gone', 500, true, 410],
      ['Overdue', 500, true, 409],
      ['Keeps', 500, true, 402],
      ['Held', 500, true, 451],
    ]);
  });

  it('takes the nearest statement of the status', () => {
    const file = fileOf(`
      class Base extends Error { readonly status = 400; }
      class Near extends Base { readonly status = 404; }
      class Inherits extends Base {}
      new Near(); new Inherits();`);
    const [near, inherits] = file.getDescendantsOfKind(SyntaxKind.NewExpression).map((call) =>
      statusDeclaredBy(classNamed(call.getExpressionIfKindOrThrow(SyntaxKind.Identifier))),
    );
    expect([near, inherits]).toEqual([404, 400]);
  });

  it('answers a chain of bases too long to follow with an assumed 500', () => {
    const chain = Array.from({ length: 11 }, (_, i) => `class C${i + 1} extends C${i} {}`).join('\n');
    const file = fileOf(`class C0 extends Error {}\n${chain}\nnew C11();`);
    const call = file.getFirstDescendantByKindOrThrow(SyntaxKind.NewExpression);
    expect(answerOfClass(classNamed(call.getExpressionIfKindOrThrow(SyntaxKind.Identifier)), [])).toMatchObject({
      status: 500,
      assumed: true,
    });
  });
});

describe('what a filter answers with (P87)', () => {
  const answerOf = (body: string) => {
    const file = fileOf(`
      import { HttpException } from '@nestjs/common';
      class DomainError extends Error { status = 400; }
      const pick = (e: unknown) => 418;
      class F { catch(exception: any, host: any) { ${body} } }`);
    return answerOfCatch(file.getClassOrThrow('F').getInstanceMethodOrThrow('catch'));
  };

  it('reads the status off the exception, however it is spelled', () => {
    expect(answerOf('host.switchToHttp().getResponse().status(exception.status).json({});')).toEqual({ kind: 'fromException' });
    expect(answerOf('const res = host.getResponse(); res.status(exception.getStatus());')).toEqual({ kind: 'fromException' });
    expect(answerOf('const { statusCode } = exception; host.getResponse().code(statusCode);')).toEqual({ kind: 'fromException' });
    expect(answerOf('const e = exception as DomainError; host.getResponse().status(e.status ?? 500);')).toEqual({
      kind: 'fromException',
      fallback: 500,
    });
  });

  it('reads a status chosen by an instanceof test, in a conditional or in a branch', () => {
    const narrowed = { kind: 'fromException', fallback: 500, only: 'HttpException' };
    expect(answerOf('host.getResponse().status(exception instanceof HttpException ? exception.getStatus() : 500);')).toEqual(narrowed);
    expect(
      answerOf('let status = 500; if (exception instanceof HttpException) { status = exception.getStatus(); } host.getResponse().status(status);'),
    ).toEqual(narrowed);
  });

  it('reads a fixed status, and says when the answer cannot be read', () => {
    expect(answerOf('host.getResponse().status(400).json({});')).toEqual({ kind: 'fixed', status: 400 });
    expect(answerOf('host.getResponse().status(pick(exception));')).toEqual({ kind: 'unread' });
    expect(answerOf('host.getResponse().status(400); host.getResponse().status(exception.status);')).toEqual({ kind: 'unread' });
    expect(answerOf('super.catch(exception, host);')).toEqual({ kind: 'framework' });
  });
});

describe('a throw answered through the filters in front of the route (P87)', () => {
  const site = (over: Partial<Site> & { failure?: Partial<Failure> }): Site => ({
    lineage: ['LoanNotFound', 'DomainError', 'Error'],
    own: 404,
    ...over,
    failure: { status: 500, assumed: true, declared: 404, exception: 'LoanNotFound', at: 'x', source: 'throw', ...over.failure },
  });
  const filter = (over: Partial<FilterInFront>): FilterInFront => ({ name: 'F', catches: [], answer: { kind: 'fromException' }, ...over });

  it('answers with the class status where a filter catching a base of it reads the status', () => {
    expect(throughFilters(site({}), [filter({ catches: ['DomainError'] })])).toEqual({
      status: 404,
      exception: 'LoanNotFound',
      at: 'x',
      source: 'throw',
    });
  });

  it('leaves the framework answer where no filter catches it, and takes the first that does', () => {
    expect(throughFilters(site({}), [filter({ catches: ['HttpException'] })])).toMatchObject({ status: 500, assumed: true, declared: 404 });
    const fixed = filter({ answer: { kind: 'fixed', status: 400 } });
    expect(throughFilters(site({}), [fixed, filter({})])).toMatchObject({ status: 400 });
  });

  it('uses the fallback for an exception outside the instanceof test, and marks an unread answer assumed', () => {
    const narrowed = filter({ answer: { kind: 'fromException', fallback: 500, only: 'HttpException' } });
    expect(throughFilters(site({}), [narrowed])).toEqual({ status: 500, exception: 'LoanNotFound', at: 'x', source: 'throw' });
    expect(throughFilters(site({}), [filter({ answer: { kind: 'unread' } })])).toEqual({
      status: 404,
      exception: 'LoanNotFound',
      at: 'x',
      source: 'throw',
      assumed: true,
    });
  });
});

describe('whether a guard written here can say no (P87)', () => {
  const refusals = (body: string, head = '') => {
    const file = fileOf(`
      import { AuthGuard } from '@nestjs/passport';
      ${head}
      class Members { check(id: string): boolean { return id.length > 0; } }
      class G { constructor(private readonly members: Members) {} ${body} }`);
    return guardRefusals(file.getClassOrThrow('G')).map((refusal) => refusal.status);
  };

  it('keeps the 403 where canActivate can return false', () => {
    expect(refusals('canActivate(c: any): boolean { if (!c) return false; return true; }')).toEqual([403]);
    expect(refusals('canActivate(c: any): boolean { return this.members.check(c.id); }')).toEqual([403]);
    expect(refusals('async canActivate(c: any): Promise<boolean> { return this.members.check(c.id); }')).toEqual([403]);
    expect(refusals('canActivate(c: any): boolean { if (c) return true; }')).toEqual([403]);
  });

  it('adds no 403 where every answer is true and the rest throws', () => {
    expect(refusals('canActivate(c: any): boolean { if (!c) throw new Error("no"); return true; }')).toEqual([]);
    expect(refusals('canActivate(c: any): boolean { if (c) { return true; } else { throw new Error("no"); } }')).toEqual([]);
  });

  it('answers with the installed guard it extends, and keeps the 403 for a body it cannot read', () => {
    const file = fileOf(`
      import { AuthGuard } from '@nestjs/passport';
      import { Unknown } from 'somewhere';
      class Jwt extends AuthGuard('jwt') {}
      class Other extends Unknown {}`);
    expect(guardRefusals(file.getClassOrThrow('Jwt'))).toEqual([{ status: 401, exception: 'UnauthorizedException' }]);
    expect(guardRefusals(file.getClassOrThrow('Other')).map((refusal) => refusal.status)).toEqual([403]);
  });
});

describe('whether a handler takes something to validate (P87)', () => {
  const takes = (parameter: string) => {
    const file = fileOf(`
      import { Body, Query, Param } from '@nestjs/common';
      class CreateDto { name!: string; }
      interface Shape { name: string; }
      class C { handle(${parameter}) {} }`);
    return validatesDto(file.getClassOrThrow('C').getMethodOrThrow('handle'));
  };

  it('is a class handed from the body, the query or the path', () => {
    expect(takes('@Body() dto: CreateDto')).toBe(true);
    expect(takes('@Query() q: CreateDto')).toBe(true);
    expect(takes("@Param('id') id: CreateDto")).toBe(true);
  });

  it('is not a primitive, a list, an interface, a type literal or a record', () => {
    expect(takes("@Param('id') id: string")).toBe(false);
    expect(takes('@Body() dto: CreateDto[]')).toBe(false);
    expect(takes('@Body() dto: Shape')).toBe(false);
    expect(takes('@Body() dto: { name: string }')).toBe(false);
    expect(takes('@Body() dto: Record<string, unknown>')).toBe(false);
    expect(takes('dto: CreateDto')).toBe(false);
  });
});

describe('a check thrown through a helper (P90)', () => {
  const HEAD = `
    import { HttpException, UnauthorizedException, ForbiddenException, NotFoundException, GoneException, ConflictException } from '@nestjs/common';
    class LockedAccountError extends HttpException { constructor(m: string) { super(m, 423); } }
    type Answer = { ok: true } | { ok: false; reason: 'missing' | 'denied' | 'locked' };
    class LibrarianAuth { verify(req: unknown): Promise<Answer> { return Promise.resolve({ ok: true }); } }
    declare const librarianAuth: LibrarianAuth;
    declare function parseBody(req: unknown): Answer;
  `;
  /** What the function named `handler` throws, as `[exception, status, choices, family]`. */
  const thrown = (source: string) =>
    throwsIn(fileOf(HEAD + source).getFunctionOrThrow('handler').getBodyOrThrow()).map((found) => ({
      exception: found.exception,
      ...(found.status === undefined ? {} : { status: found.status }),
      ...(found.via === undefined ? {} : { via: found.via }),
      ...(found.choices === undefined ? {} : { choices: found.choices.map((choice) => [choice.exception, choice.status]) }),
      ...(found.family === undefined ? {} : { family: found.family }),
    }));
  const DENIALS = [
    ['UnauthorizedException', 401],
    ['ForbiddenException', 403],
    ['LockedAccountError', 423],
  ];

  it('reads a table of classes in an object, a Map and a switch', () => {
    expect(
      thrown(`
      const TABLE = { missing: UnauthorizedException, denied: ForbiddenException, locked: LockedAccountError } as const;
      const toHttpError = (r: { reason: keyof typeof TABLE }) => new TABLE[r.reason](r.reason);
      function handler(r: any) { throw toHttpError(r); }`),
    ).toEqual([{ exception: 'toHttpError', via: 'helper', choices: DENIALS }]);
    expect(
      thrown(`
      const BY_REASON = new Map<string, any>([['missing', UnauthorizedException], ['denied', ForbiddenException]]);
      function toHttp(reason: string) { return new (BY_REASON.get(reason) ?? LockedAccountError)(reason); }
      function handler(r: any) { throw toHttp(r.reason); }`),
    ).toEqual([{ exception: 'toHttp', via: 'helper', choices: DENIALS }]);
    expect(
      thrown(`
      function toHttp(reason: string) {
        switch (reason) {
          case 'missing': return new UnauthorizedException();
          case 'denied': return new ForbiddenException();
          default: return reason === 'gone' ? new LockedAccountError('x') : new ForbiddenException();
        }
      }
      function handler(r: any) { throw toHttp(r.reason); }`),
    ).toEqual([{ exception: 'toHttp', via: 'helper', choices: DENIALS }]);
  });

  it('reads a table of exceptions already built, and a literal key picks its one value', () => {
    expect(
      thrown(`
      const BUILT = { missing: new UnauthorizedException(), denied: new ForbiddenException() };
      function pick(reason: 'missing' | 'denied') { return BUILT[reason]; }
      function handler(r: any) { if (r) throw pick(r); throw BUILT['denied']; }`),
    ).toEqual([
      { exception: 'pick', via: 'helper', choices: [['UnauthorizedException', 401], ['ForbiddenException', 403]] },
    ]);
  });

  it('gives one status where every choice agrees', () => {
    expect(
      thrown(`
      const toConflict = (m: string) => new ConflictException(m);
      function handler() { throw toConflict('taken'); }`),
    ).toEqual([{ exception: 'toConflict', status: 409, via: 'helper', choices: [['ConflictException', 409]] }]);
  });

  it('follows a const bound to the call, an await, a method of this class and an object of helpers', () => {
    const answer = [{ exception: 'UnauthorizedException', status: 401 }];
    const source = `
      const errors = { unauthorized: () => new UnauthorizedException() };
      class Desk {
        reject() { return new UnauthorizedException(); }
        async later() { return new UnauthorizedException(); }
        run() { const e = this.reject(); throw e; }
        async wait() { throw await this.later(); }
      }
      function handler() { throw errors.unauthorized(); }`;
    expect(thrown(source).map(({ exception, choices }) => [exception, choices])).toEqual([['errors.unauthorized', [['UnauthorizedException', 401]]]]);
    const desk = fileOf(HEAD + source).getClassOrThrow('Desk');
    const of = (name: string) => throwsIn(desk.getMethodOrThrow(name).getBodyOrThrow()).map(({ exception, status }) => ({ exception, status }));
    expect(of('run')).toEqual([{ exception: 'reject', status: 401 }]);
    expect(of('wait').map(({ status }) => status)).toEqual(answer.map(({ status }) => status));
  });

  it('reads a helper calling a helper, and stops at the next one down', () => {
    expect(
      thrown(`
      const inner = () => new ForbiddenException();
      const outer = () => inner();
      function handler() { throw outer(); }`),
    ).toEqual([{ exception: 'outer', status: 403, via: 'helper', choices: [['ForbiddenException', 403]] }]);
    expect(
      thrown(`
      const deepest = () => new ForbiddenException();
      const inner = () => deepest();
      const outer = () => inner();
      function handler() { throw outer(); }`),
    ).toEqual([{ exception: 'outer', via: 'helper' }]);
  });

  it('keeps a helper it cannot read, as a refusal of who is asking only where the check says so', () => {
    const source = `
      function reject(Error: new (m: string) => Error, m: string) { return new Error(m); }
      async function handler(req: unknown) {
        const answer = await librarianAuth.verify(req);
        if (!answer.ok) throw reject(UnauthorizedException, 'no');
        if (!(await librarianAuth.verify(req)).ok) throw reject(ForbiddenException, 'no');
        const parsed = parseBody(req);
        if (!parsed.ok) throw reject(NotFoundException, 'no');
      }`;
    expect(thrown(source)).toEqual([
      { exception: 'reject', via: 'helper', family: 'auth' },
      { exception: 'reject', via: 'helper', family: 'auth' },
      { exception: 'reject', via: 'helper' },
    ]);
  });

  it('says nothing of a call it cannot open under no such test, a rethrow, or the language error called without new', () => {
    expect(
      thrown(`
      import { makeError } from 'somewhere';
      function handler(req: unknown) {
        try { return 1; } catch (error) { throw error; }
        if (!parseBody(req).ok) throw makeError();
        throw Error('plain');
      }`),
    ).toEqual([]);
    expect(
      thrown(`
      import { makeError } from 'somewhere';
      async function handler(req: unknown) { if (!(await librarianAuth.verify(req)).ok) throw makeError(); }`),
    ).toEqual([{ exception: 'makeError', via: 'helper', family: 'auth' }]);
  });

  it('lists a table of not-found answers as choices that are no check', () => {
    expect(
      thrown(`
      const MISSING = { none: NotFoundException, gone: GoneException };
      const toNotFound = (why: keyof typeof MISSING) => new MISSING[why]();
      function handler(why: any) { throw toNotFound(why); }`),
    ).toEqual([{ exception: 'toNotFound', via: 'helper', choices: [['NotFoundException', 404], ['GoneException', 410]] }]);
  });

  it('answers each choice through the filters, and caps the list', () => {
    const chosen = (filters: FilterInFront[]) =>
      throughFilters(
        {
          failure: { exception: 'toHttpError', at: 'x', source: 'throw', via: 'helper' },
          lineage: [],
          choices: [
            { exception: 'Locked', status: 500, assumed: true, lineage: ['Locked', 'DomainError', 'Error'], own: 423 },
            { exception: 'UnauthorizedException', status: 401, lineage: ['UnauthorizedException', 'HttpException', 'Error'], own: 401 },
          ],
        },
        filters,
      );
    expect(chosen([])).toEqual({
      exception: 'toHttpError',
      at: 'x',
      source: 'throw',
      via: 'helper',
      chosenFrom: [
        { exception: 'UnauthorizedException', status: 401 },
        { exception: 'Locked', status: 500, assumed: true },
      ],
    });
    expect(chosen([{ name: 'F', catches: ['DomainError'], answer: { kind: 'fromException' } }]).chosenFrom).toEqual([
      { exception: 'UnauthorizedException', status: 401 },
      { exception: 'Locked', status: 423 },
    ]);
    expect(chosen([{ name: 'F', catches: [], answer: { kind: 'fixed', status: 400 } }])).toMatchObject({ status: 400 });
    const many = Array.from({ length: MOST_CHOICES + 3 }, (_, i) => ({ exception: `E${i}`, status: 400, lineage: [`E${i}`] }));
    const capped = throughFilters({ failure: { exception: 'h', at: 'x', source: 'throw', via: 'helper' }, lineage: [], choices: many }, []);
    expect(capped.chosenFrom).toHaveLength(MOST_CHOICES);
    expect(capped.status).toBeUndefined();
  });
});
