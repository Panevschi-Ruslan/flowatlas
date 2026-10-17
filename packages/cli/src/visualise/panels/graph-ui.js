import { PATH_DEPTHS, faceOf, layout, panelKeysOf, step } from '../graph.js';
import { formatHash, pinch, pressed, wordFor } from '../frame.js';

/* What a person does on the Graph tab: the state changes every control ends
   in, the controls and their Filters and Check popovers, gestures, the keys
   on a node and in the panel, and `graph`, which the other tabs open it
   through. Nodes are searched for in the one search (find.js). */
export function createGraphUi(page) {
  const { BOX, LB, askImpact, askPath, asked, at, backBtn, camera, card, cardNode, cardSeenNow,
    confidences, drawDetails, drawDrawing, drawEntries, drawStatus, edgeTypes, faceRows,
    forwardBtn, gCapSel, hopsSel, isGroup, keys, model, nodeCardHtml, nodes,
    paintSelection, panel, repos, state, statusEl, store, svg, titleEl,
    traceTo, trail, typeCardHtml, unitOf, visibleFocus, wideFor, wrap } = page;
  const shown = store.get('shown');

  /* ── state changes: every control ends in one of these ── */

  /* The view in the address: the focus, the hops and what was expanded, each
     node by its key, so the link opens the same view after a rebuild; then
     the question asked of it, and what the filters hide, by name. */
  const askNow = () => {
    const query = state.query;
    if (query !== null && query.kind === 'impact') return { kind: 'impact' };
    if (query !== null && query.kind === 'path') {
      return { kind: 'path', to: state.ends.to, depth: state.pathDepth, directed: state.directed };
    }
    return state.problemsOnly ? { kind: 'only' } : null;
  };
  const hiddenNow = () => ({
    services: repos.filter((name) => !shown.has(name)),
    edgeTypes: [...state.hiddenEdgeTypes].map((i) => edgeTypes[i]),
    confidences: [...state.hiddenConfidences].map((i) => confidences[i]),
  });
  const hashNow = () => formatHash(keys, state.focus, state.hops, state.expanded, {
    ask: askNow(),
    hidden: hiddenNow(),
    also: state.also,
  });
  const writeHash = () => {
    if (store.get('view') !== 'graph') return;
    history.replaceState(null, '', hashNow());
    page.notice.moved();
  };

  const syncControls = () => {
    backBtn.disabled = !trail.canBack();
    forwardBtn.disabled = !trail.canForward();
    writeHash();
    titleEl.textContent = nodes[state.focus][LB];
  };

  const draw = (frame) => {
    state.hood = asked();
    state.placed = layout(model, state.hood, {
      column: BOX.column, row: BOX.row, laneGap: BOX.laneGap, laneHead: BOX.laneHead,
    });
    if (state.open !== null && !state.hood.layer.has(state.open)) state.open = null;
    if (!state.hood.layer.has(state.cursor)) state.cursor = state.focus;
    drawDrawing();
    drawStatus();
    drawDetails();
    if (frame) camera.frame(state.placed, at(state.focus), false);
    writeHash();
  };

  const select = (v, moveFocus) => {
    state.cursor = v;
    if (state.open !== v) { state.openGroups.clear(); state.openTypes.clear(); state.typeMore.clear(); }
    state.open = v;
    paintSelection(moveFocus);
    drawDetails();
  };

  /* The details for a node with the types its card showed - or only the
     one asked for - opened one level, so nothing seen on the card is lost. */
  const openWithCard = (v, only, moveFocus) => {
    const shown = only !== null ? [only] : cardSeenNow().v === v ? cardSeenNow().types : [];
    select(v, moveFocus);
    const keys = panelKeysOf(model, v, shown);
    if (keys.length === 0) return;
    for (const key of keys) state.openTypes.add(key);
    drawDetails();
    const [first] = keys;
    const at = first.slice(0, first.lastIndexOf(':'));
    const type = first.slice(first.lastIndexOf(':') + 1);
    const opened = panel.querySelector(`button.g-type[data-at="${CSS.escape(at)}"][data-type="${type}"]`);
    if (opened) opened.scrollIntoView({ block: 'nearest' });
  };

  /* A click on the card shows, there on it, what it cut; or goes on to the
     details, with what it showed open. */
  card.el.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const asked = card.showing();
    if (button === null || asked === null) return;
    const wide = wideFor(asked);
    const { cardRows, cardLines, cardTypes, cardOpen } = button.dataset;
    if (cardRows !== undefined) wide.rows = [...wide.rows, Number(cardRows)];
    else if (cardLines !== undefined) wide.lines = true;
    else if (cardTypes !== undefined) wide.types = true;
    else {
      if (!asked.startsWith('node:')) return;
      card.hide();
      openWithCard(Number(asked.slice('node:'.length)), cardOpen !== undefined ? Number(cardOpen) : null, false);
      return;
    }
    card.refresh();
  });

  const go = (v, record = true, query = null) => {
    if (record) trail.visit(v);
    state.query = query;
    state.focus = v;
    state.cursor = v;
    state.open = v;
    state.expanded = [];
    state.also = [];
    state.openGroups.clear();
    state.openTypes.clear();
    state.typeMore.clear();
    state.unfolded = new Set();
    state.opened = new Set();
    draw(true);
    syncControls();
  };

  /* A group opens in place into what it holds; a chip draws, or folds back,
     the plumbing in front of its node. */
  const openGroup = (id) => {
    state.opened.add(id);
    state.cursor = state.hood.parent.get(id) ?? state.focus;
    draw(false);
  };
  const toggleChain = (v) => {
    if (state.unfolded.has(v)) state.unfolded.delete(v); else state.unfolded.add(v);
    state.cursor = v;
    draw(false);
  };

  const expand = (v) => {
    if (!state.expanded.includes(v)) state.expanded.push(v);
    state.cursor = v;
    state.open = v;
    draw(false);
    writeHash();
  };

  /* Who else uses a node, drawn as context or put away again. */
  const toggleAlso = (v) => {
    if (!state.hood.others.has(v)) return;
    state.also = state.also.includes(v) ? state.also.filter((u) => u !== v) : [...state.also, v];
    state.cursor = v;
    state.open = v;
    draw(false);
  };

  const closeDetails = () => {
    state.open = null;
    paintSelection(panel.contains(document.activeElement));
    drawDetails();
  };

  /* ── controls ── */

  backBtn.addEventListener('click', () => go(trail.back(), false));
  forwardBtn.addEventListener('click', () => go(trail.forward(), false));
  hopsSel.addEventListener('change', () => { state.hops = Number(hopsSel.value); draw(true); syncControls(); });
  gCapSel.addEventListener('change', () => { state.cap = Number(gCapSel.value); draw(true); });
  document.getElementById('g-zoom-in').addEventListener('click', () => camera.zoom(1.25));
  document.getElementById('g-zoom-out').addEventListener('click', () => camera.zoom(0.8));
  document.getElementById('g-fit').addEventListener('click', () => camera.frame(state.placed, at(state.focus), true));

  /* Two popovers off the bar (P101), so the controls fit one row: Filters
     and Check, each button saying how much of it is on. One is open at a
     time; a click elsewhere or Escape closes it. */
  const popovers = [...document.querySelectorAll('#graph-view .g-pop-btn')].map((button) => ({
    button, pop: document.getElementById(button.getAttribute('aria-controls')),
  }));
  const setPopover = (open) => {
    for (const { button, pop } of popovers) {
      pop.hidden = pop !== open;
      button.setAttribute('aria-expanded', String(pop === open));
    }
  };
  /* Closes the one open, true when there was one: the Escape chain asks first. */
  const closePopovers = () => {
    const open = popovers.find(({ pop }) => !pop.hidden);
    if (open === undefined) return false;
    setPopover(null);
    if (open.pop.contains(document.activeElement)) open.button.focus();
    return true;
  };
  for (const { button, pop } of popovers) {
    button.addEventListener('click', () => setPopover(pop.hidden ? pop : null));
  }
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.g-pop-wrap')) setPopover(null);
  });

  /* Filters: services on the rail above, edge types, trust and plumbing in
     the popover, each named in words with its code in the tooltip. */
  const filterBar = document.getElementById('g-filters');
  const filtersBtn = document.getElementById('g-filters-btn');
  const filterChips = [];
  /* `Filters · 2`: what is hidden, the rail's services included, and plumbing drawn. */
  const paintFilters = () => {
    const on = repos.filter((name) => !shown.has(name)).length + state.hiddenEdgeTypes.size +
      state.hiddenConfidences.size + (state.plumbing ? 1 : 0);
    filtersBtn.textContent = on > 0 ? `Filters · ${on}` : 'Filters';
  };
  /* A row of the popover: its name, then its chips. */
  const filterRow = (title) => {
    const row = document.createElement('div');
    row.className = 'g-pop-row';
    const label = document.createElement('span');
    label.className = 'hint';
    label.textContent = title;
    row.append(label);
    filterBar.append(row);
    return row;
  };
  const chips = (title, names, hidden, kind) => {
    const row = filterRow(title);
    names.forEach((name, i) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = wordFor(kind, name);
      chip.title = name;
      chip.setAttribute('aria-pressed', 'true');
      chip.addEventListener('click', () => {
        if (hidden.has(i)) hidden.delete(i); else hidden.add(i);
        chip.setAttribute('aria-pressed', String(!hidden.has(i)));
        draw(false);
        paintFilters();
      });
      filterChips.push({ chip, hidden, i });
      row.append(chip);
    });
  };
  chips('edges', edgeTypes, state.hiddenEdgeTypes, 'edge');
  chips('trust', confidences, state.hiddenConfidences, 'trust');
  {
    // Plumbing is folded into a chip on what it wraps unless asked for.
    const row = filterRow('plumbing');
    const toggle = document.createElement('button');
    toggle.className = 'chip';
    toggle.textContent = 'drawn as nodes';
    toggle.title = 'Guards, interceptors, pipes and middleware: folded into a chip on what they wrap, ' +
      'or drawn as nodes of their own';
    toggle.setAttribute('aria-pressed', String(state.plumbing));
    toggle.addEventListener('click', () => {
      state.plumbing = !state.plumbing;
      state.unfolded.clear();
      toggle.setAttribute('aria-pressed', String(state.plumbing));
      draw(false);
      paintFilters();
    });
    row.append(toggle);
  }
  filterBar.insertAdjacentHTML('beforeend', '<div class="g-pop-row"><span class="hint">services: the rail above</span></div>');
  store.on((key) => { if (key === 'shown') paintFilters(); });
  paintFilters();

  /* Pointer: one finger or a mouse drags to pan; two fingers pan and pinch to
     zoom; a wheel or a trackpad pans, and a trackpad pinch or ctrl+wheel zooms.
     Every pointer down is kept by id, in the canvas's own pixels, so a second
     finger joining or one lifting picks up where the gesture is. */
  const fingers = new Map();
  let dragged = false;
  const local = (event) => {
    const box = wrap.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  let anchor = null;
  wrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.g-zoom, .g-notice, .g-mini')) return;
    // A mouse or a pen is one pointer: one let go outside the canvas never
    // said so, and must not turn the next drag into a pinch.
    if (event.pointerType !== 'touch') fingers.clear();
    fingers.set(event.pointerId, local(event));
    if (fingers.size === 1) { anchor = local(event); dragged = false; }
    else {
      // A second finger is a pinch, never a click on whatever it landed on.
      dragged = true;
      wrap.classList.add('is-panning');
    }
  });
  wrap.addEventListener('pointermove', (event) => {
    if (!fingers.has(event.pointerId)) return;
    const here = local(event);
    if (fingers.size >= 2) {
      const before = [...fingers.values()].slice(0, 2);
      fingers.set(event.pointerId, here);
      const after = [...fingers.values()].slice(0, 2);
      const move = pinch(before, after);
      camera.pan(move.dx, move.dy);
      camera.zoomAt(move.at.x, move.at.y, move.factor);
      return;
    }
    fingers.set(event.pointerId, here);
    const dx = here.x - anchor.x, dy = here.y - anchor.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    if (!dragged) {
      dragged = true;
      wrap.setPointerCapture(event.pointerId);
      wrap.classList.add('is-panning');
    }
    camera.pan(dx, dy);
    anchor = here;
  });
  const lift = (event) => {
    fingers.delete(event.pointerId);
    // The finger left behind carries on panning from where it is now.
    if (fingers.size === 1) anchor = [...fingers.values()][0];
    if (fingers.size === 0) wrap.classList.remove('is-panning');
  };
  wrap.addEventListener('pointerup', lift);
  wrap.addEventListener('pointercancel', lift);
  wrap.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const box = wrap.getBoundingClientRect();
      camera.zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * 0.004));
    } else camera.pan(-event.deltaX, -event.deltaY);
  }, { passive: false });

  svg.addEventListener('click', (event) => {
    if (dragged) { dragged = false; return; }
    const chip = event.target.closest('.g-chip');
    if (chip) { toggleChain(Number(chip.dataset.chip)); return; }
    const badge = event.target.closest('.g-more');
    if (badge) { expand(Number(badge.dataset.more)); return; }
    const also = event.target.closest('.g-also');
    if (also) { toggleAlso(Number(also.dataset.also)); return; }
    const node = event.target.closest('.g-node');
    if (node && node.dataset.group !== undefined) openGroup(node.dataset.group);
    else if (node) {
      const v = Number(node.dataset.node);
      if (pressedCard === 'node:' + v) openWithCard(v, null, false);
      else select(v, false);
    }
  });
  svg.addEventListener('dblclick', (event) => {
    const node = event.target.closest('.g-node');
    if (node && node.dataset.node !== undefined && !event.target.closest('.g-more, .g-also, .g-chip')) {
      go(Number(node.dataset.node));
    }
  });

  /* The trace follows the pointer, and the keys; so does the card. */
  svg.addEventListener('pointerover', (event) => {
    // Not while panning or pinching: the pointer is moving the drawing.
    if (fingers.size > 0 && dragged) return;
    const node = event.target.closest('.g-node');
    traceTo(node ? unitOf(node) : null);
    const pointed = event.pointerType === 'touch' ? null : cardNode(event);
    if (pointed === null) card.soon();
    else {
      const v = unitOf(pointed);
      card.later(pointed, 'node:' + v, () => nodeCardHtml(v), 'side');
    }
  });
  // Off the drawing may be onto the card, which holds itself while the pointer is on it.
  svg.addEventListener('pointerleave', () => { traceTo(null); card.soon(); });
  /* A press hides the card, and remembers what it was on: a click on the
     node it described opens the details with what it showed. */
  let pressedCard = null;
  svg.addEventListener('pointerdown', () => { pressedCard = card.showing(); card.hide(); });
  svg.addEventListener('focusin', (event) => {
    const node = event.target.closest('.g-node');
    if (node) traceTo(unitOf(node));
    // A node the keys moved onto, not one a click focused on its way.
    if (node && node.dataset.node !== undefined && visibleFocus(node)) {
      const v = unitOf(node);
      card.now(node, 'node:' + v, () => nodeCardHtml(v), 'side');
    }
  });
  svg.addEventListener('focusout', (event) => {
    traceTo(null);
    if (!card.holds(event.relatedTarget)) card.hide();
  });
  // A drawing that moves leaves the card pointing at where a node was.
  camera.watch(() => card.hide());
  statusEl.addEventListener('click', (event) => {
    if (!event.target.closest('[data-again]')) return;
    state.opened.clear();
    draw(false);
  });

  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  /* The keys on a node, as SHORTCUTS (frame.js) lists them. */
  svg.addEventListener('keydown', (event) => {
    const node = event.target.closest('.g-node');
    if (!node) return;
    const v = unitOf(node);
    if (pressed('graph.move', event)) {
      event.preventDefault();
      state.cursor = step(state.placed, v, KEYS[event.key]);
      // Into view first, so the card the focus brings is placed where the node ends up.
      camera.reveal(at(state.cursor));
      paintSelection(true);
    } else if (isGroup(v) && (pressed('graph.open', event) || pressed('graph.expand', event))) {
      event.preventDefault();
      openGroup(v);
    } else if (pressed('graph.open', event)) {
      event.preventDefault();
      if (card.showing() === 'node:' + v) openWithCard(v, null, true);
      else select(v, true);
    } else if (pressed('graph.plumbing', event) && state.hood.chips.has(v)) {
      event.preventDefault();
      toggleChain(v);
    } else if (pressed('graph.expand', event)) {
      event.preventDefault();
      expand(v);
    } else if (pressed('graph.also', event) && !isGroup(v) && state.hood.others.has(v)) {
      event.preventDefault();
      toggleAlso(v);
    } else if (pressed('graph.close', event) && state.open !== null) {
      event.preventDefault();
      closeDetails();
    }
  });

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const v = state.open;
    if (target.dataset.go !== undefined) go(Number(target.dataset.go));
    else if (target.dataset.type !== undefined) page.toggleType(target.dataset.at + ':' + target.dataset.type);
    else if (target.dataset.all !== undefined) {
      page.openEverything([{ at: target.dataset.all, ref: Number(target.dataset.ref) }], target.dataset.all,
        `button.g-type-all[data-all="${CSS.escape(target.dataset.all)}"]`);
    } else if (target.dataset.more !== undefined) {
      const more = state.typeMore.get(target.dataset.more);
      if (more) page.openEverything(more.roots, target.dataset.more, `button[data-more="${CSS.escape(target.dataset.more)}"]`);
    } else if (target.dataset.types === 'all') {
      page.openEverything(faceRows(faceOf(model, v), v), 'all', 'button[data-types="all"]');
    } else if (target.dataset.types === 'none') {
      state.openTypes.clear();
      state.typeMore.clear();
      drawDetails();
      page.refocus('button[data-types="all"]');
    } else if (target.dataset.types === 'copy') page.copyTypes(v, target);
    else if (target.dataset.group !== undefined) { state.openGroups.add(target.dataset.group); drawDetails(); }
    else if (target.dataset.act === 'close') closeDetails();
    else if (target.dataset.act === 'centre') go(v);
    else if (target.dataset.act === 'expand') expand(v);
    else if (target.dataset.act === 'also') toggleAlso(v);
    else if (target.dataset.act === 'open-steps') { store.set('current', v); drawEntries(); page.showView('steps'); }
    else if (target.dataset.act === 'steps') page.stepsInGraph.toggle(v);
  });
  panel.addEventListener('keydown', (event) => {
    if (pressed('graph.close', event)) { event.preventDefault(); closeDetails(); return; }
    // `E` (or `*`, as a tree has it) on a type opens everything under it.
    const type = event.target.closest && event.target.closest('button.g-type');
    if (type && pressed('graph.type-all', event)) {
      event.preventDefault();
      const { at, ref } = type.dataset;
      page.openEverything([{ at, ref: Number(ref), only: Number(type.dataset.type) }], at,
        `button.g-type[data-at="${CSS.escape(at)}"][data-type="${type.dataset.type}"]`);
    }
  });

  /* A type in the details peeks on hover, or on the keys: one level of it,
     without opening it. */
  const panelType = (event) => (event.target.closest && event.target.closest('button.g-type')) || null;
  const peekType = (type, now) => {
    const asked = 'type:' + type.dataset.at + ':' + type.dataset.type;
    const build = () => typeCardHtml(Number(type.dataset.type), asked);
    if (now) card.now(type, asked, build, 'below');
    else card.later(type, asked, build, 'below');
  };
  panel.addEventListener('pointerover', (event) => {
    const type = event.pointerType === 'touch' ? null : panelType(event);
    if (type === null) card.soon();
    else peekType(type, false);
  });
  panel.addEventListener('pointerleave', () => card.soon());
  panel.addEventListener('focusin', (event) => {
    const type = panelType(event);
    if (type !== null && visibleFocus(type)) peekType(type, true);
  });
  panel.addEventListener('focusout', (event) => { if (!card.holds(event.relatedTarget)) card.hide(); });

  const graph = {
    go,
    refresh: () => { if (state.focus !== null) draw(false); },
    /* Opening the tab: on what was asked for, else where it was, else the
       way in the walk is on. */
    show(asked) {
      if (asked !== undefined && asked !== null) go(asked);
      else if (state.focus === null) go(store.get('current') ?? 0);
      else { draw(true); syncControls(); }
    },
    setHops(hops) { state.hops = hops; hopsSel.value = String(hops); },
    /* What a link says the filters hide, by name; a name this page does not
       have hides nothing. Drawn by whatever opens the view next. */
    setHidden(hidden) {
      const pick = (names, list) => new Set(names.map((name) => list.indexOf(name)).filter((i) => i >= 0));
      const services = new Set(hidden.services);
      shown.clear();
      for (const name of repos) if (!services.has(name)) shown.add(name);
      // The rail hears this and redraws itself.
      store.set('shown', shown);
      state.hiddenEdgeTypes.clear();
      for (const i of pick(hidden.edgeTypes, edgeTypes)) state.hiddenEdgeTypes.add(i);
      state.hiddenConfidences.clear();
      for (const i of pick(hidden.confidences, confidences)) state.hiddenConfidences.add(i);
      for (const { chip, hidden: set, i } of filterChips) chip.setAttribute('aria-pressed', String(!set.has(i)));
      paintFilters();
      drawEntries();
    },
    /* The question a link asks of the view on its focus. Says why when it
       cannot be asked here; true when it was. */
    ask(question, focus) {
      if (question.kind === 'only') {
        state.problemsOnly = true;
        draw(false);
        return true;
      }
      if (question.kind === 'impact') {
        askImpact(focus);
        return true;
      }
      if (question.to === null) return false;
      state.ends = { from: focus, to: question.to };
      state.directed = question.directed;
      state.pathDepth = PATH_DEPTHS.includes(question.depth) ? question.depth : 12;
      askPath();
      return true;
    },
  };

  return { closeDetails, closePopovers, draw, go, graph, hashNow, select, setPopover, syncControls, writeHash };
}
