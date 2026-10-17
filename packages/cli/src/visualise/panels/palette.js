import { SHORTCUTS, SHORTCUT_PLACES, VIEWS, pressed } from '../frame.js';

/* What a person can do, findable from the keyboard (P101): the command list
   (⌘K or Ctrl+K) - every tab, every action of the tab open, and a search for
   whatever was typed - and the list of every key (`?`). Both are dialogs that
   keep the keyboard while open and hand it back when closed. */
export function createPalette(page) {
  const { LB, MT, esc, focusFind, nodes, repoName, state, store, typing } = page;

  /* ── a list moved through with the keys (P101) ──────────────────── */

  /* The keys of a list of commands, for the command list here and for any
     menu after it (P100's row menu): the arrows move, Enter runs, Escape
     closes, and Tab stays inside. `list` says how many there are and which is
     active, and does the rest. True when the key was the list's. */
  const menuKeys = (list) => (event) => {
    const count = list.count();
    if (pressed('menu.move', event)) {
      event.preventDefault();
      if (count > 0) list.setActive((list.active() + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      return true;
    }
    if (pressed('menu.run', event)) {
      event.preventDefault();
      if (list.active() >= 0) list.run(list.active());
      return true;
    }
    if (pressed('menu.close', event)) {
      event.preventDefault();
      list.close();
      return true;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      return true;
    }
    return false;
  };

  /* ── the command list ───────────────────────────────────────────── */

  const paletteEl = document.getElementById('palette');
  const input = document.getElementById('palette-input');
  const listEl = document.getElementById('palette-list');
  const view = () => store.get('view');
  const onDrawing = () => view() === 'graph' || view() === 'map';
  const press = (id) => document.getElementById(id).click();
  const tabOf = (name) => document.querySelector(`.tab[data-view="${name}"]`);
  /* The button each tab copies its link with. */
  const LINK_BUTTONS = { graph: 'g-copy', map: 'm-copy', walk: 'w-link', steps: 's-link' };
  const wayInSaid = () => {
    const i = store.get('current');
    const meta = nodes[i][MT] || {};
    return (meta.m ? `${meta.m} ${meta.p || ''}`.trim() : nodes[i][LB]) + ` (${repoName(i)})`;
  };

  /* Every command: what it says, when it is offered, and what it does. A
     list, so a later ticket adds to it (P102's theme). */
  const PALETTE_ACTIONS = [
    ...VIEWS.map((name) => ({
      id: 'go:' + name,
      say: () => 'Go to ' + tabOf(name).textContent.trim(),
      when: () => tabOf(name) !== null && !tabOf(name).hidden && view() !== name,
      run: () => page.showView(name),
    })),
    { id: 'full', say: 'Full screen', when: onDrawing, run: () => press(view() === 'graph' ? 'g-full' : 'm-full') },
    { id: 'types', say: () => (state.types ? 'Types off' : 'Types on'), when: () => view() === 'graph', run: () => press('g-types') },
    { id: 'svg', say: 'Export as SVG', when: onDrawing, run: () => press(view() === 'graph' ? 'g-svg-out' : 'm-svg-out') },
    { id: 'png', say: 'Export as PNG', when: onDrawing, run: () => press(view() === 'graph' ? 'g-png-out' : 'm-png-out') },
    { id: 'link', say: 'Copy a link to this view', run: () => press(LINK_BUTTONS[view()] || 't-link') },
    {
      id: 'prompt', say: () => 'Copy as prompt: ' + wayInSaid(),
      when: () => store.get('current') !== null, run: () => press('s-copy'),
    },
    { id: 'problems', say: 'Show the problems', when: () => view() === 'graph', run: () => press('g-problems') },
    { id: 'filters', say: 'Open the filters', when: () => view() === 'graph', run: () => press('g-filters-btn') },
    { id: 'keys', say: 'Show every key', run: () => openKeys() },
  ];

  let offered = [];
  let active = -1;
  let paletteFrom = null;

  const setActive = (n) => {
    active = n;
    listEl.querySelectorAll('[role="option"]').forEach((el, at) => el.setAttribute('aria-selected', String(at === n)));
    const el = n >= 0 ? document.getElementById('palette-opt-' + n) : null;
    if (el === null) { input.removeAttribute('aria-activedescendant'); return; }
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  };

  /* What is offered for what was typed: every command whose words hold every
     word typed, then a search for the text itself. */
  const drawPalette = () => {
    const text = input.value.trim();
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    offered = PALETTE_ACTIONS
      .filter((action) => !action.when || action.when())
      .map((action) => ({ action, say: typeof action.say === 'function' ? action.say() : action.say }))
      .filter(({ say }) => words.every((word) => say.toLowerCase().includes(word)));
    if (text !== '') offered.push({ action: { id: 'search', run: () => focusFind(text) }, say: `Search for ‘${text}’` });
    listEl.innerHTML = offered.length === 0 ? '<li class="palette-none" role="presentation">Nothing to do with that.</li>'
      : offered.map(({ action, say }, n) => `<li role="option" id="palette-opt-${n}" data-n="${n}" ` +
        `data-action="${esc(action.id)}" aria-selected="false">${esc(say)}</li>`).join('');
    setActive(offered.length > 0 ? 0 : -1);
  };

  const closePalette = (restore = true) => {
    if (paletteEl.hidden) return;
    paletteEl.hidden = true;
    const back = paletteFrom;
    paletteFrom = null;
    if (restore && back && back.focus) back.focus();
  };
  const runOffered = (n) => {
    const chosen = offered[n];
    if (chosen === undefined) return;
    // Back where the keyboard was first, so a command that moves it - a search, a tab - has the last word.
    closePalette();
    chosen.action.run();
  };
  const openPalette = () => {
    if (!keysEl.hidden) closeKeys(false);
    paletteFrom = document.activeElement;
    input.value = '';
    paletteEl.hidden = false;
    drawPalette();
    input.focus();
  };

  const paletteKeys = menuKeys({
    count: () => offered.length, active: () => active, setActive, run: runOffered, close: () => closePalette(),
  });
  input.addEventListener('input', drawPalette);
  paletteEl.addEventListener('keydown', (event) => {
    // While it is open the keys are its own: nothing behind it hears them.
    event.stopPropagation();
    if (pressed('palette', event)) { event.preventDefault(); closePalette(); return; }
    paletteKeys(event);
  });
  listEl.addEventListener('click', (event) => {
    const option = event.target.closest('[data-n]');
    if (option) runOffered(Number(option.dataset.n));
  });
  listEl.addEventListener('mousedown', (event) => event.preventDefault());
  paletteEl.addEventListener('pointerdown', (event) => { if (event.target === paletteEl) closePalette(); });

  /* ── every key, by where it works ───────────────────────────────── */

  /* Drawn from SHORTCUTS, the table the handlers read, so a key that exists
     is a key listed here. */
  const keysEl = document.getElementById('keys-help');
  const keysBox = keysEl.querySelector('.keys-box');
  document.getElementById('keys-list').innerHTML = Object.entries(SHORTCUT_PLACES).map(([where, title]) =>
    `<section><h4>${esc(title)}</h4><dl>` + SHORTCUTS.filter((shortcut) => shortcut.where === where)
      .map((shortcut) => `<div class="keys-row" data-shortcut="${esc(shortcut.id)}"><dt><kbd>${esc(shortcut.say)}</kbd></dt>` +
        `<dd>${esc(shortcut.what)}</dd></div>`).join('') + '</dl></section>').join('');
  let keysFrom = null;
  const closeKeys = (restore = true) => {
    if (keysEl.hidden) return;
    keysEl.hidden = true;
    const back = keysFrom;
    keysFrom = null;
    if (restore && back && back.focus) back.focus();
  };
  const openKeys = () => {
    if (!paletteEl.hidden) closePalette(false);
    keysFrom = document.activeElement;
    keysEl.hidden = false;
    keysBox.focus();
  };
  keysEl.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (pressed('menu.close', event) || pressed('help', event)) { event.preventDefault(); closeKeys(); }
    else if (pressed('palette', event)) { event.preventDefault(); openPalette(); }
    else if (event.key === 'Tab') event.preventDefault();
  });
  keysEl.addEventListener('click', (event) => {
    if (event.target === keysEl || event.target.closest('[data-keys-close]')) closeKeys();
  });

  /* Anywhere on the page: ⌘K opens the commands, even from a field, since it
     types nothing; `?` the keys, from anywhere but a field. */
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (pressed('palette', event)) { event.preventDefault(); openPalette(); }
    else if (pressed('help', event) && !typing(event.target)) { event.preventDefault(); openKeys(); }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-keys-open]')) openKeys();
    else if (event.target.closest('[data-palette-open]')) openPalette();
  });

  return { PALETTE_ACTIONS, closePalette, menuKeys, openKeys, openPalette };
}
