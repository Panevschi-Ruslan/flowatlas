import { REACHED_AS_META, REACHES_META, RESULT_OF_META, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinReferences } from './reference-link.js';

const step = (repo: string, name: string, reaches: string[]): GraphNode => ({
  id: `${repo}#flow.asl.json:flow/${name}`,
  type: 'function',
  kind: 'state',
  label: `${name} [Task]`,
  repo,
  file: 'flow.asl.json',
  line: 7,
  meta: { [REACHES_META]: reaches },
});

const workflow = (repo: string, name: string, meta: Record<string, unknown> = {}): GraphNode => ({
  id: `entry:${repo}:workflow:${name}`,
  type: 'entry',
  kind: 'workflow',
  label: `workflow ${name}`,
  repo,
  meta: { name, ...meta },
});

const join = (nodes: GraphNode[]) => {
  const edges = new Map<string, GraphEdge>();
  const rows = joinReferences(new Map(nodes.map((node) => [node.id, node])), edges);
  return { edges: [...edges.values()], rows };
};

describe('joinReferences', () => {
  it('joins a step to the one entry its reference names, in whichever service declares it', () => {
    const caller = step('circulation', 'NotifyBorrower', ['workflow:borrower-notifications']);
    const { edges, rows } = join([caller, workflow('notifications', 'borrower-notifications')]);
    expect(rows).toEqual([]);
    expect(edges).toEqual([
      {
        from: caller.id,
        to: 'entry:notifications:workflow:borrower-notifications',
        type: 'calls',
        confidence: 'static',
        file: 'flow.asl.json',
        line: 7,
        meta: { via: 'deployed-name', reference: 'workflow:borrower-notifications' },
      },
    ]);
  });

  it('joins to an entry declared inside an application, which the reference does not name', () => {
    const caller = step('circulation', 'Ask', ['workflow:returns']);
    const target: GraphNode = { ...workflow('returns', 'returns'), id: 'entry:returns@desk:workflow:returns' };
    expect(join([caller, target]).edges.map((edge) => edge.to)).toEqual(['entry:returns@desk:workflow:returns']);
  });

  it('is no stronger than what the caller says of the name it holds', () => {
    const caller: GraphNode = { ...step('loans', 'start', ['workflow:reserve-copies']), type: 'producer', meta: { [REACHES_META]: ['workflow:reserve-copies'], confidence: 'declared' } };
    expect(join([caller, workflow('loans', 'reserve-copies')]).edges[0]?.confidence).toBe('declared');
    const named = workflow('loans', 'reserve-copies', { nameConfidence: 'heuristic' });
    expect(join([caller, named]).edges[0]?.confidence).toBe('heuristic');
  });

  it('is no stronger than the name it joins on', () => {
    const caller = step('circulation', 'NotifyBorrower', ['workflow:borrower-notifications']);
    const named = workflow('notifications', 'borrower-notifications', { nameConfidence: 'heuristic' });
    expect(join([caller, named]).edges[0]?.confidence).toBe('heuristic');
  });

  it('writes a row and no edge for a name nothing declares', () => {
    const caller = step('circulation', 'CheckStanding', ['invoke:check-borrower-standing']);
    const { edges, rows } = join([caller]);
    expect(edges).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({
        service: 'circulation',
        file: 'flow.asl.json',
        line: 7,
        reason: 'reference-not-found',
        message: 'CheckStanding [Task] reaches the function check-borrower-standing, which no configured service declares',
        symbol: caller.id,
      }),
    ]);
  });

  it('writes a row and no edge for a name two services declare', () => {
    const caller = step('circulation', 'StartReturns', ['workflow:returns']);
    const { edges, rows } = join([caller, workflow('returns', 'returns'), workflow('archive', 'returns')]);
    expect(edges).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({
        reason: 'reference-ambiguous',
        meta: { reference: 'workflow:returns', candidates: ['entry:archive:workflow:returns', 'entry:returns:workflow:returns'] },
      }),
    ]);
  });

  it('does not join a reference to an entry of another kind with the same key', () => {
    const caller = step('circulation', 'Ask', ['workflow:returns']);
    const route: GraphNode = { id: 'entry:returns:event:returns', type: 'entry', kind: 'event', label: 'returns', repo: 'returns' };
    expect(join([caller, route]).rows.map((row) => row.reason)).toEqual(['reference-not-found']);
  });

  it('draws the edge a node says it reaches a reference by: a triggers edge, with the outcome it carries (P60)', () => {
    const caller: GraphNode = {
      ...step('lending', 'request-loan', []),
      meta: {
        [REACHES_META]: ['invoke:library-members-alert', 'workflow:restock'],
        [REACHED_AS_META]: { 'invoke:library-members-alert': { type: 'triggers', when: 'failure' }, 'workflow:restock': { when: 'failure' } },
      },
    };
    const alert: GraphNode = { id: 'entry:members:invoke:library-members-alert', type: 'entry', kind: 'invoke', label: 'invoke alert', repo: 'members' };
    const { edges, rows } = join([caller, alert, workflow('members', 'restock')]);
    expect(rows).toEqual([]);
    expect(edges.map(({ to, type, meta }) => [to, type, meta?.['when']])).toEqual([
      ['entry:members:invoke:library-members-alert', 'triggers', 'failure'],
      ['entry:members:workflow:restock', 'calls', 'failure'],
    ]);
  });

  it("joins a function created elsewhere into the node it hands its run on into (P60)", () => {
    const result: GraphNode = {
      id: 'consumer:lending#infra/main.tf#aws_lambda_function_event_invoke_config.alert.on_success',
      type: 'consumer',
      label: 'destination alert',
      repo: 'lending',
      file: 'infra/main.tf',
      line: 3,
      meta: { [RESULT_OF_META]: 'invoke:library-members-alert', when: 'success' },
    };
    const alert: GraphNode = { id: 'entry:members:invoke:library-members-alert', type: 'entry', kind: 'invoke', label: 'invoke alert', repo: 'members' };
    expect(join([result, alert]).edges).toEqual([
      {
        from: alert.id,
        to: result.id,
        type: 'triggers',
        confidence: 'static',
        file: 'infra/main.tf',
        line: 3,
        meta: { via: 'deployed-name', reference: 'invoke:library-members-alert', when: 'success' },
      },
    ]);
    expect(join([result]).rows.map((row) => row.reason)).toEqual(['reference-not-found']);
  });
});
