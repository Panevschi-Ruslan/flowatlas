import { parseHash } from '../frame.js';
import { parseMapHash } from '../map.js';

/* What ties the panels together: the tabs and their legends, `showView`,
   following a link's hash, the controls every tab shares, the colophon, and
   the first view. */
export function wirePage(page) {
  const { CROSSES, FORWARD, LB, capSel, data, depthSel, drawBusiest, drawChanges, drawCrossings,
    drawEntries, drawMissing, drawSteps, drawWalk, edgeTypes, entryIx, entrySearch, esc, fullScreen,
    graph, graphView, keys, kindSelect, mapController, nodes, notice, reopen, repoName, root, setMapFull,
    stepsView, store, walkEl } = page;

  /* ── wiring ──────────────────────────────────────────────────────── */

  const controls = document.getElementById('walk-controls');
  const legendEl = document.getElementById('legend');
  const tabs = [...document.querySelectorAll('.tab')];
  const mapViewEl = document.getElementById('map-view');

  const WALK_LEGEND =
    '<span><b>Trust</b> static, read from the code &middot; marker, an annotation said so &middot; heuristic, a guess</span>' +
    '<span><b>:param</b> a route hole, so one address matches every id</span>';
  const line = (dash) => `<svg width="30" height="8" aria-hidden="true"><path d="M1 4H29" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  const GRAPH_LEGEND =
    `<span>${line('')} static</span><span>${line('6 4')} heuristic</span>` +
    `<span>${line('0.5 4')} marker, declared</span>` +
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
    'on a type in the details, its fields</span>' +
    '<span><b>keys</b> arrows move &middot; Enter opens &middot; + expands &middot; O who else &middot; W unfolds plumbing &middot; ' +
    'T types &middot; E opens a type all the way &middot; F full screen &middot; Escape closes &middot; double-click centres</span>';

  const swatch = (kind) => `<span class="m-swatch m-k-${kind}"></span>`;
  const MAP_LEGEND =
    '<span><b>call order</b> a column per step from the front ends, queues and topics between, ' +
    'stores and outside hosts under the app that uses them &middot; <b>by role</b> front ends, APIs, channels, workers, ' +
    'libraries, data, the outside, packages</span>' +
    `<span>${swatch('http')} requests &middot; ${swatch('message')} messages &middot; ${swatch('workflow')} workflow starts ` +
    `&middot; ${swatch('invoke')} invokes &middot; ${swatch('db')} queries &middot; ${swatch('external')} outside &middot; ` +
    `${swatch('calls')} calls &middot; ${swatch('package')} depends on</span>` +
    '<span><b>thicker</b> more edges, or seen at run time &middot; <b>solid</b> certain &middot; <b>dashed</b> a best guess among them</span>' +
    '<span><b>hover</b> dims what a box does not touch</span>' +
    '<span><b>stacked box</b> a family of names, closed; click to open &middot; <b>frame</b> an open family; ' +
    'its name closes it</span>' +
    '<span><b>keys</b> Tab moves &middot; Enter opens &middot; F full screen &middot; Escape closes &middot; ' +
    'double-click draws one box and what it touches</span>';

  const STEPS_LEGEND =
    '<span><b>order</b> depth first, as the source calls: a handler, its services, the stores, calls and ' +
    'publishes they make, then the next service&rsquo;s way in</span>' +
    '<span><b>in</b> handler &middot; <b>fn</b> service &middot; <b>db</b> store &middot; <b>http</b> outbound call &middot; ' +
    '<b>ch</b> queue or topic &middot; <b>&lambda;</b> function &middot; <b>wf</b> workflow</span>' +
    '<span><b class="g-key-bad">red</b> a failure path &middot; <b>side by side</b> runs beside its siblings &middot; ' +
    '<b>best guess</b> a join that was inferred, dashed &middot; <b>seen &times;n</b> seen at run time</span>' +
    '<span><b>per item</b> runs once per item of a loop &middot; <b>likely N+1</b> a query reached per item &middot; ' +
    '<b class="g-key-bad">throws</b> where a failure the way in can answer with is raised &middot; <b>logs</b> the lines a step logs</span>' +
    '<span><b class="g-key-bad">&#x2715; chain breaks</b> where a call finds no route, a way in no handler, or an address was not read</span>' +
    '<span><b>hover</b> a row lights its node on the Graph tab&rsquo;s drawing</span>';

  function showView(name, asked) {
    if (name !== 'graph') fullScreen.set(false);
    if (name !== 'map') setMapFull(false);
    store.set('view', name);
    root.classList.toggle('is-map', name === 'map');
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === name));
    controls.hidden = name !== 'walk';
    walkEl.hidden = name === 'graph' || name === 'map' || name === 'steps';
    stepsView.hidden = name !== 'steps';
    graphView.hidden = name !== 'graph';
    mapViewEl.hidden = name !== 'map';
    // Busiest and Changes draw none of the marks a legend explains.
    legendEl.hidden = name === 'busiest' || name === 'changes';
    legendEl.innerHTML = name === 'graph' ? GRAPH_LEGEND : name === 'map' ? MAP_LEGEND : name === 'steps' ? STEPS_LEGEND : WALK_LEGEND;
    if ((name !== 'graph' && location.hash.startsWith('#graph')) || (name !== 'map' && location.hash.startsWith('#map'))) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (name === 'walk') drawWalk();
    else if (name === 'steps') drawSteps();
    else if (name === 'crossings') drawCrossings();
    else if (name === 'missing') drawMissing();
    else if (name === 'busiest') drawBusiest();
    else if (name === 'changes') drawChanges();
    else if (name === 'map') mapController.show();
    else graph.show(asked);
  }

  for (const tab of tabs) tab.addEventListener('click', () => showView(tab.dataset.view));

  /* A link to a node is a hash; following one opens the graph there. A link
     made before nodes had keys names a position, and still opens whatever
     sits there; a key this page does not hold is said, not guessed at. */
  const followHash = () => {
    const mapAsked = parseMapHash(location.hash);
    if (mapAsked !== null) {
      mapController.apply(mapAsked);
      if (store.get('view') === 'map') mapController.show(); else showView('map');
      return true;
    }
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
    // the left list marks it and Steps and Walk show it when next opened.
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
  window.addEventListener('hashchange', followHash);

  entrySearch.addEventListener('input', drawEntries);
  kindSelect.addEventListener('change', drawEntries);
  depthSel.addEventListener('change', drawWalk);
  capSel.addEventListener('change', drawWalk);

  document.getElementById('colophon').innerHTML =
    'Everything here was read from source, never run. A path shown as <code>/orders/:param/cancel</code> ' +
    'is the route as registered; a caller writes a real id there. Where a call could not be ' +
    'followed, it appears under <b>Not joined</b> with the reason rather than being dropped, which is the ' +
    'difference between a map and a guess.';

  /* Open on a way in that actually leaves a service rather than on an empty
     shell. Which one that is gets computed from the graph in hand: walk the
     forward edges backwards from every crossing, and take the first way in
     the walk reached. Naming a route here would only ever fit one project. */
  const reachesCrossing = (() => {
    const back = nodes.map(() => []);
    const seen = new Uint8Array(nodes.length);
    const queue = [];
    for (const e of data.edges) {
      const name = edgeTypes[e[2]];
      if (FORWARD.has(name)) back[e[1]].push(e[0]);
      if (CROSSES.has(name) && !seen[e[0]]) { seen[e[0]] = 1; queue.push(e[0]); }
    }
    for (let head = 0; head < queue.length; head += 1) {
      for (const prev of back[queue[head]]) {
        if (!seen[prev]) { seen[prev] = 1; queue.push(prev); }
      }
    }
    return seen;
  })();

  /* The first view, once every panel is in place: boot.js calls it last. */
  const start = () => {
    store.set('current', entryIx.find((i) => reachesCrossing[i]) ?? entryIx[0]);
    drawEntries();
    if (!followHash()) showView('map');
  };

  return { showView, start };
}
