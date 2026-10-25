import { describe, expect, it } from 'vitest';
import { groupFailures, type Failure } from './failures.js';
import {
  compareEntryFailures,
  compareSeenFailures,
  comparisonSays,
  FAILURE_MIN_HITS,
  failureContextOf,
  seenOfGroup,
} from './observed-failures.js';

const window = { since: '7d', from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' };
const ENTRY = 'entry:shop:http:POST:/orders';

const fail = (over: Partial<Failure>): Failure => ({
  exception: 'Error',
  at: 'shop#src/orders.service.ts:OrdersService.create',
  file: 'src/orders.service.ts',
  line: 12,
  source: 'throw',
  ...over,
});

const compare = (fails: Failure[], statuses: Record<string, number>, count = 40, extra = {}) =>
  compareSeenFailures(ENTRY, groupFailures(fails), { count, statuses }, { window, ...extra });

describe('failures seen against the ones declared', () => {
  it('finds a 500 nobody declares, and sets a declared 404 that traffic answered beside it', () => {
    const result = compare([fail({ status: 404, exception: 'NotFoundException' })], { '200': 30, '404': 6, '500': 4 })!;
    expect(result.undeclared).toEqual([{ status: 500, count: 4, share: 0.1 }]);
    expect(result.declaredSeen).toEqual([{ status: 404, exception: 'NotFoundException', count: 6 }]);
    expect(result.declaredNeverSeen).toEqual([]);
    expect(result).toMatchObject({ entry: ENTRY, hits: 40, window });
  });

  it('says a declared 409 was never seen above the floor, and only says the floor was not met below it', () => {
    const fails = [fail({ status: 409, exception: 'ConflictException' })];
    expect(compare(fails, { '201': 40 })!.declaredNeverSeen).toEqual([
      { status: 409, exception: 'ConflictException', at: fails[0]!.at, loc: 'src/orders.service.ts:12' },
    ]);
    const few = compare(fails, { '201': 3 }, 3)!;
    expect(few.declaredNeverSeen).toEqual([]);
    expect(few.tooFewHits).toBe(true);
    expect(compare(fails, { '201': 3 }, 3, { minHits: 2 })!.declaredNeverSeen).toHaveLength(1);
    expect(FAILURE_MIN_HITS).toBe(20);
  });

  it('confirms an assumed 500 traffic answered, and never reports an assumed group as never seen', () => {
    const assumed = [fail({ status: 500, assumed: true })];
    expect(compare(assumed, { '200': 39, '500': 1 })!.declaredSeen).toEqual([{ status: 500, exception: 'Error', count: 1, assumed: true }]);
    const quiet = compare(assumed, { '200': 40 })!;
    expect(quiet.declaredNeverSeen).toEqual([]);
    expect(quiet.tooFewHits).toBeUndefined();
    expect(comparisonSays(quiet)).toBe(false);
  });

  it('says why the framework answers a status no code declares', () => {
    const result = compare([], { '400': 1, '401': 1, '403': 1, '404': 1, '405': 1, '500': 1 }, 40, {
      context: { method: 'POST', guards: ['SessionGuard'] },
    })!;
    expect(result.undeclared.map((row) => [row.status, row.expected])).toEqual([
      [500, undefined],
      [400, 'the framework refuses a body it cannot read'],
      [401, 'a check in front of it can refuse (SessionGuard)'],
      [403, 'a check in front of it can refuse (SessionGuard)'],
      [404, 'the router answers it before the handler runs'],
      [405, 'the router answers it before the handler runs'],
    ]);
    // Without a body or a check in front, a 400 and a 401 are flagged.
    const bare = compare([], { '400': 2, '401': 1 }, 40, { context: { method: 'GET' } })!;
    expect(bare.undeclared.every((row) => row.expected === undefined)).toBe(true);
  });

  it('lists a failure that names no status as maybe beside an unexplained status, never folded into it', () => {
    const fails = [fail({ exception: 'DomainError' })];
    const result = compare(fails, { '200': 30, '409': 2, '404': 1 })!;
    expect(result.undeclared).toEqual([
      { status: 409, count: 2, share: 0.05, maybe: ['DomainError'] },
      { status: 404, count: 1, share: 0.025, expected: 'the router answers it before the handler runs' },
    ]);
    expect(result.declaredNeverSeen).toEqual([]);
    // With nothing it could be, it is never seen.
    expect(compare(fails, { '200': 40, '404': 1 })!.declaredNeverSeen).toEqual([
      { exception: 'DomainError', at: fails[0]!.at, loc: 'src/orders.service.ts:12' },
    ]);
  });

  it('matches what a helper can choose by each status it gives (P90)', () => {
    const helper = fail({
      exception: 'toHttpError',
      via: 'helper',
      chosenFrom: [
        { exception: 'UnauthorizedException', status: 401 },
        { exception: 'LockedException', status: 423 },
        { exception: 'Error', status: 500, assumed: true },
      ],
    });
    const result = compare([helper], { '200': 37, '401': 3 })!;
    expect(result.declaredSeen).toEqual([{ status: 401, exception: 'toHttpError', count: 3 }]);
    expect(result.declaredNeverSeen.map((row) => row.status)).toEqual([423]);
    expect(seenOfGroup(groupFailures([helper])[0]!, { count: 40, statuses: { '401': 3, '500': 2 } })).toBe(5);
  });

  it('compares nothing for a way in whose spans carried no status, and ignores statuses out of range', () => {
    expect(compare([fail({ status: 404 })], {}, 5)).toBeUndefined();
    expect(compareSeenFailures(ENTRY, [], { count: 5 }, { window })).toBeUndefined();
    expect(compare([], { '0': 2, '200': 3, '302': 1, '600': 1 })!.undeclared).toEqual([]);
  });

  it('reads the method and the checks that are not switched off from an entry node', () => {
    const node = {
      id: ENTRY,
      meta: {
        method: 'POST',
        fails: [fail({ status: 409, exception: 'ConflictException' })],
        access: {
          guards: [
            { id: 'shop#a', name: 'SessionGuard', where: 'global', via: 'APP_GUARD', layer: 'guard' },
            { id: 'shop#b', name: 'RolesGuard', where: 'controller', via: '@UseGuards', layer: 'guard', skippedBy: 'Public' },
          ],
        },
      },
    };
    expect(failureContextOf(node)).toEqual({ method: 'POST', guards: ['SessionGuard'] });
    const result = compareEntryFailures(node, { count: 25, statuses: { '201': 24, '401': 1 } }, { window })!;
    expect(result.undeclared).toEqual([{ status: 401, count: 1, share: 0.04, expected: 'a check in front of it can refuse (SessionGuard)' }]);
    expect(result.declaredNeverSeen.map((row) => row.status)).toEqual([409]);
  });
});
