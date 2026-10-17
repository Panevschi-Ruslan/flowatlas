import type { DeadOptions, GraphDb } from '@flowatlas/linker';
import { byId } from './graph.js';

/*
 * The analysis behind `flowatlas dead` lives in the linker (P95), where the MCP
 * server's `dead` reads it too, so the two answers cannot disagree. Only the
 * fields section stays here: it asks the contracts checker at run time, which
 * the MCP server cannot reach without the CLI.
 */
export {
  classifyRoute,
  deadChannels,
  deadEntries,
  deadProviders,
  deadVerdict,
  ENTRY_CLASS_NAMES,
  EXTERNALLY_TRIGGERED,
  routeFactsOf,
  unresolvedInjectCount,
} from '@flowatlas/linker';
export type {
  DeadChannel,
  DeadConfidence,
  DeadEntry,
  DeadEvidence,
  DeadOptions,
  DeadProvider,
  DeadVerdict,
  EntryClassName,
  InfrastructureRole,
  InfrastructureRules,
  NearMiss,
  RouteClass,
  RouteFacts,
} from '@flowatlas/linker';

/** Which way a field was travelling when it crossed the boundary. */
export type FieldDirection = 'request' | 'response' | 'payload';

export interface DeadField {
  typeId: string;
  field: string;
  /** Edges the field was seen going over, as `from -> to`. */
  sentOn: string[];
  direction: FieldDirection;
  /**
   * Whether anything at the far end removes it.
   *
   * Not a guess from the direction: the contract checker reads the receiver's
   * `ValidationPipe` and says so, and this is that finding. A field the pipe
   * strips never lands, so the sender believes it sent something that arrived
   * and it did not. Everything else — a response nobody declares, a request
   * into a receiver that whitelists nothing — is carried, ignored, and removed
   * by no one. Counting the two together is what made this list 1,445 rows.
   */
  dropped: boolean;
  reason: string;
}

/** What each kind of row says about itself. Fully decided by the two fields above. */
const FIELD_TRAVEL: Record<FieldDirection, string> = {
  request: 'sent in a request the receiver does not declare; nothing there removes it',
  response: 'sent in a response nothing on the far side declares; read by nobody',
  payload: 'published in a payload nothing that handles the channel declares',
};

const STRIPPED = 'sent in a request the receiver whitelists; the pipe removes it on arrival';

export interface FieldsResult {
  fields: DeadField[];
  /** Set when the contracts package could not answer. */
  warning?: { reason: string; hint: string };
}

/**
 * As much of a contract finding as this section reads.
 *
 * Deliberately loose: the package that produces these is not a dependency, so
 * what arrives is whatever version happens to be installed.
 */
/**
 * The rules the contract checker fires when the receiving side removes a field.
 *
 * `whitelist-strip` is a validation pipe that does not declare it;
 * `class-transformer` is a receiver that excludes it. The mechanism differs and
 * the outcome does not: what the sender sent is thrown away before anything
 * reads it.
 */
const REMOVED_BY_RECEIVER = new Set(['whitelist-strip', 'class-transformer']);

/**
 * As much of a contract finding as this file reads.
 *
 * Loose on purpose: the checker is imported at run time, so its types are not
 * available here. `direction` has three values — a channel payload is neither a
 * request nor a response — and `rule` is how the checker says it read the
 * receiver's validation rather than guessed at it.
 */
interface ContractFinding {
  kind: string;
  field?: string;
  direction?: string;
  rule?: string;
  edge?: { from: string; to: string };
  edgeKey?: string;
  typeId?: string;
}

const directionOf = (said: string | undefined): FieldDirection =>
  said === 'request' || said === 'payload' ? said : 'response';

interface ContractsModule {
  checkContracts?: (db: GraphDb) => { findings: ContractFinding[] };
}

/**
 * Fields one service sends and the receiver does not declare.
 *
 * The question this section really wants — which declared fields nobody reads —
 * needs property access analysis inside every consumer and is not v1. What the
 * contract checker already knows is the other half of the same drift: a field
 * that goes over the wire and lands nowhere.
 *
 * The checker lives in a package this one does not depend on, so it is asked
 * for at run time and its absence is an answer rather than a crash.
 */
export const deadFields = async (db: GraphDb, options: DeadOptions = {}): Promise<FieldsResult> => {
  const unavailable: FieldsResult = {
    fields: [],
    warning: { reason: 'contracts-unavailable', hint: 'run after P10 / pnpm -r build' },
  };

  let findings: ContractFinding[];
  try {
    // The specifier is held in a variable so the type-checker does not try to
    // resolve a package that is not a dependency of this one.
    const specifier = '@flowatlas/contracts';
    const contracts = (await import(specifier)) as ContractsModule;
    if (typeof contracts.checkContracts !== 'function') return unavailable;
    findings = contracts.checkContracts(db).findings;
  } catch {
    return unavailable;
  }

  const rows = new Map<string, DeadField>();
  for (const finding of findings) {
    if (finding.kind !== 'extra_field' || finding.field === undefined) continue;
    const sender = finding.edge === undefined ? undefined : db.node(finding.edge.from);
    if (options.service !== undefined && sender?.repo !== options.service) continue;

    const typeId = finding.typeId ?? '';
    const direction = directionOf(finding.direction);
    // Keyed by direction as well: one field can be a request on one edge and a
    // channel payload on another, and those are two rows about two boundaries.
    const key = `${typeId}#${finding.field}#${direction}`;
    const on =
      finding.edgeKey ??
      (finding.edge === undefined ? '' : `${finding.edge.from} -> ${finding.edge.to}`);
    const dropped = finding.rule !== undefined && REMOVED_BY_RECEIVER.has(finding.rule);
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        typeId,
        field: finding.field,
        sentOn: on === '' ? [] : [on],
        direction,
        dropped,
        reason: dropped ? STRIPPED : FIELD_TRAVEL[direction],
      });
      continue;
    }
    if (on !== '' && !existing.sentOn.includes(on)) existing.sentOn.push(on);
    // One receiver removing it is enough to make it the finding the list is
    // for, whichever edge the checker happened to report first.
    if (dropped && !existing.dropped) {
      existing.dropped = true;
      existing.reason = STRIPPED;
    }
  }

  for (const row of rows.values()) row.sentOn.sort(byId);
  // What is removed first, as everywhere else in this command: the rows
  // something happens to above the rows nothing happens to, so a reader who
  // stops at the top has read the findings.
  return {
    fields: [...rows.values()].sort(
      (a, b) =>
        Number(b.dropped) - Number(a.dropped) ||
        byId(a.typeId, b.typeId) ||
        byId(a.field, b.field),
    ),
  };
};
