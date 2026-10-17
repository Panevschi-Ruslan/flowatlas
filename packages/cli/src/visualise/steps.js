/*
 * A way in as the steps it takes, and the same as text for an assistant.
 *
 * Pure functions over the model graph.js builds, written into the page's one
 * module script by the command and imported as they are by a test. Every name
 * at the top level is the page's too, so each one says what it is for.
 *   stepKindOf    what a node is, as the Steps view draws it
 *   stepInline    the table, address or channel a step names
 *   stepsOf       a way in, depth first in call order: a waterfall of rows
 *   stepUnits     the rows laid out in steps, not time: where each starts, how wide
 *   createSeen    what was seen at run time, when the pack carries it
 *   stepIdOf      a node's id, as the graph and the MCP tools name it
 *   subjectOf     a way in, a channel, any node or a check row as the subject of a prompt
 *   promptFor     the same as Markdown, written by core's renderPrompt, as the MCP server writes it
 *   failsOf       what a way in can fail with, failGroups each answer once, failChips the statuses
 *   failChipsSeen the same chips with what traffic answered beside them (P106), failSeenSay one group's
 *   failChipLines how many lines a chip line wraps to at a width, so a fixed-height row can be tall enough (P137)
 *   logsOf        the lines a step logs
 *   scheduleOf    when a scheduled way in fires, and in which zone
 *   accessOf      what stands in front of a way in, and from where
 *   acceptCommandForPlace  the `flowatlas accept` line that takes one place
 *   acceptCommandForLike   the one that takes every row like it, with --dry-run
 *   doctorCommandForReason the `flowatlas doctor` line that lists every place of one reason (P141)
 */

/**
 * What each kind of step is drawn as, and called: the page's one vocabulary
 * for a step (P99), in the Steps tab, the steps above the drawing and the
 * legend that lists them.
 */
export const STEP_KINDS = Object.freeze({
  handler: Object.freeze({ glyph: 'in', say: 'handler' }),
  view: Object.freeze({ glyph: 'view', say: 'screen' }),
  act: Object.freeze({ glyph: 'act', say: 'user action' }),
  service: Object.freeze({ glyph: 'fn', say: 'service' }),
  db: Object.freeze({ glyph: 'db', say: 'store' }),
  http: Object.freeze({ glyph: 'http', say: 'outbound call' }),
  channel: Object.freeze({ glyph: 'ch', say: 'queue or topic' }),
  lambda: Object.freeze({ glyph: 'λ', say: 'function' }),
  workflow: Object.freeze({ glyph: 'wf', say: 'workflow' }),
  config: Object.freeze({ glyph: 'cfg', say: 'reads config' }),
  answer: Object.freeze({ glyph: '!', say: 'answer' }),
  break: Object.freeze({ glyph: '✕', say: 'chain breaks' }),
  other: Object.freeze({ glyph: '·', say: 'step' }),
});

/** How the Steps tab draws a way in: a line per step, every mark, or a bar per step (P99). */
export const STEP_MODES = Object.freeze(['compact', 'detailed', 'waterfall']);

const STEP_BY_TYPE = Object.freeze({
  entry: 'handler', ui_action: 'act', ui_component: 'view',
  method: 'service', provider: 'service', function: 'service',
  db_query: 'db', table: 'db', cache_op: 'db',
  http_out: 'http', external_api: 'http', ui_api_call: 'http',
  channel: 'channel', producer: 'channel', consumer: 'channel',
  config_key: 'config',
});

const STEP_BY_ENTRY_KIND = Object.freeze({ invoke: 'lambda', workflow: 'workflow' });

/** The edges that say what runs next, not what is imported or injected: a waterfall descends these. */
const STEP_RUNS = Object.freeze(new Set(['handles', 'calls', 'queries', 'caches', 'emits', 'consumes',
  'http_calls', 'hits', 'triggers']));

/** What a step reads without running it: a leaf, never descended (P99). */
const STEP_LEAVES = Object.freeze(new Set(['reads_config']));

/** Every edge a waterfall lists: what runs next, and the settings a step reads. */
const STEP_FOLLOWS = Object.freeze(new Set([...STEP_RUNS, ...STEP_LEAVES]));

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

/* ── What a way in answered at run time, beside what it declares (P106) ── */

/** The hours a comparison covers, in a few words: "never seen" means "in these". */
export const failWindowSay = (window) =>
  !window || window.from === null ? 'no hours held' : window.from + ' to ' + window.to;

/** The highest count traffic answered a declared status with, by status. */
const seenByStatus = (compared) => {
  const out = new Map();
  for (const row of compared.declaredSeen) out.set(row.status, Math.max(out.get(row.status) || 0, row.count));
  return out;
};

/** What traffic said of one declared group: `seen ×n`, `never seen`, or nothing it can say. */
export const failSeenSay = (group, compared) => {
  if (!compared) return '';
  const statuses = group.s !== undefined ? [group.s] : (group.sites[0].ch || []).filter((c) => c.s !== undefined).map((c) => c.s);
  const seen = seenByStatus(compared);
  const count = statuses.reduce((sum, s) => sum + (seen.get(s) || 0), 0);
  if (count > 0) return 'seen ×' + count;
  const never = compared.declaredNeverSeen.some((row) => row.exception === group.x && (row.status === undefined ? group.s === undefined : statuses.includes(row.status)));
  return never ? 'never seen' : '';
};

/**
 * The failure chips of a way in with what traffic said of each (P106):
 * `{ text, mark, title? }`, a declared status `404 seen ×n` or `409 never
 * seen`, then one chip per status it answered that nothing declares, `500 ×n
 * not declared`, marked `expected` where the framework answers it anyway.
 * Without a comparison, `failChips` unmarked.
 */
export const failChipsSeen = (fails, compared) => {
  const chips = failChips(fails).map((text) => ({ text, mark: '' }));
  if (!compared) return chips;
  const seen = seenByStatus(compared);
  const never = new Set(compared.declaredNeverSeen.map((row) => (row.status === undefined ? row.exception : String(row.status))));
  const over = failWindowSay(compared.window);
  const marked = chips.map((chip) => {
    const status = parseInt(chip.text, 10);
    const key = Number.isInteger(status) ? String(status) : chip.text;
    if (Number.isInteger(status) && seen.has(status)) {
      return { text: chip.text + ' seen ×' + seen.get(status), mark: 'seen', title: 'Declared, and answered ' + seen.get(status) + ' times in ' + over };
    }
    if (never.has(key)) return { text: chip.text + ' never seen', mark: 'never', title: 'Declared, and no request of ' + compared.hits + ' answered it in ' + over };
    return chip;
  });
  return [
    ...marked,
    ...compared.undeclared.map((row) => ({
      text: row.status + ' ×' + row.count + ' not declared',
      mark: row.expected ? 'expected' : 'undeclared',
      title: (row.expected ? 'Expected: ' + row.expected : 'Answered at run time; no failure in the code declares it') +
        (row.maybe ? '; maybe ' + row.maybe.join(', ') + ', which name no status' : '') + ' (' + over + ')',
    })),
  ];
};

