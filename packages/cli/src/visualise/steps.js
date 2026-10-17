/*
 * A way in as the steps it takes, and the same as text for an assistant.
 *
 * Pure functions over the model graph.js builds, written into the page's one
 * module script by the command and imported as they are by a test. Every name
 * at the top level is the page's too, so each one says what it is for.
 *   stepKindOf    what a node is, as the Steps view draws it
 *   stepInline    the table, address or channel a step names
 *   stepsOf       a way in, depth first in call order: a waterfall of rows
 *   createSeen    what was seen at run time, when the pack carries it
 *   promptFor     a way in, a channel or a check row as bounded Markdown
 *   failsOf       what a way in can fail with, failGroups each answer once, failChips the statuses
 *   logsOf        the lines a step logs
 *   scheduleOf    when a scheduled way in fires, and in which zone
 *   accessOf      what stands in front of a way in, and from where
 *   acceptCommandFor  the `flowatlas accept` line that takes every gap like one
 */

/** What each kind of step is drawn as, and called. */
export const STEP_KINDS = Object.freeze({
  handler: Object.freeze({ glyph: 'in', say: 'handler' }),
  service: Object.freeze({ glyph: 'fn', say: 'service' }),
  db: Object.freeze({ glyph: 'db', say: 'store' }),
  http: Object.freeze({ glyph: 'http', say: 'outbound call' }),
  channel: Object.freeze({ glyph: 'ch', say: 'queue or topic' }),
  lambda: Object.freeze({ glyph: 'λ', say: 'function' }),
  workflow: Object.freeze({ glyph: 'wf', say: 'workflow' }),
  answer: Object.freeze({ glyph: '!', say: 'answer' }),
  break: Object.freeze({ glyph: '✕', say: 'chain breaks' }),
  other: Object.freeze({ glyph: '·', say: 'step' }),
});

const STEP_BY_TYPE = Object.freeze({
  entry: 'handler', ui_action: 'handler', ui_component: 'handler',
  method: 'service', provider: 'service', function: 'service',
  db_query: 'db', table: 'db', cache_op: 'db',
  http_out: 'http', external_api: 'http', ui_api_call: 'http',
  channel: 'channel', producer: 'channel', consumer: 'channel',
});

const STEP_BY_ENTRY_KIND = Object.freeze({ invoke: 'lambda', workflow: 'workflow' });

/** The edges a waterfall follows: what runs next, not what is imported or injected. */
const STEP_FOLLOWS = Object.freeze(new Set(['handles', 'calls', 'queries', 'caches', 'emits', 'consumes',
  'http_calls', 'hits', 'triggers']));

/** Proven or written down in the code; the rest are best guesses, or seen. */
const STEP_CERTAIN = Object.freeze(new Set(['static', 'marker']));

/** How far a waterfall goes, and how long it gets, unless asked otherwise. */
export const STEP_BOUNDS = Object.freeze({ depth: 12, rows: 300 });

const stepTypeOf = (model, i) => model.data.dicts.types[model.nodes[i][0]];

/** A node's metadata field by its short key, an enumerated one as its word. */
export const stepField = (model, i, key) => {
  const meta = model.nodes[i][6];
  if (!meta || meta[key] === undefined) return undefined;
  const value = meta[key];
  if (!model.stepEnumerated) model.stepEnumerated = new Set(model.data.dicts.enumerated || []);
  return model.stepEnumerated.has(key) && typeof value === 'number' ? model.data.dicts.values[value] : value;
};

/** What a node is, as the Steps view draws it. */
export const stepKindOf = (model, i) => {
  const type = stepTypeOf(model, i);
  const kind = model.data.dicts.kinds[model.nodes[i][3]] || '';
  if (type === 'entry') return STEP_BY_ENTRY_KIND[kind] || 'handler';
  if (type === 'function') {
    if (kind === 'state' || stepField(model, i, 'st') !== undefined) return 'workflow';
    if (stepField(model, i, 'rn') !== undefined) return 'lambda';
  }
  return STEP_BY_TYPE[type] || 'other';
};

