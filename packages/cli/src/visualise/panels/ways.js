import { promptMsSay, promptRateSay } from '../../../../core/src/prompt-text.js';
import { pressed } from '../frame.js';
import { failChipLines, failChipsSeen, failsOf, scheduleOf } from '../steps.js';

/* The Ways in list on the left: every entry and screen action the rail, the
   kind select and the search's "Filter the list" let through, and what
   picking one does on each tab. */
export function createWays(page) {
  const { FL, KD, LB, MT, RP, driftRowHtml, entryIx, esc, failChipsHtml, files, graphLink, hueOf, kinds, model, nodes,
    repoName, scheduleSay, seen, store, typeName, virtualList } = page;
  const shown = store.get('shown');

  /* ── ways in ─────────────────────────────────────────────────────── */

  const kindSelect = document.getElementById('kind');
  for (const k of [...new Set(entryIx.map((i) => kinds[nodes[i][KD]]).filter(Boolean))].sort()) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    kindSelect.append(o);
  }

  const listEl = document.getElementById('entries');
  const countEl = document.getElementById('entry-count');

  /* What the search handed the list to filter by (P101): the list's own box
     went, so a "Filter the list to …" hit of the one search sets it, and a
     chip above the list says so and takes it off. */
  const filterEl = document.getElementById('list-filter');
  let listFilter = '';
  const filterWays = (query) => {
    listFilter = String(query || '').trim();
    drawEntries();
  };
  filterEl.addEventListener('click', (event) => { if (event.target.closest('[data-filter-clear]')) filterWays(''); });

  const matches = () => {
    const q = listFilter.toLowerCase();
    const kind = kindSelect.value;
    return entryIx.filter((i) => {
      if (!shown.has(repoName(i))) return false;
      if (kind && kinds[nodes[i][KD]] !== kind) return false;
      if (!q) return true;
      return nodes[i][LB].toLowerCase().includes(q) || repoName(i).toLowerCase().includes(q);
    });
  };

  /* The list is drawn a window at a time (P102): a project's thousands of
     ways in cost the rows in sight, not all of them, and the old cut at 400
     is gone. Each row is one fixed height, a taller one with its failures
     line, its words kept to a line each (the full name in the tooltip). The
     failures line wraps whole chips instead, never one cut mid-word, and the
     row is a line taller for each line they take at the list's width, up to
     MAX_FAIL_LINES; anything past those is in the row's tooltip (P137). The
     way in picked is always drawn, wherever the list is scrolled, so a screen
     reader can reach it; Tab reaches one row, the arrows move between them. */
  const ROW_HEIGHT = 56;
  const ROW_HEIGHT_FAILS = 80;
  const FAIL_LINE = 24;
  const MAX_FAIL_LINES = 4;
  /* What a row's own button leaves the failures line: the list less the
     graph link (34px), the row's coloured edge (3px) and its padding (24px). */
  const ROW_INSET = 34 + 3 + 24;
  let listed = [];
  let active = 0;
  const failing = new Map();
  const fails = (i) => {
    // Declared failures, or statuses traffic answered that nothing declares (P106).
    if (!failing.has(i)) failing.set(i, failsOf(model, i).length > 0 || (seen.failures(i)?.undeclared.length ?? 0) > 0);
    return failing.get(i);
  };
  /* A way in's failures line as words, the lead and each chip, as context.js's
     `failChipsHtml` writes them. */
  const failWords = (i) => ({
    lead: failsOf(model, i).length > 0 ? 'can fail with ' : 'seen failing with ',
    chips: failChipsSeen(failsOf(model, i), seen.failures(i)).map((chip) => chip.text),
  });
  let failWidth = 0;
  const failLines = new Map();
  const linesOf = (i) => {
    if (!failLines.has(i)) {
      const { lead, chips } = failWords(i);
      failLines.set(i, Math.min(MAX_FAIL_LINES, failChipLines(lead, chips, failWidth)));
    }
    return failLines.get(i);
  };
  /* How long the way in took at run time, beside how often it was seen (P111):
     its p95, and its error rate when more than one request in a hundred failed. */
  const timeHtml = (i) => {
    const figures = seen.entryStats(i);
    if (figures === null) return '';
    return (figures.p95 === undefined ? ''
      : ` &middot; <span class="row-time" title="One request in twenty took this long or longer">p95 ${esc(promptMsSay(figures.p95))}</span>`) +
      ((figures.errorRate ?? 0) > 0.01
        ? ` &middot; <span class="row-errors" title="Requests that failed">${esc(promptRateSay(figures.errorRate))} errors</span>` : '');
  };
  const heightOf = (i) =>(fails(i) ? ROW_HEIGHT_FAILS + (linesOf(i) - 1) * FAIL_LINE : ROW_HEIGHT);
  const pickedAt = () => {
    const current = store.get('current');
    const at = current === null ? -1 : listed.indexOf(current);
    return at < 0 ? null : at;
  };

  const rowOf = (at) => {
    const i = listed[at];
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'row';
    b.dataset.entry = String(i);
    b.tabIndex = at === active ? 0 : -1;
    b.style.setProperty('--hue', hueOf(nodes[i][RP]));
    if (i === store.get('current')) b.setAttribute('aria-current', 'true');
    const meta = nodes[i][MT] || {};
    const name = meta.m
      ? `<span class="verb">${esc(meta.m)}</span> ${esc(meta.p || '')}`
      : esc(nodes[i][LB]);
    b.title = (meta.m ? `${meta.m} ${meta.p || ''}`.trim() : nodes[i][LB]) +
      (fails(i) ? '\n' + failWords(i).lead + failWords(i).chips.join(' · ') : '');
    b.innerHTML = `<span class="row-name">${name}</span>` +
      `<span class="row-meta">${esc(repoName(i))} &middot; ${esc(kinds[nodes[i][KD]] || typeName(i))}` +
      (files[nodes[i][FL]] ? ' &middot; ' + esc(files[nodes[i][FL]].split('/').pop()) : '') +
      (seen.entry(i) ? ` &middot; <span class="row-seen" title="Hits seen at run time">seen &times;${seen.entry(i).toLocaleString()}</span>` : '') +
      timeHtml(i) + driftRowHtml(i) +
      (seen.never(i) ? ` &middot; <span class="row-never${seen.never(i).strong ? ' is-strong' : ''}" title="${seen.never(i).strong ? 'Never seen while its neighbours were busy' : 'Never seen, and nothing beside it was busy either'}">not seen in ${esc(seen.never(i).window)}</span>` : '') +
      (scheduleOf(model, i) ? ` &middot; <span class="sched">${esc(scheduleSay(scheduleOf(model, i)))}</span>` : '') +
      '</span>' + (fails(i) ? `<span class="row-meta row-fails">${failChipsHtml(i)}</span>` : '');
    b.addEventListener('click', () => {
      // Another way in is a step Back returns from (P98): the address as it
      // was is kept as an entry of its own, and the tab writes the new one
      // over the copy. Moving between tabs replaces it instead.
      if (i !== store.get('current')) history.pushState(null, '', location.href);
      store.set('current', i);
      active = at;
      drawEntries();
      // On the graph a way in is a focus; anywhere else its steps.
      if (store.get('view') === 'graph') page.graph.go(i); else page.showView('steps');
    });
    li.append(b);
    li.insertAdjacentHTML('beforeend', graphLink(i));
    li.lastElementChild.tabIndex = at === active ? 0 : -1;
    return li;
  };
  const rows = virtualList(listEl, {
    count: 0,
    rowHeight: (at) => heightOf(listed[at]),
    render: rowOf,
    keep: pickedAt,
  });
  /* The list's width read again whenever it changes - a turned phone, the
     list put back beside a tab that had it step aside - and every row placed
     again when it does, since the lines its chips take may have changed. */
  const measure = () => {
    const width = Math.max(0, (listEl.clientWidth || 0) - ROW_INSET);
    if (width === failWidth) return false;
    failWidth = width;
    failLines.clear();
    return true;
  };
  measure();
  new ResizeObserver(() => { if (measure()) rows.update(); }).observe(listEl);

  /* ↓ ↑ to the next row and back, Home and End to the ends; the row comes
     into the window first when it was not drawn. */
  const moveTo = (at) => {
    if (at < 0 || at >= listed.length) return;
    active = at;
    const li = rows.rowEl(at);
    for (const drawnAt of rows.drawn()) {
      const el = listEl.querySelector(`li[data-at="${drawnAt}"]`);
      if (el === null) continue;
      for (const focusable of el.querySelectorAll('button, a')) focusable.tabIndex = drawnAt === at ? 0 : -1;
    }
    if (li !== null) li.querySelector('button').focus();
  };
  listEl.addEventListener('keydown', (event) => {
    const li = event.target.closest('li[data-at]');
    if (li === null || !pressed('list.move', event)) return;
    event.preventDefault();
    const at = Number(li.dataset.at);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: listed.length - 1 }[event.key];
    moveTo(Math.max(0, Math.min(listed.length - 1, to)));
  });

  function drawEntries() {
    const found = matches();
    countEl.textContent = found.length.toLocaleString() + ' of ' + entryIx.length.toLocaleString();
    const current = store.get('current');
    const hidesCurrent = listFilter !== '' && current !== null && entryIx.includes(current) && !found.includes(current);
    filterEl.hidden = listFilter === '';
    filterEl.innerHTML = listFilter === '' ? ''
      : `<span class="chip is-on">filtered: <b>${esc(listFilter)}</b>` +
        '<button class="chip-x" data-filter-clear aria-label="Clear the filter" title="Clear the filter">&times;</button></span>' +
        (hidesCurrent ? '<span class="hint">picked way in hidden by the filter ' +
          '<button class="tool" data-filter-clear>Clear</button></span>' : '');
    listed = found;
    const picked = pickedAt();
    active = picked ?? Math.min(active, Math.max(0, listed.length - 1));
    rows.update(listed.length);
    // The way in picked - from a link, a search, a tab - is scrolled to.
    if (picked !== null) rows.scrollTo(picked);
  }

  return { drawEntries, filterWays, kindSelect };
}
