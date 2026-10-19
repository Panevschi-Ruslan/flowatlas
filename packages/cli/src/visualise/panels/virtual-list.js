/* A long list drawn a window at a time (P102): only the rows in sight, and a
   few either side, are in the document; a spacer as tall as every row keeps
   the scroll bar honest. Rows have a fixed height each, given by `rowHeight`
   (a number, or a function of the row), so where any row sits is a sum, not
   a measurement. The Ways in list is the first; a long table may follow. */
export function createVirtualList() {
  /* Where each row starts, and the whole height: `starts[i]` for row i,
     `starts[count]` for the end. */
  const offsetsOf = (count, rowHeight) => {
    const starts = new Float64Array(count + 1);
    for (let i = 0; i < count; i += 1) starts[i + 1] = starts[i] + (typeof rowHeight === 'function' ? rowHeight(i) : rowHeight);
    return starts;
  };
  /* The row at `y`: the last one starting at or above it. */
  const rowAt = (starts, count, y) => {
    let low = 0, high = count;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= y) low = mid; else high = mid - 1;
    }
    return Math.min(low, Math.max(0, count - 1));
  };

  /* `el` is the scrolling list (a <ul>); `render(i)` builds row i's <li>,
     which is placed, sized and numbered here (`aria-posinset` of
     `aria-setsize`, so a screen reader still hears "12 of 2,000"). `keep()`
     names a row to draw wherever the window is - the one picked - or null.
     `fallback` is the height to assume while the list has none (before
     layout). */
  const virtualList = (el, { count, rowHeight, render, keep = () => null, overscan = 8, fallback = 560 }) => {
    let size = count;
    let starts = offsetsOf(size, rowHeight);
    let drawn = new Map();
    const spacer = document.createElement('li');
    spacer.className = 'v-size';
    spacer.setAttribute('role', 'presentation');
    spacer.setAttribute('aria-hidden', 'true');

    const place = (i) => {
      const li = render(i);
      li.classList.add('v-row');
      li.style.top = starts[i] + 'px';
      li.style.height = (starts[i + 1] - starts[i]) + 'px';
      li.setAttribute('aria-posinset', String(i + 1));
      li.setAttribute('aria-setsize', String(size));
      li.dataset.at = String(i);
      return li;
    };
    /* The rows in the window, as a range of positions. */
    const windowNow = () => {
      if (size === 0) return { from: 0, to: -1 };
      const view = el.clientHeight || fallback;
      const top = el.scrollTop || 0;
      return {
        from: Math.max(0, rowAt(starts, size, top) - overscan),
        to: Math.min(size - 1, rowAt(starts, size, top + view) + overscan),
      };
    };
    const draw = () => {
      const { from, to } = windowNow();
      const wanted = new Set();
      for (let i = from; i <= to; i += 1) wanted.add(i);
      const kept = keep();
      if (kept !== null && kept >= 0 && kept < size) wanted.add(kept);
      for (const [i, li] of drawn) {
        if (!wanted.has(i)) { li.remove(); drawn.delete(i); }
      }
      const fresh = [...wanted].filter((i) => !drawn.has(i)).sort((a, b) => a - b);
      for (const i of fresh) {
        const li = place(i);
        drawn.set(i, li);
        // In order in the document too, so Tab and a screen reader go down the list.
        const after = [...drawn.keys()].filter((j) => j > i).sort((a, b) => a - b)[0];
        el.insertBefore(li, after === undefined ? null : drawn.get(after));
      }
    };
    const reset = (next = size) => {
      size = next;
      starts = offsetsOf(size, rowHeight);
      drawn = new Map();
      spacer.style.height = starts[size] + 'px';
      el.replaceChildren(spacer);
      draw();
    };
    /* Row i brought into the window, nearest edge first, and drawn. */
    const scrollTo = (i) => {
      if (i < 0 || i >= size) return;
      const view = el.clientHeight || fallback;
      const top = el.scrollTop || 0;
      if (starts[i] < top) el.scrollTop = starts[i];
      else if (starts[i + 1] > top + view) el.scrollTop = starts[i + 1] - view;
      draw();
    };
    el.addEventListener('scroll', draw, { passive: true });
    reset(count);
    return {
      /* Every row anew, `count` of them (the same number when omitted). */
      update: reset,
      scrollTo,
      /* The <li> drawn for row i, after bringing it into the window. */
      rowEl: (i) => { if (!drawn.has(i)) scrollTo(i); return drawn.get(i) ?? null; },
      drawn: () => [...drawn.keys()].sort((a, b) => a - b),
      size: () => size,
    };
  };

  return { virtualList };
}