const STEP_INLINE = Object.freeze({
  db: (model, i) => {
    const table = stepField(model, i, 'tb');
    const op = stepField(model, i, 'op');
    if (table === undefined) return stepTypeOf(model, i) === 'table' ? model.nodes[i][1] : '';
    return op === undefined ? String(table) : op + ' ' + table;
  },
  http: (model, i) => {
    const method = stepField(model, i, 'm');
    const where = stepField(model, i, 'p') ?? stepField(model, i, 'h');
    if (where === undefined) return '';
    return (method === undefined ? '' : method + ' ') + where;
  },
  channel: (model, i) => (stepTypeOf(model, i) === 'channel' ? model.nodes[i][1] : String(stepField(model, i, 'k') ?? '')),
});

/** The table, the address or the channel a step names, or '' for none. */
export const stepInline = (model, i) => {
  const say = STEP_INLINE[stepKindOf(model, i)];
  return say ? say(model, i) : '';
};

const NO_SITES = Object.freeze({ order: [], failure: [], concurrent: [], loop: [] });

const sitesOf = (model) => {
  if (!model.stepSites) {
    const sites = model.data.sites || NO_SITES;
    model.stepSites = {
      order: sites.order, failure: new Set(sites.failure), concurrent: new Set(sites.concurrent),
      loop: new Map((sites.loop || []).map(([k, kind, line]) => [k, { kind, line }])),
    };
  }
  return model.stepSites;
};

/* ── What a way in can fail with, what a step logs, when a job fires (P68, P71) ── */

const NO_FAILS = Object.freeze([]);

/** What a way in can fail with, `{ s?, x, at, id?, f?, l?, src }`, as `createModel` expanded it. */
export const failsOf = (model, entry) => (model.fails && model.fails.get(entry)) || NO_FAILS;

/**
 * Each status and exception a way in fails with once, by status then
 * exception: `{ s?, x, a?, srcs, n, sites }`, `a` only when every site is
 * assumed, `n` how many places raise it (P87).
 */
