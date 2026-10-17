import { impactView, middle, neighbourhood, onlyProblems, shortestPath, upstream } from '../graph.js';

/* Checking on the Graph tab: the problems list, a path between two nodes and
   impact, each an answer the drawing draws like a neighbourhood. */
export function createChecking(page) {
  const { BADGE, KD, LB, RP, ambiguousHtml, at, badgesFor, camera, confidences, data, drawDetails,
    edgeTypes, esc, filterNow, graphLink, hueOf, kinds, model, nodes, panel, placeOf, plural, problems,
    repoName, repos, seen, state, statusEl, store, typeOf, unmatchedHtml } = page;
  const shown = store.get('shown');

  /* ── checking: problems, a path between two nodes, impact ── */

  /* Every answer is a set of nodes graph.js shapes like a neighbourhood, so
     the drawing draws it unchanged. The page keeps which question is asked
     in `state.query`; `asked` turns that into the hood the drawing reads,
     and `drawAnswer` says what the answer was and what was searched. */

  const answerEl = document.getElementById('g-answer');
  const problemsBtn = document.getElementById('g-problems');
  const onlyBox = document.getElementById('g-only');
  const onlyNote = document.getElementById('g-only-note');
  const endBtns = { from: document.getElementById('g-from'), to: document.getElementById('g-to') };
  const wayBtn = document.getElementById('g-way');
  const pathDepthSel = document.getElementById('g-path-depth');
  const clearBtn = document.getElementById('g-clear');
  const searchEl = document.getElementById('g-search');
  const searchPrompt = searchEl.placeholder;
  const ANSWER_LIMIT = 60;

  /* The same badges the drawing pins on the node, said in words. */
  const badgesHtml = (v) => {
    const list = badgesFor(v);
    if (list.length === 0) return '';
    return '<div class="g-badges">' + list.map((badge) => {
      const say = (BADGE[badge.kind] || { say: (n) => n.toLocaleString() }).say;
      return `<span class="tag is-${badge.tone}" title="${esc(badge.title || '')}">${say(badge.count)}</span>`;
    }).join('') + '</div>';
  };

  const checkActionsHtml = (v) => {
    const impactOn = state.query !== null && state.query.kind === 'impact' && state.query.target === v;
    const end = (name, text, title) =>
      `<button class="tool" data-check="${name}" aria-pressed="${state.ends[name] === v}" title="${title}">${text}</button>`;
    return '<div class="g-actions">' +
      end('from', 'Path from here', 'Find the shortest path that starts here') +
      end('to', 'Path to here', 'Find the shortest path that ends here') +
      `<button class="tool" data-check="impact"${impactOn ? ' disabled' : ''} ` +
      'title="Everything upstream of this node, to the ways in, as flowatlas impact walks it">Impact</button>' +
      '</div>';
  };

  /* What is drawn: the neighbourhood, cut to its problems when asked, or
     the answer to the question asked. Every one folds plumbing into chips
     the same way; only the neighbourhood groups, since an answer is every
     node on it. */
  const asked = () => {
    const query = state.query;
    const fold = { draw: state.plumbing, unfolded: state.unfolded };
    if (query === null) {
      const hood = neighbourhood(model, {
        focus: state.focus,
        hops: state.hops,
        cap: state.cap,
        filter: filterNow(),
        expanded: state.expanded,
        also: state.also,
        fold,
        group: true,
        opened: state.opened,
      });
      return state.problemsOnly ? onlyProblems(model, hood, problems.has) : hood;
    }
    if (query.kind === 'path') {
      const filter = filterNow();
      return shortestPath(model, {
        from: state.ends.from,
        to: state.ends.to,
        directed: state.directed,
        depth: state.pathDepth,
        cap: state.cap,
        filter,
        fold: { ...fold, filter },
      });
    }
    return impactView(model, query.found, { cap: state.cap, expanded: state.expanded, fold });
  };

  /* Asking goes to the answer's focus the ordinary way, so Back returns to
     the neighbourhood before it, and draws the answer there. */
  const ask = (query, focus) => {
    state.answer = 'query';
    page.go(focus, true, query);
  };
  const askPath = () => ask({ kind: 'path' }, state.ends.from);
  const askImpact = (v) => ask({ kind: 'impact', target: v, found: upstream(model, v) }, v);

  const stopPicking = () => {
    state.picking = null;
    paintChecks();
  };

  /* What Escape closes after the panel: the problems list over an answer,
     then the half-chosen path, then the answer itself. True when it closed
     something. */
  const dismissAnswer = () => {
    if (state.answer === 'problems') {
      state.answer = state.query === null ? null : 'query';
      drawAnswer();
      return true;
    }
    if (state.query === null && state.answer === 'ends') {
      state.ends = { from: null, to: null };
      state.answer = null;
      drawAnswer();
      drawDetails();
      return true;
    }
    if (state.query !== null) {
      clearQuery();
      return true;
    }
    return false;
  };

  const chooseEnd = (v, end = state.picking) => {
    state.ends[end] = v;
    state.picking = null;
    if (state.ends.from !== null && state.ends.to !== null) askPath();
    else {
      state.answer = 'ends';
      drawAnswer();
      drawDetails();
    }
  };

  const filtersSaid = () => {
    const hiddenServices = repos.filter((name) => !shown.has(name)).length;
    const off = [
      hiddenServices && plural(hiddenServices, 'service', 'services'),
      state.hiddenEdgeTypes.size && plural(state.hiddenEdgeTypes.size, 'edge type', 'edge types'),
      state.hiddenConfidences.size && plural(state.hiddenConfidences.size, 'kind of trust', 'kinds of trust'),
    ].filter(Boolean);
    return off.length === 0 ? 'with no filters on' : 'with ' + off.join(', ') + ' hidden by the filters';
  };

  const nameOf = (v) => `<b>${esc(nodes[v][LB])}</b>`;
  const pickable = (v, note, text) =>
    `<li><button class="g-far" data-pick="${v}" style="--hue:${hueOf(nodes[v][RP])}" ` +
    `title="${esc(nodes[v][LB])}${placeOf(v) ? ', ' + esc(placeOf(v)) : ''}">` +
    `<span class="label">${esc(text || nodes[v][LB])}</span><small>${esc(note)}</small></button>${graphLink(v)}</li>`;
  const listHtml = (key, title, items, empty) => {
    const open = state.answerOpen.has(key);
    const shownItems = open ? items : items.slice(0, ANSWER_LIMIT);
    return `<h4>${title} &middot; ${items.length.toLocaleString()}</h4>` +
      (items.length === 0 ? `<p class="g-none">${empty}</p>` : `<ul>${shownItems.join('')}</ul>`) +
      (shownItems.length < items.length
        ? `<button class="g-more-btn" data-list="${key}">Show ${(items.length - shownItems.length).toLocaleString()} more</button>`
        : '');
  };
  const reasonsAt = (v) => {
    const found = problems.of(v);
    return problems.reasonsOf([...found.on, ...found.atLine]).join(', ');
  };

  const problemsHtml = () => {
    const { waysIn, crossings, calls } = problems.list();
    const ways = waysIn.map((item) => pickable(item.node,
      [repoName(item.node), item.unhandled ? 'no handler read' : '', reasonsAt(item.node)].filter(Boolean).join(' · ')));
    const crossed = crossings.map((item) => {
      const e = data.edges[item.edge];
      const v = problems.has(e[1]) ? e[1] : e[0];
      return pickable(v, `${repoName(e[0])} → ${repoName(e[1])} · ${edgeTypes[e[2]]}, ${confidences[e[3]]} · ` +
        `${[reasonsAt(e[0]), reasonsAt(e[1])].filter(Boolean).join(', ')}`, `${nodes[e[0]][LB]} → ${nodes[e[1]][LB]}`);
    });
    const unjoined = calls.map((item) => pickable(item.node,
      [repoName(item.node), item.unjoined ? 'joined nothing' : '', reasonsAt(item.node)].filter(Boolean).join(' · ')));
    return '<p>Where to look first. A problem is a row of <b>Not joined</b> that names a node or sits at its ' +
      'line; a node carrying one is badged with the count.</p>' +
      (seen.unmatched.length > 0 ? unmatchedHtml() : '') + ambiguousHtml() +
      listHtml('ways', 'Ways in with problems', ways, 'Every way in has a handler that was read, and no row.') +
      listHtml('crossings', 'Crossings with problems', crossed, 'No crossing has a row at either end.') +
      listHtml('calls', 'Calls that did not join, or carry rows', unjoined, 'Every call joined, and none carries a row.');
  };

  const pathHtml = (hood) => {
    const way = state.directed ? 'along edges the way the calls run' : 'along edges either way';
    const ends = `from ${nameOf(hood.from)} to ${nameOf(hood.to)}`;
    if (!hood.found) {
      const tries = [state.directed && 'either way', hood.depth < 24 && 'a longer search', filterNow().active && 'fewer filters']
        .filter(Boolean);
      return `<p><b>No path</b> ${ends} within ${plural(hood.depth, 'step', 'steps')} ${way}, ${filtersSaid()}.</p>` +
        `<p>Searched the ${plural(hood.searched, 'node', 'nodes')} ${nameOf(hood.from)} reaches that way.` +
        (tries.length ? ' Try ' + tries.join(', or ') + '.' : '') + '</p>';
    }
    return `<p><b>${plural(hood.paths, 'shortest path', 'shortest paths')}</b> of ${plural(hood.length, 'step', 'steps')} ` +
      `${ends}, ${way}, ${filtersSaid()}.` +
      (hood.left > 0 ? ` ${plural(hood.left, 'node', 'nodes')} on them not drawn: the cap is ${state.cap}; one whole path is drawn first.` : '') +
      '</p>';
  };

  const impactHtml = (hood) => {
    const found = state.query.found;
    const entries = found.entries.map((v) => pickable(v,
      `${repoName(v)} · ${kinds[nodes[v][KD]] || typeOf(v)} · ${plural(found.dist.get(v), 'hop', 'hops')} back`));
    const screens = found.doors.filter((v) => typeOf(v) !== 'entry').map((v) => pickable(v,
      `${repoName(v)} · ${kinds[nodes[v][KD]] || typeOf(v)} · ${plural(found.dist.get(v), 'hop', 'hops')} back`));
    const stops = found.withoutEntry.map((s) => esc(repos[s]));
    if (found.reached === 0) {
      return `<p><b>Nothing reaches</b> ${nameOf(found.target)} along the edges <code>flowatlas impact</code> walks ` +
        'back, so a change to it is seen only from it.</p>';
    }
    return `<p><b>${plural(found.reached, 'node reaches', 'nodes reach')}</b> ${nameOf(found.target)} within ` +
      `${plural(found.depth, 'hop', 'hops')} back, walked as <code>flowatlas impact</code> walks it, so no filter applies.` +
      (hood.left > 0 ? ` ${plural(hood.left, 'node', 'nodes')} not drawn: the cap is ${state.cap}; every way in is drawn first, with one chain down from it.` : '') +
      '</p>' +
      (stops.length ? `<p>Also reaches ${stops.join(', ')}, where the chain stops before an entry point.</p>` : '') +
      listHtml('entries', 'Entry points', entries, 'Nothing that reaches it is an entry point.') +
      (screens.length ? listHtml('screens', 'Screen actions', screens, '') : '');
  };

  const endsHtml = () => {
    const set = state.ends.from !== null ? 'from' : 'to';
    const other = set === 'from' ? 'to' : 'from';
    return `<p>Path ${set} ${nameOf(state.ends[set])}. Now choose where it ${other === 'to' ? 'ends' : 'starts'}: ` +
      `<b>Path ${other} here</b> on another node, or <b>${other}: pick&hellip;</b> above and search.</p>`;
  };

  const paintChecks = () => {
    const { waysIn, crossings, calls } = problems.list();
    problemsBtn.textContent = `Problems · ${(waysIn.length + crossings.length + calls.length).toLocaleString()}`;
    problemsBtn.setAttribute('aria-expanded', String(state.answer === 'problems'));
    for (const [end, button] of Object.entries(endBtns)) {
      const v = state.ends[end];
      button.textContent = `${end}: ` + (v === null ? 'pick…' : middle(nodes[v][LB], 30));
      button.title = v === null ? `Pick where the path ${end === 'from' ? 'starts' : 'ends'}` : nodes[v][LB];
      button.classList.toggle('is-picking', state.picking === end);
    }
    wayBtn.innerHTML = state.directed ? '&rarr; one way' : '&harr; either way';
    wayBtn.setAttribute('aria-pressed', String(!state.directed));
    pathDepthSel.value = String(state.pathDepth);
    clearBtn.hidden = state.query === null;
    onlyBox.checked = state.problemsOnly;
    onlyBox.disabled = state.query !== null;
    onlyNote.textContent = state.problemsOnly && state.query === null && state.hood && state.hood.clean
      ? plural(state.hood.clean, 'node', 'nodes') + ' without problems hidden'
      : '';
    searchEl.placeholder = state.picking === null ? searchPrompt
      : `Pick where the path ${state.picking === 'from' ? 'starts' : 'ends'} (Escape to stop)`;
  };

  /* The answer box and, while a question is asked, the line under the
     drawing. True when it wrote that line. */
  function drawAnswer() {
    paintChecks();
    const query = state.query;
    const showing = state.answer === 'query' ? (query === null ? null : query.kind)
      : state.answer === 'ends' ? (query === null && (state.ends.from === null) !== (state.ends.to === null) ? 'ends' : null)
      : state.answer;
    answerEl.hidden = showing === null;
    answerEl.classList.toggle('is-none', showing === 'path' && !state.hood.found);
    if (showing === 'problems') answerEl.innerHTML = problemsHtml();
    else if (showing === 'path') answerEl.innerHTML = pathHtml(state.hood);
    else if (showing === 'impact') answerEl.innerHTML = impactHtml(state.hood);
    else if (showing === 'ends') answerEl.innerHTML = endsHtml();
    if (query === null || state.hood === null) return false;

    const hood = state.hood;
    const drawn = `<b>${plural(hood.nodes.length, 'node', 'nodes')}</b> drawn`;
    statusEl.className = 'g-status' + (hood.left > 0 ? ' is-cut' : '');
    statusEl.innerHTML = query.kind === 'path'
      ? (hood.found
        ? `${drawn} on the shortest ${hood.paths === 1 ? 'path' : 'paths'} from ${nameOf(hood.from)} to ${nameOf(hood.to)}.`
        : `<b>No path</b> from ${nameOf(hood.from)} to ${nameOf(hood.to)} within ${plural(hood.depth, 'step', 'steps')}.`)
      : `${drawn} upstream of ${nameOf(query.target)}, of ${plural(query.found.reached, 'node', 'nodes')} that reach it.`;
    if (hood.left > 0) statusEl.innerHTML += ` <b>${hood.left.toLocaleString()} more</b> not drawn: the cap is ${state.cap}.`;
    return true;
  }

  problemsBtn.addEventListener('click', () => {
    state.answer = state.answer === 'problems' ? (state.query === null ? null : 'query') : 'problems';
    drawAnswer();
  });
  onlyBox.addEventListener('change', () => { state.problemsOnly = onlyBox.checked; page.draw(false); });
  for (const [end, button] of Object.entries(endBtns)) {
    button.addEventListener('click', () => {
      state.picking = state.picking === end ? null : end;
      paintChecks();
      if (state.picking !== null) searchEl.focus();
    });
  }
  wayBtn.addEventListener('click', () => {
    state.directed = !state.directed;
    if (state.query !== null && state.query.kind === 'path') page.draw(true);
    else paintChecks();
  });
  pathDepthSel.addEventListener('change', () => {
    state.pathDepth = Number(pathDepthSel.value);
    if (state.query !== null && state.query.kind === 'path') page.draw(true);
  });
  function clearQuery() {
    state.query = null;
    state.answer = null;
    state.expanded = [];
    state.also = [];
    page.draw(true);
    page.syncControls();
  }
  clearBtn.addEventListener('click', clearQuery);
  answerEl.addEventListener('click', (event) => {
    const more = event.target.closest('[data-list]');
    if (more) { state.answerOpen.add(more.dataset.list); drawAnswer(); return; }
    const named = event.target.closest('[data-pick]');
    if (!named) return;
    const v = Number(named.dataset.pick);
    if (state.hood.layer.has(v)) { page.select(v, false); camera.reveal(at(v)); } else page.go(v);
  });
  panel.addEventListener('click', (event) => {
    const target = event.target.closest('button[data-check]');
    if (!target || state.open === null) return;
    if (target.dataset.check === 'impact') askImpact(state.open);
    else chooseEnd(state.open, target.dataset.check);
  });

  return { askImpact, askPath, asked, badgesHtml, checkActionsHtml, chooseEnd, dismissAnswer, drawAnswer,
    stopPicking };
}
