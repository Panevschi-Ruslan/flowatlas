import { findEverything } from '../graph.js';

/* The one search over everything in the masthead (P73): names of nodes, files,
   rows and types, grouped, each opening where it is. */
export function createFind(page) {
  const { esc, keys, model } = page;

  /* ── one search over everything (P73) ───────────────────────────── */

  const findEl = document.getElementById('find');
  const findOut = document.getElementById('find-out');
  const findHitHtml = ({ label, sub, node }) => {
    const inner = `<span class="find-label">${esc(label)}</span><span class="find-sub">${esc(sub)}</span>`;
    return node >= 0 ? `<li><a href="#graph/${keys.keyOf(node)}">${inner}</a></li>` : `<li><span class="find-static">${inner}</span></li>`;
  };
  const drawFind = () => {
    const query = findEl.value;
    if (query.trim() === '') { findOut.hidden = true; return; }
    const groups = findEverything(model, query);
    findOut.innerHTML = groups.length === 0 ? '<p class="find-none">Nothing here is called that.</p>'
      : groups.map((group) => `<h4>${esc(group.say)} &middot; ${group.total.toLocaleString()}</h4><ul>` +
        group.hits.map(findHitHtml).join('') + '</ul>' +
        (group.total > group.hits.length ? `<p class="find-more">${(group.total - group.hits.length).toLocaleString()} more; type more of the name</p>` : '')).join('');
    findOut.hidden = false;
  };
  findEl.addEventListener('input', drawFind);
  findEl.addEventListener('focus', drawFind);
  findEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { findEl.value = ''; findOut.hidden = true; }
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      const first = findOut.querySelector('a');
      if (first) { event.preventDefault(); if (event.key === 'Enter') first.click(); else first.focus(); }
    }
  });
  findOut.addEventListener('keydown', (event) => {
    const links = [...findOut.querySelectorAll('a')];
    const at = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && at < links.length - 1) { event.preventDefault(); links[at + 1].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (at > 0 ? links[at - 1] : findEl).focus(); }
    if (event.key === 'Escape') { findOut.hidden = true; findEl.focus(); }
  });
  findOut.addEventListener('click', (event) => { if (event.target.closest('a')) findOut.hidden = true; });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.finder')) findOut.hidden = true;
  });

  return {};
}
