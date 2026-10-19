import { CARD_BOUNDS, GLANCE, LOOK, cardOf, createFilter, createHistory, createProblems,
  faceLine, labelParts, middle, peekOf, trace, zoomLevel } from '../graph.js';
import { pressed, wordFor } from '../frame.js';

/* The Graph tab's drawing: its state, the camera, the boxes, lines, lanes,
   groups and chips, the hover card, semantic zoom and the minimap. What is
   drawn comes from graph.js; this draws it. */
export function createGraphDraw(page) {
  const { FL, GLYPH, LB, LN, MT, RP, TY, confidences, data, edgeTypes, esc, files, hueOf, model, nodes,
    plural, repoName, repos, store, types } = page;
  const shown = store.get('shown');

  /* ── the graph ───────────────────────────────────────────────────── */

  /* What is drawn comes from graph.js: the model, the neighbourhood, the
     layout, the keys, the history. What follows, here and in the Graph tab's
     other panels (details, checking, graph-ui, frame-ui), is the page's half -
     the drawing, the details panel, the camera and the controls - each a small
     function of the state below, which is the only thing that changes. */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };

  /* The drawing's own units. A column is a hop; a row is a node. */
  const BOX = { w: 216, h: 40, column: 284, row: 54, pad: 40, head: 22, laneGap: 14, laneHead: 22 };
  /* How wide one character of a node's name is drawn: the mono face at the
     label's 12px (P102: no name under 12px at zoom 1). */
  const LABEL_CHAR = 7.3;
  /* With Types on, a node is a line taller and the rows open up to match. */
  const BOX_HEIGHTS = { plain: { h: 40, row: 54 }, typed: { h: 54, row: 68 } };
  /* Nodes that have a face to show when one was recorded: the rest say nothing. */
  const SHAPED = new Set([
    'method', 'function', 'ui_component', 'entry', 'ui_action', 'http_out', 'ui_api_call', 'producer', 'channel',
  ]);
  const PILL = new Set(['table', 'channel', 'external_api', 'config_key']);
  const DOORS = new Set(['entry', 'ui_action']);
  const GROUP_LIMIT = 12;
  const FILE_LIMIT = 6;
  const typeOf = (i) => types[nodes[i][TY]];
  const glyphOf = (i) => GLYPH[typeOf(i)] || typeOf(i).slice(0, 4);
  const placeOf = (i) => files[nodes[i][FL]]
    ? files[nodes[i][FL]] + (nodes[i][LN] ? ':' + nodes[i][LN] : '')
    : '';
  const enumerated = new Set(data.dicts.enumerated || []);
  /* A field naming other nodes (a directive's host members, P50) is a list of
     positions: each said by its label and jumped to from the panel. */
  const nodeRefs = new Set(data.dicts.nodeRefs || []);
  const metaOf = (i) => Object.entries(nodes[i][MT] || {}).map(([key, value]) => [
    data.dicts.meta[key] || key,
    enumerated.has(key) ? data.dicts.values[value]
      : nodeRefs.has(key) ? value.map((v) => nodes[v][LB]).join(', ')
      : Array.isArray(value) ? value.join(', ')
      : value === true ? 'yes' : value === false ? 'no' : String(value),
    nodeRefs.has(key) ? value : null,
  ]);
  const metaValueHtml = (value, refs) => refs === null
    ? esc(value)
    : refs.map((v) => `<button class="g-meta-go" data-go="${v}" title="Centre on ${esc(nodes[v][LB])}">` +
        `${esc(nodes[v][LB])}</button>`).join(' ');

  const graphView = document.getElementById('graph-view');
  const wrap = document.getElementById('g-canvas');
  const svg = document.getElementById('g-svg');
  const world = document.getElementById('g-world');
  const stage = document.getElementById('g-stage');
  const panel = document.getElementById('g-details');
  const statusEl = document.getElementById('g-status');
  const hopsSel = document.getElementById('g-hops');
  const gCapSel = document.getElementById('g-cap');
  const backBtn = document.getElementById('g-back');
  const forwardBtn = document.getElementById('g-forward');

  const state = {
    focus: null,
    hops: Number(hopsSel.value),
    cap: Number(gCapSel.value),
    // Expanded nodes draw more of the flow; nodes in `also` draw who else
    // uses them, as context.
    expanded: [],
    also: [],
    cursor: null,
    open: null,
    openGroups: new Set(),
    // Types opened in the details panel, by where they sit in it.
    openTypes: new Set(),
    // Where an "Expand all" stopped at the bounds: what it was asked from,
    // and how many types it left closed.
    typeMore: new Map(),
    // Whether each node carries a line of what it takes and gives back.
    types: false,
    hood: null,
    placed: null,
    hiddenEdgeTypes: new Set(),
    hiddenConfidences: new Set(),
    // How the drawing reads: plumbing drawn as nodes or folded into chips,
    // the nodes whose own chain is unfolded, and the groups opened.
    plumbing: false,
    unfolded: new Set(),
    opened: new Set(),
    // The question asked of the drawing, if any (`{ kind: 'path' }` or
    // `{ kind: 'impact', target, found }`), the two ends of a path, which end
    // a search is picking, and which answer the box above the drawing shows.
    query: null,
    ends: { from: null, to: null },
    picking: null,
    directed: true,
    pathDepth: 12,
    problemsOnly: false,
    answer: null,
    answerOpen: new Set(),
  };
  const trail = createHistory();

  const filterNow = () => createFilter(model, {
    services: new Set(repos.flatMap((name, i) => (shown.has(name) ? [] : [i]))),
    edgeTypes: state.hiddenEdgeTypes,
    confidences: state.hiddenConfidences,
  });

  /* ── the camera: pan and zoom over the drawing ── */

  const camera = (() => {
    let x = 0, y = 0, k = 1;
    // What else reads the camera - the zoom level, the minimap - is told
    // after every move rather than polling it.
    let watchers = [];
    const apply = () => {
      world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
      for (const watcher of watchers) watcher({ x, y, k });
    };
    const bound = (value) => Math.min(2.4, Math.max(0.2, value));
    const size = () => ({ w: wrap.clientWidth || 800, h: wrap.clientHeight || 500 });
    /* The canvas size the drawing was last placed in, so a canvas that grows
       or shrinks under it keeps what was in its middle in its middle. */
    let seen = null;
    const extent = (placed) => ({
      w: (placed.max - placed.min) * BOX.column + BOX.w + BOX.pad * 2,
      h: placed.height + BOX.pad * 2 + BOX.head,
    });
    const zoomAt = (px, py, factor) => {
      const next = bound(k * factor);
      x = px - ((px - x) * next) / k;
      y = py - ((py - y) * next) / k;
      k = next;
      apply();
    };
    return {
      zoomAt,
      watch(watcher) { watchers = [...watchers, watcher]; },
      view: () => ({ x, y, k, ...size() }),
      /* Puts a point of the drawing in the middle of the screen. */
      lookAt(wx, wy) {
        const screen = size();
        x = screen.w / 2 - wx * k;
        y = screen.h / 2 - wy * k;
        apply();
      },
      zoom(factor) { const { w, h } = size(); zoomAt(w / 2, h / 2, factor); },
      pan(dx, dy) { x += dx; y += dy; apply(); },
      /* The whole drawing when it fits at a readable size; otherwise the
         focus, readable, with the rest a drag away. `whole` always fits. */
      frame(placed, focusAt, whole) {
        const screen = size();
        seen = screen;
        const all = extent(placed);
        const fits = Math.min(1, screen.w / all.w, screen.h / all.h);
        if (whole || fits >= 0.8) {
          k = bound(fits);
          x = (screen.w - all.w * k) / 2;
          y = (screen.h - all.h * k) / 2;
        } else {
          k = 0.9;
          x = screen.w / 2 - (focusAt.x + BOX.w / 2) * k;
          y = screen.h / 2 - (focusAt.y + BOX.h / 2) * k;
        }
        apply();
      },
      /* Full screen, a wider or folded panel: the canvas changed size. */
      resized() {
        const now = size();
        if (seen !== null && (now.w !== seen.w || now.h !== seen.h)) {
          x += (now.w - seen.w) / 2;
          y += (now.h - seen.h) / 2;
          apply();
        }
        seen = now;
      },
      /* Brings a box into view when a key has moved off the edge. */
      reveal(box) {
        const screen = size();
        const left = x + box.x * k, top = y + box.y * k;
        const right = left + BOX.w * k, bottom = top + BOX.h * k;
        if (left < 12) x += 12 - left;
        else if (right > screen.w - 12) x -= right - (screen.w - 12);
        if (top < 12) y += 12 - top;
        else if (bottom > screen.h - 12) y -= bottom - (screen.h - 12);
        apply();
      },
    };
  })();

  /* ── the drawing ── */

  const at = (v) => {
    const p = state.placed.pos.get(v);
    return { x: p.x + BOX.pad, y: p.y + BOX.pad + BOX.head };
  };

  const columnName = (layer) => layer === 0 ? 'focus'
    : layer < 0 ? 'upstream ' + -layer : 'downstream ' + layer;

  const curve = (from, to) => {
    const y1 = from.y + BOX.h / 2, y2 = to.y + BOX.h / 2;
    if (from.x === to.x) {
      // Same column: out of the right side and back into it.
      const x = from.x + BOX.w, bend = 46;
      return { d: `M${x} ${y1} C${x + bend} ${y1} ${x + bend} ${y2} ${x} ${y2}`, mid: [x + bend * 0.75, (y1 + y2) / 2] };
    }
    if (to.x > from.x) {
      const x1 = from.x + BOX.w, x2 = to.x, c = (x2 - x1) / 2;
      return { d: `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
    }
    // Pointing back toward the focus: left side out, right side in.
    const x1 = from.x, x2 = to.x + BOX.w, c = Math.max(50, (x1 - x2) / 2);
    return { d: `M${x1} ${y1} C${x1 - c} ${y1} ${x2 + c} ${y2} ${x2} ${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
  };

  /* A unit is a node position, or a group's id when the drawing grouped a
     busy side; an element names one or the other. */
  const isGroup = (u) => typeof u === 'string';
  const unitOf = (el) => (el.dataset.group !== undefined ? el.dataset.group : Number(el.dataset.node));
  const repoOfUnit = (u) => (isGroup(u) ? state.hood.groups.get(u).repo : nodes[u][RP]);
  const laneHue = (repo) => (repo >= 0 ? hueOf(repo) : 'var(--faint)');
  const laneName = (repo) => (repo >= 0 ? repos[repo] : 'several services');

  /* What expanding a node draws, and who else uses it, in words: by which
     way it looks from the focus (graph.js's LOOK), so the page never decides
     a direction of its own. */
  const LOOK_SAYS = {
    both: { expand: 'Expand neighbours', more: 'neighbours' },
    out: { expand: 'Expand: what it reaches', more: 'that it reaches' },
    in: { expand: 'Expand: what reaches it', more: 'that reach it' },
  };
  const ALSO_SAYS = {
    in: {
      ask: 'Who else uses this',
      count: (n) => plural(n, 'other caller', 'other callers'),
      badge: (n) => 'used by ' + plural(n, 'other', 'others'),
      mark: (of, n = 1) => (n === 1 ? 'also uses ' : 'also use ') + labelParts(model, of).name,
    },
    out: {
      ask: 'What else it uses',
      count: (n) => plural(n, 'other callee', 'other callees'),
      badge: (n) => 'uses ' + plural(n, 'other', 'others'),
      mark: (of) => 'also used by ' + labelParts(model, of).name,
    },
  };
  const lookOf = (v) => LOOK[state.hood.side.get(v) ?? 0];
  const contextOf = (u) => state.hood.context.get(u);
  /* An edge, or a bundle, with context at either end is context too. */
  const isContextLink = (from, to) => state.hood.context.has(from) || state.hood.context.has(to);

  /* Problem badges: the rows on a node, from graph.js's `createProblems`.

     badgesFor(node) takes a node position and returns what to pin on it,
     worst first, as [{ count, tone, title, label, kind }]:
       count  a number, drawn unless `label` is given
       tone   'bad' | 'warn' | 'info' (default 'info')
       title  what hovering it says (optional)
       label  short text drawn instead of the count (optional)
       kind   which problem it is: `rows` name the node, `line` sit at its line
     The drawing draws whatever comes back, on the node's top edge; a group
     shows its members' badges summed per tone; the details panel says each
     in words. An empty list draws nothing. */
  const problems = createProblems(model);
  const BADGE = {
    rows: { tone: 'bad', say: (n) => plural(n, 'row names it', 'rows name it') },
    line: { tone: 'warn', say: (n) => plural(n, 'row at its line', 'rows at its line') },
  };
  const badgesFor = (v) => problems.badgesFor(v).map((badge) => ({
    kind: badge.kind,
    count: badge.count,
    tone: (BADGE[badge.kind] || { tone: 'info' }).tone,
    title: badge.title,
  }));

  /* How a group says a count of one type: `56 queries`, `3 ways in`. */
  const NOUNS = {
    db_query: 'queries', method: 'methods', function: 'functions', entry: 'ways in',
    ui_api_call: 'requests', ui_action: 'actions', producer: 'publishers', consumer: 'handlers',
    http_out: 'calls out', provider: 'providers', ui_component: 'components', cache_op: 'cache calls',
    guard: 'guards', interceptor: 'interceptors', pipe: 'pipes', middleware: 'middleware',
    table: 'tables', channel: 'channels', config_key: 'settings', external_api: 'outside APIs',
    module: 'modules',
  };
  const nounOf = (typeName, n) => (n === 1 ? typeName.replace('_', ' ') : NOUNS[typeName] || typeName + 's');

  /* `2 guards · 3 interceptors · 1 pipe`, or shorter when that will not fit. */
  const chipText = (chip) => {
    const full = chip.layers.map(([layer, n]) => n + ' ' + nounOf(layer, n)).join(' · ');
    return full.length * 5.1 <= BOX.w - 24 ? full : plural(chip.total, 'wrapper', 'wrappers');
  };

  /* How many characters of a face fit in a width. */
  const fits = (px, perChar) => Math.max(4, Math.floor(px / perChar));

  /* An edge in words: its verb, and its trust only when it is not static. */
  const edgeName = (k) => {
    const conf = confidences[data.edges[k][3]];
    return wordFor('edge', edgeTypes[data.edges[k][2]]) + (conf === 'static' ? '' : ' · ' + wordFor('trust', conf));
  };

  const drawEdge = (k) => {
    const e = data.edges[k];
    const conf = confidences[e[3]];
    const cross = nodes[e[0]][RP] !== nodes[e[1]][RP];
    const g = svgEl('g', {
      class: `g-link is-${conf}` + (cross ? ' is-cross' : '') + (isContextLink(e[0], e[1]) ? ' is-context' : ''),
      'data-from': e[0],
      'data-to': e[1],
    });
    g.style.setProperty('--hue', hueOf(nodes[e[1]][RP]));
    const path = curve(at(e[0]), at(e[1]));
    g.append(
      svgEl('title', {}, `${nodes[e[0]][LB]} → ${nodes[e[1]][LB]}\n${edgeName(k)} (${edgeTypes[e[2]]}, ${conf})`),
      svgEl('path', { class: 'g-hit', d: path.d }),
      svgEl('path', { class: 'g-edge', d: path.d, 'marker-end': 'url(#g-arrow)' }),
      // Said on the line only on hover and around the open node, so a busy
      // drawing is lines, not words.
      svgEl('text', { class: 'g-tip', x: path.mid[0], y: path.mid[1] - 4 }, edgeName(k)),
    );
    return g;
  };

  /* Every edge between two units where one is a group, as one line as thick
     as the count. */
  const drawBundle = (bundle) => {
    const first = data.edges[bundle.edges[0]];
    const n = bundle.edges.length;
    const conf = confidences[first[3]];
    const to = repoOfUnit(bundle.to);
    const g = svgEl('g', {
      class: `g-link is-bundle is-${conf}` + (repoOfUnit(bundle.from) !== to ? ' is-cross' : '') +
        (isContextLink(bundle.from, bundle.to) ? ' is-context' : ''),
      'data-from': bundle.from,
      'data-to': bundle.to,
    });
    g.style.setProperty('--hue', laneHue(to));
    const path = curve(at(bundle.from), at(bundle.to));
    const label = n.toLocaleString() + ' × ' + wordFor('edge', edgeTypes[first[2]]);
    g.append(
      svgEl('title', {}, label),
      svgEl('path', { class: 'g-hit', d: path.d }),
      svgEl('path', {
        class: 'g-edge',
        d: path.d,
        'marker-end': 'url(#g-arrow)',
        'stroke-width': Math.min(5, 1.25 + Math.log2(n) * 0.6).toFixed(2),
      }),
      svgEl('text', { class: 'g-tip', x: path.mid[0], y: path.mid[1] - 4 }, label),
    );
    return g;
  };

  /* One band per service, the service's name in its corner. */
  const laneBox = (lane) => ({
    y: lane.y + BOX.pad + BOX.head - 6,
    h: lane.height - (BOX.row - BOX.h) + 14,
  });
  const drawLanes = (placed, width) => {
    const g = svgEl('g', { class: 'g-lanes' });
    for (const lane of placed.lanes) {
      const box = laneBox(lane);
      const band = svgEl('g', { class: 'g-lane' });
      band.style.setProperty('--hue', laneHue(lane.repo));
      band.append(
        svgEl('rect', { x: 0, y: box.y, width, height: box.h }),
        svgEl('line', { x1: 0, x2: width, y1: box.y, y2: box.y }),
        svgEl('text', { x: 12, y: box.y + 16 }, laneName(lane.repo)),
      );
      g.append(band);
    }
    return g;
  };

  /* Badges on a node's top edge, from the left: the hook decides what. */
  const drawBadges = (g, badges) => {
    let x = 8;
    for (const badge of badges) {
      const text = badge.label !== undefined ? String(badge.label) : Number(badge.count).toLocaleString();
      const w = text.length * 6 + 10;
      const pin = svgEl('g', { class: 'g-badge is-' + (badge.tone || 'info'), transform: `translate(${x} -8)` });
      if (badge.title) pin.append(svgEl('title', {}, badge.title));
      pin.append(svgEl('rect', { width: w, height: 15, rx: 7.5 }), svgEl('text', { x: 5, y: 11 }, text));
      g.append(pin);
      x += w + 4;
    }
  };

  const drawNode = (v) => {
    const t = typeOf(v);
    const p = at(v);
    const more = state.hood.more.get(v) || 0;
    const others = state.hood.others.get(v);
    const context = contextOf(v);
    const label = nodes[v][LB];
    const pill = PILL.has(t);
    const g = svgEl('g', {
      class: 'g-node' + (pill ? ' is-pill' : '') + (v === state.focus ? ' is-focus' : '') +
        (context ? ' is-context' : ''),
      transform: `translate(${p.x} ${p.y})`,
      tabindex: -1,
      role: 'button',
      'data-node': v,
      'aria-label': `${label}, ${t}, ${repoName(v)}` +
        (context ? `, not in the flow: ${ALSO_SAYS[context.look].mark(context.of)}` : '') +
        (more ? `, ${more} more not drawn` : '') +
        (others ? `, ${ALSO_SAYS[others.look].count(others.count)}` : '') +
        (state.hood.chips.has(v) ? `, ${state.hood.chips.get(v).total} wrappers folded` : ''),
    });
    g.style.setProperty('--hue', hueOf(nodes[v][RP]));
    // The full name, whose it is, where, and its types are the hover card's
    // (nodeCardHtml): the drawing shortens. Context says what it is to the
    // flow where its owner would be.
    const parts = labelParts(model, v);
    const sub = context ? ALSO_SAYS[context.look].mark(context.of) : parts.owner;
    const shape = faceLine(model, v);
    g.append(svgEl('rect', { class: 'g-box', width: BOX.w, height: BOX.h, rx: pill ? BOX.h / 2 : 3 }));
    if (!pill) g.append(svgEl('rect', { class: 'g-rule', width: DOORS.has(t) ? 5 : 3, height: BOX.h, rx: 1 }));
    const glyph = glyphOf(v);
    const gx = pill ? 15 : 11;
    const gw = glyph.length * 5.8 + 8;
    const right = pill ? 16 : 8;
    g.append(
      svgEl('rect', { class: 'g-glyph', x: gx, y: 7, width: gw, height: 13, rx: 2 }),
      svgEl('text', { class: 'g-glyph-text', x: gx + 4, y: 16.5 }, glyph),
      svgEl('text', { class: 'g-label', x: gx + gw + 6, y: 18 },
        middle(parts.name, fits(BOX.w - gx - gw - 6 - right, LABEL_CHAR))),
      svgEl('text', { class: 'g-sub', x: gx, y: 33 }, middle(sub, fits(BOX.w - gx - right, 5.7))),
    );
    // The Types toggle's third line: the whole face, cut in the middle so
    // both the first parameter and what comes back survive.
    if (state.types && (shape || SHAPED.has(t))) {
      g.append(svgEl('text', { class: 'g-sig' + (shape ? '' : ' is-none'), x: gx, y: 47 },
        shape ? middle(shape, fits(BOX.w - gx - right, 5.75)) : 'types not recorded'));
    }
    const chip = state.hood.chips.get(v);
    if (chip !== undefined) {
      const text = chipText(chip);
      const w = text.length * 5.1 + 12;
      const tag = svgEl('g', {
        class: 'g-chip' + (chip.open ? ' is-open' : ''),
        'data-chip': v,
        role: 'button',
        'aria-label': (chip.open ? 'Fold ' : 'Draw ') + chip.layers.map(([layer, n]) => n + ' ' + nounOf(layer, n)).join(', '),
        transform: `translate(${BOX.w - w - 8} ${BOX.h - 4})`,
      });
      tag.append(
        svgEl('title', {}, chip.open
          ? 'Drawn beside it. Click, or press W, to fold them back.'
          : 'What runs in front of it, folded. Click, or press W, to draw them.'),
        svgEl('rect', { width: w, height: 14, rx: 7 }),
        svgEl('text', { x: 6, y: 10 }, text),
      );
      g.append(tag);
    }
    drawBadges(g, badgesFor(v));
    // From the right edge in: +N, more of the flow, then who else uses it.
    let edge = BOX.w + 6;
    if (more > 0) {
      const text = '+' + more.toLocaleString();
      const w = text.length * 6.2 + 10;
      edge -= w;
      const badge = svgEl('g', {
        class: 'g-more',
        'data-more': v,
        role: 'button',
        'aria-label': `Expand ${label}: ${more} more not drawn`,
        transform: `translate(${edge} -8)`,
      });
      badge.append(
        svgEl('title', {}, `${more} ${LOOK_SAYS[lookOf(v).flow].more}, not drawn. Click, or press +, to expand.`),
        svgEl('rect', { width: w, height: 15, rx: 7.5 }),
        svgEl('text', { x: 5, y: 11 }, text),
      );
      g.append(badge);
    }
    if (others) {
      const says = ALSO_SAYS[others.look];
      const text = says.badge(others.count);
      const w = text.length * 5.1 + 12;
      edge -= w + 4;
      const badge = svgEl('g', {
        class: 'g-also' + (others.shown ? ' is-shown' : ''),
        'data-also': v,
        role: 'button',
        'aria-label': `${others.shown ? 'Hide' : 'Show'} ${says.ask.toLowerCase()}: ${says.count(others.count)}, not in the flow`,
        transform: `translate(${edge} -8)`,
      });
      badge.append(
        svgEl('title', {}, `${says.count(others.count)}, not in the flow. ` +
          `Click, or press O, to ${others.shown ? 'hide them' : 'draw them as context'}.`),
        svgEl('rect', { width: w, height: 15, rx: 7.5 }),
        svgEl('text', { x: 6, y: 11 }, text),
      );
      g.append(badge);
    }
    return g;
  };

  /* A group: a small stack of sheets, whose they are, and how many. */
  const drawGroup = (id) => {
    const group = state.hood.groups.get(id);
    const p = at(id);
    const count = group.members.length;
    const typeName = types[group.type];
    const noun = nounOf(typeName, count);
    const what = group.next === 'service' ? 'services' : 'classes';
    const name = group.level === 'class' ? group.owner
      : group.level === 'service' ? laneName(group.repo)
      : `${group.parts.toLocaleString()} more ${what}`;
    const context = contextOf(id);
    const sub = (group.level === 'service' ? `${noun} in ${group.parts} classes` : noun) +
      (context ? ' · ' + ALSO_SAYS[context.look].mark(context.of, count) : '');
    const g = svgEl('g', {
      class: 'g-node is-group' + (context ? ' is-context' : ''),
      transform: `translate(${p.x} ${p.y})`,
      tabindex: -1,
      role: 'button',
      'data-group': id,
      'aria-label': `${count} ${noun}, ${name}, ${laneName(group.repo)}. Open the group.`,
    });
    g.style.setProperty('--hue', laneHue(group.repo));
    g.append(
      svgEl('title', {}, `${count.toLocaleString()} ${noun}` + (group.owner ? ` of ${group.owner}` : '') +
        ` in ${laneName(group.repo)}` +
        (group.behind > 0 ? `\n${group.behind.toLocaleString()} more past them within the hops, drawn once it is open` : '') +
        (context ? '\nNot in the flow: ' + ALSO_SAYS[context.look].mark(context.of, count) : '') +
        '\nClick, or press Enter, to open it.'),
      svgEl('rect', { class: 'g-sheet', x: 6, y: -6, width: BOX.w, height: BOX.h, rx: 3 }),
      svgEl('rect', { class: 'g-sheet', x: 3, y: -3, width: BOX.w, height: BOX.h, rx: 3 }),
      svgEl('rect', { class: 'g-box', width: BOX.w, height: BOX.h, rx: 3 }),
      svgEl('rect', { class: 'g-rule', width: 3, height: BOX.h, rx: 1 }),
    );
    const glyph = GLYPH[typeName] || typeName.slice(0, 4);
    const gw = glyph.length * 5.8 + 8;
    const digits = count.toLocaleString();
    const room = BOX.w - 11 - gw - 6 - digits.length * 9.5 - 14;
    g.append(
      svgEl('rect', { class: 'g-glyph', x: 11, y: 7, width: gw, height: 13, rx: 2 }),
      svgEl('text', { class: 'g-glyph-text', x: 15, y: 16.5 }, glyph),
      svgEl('text', { class: 'g-label', x: 11 + gw + 6, y: 18 }, middle(name, fits(room, LABEL_CHAR))),
      svgEl('text', { class: 'g-sub', x: 11, y: 33 }, middle(sub, fits(BOX.w - 19 - digits.length * 9.5, 5.7))),
      svgEl('text', { class: 'g-count', x: BOX.w - 10, y: 27 }, digits),
    );
    // A group carries its members' badges, summed per tone.
    const tones = new Map();
    for (const v of group.members) {
      for (const badge of badgesFor(v)) {
        const tone = badge.tone || 'info';
        tones.set(tone, (tones.get(tone) || 0) + (Number(badge.count) || 0));
      }
    }
    drawBadges(g, ['bad', 'warn', 'info'].filter((tone) => tones.get(tone) > 0)
      .map((tone) => ({ count: tones.get(tone), tone, title: `${tones.get(tone)} across the group` })));
    return g;
  };

  /* Selection and the keyboard cursor change classes, never the drawing: a
     redraw under a double click would leave the second click nowhere. */
  const paintSelection = (moveFocus) => {
    for (const el of world.querySelectorAll('.g-node')) {
      const v = unitOf(el);
      el.classList.toggle('is-open', v === state.open);
      el.setAttribute('tabindex', v === state.cursor ? '0' : '-1');
      if (moveFocus && v === state.cursor) el.focus({ preventScroll: true });
    }
    const open = String(state.open);
    for (const el of world.querySelectorAll('.g-link')) {
      el.classList.toggle('is-lit', state.open !== null && (el.dataset.from === open || el.dataset.to === open));
    }
  };

  /* Hovering, or moving the keys onto, a unit lights the way the walk took
     from the focus to it, and quiets everything else. */
  const traceTo = (unit) => {
    const path = unit === null || state.hood === null ? [] : trace(state.hood, unit);
    const on = new Set(path.map(String));
    const steps = new Set();
    for (let i = 1; i < path.length; i += 1) {
      steps.add(path[i - 1] + '|' + path[i]);
      steps.add(path[i] + '|' + path[i - 1]);
    }
    world.classList.toggle('is-tracing', path.length > 1);
    for (const el of world.querySelectorAll('.g-node')) el.classList.toggle('is-on', on.has(String(unitOf(el))));
    for (const el of world.querySelectorAll('.g-link')) {
      el.classList.toggle('is-on', steps.has(el.dataset.from + '|' + el.dataset.to));
    }
  };

  /* ── the hover card: a node's types, or one type's fields ── */

  /* One floating card, shown after a pause on whatever it describes and
     moved, not hidden, while the pointer goes from one thing to the next.
     It describes what it is anchored to (aria-describedby), so the keys
     read it too; touch never shows it, since a tap already opens details.
     The pointer can cross onto it and stay: leaving what it describes only
     hides it after a pause, and being on it holds it. */
  const card = (() => {
    const el = document.createElement('div');
    el.className = 'g-card';
    el.id = 'g-card';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.append(el);
    const DELAY = { first: 250, next: 60, leave: 120 };
    const GAP = 10;
    const EDGE = 8;
    let timer = 0;
    let key = null;
    let anchor = null;
    let side = 'side';
    let build = null;

    const clear = () => { clearTimeout(timer); timer = 0; };
    const hide = () => {
      clear();
      if (anchor !== null) anchor.removeAttribute('aria-describedby');
      anchor = null;
      key = null;
      el.hidden = true;
    };
    /* Beside the anchor - to its right, or below it - and flipped or held
       inside the window when there is no room that way. */
    const place = (box, side) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let x, y;
      if (side === 'below') {
        x = box.left;
        y = box.bottom + 6 + h <= vh - EDGE ? box.bottom + 6 : box.top - 6 - h;
      } else {
        x = box.right + GAP + w <= vw - EDGE ? box.right + GAP : box.left - GAP - w;
        y = box.top;
      }
      el.style.left = Math.round(Math.max(EDGE, Math.min(x, vw - EDGE - w))) + 'px';
      el.style.top = Math.round(Math.max(EDGE, Math.min(y, vh - EDGE - h))) + 'px';
    };
    const show = (target, asked, make, where) => {
      clear();
      if (anchor !== null && anchor !== target) anchor.removeAttribute('aria-describedby');
      el.innerHTML = make();
      el.hidden = false;
      el.scrollTop = 0;
      place(target.getBoundingClientRect(), where);
      target.setAttribute('aria-describedby', el.id);
      anchor = target;
      key = asked;
      side = where;
      build = make;
    };
    const soon = () => {
      clear();
      if (!el.hidden) timer = setTimeout(hide, DELAY.leave);
    };
    document.addEventListener('keydown', (event) => { if (pressed('close', event)) hide(); });
    // Scrolling the card itself is reading it; any other scroll moves what it points at.
    window.addEventListener('scroll', (event) => { if (!el.contains(event.target)) hide(); }, true);
    window.addEventListener('resize', hide);
    el.addEventListener('pointerenter', clear);
    el.addEventListener('pointerleave', soon);
    // A press on one of its buttons keeps the keyboard where it was, so the
    // node it describes does not lose focus and take the card with it.
    el.addEventListener('mousedown', (event) => { if (event.target.closest('button')) event.preventDefault(); });
    return {
      el,
      /* After a pause: a long one onto the first thing, a short one between. */
      later(target, asked, make, where) {
        if (asked === key) { clear(); return; }
        clear();
        timer = setTimeout(() => show(target, asked, make, where), el.hidden ? DELAY.first : DELAY.next);
      },
      now: (target, asked, make, where) => show(target, asked, make, where),
      /* Off what it describes onto nothing: gone unless something else is hovered first. */
      soon,
      hide,
      /* What it shows, or null. */
      showing: () => (el.hidden ? null : key),
      /* The keys or the pointer are on it: focus leaving what it describes
         for the card, or text on it being selected, is not leaving. */
      holds: (node) => !el.hidden && ((node !== null && el.contains(node)) || el.matches(':hover')),
      /* Drawn again where it is, after what it shows grew: it keeps its
         corner, under the pointer that asked, and only moves up as far as
         the window needs. Placed afresh, a taller card flips away from its
         anchor and out from under the pointer, which then leaves it. */
      refresh() {
        if (el.hidden || build === null) return;
        const top = el.scrollTop;
        el.innerHTML = build();
        const y = Math.min(parseFloat(el.style.top) || EDGE, window.innerHeight - EDGE - el.offsetHeight);
        el.style.top = Math.round(Math.max(EDGE, y)) + 'px';
        el.scrollTop = top;
      },
    };
  })();

  const cardRowsHtml = (rows) => rows.map((row) =>
    `<div class="g-card-row"><span>${esc(row.name)}</span><span>${esc(row.text)}</span></div>`).join('');

  /* What a card was asked to show past its glance, for the one thing it is
     on; a card on anything else starts from a glance again. */
  let wideNow = { asked: null, ...GLANCE };
  const wideFor = (asked) => {
    if (wideNow.asked !== asked) wideNow = { asked, ...GLANCE };
    return wideNow;
  };
  /* The types the last node card showed, which a click on its node opens. */
  let cardSeen = { v: -1, types: [] };

  /* "+N more — show" where the card may grow, a plain count where its
     ceiling is what cut it. */
  const showHtml = (can, attr, text) => (can
    ? `<button class="g-card-show" ${attr}>${text} &mdash; show</button>`
    : `<div class="g-card-note">${text}</div>`);

  /* What kind of type a peek, or the details, says it is. */
  const TYPE_KIND_SAYS = { object: 'object', enum: 'enum', union: 'union', generic: 'generic', external: 'external' };

  /* `open`: its name opens it in the details; `show`: what it cut can be shown. */
  const peekHtml = (peek, { open = false, show = true } = {}) =>
    `<div class="g-card-peek"><div class="g-card-type">` +
    (open
      ? `<button data-card-open="${peek.type}" title="Open it in the details">${esc(peek.name)}</button>`
      : esc(peek.name)) +
    ` <span>${esc(TYPE_KIND_SAYS[peek.kind] || peek.kind)} &middot; ${esc(peek.from)}</span></div>` +
    cardRowsHtml(peek.rows) +
    (peek.more > 0 ? showHtml(show, `data-card-rows="${peek.type}"`, '+' + plural(peek.more, 'more', 'more')) : '') +
    (peek.note ? `<div class="g-card-note">${esc(peek.note)}</div>` : '') +
    '</div>';

  /* A node's card: its full name, whose and where, what it is to the flow
     when it is context, and what it takes and gives back with a peek at
     each type that names. What it cut can be shown on it, up to its
     ceiling; its name, and each type's, go on to the details. */
  const nodeCardHtml = (v) => {
    const parts = labelParts(model, v);
    const context = contextOf(v);
    const found = cardOf(model, v, CARD_BOUNDS, wideFor('node:' + v));
    cardSeen = { v, types: found === null ? [] : found.peeks.map((peek) => peek.type) };
    const head = `<button class="g-card-title" data-card-node title="Open it in the details">${esc(nodes[v][LB])}</button>` +
      `<div class="g-card-sub">${esc([parts.owner, repoName(v), placeOf(v)].filter(Boolean).join(' · '))}</div>` +
      (context
        ? `<div class="g-card-note">Not in the flow: ${esc(ALSO_SAYS[context.look].mark(context.of))}. ` +
          'Double-click to centre on it.</div>'
        : '');
    if (found === null) {
      return head + (SHAPED.has(typeOf(v)) ? '<div class="g-card-note">Types not recorded.</div>' : '');
    }
    const show = !found.capped;
    return head +
      `<pre class="g-card-face">${esc(found.lines.join('\n'))}` +
        (found.more > 0
          ? '\n' + (show
            ? `<button class="g-card-show" data-card-lines>… ${plural(found.more, 'more line', 'more lines')} &mdash; show</button>`
            : `… ${plural(found.more, 'more line', 'more lines')}`)
          : '') + '</pre>' +
      found.peeks.map((peek) => peekHtml(peek, { open: true, show })).join('') +
      (found.left > 0 ? showHtml(show, 'data-card-types', plural(found.left, 'more type', 'more types')) : '') +
      (found.capped
        ? `<div class="g-card-note">A card holds ${CARD_BOUNDS.most} rows; the rest is in the details.</div>`
        : '') +
      '<div class="g-card-note">Click the node for everything &middot; E in the panel opens all</div>';
  };

  /* A type's card, from the panel: one level of it, without opening it, and
     every row of it when asked, up to a card's ceiling. */
  const typeCardHtml = (t, asked) => {
    const all = wideFor(asked).rows.includes(t);
    const peek = peekOf(model, t, all ? { ...CARD_BOUNDS, rows: CARD_BOUNDS.most - 1 } : CARD_BOUNDS);
    return peek === null
      ? ''
      : peekHtml(peek, { show: !all }) +
        '<div class="g-card-note">Click to open it here &middot; E opens everything under it</div>';
  };

  /* Only what a person can point at: not a touch, and not the badges on a
     node, which say what a click on them does. */
  const NODE_PARTS = '.g-more, .g-also, .g-chip';
  const cardNode = (event) => {
    const node = event.target.closest('.g-node');
    return node && node.dataset.node !== undefined && !event.target.closest(NODE_PARTS) ? node : null;
  };
  const visibleFocus = (el) => {
    try { return el.matches(':focus-visible'); } catch { return true; }
  };

  /* ── semantic zoom and the minimap: both follow the camera ── */

  const extentOf = (placed) => ({
    w: (placed.max - placed.min) * BOX.column + BOX.w + BOX.pad * 2,
    h: placed.height + BOX.pad * 2 + BOX.head,
  });

  let zoomNow = null;
  const paintZoom = (k) => {
    const level = zoomLevel(k);
    if (level !== zoomNow) {
      if (zoomNow !== null) svg.classList.remove('z-' + zoomNow);
      svg.classList.add('z-' + level);
      zoomNow = level;
    }
    // A lane keeps its name readable however far out, like a region on a map.
    svg.style.setProperty('--lane-size', Math.min(30, Math.max(12.5, 12.5 / k)).toFixed(1) + 'px');
  };

  /* A lane's name stays at the left edge of the screen while its band is on
     it, so the service is named wherever the camera is. */
  const pinLaneNames = ({ x, k }) => {
    const left = Math.max(12, (12 - x) / k);
    for (const name of world.querySelectorAll('.g-lane text')) name.setAttribute('x', left.toFixed(1));
  };

  const mini = document.createElement('div');
  mini.className = 'g-mini';
  mini.dataset.export = 'skip';
  mini.hidden = true;
  mini.title = 'The whole drawing. Click or drag to move there.';
  const miniSvg = svgEl('svg', { 'aria-hidden': 'true' });
  mini.append(miniSvg);
  wrap.append(mini);
  let miniView = null;

  const paintMinimap = () => {
    if (state.placed === null || miniView === null) return;
    const { x, y, k, w, h } = camera.view();
    const all = extentOf(state.placed);
    const view = { x: -x / k, y: -y / k, w: w / k, h: h / k };
    // Nothing to find when all of it is on screen.
    mini.hidden = view.x <= 0 && view.y <= 0 && view.x + view.w >= all.w && view.y + view.h >= all.h;
    miniView.setAttribute('x', view.x.toFixed(1));
    miniView.setAttribute('y', view.y.toFixed(1));
    miniView.setAttribute('width', view.w.toFixed(1));
    miniView.setAttribute('height', view.h.toFixed(1));
  };

  /* The minimap is a corner, never a column: it fits a small box whatever
     the drawing's shape. Sized by its width alone, an opened group of fifty
     made it taller than the canvas, over the column of callers on the left,
     and the first click on a group there moved the view instead. */
  const MINI = { w: 168, h: 120, narrow: { w: 108, h: 84 } };
  const sizeMinimap = (all) => {
    const most = wrap.clientWidth < 520 ? MINI.narrow : MINI;
    const scale = Math.min(most.w / all.w, Math.min(most.h, wrap.clientHeight * 0.3) / all.h);
    mini.style.width = Math.max(28, Math.round(all.w * scale)) + 'px';
    miniSvg.style.height = Math.max(20, Math.round(all.h * scale)) + 'px';
  };

  const drawMinimap = () => {
    const { hood, placed } = state;
    const all = extentOf(placed);
    miniSvg.setAttribute('viewBox', `0 0 ${all.w} ${all.h}`);
    miniSvg.setAttribute('preserveAspectRatio', 'none');
    sizeMinimap(all);
    const parts = [];
    for (const lane of placed.lanes) {
      const box = laneBox(lane);
      const band = svgEl('rect', { class: 'm-lane', x: 0, y: box.y, width: all.w, height: box.h });
      band.style.setProperty('--hue', laneHue(lane.repo));
      parts.push(band);
    }
    for (const v of hood.nodes) {
      const p = at(v);
      const unit = svgEl('rect', { class: v === hood.focus ? 'm-focus' : 'm-unit', x: p.x, y: p.y, width: BOX.w, height: BOX.h, rx: 4 });
      unit.style.setProperty('--hue', laneHue(repoOfUnit(v)));
      parts.push(unit);
    }
    miniView = svgEl('rect', { class: 'm-view' });
    parts.push(miniView);
    miniSvg.replaceChildren(...parts);
    paintMinimap();
  };

  camera.watch((view) => {
    paintZoom(view.k);
    pinLaneNames(view);
    paintMinimap();
  });

  const miniTo = (event) => {
    const box = miniSvg.getBoundingClientRect();
    const all = extentOf(state.placed);
    camera.lookAt(((event.clientX - box.left) / box.width) * all.w, ((event.clientY - box.top) / box.height) * all.h);
  };
  let miniDrag = null;
  mini.addEventListener('pointerdown', (event) => {
    // The canvas under it pans on a drag; here a drag moves the view.
    event.stopPropagation();
    miniDrag = event.pointerId;
    mini.setPointerCapture(event.pointerId);
    miniTo(event);
  });
  mini.addEventListener('pointermove', (event) => { if (miniDrag === event.pointerId) miniTo(event); });
  mini.addEventListener('pointerup', () => { miniDrag = null; });
  mini.addEventListener('pointercancel', () => { miniDrag = null; });

  const drawDrawing = () => {
    card.hide();
    const hadFocus = svg.contains(document.activeElement);
    const { hood, placed } = state;
    const heads = svgEl('g');
    for (let layer = placed.min; layer <= placed.max; layer += 1) {
      heads.append(svgEl('text', {
        class: 'g-col',
        x: (layer - placed.min) * BOX.column + BOX.pad + BOX.w / 2,
        y: BOX.pad + 4,
      }, columnName(layer)));
    }
    const links = svgEl('g');
    for (const k of hood.edges) links.append(drawEdge(k));
    for (const bundle of hood.bundles) links.append(drawBundle(bundle));
    const boxes = svgEl('g');
    for (const v of hood.nodes) boxes.append(isGroup(v) ? drawGroup(v) : drawNode(v));
    world.replaceChildren(drawLanes(placed, extentOf(placed).w), heads, links, boxes);
    world.classList.remove('is-tracing');
    pinLaneNames(camera.view());
    svg.setAttribute('aria-label', `Neighbourhood of ${nodes[state.focus][LB]}`);
    paintSelection(hadFocus);
    drawMinimap();
  };

  const drawStatus = () => {
    if (page.drawAnswer()) return;
    const { hood } = state;
    const filter = filterNow();
    const groups = [...hood.groups.values()];
    const drawnNodes = hood.nodes.length - groups.length;
    const parts = [
      `<b>${plural(drawnNodes, 'node', 'nodes')}</b>` +
      (groups.length ? ` and <b>${plural(groups.length, 'group', 'groups')}</b>` : '') +
      ` drawn within ${plural(state.hops, 'hop', 'hops')} of <b>${esc(nodes[state.focus][LB])}</b>.`,
    ];
    if (groups.length > 0) {
      const held = groups.reduce((sum, group) => sum + group.members.length, 0);
      parts.push(`The groups hold ${plural(held, 'node', 'nodes')}` +
        (hood.behind > 0 ? `, with ${hood.behind.toLocaleString()} more past them` : '') +
        '; click one to open it.');
    }
    const context = [...hood.context.keys()]
      .reduce((sum, u) => sum + (isGroup(u) ? hood.groups.get(u).members.length : 1), 0);
    if (context > 0) {
      parts.push(`${plural(context, 'node', 'nodes')} faded as context: who else uses ` +
        `${plural(new Set([...hood.context.values()].map((c) => c.of)).size, 'node', 'nodes')} of the flow.`);
    }
    if (hood.left > 0) {
      parts.push(`<b>${hood.left.toLocaleString()} more</b> not drawn: the cap is ${state.cap}. ` +
        'Raise it, expand a node marked +N, or filter.');
    } else {
      parts.push(hood.nodes.length === 1 && hood.edges.length === 0
        ? 'Nothing the filters let through joins it.'
        : 'Nothing within reach is left out.');
    }
    if (filter.active) {
      const hiddenServices = repos.filter((name) => !shown.has(name)).length;
      const off = [
        hiddenServices && plural(hiddenServices, 'service', 'services'),
        state.hiddenEdgeTypes.size && plural(state.hiddenEdgeTypes.size, 'edge type', 'edge types'),
        state.hiddenConfidences.size && plural(state.hiddenConfidences.size, 'kind of trust', 'kinds of trust'),
      ].filter(Boolean);
      parts.push('Filters hide ' + off.join(', ') + '.');
    }
    const folded = [...hood.chips.values()].filter((chip) => !chip.open);
    if (folded.length > 0) {
      parts.push(`Plumbing in front of ${plural(folded.length, 'node', 'nodes')} is folded into its chip.`);
    }
    if (state.opened.size > 0) parts.push('<button class="g-again" data-again>Group again</button>');
    statusEl.className = 'g-status' + (hood.left > 0 ? ' is-cut' : '');
    statusEl.innerHTML = parts.join(' ');
  };

  return { ALSO_SAYS, BADGE, BOX, BOX_HEIGHTS, DOORS, FILE_LIMIT, GROUP_LIMIT, LOOK_SAYS, SHAPED, SVG_NS,
    TYPE_KIND_SAYS, at, backBtn, badgesFor, camera, card, cardNode, contextOf, drawDrawing, drawStatus, extentOf,
    filterNow, forwardBtn, gCapSel, glyphOf, graphView, hopsSel, isGroup, lookOf, metaOf, metaValueHtml,
    nodeCardHtml, paintSelection, panel, pinLaneNames, placeOf, problems, sizeMinimap, stage, state, statusEl,
    svg, svgEl, traceTo, trail, typeCardHtml, typeOf, unitOf, visibleFocus, wideFor, world, wrap,
    cardSeenNow: () => cardSeen, zoomDrawn: () => zoomNow };
}
