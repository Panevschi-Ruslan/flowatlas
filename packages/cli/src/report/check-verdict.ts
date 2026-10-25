/**
 * Whether deploying the candidate side is safe, read off the comparison of
 * the deployed side with it (P117).
 *
 * The comparison is `diff`'s, so `check` and `diff` cannot disagree about
 * what changed: only who is asked differs. A reason is something the
 * candidate introduces against what runs - a contract error, a violation of
 * an architecture rule at `error`, a call or a channel end left with nothing
 * to join. What the deployed side already does wrong is somebody else's
 * incident (D1): listed under `already`, never failing the run.
 */
import { findingKey, type ContractFinding } from '@flowatlas/contracts';
import type { Confidence, GraphEdge, GraphNode } from '@flowatlas/core';
import {
  edgeKeyOf,
  NEVER_PRODUCED,
  ruleFailures,
  type CheckPlace,
  type CheckReason,
  type DiffReport,
  type LostJoin,
  type RuleViolation,
} from '@flowatlas/linker';
import { KEYS } from '../sarif/fingerprints.js';
import { partyPlace } from '../sarif/contracts.js';
import { contractBreaks } from './contract-delta.js';
import { ruleBreaks } from './rule-delta.js';

/** One side's graph, as much of it as a reason is placed and weighed with. */
export interface CheckGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** A graph looked up by node id and by edge key. */
interface Indexed {
  node(id: string): GraphNode | undefined;
  edge(from: string, type: string, to: string): GraphEdge | undefined;
}

const indexOf = (graph: CheckGraph): Indexed => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edgeKeyOf(edge), edge]));
  return {
    node: (id) => nodes.get(id),
    edge: (from, type, to) => edges.get(edgeKeyOf({ from, type, to })),
  };
};

const placeOfNode = (node: GraphNode | undefined): CheckPlace | undefined =>
  node?.file === undefined ? undefined : { service: node.repo, file: node.file, ...(node.line === undefined ? {} : { line: node.line }) };

const heuristic = (confidence: Confidence): boolean => confidence === 'heuristic';

/** A contract finding as a reason: placed at the sender, weighed by the edge it was checked along. */
const contractReason = (finding: ContractFinding, graph: Indexed): CheckReason => {
  const confidence = graph.edge(finding.edge.from, finding.edge.type, finding.edge.to)?.confidence ?? 'static';
  const placed = partyPlace(finding.sender, graph);
  const at: CheckPlace | undefined =
    placed === undefined || placed.file === ''
      ? undefined
      : { service: placed.service ?? finding.sender.service, file: placed.file, ...(placed.line === undefined || placed.line === 0 ? {} : { line: placed.line }) };
  return {
    kind: 'contract',
    code: finding.kind,
    message: `${finding.sender.service} → ${finding.receiver.service}: ${finding.message}${heuristic(confidence) ? ' (along a guessed edge)' : ''}`,
    key: findingKey(finding),
    service: finding.sender.service,
    ...(at === undefined ? {} : { at }),
    confidence,
    heuristic: heuristic(confidence),
  };
};

const ruleReason = (violation: RuleViolation): CheckReason => ({
  kind: 'rule',
  code: violation.rule,
  message: `${violation.rule}: ${violation.message}${violation.heuristic ? ' (along a guessed edge)' : ''}`,
  key: violation.key,
  service: violation.fromService,
  ...(violation.at === undefined
    ? {}
    : { at: { service: violation.at.service, file: violation.at.file, ...(violation.at.line === undefined ? {} : { line: violation.at.line }) } }),
  confidence: violation.confidence,
  heuristic: violation.heuristic,
});

const channelName = (id: string, graph: Indexed): string => graph.node(id)?.label ?? id.replace(/^channel:/, '');

/** What each kind of lost join is, said of the deploy rather than of a branch. */
const JOIN_SAY: Readonly<Record<LostJoin['kind'], (join: LostJoin, caller: string, target: string) => string>> = {
  // A request's own label is the route it asks for, so it is said once.
  'target-gone': (join, caller, target) =>
    `${join.service}${caller === target ? '' : ` ${caller}`} calls ${target}${join.targetService === null ? '' : ` on ${join.targetService}`}, which ${join.targetRemoved ? 'is gone' : 'it no longer reaches'} after this deploy (now ${join.now})`,
  'no-producer': (join, caller, target) =>
    join.now === NEVER_PRODUCED
      ? `${join.service} ${caller} is a new handler of ${target}, which nothing deployed publishes`
      : `${join.service} ${caller} handles ${target}, which nothing deployed publishes after this deploy`,
  'no-consumer': (join, caller, target) => `${join.service} ${caller} publishes ${target}, which nothing deployed handles after this deploy`,
};

