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

const NO_SITES = Object.freeze({ order: [], failure: [], concurrent: [] });

const sitesOf = (model) => {
  if (!model.stepSites) {
    const sites = model.data.sites || NO_SITES;
    model.stepSites = { order: sites.order, failure: new Set(sites.failure), concurrent: new Set(sites.concurrent) };
  }
  return model.stepSites;
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
  any: false, most: 0, unmatched: Object.freeze([]),
  join: () => null, entry: () => 0,
});

/**
 * What was seen at run time, from the pack's `observed` (P65), or nothing.
 * A join is named by its edge's position, or by `fromKey>toKey` with an
 * optional `:type`; an entry by its id or its stable key.
 */
export const createSeen = (data, keys) => {
  const observed = data.observed;
  if (!observed) return NO_SEEN;
  const { edgeTypes } = data.dicts;
  const joins = new Map();
  let byEnds = null;
  const endsIndex = () => {
    if (byEnds) return byEnds;
    byEnds = new Map();
    data.edges.forEach((e, k) => {
      const id = keys.keyOf(e[0]) + '>' + keys.keyOf(e[1]);
      byEnds.set(id, [...(byEnds.get(id) || []), k]);
    });
    return byEnds;
  };
  const add = (k, value) => {
    const had = joins.get(k);
    if (!had) joins.set(k, { count: value.count || 0, lastSeen: value.lastSeen || '' });
    else {
      had.count += value.count || 0;
      if ((value.lastSeen || '') > had.lastSeen) had.lastSeen = value.lastSeen;
    }
  };
  for (const [id, value] of Object.entries(observed.joins || {})) {
    if (/^\d+$/.test(id)) {
      if (Number(id) < data.edges.length) add(Number(id), value);
      continue;
    }
    const [ends, type] = id.split(':');
    for (const k of endsIndex().get(ends) || []) {
      if (type === undefined || edgeTypes[data.edges[k][2]] === type) add(k, value);
    }
  }
  const hits = new Map();
  for (const [id, value] of Object.entries(observed.entries || {})) {
    const at = data.entryIds && data.entryIds[id] !== undefined ? data.entryIds[id] : keys.find(id);
    if (at >= 0) hits.set(at, (hits.get(at) || 0) + (value.hits || 0));
  }
  const most = Math.max(0, ...[...joins.values()].map((join) => join.count));
  return {
    any: true,
    most,
    unmatched: Object.freeze([...(observed.unmatched || [])]),
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
  const { failure, concurrent } = sitesOf(model);
  const rows = [{
    node: entry, depth: 0, edge: -1, parent: -1, kind: stepKindOf(model, entry), inline: stepInline(model, entry),
    confidence: '', certain: true, failure: false, together: false, again: false, loop: false, crosses: false,
    seen: seen.entry(entry), answer: null,
  }];
  for (const answer of answersOf(model, entry)) {
    if (answer.kind !== 'failure') continue;
    rows.push({
      node: entry, depth: 1, edge: -1, parent: 0, kind: 'answer', inline: String(answer.status),
      confidence: '', certain: true, failure: true, together: false, again: false, loop: false, crosses: false,
      seen: 0, answer,
    });
  }
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
    };
    rows.push(row);
    if (loop || again) continue;
    walked.add(to);
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

/* ── Copy as prompt (P67) ── */

/** How long a prompt may get, in characters, and how many of each list it names. */
export const PROMPT_BOUNDS = Object.freeze({ chars: 8000, steps: 80, gaps: 20, consumers: 4 });

const PROMPT_MARKS = Object.freeze([
  [(row) => !row.certain && row.confidence !== '', (row) => 'best guess: ' + row.confidence],
  [(row) => row.failure, () => 'on failure'],
  [(row) => row.together, () => 'side by side'],
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
  const label = row.kind === 'answer' ? 'answers ' + row.inline : model.nodes[row.node][1];
  const inline = row.inline && row.kind !== 'answer' && row.inline !== label ? ' → ' + tick(row.inline) : '';
  const marks = PROMPT_MARKS.filter(([when]) => when(row)).map(([, say]) => say(row));
  return '  '.repeat(row.depth) + `- ${STEP_KINDS[row.kind].say} ${tick(label)}${inline}` +
    (row.kind === 'answer' ? '' : ' at ' + tick(placeOfStep(model, row.node))) +
    (marks.length ? ' [' + marks.join(', ') + ']' : '');
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
  const listed = steps.rows.slice(0, PROMPT_BOUNDS.steps).map((row) => stepLine(model, row));
  const left = steps.rows.length - listed.length + steps.more;
  return left > 0 ? [...listed, `- … ${left} more steps not listed`] : listed;
};

const PROMPT_HEAD = 'Read from the source by flowatlas, without running it. Steps are in call order; ' +
  'a best guess is a join it inferred, not one the code proves.';

const PROMPT_TARGETS = Object.freeze({
  entry: (model, kit, i) => {
    const steps = stepsOf(model, i, { answersOf: kit.answersOf, seen: kit.seen });
    const hits = kit.seen ? kit.seen.entry(i) : 0;
    return [
      [`# Way in: ${model.nodes[i][1]}`, '', PROMPT_HEAD, ''],
      [...idLines(kit, i), `- source: ${tick(placeOfStep(model, i))}`, ...shapeLines(model, kit, i),
        ...(hits ? [`- seen at run time: ${hits} hits`] : []), ''],
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
