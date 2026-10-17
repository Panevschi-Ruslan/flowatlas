import { acceptCommandForLike, acceptCommandForPlace, likeRoute, routeOfMessage } from '../steps.js';

/* One overflow menu per row (P100): a `⋯` button that opens a short list of
   what can be copied from a check row - the row as a prompt, the accept
   command for this place, and the rule for every row like it - instead of a
   row of inline buttons. The page reads and never writes: every item copies
   text, a command says it is one, and what was copied is shown in a toast.
   One menu element serves every row; the keys are the command list's
   (`menuKeys`, P101), so the arrows, Enter and Escape mean the same in both. */
export function createMenu(page) {
  const { acceptedRows, copyText, esc, rowPlace } = page;

  const menuEl = document.getElementById('row-menu');
  const listEl = document.getElementById('row-menu-list');
  const footEl = document.getElementById('row-menu-foot');
  const toastEl = document.getElementById('toast');

  /* ── what was copied, said for a moment ─────────────────────────── */

  let toastTimer = 0;
  const toast = (say, code = '') => {
    toastEl.innerHTML = `<span>${esc(say)}</span>` + (code ? `<code>${esc(code)}</code>` : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, code ? 6000 : 2400);
  };

  /* Text onto the clipboard and said in the toast; where the clipboard is
     blocked, a prompt holds the text to copy by hand, as Copy as prompt does. */
  const copyAndSay = async (text, item) => {
    if (!text) { toast('Nothing to copy from this row.'); return; }
    if (await copyText(text)) toast(item.command ? 'Copied a command; run it in the project:' : item.copied || 'Copied.', item.command ? text : '');
    else window.prompt(item.command ? 'Copy this command and run it in the project' : 'Copy this', text);
  };

  /* ── what a row's menu offers ───────────────────────────────────── */

  /* Where a row has no single place - no file, no route - its accept command
     can only name the service, and then it takes the reason across it. */
  const routeOf = (place) => (place.reason.startsWith('route-') ? routeOfMessage(place.message) : null);
  const noSinglePlace = (place) => routeOf(place) === null && !place.file;
  const placeSaid = (place) => {
    const route = routeOf(place);
    if (route !== null) return `${route.method} ${route.path}`;
    return place.file ? `${place.file} (every row of this reason in the file)` : '';
  };
  const likeSaid = (place) => {
    const route = routeOf(place);
    const at = place.file ? place.file.lastIndexOf('/') : -1;
    return (route !== null ? likeRoute(route) : at > 0 ? place.file.slice(0, at) + '/*' : '') + '; --dry-run lists what it takes';
  };

  /* Each item: what it says, when it is offered, what it copies, and whether
     that is a command for the shell (said under the items, and shown in the
     toast). A list, so a later ticket adds to it (P122's Copy for agent). */
  const ROW_MENU_ITEMS = [
    {
      id: 'prompt', say: 'Copy as prompt', copied: 'Copied as a prompt.',
      text: (r) => page.promptOf('row:' + r),
    },
    {
      id: 'accept', say: 'Copy accept command', command: true,
      when: (r) => !acceptedRows.has(r),
      sub: (r) => placeSaid(rowPlace(r)),
      warn: (r) => {
        const place = rowPlace(r);
        if (!noSinglePlace(place)) return '';
        return place.service ? `No single place: it accepts ${place.reason} across ${place.service}.`
          : `No single place or service: it accepts ${place.reason} everywhere.`;
      },
      text: (r) => acceptCommandForPlace(rowPlace(r)),
    },
    {
      id: 'accept-like', say: 'Copy accept command for every row like this', command: true,
      when: (r) => !acceptedRows.has(r) && acceptCommandForLike(rowPlace(r)) !== null,
      sub: (r) => likeSaid(rowPlace(r)),
      text: (r) => acceptCommandForLike(rowPlace(r)),
    },
  ];
  // The row as a task an agent can act on (P122): its check, how to close it, and to look again after.
  ROW_MENU_ITEMS.push({ id: 'agent', say: 'Copy for agent', copied: 'Copied as a task for an agent.', text: (r) => page.promptOf('agent:' + r) });

  /* The `⋯` button of a row, by its position in `data.rows`. */
  const rowMenu = (r, label = 'this row') =>
    `<button type="button" class="row-menu-btn" data-row-menu="${r}" aria-haspopup="menu" aria-expanded="false" ` +
    `aria-controls="row-menu" aria-label="Copy from ${esc(label)}" title="Copy from ${esc(label)}">&#8943;</button>`;

  /* ── the menu ───────────────────────────────────────────────────── */

  let offered = [];
  let active = -1;
  let from = null;

  const itemEls = () => listEl.querySelectorAll('[role="menuitem"]');
  const setActive = (n) => {
    active = n;
    const el = itemEls()[n];
    if (el) el.focus();
  };
  const closeMenu = (restore = true) => {
    if (menuEl.hidden) return;
    menuEl.hidden = true;
    listEl.replaceChildren();
    const back = from;
    from = null;
    offered = [];
    active = -1;
    if (back) {
      back.setAttribute('aria-expanded', 'false');
      if (restore && back.focus) back.focus();
    }
  };
  const run = (n) => {
    const chosen = offered[n];
    if (chosen === undefined) return;
    closeMenu();
    chosen.run();
  };

  /* A menu of `items` (`{ say, sub?, run }`) under `button`, `foot` said
     under them. Kept on the page, where a row's own box could clip it. */
  const openMenu = (button, items, foot = []) => {
    closeMenu(false);
    if (items.length === 0) return;
    from = button;
    offered = items;
    listEl.innerHTML = items.map((item, n) => `<li role="none"><button type="button" role="menuitem" tabindex="-1" data-n="${n}">` +
      `<span>${esc(item.say)}</span>${item.sub ? `<small>${esc(item.sub)}</small>` : ''}</button></li>`).join('');
    footEl.innerHTML = foot.map((line) => `<span>${esc(line)}</span>`).join('');
    footEl.hidden = foot.length === 0;
    const rect = button.getBoundingClientRect();
    menuEl.style.top = `${Math.round(rect.bottom + 4)}px`;
    menuEl.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
    menuEl.hidden = false;
    // Above the button when it would run off the bottom of the window.
    const tall = menuEl.offsetHeight;
    if (tall > 0 && rect.bottom + 4 + tall > window.innerHeight) menuEl.style.top = `${Math.max(8, Math.round(rect.top - 4 - tall))}px`;
    button.setAttribute('aria-expanded', 'true');
    setActive(0);
  };

  /* The menu of one row: the items offered for it, and what to know first. */
  const openRowMenu = (button, r) => {
    const items = ROW_MENU_ITEMS.filter((item) => !item.when || item.when(r));
    const warns = items.map((item) => (item.warn ? item.warn(r) : '')).filter(Boolean);
    const foot = [...warns, ...(items.some((item) => item.command) ? ['Copies a command; run it in the project.'] : [])];
    openMenu(button, items.map((item) => ({
      say: item.say, sub: item.sub ? item.sub(r) : '', run: () => copyAndSay(item.text(r), item),
    })), foot);
  };

  let keys = null;
  menuEl.addEventListener('keydown', (event) => {
    // While it is open the keys are its own: nothing behind it hears them.
    event.stopPropagation();
    if (keys === null) {
      keys = page.menuKeys({ count: () => offered.length, active: () => active, setActive, run, close: () => closeMenu() });
    }
    keys(event);
  });
  listEl.addEventListener('click', (event) => {
    const item = event.target.closest('[data-n]');
    if (item) run(Number(item.dataset.n));
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-row-menu]');
    if (!button) return;
    event.preventDefault();
    if (from === button) { closeMenu(); return; }
    openRowMenu(button, Number(button.dataset.rowMenu));
  });
  document.addEventListener('pointerdown', (event) => {
    if (menuEl.hidden || menuEl.contains(event.target) || (event.target.closest && event.target.closest('[data-row-menu]') === from)) return;
    closeMenu(false);
  });
  // A menu kept on the page would drift from its row on a scroll; it closes instead.
  window.addEventListener('scroll', (event) => { if (!menuEl.contains(event.target)) closeMenu(false); }, true);
  window.addEventListener('resize', () => closeMenu(false));

  return { ROW_MENU_ITEMS, closeMenu, openMenu, rowMenu, toast };
}
