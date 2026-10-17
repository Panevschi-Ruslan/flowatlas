import { answersOf } from '../graph.js';
import { PROMPT_LIMITS, PROMPT_WALK, promptMsSay, promptRateSay, renderPrompt } from '../../../../core/src/prompt-text.js';
import { STEP_BOUNDS, STEP_KINDS, STEP_MODES, STEP_TIMES, failSay, promptFor, promptTargetOf, stepsOf, timeTicks } from '../steps.js';
import { wordFor } from '../frame.js';

/* The Steps tab and the steps above the drawing: a way in in call order,
   drawn compact, detailed or as a waterfall, and the one Copy as prompt
   handler every tab's buttons use. */
export function createStepsUi(page) {
  const { FL, LB, LN, RP, confidences, copyText, data, edgeTypes, entryHeadHtml, esc, files, flash, graphLink, guards, hueOf,
    model, nodes, opener, plural, repoName, seen, store, titleEl, trustHtml, wordHtml, world } = page;

  /* ── steps: a way in in call order, and Copy as prompt ──────────────── */

  /* steps.js says what the steps are; this draws them. A row opens its
     place in the editor when the page has editor links, its node in the
     Graph tab, and lights that node in the drawing while hovered. */
  const stepsView = document.getElementById('steps-view');
  const stepsList = document.getElementById('s-list');
  const stepsDepth = document.getElementById('s-depth');
  const stepsNote = document.getElementById('s-note');
  const stepsHead = document.getElementById('s-head');

  /* How the steps are drawn (P99): a preference of whoever reads the page,
     so it is kept in their browser and nowhere else. A browser that keeps
     nothing gets compact, and the switch still works for the visit. */
  const MODE_KEY = 'flowatlas.steps.mode';
  const readMode = () => {
    try {
      const kept = localStorage.getItem(MODE_KEY);
      return STEP_MODES.includes(kept) ? kept : STEP_MODES[0];
    } catch {
      return STEP_MODES[0];
    }
  };
  let mode = readMode();
  const modesHtml = () => `<span class="g-split s-modes" role="group" aria-label="How the steps are drawn">` +
    STEP_MODES.map((m) => `<button class="tool" data-step-mode="${m}" aria-pressed="${m === mode}">${m[0].toUpperCase() + m.slice(1)}</button>`)
      .join('') + '</span>';

  /* Which figure a waterfall in time draws (P111): the typical step or the
     slow tail, kept per viewer as the mode is. Offered only in waterfall
     mode on a page whose traffic measured a time. */
  const TIME_KEY = 'flowatlas.steps.time';
  const readTime = () => {
    try {
      const kept = localStorage.getItem(TIME_KEY);
      return STEP_TIMES.includes(kept) ? kept : STEP_TIMES[0];
    } catch {
      return STEP_TIMES[0];
    }
  };
  let timeBy = readTime();
  const TIME_TITLES = {
    p50: 'Each step as long as its median: what a typical request spends there',
    p95: 'Each step as long as its 95th percentile: the slow tail',
  };
  const timesHtml = () => `<span class="g-split s-times" role="group" aria-label="Which time a step is drawn with">` +
    STEP_TIMES.map((t) => `<button class="tool" data-step-time="${t}" aria-pressed="${t === timeBy}" title="${esc(TIME_TITLES[t])}">${t}</button>`)
      .join('') + '</span>';
  const timesEl = document.getElementById('s-times');
  const syncTimes = () => {
    if (timesEl) timesEl.hidden = !(seen.timed && mode === 'waterfall');
    for (const button of document.querySelectorAll('[data-step-time]')) {
      button.setAttribute('aria-pressed', String(button.dataset.stepTime === timeBy));
    }
  };
  /* A share of failed requests worth a chip of its own: above one in a hundred (P111). */
  const ERROR_CHIP = 0.01;

  /* An edge a stand-in typed (P78): how, and whose types; null for any other. */
  const standInOf = (k) => {
    const marked = data.standIns && data.standIns.edges[String(k)];
    return marked ? [data.standIns.via[marked[0]], data.standIns.packages[marked[1]]] : null;
  };
  /* A step read from code says nothing about how it was joined (P101): only
     an annotation and a guess are marked, so the one guess on a way in stands
     out. Each says its trust in words, the code in the tooltip. The third
     field says whether a compact row keeps the mark: only the marks that
     change how the steps read do, and the repeats, so a row with nothing
     under it says why. */
  const STEP_MARKS = [
    [(row) => row.kind !== 'answer' && row.edge >= 0 && row.certain && row.confidence !== 'static',
      (row) => ['is-marked', wordFor('trust', row.confidence), `joined ${row.confidence}: an annotation says so`], false],
    [(row) => row.edge >= 0 && !row.certain && row.confidence !== 'runtime', (row) => row.confirmed > 0
      // A best guess traffic went through (P110): still a guess, now with the evidence beside it.
      ? ['is-guess is-confirmed', wordFor('trust', row.confidence) + ', seen ×' + row.confirmed.toLocaleString(),
        `joined ${row.confidence}: inferred, and traffic went through it ${row.confirmed.toLocaleString()} times in ${seen.window}`]
      : ['is-guess', wordFor('trust', row.confidence), `joined ${row.confidence}: inferred, may be wrong`], true],
    [(row) => row.never !== null, (row) => [row.never.strong ? 'is-never is-strong' : 'is-never', 'not seen in ' + row.never.window,
      row.never.strong ? 'Traffic never touched it while its neighbours were busy: likely unused'
        : 'Traffic never touched it, and nothing beside it was busy either: it may just not have been exercised'], true],
    [(row) => row.failure && row.kind !== 'break', () => ['is-failure', 'on failure', 'Runs only when what comes before it fails'], true],
    [(row) => row.kind === 'break' && row.reason, (row) => ['is-failure', wordFor('reason', row.reason), `The check row that says why: ${row.reason}`], true],
    [(row) => row.together, () => ['is-together', 'side by side', 'Runs beside its siblings, not after them'], false],
    [(row) => row.perItem !== '', (row) => ['is-loop', 'per item (' + row.perItem + ')', 'Runs once per item of a ' + row.perItem + ' loop'], true],
    [(row) => row.nPlusOne, () => ['is-n1', 'likely N+1', 'A query reached once per item of a loop: a list of n items costs n round trips'], true],
    [(row) => row.throws.length > 0, (row) => ['is-throws', 'throws ' + row.throws.map(failSay).join(' · '),
      row.throws.map((f) => failSay(f) + ' (' + f.src + (f.f ? ', ' + f.f + (f.l ? ':' + f.l : '') : '') + ')').join('; ')], true],
    [(row) => row.edge >= 0 && standInOf(row.edge) !== null, (row) => {
      const [via, pkg] = standInOf(row.edge);
      return via === 'shape-file'
        ? ['is-standin', 'shape · ' + pkg, 'Typed by a shape file of the project\'s own, since ' + pkg + ' is not installed: it says what the project wrote, which may not be what runs']
        : ['is-standin', 'source · ' + pkg, 'Typed by the source of ' + pkg + ' in a repository read here, since it is not installed: the source may not be the version that runs']; }, false],
    [(row) => row.seen > 0 && row.confirmed === 0, (row) => ['is-seen', 'seen ×' + row.seen.toLocaleString(), 'Seen this many times at run time'], true],
    // How long it took and how often it failed (P111): the join into the step's figures, else its own span's.
    [(row) => row.p95 !== undefined, (row) => ['is-time', 'p95 ' + promptMsSay(row.p95),
      `One request in twenty took ${promptMsSay(row.p95)} or longer here` + (seen.window ? ` in ${seen.window}` : '')], true],
    [(row) => (row.errorRate ?? 0) > ERROR_CHIP, (row) => ['is-errors', promptRateSay(row.errorRate) + ' errors',
      `${promptRateSay(row.errorRate)} of the requests through this step failed (an error, or a status of 500 or more)`], true],
    [(row) => row.again, () => ['', 'listed above', 'Reached again; its steps are listed where it first appears'], true],
    [(row) => row.loop, () => ['', 'loops back', 'Already on this path'], true],
  ];
  /* What a step logs: the level and the template, folded until asked. */
  const logsHtml = (logs) => logs.length === 0 ? '' :
    `<details class="s-logs"><summary>logs · ${logs.length}</summary><ul>` +
    logs.map((log) => `<li><span class="lv is-${esc(log.level)}">${esc(log.level)}</span>` +
      `<span>${log.text ? esc(log.text) : '<i class="s-log-at">no template</i>'}</span>` +
      (log.line ? `<span class="s-log-at">:${log.line}</span>` : '') + '</li>').join('') +
    '</ul></details>';
  const glyphHtml = (row) =>
    `<span class="s-glyph" title="${esc(STEP_KINDS[row.kind].say)}">${esc(STEP_KINDS[row.kind].glyph)}</span>`;
  const labelOf = (row) => row.kind === 'answer' ? 'answers ' + row.inline
    : row.kind === 'break' ? 'chain breaks: ' + row.inline : nodes[row.node][LB];
  /* Where a step is: the path from the repository's root, or in compact the
     file's name with the path in its tooltip. */
  const placeOf = (v) => (files[nodes[v][FL]] ? files[nodes[v][FL]] + (nodes[v][LN] ? ':' + nodes[v][LN] : '') : '');
  const shortPlaceOf = (v) => {
    const file = files[nodes[v][FL]];
    return file ? file.split('/').pop() + (nodes[v][LN] ? ':' + nodes[v][LN] : '') : '';
  };

  /* A step as a row: `mode` is compact or detailed (P99). */
  const stepRowHtml = (row, at, rowMode = mode) => {
    const v = row.node;
    const broken = row.kind === 'break';
    const detailed = rowMode === 'detailed';
    const label = labelOf(row);
    const inline = !detailed ? ''
      : broken ? (row.message ? `<span class="s-inline">${esc(row.message)}</span>` : '')
        : row.kind !== 'answer' && row.inline && row.inline !== label ? `<span class="s-inline">${esc(row.inline)}</span>` : '';
    const marks = STEP_MARKS.filter(([when, , compact]) => (detailed || compact) && when(row)).map(([, say]) => {
      const [tone, text, title] = say(row);
      return `<span class="s-mark ${tone}" title="${esc(title)}">${esc(text)}</span>`;
    }).join('');
    const full = placeOf(v);
    const where = detailed ? full || repoName(v) : shortPlaceOf(v) || repoName(v);
    const cls = ['s-row', detailed ? 'is-detailed' : 'is-compact', row.failure ? 'is-failure' : '', broken ? 'is-break' : '',
      row.edge >= 0 && !row.certain ? 'is-guess' : '', row.together ? 'is-together' : '', row.kind === 'config' ? 'is-config' : '']
      .filter(Boolean).join(' ');
    return `<li class="${cls}" data-node="${v}" data-depth="${row.depth}" data-at="${at}" ` +
      `style="--depth:${row.depth};--hue:${hueOf(nodes[v][RP])}">` +
      `<span class="s-what">${glyphHtml(row)}<span class="s-label">${esc(label)}</span>${inline}</span>` +
      (marks ? `<span class="s-marks">${marks}</span>` : '') +
      (row.kind === 'answer' || broken ? ''
        : `<span class="s-where"${full && !detailed ? ` title="${esc(full)}"` : ''}>` +
          `${opener(nodes[v][RP], nodes[v][FL], nodes[v][LN], where)}${graphLink(v)}</span>`) +
      (detailed ? logsHtml(row.logs) : '') +
      '</li>';
  };

  /* Where a way in leaves one service for another: a row of its own between
     the call and what answers it, in the colour of the service it enters,
     the edge in words and its trust only when it is news (P99). */
  const crossHtml = (row) => {
    if (!row.crosses || row.edge < 0) return '';
    const e = model.edges[row.edge];
    const from = repoName(e[0]);
    const into = repoName(row.node);
    return `<li class="s-cross" data-depth="${row.depth}" style="--depth:${row.depth};--hue:${hueOf(nodes[row.node][RP])}" ` +
      `title="${esc(`Leaves ${from} for ${into}`)}">` +
      `<b class="s-cross-to">&rarr; ${esc(into)}</b> ` +
      `<span class="s-cross-how">&middot; ${wordHtml('edge', edgeTypes[e[2]])}</span>` +
      (confidences[e[3]] === 'static' ? '' : ' ' + trustHtml(confidences[e[3]])) + '</li>';
  };

  /* What runs in front of a step before it does: its guards, said under it
     and never walked (P99, as the Walk tab said them). */
  const firstHtml = (row) => {
    if (row.again || row.loop || row.kind === 'answer' || row.kind === 'break' || row.kind === 'config') return '';
    const guarded = guards[row.node];
    if (!guarded || guarded.length === 0) return '';
    return `<li class="s-first" style="--depth:${row.depth + 1}"><b>runs first</b> ` +
      guarded.map((e) => esc(nodes[e[1]][LB].replace(/\(.*/, ''))).join(', ') + '</li>';
  };

  /* ── the waterfall (P99) ──────────────────────────────────────────── */

  /* How a waterfall measures a step. In units, a step nothing runs under is
     one wide and a parent as wide as its children, so the drawing shows what
     runs inside what and beside what, never how long: its axis says so. In
     time (P111), each step is as long as its typical figure - p50 or p95 of
     every request through it - laid end to end in call order: a shape, not
     one request, and the axis says that too. A step with no figure keeps a
     small hatched stand-in. */
  const ticksOf = (total) => {
    const step = Math.max(1, Math.ceil(total / 8));
    const ticks = [];
    for (let n = 0; n <= total; n += step) ticks.push(n);
    return ticks;
  };
  const BAR_SAYS = { answer: 'an answer, not a step', break: 'the chain stops here' };
  /* What a bar's length is, in its tooltip: a figure, the steps under it, or a stand-in. */
  const TIME_SAYS = {
    own: (row, by) => `${by} ${promptMsSay(row.ms)}`,
    inside: (row, by) => (row.timed ? `${by} ${promptMsSay(row.ms)}, drawn as long as the steps under it laid end to end`
      : 'no time of its own measured: drawn as long as the steps under it'),
    'stand-in': () => 'no time measured: drawn at a stand-in width, not to scale',
    mark: () => 'a mark, not a step',
  };
  const timeScale = (by) => ({
    say: `typical time per step (${by}), not one request`,
    total: (found) => found.timed,
    of: (row) => ({ start: row.tStart, span: row.tSpan }),
    ticks: timeTicks,
    tick: (n) => (n === 0 ? '0' : promptMsSay(n)),
    said: (row) => TIME_SAYS[row.tBy](row, by),
  });
  const WATERFALL_SCALES = {
    units: {
      say: 'steps, not time',
      total: (found) => found.rows[0].span,
      of: (row) => ({ start: row.start, span: row.span }),
      ticks: ticksOf,
      tick: (n) => String(n),
      said: (row) => row.span + (row.span === 1 ? ' step' : ' steps'),
    },
    p50: timeScale('p50'),
    p95: timeScale('p95'),
  };
  const axisHtml = (total, scale) =>
    `<div class="w-axis" aria-hidden="true"><span class="w-axis-say">${esc(scale.say)}</span>` +
    `<span class="w-ticks">${scale.ticks(total).map((n) =>
      `<span class="w-tick" style="left:${(n / total) * 100}%">${esc(scale.tick(n))}</span>`).join('')}</span></div>`;
  const waterfallRowHtml = (row, at, total, scale) => {
    const v = row.node;
    const { start, span } = scale.of(row);
    const mark = span === 0;
    const label = labelOf(row);
    const timeScaled = scale !== WATERFALL_SCALES.units;
    const said = row.again ? 'listed above' : row.loop ? 'loops back' : BAR_SAYS[row.kind] || scale.said(row);
    const cls = ['w-row', row.failure ? 'is-failure' : '', row.kind === 'break' ? 'is-break' : '', mark ? 'is-mark' : '',
      row.edge >= 0 && !row.certain ? 'is-guess' : '', timeScaled && row.tBy === 'stand-in' ? 'is-untimed' : '',
      timeScaled && row.tBy === 'inside' && !row.timed ? 'is-spanning' : '']
      .filter(Boolean).join(' ');
    const errors = (row.errorRate ?? 0) > ERROR_CHIP
      ? `<span class="s-mark is-errors" title="${esc(promptRateSay(row.errorRate))} of the requests through this step failed">` +
        `${esc(promptRateSay(row.errorRate))} errors</span>` : '';
    return `<li class="${cls}" data-node="${v}" data-depth="${row.depth}" data-at="${at}" ` +
      `style="--depth:${row.depth};--hue:${hueOf(nodes[v][RP])};--start:${(start / total) * 100}%;--span:${(span / total) * 100}%">` +
      `<span class="w-label">${glyphHtml(row)}<span class="s-label">${esc(label)}</span>` +
      (row.crosses && row.edge >= 0 ? `<span class="w-cross" title="Leaves one service for another">&rarr; ${esc(repoName(v))}</span>` : '') +
      errors +
      `</span><span class="w-track"><span class="w-bar" title="${esc(label + ' · ' + said)}"></span></span></li>`;
  };
  /* A way in as a bar per step, in its service's colour, children under
     their parent and side-by-side siblings from one x. */
  const waterfallHtml = (found, scale = WATERFALL_SCALES.units) => {
    const total = Math.max(scale === WATERFALL_SCALES.units ? 1 : 0.01, scale.total(found) || 0);
    return `<li class="w-head">${axisHtml(total, scale)}</li>` +
      found.rows.map((row, at) => waterfallRowHtml(row, at, total, scale)).join('');
  };
  /* The scale a waterfall of these rows is drawn on: time when a step had a figure, units otherwise. */
  const scaleFor = (found) => (found.timed > 0 ? WATERFALL_SCALES[timeBy] : WATERFALL_SCALES.units);

  /* ── a way in's steps, in the mode asked ──────────────────────────── */

  /* The rows a way in's list holds before it says how many more there are;
     the cut line raises it for that way in, for the visit. */
  const rowsCaps = new Map();
  const rowsCapOf = (entry) => rowsCaps.get(entry) ?? STEP_BOUNDS.rows;
  const cutHtml = (found, entry, depth) => {
    const said = [];
    if (found.cut.depth > 0) said.push(`${plural(found.cut.depth, 'more step', 'more steps')} past depth ${depth}: raise the depth`);
    if (found.cut.rows > 0) {
      said.push(`${plural(found.cut.rows, 'more step', 'more steps')} past the first ${rowsCapOf(entry).toLocaleString()} rows: ` +
        `<button class="link-button" data-steps-more="${entry}">show ${STEP_BOUNDS.rows.toLocaleString()} more</button>`);
    }
    return said.length === 0 ? '' : `<li class="cut s-cut">${said.join('; ')}; or open it in the graph.</li>`;
  };
  const stepsHtml = (entry, depth, drawMode = mode) => {
    const found = stepsOf(model, entry, { depth, rows: rowsCapOf(entry), config: drawMode === 'detailed', answersOf, seen, time: timeBy });
    const rows = drawMode === 'waterfall' ? waterfallHtml(found, scaleFor(found))
      : found.rows.map((row, at) => crossHtml(row) + stepRowHtml(row, at, drawMode) + firstHtml(row)).join('');
    return { found, html: rows + cutHtml(found, entry, depth) };
  };
  const stepsSaid = (found) => {
    const steps = found.rows.filter((row) => row.kind !== 'break' && row.kind !== 'config').length;
    const settings = found.rows.filter((row) => row.kind === 'config').length;
    const guesses = found.rows.filter((row) => row.edge >= 0 && !row.certain && row.confirmed === 0).length;
    const confirmed = found.rows.filter((row) => row.confirmed > 0).length;
    const failing = found.rows.filter((row) => row.failure && row.kind !== 'break').length;
    const breaks = found.rows.filter((row) => row.kind === 'break').length;
    return [plural(steps, 'step', 'steps'), settings ? plural(settings, 'setting read', 'settings read') : '',
      guesses ? plural(guesses, 'best guess', 'best guesses') : '',
      confirmed ? plural(confirmed, 'best guess', 'best guesses') + ' confirmed by traffic' : '',
      failing ? failing + ' on failure' : '', breaks ? plural(breaks, 'break', 'breaks') : '', seen.entry(found.rows[0].node) ? 'seen ×' + seen.entry(found.rows[0].node).toLocaleString() : '',
      found.rows[0].p95 !== undefined ? 'p95 ' + promptMsSay(found.rows[0].p95) : '',
      (found.rows[0].errorRate ?? 0) > ERROR_CHIP ? promptRateSay(found.rows[0].errorRate) + ' errors' : '']
      .filter(Boolean).join(' · ');
  };
  const MODE_NOTES = {
    compact: 'in call order, as the source reads; not timed.',
    detailed: 'in call order, as the source reads; not timed.',
    waterfall: 'a bar per step, laid out in steps, not time.',
  };
  const modeNote = (found) => (mode === 'waterfall' && found.timed > 0
    ? `a bar per step, as long as its typical time (${timeBy}) and laid end to end in call order: not one request.`
    : MODE_NOTES[mode]);
  function drawSteps() {
    if (store.get('current') === null) return;
    titleEl.textContent = nodes[store.get('current')][LB];
    const { found, html } = stepsHtml(store.get('current'), Number(stepsDepth.value));
    stepsList.innerHTML = html;
    stepsList.classList.toggle('is-waterfall', mode === 'waterfall');
    stepsHead.innerHTML = entryHeadHtml(store.get('current'));
    stepsNote.textContent = stepsSaid(found) + ' · ' + modeNote(found);
    syncTimes();
  }
  stepsDepth.addEventListener('change', drawSteps);

  /* The switch, on the Steps bar and above the drawing alike: one mode for
     both, kept for the next visit. */
  const syncModes = () => {
    for (const button of document.querySelectorAll('[data-step-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.stepMode === mode));
    }
  };
  const setStepMode = (next) => {
    if (!STEP_MODES.includes(next)) return;
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Nothing kept: the mode holds for this visit.
    }
    syncModes();
    syncTimes();
    if (store.get('view') === 'steps') drawSteps();
    stepsInGraph.redraw();
  };
  const stepMode = () => mode;
  const setStepTime = (next) => {
    if (!STEP_TIMES.includes(next)) return;
    timeBy = next;
    try {
      localStorage.setItem(TIME_KEY, next);
    } catch {
      // Nothing kept: the figure holds for this visit.
    }
    syncTimes();
    if (store.get('view') === 'steps') drawSteps();
    stepsInGraph.redraw();
  };
  const stepTime = () => timeBy;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step-mode]');
    if (button) { setStepMode(button.dataset.stepMode); return; }
    const time = event.target.closest('[data-step-time]');
    if (time) { setStepTime(time.dataset.stepTime); return; }
    const more = event.target.closest('[data-steps-more]');
    if (more) {
      const entry = Number(more.dataset.stepsMore);
      rowsCaps.set(entry, rowsCapOf(entry) + STEP_BOUNDS.rows);
      if (store.get('view') === 'steps') drawSteps();
      stepsInGraph.redraw();
    }
  });
  syncModes();
  syncTimes();

  /* Hovering a step lights its node wherever the drawing has it. */
  const lightNode = (v) => {
    for (const el of world.querySelectorAll('.g-node.is-hover')) el.classList.remove('is-hover');
    if (v === null) return;
    world.querySelector(`.g-node[data-node="${v}"]`)?.classList.add('is-hover');
  };
  const lightSteps = (list) => {
    list.addEventListener('pointerover', (event) => {
      const row = event.target.closest('[data-node]');
      lightNode(row ? Number(row.dataset.node) : null);
    });
    list.addEventListener('pointerleave', () => lightNode(null));
    list.addEventListener('focusin', (event) => {
      const row = event.target.closest('[data-node]');
      if (row) lightNode(Number(row.dataset.node));
    });
  };
  lightSteps(stepsList);

  /* On the Graph tab, a way in's steps open above the drawing, so a row
     lights the box it names; drawn the way the Steps tab draws them. */
  const stepsInGraph = (() => {
    const el = document.getElementById('g-steps');
    let of = null;
    lightSteps(el);
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-steps-close]')) { of = null; el.hidden = true; lightNode(null); }
    });
    const draw = () => {
      const { found, html } = stepsHtml(of, STEP_BOUNDS.depth);
      el.innerHTML = `<div class="g-head"><p><b>Steps of ${esc(nodes[of][LB])}</b> · ${esc(stepsSaid(found))}</p>` +
        `<span>${modesHtml()}${seen.timed && mode === 'waterfall' ? ' ' + timesHtml() : ''} <button class="tool" data-prompt="entry:${of}">Copy as prompt</button> ` +
        '<button class="g-close" data-steps-close aria-label="Close steps" title="Close">&times;</button></span></div>' +
        `<div class="s-head">${entryHeadHtml(of)}</div>` +
        `<ol class="s-list${mode === 'waterfall' ? ' is-waterfall' : ''}">${html}</ol>`;
    };
    return {
      toggle(v) {
        if (of === v) { of = null; el.hidden = true; lightNode(null); return; }
        of = v;
        draw();
        el.hidden = false;
      },
      redraw() { if (of !== null) draw(); },
    };
  })();

  /* Copy as prompt: one handler for every button that asks, on any tab, in
     the words describe_for_prompt answers with (P97). `promptOf('row:<at>')`
     is the same text for a row menu (P100); `class:<at>`, `file:<service>#<path>`
     and `service:<name>` write the scopes the server writes (P134). */
  const promptKit = { seen, walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };
  const promptOf = (asked) => {
    // `agent:<row>` is the row's check as a task for an agent (P122).
    if (asked.startsWith('agent:')) {
      const row = promptTargetOf('row:' + asked.slice('agent:'.length));
      return row === null ? '' : promptFor(model, row, { ...promptKit, task: 'close' });
    }
    const target = promptTargetOf(asked);
    return target === null ? '' : promptFor(model, target, promptKit);
  };
  const copyPrompt = async (button, asked) => {
    const text = promptOf(asked);
    if (text === '') return;
    if (await copyText(text)) flash(button, 'Copied');
    else window.prompt('Copy this prompt', text);
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    event.preventDefault();
    copyPrompt(button, button.dataset.prompt);
  });
  document.getElementById('s-copy').addEventListener('click', (event) => {
    if (store.get('current') !== null) copyPrompt(event.currentTarget, 'entry:' + store.get('current'));
  });

  return { drawSteps, lightSteps, promptOf, setStepMode, setStepTime, stepMode, stepRowHtml, stepTime, stepsInGraph, stepsView,
    waterfallHtml };
}
