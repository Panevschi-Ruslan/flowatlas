/**
 * Answers that end the question (P403): where an answer settles what its
 * tool is asked, it says so in one short field, `settled`, and names no
 * further call.
 *
 * A pilot's costly sessions took a call the answer itself suggested, or
 * doubted an answer that was right: `who_calls` said where the request lands
 * (`requests: [{route, by}]`) and the agent still ran `get_flow` and a Read to
 * confirm it; `impact` said `complete: true` and the agent ran the channel's
 * impact, `check_contract` and `who_calls`, for what the first held. `complete: true` says no row is missing; `settled` says, in words,
 * what the rows add up to, and a `next` beside it was an invitation to check.
 *
 * Applied where every compact answer is handed on (`tool-listing.ts`), as
 * the compaction is: an answer asked `verbose: true` is as the tool wrote it.
 * Only a whole answer settles: one that says `complete: false`, an error, or
 * a page with more to come never does, and keeps its `next`.
 */

import { calledWith } from './query/next.js';

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/**
 * A route's id said aloud: `entry:shop-api:http:GET:/api/x` is
 * `GET /api/x (shop-api)`, any other way in its kind and key.
 */
export const routeAloud = (id: string): string => {
  const parts = /^entry:([^:@]+)(?:@[^:]+)?:([^:]+):(.*)$/.exec(id);
  if (parts === null) return id;
  const [, service, kind, key] = parts;
  const said = kind === 'http' ? key!.replace(':', ' ') : `${kind} ${key}`;
  return `${said} (${service})`;
};

/** The name a symbol's id ends in, `Class.method`, or the id where it names none. */
const nameOf = (id: string): string => {
  const at = id.lastIndexOf(':');
  return id.includes('#') && at > 0 ? id.slice(at + 1) : id;
};

/** Where the requests a method sends land, said in a few words, where every one is joined to a route (P377). */
const landedOf = (requests: unknown): string | undefined => {
  if (!Array.isArray(requests) || requests.length === 0) return undefined;
  const landed: string[] = [];
  for (const request of requests) {
    if (!isPlain(request) || typeof request.route !== 'string') return undefined;
    landed.push(typeof request.by === 'string' ? `${routeAloud(request.route)}, ${nameOf(request.by)}` : routeAloud(request.route));
  }
  return landed.length === 1 ? `its request lands on ${landed[0]}` : `its requests land on ${landed.join('; ')}`;
};

/** The ways in beyond the channels a walk did not cross, as `throughChannels` counts them (P378). */
const throughOf = (answer: Plain): string => {
  // Not summed: one way in beyond two consumers' channels is counted on each row.
  return Array.isArray(answer.throughChannels) && answer.throughChannels.length > 0 ? '; more beyond a channel, counted in throughChannels' : '';
};

/** How many rows a list holds. */
const rowsIn = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** impact: every way in that breaks is listed. */
const impactSettled = (answer: Plain): string | undefined => {
  if (!Array.isArray(answer.entries)) return undefined;
  const total = typeof answer.total === 'number' ? answer.total : rowsIn(answer.entries);
  return `${total === 0 ? 'no way in breaks' : `${total === 1 ? '1 way in breaks' : `${total} ways in break`}, all listed`}${throughOf(answer)}`;
};

/** who_calls: every way in that reaches it is listed, and where its requests land. */
const whoCallsSettled = (answer: Plain): string | undefined => {
  if (!Array.isArray(answer.waysIn)) return undefined;
  const ways = rowsIn(answer.waysIn);
  const landed = isPlain(answer.target) ? landedOf(answer.target.requests) : undefined;
  const reached = `${ways === 0 ? 'no way in reaches it' : `${ways === 1 ? '1 way in reaches it' : `${ways} ways in reach it`}, all listed`}${throughOf(answer)}`;
  return landed === undefined ? reached : `${landed}; ${reached}`;
};

/** A field a list's rows say is missing on one side, by the lists check_contract writes. */
const missingOf = (answer: Plain): number =>
  rowsIn(answer.missing) +
  rowsIn(isPlain(answer.answer) ? answer.answer.missing : undefined) +
  rowsIn(isPlain(answer.fields) ? answer.fields.missing : undefined);

/**
 * check_contract: the two ends compared with nothing left unread. A call's
 * edge settles where its types were compared or its fields read; a route on
 * its own does not (what each caller sends is the edge's call), nor several
 * channels at once.
 */
const contractSettled = (answer: Plain): string | undefined => {
  const missing = missingOf(answer);
  const findings = rowsIn(answer.findings);
  if (typeof answer.channel === 'string' && Array.isArray(answer.missing)) {
    return missing === 0 ? 'every field read is sent' : `${plural(missing, 'field')} read and sent by none: missing`;
  }
  if (!isPlain(answer.edge)) return undefined;
  const compared = answer.status === 'identical' || answer.status === 'shared';
  if (!compared && answer.complete !== true) return undefined;
  if (findings + missing > 0) return `${plural(findings + missing, 'difference')}, all listed`;
  if (answer.status === 'hash_differs') return undefined;
  return compared ? 'the two ends agree' : 'every field read is sent';
};

