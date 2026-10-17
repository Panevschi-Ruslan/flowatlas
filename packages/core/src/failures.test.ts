import { describe, expect, it } from 'vitest';
import { failsWithAny, groupFailures, settleFailures, type Failure } from './failures.js';

const site = (over: Partial<Failure>): Failure => ({ exception: 'Error', at: 'api#S.a', source: 'throw', ...over });

describe('groupFailures (P87)', () => {
  it('lists each status and exception once, by status then exception, with how many places raise it', () => {
    const groups = groupFailures(
      settleFailures([
        site({ status: 404, exception: 'NotFound', line: 3 }),
        site({ status: 404, exception: 'NotFound', line: 9, at: 'api#S.b' }),
        site({ status: 400, exception: 'BadRequestException', source: 'pipe' }),
        site({ status: 404, exception: 'Gone', line: 4 }),
        site({ exception: 'RpcException' }),
      ]),
    );
    expect(groups.map((group) => [group.status, group.exception, group.sites])).toEqual([
      [400, 'BadRequestException', 1],
      [404, 'Gone', 1],
      [404, 'NotFound', 2],
      [undefined, 'RpcException', 1],
    ]);
    expect(groups[2]?.at.map((item) => item.line)).toEqual([3, 9]);
  });

  it('says how the sites come about, each source once and in the fixed order', () => {
    const [group] = groupFailures([
      site({ status: 401, exception: 'UnauthorizedException', source: 'throw' }),
      site({ status: 401, exception: 'UnauthorizedException', source: 'guard', at: 'api#G' }),
    ]);
    expect(group?.sources).toEqual(['throw', 'guard']);
  });

  it('keeps assumed on a group only when every site is assumed, and declared only when every site agrees', () => {
    const [mixed] = groupFailures([site({ status: 500, assumed: true }), site({ status: 500, line: 2 })]);
    expect(mixed?.assumed).toBeUndefined();
    const [all] = groupFailures([
      site({ status: 500, assumed: true, declared: 404 }),
      site({ status: 500, assumed: true, declared: 404, line: 2 }),
    ]);
    expect(all).toMatchObject({ assumed: true, declared: 404, sites: 2 });
    const [split] = groupFailures([
      site({ status: 500, assumed: true, declared: 404 }),
      site({ status: 500, assumed: true, declared: 409, line: 2 }),
    ]);
    expect(split?.declared).toBeUndefined();
  });

  it('keeps an assumed site apart from a stated one in the stored list', () => {
    expect(settleFailures([site({ status: 500 }), site({ status: 500, assumed: true })])).toHaveLength(2);
  });
});

describe('a failure a helper chooses (P90)', () => {
  const helper = {
    exception: 'toHttpError',
    at: 'a#f',
    source: 'throw' as const,
    via: 'helper' as const,
    chosenFrom: [
      { exception: 'NotFoundException', status: 404 },
      { exception: 'ForbiddenException', status: 403 },
    ],
  };

  it('fails with any status its helper can choose', () => {
    expect(failsWithAny(helper, new Set([401, 403]))).toBe(true);
    expect(failsWithAny({ ...helper, chosenFrom: [{ exception: 'GoneException', status: 410 }] }, new Set([401, 403]))).toBe(false);
    expect(failsWithAny({ exception: 'X', at: 'a', source: 'throw', status: 401 }, new Set([401]))).toBe(true);
  });

  it('keeps two sites apart that choose differently, and groups their choices', () => {
    const other = { ...helper, line: 9, chosenFrom: [{ exception: 'UnauthorizedException', status: 401 }] };
    expect(settleFailures([helper, helper, other])).toHaveLength(2);
    const [group] = groupFailures([helper, other]);
    expect(group).toMatchObject({ exception: 'toHttpError', via: 'helper', sites: 2 });
    expect(group?.chosenFrom?.map((choice) => choice.status)).toEqual([401, 403, 404]);
  });
});
