import { createModel, editorUrl, serviceOfRow } from '../graph.js';
import { createKeys, wordFor } from '../frame.js';
import { createSeen, failChips, failsOf, scheduleOf } from '../steps.js';

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
    const chips = failChips(failsOf(model, i));
    return chips.length === 0 ? '' : '<span class="fail-chips" title="What the code says this way in can fail with">can fail with ' +
      chips.map((chip) => `<span class="fail-chip">${esc(chip)}</span>`).join('<span aria-hidden="true">·</span>') + '</span>';
  };
  const scheduleSay = (schedule) => schedule.expression + (schedule.zone ? ' · ' + schedule.zone : '');
  const entryHeadHtml = (i) => {
    const schedule = scheduleOf(model, i);
    return (schedule ? `<span class="hint">fires <span class="sched">${esc(scheduleSay(schedule))}</span></span>` : '') + failChipsHtml(i);
  };
  const accepted = data.accepted || { rows: [], ids: {}, notes: {} };
  const acceptedRows = new Set(accepted.rows);
  const acceptedNote = (r) => accepted.notes[accepted.ids[String(r)]] || '';
  /* The rule that took a row (P76), or '' when it was accepted by itself. */
  const acceptedRule = (r) => {
    const at = accepted.byRule ? accepted.byRule[String(r)] : undefined;
    return at === undefined ? '' : (accepted.rules || [])[at] || '';
  };
  /* The command that accepts every row like this one; the page cannot write the file itself. */
  const acceptLikeHtml = (command) =>
    `<button class="tool" data-accept-cmd="${esc(command)}" title="Copy the flowatlas accept command for every row like this; ` +
    'run it with --dry-run first to see what it takes">Accept all like this</button>';
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

  const store = createStore({ current: null, view: 'map', shown: new Set(repos) });

  return { CROSSES, FL, GLYPH, KD, LB, LN, MT, RP, TY, acceptLikeHtml, accepted, acceptedNote,
    acceptedRows, acceptedRule, confidences, copyText, data, edgeTypes, entryHeadHtml, entryIx, esc, failChipsHtml,
    files, flash, graphLink, guards, hueOf, keys, kinds, model, nodes, opener, plural, reachesCrossing, reasons,
    repoName, repos, rowService, scheduleSay, seen, store, trustHtml, typeName, types, wordHtml };
}
