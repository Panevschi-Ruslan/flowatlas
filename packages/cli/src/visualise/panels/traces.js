import { promptMsSay, promptRateSay } from '../../../../core/src/prompt-text.js';
import { observedPeriodSay, timeTicks, traceRowsOf } from '../steps.js';

/* Run time as requests (P111): the Traces tab - the slowest and the latest
   failing request each way in sampled, one of them drawn as a tree on its own
   time axis - and the Run time changes tab, two observed files compared. Both
   draw into the table tabs' sheet; Traces only when the file kept samples,
   Run time changes only when the page was written with --observed-diff. */
export function createTraces(page) {
  const { LB, MT, RP, data, entryIx, esc, graphLink, hueOf, keys, lightSteps, model, nodes, plural, repoName, repos, seen,
    sheetEl, store, ticksHtml, titleEl } = page;

  /* ── Traces: real requests, as they ran ───────────────────────────── */

  /* Every sample on the page, slowest first and failing before not at one
     time: what a reader opens first is the slow hop or the failure. */
  const samples = seen.sampled.flatMap((entry) => seen.samples(entry).map((sample) => ({ entry, sample })))
    .sort((a, b) => (b.sample.ms ?? -1) - (a.sample.ms ?? -1) ||
      Number(b.sample.error === true) - Number(a.sample.error === true) || a.entry - b.entry);
  let picked = 0;

  const failed = (sample) => sample.error === true || (sample.status ?? 0) >= 500;
  const routeOf = (i) => {
    const meta = nodes[i][MT] || {};
    return meta.m ? `<span class="verb">${esc(meta.m)}</span> ${esc(meta.p || '')}` : esc(nodes[i][LB]);
  };
  const repoIndex = new Map(repos.map((name, i) => [name, i]));
  const hueOfService = (service) => (repoIndex.has(service) ? hueOf(repoIndex.get(service)) : 'var(--faint)');

  const pickHtml = ({ entry, sample }, at) =>
    `<li><button class="tr-pick${failed(sample) ? ' is-failure' : ''}" data-trace-pick="${at}" aria-pressed="${at === picked}" ` +
    `style="--hue:${hueOf(nodes[entry][RP])}">` +
    `<span class="tr-route">${routeOf(entry)}</span>` +
    `<span class="tr-meta">${esc(repoName(entry))}` +
    (sample.ms === undefined ? '' : ` &middot; <b>${esc(promptMsSay(sample.ms))}</b>`) +
    (sample.status === undefined ? '' : ` &middot; <span class="tr-status">${sample.status}</span>`) +
    (sample.slow ? ' &middot; slowest' : '') + (sample.failing ? ' &middot; <span class="tr-bad">failing</span>' : '') +
    '</span></button></li>';

  /* A span of the request as a bar on the request's own axis; a span the map
     has links to its node, one it has not says so. */
  const traceRowHtml = (row, total) => {
    const known = row.node >= 0 && row.node < nodes.length;
    const bad = row.error || (row.status ?? 0) >= 500;
    const span = row.ms === null ? 0 : row.ms;
    const said = [row.label, row.service, row.ms === null ? 'no duration recorded' : promptMsSay(row.ms),
      row.status === null ? '' : 'status ' + row.status, row.placed ? '' : 'start not recorded: put after the span before it']
      .filter(Boolean).join(' · ');
    const cls = ['w-row', 'tr-row', bad ? 'is-failure' : '', span === 0 ? 'is-mark' : '', row.placed ? '' : 'is-unplaced']
      .filter(Boolean).join(' ');
    return `<li class="${cls}"${known ? ` data-node="${row.node}"` : ''} data-depth="${row.depth}" ` +
      `style="--depth:${row.depth};--hue:${hueOfService(row.service)};--start:${(row.start / total) * 100}%;--span:${(span / total) * 100}%">` +
      `<span class="w-label"><span class="s-label">${esc(row.label)}</span>` +
      `<span class="tr-ms">${row.ms === null ? '' : esc(promptMsSay(row.ms))}${row.status === null ? '' : ' · ' + row.status}</span>` +
      (known ? graphLink(row.node) : '<span class="tr-none" title="This span was credited to nothing the map holds">not in the map</span>') +
      `</span><span class="w-track"><span class="w-bar" title="${esc(said)}"></span></span></li>`;
  };
  const treeHtml = ({ entry, sample }) => {
    const { rows, total, cut } = traceRowsOf(sample);
    const width = Math.max(total, 0.01);
    const ticks = ticksHtml(timeTicks(width), width, (n) => (n === 0 ? '0' : promptMsSay(n)));
    return `<h4 class="tr-head">${routeOf(entry)} <span class="hint">${esc(repoName(entry))}` +
      (sample.ms === undefined ? '' : ' &middot; ' + esc(promptMsSay(sample.ms))) +
      (sample.status === undefined ? '' : ' &middot; status ' + sample.status) + ' &middot; ' +
      plural(sample.spans, 'span', 'spans') + '</span> ' +
      `<a class="link-button" href="#steps/${keys.keyOf(entry)}">its steps</a></h4>` +
      `<ol class="s-list is-waterfall tr-rows" aria-label="One request, span by span">` +
      `<li class="w-head"><div class="w-axis" aria-hidden="true"><span class="w-axis-say">one request, as it ran</span>` +
      `<span class="w-ticks">${ticks}</span></div></li>` +
      rows.map((row) => traceRowHtml(row, width)).join('') +
      (cut > 0 ? `<li class="cut">${plural(cut, 'more span', 'more spans')} not kept: a sample holds at most a few hundred</li>` : '') +
      '</ol>';
  };

  const NO_SAMPLES_SAY = 'No sampled requests here: <code>flowatlas observe</code> keeps the slowest and the latest failing ' +
    'requests of each way in unless it was run with <code>--no-samples</code>.';
  function drawTraces() {
    titleEl.textContent = 'Traces';
    if (samples.length === 0) {
      sheetEl.innerHTML = `<div class="sheet is-padded"><p class="hint">${NO_SAMPLES_SAY}</p></div>`;
      return;
    }
    // The way in picked elsewhere opens on its own sample, when it has one.
    const current = store.get('current');
    const ofCurrent = samples.findIndex(({ entry }) => entry === current);
    if (ofCurrent >= 0 && samples[picked].entry !== current) picked = ofCurrent;
    sheetEl.innerHTML = '<div class="sheet is-padded tr-sheet">' +
      '<p class="hint">Real requests, sampled from the traffic' + (seen.period ? ` (${esc(observedPeriodSay(seen.period))})` : '') +
      ': each way in&rsquo;s slowest and its latest failing one, drawn on its own time axis. Steps shows typical times; this is one request.</p>' +
      `<div class="tr-split"><ol class="tr-list" aria-label="Sampled requests">${samples.map(pickHtml).join('')}</ol>` +
      `<section class="tr-tree" aria-live="polite">${treeHtml(samples[picked])}</section></div></div>`;
    lightSteps(sheetEl.querySelector('.tr-rows'));
  }
  sheetEl.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-trace-pick]');
    if (!pick || store.get('view') !== 'traces') return;
    picked = Number(pick.dataset.tracePick);
    for (const button of sheetEl.querySelectorAll('[data-trace-pick]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.tracePick) === picked));
    }
    sheetEl.querySelector('.tr-tree').innerHTML = treeHtml(samples[picked]);
    lightSteps(sheetEl.querySelector('.tr-rows'));
  });
  if (samples.length > 0) document.getElementById('tab-traces').hidden = false;

  /* ── Run time changes: two observed files compared ────────────────── */

  const diff = data.observedDiff || null;
  const ways = new Set(entryIx);
  /* A way in names itself and opens its steps; a join names both ends and
     opens the steps of the way in at either end, else its node in the graph. */
  const diffWhatHtml = (row) => {
    if (row.entry !== undefined) {
      return `<a href="#steps/${keys.keyOf(row.entry)}">${routeOf(row.entry)}</a> <span class="tag">${esc(repoName(row.entry))}</span>`;
    }
    const [from, to] = model.edges[row.edge];
    const way = ways.has(to) ? to : ways.has(from) ? from : -1;
    const ends = `${esc(nodes[from][LB])} &rarr; ${esc(nodes[to][LB])}`;
    return (way >= 0 ? `<a href="#steps/${keys.keyOf(way)}">${ends}</a>` : ends + ' ' + graphLink(to)) +
      ` <span class="tag">${esc(repoName(from))}</span>`;
  };
  const side = (value, name, say) => (value === null ? `<span class="hint">not in ${esc(name)}</span>` : esc(say(value)));
  const timeHtml = (row) => {
    const [a, b] = row.p95;
    const share = a !== null && b !== null && a > 0 ? ` <b>+${Math.round(((b - a) / a) * 100)}%</b>` : '';
    return `${side(a, diff.names[0], promptMsSay)} &rarr; ${side(b, diff.names[1], promptMsSay)}${share}`;
  };
  const errorsHtml = (row) => `${side(row.errorRate[0], diff.names[0], promptRateSay)} &rarr; ${side(row.errorRate[1], diff.names[1], promptRateSay)}` +
    (row.newStatuses ? ` <span class="tag is-bad">new ${row.newStatuses.map(esc).join(', ')}</span>` : '');
  const countHtml = (row) => `${row.count[0].toLocaleString()} &rarr; ${row.count[1].toLocaleString()}`;
  const diffTable = (title, rows, empty, head, cell) =>
    `<div class="sheet is-padded"><h4>${title} &middot; ${rows.length.toLocaleString()}</h4>` +
    (rows.length === 0 ? `<p class="hint">${empty}</p>`
      : `<table class="busiest-table rt-table"><thead><tr><th>What</th><th>${head}</th><th class="num">Requests</th></tr></thead><tbody>` +
        rows.map((row) => `<tr><td>${diffWhatHtml(row)}</td><td class="mono">${cell(row)}</td><td class="num mono">${countHtml(row)}</td></tr>`).join('') +
        '</tbody></table>') + '</div>';
  function drawRunChanges() {
    titleEl.textContent = 'Run time changes';
    if (diff === null) { sheetEl.replaceChildren(); return; }
    const windowSay = (w) => (w && w.from ? observedPeriodSay(w).replace(/^seen /, '') : 'no hours');
    const head = '<div class="sheet is-padded"><p class="c-sum">' +
      `<span><b>${esc(diff.names[0])}</b> ${esc(windowSay(diff.windows[0]))}</span><span>&rarr;</span>` +
      `<span><b>${esc(diff.names[1])}</b> ${esc(windowSay(diff.windows[1]))}</span></p>` +
      `<p class="hint">A time or a failure share is compared only where both files saw at least ${diff.minCount.toLocaleString()} requests` +
      (diff.tooFew > 0 ? `; ${diff.tooFew.toLocaleString()} ${diff.tooFew === 1 ? 'was' : 'were'} under that on one side and left uncompared` : '') +
      '.' + (diff.timed[0] && diff.timed[1] ? '' : ` ${esc(diff.timed[0] ? diff.names[1] : diff.names[0])} measured no times (an older file): only counts compare.`) +
      (diff.leftOut > 0 ? ` ${plural(diff.leftOut, 'id', 'ids')} in the files ${diff.leftOut === 1 ? 'is' : 'are'} not in this graph and ${diff.leftOut === 1 ? 'was' : 'were'} left out.` : '') +
      '</p></div>';
    sheetEl.innerHTML = head +
      diffTable('Slower', diff.slower, 'Nothing got slower by a tenth or more.', 'p95', timeHtml) +
      diffTable('Failing more', diff.failing, 'Nothing fails more.', 'Errors', errorsHtml) +
      diffTable('Newly seen', diff.appeared, `Nothing ran in ${esc(diff.names[1])} that ${esc(diff.names[0])} had not seen.`, 'p95', timeHtml) +
      diffTable('No longer seen', diff.gone, `Everything ${esc(diff.names[0])} saw ran in ${esc(diff.names[1])} too.`, 'p95', timeHtml);
  }
  if (diff !== null) document.getElementById('tab-runtime').hidden = false;

  return { drawRunChanges, drawTraces };
}
