import { failsOf, scheduleOf } from '../steps.js';

/* The Ways in list on the left: every entry and screen action the rail and
   the filters let through, the kind select, and what picking one does on
   each tab. */
export function createWays(page) {
  const { FL, KD, LB, MT, RP, entryIx, esc, failChipsHtml, files, graphLink, hueOf, kinds, model, nodes,
    repoName, scheduleSay, seen, store, typeName } = page;
  const shown = store.get('shown');

  /* ── ways in ─────────────────────────────────────────────────────── */

  const kindSelect = document.getElementById('kind');
  for (const k of [...new Set(entryIx.map((i) => kinds[nodes[i][KD]]).filter(Boolean))].sort()) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    kindSelect.append(o);
  }

  const entrySearch = document.getElementById('search');
  const listEl = document.getElementById('entries');
  const countEl = document.getElementById('entry-count');

  const matches = () => {
    const q = entrySearch.value.trim().toLowerCase();
    const kind = kindSelect.value;
    return entryIx.filter((i) => {
      if (!shown.has(repoName(i))) return false;
      if (kind && kinds[nodes[i][KD]] !== kind) return false;
      if (!q) return true;
      return nodes[i][LB].toLowerCase().includes(q) || repoName(i).toLowerCase().includes(q);
    });
  };

  function drawEntries() {
    const found = matches();
    countEl.textContent = found.length.toLocaleString() + ' of ' + entryIx.length.toLocaleString();
    listEl.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const i of found.slice(0, 400)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'row';
      b.style.setProperty('--hue', hueOf(nodes[i][RP]));
      if (i === store.get('current')) b.setAttribute('aria-current', 'true');
      const meta = nodes[i][MT] || {};
      const name = meta.m
        ? `<span class="verb">${esc(meta.m)}</span> ${esc(meta.p || '')}`
        : esc(nodes[i][LB]);
      b.innerHTML = `<span class="row-name">${name}</span>` +
        `<span class="row-meta">${esc(repoName(i))} &middot; ${esc(kinds[nodes[i][KD]] || typeName(i))}` +
        (files[nodes[i][FL]] ? ' &middot; ' + esc(files[nodes[i][FL]].split('/').pop()) : '') +
        (seen.entry(i) ? ` &middot; <span class="row-seen" title="Hits seen at run time">seen &times;${seen.entry(i).toLocaleString()}</span>` : '') +
        (scheduleOf(model, i) ? ` &middot; <span class="sched">${esc(scheduleSay(scheduleOf(model, i)))}</span>` : '') +
        '</span>' + (failsOf(model, i).length ? `<span class="row-meta">${failChipsHtml(i)}</span>` : '');
      b.addEventListener('click', () => {
        // Another way in is a step Back returns from (P98): the address as it
        // was is kept as an entry of its own, and the tab writes the new one
        // over the copy. Moving between tabs replaces it instead.
        if (i !== store.get('current')) history.pushState(null, '', location.href);
        store.set('current', i);
        drawEntries();
        // On the graph a way in is a focus; on Steps its steps; anywhere else a walk.
        if (store.get('view') === 'graph') page.graph.go(i); else page.showView(store.get('view') === 'steps' ? 'steps' : 'walk');
      });
      li.append(b);
      li.insertAdjacentHTML('beforeend', graphLink(i));
      frag.append(li);
    }
    if (found.length > 400) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="cut" style="margin:8px 12px">${(found.length - 400).toLocaleString()} more. Narrow the filter.</div>`;
      frag.append(li);
    }
    listEl.append(frag);
  }

  return { drawEntries, entrySearch, kindSelect };
}
