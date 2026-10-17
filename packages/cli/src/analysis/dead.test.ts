import { describe, expect, it } from 'vitest';
import { deadFields } from './dead.js';
import { buildTestDb } from './__fixtures__/test-db.js';

/*
 * The rest of the dead analysis moved to the linker with its tests (P95); the
 * fields section asks the contracts checker at run time and stays here.
 */

describe('fields the receiver does not declare', () => {
  it('asks the contract checker, and says nothing crosses a boundary here', async () => {
    // It used to answer `contracts-unavailable`, because the checker was a
    // later phase. It exists now, and an empty graph has no boundary to send a
    // field over. The warning is still what a checkout without it would get.
    const db = buildTestDb({ nodes: [], edges: [] });
    const result = await deadFields(db);
    db.close();

    expect(result.fields).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it('names a field one service sends that the other does not declare', async () => {
    const db = buildTestDb({
      nodes: [
        { id: 'http_out:web#1', type: 'http_out', label: 'post', repo: 'web' },
        { id: 'entry:api:http:POST:/orders', type: 'entry', kind: 'http', label: 'POST /orders', repo: 'api' },
        { id: 'api#Controller.create', type: 'method', label: 'create', repo: 'api' },
      ],
      edges: [
        {
          from: 'http_out:web#1',
          to: 'entry:api:http:POST:/orders',
          type: 'http_calls',
          confidence: 'static',
          params: ['type:web#Body'],
        },
        {
          from: 'entry:api:http:POST:/orders',
          to: 'api#Controller.create',
          type: 'handles',
          confidence: 'static',
          meta: { body: 'type:api#Body' },
        },
      ],
      types: {
        'type:web#Body': {
          name: 'Body',
          kind: 'object',
          declaredIn: 'web#src/dto.ts',
          structuralHash: 'aaa',
          fields: [
            { name: 'id', type: 'string', optional: false },
            { name: 'debugId', type: 'string', optional: false },
          ],
        },
        'type:api#Body': {
          name: 'Body',
          kind: 'object',
          declaredIn: 'api#src/dto.ts',
          structuralHash: 'bbb',
          fields: [{ name: 'id', type: 'string', optional: false }],
        },
      },
    });
    const result = await deadFields(db);
    db.close();

    expect(result.fields.map((row) => `${row.typeId} ${row.field}`)).toEqual([
      'type:api#Body debugId',
    ]);
    // Travelling into the receiver, and nothing there removes it: this graph
    // has no whitelisting pipe, so the row must not claim one. What the
    // checker read, not what the direction suggests.
    expect(result.fields[0]?.direction).toBe('request');
    expect(result.fields[0]?.dropped).toBe(false);
    expect(result.fields[0]?.reason).toContain('nothing there removes it');
  });
});