/**
 * How many lines a failure line takes at `width` pixels when its chips wrap
 * (P137): `lead` ("can fail with ") then each chip, a `·` between them, laid
 * out the way a wrapping flex row lays them, a whole item to the next line
 * when it does not fit. The Ways in list draws a row at a fixed height, so it
 * asks this rather than measuring; the sizes are the page's 12px chips, read
 * a little wide, so a guess errs towards a line too many, never a chip cut. A
 * width of 0 or less is one not laid out yet: one line.
 */
export const failChipLines = (lead, chips, width) => {
  if (!(width > 0)) return 1;
  const MONO = 7.4, UI = 6.6, CHIP = 14, SEP = 6, GAP = 4;
  const items = [...(lead ? [lead.trim().length * UI] : []),
    ...chips.flatMap((text, n) => [...(n > 0 ? [SEP] : []), String(text).length * MONO + CHIP])];
  let lines = 1, x = 0;
  for (const w of items) {
    if (x === 0) x = w;
    else if (x + GAP + w <= width) x += GAP + w;
    else { lines += 1; x = w; }
  }
  return lines;
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

/**
 * The rows that are a likely N+1 (P89): the pack's ranked loops, which leave
 * out a loop that is per item on purpose. A pack written before it listed
 * them has every query-in-loop row.
 */
const likelyRows = (model) => {
  const loops = model.data.busiest && model.data.busiest.loops;
  return loops ? new Set(loops.map(([r]) => r)) : null;
};

/** The lines a likely N+1 row sits at, on the node whose loop it names. */
const nPlusOneLines = (model, i) => {
  const { reasons } = model.data.dicts;
  const likely = likelyRows(model);
  const lines = [];
  for (const r of model.rowsOn.get(i) || []) {
    const row = model.data.rows[r];
    if (reasons[row[4]] === QUERY_IN_LOOP && (likely === null || likely.has(r))) lines.push(row[3]);
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
 * after, and anything with neither last. `follows` is which edges: what runs
 * next by default, with the settings it reads when asked.
 */
const stepChildren = (model, i, follows = STEP_RUNS) => {
  const { edgeTypes } = model.data.dicts;
  const { order } = sitesOf(model);
  return model.outgoing[i]
    .filter((k) => follows.has(edgeTypes[model.edges[k][2]]))
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
  join: () => null, entry: () => 0, failures: () => null,
  window: '', neverSeen: Object.freeze([]), never: () => null, confirmed: () => 0,
});

/** What ran but is not in code, `{ service?, kind, name }`; a service of -1 is none. */
export const unmatchedOf = ({ unmatched = [], services, kinds }) =>
  unmatched.map(([s, kind, name, next]) =>
    ({ ...(s === -1 ? {} : { service: stepWord(services, s) }), kind: stepWord(kinds, kind), name, ...(next ? { next } : {}) }));

/** What fit several places and was counted on none (P85); `places` are edges for a join, nodes otherwise. */
export const ambiguousOf = ({ ambiguous = [], services, kinds }) =>
  ambiguous.map(([s, kind, name, count, places, unnamed = 0]) =>
    ({ ...(s === -1 ? {} : { service: stepWord(services, s) }), kind: stepWord(kinds, kind), name, count, places, unnamed }));

/**
 * What was seen at run time, from the pack's `observed` (P65), or nothing.
 * A join is named by its edge's position, an entry by its id; `failures(i)`
 * is a way in's statuses against what it declares (P106), or null.
 * `never(i)` is a node the code runs and traffic never touched, `{ window,
 * strong }`, or null; `confirmed(k)` how often traffic went through a best
 * guess, 0 when it is not one or was not seen (P110); `window` the hours
 * the file holds, in words.
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
  // What each way in answered against what it declares (P106), by position.
  const failures = new Map();
  for (const [id, value] of Object.entries(observed.failures || {})) {
    const at = data.entryIds ? data.entryIds[id] : undefined;
    if (at !== undefined) failures.set(at, value);
  }
  const most = Math.max(0, ...[...joins.values()].map((join) => join.count));
  const window = (observed.never && observed.never.window) || '';
  const never = new Map((observed.never ? observed.never.rows : []).map(([i, strong]) => [i, { window, strong: strong === 1 }]));
  const confirmed = new Set(observed.confirmed || []);
  return {
    any: true,
    most,
    unmatched: Object.freeze(unmatchedOf(observed)),
    ambiguous: Object.freeze(ambiguousOf(observed)),
    join: (k) => joins.get(k) || null,
    entry: (i) => hits.get(i) || 0,
    failures: (i) => failures.get(i) || null,
    window,
    neverSeen: Object.freeze([...never].map(([node, said]) => ({ node, strong: said.strong }))),
    never: (i) => never.get(i) || null,
    confirmed: (k) => (confirmed.has(k) && joins.has(k) ? joins.get(k).count : 0),
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
 * failing spans first. A setting a step reads is a `config` leaf under it,
 * listed each time it is read and never walked (P99).
 *
 * Every row also has its place on a waterfall drawn in steps, not time
 * (`start`, `span`; `stepUnits`). `more` counts what was left out, split in
 * `cut` by what left it out: the depth, or the rows a waterfall holds.
 *
 * `options`: `{ depth, rows, config, answersOf(model, i), seen }`; `config`
 * false leaves the settings out (a compact list, a waterfall, a count).
 */
export const stepsOf = (model, entry, options = {}) => {
  const depth = options.depth ?? STEP_BOUNDS.depth;
  const cap = options.rows ?? STEP_BOUNDS.rows;
  const follows = options.config === false ? STEP_RUNS : STEP_FOLLOWS;
  const answersOf = options.answersOf || (() => []);
  const seen = options.seen || NO_SEEN;
  const { confidences, edgeTypes } = model.data.dicts;
  const { failure, concurrent, loop: loops } = sitesOf(model);
  const throwsAt = failsByNode(failsOf(model, entry));
  const rows = [{
    node: entry, depth: 0, edge: -1, parent: -1, kind: stepKindOf(model, entry), inline: stepInline(model, entry),
    confidence: '', certain: true, failure: false, together: false, again: false, loop: false, crosses: false,
    seen: seen.entry(entry), confirmed: 0, never: seen.never(entry), answer: null, perItem: '', nPlusOne: false,
    throws: throwsAt.get(entry) || NO_FAILS, logs: logsOf(model, entry), start: 0, span: 1,
  }];
  for (const answer of answersOf(model, entry)) {
    if (answer.kind !== 'failure') continue;
    rows.push({
      node: entry, depth: 1, edge: -1, parent: 0, kind: 'answer', inline: String(answer.status),
      confidence: '', certain: true, failure: true, together: false, again: false, loop: false, crosses: false,
      seen: 0, confirmed: 0, never: null, answer, perItem: '', nPlusOne: false, throws: NO_FAILS, logs: NO_LOGS, start: 0, span: 0,
    });
  }
  const opening = stepBreakOf(model, entry);
  if (opening) rows.push(breakRow(rows[0], 0, opening));
  const cut = { depth: 0, rows: 0 };
  const walked = new Set([entry]);
  const stack = stepChildren(model, entry, follows).reverse().map((k) => ({ k, parent: 0, path: [entry] }));
  while (stack.length > 0) {
    const { k, parent, path } = stack.pop();
    if (rows.length >= cap) {
      cut.rows += 1;
      continue;
    }
    const e = model.edges[k];
    const to = e[1];
    const up = rows[parent];
    const confidence = confidences[e[3]];
    // A setting read is a leaf of its own each time: nothing runs under it.
    const leaf = STEP_LEAVES.has(edgeTypes[e[2]]);
    const loop = !leaf && path.includes(to);
    const again = !leaf && !loop && walked.has(to);
    const join = seen.join(k);
    const row = {
      node: to, depth: up.depth + 1, edge: k, parent, kind: leaf ? 'config' : stepKindOf(model, to), inline: stepInline(model, to),
      confidence, certain: STEP_CERTAIN.has(confidence), failure: up.failure || failure.has(k),
      together: concurrent.has(k), again, loop, crosses: model.nodes[to][2] !== model.nodes[up.node][2],
      seen: join ? join.count : 0, confirmed: seen.confirmed(k), never: seen.never(to), answer: null,
      perItem: loops.has(k) ? loops.get(k).kind : '', nPlusOne: isNPlusOne(model, k, loops.get(k)),
      throws: again || loop || leaf ? NO_FAILS : throwsAt.get(to) || NO_FAILS,
      logs: again || loop || leaf ? NO_LOGS : logsOf(model, to), start: 0, span: 1,
    };
    rows.push(row);
    if (loop || again || leaf) continue;
    walked.add(to);
    const broken = stepBreakOf(model, to);
    if (broken) rows.push(breakRow(row, rows.length - 1, broken));
    if (row.depth >= depth) {
      cut.depth += stepChildren(model, to, follows).length;
      continue;
    }
    const at = rows.length - 1;
    const next = [...path, to];
    for (const child of stepChildren(model, to, follows).reverse()) stack.push({ k: child, parent: at, path: next });
  }
  stepUnits(rows);
  return { rows, more: cut.depth + cut.rows, cut };
};

/**
 * Lays rows out on a waterfall drawn in steps, not time (P99): every step
 * that runs is one unit wide when nothing runs under it, and as wide as its
 * children when something does. Children run end to end in call order; a run
 * of side-by-side siblings (`together`) starts at one x and is as wide as the
 * widest. What runs nothing of its own - an answer, a break, a step listed
 * above or looping back - is a mark of no width where it would start. Sets
 * `start` and `span` on each row, in units from the way in's start, and
 * returns the whole width. P111 lays the same tree on a time axis instead.
 */
export const stepUnits = (rows) => {
  if (rows.length === 0) return 0;
  const kids = rows.map(() => []);
  for (let r = 1; r < rows.length; r += 1) kids[rows[r].parent].push(r);
  const marks = (row) => row.kind === 'answer' || row.kind === 'break' || row.again || row.loop;
  // Children are pushed after their parent, so the rows backwards are children first.
  const laid = rows.map(() => 0);
  for (let r = rows.length - 1; r >= 0; r -= 1) {
    let end = 0, groupStart = 0, groupEnd = 0, inGroup = false;
    for (const c of kids[r]) {
      const width = marks(rows[c]) ? 0 : rows[c].span;
      if (rows[c].together && inGroup) {
        laid[c] = groupStart;
        groupEnd = Math.max(groupEnd, groupStart + width);
      } else {
        end = Math.max(end, groupEnd);
        laid[c] = end;
        groupStart = end;
        groupEnd = end + width;
        inGroup = rows[c].together;
        if (!inGroup) end = groupEnd;
      }
    }
    const inside = Math.max(end, groupEnd);
    rows[r].span = marks(rows[r]) ? 0 : Math.max(1, inside);
  }
  rows[0].start = 0;
  for (let r = 1; r < rows.length; r += 1) rows[r].start = rows[rows[r].parent].start + laid[r];
  return rows[0].span;
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
  seen: 0, confirmed: 0, never: null, answer: null, perItem: '', nPlusOne: false, throws: NO_FAILS, logs: NO_LOGS, start: 0, span: 0,
  reason: broken.reason, message: broken.message,
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

/* ── Accepting one place, or every row like it (P76, P100) ── */

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

/** The route a row of a route reason is about, or null. */
const routeOfPlace = ({ reason, message }) =>
  (reason.startsWith('route-') ? routeOfMessage(message) : null);

/** The files "like" one: the others in its folder (`src/orders/*`), or null for a file at the top. */
const likeFile = (file) => {
  const at = file.lastIndexOf('/');
  return at <= 0 ? null : file.slice(0, at) + '/*';
};

/** `flowatlas accept <reason> [--service <s>] …`, the words after it given. */
const acceptLine = (reason, service, rest) =>
  ['flowatlas', 'accept', shellWord(reason), ...(service ? ['--service', shellWord(service)] : []), ...rest].join(' ');

/**
 * The `flowatlas accept` line that takes one place: a route row by its route
 * exactly, any other by its file. `accept` matches a file, never a line, so
 * the entry holds through an edit above it; every row of the reason in that
 * file is taken, which is the row a reader looked at and its neighbours in the
 * same file. A row with no file names only its service, and the menu says
 * that it then takes the reason across the service. The page cannot write
 * `accepted.json`, so it hands over the command; why is left for the person.
 */
export const acceptCommandForPlace = (place) => {
  const route = routeOfPlace(place);
  const where = route !== null ? ['--path', shellWord(route.method + ' ' + route.path)]
    : place.file ? ['--file', shellWord(place.file)] : [];
  return acceptLine(place.reason, place.service, [...where, '--note', shellWord('<why this one is fine>')]);
};

/**
 * The `flowatlas doctor` line that lists every place of one reason (P141):
 * `--reason` keeps only that reason in the `unresolved` and `desync` sections
 * it runs by default, `--max-nodes` lists `count` of
 * its places rather than the handful, and `--service` narrows it further when
 * every row of the reason is in that one service (`services`, each row's, ''
 * for a row that names none).
 */
export const doctorCommandForReason = (reason, services, count) => {
  const one = new Set(services);
  const service = one.size === 1 ? [...one][0] : '';
  return ['flowatlas', 'doctor', '--reason', shellWord(reason), '--max-nodes', String(count),
    ...(service ? ['--service', shellWord(service)] : [])].join(' ');
};

/**
 * The line that takes every row like this one, or null when no rule would
 * take more than the place does: a route row, the routes beside it
 * (`likeRoute`); any other, the same reason in the files beside it. A rule
 * goes on taking rows nobody has looked at, so it always ends in `--dry-run`:
 * run as it is, it lists what it would take and writes nothing.
 */
export const acceptCommandForLike = (place) => {
  const route = routeOfPlace(place);
  let where = null;
  if (route !== null) {
    const like = likeRoute(route);
    if (like !== route.method + ' ' + route.path) where = ['--path', shellWord(like)];
  } else if (place.file) {
    const like = likeFile(place.file);
    if (like !== null) where = ['--file', shellWord(like)];
  }
  return where === null ? null
    : acceptLine(place.reason, place.service, [...where, '--note', shellWord('<why these are fine>'), '--dry-run']);
};

/* ── Copy as prompt (P67, P97) ── */

/*
 * The page gathers the same subject the MCP server gathers from its database
 * (`gatherPromptSubject` in `@flowatlas/mcp`) and hands it to core's
 * `renderPrompt`, which the page holds inline: the same subject is then the
 * same text from either. Every rule below has its twin on the server, and the
 * parity test on the fixtures fails the day one of them moves alone.
 */

/** How the packed id of a node starts, and what it stands for (`node-ids.ts`). */
const STEP_ID_PREFIX = Object.freeze({
  '#': (type, repo, file) => repo + '#' + file + ':',
  ':': (type, repo, file) => type + ':' + repo + '#' + file + ':',
  '!': (type, repo) => type + ':' + repo + '#',
  '^': (type, repo) => type + ':' + repo + ':',
  '~': (type) => type + ':',
  '=': () => '',
});

/** A node's id, as the graph and the MCP tools name it; null on a page packed without ids. */
export const stepIdOf = (model, i) => {
  if (!model.stepIds) model.stepIds = new Map();
  const known = model.stepIds.get(i);
  if (known !== undefined) return known;
  const packed = model.data.ids && model.data.ids[i];
  if (typeof packed !== 'string') return null;
  const prefix = STEP_ID_PREFIX[packed.charAt(0)];
  const { types, repos, files } = model.data.dicts;
  const node = model.nodes[i];
  const id = prefix ? prefix(types[node[0]], repos[node[2]], files[node[4]] || '') + packed.slice(1) : packed;
  model.stepIds.set(i, id);
  return id;
};

/** The position of the node an id names, or -1. */
const stepAtOf = (model, id) => {
  if (!model.stepAt) model.stepAt = new Map(model.nodes.map((_, i) => [stepIdOf(model, i), i]));
  return model.stepAt.get(id) ?? -1;
};

/** A node as a line names it: id, label, type, kind, service and `file:line`. */
const promptPlaceOf = (model, i, depth) => {
  const node = model.nodes[i];
  const { types, repos, kinds, files } = model.data.dicts;
  const file = files[node[4]] || '';
  const kind = kinds[node[3]] || '';
  const repo = repos[node[2]] || '';
  return {
    depth, id: stepIdOf(model, i), label: node[1], type: types[node[0]],
    ...(kind === '' ? {} : { kind }), ...(repo === '' ? {} : { service: repo }),
    ...(file === '' ? {} : { loc: node[5] ? file + ':' + node[5] : file }),
  };
};

/**
 * The edges the walk under a prompt follows: `get_flow`'s, which also reads
 * settings. Named apart from the waterfall's, since it is the server's list.
 */
const PROMPT_FOLLOWS = Object.freeze(new Set([...STEP_RUNS, 'reads_config']));

/** What the walk reads of each edge beyond its ends: the packed sites, by edge, once per model. */
const promptSitesOf = (model) => {
  if (!model.promptSites) {
    const sites = model.data.sites || {};
    const carried = sites.carried || [];
    model.promptSites = {
      ordered: new Map((sites.ordered || []).map(([k, line]) => [k, line])),
      carries: new Map((sites.carries || []).map(([k, params, returns]) =>
        [k, { params: params.map((p) => carried[p]), ...(returns < 0 ? {} : { returns: carried[returns] }) }])),
      because: new Map(sites.because || []),
      takenBy: new Map((sites.takenBy || []).map(([k, nodes]) => [k, new Set(nodes)])),
      dangling: new Map(),
    };
    for (const [from, to, type, confidence, line] of model.data.dangling || []) {
      const list = model.promptSites.dangling.get(from) || [];
      list.push({ k: -1, to: -1, id: to, type, confidence, line });
      model.promptSites.dangling.set(from, list);
    }
  }
  return model.promptSites;
};

/** The edges out of a node the walk follows, as `{ k, to, id, type, confidence, ordered, order, line }`. */
const promptEdgesOf = (model, i) => {
  if (!model.promptEdges) model.promptEdges = new Map();
  const known = model.promptEdges.get(i);
  if (known) return known;
  const { edgeTypes, confidences } = model.data.dicts;
  const { order } = sitesOf(model);
  const { ordered, dangling } = promptSitesOf(model);
  const list = [
    ...model.outgoing[i].map((k) => {
      const [, to, type, confidence] = model.edges[k];
      const isOrdered = ordered.has(k);
      return { k, to, id: stepIdOf(model, to), type: edgeTypes[type], confidence: confidences[confidence],
        ordered: isOrdered, order: isOrdered ? order[k] : 0, line: isOrdered ? ordered.get(k) : order[k] };
    }),
    ...(dangling.get(i) || []).map((edge) => ({ ...edge, type: edgeTypes[edge.type], confidence: confidences[edge.confidence],
      ordered: false, order: 0 })),
  ].filter((edge) => PROMPT_FOLLOWS.has(edge.type));
  model.promptEdges.set(i, list);
  return list;
};

const stepCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `get_flow`'s call order: as written, by line, then by target; a workflow's own order after. */
const promptInCallOrder = (a, b) =>
  Number(a.ordered) - Number(b.ordered) || (a.ordered ? a.order - b.order : 0) ||
  (a.line || Number.MAX_SAFE_INTEGER) - (b.line || Number.MAX_SAFE_INTEGER) ||
  stepCmp(a.id, b.id) || stepCmp(a.type, b.type) || a.k - b.k;

/* What a step is worth the walk's room, the least first: `get_flow`'s ranks (P92). */
const PROMPT_RANK = Object.freeze({ out: 0, store: 1, handles: 2, toward: 3, calls: 4, plumbing: 5 });
const PROMPT_LEAVING_EDGES = Object.freeze(new Set(['http_calls', 'hits', 'emits', 'consumes', 'triggers']));
const PROMPT_LEAVING_NODES = Object.freeze(new Set(['http_out', 'producer', 'consumer', 'ui_api_call', 'channel', 'external_api', 'entry']));
const PROMPT_STORE_EDGES = Object.freeze(new Set(['queries', 'caches']));
const PROMPT_STORE_NODES = Object.freeze(new Set(['db_query', 'cache_op', 'table']));

const promptTypeOf = (model, i) => (i < 0 ? undefined : stepTypeOf(model, i));

const promptCrossingRank = (model, edge) => {
  const target = promptTypeOf(model, edge.to);
  if (PROMPT_LEAVING_EDGES.has(edge.type) || PROMPT_LEAVING_NODES.has(target)) return PROMPT_RANK.out;
  if (PROMPT_STORE_EDGES.has(edge.type) || PROMPT_STORE_NODES.has(target)) return PROMPT_RANK.store;
  return undefined;
};

/** Who calls a node, and whether it leaves its service itself: read once per model. */
const promptRanking = (model) => {
  if (!model.promptRanking) {
    const { edgeTypes } = model.data.dicts;
    const fanIns = new Map();
    const leaves = new Map();
    model.promptRanking = {
      fanIn: (i) => {
        if (!fanIns.has(i)) {
          fanIns.set(i, new Set(model.incoming[i].filter((k) => edgeTypes[model.edges[k][2]] === 'calls').map((k) => model.edges[k][0])).size);
        }
        return fanIns.get(i);
      },
      leavesFrom: (i) => {
        if (!leaves.has(i)) leaves.set(i, promptEdgesOf(model, i).some((edge) => promptCrossingRank(model, edge) === PROMPT_RANK.out));
        return leaves.get(i);
      },
    };
  }
  return model.promptRanking;
};

const promptRankOf = (model, edge, under, plumbing) => {
  const crossing = promptCrossingRank(model, edge);
  if (crossing !== undefined) return crossing;
  if (under === PROMPT_RANK.plumbing) return PROMPT_RANK.plumbing;
  if (edge.type === 'handles') return PROMPT_RANK.handles;
  if (edge.type !== 'calls') return PROMPT_RANK.calls;
  const ranking = promptRanking(model);
  if (edge.to >= 0 && ranking.leavesFrom(edge.to)) return PROMPT_RANK.toward;
  return edge.to >= 0 && ranking.fanIn(edge.to) > plumbing ? PROMPT_RANK.plumbing : PROMPT_RANK.calls;
};

/** Rows first, then what is only counted; within each, by rank, then nearest, then first reached. */
const promptExpandsFirst = (a, b) =>
  Number(a.flow === undefined) - Number(b.flow === undefined) || a.rank - b.rank || a.level - b.level || a.seq - b.seq;

/** The limit that left out more says the sentence; a tie goes to the budget. */
const PROMPT_BY_WEIGHT = Object.freeze(['maxNodes', 'maxChars', 'depth']);

/**
 * The walk under a prompt: `get_flow`'s (`buildFlowTree`), on the packed
 * model. Each node is expanded once in the whole walk, in priority order -
 * crossings into another service, store or channel first, plumbing last - and
 * a node met again is a reference to the row its subtree is under; children
 * are written in call order. `{ root, left, stoppedBy }`: what the walk
 * reached, how many rows it left out and the limits that did.
 */
const promptWalkOf = (model, start, walk) => {
  const steps = Number(stepField(model, start, 'ss'));
  const depth = walk.depth + (Number.isInteger(steps) && steps > 0 ? steps : 0);
  const startId = stepIdOf(model, start);
  const root = { at: start, id: startId, children: [] };
  const { takenBy } = promptSitesOf(model);
  const placed = new Map();
  const reached = new Set([startId]);
  const cut = { depth: 0, maxNodes: 0, maxChars: 0 };
  let stopped;
  let used = 1;
  let scanned = 0;
  let seq = 0;
  const scanLimit = walk.maxNodes * 4;
  const queue = [{ flow: root, at: start, id: startId, path: new Set([startId]), level: 0, rank: PROMPT_RANK.out, seq: seq++ }];
  const pop = () => {
    let best = 0;
    for (let q = 1; q < queue.length; q += 1) if (promptExpandsFirst(queue[q], queue[best]) < 0) best = q;
    return queue.splice(best, 1)[0];
  };
  while (queue.length > 0) {
    const item = pop();
    const edges = (item.at < 0 ? [] : promptEdgesOf(model, item.at))
      .filter((edge) => !(edge.type === 'consumes' && item.takenBy !== undefined && !item.takenBy.has(edge.to)))
      .sort(promptInCallOrder);
    if (edges.length === 0) continue;
    if (item.level >= depth) {
      if (item.flow !== undefined) cut.depth += edges.length;
      continue;
    }
    const candidates = edges
      .map((edge, order) => ({ edge, order, rank: promptRankOf(model, edge, item.rank, walk.plumbingFanIn) }))
      .sort((a, b) => a.rank - b.rank || a.order - b.order);
    const rows = [];
    for (const { edge, order, rank } of candidates) {
      scanned += 1;
      if (scanned > scanLimit) {
        stopped = stopped || 'maxNodes';
        cut[stopped] += 1;
        continue;
      }
      const repeat = item.path.has(edge.id) ? 'cycle' : reached.has(edge.id) ? 'again' : undefined;
      if (repeat === undefined) reached.add(edge.id);
      let row = item.flow === undefined || stopped !== undefined
        ? undefined
        : { at: edge.to, id: edge.id, edge, repeat, ...(repeat === 'again' && placed.has(edge.id) ? { seenAt: placed.get(edge.id) } : {}), children: [] };
      if (row !== undefined && used >= walk.maxNodes) {
        stopped = 'maxNodes';
        row = undefined;
      }
      const taken = edge.k >= 0 ? takenBy.get(edge.k) : undefined;
      const next = { at: edge.to, id: edge.id, path: new Set([...item.path, edge.id]), level: item.level + 1, rank, ...(taken ? { takenBy: taken } : {}) };
      if (row === undefined) {
        cut[stopped || 'maxNodes'] += 1;
        if (repeat === undefined) queue.push({ ...next, flow: undefined, seq: seq++ });
        continue;
      }
      used += 1;
      rows.push({ order, row });
      if (repeat === undefined) {
        placed.set(edge.id, item.id);
        queue.push({ ...next, flow: row, seq: seq++ });
      }
    }
    if (item.flow !== undefined) item.flow.children.push(...rows.sort((a, b) => a.order - b.order).map((entry) => entry.row));
  }
  const stoppedBy = PROMPT_BY_WEIGHT.filter((limit) => cut[limit] > 0).sort((a, b) => cut[b] - cut[a]);
  return { root, left: stoppedBy.reduce((sum, limit) => sum + cut[limit], 0), stoppedBy };
};

/** What the edge into a step says about when and how often it runs, and how often it was seen. */
const promptMarksOf = (model, edge, underFailure, seen) => {
  const { failure, concurrent, loop: loops } = sitesOf(model);
  const loop = loops.get(edge.k);
  const count = seen.join(edge.k);
  return {
    ...(underFailure || failure.has(edge.k) ? { failure: true } : {}),
    ...(concurrent.has(edge.k) ? { together: true } : {}),
    ...(loop ? { perItem: loop.kind } : {}),
    ...(isNPlusOne(model, edge.k, loop) ? { nPlusOne: true } : {}),
    ...(count && count.count > 0 ? { seen: count.count } : {}),
  };
};

/** The lines a step logs, as the server reads them: a level, the line, the template. */
const promptLogsOf = (model, i) => logsOf(model, i).map((log) =>
  ({ level: log.level, ...(log.line > 0 ? { line: log.line } : {}), ...(log.text ? { text: log.text } : {}) }));

/** The walk as lines in reading order, depth first, as a person reads a call chain. */
const promptStepsOf = (model, root, seen) => {
  const steps = [];
  const { carries, because } = promptSitesOf(model);
  const visit = (row, depth, underFailure) => {
    const { edge } = row;
    if (row.repeat !== undefined) {
      steps.push({ depth, id: row.id, label: row.at < 0 ? row.id : model.nodes[row.at][1], type: 'ref', repeat: true,
        ...(row.seenAt === undefined ? {} : { seenAt: row.seenAt }) });
      return;
    }
    const carried = edge.k >= 0 ? carries.get(edge.k) : undefined;
    const reasons = edge.k >= 0 ? because.get(edge.k) : undefined;
    const marks = row.at < 0 ? {} : promptMarksOf(model, edge, underFailure, seen);
    const logs = row.at < 0 ? [] : promptLogsOf(model, row.at);
    steps.push({
      ...(row.at < 0 ? { depth, id: row.id, label: row.id, type: 'missing' } : promptPlaceOf(model, row.at, depth)),
      via: { type: edge.type, confidence: edge.confidence, ...(reasons ? { because: reasons } : {}) },
      ...(carried && carried.params.length > 0 ? { params: carried.params } : {}),
      ...(carried && carried.returns !== undefined ? { returns: carried.returns } : {}),
      ...(Object.keys(marks).length === 0 ? {} : { marks }),
      ...(logs.length === 0 ? {} : { logs }),
    });
    for (const child of row.children) visit(child, depth + 1, marks.failure === true);
  };
  for (const child of root.children) visit(child, 1, false);
  return steps;
};

/** The service a check row is in: a position in the services, or the name of one no node is in; '' for none. */
const promptRowService = (model, row) =>
  typeof row[1] === 'string' ? row[1] : row[1] >= 0 ? model.data.dicts.repos[row[1]] : '';

/** A check row as a gap of the chain: reason, place, message, hint, and its reach where it counts it. */
const promptGapOf = (model, r, id) => {
  const row = model.data.rows[r];
  const { reasons, hints, files } = model.data.dicts;
  const file = row[2] >= 0 ? files[row[2]] : '';
  const service = promptRowService(model, row);
  return {
    reason: reasons[row[4]], message: String(row[7]), id,
    ...(service === '' ? {} : { service }),
    ...(file === '' ? {} : { loc: row[3] ? file + ':' + row[3] : file }),
    ...(row[8] >= 0 ? { hint: hints[row[8]] } : {}),
    ...(typeof row[9] === 'number' ? { waysIn: row[9] } : {}),
  };
};

/** The ways in that reach any of these nodes, but none of them, within `reachDepth` hops back, by id, a handful. */
const promptReachedFromAny = (model, starts, walk) => {
  const { edgeTypes, types } = model.data.dicts;
  const seen = new Set(starts);
  let layer = [...starts];
  const found = [];
  for (let hop = 0; hop < walk.reachDepth && layer.length > 0 && seen.size < walk.reachNodes; hop += 1) {
    const next = [];
    for (const at of layer) {
      for (const k of model.incoming[at]) {
        const from = model.edges[k][0];
        if (seen.has(from) || !PROMPT_FOLLOWS.has(edgeTypes[model.edges[k][2]])) continue;
        seen.add(from);
        if (types[model.nodes[from][0]] === 'entry') found.push(from);
        next.push(from);
      }
    }
    layer = next;
  }
  return found
    .map((at) => promptPlaceOf(model, at, 1))
    .sort((a, b) => stepCmp(a.id, b.id))
    .slice(0, walk.reachedFrom);
};

/** The ways in that reach a node, within `reachDepth` hops back, by id, a handful. */
const promptReachedFrom = (model, i, walk) => promptReachedFromAny(model, [i], walk);

/** A way in's failures, as it stores them: what the renderer groups and marks steps with. */
const promptFailsOf = (model, i) => failsOf(model, i).map((fail) => ({
  ...(fail.s === undefined ? {} : { status: fail.s }), exception: fail.x,
  at: fail.at >= 0 ? stepIdOf(model, fail.at) : fail.id,
  ...(fail.f === undefined ? {} : { file: fail.f }), ...(fail.l === undefined ? {} : { line: fail.l }), source: fail.src,
  ...(fail.a ? { assumed: true } : {}), ...(fail.dc === undefined ? {} : { declared: fail.dc }),
  ...(fail.v ? { via: fail.v } : {}),
  ...(fail.ch ? { chosenFrom: fail.ch.map((c) => ({ exception: c.x, ...(c.s === undefined ? {} : { status: c.s }), ...(c.a ? { assumed: true } : {}) })) } : {}),
  ...(fail.fam ? { family: fail.fam } : {}),
}));

/** What stands in front of a way in, as the server reads it off the node (P76). */
const promptAccessOf = (model, i) => {
  const access = accessOf(model, i);
  if (access === null) return undefined;
  return {
    guards: access.g.map(([name, where, via, skippedBy]) => ({ name, where, via, ...(skippedBy === undefined ? {} : { skippedBy }) })),
    ...(access.o ? { optOuts: access.o.map(([decorator, open, where, skips]) => ({ decorator, where, public: open === 1, skips })) } : {}),
  };
};

/** A node as the subject of a prompt: its walk, its gaps, and what its kind adds. */
const promptNodeSubject = (model, i, walk, seen) => {
  const type = stepTypeOf(model, i);
  const flow = promptWalkOf(model, i, walk);
  const steps = promptStepsOf(model, flow.root, seen);
  const gaps = [];
  for (const id of [stepIdOf(model, i), ...new Set(steps.map((step) => step.id))]) {
    const at = stepAtOf(model, id);
    for (const r of (at < 0 ? [] : model.rowsOn.get(at)) || []) gaps.push(promptGapOf(model, r, id));
  }
  for (const step of steps) {
    if (step.type === 'missing') gaps.push({ reason: 'node-missing', message: `the graph points at ${step.id} and holds no such node`, id: step.id });
  }
  const { edgeTypes } = model.data.dicts;
  const producers = type === 'channel'
    ? model.incoming[i].filter((k) => edgeTypes[model.edges[k][2]] === 'emits')
      .map((k) => promptPlaceOf(model, model.edges[k][0], 1)).sort((a, b) => stepCmp(a.id, b.id))
    : undefined;
  const reachedFrom = type === 'entry' || type === 'channel' ? undefined : promptReachedFrom(model, i, walk);
  const { depth: _depth, ...head } = promptPlaceOf(model, i, 0);
  const fails = type === 'entry' ? promptFailsOf(model, i) : [];
  const access = type === 'entry' ? promptAccessOf(model, i) : undefined;
  const schedule = type === 'entry' ? scheduleOf(model, i) : null;
  const hits = type === 'entry' ? seen.entry(i) : 0;
  const failuresSeen = type === 'entry' ? seen.failures(i) : null;
  return {
    ...head,
    ...(schedule === null ? {} : { schedule: { expression: schedule.expression, ...(schedule.zone ? { zone: schedule.zone } : {}) } }),
    ...(hits > 0 ? { hits } : {}),
    ...(access === undefined ? {} : { access }),
    ...(fails.length === 0 ? {} : { fails }),
    ...(failuresSeen === null ? {} : { failuresSeen }),
    steps,
    stepsCut: flow.left,
    ...(flow.stoppedBy.length === 0 ? {} : { stepsCutBy: flow.stoppedBy[0] }),
    ...(producers === undefined ? {} : { producers }),
    ...(reachedFrom === undefined ? {} : { reachedFrom }),
    gaps,
  };
};

/**
 * A check row as the subject of a prompt: its gap id, which is what `flowatlas
 * accept` and `describe_for_prompt` take, and every row that answers to it -
 * the same reason in the same file - each at its line, with the node it is on.
 */
const promptCheckSubject = (model, r, walk) => {
  const { reasons, levels, hints, files } = model.data.dicts;
  const rows = model.data.rows;
  const [, repo, file, , reason] = rows[r];
  const same = rows
    .filter((row) => row[1] === repo && row[2] === file && row[4] === reason)
    .sort((a, b) => a[3] - b[3] || stepCmp(String(a[7]), String(b[7])));
  const service = promptRowService(model, rows[r]);
  const path = file >= 0 ? files[file] : '';
  const places = same.map((row) => ({
    ...(path === '' ? {} : { loc: row[3] ? path + ':' + row[3] : path }),
    message: String(row[7]),
    ...(row[8] >= 0 ? { hint: hints[row[8]] } : {}),
    ...(row[0] >= 0 ? { on: promptPlaceOf(model, row[0], 1) } : {}),
  }));
  const first = same.find((row) => row[0] >= 0);
  const firstType = first ? stepTypeOf(model, first[0]) : '';
  const reachedFrom = first && firstType !== 'entry' && firstType !== 'channel' ? promptReachedFrom(model, first[0], walk) : undefined;
  return {
    id: `gap:${service}|${path}|${reasons[reason]}`, label: reasons[reason], type: 'check',
    kind: [...new Set(same.map((row) => levels[row[5]]))].join(', '),
    ...(service === '' ? {} : { service }), ...(path === '' ? {} : { loc: path }),
    check: { places }, steps: [], stepsCut: 0,
    ...(reachedFrom === undefined ? {} : { reachedFrom }),
    gaps: [],
  };
};

/* ── Scoped subjects (P95): a class, a file, as the server's `gatherClassSubject` and `gatherFileSubject` ── */

/** The class a method id belongs to: its id up to the last `.`. */
const promptOwnerOf = (id) => {
  const cut = id === null ? -1 : id.lastIndexOf('.');
  return cut <= 0 ? null : id.slice(0, cut);
};

/** The same gap once, whichever method's chain reached it first. */
const promptUniqueGaps = (gaps) => {
  const seen = new Set();
  return gaps.filter((gap) => {
    const key = [gap.id ?? '', gap.reason, gap.loc ?? '', gap.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** A class and its methods, each with its ways in and its own chain; the gaps of every chain once. */
const promptClassSubject = (model, i, walk, seen) => {
  const id = stepIdOf(model, i);
  const methods = model.nodes
    .map((_, j) => j)
    .filter((j) => stepTypeOf(model, j) === 'method' && promptOwnerOf(stepIdOf(model, j)) === id)
    .sort((a, b) => stepCmp(stepIdOf(model, a), stepIdOf(model, b)));
  const subjects = methods.map((j) => promptNodeSubject(model, j, walk, seen));
  const members = subjects.map((subject) => ({
    id: subject.id, label: subject.label, type: subject.type,
    ...(subject.kind === undefined ? {} : { kind: subject.kind }), ...(subject.loc === undefined ? {} : { loc: subject.loc }),
    reachedFrom: subject.reachedFrom ?? [], steps: subject.steps, stepsCut: subject.stepsCut,
    ...(subject.stepsCutBy === undefined ? {} : { stepsCutBy: subject.stepsCutBy }),
  }));
  const own = (model.rowsOn.get(i) || []).map((r) => promptGapOf(model, r, id));
  const { depth: _depth, ...head } = promptPlaceOf(model, i, 0);
  return {
    ...head, scope: 'class', steps: [], stepsCut: 0,
    reachedFrom: methods.length === 0 ? [] : promptReachedFromAny(model, methods, walk),
    members,
    gaps: promptUniqueGaps([...own, ...subjects.flatMap((subject) => subject.gaps)]),
  };
};

/** The class a node of a file belongs to: a method's owner, a class itself, a route's handler's, else its first caller's in the file. */
const promptGroupOf = (model, j, inFile) => {
  const { edgeTypes } = model.data.dicts;
  const classOf = (at) => {
    const type = stepTypeOf(model, at);
    if (type === 'provider') return stepIdOf(model, at);
    if (type !== 'method') return null;
    const owner = promptOwnerOf(stepIdOf(model, at));
    return owner !== null && inFile.has(owner) ? owner : null;
  };
  const type = stepTypeOf(model, j);
  if (type === 'provider' || type === 'method') return classOf(j);
  const ends = (list, end, keep) => list
    .filter((k) => keep(edgeTypes[model.edges[k][2]]))
    .map((k) => model.edges[k][end])
    .sort((a, b) => stepCmp(stepIdOf(model, a), stepIdOf(model, b)));
  if (type === 'entry') {
    const [handler] = ends(model.outgoing[j], 1, (edge) => edge === 'handles');
    return handler === undefined ? null : classOf(handler);
  }
  const [caller] = ends(model.incoming[j], 0, (edge) => PROMPT_FOLLOWS.has(edge)).filter((at) => inFile.has(stepIdOf(model, at)));
  return caller === undefined ? null : classOf(caller);
};

/** A file and every node in it, by class and line; the gaps recorded in it; the ways in that reach any of them. */
const promptFileSubject = (model, service, file, walk) => {
  const { repos, files } = model.data.dicts;
  const nodes = model.nodes
    .map((_, j) => j)
    .filter((j) => repos[model.nodes[j][2]] === service && files[model.nodes[j][4]] === file)
    .sort((a, b) => (model.nodes[a][5] || 0) - (model.nodes[b][5] || 0) || stepCmp(stepIdOf(model, a), stepIdOf(model, b)));
  const inFile = new Set(nodes.map((j) => stepIdOf(model, j)));
  const members = nodes.map((j) => {
    const { depth: _depth, service: _service, ...head } = promptPlaceOf(model, j, 0);
    const group = promptGroupOf(model, j, inFile);
    return { ...head, ...(group === null ? {} : { group }), reachedFrom: [] };
  });
  const gaps = [];
  (model.data.rows || []).forEach((row, r) => {
    if (promptRowService(model, row) !== service || (row[2] >= 0 ? files[row[2]] : '') !== file) return;
    const gap = promptGapOf(model, r, row[0] >= 0 ? stepIdOf(model, row[0]) : undefined);
    if (gap.id === undefined) delete gap.id;
    gaps.push(gap);
  });
  return {
    id: `${service}#${file}`, label: file, type: 'file', service, scope: 'file', steps: [], stepsCut: 0,
    reachedFrom: nodes.length === 0 ? [] : promptReachedFromAny(model, nodes, walk),
    members, gaps,
  };
};

/**
 * What a copied prompt says about a way in, a channel or any node
 * (`{ entry }`, `{ channel }`, `{ node }`: a position), a check row
 * (`{ row }`), a class (`{ class }`: the class's position) or a file
 * (`{ file: [service, path] }`, P95), gathered from the packed model into the subject core's
 * `renderPrompt` writes; null for a target that names nothing. `kit`:
 * `{ walk, seen? }`, `walk` the bounds of the walk (core's `PROMPT_WALK`).
 */
export const subjectOf = (model, target, kit) => {
  const [kind] = Object.keys(target);
  const at = target[kind];
  const seen = kit.seen || NO_SEEN;
  if (kind === 'row') return model.data.rows && model.data.rows[at] ? promptCheckSubject(model, at, kit.walk) : null;
  if (kind === 'file') return Array.isArray(at) && at.length === 2 ? promptFileSubject(model, at[0], at[1], kit.walk) : null;
  if (kind === 'class') {
    return at >= 0 && at < model.nodes.length && stepTypeOf(model, at) === 'provider' ? promptClassSubject(model, at, kit.walk, seen) : null;
  }
  if (kind !== 'entry' && kind !== 'channel' && kind !== 'node') return null;
  return at >= 0 && at < model.nodes.length ? promptNodeSubject(model, at, kit.walk, seen) : null;
};

/**
 * The Markdown for a target, as the MCP server's `describe_for_prompt` writes
 * it: `kit.render` is core's `renderPrompt` (the page passes the copy it holds
 * inline), `kit.limits` its `PROMPT_LIMITS`. Never any code: the page does not
 * carry it. '' for a target that names nothing.
 */
export const promptFor = (model, target, kit) => {
  const subject = subjectOf(model, target, kit);
  return subject === null ? '' : kit.render(subject, kit.limits);
};
