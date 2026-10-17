/*
 * One subject of the graph - a way in, a channel, a check, any symbol - as the
 * Markdown an assistant is handed (P97).
 *
 * The one renderer both surfaces write with: the MCP server's
 * `describe_for_prompt` and the page's "Copy as prompt" gather the same
 * subject from what each holds (a database, a packed model) and hand it here,
 * so the same subject is the same characters on both. Plain JavaScript with no
 * imports, no I/O and no DOM, because the page writes this file's text into
 * its one module script, and core's build copies it into `dist/` beside the
 * code that imports it. Every name at the top level is the page's too, so each
 * starts with `prompt` or `PROMPT_`.
 *
 * No source code is ever written into the text: it names where to look and
 * which ids to ask for. Bounded by count (steps, gaps, failures, consumers)
 * and by length, cutting whole lines and saying so (I9).
 *
 *   renderPrompt      the Markdown for one subject
 *   askNextOf         the calls the text ends with, which the server answers with as `next`
 *   promptHintsFor    the calls that take one node's id
 *   promptNextFor     hints for several nodes, without repeats, bounded
 *   groupFails        each status and exception a way in fails with once (P87)
 *   compareFailChoices  the order a helper's choices are written in (P90)
 *   promptMsSay       a duration as it is written: `3.2 ms`, `73 ms`, `1.2 s` (P111)
 *   promptRateSay     a share as a percentage: `4.5%`, `100%` (P111)
 */

/**
 * How much one text may say: chain steps, gaps, failure lines, a channel's
 * consumers, the members of a class or a file (P95), characters.
 */
export const PROMPT_LIMITS = Object.freeze({ maxSteps: 40, maxGaps: 10, maxFails: 12, maxConsumers: 4, maxMembers: 40, maxChars: 8000 });

/**
 * The walk under a text, the same on both sides: `get_flow`'s, at most
 * `maxNodes` rows and `depth` hops (more for a chain of steps), a method more
 * than `plumbingFanIn` others call walked last (P92); and the ways in that
 * reach a subject that is not one, found within `reachDepth` hops back,
 * `reachedFrom` of them named. The renderer cuts further.
 */
export const PROMPT_WALK = Object.freeze({
  maxNodes: 120,
  depth: 8,
  plumbingFanIn: 5,
  reachDepth: 12,
  reachNodes: 2000,
  reachedFrom: 5,
});

/** How many calls one answer suggests: enough to show the chain, no more. */
export const PROMPT_MAX_NEXT = 4;

/** Where a failure comes from, in the order a group lists them. */
export const PROMPT_FAIL_SOURCES = Object.freeze(['throw', 'guard', 'pipe']);

/**
 * What each kind of subject is called in its heading, by scope (P95) and then
 * by type; anything else is a symbol.
 */
const PROMPT_HEADINGS = Object.freeze({
  entry: 'Way in',
  channel: 'Channel',
  check: 'Check',
  table: 'Table',
  class: 'Class',
  file: 'File',
  service: 'Service',
});

/** Said once under the heading, so a reader knows what kind of reading this is. */
const PROMPT_HEAD =
  'Read from the source by flowatlas, without running it. Steps are in call order; ' +
  'a best guess is a join it inferred, not one the code proves.';

/** Where a check was put, in words. */
const PROMPT_WHERE_SAY = Object.freeze({
  global: 'the whole application',
  module: 'a module',
  controller: 'its controller',
  route: 'this route',
});

/** Joins proven or written down in the code; the rest are best guesses. */
const PROMPT_CERTAIN = Object.freeze(new Set(['static', 'marker']));

const promptCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const promptCode = (text) => '`' + String(text).replace(/`/g, "'") + '`';

const promptQuote = (id) => JSON.stringify(id);

/* ── The calls that take an id ── */

const PROMPT_SYMBOL_HINTS = (id) => [
  `who_calls({symbol: ${promptQuote(id)}})`,
  `impact({symbol: ${promptQuote(id)}})`,
  `get_source({symbol: ${promptQuote(id)}})`,
];

/** A Strategy keyed by node type, so a new type of node is one entry here and nothing in the tools. */
const PROMPT_HINTS = Object.freeze({
  entry: (id) => [
    `get_flow({entry: ${promptQuote(id)}})`,
    `describe_for_prompt({id: ${promptQuote(id)}})`,
    `impact({symbol: ${promptQuote(id)}})`,
  ],
  channel: (id) => [
    `who_emits({channel: ${promptQuote(id)}})`,
    `who_consumes({channel: ${promptQuote(id)}})`,
    `describe_for_prompt({id: ${promptQuote(id)}})`,
  ],
  table: (id) => [`impact({symbol: ${promptQuote(id)}})`, `who_calls({symbol: ${promptQuote(id)}})`],
  type: (id) => [`get_type({type: ${promptQuote(id)}})`, `type_usage({type: ${promptQuote(id)}})`],
  // A class answers for its methods (P95): who calls any of them, and all of it as one text.
  provider: (id) => [
    `who_calls({symbol: ${promptQuote(id)}})`,
    `impact({symbol: ${promptQuote(id)}})`,
    `describe_for_prompt({id: ${promptQuote(id)}, scope: "class"})`,
  ],
  // A file is `service#path`: the gaps beside its code, and what is dead in its service.
  file: (id) => [
    `search({query: ${promptQuote(id.slice(id.indexOf('#') + 1))}, kinds: ["gaps"]})`,
    `cant_follow({service: ${promptQuote(id.slice(0, Math.max(id.indexOf('#'), 0)))}})`,
  ],
  service: (id) => [`findings({service: ${promptQuote(id)}})`, `dead({service: ${promptQuote(id)}})`, `list_entries({service: ${promptQuote(id)}})`],
  missing: () => [],
  ref: () => [],
  check: () => [],
});

/** The calls that take this node's id, in the order they are usually useful; a type id is a type whatever the row calls it. */
export const promptHintsFor = (node) => {
  if (node === undefined || node === null || node.key === true) return [];
  const type = node.id.startsWith('type:') ? 'type' : node.type;
  const hints = Object.prototype.hasOwnProperty.call(PROMPT_HINTS, type) ? PROMPT_HINTS[type] : PROMPT_SYMBOL_HINTS;
  return hints(node.id);
};

/** Hints for several nodes, first come first, without repeats, at most `PROMPT_MAX_NEXT`. */
export const promptNextFor = (...nodes) => {
  const seen = new Set();
  for (const node of nodes) {
    for (const hint of promptHintsFor(node)) {
      if (seen.size >= PROMPT_MAX_NEXT) return [...seen];
      seen.add(hint);
    }
  }
  return [...seen];
};

/**
 * The calls a text ends with: the subject's own, then the first way in that
 * reaches it, then the first step it reaches. A check's are the node it is on
 * and a search of its file for the gaps beside it.
 */
export const askNextOf = (subject) => {
  if (subject.scope !== undefined) {
    const members = subject.members ?? [];
    // Not the text being written: the class hint offers it, and it is this answer.
    const self = `describe_for_prompt({id: ${promptQuote(subject.id)}, scope: ${promptQuote(subject.scope)}})`;
    const own = promptHintsFor({ id: subject.id, type: subject.scope === 'class' ? subject.type : subject.scope }).filter((hint) => hint !== self);
    const first = members[0];
    return [...new Set([...own, ...promptNextFor(subject.reachedFrom?.[0], first)])].slice(0, PROMPT_MAX_NEXT);
  }
  if (subject.type === 'check') {
    const on = (subject.check?.places ?? []).find((place) => place.on !== undefined)?.on;
    const file = subject.loc;
    const search = file === undefined ? [] : [`search({query: ${promptQuote(file)}, kinds: ["gaps"]})`];
    return [...promptNextFor(on, subject.reachedFrom?.[0]), ...search].slice(0, PROMPT_MAX_NEXT);
  }
  const firstReal = subject.steps.find((step) => step.type !== 'missing' && step.repeat !== true);
  return promptNextFor(subject, subject.reachedFrom?.[0], firstReal);
};

/* ── What a way in fails with (P87, P90) ── */

const promptChoiceKey = (choices) =>
  choices === undefined
    ? ''
    : choices.map((choice) => `${choice.exception}/${choice.status ?? ''}${choice.assumed === true ? '?' : ''}`).join(',');

/** The order a helper's choices are written in: by status, then exception. */
export const compareFailChoices = (a, b) => (a.status ?? 1000) - (b.status ?? 1000) || promptCmp(a.exception, b.exception);

/**
 * Each (status, exception) once, by status then exception, with its sites in
 * the order they came: what core's `groupFailures` answers, one implementation.
 */
export const groupFails = (fails) => {
  const byKey = new Map();
  for (const item of fails) {
    const key = `${item.status ?? ''}\u0000${item.exception}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [item]);
    else list.push(item);
  }
  const groups = [...byKey.values()].map((at) => {
    const [first] = at;
    const declared = at.every((item) => item.declared !== undefined && item.declared === first.declared) ? first.declared : undefined;
    const used = new Set(at.map((item) => item.source));
    const choices = new Map();
    for (const item of at) for (const choice of item.chosenFrom ?? []) choices.set(promptChoiceKey([choice]), choice);
    return {
      ...(first.status === undefined ? {} : { status: first.status }),
      exception: first.exception,
      ...(at.every((item) => item.assumed === true) ? { assumed: true } : {}),
      ...(declared === undefined ? {} : { declared }),
      ...(at.every((item) => item.via === 'helper') ? { via: 'helper' } : {}),
      ...(choices.size === 0 ? {} : { chosenFrom: [...choices.values()].sort(compareFailChoices) }),
      ...(at.every((item) => item.family === 'auth') ? { family: 'auth' } : {}),
      sources: PROMPT_FAIL_SOURCES.filter((source) => used.has(source)),
      sites: at.length,
      at,
    };
  });
  return groups.sort((a, b) => (a.status ?? 1000) - (b.status ?? 1000) || promptCmp(a.exception, b.exception));
};

/** `401 | 403 | 423`, each status once, lowest first, `?` where only assumed. */
const promptChoiceStatuses = (choices) => {
  const statuses = [...new Set(choices.flatMap((choice) => (choice.status === undefined ? [] : [choice.status])))].sort((a, b) => a - b);
  return statuses.map((status) => `${status}${choices.every((choice) => choice.status !== status || choice.assumed === true) ? '?' : ''}`);
};

/**
 * The statuses a way in can fail with, lowest first and each once, then the
 * exceptions that name none: what the heading says. What a helper can choose
 * stands for it where it says no one status.
 */
const promptFailChips = (fails) => {
  const answers = fails.flatMap((item) =>
    item.status === undefined && (item.chosenFrom ?? []).some((choice) => choice.status !== undefined) ? item.chosenFrom : [item],
  );
  const statuses = [...new Set(answers.flatMap((item) => (item.status === undefined ? [] : [item.status])))].sort((a, b) => a - b);
  const bare = [...new Set(answers.flatMap((item) => (item.status === undefined ? [item.exception] : [])))].sort();
  const assumed = (status) => answers.every((item) => item.status !== status || item.assumed === true);
  return [...statuses.map((status) => `${status}${assumed(status) ? '?' : ''}`), ...bare];
};

/** Where a group's first place is: its `file:line`, or the id of the code it is written in. */
const promptFailPlace = (group) => {
  const [first] = group.at;
  if (first.file === undefined) return promptCode(first.at);
  return promptCode(first.line === undefined ? first.file : `${first.file}:${first.line}`);
};

/**
 * A throw whose exception a helper chooses (P90): the helper with what it can
 * give, `toHttpError (401 | 403 | 423)`, and the classes behind each status.
 */
const promptHelperLine = (group) => {
  const count = group.sites > 1 ? ` ×${group.sites}, first` : '';
  const choices = group.chosenFrom ?? [];
  const statuses = promptChoiceStatuses(choices);
  const head =
    group.status !== undefined
      ? `${group.status}${group.assumed === true ? '?' : ''}`
      : statuses.length > 0
        ? statuses.join(' | ')
        : 'no status';
  const what =
    choices.length > 0
      ? ` — chosen at run time from ${choices.map((choice) => promptCode(choice.exception)).join(', ')}`
      : group.family === 'auth'
        ? ' — refuses a check of who is asking; what the helper returns was not read'
        : ' — what the helper returns was not read';
  return `- **${promptCode(`${group.exception} (${head})`)}**${what} — ${group.sources.join('/')}${count} at ${promptFailPlace(group)}`;
};

/**
 * One answer the subject fails with: the status first, since that is what a
 * caller sees, then how many places raise it. A status nothing on the path
 * writes is marked `?` and says why.
 */
const promptFailLine = (group) => {
  if (group.via === 'helper') return promptHelperLine(group);
  const status = group.status === undefined ? 'no status' : `${group.status}${group.assumed === true ? '?' : ''}`;
  const count = group.sites > 1 ? ` ×${group.sites}, first` : '';
  const assumed =
    group.assumed !== true
      ? ''
      : group.declared === undefined
        ? ' — assumed: no code on the path writes this status'
        : ` — assumed: the class states ${group.declared} and nothing maps it`;
  return `- **${status}** ${promptCode(group.exception)} — ${group.sources.join('/')}${count} at ${promptFailPlace(group)}${assumed}`;
};

/** A failure as the few words a step's mark says: `409 ConflictException`, `500? Error`, a helper with what it can choose. */
const promptFailSay = (group) => {
  if (group.via === 'helper' && group.status === undefined) {
    const statuses = promptChoiceStatuses(group.chosenFrom ?? []);
    if (statuses.length > 0) return `${group.exception} (${statuses.join(' | ')})`;
    return group.family === 'auth' ? `${group.exception} (refuses who is asking)` : group.exception;
  }
  return group.status === undefined ? group.exception : `${group.status}${group.assumed === true ? '? ' : ' '}${group.exception}`;
};

/* ── How long and how often it failed, as the page and the text say it (P111) ── */

/**
 * A duration in milliseconds as it is written: a tenth below 10 ms, whole
 * milliseconds below a second, seconds above. The page's chips and the text
 * say a figure in the same characters, never by the reader's locale.
 */
export const promptMsSay = (ms) => {
  if (ms < 10) return `${Math.round(ms * 10) / 10} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${Math.round(ms / (ms < 10000 ? 100 : 1000)) / (ms < 10000 ? 10 : 1)} s`;
};

/** A share (0 to 1) as a percentage: a tenth below 10%, whole above. */
export const promptRateSay = (rate) => {
  const percent = rate * 100;
  return `${percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent)}%`;
};

/** The figures beside a count: `p95 73 ms, 4.5% errors`, each when measured; '' with none. */
const promptFiguresSay = (figures) =>
  [
    ...(figures.p95 === undefined ? [] : [`p95 ${promptMsSay(figures.p95)}`]),
    ...((figures.errorRate ?? 0) > 0 ? [`${promptRateSay(figures.errorRate)} errors`] : []),
  ].join(', ');

/* ── What a way in answered at run time, beside what it declares (P106) ── */

/** The hours a comparison covers, as a reader is told them: "never seen" means "in these". */
const promptWindowSay = (window) =>
  window === undefined || window.from === null
    ? 'no hours held'
    : `${window.from} to ${window.to}${window.since === undefined ? '' : ` (kept: the last ${window.since})`}`;

const promptShare = (share) => `${Math.round(share * 1000) / 10}%`;

/**
 * The lines of a comparison: each status no failure declares, the declared
 * ones traffic answered, and the declared ones it never did, or why that is
 * not said.
 */
const promptSeenFailLines = (seen, limits) => {
  const lines = [
    ...seen.undeclared.map(
      (row) =>
        `- **${row.status}** ×${row.count}, ${promptShare(row.share)} of requests — not declared` +
        (row.expected === undefined ? '' : `; expected: ${row.expected}`) +
        (row.maybe === undefined ? '' : `; maybe ${row.maybe.map(promptCode).join(', ')}, which name no status`),
    ),
    ...seen.declaredSeen.map((row) =>
      row.assumed === true
        ? `- **${row.status}?** ${promptCode(row.exception)} — assumed, seen ×${row.count}: traffic, not the code, settled it`
        : `- **${row.status}** ${promptCode(row.exception)} — declared, seen ×${row.count}`,
    ),
    ...seen.declaredNeverSeen.map(
      (row) =>
        `- **${row.status ?? 'no status'}** ${promptCode(row.exception)} — declared, never seen in the window` +
        (row.loc === undefined ? '' : ` — at ${promptCode(row.loc)}`),
    ),
  ];
  const kept = lines.slice(0, limits.maxFails);
  if (lines.length > limits.maxFails) kept.push(`- … ${lines.length - limits.maxFails} more; ask undeclared_failures for the rest`);
  if (seen.tooFewHits === true) kept.push(`- ${seen.hits} hits are too few to say a declared failure was never seen`);
  return kept;
};

/* ── Steps ── */

const promptWhere = (item) => [item.service, item.loc === undefined ? undefined : promptCode(item.loc)].filter(Boolean).join(' ');

const promptShape = (step) => {
  const parts = [];
  if (step.params !== undefined && step.params.length > 0) parts.push(`takes ${step.params.map(promptCode).join(', ')}`);
  if (step.returns !== undefined) parts.push(`returns ${promptCode(step.returns)}`);
  return parts.join('; ');
};

const promptVia = (step) => {
  if (step.via === undefined) return '';
  const because = step.via.because === undefined || step.via.because.length === 0 ? '' : `, because ${step.via.because.join('; ')}`;
  return `${step.via.type} (${step.via.confidence}${because})`;
};

/**
 * What a step's line is marked with, in this order: how sure the join is, when
 * it runs, how often, what it throws, how often it was seen, and how long it
 * took and how often it failed there (P111).
 */
/** A best guess traffic went through (P110): the join was seen, so the line says both. */
const promptConfirmed = (step) => step.via !== undefined && step.via.confidence === 'heuristic' && (step.marks?.seen ?? 0) > 0;

const PROMPT_MARKS = Object.freeze([
  [(step) => step.via !== undefined && !PROMPT_CERTAIN.has(step.via.confidence),
    (step) => (promptConfirmed(step) ? `best guess, seen ×${step.marks.seen}` : 'best guess')],
  [(step) => step.marks?.failure === true, () => 'on failure'],
  [(step) => step.marks?.together === true, () => 'side by side'],
  [(step) => step.marks?.perItem !== undefined, (step) => `per item (${step.marks.perItem})`],
  [(step) => step.marks?.nPlusOne === true, () => 'likely N+1'],
  [(step, throws) => throws.length > 0, (step, throws) => `throws ${throws.map(promptFailSay).join(', ')}`],
  [(step) => (step.marks?.seen ?? 0) > 0 && !promptConfirmed(step), (step) => `seen ×${step.marks.seen}`],
  [(step) => step.marks !== undefined && promptFiguresSay(step.marks) !== '', (step) => promptFiguresSay(step.marks)],
]);

/** The lines of one step: what it is, where it lives, how it was reached, its marks, and what it logs. */
const promptStepLines = (step, throwsOf) => {
  const indent = '  '.repeat(Math.max(step.depth - 1, 0));
  if (step.repeat === true) {
    return [
      step.seenAt === undefined
        ? `${indent}- ${promptCode(step.id)} again (a cycle; not followed)`
        : `${indent}- **${step.label}** again — followed under ${promptCode(step.seenAt)}`,
    ];
  }
  const throws = throwsOf(step.id);
  const facts = [promptWhere(step), promptVia(step), promptShape(step)].filter((part) => part.length > 0);
  const marks = PROMPT_MARKS.filter(([when]) => when(step, throws)).map(([, say]) => say(step, throws));
  const head =
    `${indent}- **${step.label}** ${promptCode(step.id)}${facts.length === 0 ? '' : ` — ${facts.join(' — ')}`}` +
    (marks.length === 0 ? '' : ` [${marks.join(', ')}]`);
  const logs = (step.logs ?? []).map(
    (log) => `${indent}  - logs ${log.level}${log.text ? ` ${promptCode(log.text)}` : ''}${log.line ? ` at line ${log.line}` : ''}`,
  );
  return [head, ...logs];
};

/** First step that says what it carries, read as the subject's shapes. */
const promptShapes = (steps) => {
  const first = steps.find((step) => (step.params?.length ?? 0) > 0 || step.returns !== undefined);
  if (first === undefined) return [];
  return [
    ...((first.params ?? []).length === 0 ? [] : [`- in: ${first.params.map(promptCode).join(', ')}`]),
    ...(first.returns === undefined ? [] : [`- out: ${promptCode(first.returns)}`]),
  ];
};

/** The advice for the limit that cut: more rows do nothing past the depth (P92). */
const promptCutLine = (cut, subject, shown) => {
  const deeper = subject.stepsCutBy === 'depth' && cut === subject.stepsCut && shown;
  return `- … ${cut} more step(s) not shown; ask get_flow with a higher ${deeper ? 'depth' : 'maxNodes'}`;
};

/** The steps written, at most `maxSteps`, and a line for what was left out. */
const promptChain = (subject, steps, limits, throwsOf) => {
  const kept = steps.slice(0, limits.maxSteps);
  const cut = subject.stepsCut + steps.length - kept.length;
  const lines = kept.flatMap((step) => promptStepLines(step, throwsOf));
  if (cut > 0) lines.push(promptCutLine(cut, subject, kept.length === steps.length));
  return lines;
};

/**
 * A channel's consumers, each with what it goes on to do: the walk from a
 * channel is its consumers, one subtree each. The first `maxConsumers` are
 * written; the rest are counted.
 */
const promptConsumers = (subject, limits, throwsOf) => {
  const roots = subject.steps.flatMap((step, index) => (step.depth === 1 ? [index] : []));
  if (roots.length === 0) return { count: 0, lines: ['- nothing found in the code consumes it'] };
  const end = roots[limits.maxConsumers] ?? subject.steps.length;
  const lines = promptChain({ ...subject, stepsCut: 0 }, subject.steps.slice(0, end), limits, throwsOf);
  const more = roots.length - Math.min(roots.length, limits.maxConsumers);
  if (more > 0) lines.push(`- … ${more} more consumer(s); ask who_consumes`);
  if (subject.stepsCut > 0) lines.push(promptCutLine(subject.stepsCut, subject, true));
  return { count: roots.length, lines };
};

/* ── Gaps ── */

const promptLineOf = (loc) => {
  const found = /:(\d+)$/.exec(loc ?? '');
  return found === null ? 0 : Number(found[1]);
};

/**
 * Gaps in the order the chain reaches the nodes they are on, each node's by
 * line, then the loops reached from more ways in first among the loops (P89):
 * the order is the renderer's, so it does not depend on the order either side
 * read the rows in.
 */
const promptOrderGaps = (gaps) => {
  const firstAt = new Map();
  gaps.forEach((gap, index) => {
    const key = gap.id ?? '';
    if (!firstAt.has(key)) firstAt.set(key, index);
  });
  const sorted = gaps
    .map((gap, index) => ({ gap, index }))
    .sort(
      (a, b) =>
        firstAt.get(a.gap.id ?? '') - firstAt.get(b.gap.id ?? '') ||
        promptCmp(a.gap.loc?.replace(/:\d+$/, '') ?? '', b.gap.loc?.replace(/:\d+$/, '') ?? '') ||
        promptLineOf(a.gap.loc) - promptLineOf(b.gap.loc) ||
        promptCmp(a.gap.reason, b.gap.reason) ||
        promptCmp(a.gap.message, b.gap.message) ||
        a.index - b.index,
    )
    .map((item) => item.gap);
  const places = sorted.flatMap((gap, index) => (gap.waysIn === undefined ? [] : [index]));
  const ranked = places.map((index) => sorted[index]).sort((a, b) => b.waysIn - a.waysIn);
  places.forEach((index, at) => {
    sorted[index] = ranked[at];
  });
  return sorted;
};

const promptGapLine = (gap) => {
  const place = promptWhere(gap);
  const hint = gap.hint === undefined ? '' : ` Hint: ${gap.hint}`;
  const ways = gap.waysIn === undefined ? '' : ` Reached from ${gap.waysIn} way${gap.waysIn === 1 ? '' : 's'} in.`;
  return `- ${promptCode(gap.reason)}${place.length === 0 ? '' : ` at ${place}`}: ${gap.message}.${ways}${hint}`.replace(/\.\./g, '.');
};

/* ── Sections ── */

const promptSection = (title, lines) => (lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines]);

const promptAccessLines = (access) => {
  if (access === undefined) return [];
  return [
    ...access.guards.map(
      (guard) =>
        `- ${guard.name} · ${PROMPT_WHERE_SAY[guard.where] ?? guard.where} (${guard.via})` +
        (guard.skippedBy === undefined ? '' : `, switched off by @${guard.skippedBy}`),
    ),
    ...(access.optOuts ?? []).map(
      (item) =>
        `- @${item.decorator} on ${item.where === 'controller' ? 'its controller' : 'this route'}` +
        (item.public ? ', open on purpose' : ', switches a check off') +
        (item.skips ? `; ${item.skips} reads it` : '; no check in front reads it'),
    ),
  ];
};

const promptFailLines = (fails, limits) => {
  const groups = groupFails(fails);
  const lines = groups.slice(0, limits.maxFails).map(promptFailLine);
  if (groups.length > limits.maxFails) lines.push(`- … ${groups.length - limits.maxFails} more; ask get_flow for the rest`);
  return lines;
};

const promptPlaceLines = (check) =>
  check.places.map(
    (place) =>
      `- ${place.loc === undefined ? 'no file' : promptCode(place.loc)}: ${place.message}` +
      (place.hint === undefined ? '' : ` (${place.hint})`) +
      (place.on === undefined ? '' : ` — on **${place.on.label}** ${promptCode(place.on.id)}`),
  );

/** The id line: what the subject is, where it lives, and the id the tools take. */
const promptIdLine = (subject) => {
  const title = [subject.type, subject.kind].filter(Boolean).join(' / ');
  return (
    `${promptCode(subject.id)}${subject.key === true ? " (the page's key for it)" : ''} — ${title}` +
    (subject.service === undefined ? '' : ` in ${subject.service}`) +
    (subject.loc === undefined ? '' : ` at ${promptCode(subject.loc)}`)
  );
};

const promptFacts = (subject) => [
  ...(subject.schedule === undefined
    ? []
    : [`- schedule: ${promptCode(subject.schedule.expression)}${subject.schedule.zone ? ` in ${subject.schedule.zone}` : ''}`]),
  ...((subject.hits ?? 0) > 0
    ? [`- seen at run time: ${subject.hits} hits${promptFiguresSay(subject) === '' ? '' : `, ${promptFiguresSay(subject)}`}`]
    : []),
];

/* ── Scoped subjects: a class, a file, a service (P95) ── */

/** A list of ids, a handful written and the rest counted. */
const promptIds = (steps, shown = 3) =>
  steps.slice(0, shown).map((step) => promptCode(step.id)).join(', ') + (steps.length > shown ? ` and ${steps.length - shown} more` : '');

const promptReachSay = (member) =>
  member.reachedFrom.length === 0 ? 'reached from no way in' : `reached from ${promptIds(member.reachedFrom)}`;

/**
 * A class's methods, each with the ways in that reach it and its own chain,
 * one under the other: `maxSteps` is the room for every chain together, given
 * to the methods in order, so a long first chain is cut rather than the rest
 * left out.
 */
const promptClassLines = (subject, bounds, throwsOf) => {
  const members = subject.members ?? [];
  let room = bounds.maxSteps;
  const lines = [];
  for (const member of members.slice(0, bounds.maxMembers)) {
    lines.push(`- **${member.label}** ${promptCode(member.id)}${member.loc === undefined ? '' : ` — ${promptCode(member.loc)}`} — ${promptReachSay(member)}`);
    const steps = member.steps ?? [];
    const kept = steps.slice(0, Math.max(room, 0));
    room -= kept.length;
    lines.push(...kept.flatMap((step) => promptStepLines({ ...step, depth: step.depth + 1 }, throwsOf)));
    const cut = (member.stepsCut ?? 0) + steps.length - kept.length;
    if (cut > 0) lines.push(`  - … ${cut} more step(s) not shown; ask describe_for_prompt({id: ${promptQuote(member.id)}})`);
  }
  if (members.length > bounds.maxMembers) lines.push(`- … ${members.length - bounds.maxMembers} more method(s)`);
  return lines.length === 0 ? ['- no methods recorded'] : lines;
};

/** A file's nodes by the class they belong to, each class once, then the ones that belong to none. */
const promptFileLines = (subject, bounds) => {
  const members = (subject.members ?? []).slice(0, bounds.maxMembers);
  const groups = new Map();
  for (const member of members) {
    const key = member.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const memberLine = (member, indent) =>
    `${indent}- **${member.label}** ${promptCode(member.id)} — ${member.type}${member.kind ? ` / ${member.kind}` : ''}` +
    (member.loc === undefined ? '' : ` at ${promptCode(member.loc)}`);
  const lines = [];
  for (const [group, list] of [...groups].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || promptCmp(a[0], b[0]))) {
    if (group === '') {
      lines.push(...list.map((member) => memberLine(member, '')));
      continue;
    }
    // The class heads its own group; a class from another file is named by its id.
    const head = list.find((member) => member.id === group);
    lines.push(head === undefined ? `- ${promptCode(group)}` : memberLine(head, ''), ...list.filter((member) => member !== head).map((member) => memberLine(member, '  ')));
  }
  const more = (subject.members ?? []).length - members.length;
  if (more > 0) lines.push(`- … ${more} more node(s)`);
  return lines.length === 0 ? ['- nothing recorded in this file'] : lines;
};

/** One count line of a service's overview: `- http · 9: `a`, `b`, `c` and 6 more`. */
const promptCountLine = (item) => `- ${item.kind} · ${item.count}${item.first.length === 0 ? '' : `: ${promptIds(item.first, item.first.length)}${item.count > item.first.length ? ' …' : ''}`}`;

const promptCrossingLines = (crossings) =>
  crossings.map(
    (item) =>
      `- ${item.service} · ${item.count}: ` +
      item.first.map((hop) => `${promptCode(hop.from.id)} ${hop.type} ${promptCode(hop.to.id)}`).join('; ') +
      (item.count > item.first.length ? ' …' : ''),
  );

/** A service's front: its ways in, what it calls and what calls it, its channels, findings and gaps. */
const promptServiceSections = (subject) => {
  const view = subject.overview;
  if (view === undefined) return [];
  const total = (list) => list.reduce((sum, item) => sum + item.count, 0);
  return [
    ...promptSection(`Ways in · ${total(view.waysIn)}`, view.waysIn.length === 0 ? ['- none recorded'] : view.waysIn.map(promptCountLine)),
    ...promptSection(`Calls into other services · ${total(view.crossingsOut)}`, promptCrossingLines(view.crossingsOut)),
    ...promptSection(`Called from other services · ${total(view.crossingsIn)}`, promptCrossingLines(view.crossingsIn)),
    ...promptSection('Channels', [
      ...(view.publishes.length === 0 ? [] : [`- publishes ${promptIds(view.publishes, 8)}`]),
      ...(view.consumes.length === 0 ? [] : [`- consumes ${promptIds(view.consumes, 8)}`]),
    ]),
    ...promptSection(
      `Findings · ${total(view.findings)}`,
      view.findings.flatMap((item) => [
        `- ${item.kind} · ${item.count}`,
        ...item.top.map(
          (gap) => `  - ${gap.loc === undefined ? '' : `${promptCode(gap.loc)}: `}${gap.message}${gap.id === undefined ? '' : ` — ${promptCode(gap.id)}`}`,
        ),
      ]),
    ),
    ...promptSection(
      'Most common gaps',
      view.gaps.map(
        (item) => `- ${promptCode(item.reason)} ×${item.count}${item.first.loc === undefined ? '' : `, first at ${promptCode(item.first.loc)}`}: ${item.first.message}`,
      ),
    ),
  ];
};

/** What a scoped subject says under its heading, by scope: a Strategy, so a scope is one entry. */
const PROMPT_SCOPED = Object.freeze({
  class: (subject, bounds, throwsOf) => promptSection(`Methods · ${(subject.members ?? []).length}`, promptClassLines(subject, bounds, throwsOf)),
  file: (subject, bounds) => promptSection(`In this file · ${(subject.members ?? []).length}`, promptFileLines(subject, bounds)),
  service: (subject) => promptServiceSections(subject),
});

/**
 * The Markdown for one subject, bounded.
 *
 * One heading scheme for every kind of subject: the heading and the id line,
 * what stands in front of it, what it can fail with, what publishes onto it and
 * what consumes it, where a check is, the ways in that reach it, the steps in
 * call order with their marks, the shapes, the gaps, and the calls to make next.
 */
export const renderPrompt = (subject, limits = PROMPT_LIMITS) => {
  const bounds = { ...PROMPT_LIMITS, ...limits };
  const fails = subject.fails ?? [];
  const throwsByStep = new Map();
  for (const item of fails) throwsByStep.set(item.at, [...(throwsByStep.get(item.at) ?? []), item]);
  const throwsOf = (id) => groupFails(throwsByStep.get(id) ?? []);
  const stepLines = (steps) => steps.flatMap((step) => promptStepLines(step, () => []));

  const facts = promptFacts(subject);
  const head = [
    `# ${PROMPT_HEADINGS[subject.scope ?? subject.type] ?? 'Symbol'}: ${subject.label}`,
    '',
    promptIdLine(subject),
    '',
    PROMPT_HEAD,
    ...(facts.length === 0 ? [] : ['', ...facts]),
  ];

  const gaps = promptOrderGaps(subject.gaps);
  const gapLines = gaps.slice(0, bounds.maxGaps).map(promptGapLine);
  if (gaps.length > bounds.maxGaps) gapLines.push(`- … ${gaps.length - bounds.maxGaps} more gap(s)`);

  const isCheck = subject.type === 'check';
  const isChannel = subject.type === 'channel';
  const scoped = subject.scope === undefined ? undefined : PROMPT_SCOPED[subject.scope];
  const producers = subject.producers ?? [];
  const consumers = isChannel ? promptConsumers(subject, bounds, throwsOf) : undefined;
  const chain = isChannel || isCheck || scoped !== undefined ? [] : promptChain(subject, subject.steps, bounds, throwsOf);

  const body = [
    ...head,
    ...promptSection('In front of it', promptAccessLines(subject.access)),
    ...(fails.length === 0 ? [] : promptSection(`Can fail with ${promptFailChips(fails).join(' · ')}`, promptFailLines(fails, bounds))),
    ...(subject.failuresSeen === undefined
      ? []
      : promptSection(
          `Failures seen at run time · ${subject.failuresSeen.hits} hits, ${promptWindowSay(subject.failuresSeen.window)}`,
          promptSeenFailLines(subject.failuresSeen, bounds),
        )),
    ...(isChannel
      ? promptSection(
          `Published by · ${producers.length}`,
          producers.length === 0 ? ['- nothing found in the code publishes to it'] : stepLines(producers),
        )
      : []),
    ...(consumers === undefined ? [] : promptSection(`Consumed by · ${consumers.count}`, consumers.lines)),
    ...(isCheck ? promptSection(`Where · ${subject.check.places.length}`, promptPlaceLines(subject.check)) : []),
    ...promptSection('Reached from', stepLines(subject.reachedFrom ?? [])),
    ...(scoped === undefined ? [] : scoped(subject, bounds, throwsOf)),
    ...(isChannel || isCheck || scoped !== undefined ? [] : promptSection('Steps', chain.length === 0 ? ['- nothing further is recorded from here'] : chain)),
    ...promptSection('Shapes', promptShapes(subject.steps)),
    ...(isCheck || subject.scope === 'service'
      ? []
      : promptSection('Gaps', gapLines.length === 0 ? [subject.scope === undefined ? '- none recorded on this chain' : `- none recorded in this ${subject.scope}`] : gapLines)),
    ...promptSection('Ask next', askNextOf(subject).map((call) => `- ${promptCode(call)}`)),
  ];
  return promptFit(body, bounds.maxChars);
};

/** Whole lines up to the ceiling, then one saying how many were dropped: a text too long to paste is no use. */
export const promptFit = (lines, maxChars) => {
  const kept = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    if (used + line.length + 1 > maxChars - 80) {
      kept.push('', `… ${lines.length - index} more line(s) cut to stay under ${maxChars} characters`);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return `${kept.join('\n')}\n`;
};
