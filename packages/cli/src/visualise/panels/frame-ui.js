import { openAll, typeScriptOf } from '../graph.js';
import { DRAWER, drawerWidth, pictureName, pictureScale, pressed } from '../frame.js';

/* The frame around the drawing: the Types line, opening types in the panel,
   the notice a link leaves, full screen, the drawer, pictures, Copy link and
   the frame's keys. */
export function createFrameUi(page) {
  const { BOX, BOX_HEIGHTS, LB, RP, SVG_NS, at, camera, closeDetails, closePopovers, copyText,
    dismissAnswer, draw, drawDetails, extentOf, flash, hashNow, hueOf, model, nodes, panel, pinLaneNames,
    plural, sizeMinimap, stage, state, stopPicking, store, svg, svgEl, world, wrap, writeHash,
    zoomDrawn } = page;

  /* ── the frame: full screen, the drawer, pictures, links ─────────── */

  /* What a person set for themselves - the panel's width, whether it is
     folded - kept in this browser only. The page is whole without it: a
     private window, or storage switched off, just starts from the defaults. */
  const remembered = {
    read(key, fallback) {
      try {
        const value = localStorage.getItem('flowatlas.graph.' + key);
        return value === null ? fallback : JSON.parse(value);
      } catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem('flowatlas.graph.' + key, JSON.stringify(value)); } catch { /* kept for this visit only */ }
    },
  };

  /* Types: a line under every node of what it takes and gives back. A way of
     reading, not a view, so it is remembered like the panel's width and not
     put in the link; a link opened elsewhere draws the same nodes either way. */
  const typesBtn = document.getElementById('g-types');
  const setTypes = (on) => {
    state.types = on;
    Object.assign(BOX, on ? BOX_HEIGHTS.typed : BOX_HEIGHTS.plain);
    typesBtn.setAttribute('aria-pressed', String(on));
    remembered.write('types', on);
    if (state.focus !== null) draw(false);
  };
  typesBtn.addEventListener('click', () => setTypes(!state.types));
  if (remembered.read('types', false) === true) {
    state.types = true;
    Object.assign(BOX, BOX_HEIGHTS.typed);
    typesBtn.setAttribute('aria-pressed', 'true');
  }

  /* A type in the details panel opens underneath its row, and closing it
     closes whatever was opened inside it. The button keeps the keyboard. */
  /* The keyboard stays on what it was on after the panel is drawn again;
     a control that went with the drawing - a note that is all opened now -
     hands it to the section's own *Expand all*. */
  const refocus = (selector) => {
    const again = panel.querySelector(selector) || panel.querySelector('button[data-types="all"]');
    if (again) again.focus();
  };
  const toggleType = (key) => {
    if (state.openTypes.has(key)) {
      for (const open of [...state.openTypes]) if (open === key || open.startsWith(key + '.')) state.openTypes.delete(open);
      for (const asked of [...state.typeMore.keys()]) if (asked.startsWith(key + '.')) state.typeMore.delete(asked);
    } else state.openTypes.add(key);
    const [at, type] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)];
    drawDetails();
    refocus(`button.g-type[data-at="${CSS.escape(at)}"][data-type="${type}"]`);
  };

  /* "Expand all": everything under some rows opened at once, within the
     bounds. What the bounds left closed is said under where it was asked,
     and asking there again opens the next stretch, since what is open is
     walked through and not counted again. */
  const openEverything = (roots, asked, focus) => {
    const { keys, left } = openAll(model, roots, state.openTypes);
    for (const key of keys) state.openTypes.add(key);
    if (left > 0) state.typeMore.set(asked, { roots, left });
    else state.typeMore.delete(asked);
    drawDetails();
    refocus(focus);
  };

  /* Copy as TypeScript: the node's face with every type opened inline. */
  const copyTypes = async (v, button) => {
    const written = typeScriptOf(model, v);
    if (written === null) return;
    const copied = await copyText(written.text);
    const cut = written.left > 0 ? ` · ${plural(written.left, 'type', 'types')} kept as names` : '';
    flash(button, copied ? 'Copied' + cut : 'Could not copy', copied);
  };

  /* What a link asked for and could not be given, said over the drawing
     until the view moves on or it is dismissed. */
  const noticeEl = document.getElementById('g-notice');
  let noticeAt = null;
  const notice = {
    say(html) {
      noticeEl.innerHTML = `<span>${html}</span>` +
        '<button class="g-close" aria-label="Dismiss" title="Dismiss">&times;</button>';
      noticeEl.hidden = false;
      noticeAt = hashNow();
    },
    clear() {
      noticeEl.hidden = true;
      noticeEl.replaceChildren();
      noticeAt = null;
    },
    /* Called whenever the address changes: a notice is about the view it
       was said over, not the next one. */
    moved() { if (noticeAt !== null && hashNow() !== noticeAt) notice.clear(); },
  };
  noticeEl.addEventListener('click', (event) => { if (event.target.closest('button')) notice.clear(); });

  /* What a link had expanded, and whose "who else" it drew, on top of its
     focus. */
  const reopen = (expanded, also) => {
    state.expanded = [...expanded];
    state.also = [...also];
    draw(true);
    writeHash();
  };

  /* Full screen is the page's, not the browser's: the browser's own takes
     Escape for itself, and Escape here closes the panel first. */
  const root = document.documentElement;
  const fullBtn = document.getElementById('g-full');
  const fullScreen = (() => {
    let on = false;
    const set = (next) => {
      if (next === on) return;
      on = next;
      root.classList.toggle('is-full', on);
      fullBtn.setAttribute('aria-pressed', String(on));
      fullBtn.title = on ? 'Leave full screen (Escape)' : 'Full screen (F)';
      fullBtn.querySelector('span').textContent = on ? 'Leave full screen' : 'Full screen';
      fullBtn.querySelector('kbd').textContent = on ? 'Esc' : 'F';
      if (state.placed !== null && store.get('view') === 'graph') camera.frame(state.placed, at(state.focus), false);
    };
    return { set, toggle: () => set(!on), isOn: () => on };
  })();
  fullBtn.addEventListener('click', () => fullScreen.toggle());

  /* The drawer: drag its edge to widen it, fold it to a rail. */
  const grip = document.getElementById('g-grip');
  const foldBtn = document.getElementById('g-fold');
  const rail = document.getElementById('g-rail');
  const railName = document.getElementById('g-rail-name');
  const drawer = (() => {
    let width = Number(remembered.read('width', 330)) || 330;
    let folded = remembered.read('folded', false) === true;
    const room = () => stage.clientWidth || window.innerWidth;
    const apply = () => {
      stage.style.setProperty('--drawer-w', width + 'px');
      stage.classList.toggle('is-folded', folded);
      const say = folded ? 'Unfold the details panel' : 'Fold the details panel';
      foldBtn.setAttribute('aria-expanded', String(!folded));
      foldBtn.setAttribute('aria-label', say);
      foldBtn.title = say;
      rail.setAttribute('aria-expanded', String(!folded));
      grip.setAttribute('aria-valuemin', String(DRAWER.min));
      grip.setAttribute('aria-valuemax', String(drawerWidth(Infinity, room())));
      grip.setAttribute('aria-valuenow', String(width));
    };
    const resize = (wanted) => {
      width = drawerWidth(wanted, room());
      apply();
      remembered.write('width', width);
    };
    const fold = (next) => {
      folded = next;
      apply();
      remembered.write('folded', folded);
    };
    /* The rail names what is open, so a folded panel still says what it holds. */
    const name = () => {
      const v = state.open;
      railName.textContent = v === null ? '' : nodes[v][LB];
      rail.style.setProperty('--hue', v === null ? 'var(--rule)' : hueOf(nodes[v][RP]));
      rail.setAttribute('aria-label', v === null ? 'Unfold the details panel'
        : `Unfold the details of ${nodes[v][LB]}`);
    };
    new MutationObserver(name).observe(panel, { childList: true });
    width = drawerWidth(width, window.innerWidth);
    apply();
    return { resize, fold, width: () => width, folded: () => folded };
  })();

  foldBtn.addEventListener('click', () => drawer.fold(!drawer.folded()));
  rail.addEventListener('click', () => { drawer.fold(false); foldBtn.focus(); });

  let gripFrom = null;
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    gripFrom = { x: event.clientX, width: drawer.width() };
    grip.setPointerCapture(event.pointerId);
    grip.classList.add('is-dragging');
  });
  grip.addEventListener('pointermove', (event) => {
    // The drawer is on the right, so dragging its edge left widens it.
    if (gripFrom !== null) drawer.resize(gripFrom.width + gripFrom.x - event.clientX);
  });
  const letGrip = () => { gripFrom = null; grip.classList.remove('is-dragging'); };
  grip.addEventListener('pointerup', letGrip);
  grip.addEventListener('pointercancel', letGrip);
  const GRIP_KEYS = {
    ArrowLeft: (w) => w + 24,
    ArrowRight: (w) => w - 24,
    Home: () => DRAWER.min,
    End: () => Infinity,
  };
  grip.addEventListener('keydown', (event) => {
    if (pressed('graph.drawer', event)) {
      event.preventDefault();
      drawer.resize(GRIP_KEYS[event.key](drawer.width()));
    } else if (pressed('graph.fold', event)) {
      event.preventDefault();
      drawer.fold(true);
      rail.focus();
    }
  });

  /* A canvas that changes size - full screen, a wider or folded panel, a
     turned phone - keeps what was in its middle in its middle. */
  new ResizeObserver(() => {
    camera.resized();
    if (state.placed !== null) sizeMinimap(extentOf(state.placed));
  }).observe(wrap);

  /* A picture of the drawing as it stands, at its own size rather than the
     window's: every style the page gives it written onto the element, since
     the file will not have the page's stylesheet, and anything the page hides
     left out. A part of the drawing that is not part of the picture says so
     with `data-export="skip"`.

     A picture is taken at full detail whatever the zoom: zoomed out, the
     screen shows shapes without names, but a picture is read at its own
     size, so its names, counts and badges are drawn, and each service's name
     sits at the left of its band rather than wherever the camera left it. */
  const atFullDetail = (take) => {
    const was = zoomDrawn() || 'near';
    if (was !== 'near') {
      svg.classList.remove('z-' + was);
      svg.classList.add('z-near');
    }
    const laneSize = svg.style.getPropertyValue('--lane-size');
    svg.style.setProperty('--lane-size', '12.5px');
    for (const name of world.querySelectorAll('.g-lane text')) name.setAttribute('x', '12');
    try {
      return take();
    } finally {
      if (was !== 'near') {
        svg.classList.remove('z-near');
        svg.classList.add('z-' + was);
      }
      svg.style.setProperty('--lane-size', laneSize);
      pinLaneNames(camera.view());
    }
  };
  const PICTURE_STYLES = ['display', 'visibility', 'opacity', 'fill', 'fill-opacity', 'stroke',
    'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
    'paint-order', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'text-transform', 'text-anchor', 'dominant-baseline'];
  const PICTURE_PAD = 24;
  const picture = () => atFullDetail(() => {
    const box = world.getBBox();
    const width = Math.ceil(box.width + PICTURE_PAD * 2);
    const height = Math.ceil(box.height + PICTURE_PAD * 2);
    const copy = svg.cloneNode(true);
    const from = [...svg.querySelectorAll('*')];
    const to = [...copy.querySelectorAll('*')];
    const dropped = [];
    from.forEach((el, n) => {
      const out = to[n];
      const style = getComputedStyle(el);
      if (el.closest('[data-export="skip"]') || style.display === 'none' || style.visibility === 'hidden') {
        dropped.push(out);
        return;
      }
      out.setAttribute('style', PICTURE_STYLES.map((name) => `${name}:${style.getPropertyValue(name)}`).join(';'));
      for (const attr of [...out.attributes]) {
        if (/^(class|tabindex|role|aria-|data-)/.test(attr.name)) out.removeAttribute(attr.name);
      }
    });
    for (const el of dropped) el.remove();
    for (const attr of [...copy.attributes]) copy.removeAttribute(attr.name);
    copy.setAttribute('xmlns', SVG_NS);
    copy.setAttribute('width', String(width));
    copy.setAttribute('height', String(height));
    copy.setAttribute('viewBox', `0 0 ${width} ${height}`);
    copy.querySelector('#g-world').setAttribute('transform', `translate(${PICTURE_PAD - box.x} ${PICTURE_PAD - box.y})`);
    const ground = getComputedStyle(wrap).backgroundColor;
    copy.prepend(
      svgEl('title', {}, `${document.title}: around ${nodes[state.focus][LB]}`),
      svgEl('rect', { width, height, fill: ground }),
    );
    const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
    return { text, width, height };
  });

  const save = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const pictureFile = (ext) => pictureName(document.title, nodes[state.focus][LB], ext);

  const svgOut = document.getElementById('g-svg-out');
  const pngOut = document.getElementById('g-png-out');
  svgOut.addEventListener('click', () => {
    const shot = picture();
    save(new Blob([shot.text], { type: 'image/svg+xml' }), pictureFile('svg'));
    flash(svgOut, 'Saved');
  });
  /* PNG: the same SVG drawn onto a canvas, in the page, offline. */
  pngOut.addEventListener('click', async () => {
    try {
      const shot = picture();
      const scale = pictureScale(shot.width, shot.height, Math.max(2, window.devicePixelRatio || 1));
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shot.text);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(shot.width * scale);
      canvas.height = Math.round(shot.height * scale);
      const context = canvas.getContext('2d');
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, shot.width, shot.height);
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
      if (blob === null) throw new Error('the browser would not encode the picture');
      save(blob, pictureFile('png'));
      flash(pngOut, 'Saved');
    } catch (error) {
      pngOut.title = 'Could not save the picture: ' + (error && error.message ? error.message : error);
      flash(pngOut, 'Failed', false);
    }
  });

  /* Copy link: this view's address, which names nodes by key and so opens the
     same view in this file after the graph is rebuilt. */
  const copyBtn = document.getElementById('g-copy');
  copyBtn.addEventListener('click', async () => {
    const link = location.href.split('#')[0] + hashNow();
    if (await copyText(link)) flash(copyBtn, 'Copied');
    else window.prompt('Copy this link', link);
  });

  /* Keys for the frame, as SHORTCUTS (frame.js) lists them. `F` is full
     screen and `T` the Types line anywhere but a text field; `W`, `O`, `+`,
     Enter and the arrows belong to a node with the keyboard on it, and `E` to
     a type in the details panel.

     Escape closes one thing at a time, the nearest first:
       1. the Filters or Check popover, or picking a path's end;
       2. the details panel, which is the drawer in full screen;
       3. the problems list, a half-chosen path, then a path or impact
          answer, back to the neighbourhood;
       4. full screen.
     The search, a node and the panel close what is theirs and say so with
     preventDefault; whatever is left comes here. */
  const typing = (el) => el instanceof HTMLElement &&
    (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  document.addEventListener('keydown', (event) => {
    if (store.get('view') !== 'graph' || event.defaultPrevented) return;
    if (pressed('graph.full', event) && !typing(event.target)) {
      event.preventDefault();
      fullScreen.toggle();
    } else if (pressed('graph.types', event) && !typing(event.target)) {
      event.preventDefault();
      setTypes(!state.types);
    } else if (pressed('graph.close', event)) {
      if (closePopovers()) { /* closed */ }
      else if (state.picking !== null) stopPicking();
      else if (state.open !== null) closeDetails();
      else if (dismissAnswer()) { /* closed */ }
      else if (fullScreen.isOn()) fullScreen.set(false);
      else return;
      event.preventDefault();
    }
  });

  return { PICTURE_PAD, PICTURE_STYLES, copyTypes, fullScreen, notice, openEverything, refocus, reopen, root,
    save, toggleType, typing };
}
