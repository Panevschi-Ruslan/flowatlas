/*
 * The graph view's frame: what a link names, what two fingers mean, and what
 * size a picture of the drawing is.
 *
 * Pure functions, like graph.js beside it, written into the same module script
 * by the command and imported as they are by a test:
 *   createKeys    a node's stable key and back, from what the pack ships
 *   parseHash, formatHash   the view in the address - the focus, the hops,
 *                 what is expanded, a question asked, what the filters hide
 *                 and whose "who else" is drawn - old links included
 *   pinch         a two-finger move as a pan and a zoom
 *   drawerWidth   how wide the details panel may be dragged
 *   pictureScale, pictureName   what an export is drawn at and called
 */

/** Hops a view may ask for. More than three is most of any graph. */
export const HOPS = Object.freeze([1, 2, 3]);

/**
 * Keys by node and nodes by key, from the pack's `keys`.
 *
 * Nodes whose short key is shared answer to their longer keys only; the short
 * one they share opens neither, and `shared` names both, so a link made before
 * the second arrived can offer the two rather than pick one. A page packed
 * before keys existed names nodes by position.
 */
export const createKeys = (packed, size) => {
  if (!packed) {
    return {
      size,
      keyOf: (i) => String(i),
      find: (key) => (/^\d+$/.test(key) && Number(key) < size ? Number(key) : -1),
      shared: () => [],
    };
  }
  const { width, all, longer } = packed;
  const keyOf = (i) => longer[i] ?? all.slice(i * width, (i + 1) * width);
  const byKey = new Map();
  const byShared = new Map();
  for (let i = 0; i < size; i += 1) {
    byKey.set(keyOf(i), i);
    if (longer[i] === undefined) continue;
    const short = all.slice(i * width, (i + 1) * width);
    byShared.set(short, [...(byShared.get(short) || []), i]);
  }
  return {
    size,
    keyOf,
    find: (key) => byKey.get(key) ?? -1,
    shared: (key) => byShared.get(key) || [],
  };
};

/** What a link may hide, by name, and the letter each is written under. */
const HIDDEN = Object.freeze({ s: 'services', e: 'edgeTypes', t: 'confidences' });

/**
 * A question a link asks of the view, as written in the address: `impact` on
 * the focus, `path.<to>.<depth>` from the focus (`.either` when edges are
 * walked either way), or `only`, the drawing cut to the nodes with problems.
 * The end of a path is a key like any node; one this page does not hold comes
 * back as `to: null` with the key, so the page can say so.
 */
const readAsk = (text, keys) => {
  if (!text) return null;
  const [kind, token, depthText, way] = text.split('.');
  if (kind === 'impact' || kind === 'only') return { kind };
  if (kind !== 'path' || !token || !/^\d+$/.test(depthText || '')) return null;
  const to = keys.find(token);
  return { kind, to: to >= 0 ? to : null, key: token, depth: Number(depthText), directed: way !== 'either' };
};

const writeAsk = (keys, ask) => {
  if (!ask) return '';
  if (ask.kind === 'path') return 'path.' + keys.keyOf(ask.to) + '.' + ask.depth + (ask.directed === false ? '.either' : '');
  return ask.kind;
};

/** `s:orders-api,e:calls,t:heuristic`: what the filters hide, by name, each name escaped. */
const readHidden = (text) => {
  if (text === undefined) return null;
  const hidden = { services: [], edgeTypes: [], confidences: [] };
  for (const item of text.split(',')) {
    const found = /^([set]):(.+)$/.exec(item);
    if (found === null) continue;
    try {
      hidden[HIDDEN[found[1]]].push(decodeURIComponent(found[2]));
    } catch {
      // A name the address mangled is a filter the page cannot apply.
    }
  }
  return hidden;
};

const writeHidden = (hidden) => {
  if (!hidden) return '';
  return Object.entries(HIDDEN)
    .flatMap(([letter, field]) => [...(hidden[field] || [])].sort().map((name) => letter + ':' + encodeURIComponent(name)))
    .join(',');
};

/** `a.b.c`: nodes by key, the ones this page does not hold dropped, each once. */
const readNodes = (text, keys, focus) => [
  ...new Set((text || '').split('.').filter(Boolean).map((key) => keys.find(key)).filter((v) => v >= 0 && v !== focus)),
];

