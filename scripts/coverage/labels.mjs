/**
 * Whether a join is the right one, against call sites somebody labelled by hand.
 *
 * Every other figure in a report counts what was found and what joined. A join
 * to the wrong way in counts there exactly as a join to the right one does, so
 * a reader that learned to match a request onto the nearest route with a
 * similar path would raise every figure and lower the truth. The only thing
 * that can tell the two apart is a key written by somebody who read the code:
 * a list of call sites, each with the way in it reaches, written from the
 * source and before looking at what the graph says.
 *
 * ## The key
 *
 * One file per target, `labels/<target>.json`, gitignored beside
 * `targets.local.json` because it names other people's files; the format is
 * `labels.example.json`. A label is a call site - `file` relative to the
 * target's directory (`targets.mjs`), `line`, optionally `column`, and `text`,
 * a piece of the source on that line - with `kind`, the labeller's word for
 * what sort of call it is (the report groups by it), and `expect`:
 *
 *  - a way in: `http POST /api/cart`, `graphql Mutation.createOrder`,
 *    `rpc orders.get`, `event order.placed`, `invoke checkout`, or
 *    `channel <name>` for a queue or topic (with `job` beside it where a queue
 *    carries named jobs). A list of them when one call reaches several - a
 *    GraphQL operation selecting two root fields.
 *  - `none`: a call to something outside the system - a payment provider, a
 *    third party's API - that must not be joined to anything the graph serves.
 *    Recorded as an external API is right; joined to a way in is not.
 *  - `unread-ok`: a call nothing can know statically, where the right answer is
 *    a row saying so rather than a join.
 *
 * ## What each label comes out as
 *
 *  - **right**: the expected way in was reached and nothing else was (for
 *    `none`, nothing in the graph was; for `unread-ok`, nothing was and a row
 *    stands at the site).
 *  - **right, and also elsewhere**: the expected way in was reached together
 *    with another one.
 *  - **wrong**: something was reached and the expected way in was not.
 *  - **missed**: nothing was reached (for `unread-ok`, nothing was and no row
 *    says why either).
 *  - **falsely joined**: a `none` or `unread-ok` site joined to a way in.
 *  - **site not found**: the file is gone, or `text` is no longer anywhere in
 *    it. The repository moved under the label; it is listed, never dropped,
 *    because a key that quietly shrinks measures less every time it is run.
 *    A `text` found on another line moves the label there, and says so.
 *
 * Precision is the right joins over every join made at a labelled site.
 * Recall is the labels whose way in was reached over the labels that expect
 * one. The first asks whether what the tool joined was only the right thing;
 * the second whether the right thing was among what it joined.
 *
 * ## What counts as reached
 *
 * A site is the request, client call or producer the graph recorded at that
 * file and line - a `ui_api_call`, an `http_out` or a `producer` - and what
 * it reached is where its `hits`, `http_calls` and `emits` edges go. An entry
 * is the way in `<kind> <key>`; a channel is `channel <name>` and also every
 * way in its consumers answer as (a message pattern's `rpc` entry, a queue's
 * `event` entry), so a label may name either. A GraphQL request reaches its
 * endpoint and every field it selects; its root fields are what it is a call
 * of, so the endpoint and the nested fields are where it went through rather
 * than other places it went. An external API is recorded and is not a way in.
 *
 * Addresses are compared the way the graph keys them: `METHOD:/path` with
 * every parameter `:param` (`makeHttpKey`), so a label may spell a parameter
 * `:id`, `{id}`, `[id]`, `[...rest]`, `${id}` or `*`; a route keyed `ALL`, one
 * that answers every verb, answers the verb a label names. A GraphQL field is compared without the
 * endpoint the graph appends to it unless the label names one. A channel
 * name matches the channel's whole name or its last `/`-separated segments,
 * because a broker's channel is keyed by bus, source and name and a label
 * written from a call site names what the call site names.
 */

/** Node types that are a call somebody can label. */
const CALLERS = new Set(['ui_api_call', 'http_out', 'producer']);

/** Edges from a call to what it reached. */
const JOINS = new Set(['hits', 'http_calls', 'emits']);

/** The root types of a GraphQL schema: a field of one is what an operation is a call of. */
const ROOT_TYPES = ['Query.', 'Mutation.', 'Subscription.'];

/** The verb a route that answers every verb is keyed under. */
const ANY_VERB = new Set(['ALL', 'ANY', '*']);

