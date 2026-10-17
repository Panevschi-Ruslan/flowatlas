import { describe, expect, it } from 'vitest';
import { failsOf } from './fails.js';

describe('what a way in fails with through a helper, on the wire (P90)', () => {
  it('carries the helper, its choices from every site once, and the family where every site says it', () => {
    const at = 'desk#src/desk.controller.ts:DeskController.renew';
    const node = {
      type: 'entry' as const,
      meta: {
        fails: [
          {
            exception: 'toHttpError',
            at,
            file: 'src/desk.controller.ts',
            line: 23,
            source: 'throw',
            via: 'helper',
            chosenFrom: [
              { exception: 'ForbiddenException', status: 403 },
              { exception: 'UnauthorizedException', status: 401 },
            ],
          },
          {
            exception: 'toHttpError',
            at,
            file: 'src/desk.controller.ts',
            line: 33,
            source: 'throw',
            via: 'helper',
            chosenFrom: [{ exception: 'LockedAccountError', status: 423 }, { exception: 'UnauthorizedException', status: 401 }],
          },
          { exception: 'reject', at, source: 'throw', via: 'helper', family: 'auth' },
        ],
      },
    };
    expect(failsOf(node)).toEqual([
      {
        exception: 'reject',
        via: 'helper',
        family: 'auth',
        sources: ['throw'],
        sites: 1,
        at,
      },
      {
        exception: 'toHttpError',
        via: 'helper',
        chosenFrom: [
          { exception: 'UnauthorizedException', status: 401 },
          { exception: 'ForbiddenException', status: 403 },
          { exception: 'LockedAccountError', status: 423 },
        ],
        sources: ['throw'],
        sites: 2,
        at,
        loc: 'src/desk.controller.ts:23',
      },
    ]);
  });
});
