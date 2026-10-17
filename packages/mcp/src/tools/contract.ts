import type { GraphEdge } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withNext } from '../query/next.js';
import { commonInput, READ_ONLY, withDb, type ContractFinding, type ToolContext } from './common.js';

/**
 * A finding as it goes out (P93): what disagrees and how. The checker's own
 * finding names the edge, its key and both parties on every row, and the
 * answer names the edge once at the top.
 */
export const wireFinding = (finding: ContractFinding): ContractFinding => ({
  severity: finding.severity,
  kind: finding.kind,
  direction: finding.direction,
  field: finding.field,
  expected: finding.expected,
  actual: finding.actual,
  message: finding.message,
  ...(finding.ignored === true ? { ignored: true } : {}),
});

/**
 * How well the two ends of an edge agree about what crosses it.
 *
 * `shared` means neither end owns the declaration: both import it from a
 * package the project shares, so they cannot drift apart. `identical` means two
 * separate declarations that happen to have the same shape today.
 */
export type ContractStatus = 'shared' | 'identical' | 'hash_differs' | 'unchecked';

/** One direction of the exchange, and how well the two ends agree about it. */
export interface ContractSide {
  status: ContractStatus;
  left?: string;
  right?: string;
  note?: string;
}

/** A type id, as opposed to a bare `string` or `object` the reader wrote down. */
const isTypeId = (value: string | undefined): value is string => value?.startsWith('type:') === true;

export const classify = (
  db: GraphDb,
  left: string | undefined,
  right: string | undefined,
): ContractSide => {
  const both = { ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) };
  if (!isTypeId(left) || !isTypeId(right)) {
    const missing = !isTypeId(left) ? 'sending' : 'receiving';
    return {
      status: 'unchecked',
      ...both,
      note: `the ${missing} side declares no named type`,
    };
  }
  if (left === right) {
    const shared = db.type(left)?.meta?.['sharedPackage'];
    return typeof shared === 'string'
      ? { status: 'shared', ...both, note: `both sides import it from ${shared}` }
      : { status: 'identical', ...both };
  }
  const a = db.type(left);
  const b = db.type(right);
  if (a === undefined || b === undefined) {
    return { status: 'unchecked', ...both, note: 'a type id on the edge is not in the registry' };
  }
  return {
    status: a.structuralHash === b.structuralHash ? 'identical' : 'hash_differs',
    ...both,
  };
};

/** The worse of two verdicts, so one number says whether to look closer. */
const RANK: Record<ContractStatus, number> = {
  shared: 0,
  identical: 1,
  unchecked: 2,
  hash_differs: 3,
};

const worse = (a: ContractStatus, b: ContractStatus): ContractStatus => (RANK[a] >= RANK[b] ? a : b);

/**
 * What crosses the edge, in both directions.
 *
 * A request has two halves and they fail differently: the caller can send a
 * body the handler cannot read, and the handler can answer with a shape the
 * caller does not expect. Both are checked, because fixing one says nothing
 * about the other.
 */
const sidesOf = (
  db: GraphDb,
  edge: GraphEdge,
): { request: ContractSide; response: ContractSide } => {
  const handler = db.edgesFrom(edge.to, ['handles'])[0];
  return {
    request: classify(db, edge.params?.[0], handler?.params?.[0]),
    response: classify(db, edge.returns, handler?.returns),
  };
};

/** `from -type-> to`, the way an edge is named when one is asked for by hand. */
const parseEdgeRef = (ref: string): { from: string; type?: string; to: string } | undefined => {
  const arrow = /^(.*?)\s*-([a-z_]+)->\s*(.*)$/.exec(ref.trim());
  if (arrow !== null) {
    return { from: (arrow[1] ?? '').trim(), type: arrow[2], to: (arrow[3] ?? '').trim() };
  }
  const plain = ref.split('->');
  if (plain.length !== 2) return undefined;
  return { from: (plain[0] ?? '').trim(), to: (plain[1] ?? '').trim() };
};

export const registerContract = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'check_contract',
    {
      title: 'Check a contract',
      description: 'Whether what one side of a crossing sends is what the other side expects.',
      inputSchema: {
        edge: z.string().optional().describe('"<from> -http_calls-> <to>"'),
        from: z.string().optional(),
        to: z.string().optional(),
        // `maxNodes` only. This answers about one crossing, so there is no tree
        // to thin and `detail` had nothing to apply itself to — it was declared,
        // ignored, and answered `detail: 3` with a note saying the level had
        // been clamped. A knob accepted and not read is worse than one absent.
        maxNodes: commonInput.maxNodes,
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const parsed =
          input.edge !== undefined
            ? parseEdgeRef(input.edge)
            : input.from !== undefined && input.to !== undefined
              ? { from: input.from, to: input.to }
              : undefined;
        if (parsed === undefined) {
          return { error: 'give either edge, or both from and to' };
        }

        const candidates = db
          .edgesFrom(parsed.from)
          .filter((edge) => edge.to === parsed.to)
          .filter((edge) => parsed.type === undefined || edge.type === parsed.type);
        const edge = candidates[0];
        if (edge === undefined) {
          return { error: `no edge from ${parsed.from} to ${parsed.to}` };
        }

        const { request, response } = sidesOf(db, edge);
        const status = worse(request.status, response.status);
        const hash = (id?: string): { id: string; structuralHash: string } | undefined =>
          id === undefined ? undefined : { id, structuralHash: db.type(id)?.structuralHash ?? '' };
        const findings =
          ctx.contractChecker?.({
            edge: { from: edge.from, to: edge.to, type: edge.type },
            ...(hash(response.left) === undefined ? {} : { left: hash(response.left)! }),
            ...(hash(response.right) === undefined ? {} : { right: hash(response.right)! }),
          }) ?? [];

        const shown = findings.slice(0, input.maxNodes).map(wireFinding);
        const shapes = [request.left, request.right, response.left, response.right].filter(
          (id): id is string => typeof id === 'string' && id.startsWith('type:'),
        );
        return withNext({
          edge: { from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence },
          status,
          request,
          response,
          findings: shown,
          ...(findings.length === shown.length
            ? {}
            : { cut: `${findings.length - shown.length} more finding(s); raise maxNodes` }),
        }, [...new Set(shapes)].slice(0, 2).map((id) => `get_type({type: ${JSON.stringify(id)}})`));
      }),
  );
};
