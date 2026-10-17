import { ROW } from '../graph.js';

/* The table tabs: Crossings, Busiest (with the likely N+1 loops) and Changes,
   and the sheets of what a trace saw that the code does not show, which Not
   joined and the problems answer list too. */
export function createTables(page) {
  const { CROSSES, FL, LB, LN, MT, RP, confidences, data, edgeTypes, esc, files, graphLink, hueOf, nodes,
    repoName, repos, rowService, seen, sheetEl, titleEl, trustHtml, wordHtml } = page;

  /* ── crossings: every edge that leaves a service ─────────────────── */

  /* A project with many crossings would build every row in one go, a long
     task each time the tab opened (P102). The rows are sorted once and built
     in chunks: the first CROSSINGS_CHUNK at once, the rest a chunk at a time
     while the browser is idle - or as the table's end nears the screen,
     whichever comes first. What is built is kept for the page's life (the
     build does not change under it), so opening the tab again draws at once. */
  const CROSSINGS_CHUNK = 100;
  const later = typeof requestIdleCallback === 'function'
    ? (work) => requestIdleCallback(work, { timeout: 200 })
    : (work) => setTimeout(work, 0);
  let crossings = null;
  const crossingRowHtml = (e) => {
    const from = nodes[e[0]], to = nodes[e[1]];
    const meta = to[MT] || {};
    return `<tr><td class="mono"><span class="tag" style="color:${hueOf(from[RP])};border-color:${hueOf(from[RP])}">${esc(repos[from[RP]])}</span> ${esc(files[from[FL]] ? files[from[FL]].split('/').pop() + ':' + from[LN] : from[LB])} ${graphLink(e[0])}</td>` +
      `<td class="mono"><span class="tag" style="color:${hueOf(to[RP])};border-color:${hueOf(to[RP])}">${esc(repos[to[RP]])}</span></td>` +
      `<td class="mono">${esc(meta.m || '')} ${esc(meta.p || to[LB])} ${graphLink(e[1])}</td>` +
      `<td>${wordHtml('edge', edgeTypes[e[2]])} ${trustHtml(confidences[e[3]])}</td></tr>`;
  };
  const buildCrossings = () => {
    const rows = data.edges
      .filter((e) => CROSSES.has(edgeTypes[e[2]]))
      .sort((a, b) => repoName(a[0]) < repoName(b[0]) ? -1 : 1);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<table><thead><tr><th>From</th><th>To</th><th>Route</th><th>How</th></tr></thead><tbody></tbody></table>';
    const body = sheet.querySelector('tbody');
    const built = { sheet, rows, done: 0, waiting: false, sentinel: null, observer: null };
    const chunk = () => {
      if (built.done >= rows.length) return;
      const next = Math.min(rows.length, built.done + CROSSINGS_CHUNK);
      body.insertAdjacentHTML('beforeend', rows.slice(built.done, next).map(crossingRowHtml).join(''));
      built.done = next;
      if (built.done < rows.length && !built.waiting) {
        // One chunk waits at a time, however many asked for one.
        built.waiting = true;
        later(() => { built.waiting = false; chunk(); });
      } else if (built.done >= rows.length && built.observer !== null) {
        built.observer.disconnect();
        built.sentinel.remove();
      }
    };
    chunk();
    if (built.done < rows.length && typeof IntersectionObserver === 'function') {
      // The table's end coming near the screen builds the next chunk now.
      built.sentinel = document.createElement('div');
      built.sentinel.className = 'sheet-more';
      built.sentinel.setAttribute('aria-hidden', 'true');
      sheet.append(built.sentinel);
      built.observer = new IntersectionObserver((seen) => {
        if (seen.some((entry) => entry.isIntersecting)) chunk();
      }, { rootMargin: '400px' });
      built.observer.observe(built.sentinel);
    }
    return built;
  };
  function drawCrossings() {
    titleEl.textContent = 'Every crossing';
    crossings ??= buildCrossings();
    sheetEl.replaceChildren(crossings.sheet);
    appendUnmatched();
  }

  /* A sheet of its own under a table, when a trace saw anything the code does not show, or could not place. */
  const appendUnmatched = () => {
    if (seen.unmatched.length === 0 && seen.ambiguous.length === 0) return;
    const more = document.createElement('div');
    more.className = 'sheet is-padded';
    more.id = 'unmatched';
    more.innerHTML = (seen.unmatched.length > 0 ? unmatchedHtml() : '') + ambiguousHtml();
    sheetEl.append(more);
  };

  /* What a trace saw that the code does not show: a check of its own. */
  const UNMATCHED_LIMIT = 100;
  const unmatchedHtml = () => {
    const list = seen.unmatched;
    return `<h4>Seen at run time, not found in code &middot; ${list.length.toLocaleString()}</h4>` +
      '<p class="hint">Calls a trace recorded that match no join here: a way in, a call or a channel the reading missed, ' +
      'or code that is not in the repositories read.</p><ul class="s-unmatched">' +
      list.slice(0, UNMATCHED_LIMIT).map((item) => `<li><span class="tag">${esc(item.kind)}</span> ${esc(item.name)}` +
        (item.service ? ` <span class="hint">${esc(item.service)}</span>` : '') + '</li>').join('') +
      (list.length > UNMATCHED_LIMIT ? `<li class="hint">${(list.length - UNMATCHED_LIMIT).toLocaleString()} more</li>` : '') +
      '</ul>';
  };

  /* What a trace saw that fits several places here, counted on none of them (P85). */
  const ambiguousPlace = (item, k) => {
    if (item.kind !== 'join') return `${esc(nodes[k][LB])} <span class="hint">${esc(repoName(k))}</span>${graphLink(k)}`;
    const e = data.edges[k];
    return `${esc(nodes[e[0]][LB])} &rarr; ${esc(nodes[e[1]][LB])}${graphLink(e[1])}`;
  };
  const ambiguousHtml = () => {
    const list = seen.ambiguous;
    if (list.length === 0) return '';
    return `<h4>Seen at run time, could be more than one place &middot; ${list.length.toLocaleString()}</h4>` +
      '<p class="hint">Each fits several places equally, so none of them is counted: one request is never spread over guesses.</p>' +
      '<ul class="s-unmatched">' +
      list.slice(0, UNMATCHED_LIMIT).map((item) => {
        const places = item.places.map((k) => ambiguousPlace(item, k));
        if (item.unnamed > 0) places.push(`${item.unnamed.toLocaleString()} more`);
        return `<li><span class="tag">${esc(item.kind)}</span> ${esc(item.name)}` +
          (item.service ? ` <span class="hint">${esc(item.service)}</span>` : '') +
          ` &middot; seen ${item.count.toLocaleString()} ${item.count === 1 ? 'time' : 'times'}, could be any of ${places.join(', ')}</li>`;
      }).join('') +
      (list.length > UNMATCHED_LIMIT ? `<li class="hint">${(list.length - UNMATCHED_LIMIT).toLocaleString()} more</li>` : '') +
      '</ul>';
  };

  /* ── busiest methods: what most things lean on (P73) ─────────────── */

  const busiest = data.busiest || { rows: [], ranked: 0 };
  function drawBusiest() {
    titleEl.textContent = 'Busiest methods';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    const most = Math.max(1, ...busiest.rows.map((row) => row[1]));
    const lines = busiest.rows.map(([v, total, own, services, waysIn, depth]) => {
      const ownW = Math.round((own / most) * 100), restW = Math.round(((total - own) / most) * 100);
      return `<tr><td class="mono"><span class="tag" style="color:${hueOf(nodes[v][RP])};border-color:${hueOf(nodes[v][RP])}">` +
        `${esc(repoName(v))}</span> ${esc(nodes[v][LB])} ${graphLink(v)}</td>` +
        `<td class="num">${waysIn.toLocaleString()}</td>` +
        `<td class="num">${depth < 0 ? '&mdash;' : depth}</td>` +
        `<td class="num">${own.toLocaleString()} / ${total.toLocaleString()}</td>` +
        `<td class="hide-narrow"><span class="b-bar" title="${own} from its own service, ${total - own} from ${services > 1 ? 'others' : 'elsewhere'}">` +
        `<span style="width:${ownW}%"></span><span style="width:${restW}%"></span></span></td></tr>`;
    }).join('');
    sheet.classList.add('is-padded');
    sheet.innerHTML = '<p class="hint">Ranked the way <code>flowatlas hotspots</code> ranks them: ' +
      'by how many edges point at a method, then by how many services they come from. <b>Ways in</b> is how many ' +
      'routes, handlers and consumers reach it; <b>depth</b> the fewest steps from one; <b>own / total</b> the edges ' +
      'from its own service against all of them.</p>' +
      (busiest.rows.length === 0 ? '<p class="hint">Nothing calls any method here.</p>'
        : '<table class="busiest-table"><thead><tr><th>Method</th><th class="num">Ways in</th><th class="num">Depth</th>' +
          `<th class="num">Own / total</th><th class="hide-narrow"></th></tr></thead><tbody>${lines}</tbody></table>` +
          (busiest.ranked > busiest.rows.length
            ? `<p class="hint">${(busiest.ranked - busiest.rows.length).toLocaleString()} more methods have a caller; ` +
              '<code>flowatlas hotspots --type method</code> lists them all.</p>' : '')) +
      loopsHtml();
    sheetEl.replaceChildren(sheet);
  }
  /* The likely N+1 loops, reached from the most ways in first, as doctor lists them (P89). */
  function loopsHtml() {
    const loops = busiest.loops || [];
    if (loops.length === 0) return '';
    const items = loops.map(([r, waysIn]) => {
      const row = data.rows[r];
      const file = row[ROW.file] >= 0 ? files[row[ROW.file]] + (row[ROW.line] ? ':' + row[ROW.line] : '') : '';
      return `<tr><td class="mono">${rowService(row) ? esc(rowService(row)) + ' &middot; ' : ''}${esc(file)}` +
        `${row[ROW.node] >= 0 ? ' ' + graphLink(row[ROW.node]) : ''}<div>${esc(row[ROW.message])}</div></td>` +
        `<td class="num">${waysIn.toLocaleString()}</td></tr>`;
    }).join('');
    return '<h4>Likely N+1 loops</h4><table class="busiest-table"><thead><tr><th>Loop</th><th class="num">Ways in</th></tr></thead>' +
      `<tbody>${items}</tbody></table>`;
  }

  /* ── changes: what a branch did, from flowatlas diff (P73) ───────── */

  const changes = data.changes || null;
  /* A route still on the head side opens; a removed one is not in this page. */
  const byKey = (id) => data.entryIds[id] ?? -1;
  const changeRouteHtml = (route, note) => {
    const at = byKey(route.id);
    return `<li><span class="tag">${esc(route.service)}</span> <span class="mono">${esc(route.label)}</span>` +
      (note ? ` <span class="hint">${note}</span>` : '') + (at >= 0 ? ' ' + graphLink(at) : '') + '</li>';
  };
  const changeList = (title, items, empty, render) =>
    `<div class="sheet is-padded"><h4>${title} &middot; ${items.length.toLocaleString()}</h4>` +
    (items.length === 0 ? `<p class="hint">${empty}</p>` : `<ul class="s-unmatched">${items.map(render).join('')}</ul>`) + '</div>';
  function drawChanges() {
    titleEl.textContent = 'Changes';
    if (changes === null) { sheetEl.replaceChildren(); return; }
    const c = changes.counts;
    const delta = changes.unresolved.head - changes.unresolved.base;
    const head = `<div class="sheet is-padded"><p class="c-sum"><span>against <b>${esc(changes.base || 'base')}</b>, ` +
      `${esc(changes.head || 'the working tree')}</span><span><b>+${c.nodesAdded}</b> &minus;${c.nodesRemoved} nodes, ` +
      `${c.nodesChanged} changed</span><span><b>+${c.edgesAdded}</b> &minus;${c.edgesRemoved} edges</span>` +
      `<span>not joined ${changes.unresolved.base} &rarr; <b>${changes.unresolved.head}</b>${delta > 0 ? ' (+' + delta + ')' : ''}</span></p>` +
      '<p class="hint">Read by <code>flowatlas diff</code>, which wrote the whole answer to <code>diff.json</code>.</p></div>';
    sheetEl.innerHTML = head +
      changeList('Removed but still called', changes.stillCalled,
        'No route this branch removed is still called on the head side.',
        (route) => changeRouteHtml(route, 'called from ' + route.callers.map(esc).join(', ')).replace('<li>', '<li class="is-bad">')) +
      changeList('Routes added', changes.routes.added, 'No new routes.', (route) => changeRouteHtml(route, '')) +
      changeList('Routes removed', changes.routes.removed, 'No route was removed.', (route) => changeRouteHtml(route, '')) +
      changeList('Changed shapes', changes.shapes, 'No declaration changed shape.', (shape) =>
        `<li><span class="mono">${esc(shape.name)}</span>` +
        (shape.fields.length ? `<ul class="c-fields">${shape.fields.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
          : ' <span class="hint">differs below its top level, or only where JSON drops it</span>') + '</li>') +
      changeList('New gaps', changes.gaps, 'This branch introduced no contract finding.', (gap) =>
        `<li><span class="tag is-${gap.severity === 'error' ? 'bad' : 'warn'}">${esc(gap.severity)} &middot; ${wordHtml('reason', gap.kind)}</span> ${esc(gap.message)}</li>`);
  }
  if (changes !== null) document.getElementById('tab-changes').hidden = false;

  return { CROSSINGS_CHUNK, ambiguousHtml, appendUnmatched, drawBusiest, drawChanges, drawCrossings, unmatchedHtml };
}
