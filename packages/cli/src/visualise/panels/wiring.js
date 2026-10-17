import { formatViewHash, parseHash, parseViewHash, pressed } from '../frame.js';
import { parseMapHash } from '../map.js';
import { STEP_KINDS } from '../steps.js';

/* What ties the panels together: the tabs and their legends, `showView`,
   following a link's address, Copy link on the tabs without one of their
   own, the controls every tab shares, the colophon, and the first view. */
export function wirePage(page) {
  const { LB, MT, copyText, drawBusiest, drawChanges, drawCrossings, drawEntries, drawMissing,
    drawSteps, entryIx, esc, flash, fullScreen, graph, graphView, keys, kindSelect,
    mapController, nodes, notice, reachesCrossing, reopen, repoName, root, seen, setMapFull, sheetEl, startCard, stepsView,
    store } = page;

  /* ── wiring ──────────────────────────────────────────────────────── */

  const tableBar = document.getElementById('table-bar');
  const legendEl = document.getElementById('legend');
  const tabs = [...document.querySelectorAll('.tab')];
  const tabsEl = document.getElementById('tabs');
  const viewSelect = document.getElementById('view-select');
  const mapViewEl = document.getElementById('map-view');
  const workEl = document.querySelector('.work');

  /* The keys are listed once, in the `?` overlay (P101), which every legend
     that has keys points at. */
  const KEYS_LEGEND = '<span><b>keys</b> <button class="link-button" data-keys-open>press ? for every key</button></span>';
  const TABLE_LEGEND =
    '<span><b>unmarked</b> read from the code &middot; <b>annotated</b> an annotation said so &middot; ' +
    '<b>best guess</b> inferred, may be wrong</span>' +
    '<span><b>:param</b> a route hole, so one address matches every id</span>';
  const line = (dash) => `<svg width="30" height="8" aria-hidden="true"><path d="M1 4H29" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  const GRAPH_LEGEND =
    `<span>${line('')} read from code</span><span>${line('6 4')} best guess</span>` +
    `<span>${line('0.5 4')} annotated, declared</span>` +
    '<span><b>band</b> one service; a coloured line leaving it crosses into another</span>' +
    '<span><b>stacked box</b> a group, with its count; click to open</span>' +
    '<span><b>2 guards &middot; 1 pipe</b> plumbing folded onto a way in; click to draw it</span>' +
    '<span><b>+N</b> more of the flow, not drawn; click to expand</span>' +
    '<span><b class="g-key-context">faded, dashed</b> context: who else uses a node, outside the flow; ' +
    'its <b>used by N others</b> badge, or O, draws it</span>' +
    '<span><b class="g-key-bad">3</b> rows name the node &middot; <b class="g-key-warn">2</b> rows at its line</span>' +
    '<span><b>Types</b> a line under each node of what it takes and gives back; click a type in the ' +
    'details to open its fields, <i>expand all</i> or E to open everything under it</span>' +
    '<span><b>hover</b> lights the way from the focus, and shows what a node takes and gives back; ' +
    'on a type in the details, its fields</span>' + KEYS_LEGEND;

  const swatch = (kind) => `<span class="m-swatch m-k-${kind}"></span>`;
  const MAP_LEGEND =
    '<span><b>call order</b> a column per step from the front ends, queues and topics between, ' +
    'stores and outside hosts under the app that uses them &middot; <b>by role</b> front ends, APIs, channels, workers, ' +
    'libraries, data, the outside, packages</span>' +
    `<span>${swatch('http')} requests &middot; ${swatch('message')} messages &middot; ${swatch('workflow')} workflow starts ` +
    `&middot; ${swatch('invoke')} invokes &middot; ${swatch('db')} queries &middot; ${swatch('external')} outside &middot; ` +
    `${swatch('calls')} calls &middot; ${swatch('package')} depends on</span>` +
    '<span><b>thicker</b> more edges, or seen at run time &middot; <b>solid</b> read from code or annotated &middot; <b>dashed</b> a best guess among them</span>' +
    '<span><b>hover</b> dims what a box does not touch</span>' +
    '<span><b>stacked box</b> a family of names, closed; click to open &middot; <b>frame</b> an open family; ' +
    'its name closes it</span>' + KEYS_LEGEND;

  /* Every glyph a step is drawn with, with its word, from the one list the
     rows draw from (P99). */
  const STEPS_LEGEND =
    '<span><b>order</b> depth first, as the source calls: a handler, its services, the stores, calls and ' +
    'publishes they make, then the next service&rsquo;s way in</span>' +
    '<span class="s-glyphs">' + Object.values(STEP_KINDS).map((kind) =>
      `<span><span class="s-glyph">${esc(kind.glyph)}</span> ${esc(kind.say)}</span>`).join('') + '</span>' +
    '<span><b class="s-key-cross">&rarr; orders &middot; requests</b> the steps after it run in another service ' +
    '&middot; <b>runs first</b> the guards in front of a step</span>' +
    '<span><b class="g-key-bad">red</b> a failure path &middot; <b>side by side</b> runs beside its siblings &middot; ' +
    '<b>best guess</b> a join that was inferred, dashed &middot; <b>annotated</b> one an annotation made &middot; ' +
    'unmarked, read from code &middot; <b>seen &times;n</b> seen at run time</span>' +
    '<span><b>per item</b> runs once per item of a loop &middot; <b>likely N+1</b> a query reached per item &middot; ' +
    '<b class="g-key-bad">throws</b> where a failure the way in can answer with is raised &middot; <b>logs</b> the lines a step logs</span>' +
    '<span><b class="g-key-bad">&#x2715; chain breaks</b> where a call finds no route, a way in no handler, or an address was not read</span>' +
    '<span><b>compact</b> a line per step and the marks that change the reading &middot; <b>detailed</b> every mark, ' +
    'the full path, settings read, logs &middot; <b>waterfall</b> a bar per step in its service&rsquo;s colour, ' +
    'one unit per step, not time</span>' +
    '<span><b>hover</b> a row lights its node on the Graph tab&rsquo;s drawing</span>' + KEYS_LEGEND;

  /* The tab open is in the address, so every tab can be linked to (P98):
     the map and the graph write their own, every other tab `#<tab>`, with
     the way in for Steps, the one that shows one. Moving between tabs replaces the
     address rather than adding to the history; picking another way in adds
     to it (ways.js), so Back steps through what a person looked at. */
  const DEFAULT_VIEW = 'map';
  const SHOWS_A_WAY_IN = new Set(['steps']);
  const TABLES = new Set(['crossings', 'missing', 'busiest', 'changes']);
  /* The tabs that never read the way in picked: the Ways in list steps aside
     and the tab takes the width (P101). */
  const WIDE = new Set(['crossings', 'busiest', 'changes']);
  const viewHashNow = (where) => {
    const name = store.get('view');
    const current = store.get('current');
    return formatViewHash(name, SHOWS_A_WAY_IN.has(name) && current !== null ? keys.keyOf(current) : null, where);
  };
  const writeViewHash = (where) => {
    const name = store.get('view');
    if (name === 'map' || name === 'graph') return;
    const next = viewHashNow(where);
    if (location.hash !== next) history.replaceState(null, '', location.pathname + location.search + next);
  };

  /* What a link to a tab asked for and could not be given, said above the
     tab until another is opened or it is dismissed. The graph says its own
     over the drawing (`notice`). */
  const viewNoticeEl = document.getElementById('v-notice');
  const viewNotice = {
    say(html) {
      viewNoticeEl.innerHTML = `<span>${html}</span>` +
        '<button class="g-close" aria-label="Dismiss" title="Dismiss">&times;</button>';
      viewNoticeEl.hidden = false;
    },
    clear() { viewNoticeEl.hidden = true; viewNoticeEl.replaceChildren(); },
  };
  viewNoticeEl.addEventListener('click', (event) => { if (event.target.closest('button')) viewNotice.clear(); });

  /* `where` is where in the tab a link asked to go (`reason` on Not joined),
     kept in the address while the tab is open. */
  function showView(name, asked, where) {
    if (name !== 'graph') fullScreen.set(false);
    if (name !== 'map') setMapFull(false);
    viewNotice.clear();
    store.set('view', name);
    root.classList.toggle('is-map', name === 'map');
    workEl.classList.toggle('is-wide', WIDE.has(name));
    for (const tab of tabs) {
      // One tab in the keyboard's order, the open one; the arrows move between them (P102).
      tab.setAttribute('aria-selected', String(tab.dataset.view === name));
      tab.tabIndex = tab.dataset.view === name ? 0 : -1;
    }
    // The table tabs share one sheet: it is named by whichever of them is open.
    if (TABLES.has(name)) sheetEl.setAttribute('aria-labelledby', 'tab-' + name);
    viewSelect.value = name;
    keepTabInView(name);
    tableBar.hidden = !TABLES.has(name);
    sheetEl.hidden = name === 'graph' || name === 'map' || name === 'steps';
    stepsView.hidden = name !== 'steps';
    graphView.hidden = name !== 'graph';
    mapViewEl.hidden = name !== 'map';
    // Busiest and Changes draw none of the marks a legend explains.
    legendEl.hidden = name === 'busiest' || name === 'changes';
    legendEl.innerHTML = name === 'graph' ? GRAPH_LEGEND : name === 'map' ? MAP_LEGEND : name === 'steps' ? STEPS_LEGEND : TABLE_LEGEND;
    writeViewHash(where);
    if (name === 'steps') drawSteps();
    else if (name === 'crossings') drawCrossings();
    else if (name === 'missing') drawMissing();
    else if (name === 'busiest') drawBusiest();
    else if (name === 'changes') drawChanges();
    else if (name === 'map') mapController.show();
    else graph.show(asked);
  }

  for (const tab of tabs) tab.addEventListener('click', () => showView(tab.dataset.view));

  /* The tab row from the keyboard (P102): Tab reaches the open tab only;
     ← and → open the one before or after it, round the ends, Home and End
     the first and the last. A tab the page has not got (Changes without
     --diff) is passed over. */
  const shownTabs = () => tabs.filter((tab) => !tab.hidden);
  tabsEl.addEventListener('keydown', (event) => {
    const here = shownTabs();
    const at = here.indexOf(event.target.closest('.tab'));
    if (at < 0) return;
    let next = null;
    if (pressed('tabs.move', event)) next = here[(at + (event.key === 'ArrowRight' ? 1 : -1) + here.length) % here.length];
    else if (pressed('tabs.ends', event)) next = event.key === 'Home' ? here[0] : here[here.length - 1];
    if (next === null) return;
    event.preventDefault();
    showView(next.dataset.view);
    next.focus();
  });

  /* On a phone the row scrolls sideways inside itself, faded on the side that
     has more, the open tab kept in sight; where even that is too narrow - under
     360px, or more than two tabs past the edge - a select named View stands in
     for it (P102). The select lists the tabs the row shows. */
  viewSelect.innerHTML = shownTabs().map((tab) =>
    `<option value="${esc(tab.dataset.view)}">${esc(tab.textContent.trim())}</option>`).join('');
  viewSelect.addEventListener('change', () => showView(viewSelect.value));
  const headEl = tabsEl.closest('.panel-head');
  const fadeTabs = () => {
    const more = tabsEl.scrollWidth - tabsEl.clientWidth;
    tabsEl.classList.toggle('is-more-before', more > 1 && tabsEl.scrollLeft > 1);
    tabsEl.classList.toggle('is-more-after', more > 1 && tabsEl.scrollLeft < more - 1);
  };
  function keepTabInView(name) {
    const tab = tabs.find((t) => t.dataset.view === name);
    if (tab === undefined || !(tabsEl.scrollWidth > tabsEl.clientWidth)) return;
    const left = tab.offsetLeft - tabsEl.offsetLeft;
    const pad = 24;
    if (left - pad < tabsEl.scrollLeft) tabsEl.scrollLeft = Math.max(0, left - pad);
    else if (left + tab.offsetWidth + pad > tabsEl.scrollLeft + tabsEl.clientWidth) {
      tabsEl.scrollLeft = left + tab.offsetWidth + pad - tabsEl.clientWidth;
    }
    fadeTabs();
  }
  const narrow = window.matchMedia ? window.matchMedia('(max-width: 359px)') : null;
  /* Measured with the row drawn: the select taken off, the row read, and the
     select put back in one go, so nothing is painted in between. */
  const fitTabs = () => {
    headEl.classList.remove('is-select');
    const over = tabsEl.scrollWidth - tabsEl.clientWidth;
    const each = shownTabs().length > 0 ? tabsEl.scrollWidth / shownTabs().length : 0;
    headEl.classList.toggle('is-select', (narrow !== null && narrow.matches) || (each > 0 && over > 2 * each));
    keepTabInView(store.get('view'));
    fadeTabs();
  };
  tabsEl.addEventListener('scroll', fadeTabs, { passive: true });
  window.addEventListener('resize', fitTabs);
  if (narrow !== null && narrow.addEventListener) narrow.addEventListener('change', fitTabs);

  /* Copy link on the tabs that have no address of their own to build: Steps
     and the tables. The map and the graph copy theirs. */
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-view-link]');
    if (!button) return;
    const link = location.href.split('#')[0] + viewHashNow();
    if (await copyText(link)) flash(button, 'Copied');
    else window.prompt('Copy this link', link);
  });

  const wayInSay = (i) => {
    const meta = nodes[i][MT] || {};
    return esc(meta.m ? `${meta.m} ${meta.p || ''}`.trim() : nodes[i][LB]) + ` (${esc(repoName(i))})`;
  };

  /* A link to a tab: the way in it names becomes the one picked everywhere;
     a tab this page has not got opens the first view instead, and a way in
     or a place in the tab it does not hold is said, not guessed at. */
  const openTab = (asked) => {
    const tab = tabs.find((t) => t.dataset.view === asked.view);
    if (asked.view === null || tab === undefined || tab.hidden) {
      showView(DEFAULT_VIEW);
      viewNotice.say(asked.view === 'changes'
        ? 'This link opens the Changes tab, which a page has only when it was written with <code>--diff</code>. The map is shown.'
        : `This link opens a tab this page does not have, <code>${esc(asked.name)}</code>. The map is shown.`);
      return true;
    }
    const held = asked.entry !== null && entryIx.includes(asked.entry);
    if (held && asked.entry !== store.get('current')) {
      store.set('current', asked.entry);
      drawEntries();
    }
    showView(asked.view, undefined, asked.rest);
    const said = [];
    if (asked.key !== '' && !held) {
      said.push(`This link names a way in this page does not hold, <code>${esc(asked.key)}</code>: it was removed or ` +
        'renamed after the link was made.' + (store.get('current') === null ? '' : ` Shown instead: ${wayInSay(store.get('current'))}.`));
    }
    if (asked.view === 'missing' && asked.rest.reason) {
      const row = page.reasonRowOf(asked.rest.reason);
      if (row === null) {
        said.push(`This link opens Not joined on <code>${esc(asked.rest.reason)}</code>, which has no rows here ` +
          '(or only accepted ones): it was fixed, or accepted, after the link was made.');
      } else {
        // The reason a link names is marked and opened to its places (P100).
        row.classList.add('is-target');
        const details = row.querySelector('.nj-details');
        if (details !== null) details.open = true;
        row.scrollIntoView({ block: 'center' });
      }
    }
    if (said.length > 0) viewNotice.say(said.join(' '));
    return true;
  };

  /* A link to a node is a hash; following one opens the graph there. A link
     made before nodes had keys names a position, and still opens whatever
     sits there; a key this page does not hold is said, not guessed at. Any
     other tab is `#<tab>[/<way in>]` (openTab). */
  const followHash = () => {
    const mapAsked = parseMapHash(location.hash);
    if (mapAsked !== null) {
      mapController.apply(mapAsked);
      if (store.get('view') === 'map') mapController.show(); else showView('map');
      return true;
    }
    const tabAsked = parseViewHash(location.hash, keys);
    if (tabAsked !== null) return openTab(tabAsked);
    const asked = parseHash(location.hash, keys);
    if (asked === null) return false;
    notice.clear();
    if (asked.hops !== null) graph.setHops(asked.hops);
    if (asked.focus === null) {
      showView('graph');
      if (asked.among.length > 0) {
        const hops = asked.hops === null ? '' : '/' + asked.hops;
        notice.say(`This link's key, <code>${esc(asked.key)}</code>, now names ${asked.among.length} nodes, ` +
          'since one was added after the link was made. Open ' + asked.among.map((v) =>
            `<a href="#graph/${keys.keyOf(v)}${hops}">${esc(nodes[v][LB])}</a> (${esc(repoName(v))})`).join(' or ') + '.');
      } else {
        notice.say(`This link names a node this page does not hold, <code>${esc(asked.key)}</code>: ` +
          'it was removed or renamed after the link was made.');
      }
      return true;
    }
    if (asked.hidden !== null) graph.setHidden(asked.hidden);
    // A way in opened from a link or a search hit is the one picked everywhere:
    // the left list marks it and Steps shows it when next opened.
    if (asked.focus !== store.get('current') && entryIx.includes(asked.focus)) {
      store.set('current', asked.focus);
      drawEntries();
    }
    showView('graph', asked.focus);
    const answered = asked.ask === null || graph.ask(asked.ask, asked.focus);
    if (asked.expanded.length > 0 || asked.also.length > 0) reopen(asked.expanded, asked.also);
    if (!answered) {
      notice.say(`This link asks for a path to a node this page does not hold, <code>${esc(asked.ask.key)}</code>: ` +
        'it was removed or renamed after the link was made. Its start is drawn.');
    } else if (asked.byPosition) {
      notice.say('This older link names a node by its place in the page, so it opens what is there in this ' +
        'build. The address now names it by key, which lasts.');
    }
    return true;
  };
  /* A link followed, a hash typed, and Back and Forward all end here. A
     browser that says so twice - popstate, then hashchange for the address
     the first left - is heard once. */
  let followed = null;
  window.addEventListener('popstate', () => { followHash(); followed = location.hash; });
  window.addEventListener('hashchange', () => {
    const twice = followed === location.hash;
    followed = null;
    if (!twice) followHash();
  });

  kindSelect.addEventListener('change', drawEntries);

  /* Read from code, and - only where a trace was imported, which the band's
     run-time pill then counts - what was seen running beside it. */
  document.getElementById('colophon').innerHTML =
    'Read from the source code.' +
    (seen.any ? ' Where a trace was imported, what was seen at run time is shown beside it.' : '') +
    ' A path shown as <code>/orders/:param/cancel</code> ' +
    'is the route as registered; a caller writes a real id there. Where a call could not be ' +
    'followed, it appears under <b>Not joined</b> with the reason rather than being dropped, which is the ' +
    'difference between a map and a guess.';

  /* The first view, once every panel is in place: boot.js calls it last. It
     opens on a way in that actually leaves a service rather than on an empty
     shell (`reachesCrossing`, worked out from the graph), on what the address
     names, and on a first visit - an address naming nothing - offers Start
     here above the map. */
  const start = () => {
    fitTabs();
    store.set('current', entryIx.find((i) => reachesCrossing[i]) ?? entryIx[0] ?? null);
    drawEntries();
    const first = location.hash === '';
    if (!followHash()) showView(DEFAULT_VIEW);
    if (first) startCard.offer();
  };

  return { showView, start };
}