/**
 * `#graph/<node>[/<hops>[/<expanded>.<expanded>…[/<ask>[/<hidden>[/<also>.<also>…]]]]]`,
 * or null for any other address.
 *
 * A node is its key, a letter and then letters and digits. A node written as a
 * number is a position, which is what links made before keys carried: it opens
 * whatever sits there in this page, and one past the end opens nothing. A key
 * this page does not have comes back as `focus: null` with the key, and with
 * the nodes now sharing it in `among` when it is a short key two of them spell,
 * so the page can say so rather than quietly show something else. Expanded
 * nodes the page does not have are dropped. An expanded node draws more of the
 * flow, the way it looks from the focus; a link made before that, when an
 * expansion drew both ways, opens the same keys as the flow.
 *
 * `ask` is the question on the view (`readAsk`), null when there is none, and
 * `hidden` what the filters hide by name, null when the link does not say, so
 * a link without them leaves the filters as the person has them. `also` are the
 * nodes whose "who else uses this" is drawn, as context; empty when the link
 * does not say, as every link made before it does not.
 */
export const parseHash = (hash, keys) => {
  const found = /^#graph\/([a-z0-9]+)(?:\/(\d+)(?:\/([a-z0-9.]*)(?:\/([a-z0-9.]*)(?:\/([^/]*)(?:\/([a-z0-9.]*))?)?)?)?)?$/
    .exec(hash);
  if (found === null) return null;
  const [, token, hopsText, expandedText, askText, hiddenText, alsoText] = found;
  const byPosition = /^\d+$/.test(token);
  const position = byPosition ? Number(token) : keys.find(token);
  const focus = position >= 0 && position < keys.size ? position : null;
  const hops = hopsText === undefined ? null : Number(hopsText);
  return {
    focus,
    key: token,
    byPosition,
    among: focus === null && !byPosition ? keys.shared(token) : [],
    hops: HOPS.includes(hops) ? hops : null,
    expanded: readNodes(expandedText, keys, focus),
    ask: readAsk(askText, keys),
    hidden: readHidden(hiddenText),
    also: readNodes(alsoText, keys, focus),
  };
};

/**
 * The address of a view. A view with no question, nothing hidden and no "who
 * else" is written as it always was; the segments after the expanded nodes
 * appear only when they, or one after them, say something.
 */
export const formatHash = (keys, focus, hops, expanded = [], more = {}) => {
  const segments = [keys.keyOf(focus), String(hops), expanded.map(keys.keyOf).join('.'), writeAsk(keys, more.ask),
    writeHidden(more.hidden), (more.also || []).map(keys.keyOf).join('.')];
  while (segments.length > 2 && segments[segments.length - 1] === '') segments.pop();
  return '#graph/' + segments.join('/');
};

/**
 * Two fingers before and after a move, as `[{x, y}, {x, y}]` in the canvas's
 * own pixels: the point between them moves the drawing with it, and the spread
 * between them zooms about where that point now is. Fingers on one spot spread
 * nothing, and zoom nothing.
 */
export const pinch = (before, after) => {
  const middle = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const spread = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const from = middle(before);
  const to = middle(after);
  const was = spread(before);
  return {
    dx: to.x - from.x,
    dy: to.y - from.y,
    at: to,
    factor: was > 0 ? spread(after) / was : 1,
  };
};

/** The narrowest a details panel is useful at, and the least drawing it leaves. */
export const DRAWER = Object.freeze({ min: 260, max: 760, leave: 320 });

/** A width asked for by dragging, held between the narrowest and what leaves room to draw. */
export const drawerWidth = (wanted, room) =>
  Math.round(Math.max(DRAWER.min, Math.min(wanted, DRAWER.max, room - DRAWER.leave)));

/**
 * How many pixels a picture spends on one unit of the drawing: twice over for a
 * sharp screen, less when that would make a canvas larger than a browser will
 * draw on one side (eight thousand pixels is safe everywhere) or in all (forty
 * million).
 */
export const pictureScale = (width, height, wanted = 2) =>
  Math.min(wanted, 8192 / width, 8192 / height, Math.sqrt(40e6 / (width * height)));

/** `<project>-<node>.<ext>`, in letters, digits and dashes, so every system keeps it. */
export const pictureName = (project, label, ext) => {
  const part = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = [part(project), part(label).slice(0, 60)].filter(Boolean).join('-') || 'graph';
  return name + '.' + ext;
};
