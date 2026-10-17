import type { GraphNode } from '@flowatlas/core';
import type { DiffReport, GapRef } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { checkReasonsOf } from './check-verdict.js';

const FILE = 'src/clients/orders.client.ts';
const ID = `gap:gateway|${FILE}|target-route-not-found`;

const request = (line: number): GraphNode => ({
  id: `http_out:gateway#${FILE}:${line}:12`,
  type: 'http_out',
  label: line === 31 ? 'POST /refunds' : 'GET /refunds',
  repo: 'gateway',
  file: FILE,
  line,
});

/** As much of a comparison as the verdict reads: nothing but the gaps the candidate added. */
const reportOf = (added: GapRef[]): DiffReport =>
  ({
    contracts: { new: [], fixed: [], preexisting: [], excused: [] },
    rules: { new: [], fixed: [], existing: [], excused: [] },
    joins: { lost: [] },
    unresolved: { added, removed: [] },
  }) as unknown as DiffReport;

describe('check names every new request that joins nothing deployed', () => {
  it('names a second one in a file whose deployed side already had one, at its own line (P194 with P117)', () => {
    // What `diff` writes since P194 when the file held one dangling request
    // and gains a second: the gap id both sides hold, at the new site, with
    // the site they share counted as `kept`. Before P194 the id was not
    // "added" at all, and the check said deployable.
    const second: GapRef = {
      id: ID,
      kind: 'gap',
      service: 'gateway',
      file: FILE,
      line: 31,
      reason: 'target-route-not-found',
      node: request(31).id,
      sites: 1,
      kept: 1,
    };
    const { reasons, already } = checkReasonsOf(reportOf([second]), {
      deployed: { nodes: [request(20)], edges: [] },
      candidate: { nodes: [request(22), request(31)], edges: [] },
    });

    expect(reasons).toEqual([
      expect.objectContaining({
        kind: 'join',
        code: 'no-target',
        service: 'gateway',
        message: 'gateway calls POST /refunds, which nothing deployed serves (target-route-not-found)',
        at: { service: 'gateway', file: FILE, line: 31 },
      }),
    ]);
    expect(already).toEqual([]);
  });
});