const OUTCOMES = ['right', 'ambiguous', 'wrong', 'missed', 'falsely', 'drifted'];

/** One path segment that is a parameter, in any spelling a label or a framework uses. */
const PARAM = /^(?::.+|\{.+\}|\[.+\]|\$\{.*\}|\*.*|<.+>)$/;

const httpPath = (path) => {
  const bare = path.replace(/[?#].*$/, '');
  const segments = bare
    .split('/')
    .filter((segment, index) => segment !== '' || index === 0)
    .map((segment) => (PARAM.test(segment) ? ':param' : segment));
  const joined = segments.join('/');
  return joined === '' ? '/' : joined.startsWith('/') ? joined : `/${joined}`;
};

/**
 * A way in, as a label spells it or the graph keys it, in the one spelling
 * both are compared in: `{ kind, key }`, or `undefined` for text that is not
 * one.
 */
export const parseWay = (text) => {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  const space = trimmed.indexOf(' ');
  if (space < 0) return undefined;
  const kind = trimmed.slice(0, space).toLowerCase();
  const rest = trimmed.slice(space + 1).trim();
  if (rest === '') return undefined;
  if (kind === 'http') {
    const [method, ...path] = rest.split(/\s+/);
    if (path.length === 0) return undefined;
    return { kind, key: `${method.toUpperCase()} ${httpPath(path.join(' '))}` };
  }
  return { kind, key: rest };
};

/** The way an entry node is, from its id: `entry:<service>[@app]:<kind>:<key>`. */
const wayOfEntry = (node) => {
  const rest = node.id.slice('entry:'.length);
  const afterService = rest.slice(rest.indexOf(':') + 1);
  const cut = afterService.indexOf(':');
  const kind = afterService.slice(0, cut);
  const key = afterService.slice(cut + 1);
  if (kind === 'http') {
    const colon = key.indexOf(':');
    return { kind, key: `${key.slice(0, colon).toUpperCase()} ${httpPath(key.slice(colon + 1))}` };
  }
  return { kind, key };
};

const spell = (way) => `${way.kind} ${way.key}`;

/** Whether a reached way answers to the expected one. */
const answers = (expected, reached) => {
  if (expected.kind !== reached.kind) return false;
  if (expected.key === reached.key) return true;
  // A route that answers every verb answers the one the label names.
  if (expected.kind === 'http') {
    const [method, path] = reached.key.split(' ');
    return ANY_VERB.has(method) && expected.key.slice(expected.key.indexOf(' ') + 1) === path;
  }
  if (expected.kind === 'graphql' && !expected.key.includes('@')) {
    return reached.key.replace(/@.*$/, '') === expected.key;
  }
  if (expected.kind === 'channel') return reached.key.endsWith(`/${expected.key}`);
  return false;
};

const isRootField = (way) =>
  way.kind === 'graphql' && ROOT_TYPES.some((root) => way.key.startsWith(root));

/** The node id's column, where the id carries one: `<type>:<repo>#<file>:<line>:<col>[@…]`. */
const columnOf = (id) => {
  const at = id.indexOf('#');
  if (at < 0) return undefined;
  const match = /:(\d+):(\d+)(?:@.*)?$/.exec(id.slice(at + 1));
  return match === null ? undefined : Number(match[2]);
};

/**
 * Where a label's site is now: its line, or the line its `text` moved to, or
 * nothing when the file or the text is gone.
 */
const locate = (label, readSource) => {
  const source = readSource(label.file);
  if (source === undefined) return { found: false, why: 'the file is not in the clone' };
  if (typeof label.text !== 'string' || label.text === '') return { found: true, line: label.line };
  const lines = source.split('\n');
  if (lines[label.line - 1]?.includes(label.text)) return { found: true, line: label.line };
  let best;
  lines.forEach((text, index) => {
    if (!text.includes(label.text)) return;
    const line = index + 1;
    if (best === undefined || Math.abs(line - label.line) < Math.abs(best - label.line)) best = line;
  });
  if (best === undefined) return { found: false, why: `\`${label.text}\` is no longer in the file` };
  return { found: true, line: best, moved: label.line };
};

/**
 * What the graph says at every site, indexed once: callers and rows by
 * `file:line` in the target's spelling, and the ways each node reaches.
 */
const indexGraph = (graph, toPath) => {
  const nodes = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const out = new Map();
  for (const edge of graph.edges ?? []) {
    const list = out.get(edge.from) ?? [];
    list.push(edge);
    out.set(edge.from, list);
  }
  const callers = new Map();
  const callerLines = new Map();
  for (const node of nodes.values()) {
    if (!CALLERS.has(node.type) || typeof node.file !== 'string') continue;
    const file = toPath(node.file, node.repo);
    if (file === undefined) continue;
    const key = `${file}:${node.line}`;
    callers.set(key, [...(callers.get(key) ?? []), node]);
    callerLines.set(file, [...(callerLines.get(file) ?? []), node.line]);
  }
  const rows = new Map();
  const addRow = (file, line, row) => {
    if (typeof file !== 'string' || typeof line !== 'number') return;
    const path = toPath(file, row.service);
    if (path === undefined) return;
    const key = `${path}:${line}`;
    rows.set(key, [...(rows.get(key) ?? []), row]);
  };
  for (const row of graph.unresolved ?? []) {
    addRow(row.file, row.line, row);
    for (const cause of Array.isArray(row.meta?.causes) ? row.meta.causes : []) {
      for (const sample of Array.isArray(cause?.samples) ? cause.samples : []) {
        if (sample?.file !== row.file || sample?.line !== row.line) addRow(sample?.file, sample?.line, row);
      }
    }
  }
  /** Every way one reached node answers as, and whether it is a way in at all. */
  const waysOf = (node) => {
    if (node.type === 'entry') return [wayOfEntry(node)];
    if (node.type === 'channel') {
      const own = { kind: 'channel', key: node.id.slice('channel:'.length) };
      const consumers = (out.get(node.id) ?? [])
        .filter((edge) => edge.type === 'consumes')
        .map((edge) => nodes.get(edge.to)?.meta?.entryId)
        .filter((id) => typeof id === 'string' && nodes.has(id))
        .map((id) => wayOfEntry(nodes.get(id)));
      return [own, ...consumers];
    }
    return [];
  };
  return { nodes, out, callers, callerLines, rows, waysOf };
};

/**
 * What the calls at one site reached: `targets`, one per way in reached, each
 * with every way it answers as; `principal`, the targets the call is a call
 * of (its root fields, for a GraphQL request); `external`, what it reached
 * outside the system; and the job names its producers name.
 */
const reachedFrom = (index, calls) => {
  const targets = new Map();
  const external = [];
  const jobs = new Set();
  for (const call of calls) {
    if (typeof call.meta?.jobName === 'string') jobs.add(call.meta.jobName);
    for (const edge of index.out.get(call.id) ?? []) {
      if (!JOINS.has(edge.type)) continue;
      const node = index.nodes.get(edge.to);
      if (node === undefined) continue;
      if (node.type === 'external_api') {
        external.push(node.label ?? node.id);
        continue;
      }
      const ways = index.waysOf(node);
      if (ways.length > 0) targets.set(node.id, ways);
    }
  }
  const all = [...targets.values()];
  const roots = all.filter((ways) => isRootField(ways[0]));
  const principal = roots.length > 0 ? roots : all;
  return { all, principal, external, jobs: [...jobs] };
};

const describe = (targets) => {
  const names = targets.map((ways) => spell(ways[0]));
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
};

/** What stood at a site where nothing was reached, in words. */
const nothingThere = (index, file, line, calls, rows) => {
  if (rows.length > 0) return `a row: ${[...new Set(rows.map((row) => row.reason))].join(', ')}`;
  if (calls.length > 0) return 'read, and joined to nothing';
  const near = (index.callerLines.get(file) ?? [])
    .filter((other) => Math.abs(other - line) <= 3)
    .sort((a, b) => Math.abs(a - line) - Math.abs(b - line));
  return near.length === 0
    ? 'no call recorded at this line'
    : `no call recorded at this line (one at line ${near[0]})`;
};

/** One label against the graph. */
const judge = (index, label, readSource) => {
  const base = { file: label.file, line: label.line, kind: label.kind ?? 'unlabelled', expect: label.expect };
  if (label.job !== undefined) base.job = label.job;
  const where = locate(label, readSource);
  if (!where.found) return { ...base, outcome: 'drifted', got: where.why };
  const line = where.line;
  const site = `${label.file}:${line}`;
  let calls = index.callers.get(site) ?? [];
  if (typeof label.column === 'number') {
    const exact = calls.filter((call) => columnOf(call.id) === label.column);
    if (exact.length > 0) calls = exact;
  }
  const rows = index.rows.get(site) ?? [];
  const reached = reachedFrom(index, calls);
  const moved = where.moved === undefined ? {} : { line, movedFrom: where.moved };
  const joined = reached.all.length > 0;
  const got = joined
    ? describe(reached.principal)
    : reached.external.length > 0
      ? `outside the system: ${[...new Set(reached.external)].join(', ')}`
      : nothingThere(index, label.file, line, calls, rows);
  const result = (outcome) => ({ ...base, ...moved, outcome, got });
  if (label.expect === 'none') return result(joined ? 'falsely' : 'right');
  if (label.expect === 'unread-ok') {
    if (joined) return result('falsely');
    return result(rows.length > 0 ? 'right' : 'missed');
  }
  const expected = (Array.isArray(label.expect) ? label.expect : [label.expect]).map(parseWay);
  if (expected.some((way) => way === undefined)) {
    return { ...base, outcome: 'drifted', got: `\`${JSON.stringify(label.expect)}\` is not a way in this file can compare` };
  }
  if (!joined) return result('missed');
  const hit = (way) => reached.all.some((ways) => ways.some((candidate) => answers(way, candidate)));
  if (!expected.every(hit)) return result('wrong');
  if (label.job !== undefined && !reached.jobs.includes(label.job)) {
    return { ...result('wrong'), got: `${got}, job ${reached.jobs.join(', ') || 'unnamed'}` };
  }
  const extra = reached.principal.filter(
    (ways) => !ways.some((candidate) => expected.some((way) => answers(way, candidate))),
  );
  return extra.length === 0 ? result('right') : { ...result('ambiguous'), got: describe(reached.principal) };
};

const ratio = (top, bottom) => (bottom === 0 ? null : top / bottom);

/** Counts for a set of judged labels, with precision and recall. */
const tally = (judged) => {
  const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
  let expecting = 0;
  for (const row of judged) {
    counts[row.outcome] += 1;
    const positive = row.expect !== 'none' && row.expect !== 'unread-ok';
    if (positive && row.outcome !== 'drifted') expecting += 1;
  }
  const joinsMade = counts.right + counts.ambiguous + counts.wrong + counts.falsely;
  // `right` here is only the right joins: a `none` label left alone is right
  // and made no join, so it is no part of precision.
  const rightJoins = judged.filter(
    (row) => row.outcome === 'right' && row.expect !== 'none' && row.expect !== 'unread-ok',
  ).length;
  const madeJoins = joinsMade - (counts.right - rightJoins);
  return {
    labels: judged.length,
    ...counts,
    precision: ratio(rightJoins, madeJoins),
    recall: ratio(rightJoins + counts.ambiguous, expecting),
  };
};

/**
 * Judge every label of one target against its graph.
 *
 * `toPath(file, service)` turns a path as the graph spells it into the
 * target's spelling (`clonePaths` in `read-gate.mjs`); `readSource(file)` is
 * the text of a file of the target, or `undefined` where there is none. Both
 * are handed in, so this is tested on invented data and never touches a disk.
 */
export const judgeLabels = ({ labels, graph, toPath, readSource }) => {
  const index = indexGraph(graph, toPath);
  const judged = labels.map((label) => judge(index, label, readSource));
  const kinds = [...new Set(judged.map((row) => row.kind))].sort();
  return {
    rows: judged,
    byKind: kinds.map((kind) => ({ kind, ...tally(judged.filter((row) => row.kind === kind)) })),
    total: tally(judged),
  };
};

/**
 * A label file read and checked, or the reason it cannot be used.
 *
 * Refused whole rather than label by label where a label is not a label at
 * all - no file, no line - because a key with a hole in it measures something
 * other than what it says. A label whose site has moved is not refused: that
 * is a finding, and `judgeLabels` reports it.
 */
export const readLabels = (text, where) => {
  const parsed = JSON.parse(text);
  const labels = Array.isArray(parsed) ? parsed : parsed.labels;
  if (!Array.isArray(labels)) throw new Error(`${where}: no \`labels\` list`);
  labels.forEach((label, index) => {
    const missing = ['file', 'line', 'expect'].filter((field) => label[field] === undefined);
    if (missing.length > 0) {
      throw new Error(`${where}: label ${index + 1} has no ${missing.join(', ')}`);
    }
    if (typeof label.line !== 'number') throw new Error(`${where}: label ${index + 1} has a line that is not a number`);
  });
  return labels;
};

export { OUTCOMES };
