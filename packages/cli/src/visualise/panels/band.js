import { formatViewHash } from '../frame.js';
import { ROW } from '../graph.js';
import { stepsOf } from '../steps.js';

/* The strip at the top (P98): the title, a pill per figure of what was read
   and joined, when it was built with the build's timings folded away, the
   run-time pill when a trace was imported; the service rail under it, which
   doubles as the filter every tab reads, as chips or, past a dozen services,
   one button and a checklist; and the Start here card, three things worth
   opening, each worked out from the graph in hand. */
export function createBand(page) {
  const { LB, MT, acceptedRows, data, entryIx, esc, hueOf, keys, model, nodes, plural, reachesCrossing, reasons,
    repoName, repos, seen, store } = page;
  const shown = store.get('shown');
  const r = data.report;

  /* ── the strip: a pill per figure ────────────────────────────────── */

  /* A pill is its label and value; what it means is its title, and the line
     under the strip while it is focused or clicked open. A pill whose total
     is nought has nothing to say and is not drawn (P98) - "0 / 0 joined" on
     a project with no front end - except Missed, and how many repositories
     were read, where nought is the news. */
  const band = document.getElementById('band');
  const noteEl = document.getElementById('pill-note');
  let openPill = null;
  const showNote = (el) => {
    if (openPill !== null) openPill.classList.remove('is-open');
    openPill = el;
    noteEl.hidden = el === null;
    noteEl.textContent = el === null ? '' : el.dataset.label + ': ' + el.dataset.note;
    if (el !== null) el.classList.add('is-open');
  };
  const pill = (label, value, note, tone, total) => {
    if (total === 0) return null;
    const el = document.createElement('div');
    el.className = 'pill' + (tone ? ' is-' + tone : '');
    el.tabIndex = 0;
    el.title = note;
    el.dataset.label = label;
    el.dataset.note = note;
    el.setAttribute('aria-describedby', 'pill-note');
    el.innerHTML = `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
    // A click on a pill that was not open opens it, on one that was closes
    // it; the press that focuses a pill has opened it already.
    el.addEventListener('pointerdown', () => { el.dataset.was = String(openPill === el); });
    el.addEventListener('focus', () => showNote(el));
    el.addEventListener('blur', () => { if (openPill === el) showNote(null); });
    el.addEventListener('click', () => {
      if (el.classList.contains('is-link')) return;
      const was = el.dataset.was === undefined ? openPill === el : el.dataset.was === 'true';
      delete el.dataset.was;
      showNote(was ? null : el);
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openPill === el) { event.preventDefault(); showNote(null); }
      else if ((event.key === 'Enter' || event.key === ' ') && !el.classList.contains('is-link')) {
        event.preventDefault();
        showNote(openPill === el ? null : el);
      }
    });
    band.append(el);
    return el;
  };

  const read = r.services.filter((s) => s.skipped === null).length;
  const unread = r.services.filter((s) => s.skipped !== null);
  pill('Read', read + ' of ' + r.services.length,
    unread.length === 0 ? 'every repository was read and joined into one graph'
      : 'not read: ' + unread.map((s) => s.name + ' (' + s.skipped + ')').join(', '),
    read < r.services.length ? 'warn' : null, r.services.length);
  pill('Graph', r.totals.nodes.toLocaleString() + ' nodes',
    r.totals.edges.toLocaleString() + ' edges, ' + r.types.total.toLocaleString() + ' types', null, r.totals.nodes);
  pill('Service calls', r.httpOut.linked + ' / ' + r.httpOut.total + ' joined',
    r.httpOut.external + ' third party, ' + r.httpOut.dynamic + ' built at run time',
    r.httpOut.linked > 0 ? 'good' : null, r.httpOut.total);
  if (r.ui) {
    pill('Browser calls', r.ui.resolved + ' / ' + r.ui.total + ' joined',
      r.ui.unresolved + ' still unmatched', r.ui.resolved > 0 ? 'warn' : null, r.ui.total);
  }
  pill('Routes reached', r.routes.called + ' / ' + r.routes.total,
    (r.routes.total - r.routes.called) + ' nothing calls', null, r.routes.total);
  pill('Channels', r.channels.linked + ' / ' + r.channels.total + ' joined',
    r.channels.noConsumers.length + ' with no handler',
    r.channels.linked === 0 ? 'warn' : 'good', r.channels.total);
  /* The build line's three figures (P81). `missed` is absent from a report
     packed before 0.6.0, where `unresolved` meant the same thing. */
  const missedCount = r.totals.missed ?? r.totals.unresolved;
  pill('Missed', missedCount.toLocaleString(),
    'joined from files: ' + (r.totals.notes ?? 0).toLocaleString() +
    ' · findings: ' + (r.totals.findings ?? 0).toLocaleString());
  document.addEventListener('pointerdown', (event) => {
    if (openPill !== null && !event.target.closest('.pill')) showNote(null);
  });

  /* What the strip had to say in a sentence once, kept under the page. */
  document.getElementById('standfirst').textContent =
    `${read} of ${r.services.length} repositories read and joined into one graph. Pick a way in ` +
    'on the left and follow it; a rule across the walk marks every point where it leaves one ' +
    'service for another.';

  /* When it was built, then how long each service took, slowest first,
     folded: every figure one click away, none of them in the way. */
  const slowest = [...r.services].sort((a, b) => b.durationMs - a.durationMs || (a.name < b.name ? -1 : 1));
  const took = slowest.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const builtEl = document.getElementById('built');
  builtEl.innerHTML =
    '<span class="built-at">built ' + new Date(data.builtAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC</span>' +
    (slowest.length === 0 ? '' : '<details class="build-times" id="build-times"><summary>build &middot; ' +
      `${took.toLocaleString()}ms &middot; ${plural(slowest.length, 'service', 'services')}</summary>` +
      '<table><thead><tr><th>Service</th><th class="num">Took</th></tr></thead><tbody>' +
      slowest.map((s) => `<tr><td>${esc(s.name)}${s.skipped === null ? '' : ' <span class="hint">not read</span>'}</td>` +
        `<td class="num">${(s.durationMs || 0).toLocaleString()}ms</td></tr>`).join('') +
      '</tbody></table></details>') +
    '<button class="tool start-again" id="start-again" title="Three things worth opening first">Start here</button>';
  const buildTimes = document.getElementById('build-times');
  if (buildTimes) {
    document.addEventListener('pointerdown', (event) => {
      if (buildTimes.open && !event.target.closest('.build-times')) buildTimes.open = false;
    });
    buildTimes.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && buildTimes.open) { event.preventDefault(); buildTimes.open = false; }
    });
  }

  /* ── service rail, doubling as the filter ────────────────────────── */

  /* Twelve chips fit in two lines on a desktop; past that the rail would cost
     more room than it saves, so it is one button and a checklist. Either way
     it is the one `shown` set, and every change to it ends in `filtered`. */
  const RAIL_CHIPS_MAX = 12;
  const fleet = document.getElementById('fleet');
  const summaryOf = (name) => r.services.find((s) => s.name === name);
  const nodesSay = (name) => (summaryOf(name) ? summaryOf(name).nodes.toLocaleString() : '0') + ' nodes';
  const typeSay = (name) => (summaryOf(name) ? summaryOf(name).type : '');
  const filtered = () => {
    store.set('shown', shown);
    page.drawEntries();
    if (store.get('view') === 'graph') page.graph.refresh();
  };
  const flip = (name, on) => { if (on) shown.add(name); else shown.delete(name); };

  let syncRail;
  if (repos.length <= RAIL_CHIPS_MAX) {
    fleet.classList.add('is-chips');
    repos.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'ship';
      b.dataset.repo = name;
      b.style.setProperty('--hue', hueOf(i));
      b.setAttribute('aria-pressed', 'true');
      b.innerHTML = `<b>${esc(name)}</b><em>${esc(typeSay(name))}</em><span>${nodesSay(name)}</span>`;
      b.addEventListener('click', () => { flip(name, !shown.has(name)); filtered(); });
      fleet.append(b);
    });
    syncRail = () => {
      for (const b of fleet.querySelectorAll('.ship')) b.setAttribute('aria-pressed', String(shown.has(b.dataset.repo)));
    };
  } else {
    fleet.innerHTML = '<div class="svc-pick">' +
      '<button class="tool svc-button" id="svc-button" aria-haspopup="true" aria-expanded="false" aria-controls="svc-pop">' +
      '<span>Services: all</span> <span aria-hidden="true">&#9662;</span></button>' +
      '<div class="svc-pop" id="svc-pop" role="group" aria-label="Services to show" hidden>' +
      '<div class="svc-head"><input type="search" id="svc-find" placeholder="Find a service" aria-label="Find a service" ' +
      'autocomplete="off" spellcheck="false">' +
      '<button class="tool" data-svc="all" title="Show every service listed">All</button>' +
      '<button class="tool" data-svc="none" title="Hide every service listed">None</button></div>' +
      '<ul class="svc-list">' + repos.map((name, i) => `<li data-repo="${esc(name)}"><label>` +
        `<input type="checkbox" data-repo="${esc(name)}" checked>` +
        `<span class="svc-swatch" style="--hue:${hueOf(i)}" aria-hidden="true"></span>` +
        `<b>${esc(name)}</b> <em>${esc(typeSay(name))}</em> <span class="hint">${nodesSay(name)}</span></label></li>`).join('') +
      '</ul></div></div>';
    const button = document.getElementById('svc-button');
    const pop = document.getElementById('svc-pop');
    const findEl = document.getElementById('svc-find');
    const boxes = [...pop.querySelectorAll('input[type="checkbox"]')];
    const setOpen = (on) => {
      pop.hidden = !on;
      button.setAttribute('aria-expanded', String(on));
      if (on) findEl.focus();
    };
    button.addEventListener('click', () => setOpen(pop.hidden));
    findEl.addEventListener('input', () => {
      const q = findEl.value.trim().toLowerCase();
      for (const li of pop.querySelectorAll('.svc-list li')) {
        li.hidden = q !== '' && !li.dataset.repo.toLowerCase().includes(q) && !typeSay(li.dataset.repo).toLowerCase().includes(q);
      }
    });
    for (const box of boxes) box.addEventListener('change', () => { flip(box.dataset.repo, box.checked); filtered(); });
    pop.addEventListener('click', (event) => {
      const all = event.target.closest('[data-svc]');
      if (!all) return;
      // All and None take the services the search lists, so "all the workers" is two steps.
      for (const box of boxes) if (!box.closest('li').hidden) flip(box.dataset.repo, all.dataset.svc === 'all');
      filtered();
    });
    pop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.focus(); }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!pop.hidden && !event.target.closest('.svc-pick')) setOpen(false);
    });
    syncRail = () => {
      for (const box of boxes) box.checked = shown.has(box.dataset.repo);
      button.firstElementChild.textContent = 'Services: ' +
        (shown.size === repos.length ? 'all' : `${shown.size.toLocaleString()} of ${repos.length.toLocaleString()}`);
    };
  }
  // A link's filters, or a change made elsewhere, is drawn here too.
  store.on((key) => { if (key === 'shown') syncRail(); });

  /* What a trace saw, as the strip's last pill; when some of it was not
     found in code, or fits several places, the pill opens Not joined on that
     list. */
  if (seen.any) {
    const total = [...entryIx].reduce((sum, i) => sum + seen.entry(i), 0);
    const el = pill('Seen at run time', total.toLocaleString() + ' hits',
      seen.unmatched.length.toLocaleString() + ' not found in code' +
        (seen.ambiguous.length ? ', ' + seen.ambiguous.length.toLocaleString() + ' could be several places' : ''),
      seen.unmatched.length ? 'warn' : 'good', total + seen.unmatched.length + seen.ambiguous.length);
    if (el !== null && (seen.unmatched.length > 0 || seen.ambiguous.length > 0)) {
      el.classList.add('is-link');
      el.setAttribute('role', 'button');
      el.title = 'Show what was seen at run time and not found in code, or could be several places';
      const open = () => { page.showView('missing'); document.getElementById('unmatched')?.scrollIntoView({ block: 'nearest' }); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    }
  }

  /* ── Start here: three things worth opening ──────────────────────── */

  /* Each worked out from the graph in hand, never written in (P98):
       the way in that crosses the most services, ties to the one with the
       most steps, among those that leave a service at all;
       the gap with the most rows to act on, on Not joined;
       what a branch did, when the page has its changes.
     Each is a link, so it opens what it says and can be sent. Scoring the
     ways in walks each one's steps, so a project with very many is scored on
     the first START_SCORED of them that cross, each to START_ROWS steps: a
     first look, not a ranking. */
  const START_SCORED = 200;
  const START_ROWS = 150;
  const wayInSay = (i) => {
    const meta = nodes[i][MT] || {};
    return meta.m ? `${meta.m} ${meta.p || ''}`.trim() : nodes[i][LB];
  };
  const busiestWayIn = (model) => {
    const crossing = entryIx.filter((i) => reachesCrossing[i]);
    let best = null;
    for (const i of (crossing.length > 0 ? crossing : entryIx).slice(0, START_SCORED)) {
      const rows = stepsOf(model, i, { rows: START_ROWS }).rows.filter((row) => row.kind !== 'break');
      const crossings = rows.filter((row) => row.crosses && !row.again && !row.loop).length;
      if (best === null || crossings > best.crossings || (crossings === best.crossings && rows.length > best.steps)) {
        best = { i, crossings, steps: rows.length };
      }
    }
    return best === null ? null : {
      what: 'Busiest way in',
      say: wayInSay(best.i),
      note: [repoName(best.i), best.crossings > 0 ? plural(best.crossings, 'crossing', 'crossings') : '',
        plural(best.steps, 'step', 'steps')].filter(Boolean).join(' · '),
      href: formatViewHash('steps', keys.keyOf(best.i)),
    };
  };
  const worstGap = (data) => {
    const levels = data.dicts.levels || [];
    const gaps = new Set(data.unresolved.filter((u) => (u.kind || 'gap') === 'gap').map((u) => u.reason));
    const toAct = new Map();
    data.rows.forEach((row, at) => {
      if (levels[row[ROW.level]] !== 'action' || acceptedRows.has(at)) return;
      const reason = reasons[row[ROW.reason]];
      if (gaps.has(reason)) toAct.set(reason, (toAct.get(reason) || 0) + 1);
    });
    // The most rows first; between equals, the one Not joined lists first.
    const order = data.unresolved.map((u) => u.reason);
    const [reason, count] = [...toAct].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0] || [];
    return reason === undefined ? null : {
      what: 'Worst gap',
      say: reason,
      note: plural(count, 'row to act on', 'rows to act on'),
      href: formatViewHash('missing', null, { reason }),
    };
  };
  const latestChange = (data) => {
    const changes = data.changes;
    if (!changes) return null;
    const href = formatViewHash('changes');
    if (changes.stillCalled.length > 0) {
      const [first] = changes.stillCalled;
      return { what: 'Latest change', say: 'Removed but still called: ' + first.label,
        note: changes.stillCalled.length > 1 ? plural(changes.stillCalled.length, 'route', 'routes') : first.service, href };
    }
    if (changes.routes.added.length > 0) {
      const [first] = changes.routes.added;
      return { what: 'Latest change', say: 'Route added: ' + first.label, note: first.service, href };
    }
    return null;
  };
  /* Up to three `{ what, say, note, href }`, in that order; one with nothing to say is left out. */
  const startHere = (model, data) => [busiestWayIn(model), worstGap(data), latestChange(data)].filter(Boolean);

  /* The card, above the view rather than over it, until it is closed; the
     Start here button in the strip brings it back. Closing it is kept in the
     browser, where it may not be kept (a private window, a file the browser
     will not store for), and then the card simply comes again. */
  const startEl = document.getElementById('start');
  const DISMISSED = 'flowatlas.start.dismissed';
  const dismissed = () => {
    try { return localStorage.getItem(DISMISSED) === '1'; } catch { return false; }
  };
  const remember = (closed) => {
    try {
      if (closed) localStorage.setItem(DISMISSED, '1'); else localStorage.removeItem(DISMISSED);
    } catch {
      // Not kept: the card comes again on the next first visit.
    }
  };
  let picks = null;
  const startCard = {
    show() {
      picks ??= startHere(model, data);
      startEl.innerHTML = '<div class="start-head"><h3 id="start-title">Start here</h3>' +
        '<button class="g-close" data-start-close aria-label="Close Start here" title="Close">&times;</button></div>' +
        (picks.length === 0 ? '<p class="hint">Nothing stands out yet: pick a way in from the list.</p>'
          : '<ul class="start-picks">' + picks.map(({ what, say, note, href }) =>
            `<li><span class="start-what">${esc(what)}</span><a href="${esc(href)}">${esc(say)}</a>` +
            (note ? `<span class="hint">${esc(note)}</span>` : '') + '</li>').join('') + '</ul>');
      startEl.hidden = false;
    },
    hide() { startEl.hidden = true; },
    /* On a first visit - an address naming no view - unless it was closed before. */
    offer() { if (!dismissed()) startCard.show(); },
  };
  startEl.addEventListener('click', (event) => {
    if (!event.target.closest('[data-start-close]')) return;
    remember(true);
    startCard.hide();
  });
  document.getElementById('start-again').addEventListener('click', () => {
    remember(false);
    startCard.show();
    startEl.scrollIntoView({ block: 'nearest' });
  });

  return { startCard, startHere };
}
