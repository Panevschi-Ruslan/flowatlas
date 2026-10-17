import { findEverything } from '../graph.js';
import { formatViewHash, pressed, wordFor } from '../frame.js';

/* The one search over everything, beside the rail (P73, P101): names of
   routes, channels, tables, types, gaps, failures, classes and every node,
   grouped. `/` reaches it from anywhere; a hit goes to where it is in the tab
   that is open when that tab can show it, and otherwise opens the Graph, and
   the place it lands is marked. It is also how a path's end is picked on the
   Graph tab, and how the Ways in list is filtered. */
export function createFind(page) {
  const { entryIx, esc, keys, model, repoName, store } = page;

  /* ── one search over everything (P73, P101) ─────────────────────── */

  const findEl = document.getElementById('find');
  const findOut = document.getElementById('find-out');
  const finder = findEl.closest('.finder');
  const root = document.documentElement;
  const sayReason = (reason) => wordFor('reason', reason);
  const waysIn = new Set(entryIx);

  /* What the keys move through, in the order listed: a hit, or the last
     item, which filters the Ways in list to what was typed. */
  let options = [];
  let active = -1;
  /* Where the keyboard was before `/`, so Escape can hand it back. */
  let cameFrom = null;

  /* Picking a path's end on the Graph tab (checking.js) asks the search for
     a node: then every hit is a node to end the path on. */
  const picking = () => store.get('view') === 'graph' && page.state !== undefined && page.state.picking !== null;

  /* A hit is a link too, so it can be opened in a new tab or copied: a gap to
     its reason on Not joined, anything else to its node in the graph. */
  const hrefOf = (hit) => (hit.reason !== undefined && !picking()
    ? formatViewHash('missing', null, { reason: hit.reason })
    : '#graph/' + keys.keyOf(hit.node));
  const openable = (hit) => hit.node >= 0 || (hit.reason !== undefined && !picking());

  const hitHtml = (hit) => `<span class="find-label">${esc(hit.label)}</span>` +
    `<span class="find-sub"${hit.reason ? ` title="${esc(hit.reason)}"` : ''}>${esc(hit.sub)}</span>`;
  const optionHtml = (inner, n, cls = '') =>
    `<li role="option" id="find-hit-${n}" class="find-hit${cls}" aria-selected="false">${inner}</li>`;

  const setActive = (n) => {
    active = n;
    findOut.querySelectorAll('.find-hit').forEach((el, at) => el.setAttribute('aria-selected', String(at === n)));
    const el = n >= 0 ? document.getElementById('find-hit-' + n) : null;
    if (el === null) { findEl.removeAttribute('aria-activedescendant'); return; }
    findEl.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  };

  const closeFind = () => {
    findOut.hidden = true;
    findEl.setAttribute('aria-expanded', 'false');
    setActive(-1);
  };

  const drawFind = () => {
    const query = findEl.value.trim();
    const pickingNow = picking();
    if (query === '') { closeFind(); return; }
    const groups = findEverything(model, query, 8, sayReason);
    options = [];
    const groupHtml = (group) => {
      const items = group.hits.map((hit) => {
        if (!openable(hit)) return `<li role="presentation"><span class="find-static">${hitHtml(hit)}</span></li>`;
        options.push(hit);
        const n = options.length - 1;
        return optionHtml(`<a href="${esc(hrefOf(hit))}" data-hit="${n}" tabindex="-1">${hitHtml(hit)}</a>`, n);
      }).join('');
      return `<div role="group" aria-label="${esc(group.say)}"><h4>${esc(group.say)} &middot; ${group.total.toLocaleString()}</h4>` +
        `<ul role="presentation">${items}</ul>` +
        (group.total > group.hits.length ? `<p class="find-more">${(group.total - group.hits.length).toLocaleString()} more; type more of the name</p>` : '') +
        '</div>';
    };
    let html = pickingNow
      ? `<p class="find-picking">Choose where the path ${page.state.picking === 'from' ? 'starts' : 'ends'}; Escape stops.</p>` : '';
    html += groups.length === 0 ? '<p class="find-none">Nothing here is called that.</p>' : groups.map(groupHtml).join('');
    if (!pickingNow) {
      // The Ways in list's own filter box went (P101); this is what it did.
      options.push({ filter: query });
      html += `<ul role="presentation" class="find-tail">${optionHtml(`<button data-hit="${options.length - 1}" tabindex="-1">` +
        `Filter the Ways in list to &lsquo;${esc(query)}&rsquo;</button>`, options.length - 1, ' find-filter')}</ul>`;
    }
    findOut.innerHTML = html;
    findOut.hidden = false;
    findEl.setAttribute('aria-expanded', 'true');
    setActive(options.length > 0 ? 0 : -1);
  };

  /* ── going to what was found, and marking it (P101) ── */

  /* The place a search landed: a strong ring and an accent ground that fade
     after two seconds, scrolled to the middle of the window. */
  const FOUND_FOR = 2000;
  const markFound = (el) => {
    if (!el) return null;
    el.classList.add('is-found');
    el.scrollIntoView({ block: 'center' });
    setTimeout(() => el.classList.remove('is-found'), FOUND_FOR);
    return el;
  };
  const markNode = (v) => {
    const el = document.querySelector(`#g-world .g-node[data-node="${v}"]`);
    if (el && el.focus) el.focus({ preventScroll: true });
    return markFound(el);
  };

  /* A hit: go to it in the tab that is open when that tab can show it - a way
     in is picked on the left and opened on Steps, the Walk, the Map or the
     Graph; a node is focused on the Graph; a gap opens Not joined on its row -
     and otherwise open the Graph on it. Each is a step Back returns from. */
  function goToFound(hit) {
    for (const el of document.querySelectorAll('.is-found')) el.classList.remove('is-found');
    if (hit.filter !== undefined) {
      page.filterWays(hit.filter);
      markFound(document.getElementById('list-filter'));
      return;
    }
    if (picking() && hit.node >= 0) { page.chooseEnd(hit.node); return; }
    const view = store.get('view');
    history.pushState(null, '', location.href);
    if (hit.reason !== undefined) {
      page.showView('missing', undefined, { reason: hit.reason });
      if (markFound(page.reasonRowOf(hit.reason))) return;
      // Its rows were all accepted: the node it names, when it names one.
      if (hit.node < 0) return;
    }
    const v = hit.node;
    if (v < 0) return;
    if (waysIn.has(v)) {
      if (v !== store.get('current')) store.set('current', v);
      page.drawEntries();
      markFound(document.querySelector(`#entries [data-entry="${v}"]`));
      if (view === 'steps') {
        page.showView(view);
        markFound(document.querySelector('#s-list [data-node]'));
        return;
      }
      if (view === 'map' && markFound(page.mapController.reveal(repoName(v)))) return;
    }
    if (store.get('view') === 'graph' && hit.reason === undefined) page.graph.go(v);
    else page.showView('graph', v);
    markNode(v);
  }

  const choose = (n) => {
    const hit = options[n];
    if (hit === undefined) return;
    closeFind();
    root.classList.remove('is-finding');
    goToFound(hit);
  };

  /* `/` from anywhere but a field; Escape clears the box and hands the
     keyboard back. In full screen the box comes up over the drawing. */
  const focusFind = (text) => {
    if (document.activeElement !== findEl) cameFrom = document.activeElement;
    if (root.classList.contains('is-full')) root.classList.add('is-finding');
    if (typeof text === 'string') findEl.value = text;
    findEl.focus();
    drawFind();
  };
  const leaveFind = () => {
    if (picking()) page.stopPicking();
    findEl.value = '';
    closeFind();
    root.classList.remove('is-finding');
    const back = cameFrom;
    cameFrom = null;
    if (back && back !== document.body && back.isConnected !== false && back.focus) back.focus();
    else findEl.blur();
  };

  findEl.addEventListener('input', drawFind);
  findEl.addEventListener('focus', drawFind);
  findEl.addEventListener('keydown', (event) => {
    if (pressed('find.move', event)) {
      event.preventDefault();
      if (findOut.hidden) { drawFind(); return; }
      if (options.length === 0) return;
      setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (pressed('find.go', event)) {
      if (!findOut.hidden && active >= 0) { event.preventDefault(); choose(active); }
    } else if (pressed('find.close', event)) {
      // The search's own: the panel, the answer and full screen stay.
      event.preventDefault();
      leaveFind();
    }
  });
  findOut.addEventListener('click', (event) => {
    const item = event.target.closest('[data-hit]');
    if (!item) return;
    // A link opened elsewhere - a new tab, a new window - is the browser's.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    choose(Number(item.dataset.hit));
  });
  findOut.addEventListener('mousedown', (event) => event.preventDefault());
  finder.addEventListener('focusout', (event) => {
    if (!finder.contains(event.relatedTarget)) root.classList.remove('is-finding');
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.finder')) closeFind();
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || !pressed('find', event) || page.typing(event.target)) return;
    event.preventDefault();
    focusFind();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-find-open]')) return;
    focusFind();
  });

  return { focusFind, goToFound, markFound };
}