/** who_consumes and who_emits: every consumer (producer) there is, listed. */
const endsSettled =
  (key: 'consumers' | 'producers') =>
  (answer: Plain): string | undefined => {
    if (!Array.isArray(answer[key])) return undefined;
    const total = typeof answer.total === 'number' ? answer.total : rowsIn(answer[key]);
    const which = typeof answer.type === 'string' ? ` of ${answer.type}` : '';
    // A type nothing selects, sure by where its name is written (P404): that sentence is what settles it.
    if (total === 0 && answer.sureness === 'sure' && typeof answer.unselected === 'string') return answer.unselected;
    return total === 0 ? `no ${key.slice(0, -1)}${which}` : `${plural(total, key.slice(0, -1))}${which}, all listed`;
  };

/**
 * get_flow: where every request the walk crossed lands, each joined to a
 * route (P404), with no step it could not follow on a request's way. A cut
 * elsewhere in the tree leaves the flow unsure, not where its requests land:
 * the answer keeps `complete: false` and its `left`. A walk its depth
 * stopped may have more requests past it, and settles nothing.
 */
const flowSettled = (answer: Plain): string | undefined => {
  const landed = landedOf(answer.requests);
  if (landed === undefined) return undefined;
  const left = Array.isArray(answer.left) ? answer.left.filter((item): item is string => typeof item === 'string') : [];
  if (left.some((item) => (item.startsWith('unread:') && item.includes("on a request's way")) || /^[^:]*\bdepth\b[^:]*:/.test(item))) return undefined;
  return landed.replace(/^its request/, 'the request').replace(/^its requests/, 'the requests');
};

/** The tools a half answer may settle the part of: a flow's requests, whatever else was cut. */
const SETTLES_A_PART: ReadonlySet<string> = new Set(['get_flow']);

/** What settles each tool's answer, by tool: a tool not named here never says `settled`. */
const SETTLES: Readonly<Record<string, (answer: Plain) => string | undefined>> = {
  impact: impactSettled,
  who_calls: whoCallsSettled,
  check_contract: contractSettled,
  who_consumes: endsSettled('consumers'),
  who_emits: endsSettled('producers'),
  get_flow: flowSettled,
};

/** The tools an answer may settle. */
export const SETTLING_TOOLS: ReadonlySet<string> = new Set(Object.keys(SETTLES));

/**
 * The answer with `settled` first and no `next`, where it settles what its
 * tool is asked; as it was otherwise.
 */
export const settledAnswer = <T>(tool: string, answer: T): T => {
  const settles = SETTLES[tool];
  if (settles === undefined || !isPlain(answer)) return answer;
  const part = SETTLES_A_PART.has(tool) && answer.complete === false;
  if ((answer.complete === false && !part) || 'error' in answer || typeof answer.nextOffset === 'number') return answer;
  const settled = settles(answer);
  if (settled === undefined) return answer;
  // What is settled is said first and names no further call; what was cut keeps `complete: false` and its `left`.
  const { next: _next, ...rest } = answer;
  // Said once: `unselected` is the sentence `settled` already holds (P404).
  if (settled === rest.unselected) {
    delete rest.unselected;
    delete rest.sureness;
  }
  return { settled, ...rest } as T;
};

/**
 * `next` without a call that repeats what the answer, or another call in it,
 * already gives (P403): `describe_for_prompt` on the flow `get_flow` just
 * drew or names, the same steps written as a prompt for a person to paste.
 * Audited over every question of the answer budget: the rest add rows the
 * answer does not hold (a field's other end, the code of a dead row, the
 * callers' side of a contract). Applied before the compaction keeps two, so
 * a call that adds something takes the place.
 */
export const nextWithoutRepeats = <T>(tool: string, answer: T): T => {
  if (!isPlain(answer) || !Array.isArray(answer.next)) return answer;
  const hints = answer.next.filter((hint): hint is string => typeof hint === 'string');
  const flows = new Set<string>();
  // The flow drawn: its root, a tree row (`{node, children}`) before the compaction flattens it.
  const root = isPlain(answer.root) && isPlain(answer.root.node) ? answer.root.node : answer.root;
  if (tool === 'get_flow' && isPlain(root) && typeof root.id === 'string') flows.add(root.id);
  for (const hint of hints) {
    const call = calledWith(hint);
    if (call?.tool === 'get_flow') flows.add(call.value);
  }
  const next = hints.filter((hint) => {
    const call = calledWith(hint);
    return !(call?.tool === 'describe_for_prompt' && flows.has(call.value));
  });
  return next.length === answer.next.length ? answer : ({ ...answer, next } as T);
};