/** The edge a lost join is weighed by: the deployed side's request, or the candidate's remaining end. */
const joinEdge = (join: LostJoin, deployed: Indexed, candidate: Indexed): GraphEdge | undefined => {
  if (join.kind === 'target-gone') return deployed.edge(join.caller, join.edge, join.target);
  if (join.edge === 'consumes') return candidate.edge(join.target, 'consumes', join.caller);
  return candidate.edge(join.caller, 'emits', join.target);
};

const joinReason = (join: LostJoin, deployed: Indexed, candidate: Indexed): CheckReason => {
  const callerNode = candidate.node(join.caller) ?? deployed.node(join.caller);
  const confidence = joinEdge(join, deployed, candidate)?.confidence ?? 'static';
  const target = join.kind === 'target-gone' ? (deployed.node(join.target)?.label ?? join.target) : channelName(join.target, candidate.node(join.target) === undefined ? deployed : candidate);
  const at = placeOfNode(callerNode);
  return {
    kind: 'join',
    code: join.kind,
    message: `${JOIN_SAY[join.kind](join, callerNode?.label ?? join.caller, target)}${heuristic(confidence) ? ' (along a guessed edge)' : ''}`,
    key: `join|${KEYS.join(join)}`,
    service: join.service === '' ? null : join.service,
    ...(at === undefined ? {} : { at }),
    confidence,
    heuristic: heuristic(confidence),
  };
};

/** The gap reasons of a request that joins no route: what a new call to nothing deployed is written as. */
export const NO_TARGET_REASONS: ReadonlySet<string> = new Set(['target-route-not-found', 'marker-route-not-found']);

/**
 * A request the candidate side added that joins no route anything deployed
 * serves: a join never made rather than one lost, read off the gap ids the
 * candidate has and the deployed side does not. A caller that lost its
 * target is `target-gone` already and not said twice.
 */
const noTargetReasons = (report: DiffReport, candidate: Indexed): CheckReason[] => {
  const lost = new Set(report.joins.lost.filter((join) => join.kind === 'target-gone').map((join) => join.caller));
  return report.unresolved.added
    .filter((ref) => ref.kind === 'gap' && NO_TARGET_REASONS.has(ref.reason) && (ref.node === undefined || !lost.has(ref.node)))
    .map((ref) => {
      const label = ref.node === undefined ? undefined : candidate.node(ref.node)?.label;
      return {
        kind: 'join',
        code: 'no-target',
        message: `${ref.service} ${label === undefined ? 'makes a request' : `calls ${label}`}, which nothing deployed serves (${ref.reason})`,
        key: `join|no-target|${ref.id}`,
        service: ref.service,
        at: { service: ref.service, file: ref.file, ...(ref.line === undefined ? {} : { line: ref.line }) },
        confidence: 'static',
        heuristic: false,
      };
    });
};

/** The reasons and the problems already running, and notes on what was listed and not counted. */
export interface CheckReasons {
  reasons: CheckReason[];
  already: CheckReason[];
  notes: string[];
}

/**
 * What deploying the candidate introduces, and what already runs.
 *
 * New contract errors, new rule violations at `error` (a guessed one only with
 * `failOnHeuristic`, as `diff --fail-on-rule-break`), every lost join, and
 * every new request that joins no deployed route: a
 * join along a guessed edge still counts and says so (I4), because the
 * alternative is a green tick resting on a guess nobody looked at.
 */
export const checkReasonsOf = (
  report: DiffReport,
  graphs: { deployed: CheckGraph; candidate: CheckGraph },
  options: { failOnHeuristic?: boolean } = {},
): CheckReasons => {
  const deployed = indexOf(graphs.deployed);
  const candidate = indexOf(graphs.candidate);
  const failOnHeuristic = options.failOnHeuristic === true;
  const newRules = ruleBreaks(report.rules, failOnHeuristic);
  const reasons = [
    ...contractBreaks(report.contracts).map((finding) => contractReason(finding, candidate)),
    ...newRules.map(ruleReason),
    ...report.joins.lost.map((join) => joinReason(join, deployed, candidate)),
    ...noTargetReasons(report, candidate),
  ];
  const already = [
    ...report.contracts.preexisting.filter((finding) => finding.severity === 'error').map((finding) => contractReason(finding, deployed)),
    ...ruleFailures({ violations: report.rules.existing, unchecked: [] }, 'error', failOnHeuristic).violations.map(ruleReason),
  ];
  const notes: string[] = [];
  const warned = report.contracts.new.filter((finding) => finding.severity !== 'error').length;
  if (warned > 0) notes.push(`${warned} new contract finding${warned === 1 ? '' : 's'} below error, in the document and not counted`);
  const guessed = report.rules.new.filter((item) => item.severity === 'error' && item.heuristic && !failOnHeuristic).length;
  if (guessed > 0) {
    notes.push(`${guessed} new rule violation${guessed === 1 ? '' : 's'} along a guessed edge, not counted without rulesSettings.failOnHeuristic`);
  }
  return { reasons, already, notes };
};
