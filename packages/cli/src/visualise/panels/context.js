import { ROW, createModel, editorUrl, serviceOfRow } from '../graph.js';
import { createKeys, wordFor } from '../frame.js';
import { createSeen, failChipsSeen, failsOf, scheduleOf } from '../steps.js';

/* The page's context: what the page sets up first from the packed graph and
   every panel reads - the dictionaries, the nodes and their fields, the walk's
   edges, how a node, a place and a count are written - and the little state
   the tabs share. Each panel is a factory handed this object (with what the
   panels before it returned merged in, see boot.js), so a test can build any
   panel from a packed graph without a browser. */

/* What several panels read and one of them changes: the way in picked on the
   left (`current`), the tab open (`view`) and the services the rail lets
   through (`shown`, one Set for the page's life, changed in place and then set
   again so whoever listens hears of it). `on` is told the key and the value
   after every `set`, and returns how to stop listening. */
export function createStore(initial) {
  const values = new Map(Object.entries(initial));
  const listeners = new Set();
  return {
    get: (key) => values.get(key),
    set(key, value) {
      values.set(key, value);
      for (const listener of [...listeners]) listener(key, value);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createPageContext(data) {
  const { types, repos, kinds, files, edgeTypes, confidences, reasons } = data.dicts;

  /* Node fields, as packed: type, label, repo, kind, file, line, meta. A node
     is known by its position in this page; a link names it by its key, which
     is the same in every build of the graph. */
  const TY = 0, LB = 1, RP = 2, KD = 3, FL = 4, LN = 5, MT = 6;
  /* The service a check row is in, named even where no node is in it (P133). */
  const rowService = (row) => serviceOfRow(repos, row);
  const nodes = data.nodes;
  const keys = createKeys(data.keys, nodes.length);
  /* What was seen at run time, when a trace was imported; nothing otherwise. */
  const seen = createSeen(data);

  const hueOf = (repoIndex) => `var(--s-${repoIndex % 5})`;
  const repoName = (i) => repos[nodes[i][RP]];
  const typeName = (i) => types[nodes[i][TY]];

  /* Edges that lead on from a way in, and the two of them that cross from
     one service into another. */
  const FORWARD = new Set(['handles', 'calls', 'queries', 'caches', 'emits', 'consumes',
    'http_calls', 'hits', 'triggers', 'reads_config']);
  const CROSSES = new Set(['http_calls', 'hits']);

  /* What runs in front of a node - its guards - as the graph lists them: the
     Steps tab says them under the step they guard, never descended. */
  const guards = nodes.map(() => []);
  for (const e of data.edges) if (edgeTypes[e[2]] === 'guarded_by') guards[e[0]].push(e);

  /* Short, readable stand-ins for node types; the vocabulary is the subject's. */
  const GLYPH = {
    entry: 'in', method: 'fn', provider: 'cls', db_query: 'db', table: 'tbl',
    channel: 'ch', producer: 'pub', consumer: 'sub', http_out: 'out',
    ui_component: 'view', ui_action: 'act', ui_api_call: 'req',
    config_key: 'cfg', external_api: 'ext', module: 'mod', repo: 'repo',
    guard: 'grd', interceptor: 'int', pipe: 'pipe',
  };

  /* Labels are source text: `requireSecret<Ctx>(...)`, `click="save()"`. Any
     of it written as markup is escaped first. */
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  /* A code a person reads - a reason, an edge's type, its trust - as the
     page's word for it, with the code in the tooltip (P101). `wordHtml` gives
     the markup, `cls` its classes; `trustHtml` says the trust only when it is
     news, since static, read from code, is what an edge is unless marked. */
  const wordHtml = (kind, code, cls = '') =>
    `<span${cls ? ` class="${cls}"` : ''} title="${esc(code)}">${esc(wordFor(kind, code))}</span>`;
  const trustHtml = (confidence) => (confidence === 'static' || !confidence ? ''
    : wordHtml('trust', confidence, `tag trust is-${confidence}`));

  /* Every node named on the page can be opened in the graph. A link rather
     than a handler, so it can be opened in a new tab or copied. */
  const GRAPH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4"><circle cx="3.5" cy="8" r="2"/><circle cx="12.5" cy="3.5" r="2"/>' +
    '<circle cx="12.5" cy="12.5" r="2"/><path d="M5.3 7.1 10.7 4.4M5.3 8.9l5.4 2.7"/></svg>';
  const graphLink = (i) =>
    `<a class="to-graph" href="#graph/${keys.keyOf(i)}" title="Show in graph" ` +
    `aria-label="Show ${esc(nodes[i][LB])} in the graph">${GRAPH_ICON}</a>`;

  /* The ways in: every entry and screen action, by service and then by name.
     The left list draws them, the band counts what was seen of them, and the
     first view opens on one. */
  const entryIx = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const t = typeName(i);
    if (t === 'entry' || t === 'ui_action') entryIx.push(i);
  }
  entryIx.sort((a, b) => {
    const ra = repoName(a), rb = repoName(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return nodes[a][LB] < nodes[b][LB] ? -1 : 1;
  });

  /* The ways in that leave a service, computed from the graph in hand rather
     than named: walk the forward edges backwards from every crossing, and
     whatever the walk reaches gets there. The first view opens on one, and
     Start here picks among them (P98). Naming a route would only fit one
     project. */
  const reachesCrossing = (() => {
    const back = nodes.map(() => []);
    const reached = new Uint8Array(nodes.length);
    const queue = [];
    for (const e of data.edges) {
      const name = edgeTypes[e[2]];
      if (FORWARD.has(name)) back[e[1]].push(e[0]);
      if (CROSSES.has(name) && !reached[e[0]]) { reached[e[0]] = 1; queue.push(e[0]); }
    }
    for (let head = 0; head < queue.length; head += 1) {
      for (const prev of back[queue[head]]) {
        if (!reached[prev]) { reached[prev] = 1; queue.push(prev); }
      }
    }
    return reached;
  })();

  /* The graph as graph.js reads it: what the drawing, the details, search and
     the steps all ask. */
  const model = createModel(data);

  /* What a way in can fail with and when a job fires (P68, P71), said the
     same way on the Ways in list, the Steps header and the details panel. */
  const failChipsHtml = (i) => {
    // Beside each declared status, what traffic answered, and each status it answered that nothing declares (P106).
    const chips = failChipsSeen(failsOf(model, i), seen.failures(i));
    const declares = failsOf(model, i).length > 0;
    return chips.length === 0 ? '' : `<span class="fail-chips" title="${declares ? 'What the code says this way in can fail with' : 'What traffic answered that the code does not declare'}">` +
      (declares ? 'can fail with ' : 'seen failing with ') +
      chips.map((chip) => `<span class="fail-chip${chip.mark ? ' is-' + chip.mark : ''}"${chip.title ? ` title="${esc(chip.title)}"` : ''}>${esc(chip.text)}</span>`)
        .join('<span aria-hidden="true">·</span>') + '</span>';
  };
  const scheduleSay = (schedule) => schedule.expression + (schedule.zone ? ' · ' + schedule.zone : '');
  /* Bodies traffic carried that differ from what the code declares (P113),
     the paths in the title. A run-time figure like a way in's p95 and error
     rate (P111): the Steps header shows it as a chip, the Ways in row beside
     its time. */
  const driftSay = (drift) => `traffic differs: ${drift.fields} ${drift.fields === 1 ? 'field' : 'fields'}`;
  const driftTitle = (drift) => 'Traffic carried these differently from what the code declares: ' + drift.paths.join(', ') +
    '. Seen in one window of traffic, so never a break on its own: flowatlas contracts says how often.';
  const driftChipHtml = (i) => {
    const drift = seen.drift(i);
    return drift ? `<span class="fail-chips"><span class="fail-chip is-drift" title="${esc(driftTitle(drift))}">${esc(driftSay(drift))}</span></span>` : '';
  };
  /* The same, in a Ways in row's meta line, after its p95 and error rate. */
  const driftRowHtml = (i) => {
    const drift = seen.drift(i);
    return drift ? ` &middot; <span class="row-drift" title="${esc(driftTitle(drift))}">${esc(driftSay(drift))}</span>` : '';
  };
  const entryHeadHtml = (i) => {
    const schedule = scheduleOf(model, i);
    return (schedule ? `<span class="hint">fires <span class="sched">${esc(scheduleSay(schedule))}</span></span>` : '') + failChipsHtml(i) + driftChipHtml(i);
  };
  const accepted = data.accepted || { rows: [], ids: {}, notes: {} };
  const acceptedRows = new Set(accepted.rows);
  const acceptedNote = (r) => accepted.notes[accepted.ids[String(r)]] || '';
  /* The rule that took a row (P76), or '' when it was accepted by itself. */
  const acceptedRule = (r) => {
    const at = accepted.byRule ? accepted.byRule[String(r)] : undefined;
    return at === undefined ? '' : (accepted.rules || [])[at] || '';
  };

  /* What a check row is (P81, P100), as the pack says it - never guessed from
     the words of its reason: its reason's kind (gap, note, finding) and, for
     a finding, its risk (auth, performance, wiring), or the row's own kind
     where what it recorded makes it another (P89's per-item loops). A row of
     a reason the pack has no class for is a gap, as in the core. */
  const reasonClass = data.dicts.reasonClass || [];
  const rowKinds = data.rowKinds || {};
  const classOf = (r) => reasonClass[data.rows[r][ROW.reason]] || ['gap'];
  const rowKind = (r) => rowKinds[String(r)] || classOf(r)[0];
  const rowRisk = (r) => (rowKind(r) === 'finding' ? classOf(r)[1] : undefined);
  /* A row's tag tone: from its risk, so a gap and a finding are told apart by
     what they are rather than by `not-found` in a reason. */
  const RISK_TONES = { auth: 'bad', performance: 'warn', wiring: 'warn' };
  const rowTone = (r) => RISK_TONES[rowRisk(r)] || '';
  /* One place of a row, as the accept commands read it (steps.js). */
  const rowPlace = (r) => {
    const row = data.rows[r];
    return {
      reason: reasons[row[ROW.reason]], service: rowService(row) || '',
      file: row[ROW.file] >= 0 ? files[row[ROW.file]] : '', line: row[ROW.line] || 0, message: row[ROW.message],
    };
  };
  /* `1 node`, `2,048 nodes`. */
  const plural = (n, one, many) => n.toLocaleString() + ' ' + (n === 1 ? one : many);

  /* A `file:line` that opens in the editor `--editor-links` named, or plain text. */
  const editor = data.editor || null;
  const opener = (repo, file, line, text) => {
    const url = editor === null || typeof repo !== 'number' || repo < 0 || file < 0
      ? null
      : editorUrl(editor.name, editor.roots[repo], files[file], line);
    return url === null
      ? `<span class="g-place">${esc(text)}</span>`
      : `<a class="g-place" href="${esc(url)}" title="Open in ${esc(editor.name)}">${esc(text)}</a>`;
  };

  /* Text onto the clipboard, true when it got there. */
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // No clipboard API here (an older browser, or a page it does not trust):
      // the selection still copies.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(area);
      area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      area.remove();
      return copied;
    }
  };

  /* A button says what it did, in its own words, for a moment. */
  const flash = (button, text, ok = true) => {
    const label = button.querySelector('span') || button;
    if (button.dataset.label === undefined) button.dataset.label = label.textContent;
    label.textContent = text;
    button.classList.toggle('is-done', ok);
    clearTimeout(Number(button.dataset.timer));
    button.dataset.timer = String(setTimeout(() => {
      label.textContent = button.dataset.label;
      button.classList.remove('is-done');
    }, 1600));
  };

  /* The first plain wheel over a drawing scrolls the page (P102), and says
     once, in the drawing's corner, how to zoom instead: Ctrl, or ⌘ on a Mac.
     Each drawing says it the first time only. */
  const onMac = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');
  const WHEEL_HINT = (onMac ? '⌘' : 'Ctrl') + ' + scroll to zoom';
  const wheelHint = (canvas) => {
    if (canvas.dataset.wheelHinted !== undefined) return null;
    canvas.dataset.wheelHinted = '';
    const hint = document.createElement('p');
    hint.className = 'g-wheel-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = WHEEL_HINT;
    canvas.append(hint);
    setTimeout(() => hint.remove(), 1500);
    return hint;
  };

  /* No tab is open until the first view is shown (wiring.js `start`): a store
     that began on `map` made opening the page at `#map` a change to nothing,
     so the map's panel was never un-hidden (P137). */
  const store = createStore({ current: null, view: null, shown: new Set(repos) });

  return { CROSSES, FL, GLYPH, KD, LB, LN, MT, RP, TY, accepted, acceptedNote,
    acceptedRows, acceptedRule, confidences, copyText, data, driftRowHtml, edgeTypes, entryHeadHtml, entryIx, esc, failChipsHtml,
    files, flash, graphLink, guards, hueOf, keys, kinds, model, nodes, opener, plural, reachesCrossing, reasons,
    repoName, repos, rowKind, rowPlace, rowRisk, rowService, rowTone, scheduleSay, seen, store, trustHtml, typeName, types, wheelHint,
    wordHtml };
}