export const failGroups = (fails) => {
  const byKey = new Map();
  for (const fail of fails) {
    const key = (fail.s === undefined ? '' : fail.s) + ' ' + fail.x;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(fail);
  }
  return [...byKey.values()].map((sites) => ({
    ...(sites[0].s === undefined ? {} : { s: sites[0].s }), x: sites[0].x,
    ...(sites.every((f) => f.a) ? { a: 1 } : {}),
    srcs: [...new Set(sites.map((f) => f.src))], n: sites.length, sites,
  })).sort((a, b) => (a.s ?? 1000) - (b.s ?? 1000) || (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
};

/**
 * The statuses a way in can fail with, lowest first and each once, then the
 * exceptions that name no status: what a chip line says. A status every place
 * only assumes is `500?`.
 */
export const failChips = (fails) => {
  // What a helper can choose stands for it where it says no one status (P90).
  const answers = fails.flatMap((f) => (f.s === undefined && f.ch && f.ch.some((c) => c.s !== undefined) ? f.ch : [f]));
  const statuses = [...new Set(answers.filter((f) => f.s !== undefined).map((f) => f.s))].sort((a, b) => a - b);
  const bare = [...new Set(answers.filter((f) => f.s === undefined).map((f) => f.x))].sort();
  const assumed = (s) => answers.every((f) => f.s !== s || f.a);
  return [...statuses.map((s) => s + (assumed(s) ? '?' : '')), ...bare];
};

/** `401 | 403 | 423`: what a helper can choose, each status once, `?` where only assumed (P90). */
export const choiceStatuses = (fail) => {
  const choices = fail.ch || [];
  const statuses = [...new Set(choices.filter((c) => c.s !== undefined).map((c) => c.s))].sort((a, b) => a - b);
  return statuses.map((s) => s + (choices.every((c) => c.s !== s || c.a) ? '?' : '')).join(' | ');
};

/** The failures of a way in written in one node, by that node's position. */
const failsByNode = (fails) => {
  const out = new Map();
  for (const fail of fails) if (fail.at >= 0) out.set(fail.at, [...(out.get(fail.at) || []), fail]);
  return out;
};

/**
 * A failure as a few words: `409 ConflictException`, `500? Error`, the
 * exception alone, or a helper with what it can choose, `toHttpError (401 | 403
 * | 423)` (P90).
 */
export const failSay = (fail) => {
  if (fail.v === 'helper' && fail.s === undefined) {
    const statuses = choiceStatuses(fail);
    return statuses ? fail.x + ' (' + statuses + ')' : fail.fam === 'auth' ? fail.x + ' (refuses who is asking)' : fail.x;
  }
  return fail.s === undefined ? fail.x : fail.s + (fail.a ? '? ' : ' ') + fail.x;
};

const NO_LOGS = Object.freeze([]);

/** A packed word, as graph.js's `wordIn`: a position in `list`, or the word itself. */
const stepWord = (list, word) => (typeof word === 'number' ? list[word] : word);

/** The lines a node logs, `{ level, line, text }`, in the order the code writes them. */
export const logsOf = (model, i) => {
  const list = model.data.logs && model.data.logs[i];
  const { logLevels: lv, logTexts: tx } = model.data.dicts;
  return list
    ? list.map(([level, line, text]) => ({ level: stepWord(lv, level), line, text: text === undefined ? '' : stepWord(tx, text) }))
    : NO_LOGS;
};

/** When a scheduled way in fires and in which zone, `{ expression, zone }`, or null. */
export const scheduleOf = (model, i) => {
  const expression = stepField(model, i, 'ex');
  if (expression === undefined) return null;
  const zone = stepField(model, i, 'tz');
  return { expression: String(expression), zone: zone === undefined ? '' : String(zone) };
};

const QUERY_IN_LOOP = 'query-in-loop';

/** The lines a query-in-loop row sits at, on the node whose loop it names. */
const nPlusOneLines = (model, i) => {
  const { reasons } = model.data.dicts;
  const lines = [];
  for (const r of model.rowsOn.get(i) || []) {
    const row = model.data.rows[r];
    if (reasons[row[4]] === QUERY_IN_LOOP) lines.push(row[3]);
  }
  return lines;
};

/**
 * Whether an edge run per item is the one a query-in-loop row flags: the row
 * sits on the caller, at the line of the call or the loop's own.
 */
const isNPlusOne = (model, k, loop) => {
  if (!loop) return false;
  const lines = nPlusOneLines(model, model.edges[k][0]);
  if (lines.length === 0) return false;
  const { order } = sitesOf(model);
  return lines.some((line) => line === order[k] || line === loop.line || line === 0);
};

/**
 * The edges out of a node a waterfall follows, in call order: a workflow's
 * own order or the line of the call first, the place of what it reaches
 * after, and anything with neither last.
 */
const stepChildren = (model, i) => {
  const { edgeTypes } = model.data.dicts;
  const { order } = sitesOf(model);
  return model.outgoing[i]
    .filter((k) => STEP_FOLLOWS.has(edgeTypes[model.edges[k][2]]))
    .sort((a, b) => {
      const ka = placeAmongSiblings(model, order, a), kb = placeAmongSiblings(model, order, b);
      if (ka !== kb) return ka - kb;
      const la = model.nodes[model.edges[a][1]][5] || Infinity, lb = model.nodes[model.edges[b][1]][5] || Infinity;
      return la - lb || a - b;
    });
};

/** Where an edge sits among its siblings; a workflow's first step is 0, which is a place, not an absence. */
const placeAmongSiblings = (model, order, k) => {
  const at = order[k] ?? 0;
  return at > 0 || stepKindOf(model, model.edges[k][0]) === 'workflow' ? at : Infinity;
};

const NO_SEEN = Object.freeze({
  any: false, most: 0, unmatched: Object.freeze([]), ambiguous: Object.freeze([]),
  join: () => null, entry: () => 0,
});

/** What ran but is not in code, `{ service?, kind, name }`; a service of -1 is none. */
export const unmatchedOf = ({ unmatched = [], services, kinds }) =>
  unmatched.map(([s, kind, name]) =>
    ({ ...(s === -1 ? {} : { service: stepWord(services, s) }), kind: stepWord(kinds, kind), name }));

/** What fit several places and was counted on none (P85); `places` are edges for a join, nodes otherwise. */
export const ambiguousOf = ({ ambiguous = [], services, kinds }) =>
  ambiguous.map(([s, kind, name, count, places, unnamed = 0]) =>
    ({ ...(s === -1 ? {} : { service: stepWord(services, s) }), kind: stepWord(kinds, kind), name, count, places, unnamed }));

/**
 * What was seen at run time, from the pack's `observed` (P65), or nothing.
 * A join is named by its edge's position, an entry by its id.
 */
export const createSeen = (data) => {
  const observed = data.observed;
  if (!observed) return NO_SEEN;
  const joins = new Map();
  for (const [id, value] of Object.entries(observed.joins || {})) {
    const k = Number(id);
    if (Number.isInteger(k) && String(k) === id && k < data.edges.length) {
      joins.set(k, { count: value.count || 0, lastSeen: value.lastSeen || '' });
    }
  }
  const hits = new Map();
  for (const [id, value] of Object.entries(observed.entries || {})) {
    const at = data.entryIds ? data.entryIds[id] : undefined;
    if (at !== undefined) hits.set(at, value.hits || 0);
  }
  const most = Math.max(0, ...[...joins.values()].map((join) => join.count));
  return {
    any: true,
    most,
    unmatched: Object.freeze(unmatchedOf(observed)),
    ambiguous: Object.freeze(ambiguousOf(observed)),
    join: (k) => joins.get(k) || null,
    entry: (i) => hits.get(i) || 0,
  };
};

/**
 * A way in as a waterfall: depth first, in call order, one row per step.
 *
 * A row says what it is (`kind`, `inline`), how it was joined (`confidence`,
 * `certain`), whether it runs only on a failure - or under one, since what a
 * failure path calls fails with it - and whether it runs beside its siblings.
 * A step reached a second time is listed once more as `again` and not walked
 * twice; a step already on its own path is a `loop`. A route's failure
 * answers come first, under the handler, the way a waterfall shows its
 * failing spans first.
 *
 * `options`: `{ depth, rows, answersOf(model, i), seen }`.
 */
export const stepsOf = (model, entry, options = {}) => {
  const depth = options.depth ?? STEP_BOUNDS.depth;
  const cap = options.rows ?? STEP_BOUNDS.rows;
  const answersOf = options.answersOf || (() => []);
  const seen = options.seen || NO_SEEN;
  const { confidences } = model.data.dicts;
  const { failure, concurrent, loop: loops } = sitesOf(model);
  const throwsAt = failsByNode(failsOf(model, entry));
  const rows = [{
    node: entry, depth: 0, edge: -1, parent: -1, kind: stepKindOf(model, entry), inline: stepInline(model, entry),
    confidence: '', certain: true, failure: false, together: false, again: false, loop: false, crosses: false,
    seen: seen.entry(entry), answer: null, perItem: '', nPlusOne: false,
    throws: throwsAt.get(entry) || NO_FAILS, logs: logsOf(model, entry),
  }];
  for (const answer of answersOf(model, entry)) {
    if (answer.kind !== 'failure') continue;
    rows.push({
      node: entry, depth: 1, edge: -1, parent: 0, kind: 'answer', inline: String(answer.status),
      confidence: '', certain: true, failure: true, together: false, again: false, loop: false, crosses: false,
      seen: 0, answer, perItem: '', nPlusOne: false, throws: NO_FAILS, logs: NO_LOGS,
    });
  }
  const opening = stepBreakOf(model, entry);
  if (opening) rows.push(breakRow(rows[0], 0, opening));
  let more = 0;
  const walked = new Set([entry]);
  const stack = stepChildren(model, entry).reverse().map((k) => ({ k, parent: 0, path: [entry] }));
  while (stack.length > 0) {
    const { k, parent, path } = stack.pop();
    if (rows.length >= cap) {
      more += 1;
      continue;
    }
    const e = model.edges[k];
    const to = e[1];
    const up = rows[parent];
    const confidence = confidences[e[3]];
    const loop = path.includes(to);
    const again = !loop && walked.has(to);
    const join = seen.join(k);
    const row = {
      node: to, depth: up.depth + 1, edge: k, parent, kind: stepKindOf(model, to), inline: stepInline(model, to),
      confidence, certain: STEP_CERTAIN.has(confidence), failure: up.failure || failure.has(k),
      together: concurrent.has(k), again, loop, crosses: model.nodes[to][2] !== model.nodes[up.node][2],
      seen: join ? join.count : 0, answer: null,
      perItem: loops.has(k) ? loops.get(k).kind : '', nPlusOne: isNPlusOne(model, k, loops.get(k)),
      throws: again || loop ? NO_FAILS : throwsAt.get(to) || NO_FAILS, logs: again || loop ? NO_LOGS : logsOf(model, to),
    };
    rows.push(row);
    if (loop || again) continue;
    walked.add(to);
    const broken = stepBreakOf(model, to);
    if (broken) rows.push(breakRow(row, rows.length - 1, broken));
    if (row.depth >= depth) {
      more += stepChildren(model, to).length;
      continue;
    }
    const at = rows.length - 1;
    const next = [...path, to];
    for (const child of stepChildren(model, to).reverse()) stack.push({ k: child, parent: at, path: next });
  }
  return { rows, more };
};

/* ── Where a chain breaks (P73) ── */

/** A check row's reason, as the few words a broken chain is marked with; first match wins. */
const BREAK_SAYS = Object.freeze([
  [/route.*not-found|target-route-not-found|marker-route-not-found/, 'no route'],
  [/not-found/, 'nothing found'],
  [/ambiguous/, 'more than one target'],
  [/dynamic|partly|environment|unknown|unread/, 'unresolved'],
]);

/** Kinds of step that should lead somewhere, and what it means when one does not. */
const BREAK_WHEN_LEAF = Object.freeze({
  http: (model, i) => stepTypeOf(model, i) !== 'external_api' && 'unresolved',
  handler: (model, i) => stepTypeOf(model, i) === 'entry' && 'no handler',
  channel: (model, i) => stepTypeOf(model, i) === 'channel' && 'no handler',
});

/**
 * Why a chain stops at this step, or null when it goes on or ends where it
 * should. Only a step with nothing after it can break; a row of the checks
 * on it says why best, and failing that a call or a way in that leads
 * nowhere is a break in itself.
 */
export const stepBreakOf = (model, i) => {
  if (stepChildren(model, i).length > 0) return null;
  const { reasons } = model.data.dicts;
  for (const r of model.rowsOn.get(i) || []) {
    const reason = reasons[model.data.rows[r][4]];
    const found = BREAK_SAYS.find(([test]) => test.test(reason));
    if (found) return { say: found[1], reason, message: String(model.data.rows[r][7]) };
  }
  const leaf = BREAK_WHEN_LEAF[stepKindOf(model, i)];
  const say = leaf ? leaf(model, i) : false;
  return say ? { say, reason: '', message: '' } : null;
};

const breakRow = (row, at, broken) => ({
  node: row.node, depth: row.depth + 1, edge: -1, parent: at, kind: 'break', inline: broken.say,
  confidence: '', certain: true, failure: true, together: false, again: false, loop: false, crosses: false,
  seen: 0, answer: null, perItem: '', nPlusOne: false, throws: NO_FAILS, logs: NO_LOGS,
  reason: broken.reason, message: broken.message,
});

/* ── Copy as prompt (P67) ── */

/** How long a prompt may get, in characters, and how many of each list it names. */
export const PROMPT_BOUNDS = Object.freeze({ chars: 8000, steps: 80, gaps: 20, consumers: 4 });

const PROMPT_MARKS = Object.freeze([
  [(row) => !row.certain && row.confidence !== '', (row) => 'best guess: ' + row.confidence],
  [(row) => row.failure, () => 'on failure'],
  [(row) => row.together, () => 'side by side'],
  [(row) => row.perItem !== '', (row) => 'per item (' + row.perItem + ')'],
  [(row) => row.nPlusOne, () => 'likely N+1'],
  [(row) => row.throws.length > 0, (row) => 'throws ' + row.throws.map(failSay).join(', ')],
  [(row) => row.seen > 0, (row) => 'seen ×' + row.seen],
  [(row) => row.again, () => 'listed above'],
  [(row) => row.loop, () => 'loops back'],
]);

/** A node's place, repository first, then its repo-relative `file:line`. */
export const placeOfStep = (model, i) => {
  const file = model.data.dicts.files[model.nodes[i][4]];
  const repo = model.data.dicts.repos[model.nodes[i][2]];
  if (!file) return repo;
  const line = model.nodes[i][5];
  return `${repo}: ${file}${line ? ':' + line : ''}`;
};

const tick = (text) => '`' + String(text).replace(/`/g, "'") + '`';

const stepLine = (model, row) => {
  if (row.kind === 'break') {
    return '  '.repeat(row.depth) + `- chain breaks here: ${row.inline}` + (row.message ? ` (${row.message})` : '');
  }
  const label = row.kind === 'answer' ? 'answers ' + row.inline : model.nodes[row.node][1];
  const inline = row.inline && row.kind !== 'answer' && row.inline !== label ? ' → ' + tick(row.inline) : '';
  const marks = PROMPT_MARKS.filter(([when]) => when(row)).map(([, say]) => say(row));
  const pad = '  '.repeat(row.depth);
  const logs = row.logs.map((log) => `${pad}  - logs ${log.level}` + (log.text ? ' ' + tick(log.text) : '') +
    (log.line ? ' at line ' + log.line : ''));
  return [pad + `- ${STEP_KINDS[row.kind].say} ${tick(label)}${inline}` +
    (row.kind === 'answer' ? '' : ' at ' + tick(placeOfStep(model, row.node))) +
    (marks.length ? ' [' + marks.join(', ') + ']' : ''), ...logs];
};

/** What a throw through a helper is chosen from, in words (P90); nothing for any other failure. */
const helperSaid = (fail) => {
  if (fail.v !== 'helper') return '';
  if (fail.ch && fail.ch.length) return ' — chosen at run time from ' + fail.ch.map((c) => tick(c.x)).join(', ');
  return fail.fam === 'auth' ? ' — refuses a check of who is asking; what the helper returns was not read' : ' — what the helper returns was not read';
};

/** What a way in can fail with, a line per status and exception: how, how many places, the first of them. */
const failLines = (model, entry) => failGroups(failsOf(model, entry)).map((group) => {
  const [fail] = group.sites;
  const where = fail.f ? fail.f + (fail.l ? ':' + fail.l : '') : '';
  const node = fail.at >= 0 ? model.nodes[fail.at][1] : fail.id || '';
  const chosen = fail.v === 'helper' && fail.s === undefined ? choiceStatuses(fail) : '';
  return `- ${group.s === undefined ? chosen || 'no status' : group.s + (group.a ? '?' : '')} ${tick(group.x)} (${group.srcs.join('/')}` +
    (group.n > 1 ? ` ×${group.n}, first` : '') + ')' +
    (node ? ' in ' + tick(node) : '') + (where ? ' at ' + tick(where) : '') +
    (group.a ? ' — assumed: no code on the path writes this status' : '') + helperSaid(fail);
});

/* ── What stands in front of a way in (P76) ── */

/** Where a check was put, in the words the page says it in. */
export const ACCESS_WHERE_SAY = Object.freeze({
  global: 'the whole application',
  module: 'a module',
  controller: 'its controller',
  route: 'this route',
});

/**
 * What stands in front of a way in, as the pack's `access` has it:
 * `{ g: [[name, where, via, skippedBy?]], o?: [[decorator, public, where, skips]] }`,
 * or null when the reader said nothing.
 */
export const accessOf = (model, entry) => (model.data.access && model.data.access[entry]) || null;

/** One check as a line: `JwtAuthGuard · the whole application (APP_GUARD in AuthModule)`. */
export const accessSay = (check) =>
  check[0] + ' · ' + (ACCESS_WHERE_SAY[check[1]] || check[1]) + ' (' + check[2] + ')' + (check[3] ? ', switched off by @' + check[3] : '');

/** One opt-out as a line: `@Public on this route, open on purpose; JwtAuthGuard reads it`. */
export const optOutSay = (item) =>
  '@' + item[0] + ' on ' + (item[2] === 'controller' ? 'its controller' : 'this route') +
  (item[1] ? ', open on purpose' : ', switches a check off') + (item[3] ? '; ' + item[3] + ' reads it' : '; no check in front reads it');

const accessLines = (model, entry) => {
  const access = accessOf(model, entry);
  if (access === null) return [];
  return [...access.g.map((check) => `- ${accessSay(check)}`), ...(access.o || []).map((item) => `- ${optOutSay(item)}`)];
};

/* ── Accepting every gap like one (P76) ── */

/** A word the shell reads as it is written. */
const shellWord = (text) => (/^[\w./:@=-]+$/.test(text) ? text : "'" + String(text).replace(/'/g, "'\\''") + "'");

/** The route a route finding is about, read off the front of its message: `GET /a/:param ...`. */
export const routeOfMessage = (message) => {
  const found = /^([A-Z]+) (\/\S*)/.exec(message || '');
  return found ? { method: found[1], path: found[2] } : null;
};

/**
 * The routes "like" one: its siblings under the same prefix, by the same
 * method. `/api/catalog/:param` is like `/api/catalog/*`; a route one segment
 * deep is like nothing but itself, since `/*` would be the whole service.
 */
export const likeRoute = (route) => {
  const parts = route.path.split('/');
  return parts.length <= 2 ? route.method + ' ' + route.path : route.method + ' ' + parts.slice(0, -1).join('/') + '/*';
};

/**
 * The `flowatlas accept` line that accepts every gap like this one: the same
 * reason in the same service and, for a route finding, on the routes beside
 * it. The page cannot write `accepted.json`, so it hands over the command; a
 * rule needs a reason in words, which is left for the person to write.
 */
export const acceptCommandFor = ({ reason, service, message }) => {
  const words = ['flowatlas', 'accept', shellWord(reason)];
  if (service) words.push('--service', shellWord(service));
  const route = reason.startsWith('route-') && message !== undefined ? routeOfMessage(message) : null;
  if (route !== null) words.push('--path', shellWord(likeRoute(route)));
  words.push('--note', shellWord('<why these are fine>'));
  return words.join(' ');
};

/** The check rows on these nodes, as one line each: reason, place, message, hint. */
const gapLines = (model, nodes, limit) => {
  const { reasons, hints, files, repos } = model.data.dicts;
  const out = [];
  const rows = model.data.rows || [];
  for (const i of nodes) {
    for (const r of model.rowsOn.get(i) || []) {
      const row = rows[r];
      const file = row[2] >= 0 ? files[row[2]] : '';
      const where = (row[1] >= 0 ? repos[row[1]] + ': ' : '') + file + (file && row[3] ? ':' + row[3] : '');
      const hint = row[8] >= 0 ? ` (${hints[row[8]]})` : '';
      out.push(`- ${tick(reasons[row[4]])} at ${tick(where)}: ${row[7]}${hint}`);
    }
  }
  return out.length > limit ? [...out.slice(0, limit), `- ${out.length - limit} more not listed`] : out;
};

/**
 * Lines while they fit, and a line saying what was cut when they do not: a
 * prompt is pasted, and one too long to paste is no use.
 */
const bounded = (sections, chars) => {
  const out = [];
  let used = 0;
  for (const [i, section] of sections.entries()) {
    for (const [j, line] of section.entries()) {
      if (used + line.length + 1 > chars) {
        const left = section.length - j + sections.slice(i + 1).reduce((sum, s) => sum + s.length, 0);
        out.push(`… ${left} more lines cut to keep this short.`);
        return out.join('\n');
      }
      out.push(line);
      used += line.length + 1;
    }
  }
  return out.join('\n');
};

const idLines = (kit, i) => {
  const id = kit.idOf ? kit.idOf(i) : null;
  return [`- id: ${tick(id || kit.keyOf(i))}${id ? '' : ' (the page\'s key for it)'}`];
};

const shapeLines = (model, kit, i) => {
  const face = kit.faceLine ? kit.faceLine(model, i) : '';
  return face ? [`- shape: ${tick(face)}`] : [];
};

const stepsBlock = (model, kit, steps) => {
  const listed = steps.rows.slice(0, PROMPT_BOUNDS.steps).flatMap((row) => stepLine(model, row));
  const left = steps.rows.length - listed.length + steps.more;
  return left > 0 ? [...listed, `- … ${left} more steps not listed`] : listed;
};

const PROMPT_HEAD = 'Read from the source by flowatlas, without running it. Steps are in call order; ' +
  'a best guess is a join it inferred, not one the code proves.';

const PROMPT_TARGETS = Object.freeze({
  entry: (model, kit, i) => {
    const steps = stepsOf(model, i, { answersOf: kit.answersOf, seen: kit.seen });
    const hits = kit.seen ? kit.seen.entry(i) : 0;
    const fails = failLines(model, i);
    const access = accessLines(model, i);
    const schedule = scheduleOf(model, i);
    return [
      [`# Way in: ${model.nodes[i][1]}`, '', PROMPT_HEAD, ''],
      [...idLines(kit, i), `- source: ${tick(placeOfStep(model, i))}`, ...shapeLines(model, kit, i),
        ...(schedule ? [`- schedule: ${tick(schedule.expression)}` + (schedule.zone ? ` in ${schedule.zone}` : '')] : []),
        ...(hits ? [`- seen at run time: ${hits} hits`] : []), ''],
      ...(access.length ? [['## In front of it', ...access, '']] : []),
      ...(fails.length ? [[`## Can fail with ${failChips(failsOf(model, i)).join(' · ')}`, ...fails, '']] : []),
      ['## Steps', ...stepsBlock(model, kit, steps), ''],
      ...stepGaps(model, steps),
      ['## Ask for more', '- `get_flow` with the id above for the whole flow; `get_source` with a file:line for the code.'],
    ];
  },
  channel: (model, kit, i) => {
    const { edgeTypes } = model.data.dicts;
    const into = model.incoming[i].filter((k) => edgeTypes[model.edges[k][2]] === 'emits').map((k) => model.edges[k][0]);
    const outOf = model.outgoing[i].filter((k) => edgeTypes[model.edges[k][2]] === 'consumes').map((k) => model.edges[k][1]);
    const consumers = outOf.slice(0, PROMPT_BOUNDS.consumers).flatMap((c) => {
      const steps = stepsOf(model, c, { answersOf: kit.answersOf, seen: kit.seen, rows: 40 });
      return [`### ${model.nodes[c][1]}`, ...stepsBlock(model, kit, steps), ''];
    });
    return [
      [`# Channel: ${model.nodes[i][1]}`, '', PROMPT_HEAD, ''],
      [...idLines(kit, i), ...shapeLines(model, kit, i), ''],
      [`## Published by · ${into.length}`, ...into.map((p) => `- ${tick(model.nodes[p][1])} at ${tick(placeOfStep(model, p))}`),
        ...(into.length === 0 ? ['- nothing found in the code publishes to it'] : []), ''],
      [`## Consumed by · ${outOf.length}`, ...(outOf.length === 0 ? ['- nothing found in the code consumes it', ''] : consumers)],
      ...stepGaps(model, { rows: [{ node: i }] }),
      ['## Ask for more', '- `who_emits` and `who_consumes` with the id above.'],
    ];
  },
  row: (model, kit, r) => {
    const row = model.data.rows[r];
    const { reasons, levels, hints, files, repos } = model.data.dicts;
    const file = row[2] >= 0 ? files[row[2]] : '';
    const where = (row[1] >= 0 ? repos[row[1]] + ': ' : '') + file + (file && row[3] ? ':' + row[3] : '');
    const node = row[0];
    return [
      [`# Check: ${reasons[row[4]]}`, '', PROMPT_HEAD, ''],
      [`- level: ${levels[row[5]]}`, `- at: ${tick(where)}`, `- says: ${row[7]}`,
        ...(row[8] >= 0 ? [`- hint: ${hints[row[8]]}`] : []),
        ...(node >= 0 ? [`- on: ${tick(model.nodes[node][1])} at ${tick(placeOfStep(model, node))}`, ...idLines(kit, node)] : []), ''],
      ...(node >= 0 ? [['## Reached from', ...callersOf(model, node).map((c) => `- ${tick(model.nodes[c][1])} at ${tick(placeOfStep(model, c))}`), '']] : []),
      ['## Ask for more', '- `who_calls` or `impact` with the id above.'],
    ];
  },
});

const stepGaps = (model, steps) => {
  const nodes = [...new Set(steps.rows.map((row) => row.node))];
  const lines = gapLines(model, nodes, PROMPT_BOUNDS.gaps);
  return lines.length ? [['## Open gaps', ...lines, '']] : [];
};

/** The ways in that reach a node, nearest first, a handful of them. */
const callersOf = (model, i, limit = 8) => {
  const { edgeTypes, types } = model.data.dicts;
  const seen = new Set([i]);
  const queue = [i];
  const out = [];
  while (queue.length > 0 && out.length < limit) {
    const at = queue.shift();
    for (const k of model.incoming[at]) {
      const from = model.edges[k][0];
      if (seen.has(from) || !STEP_FOLLOWS.has(edgeTypes[model.edges[k][2]])) continue;
      seen.add(from);
      if (types[model.nodes[from][0]] === 'entry') out.push(from);
      queue.push(from);
    }
  }
  return out.slice(0, limit);
};

/**
 * A way in (`{ entry }`), a channel (`{ channel }`) or a check row
 * (`{ row }`) as Markdown an assistant can act on: its steps with the
 * repo-relative `file:line` of each, its shape, the gaps left open on it and
 * the ids the MCP tools take. Never more than `chars` long, and never any
 * code: the page does not carry it.
 *
 * `kit`: `{ keyOf(i), idOf(i), faceLine(model, i), answersOf, seen, chars }`.
 */
export const promptFor = (model, target, kit) => {
  const [kind] = Object.keys(target);
  const make = PROMPT_TARGETS[kind];
  if (!make) return '';
  return bounded(make(model, kit, target[kind]), kit.chars ?? PROMPT_BOUNDS.chars);
};
