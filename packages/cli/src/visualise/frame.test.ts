import { readdirSync, readFileSync } from 'node:fs';
import { CONFIDENCE_LEVELS, EDGE_TYPES } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { KNOWN_REASONS } from '../doctor/hints.js';
import {
  createKeys,
  DRAWER,
  PAGE_WORDS,
  pressed,
  SHORTCUT_PLACES,
  SHORTCUTS,
  wordFor,
  drawerWidth,
  formatHash,
  formatViewHash,
  parseHash,
  parseViewHash,
  pictureName,
  pictureScale,
  pinch,
  VIEWS,
  VIEWS_MOVED,
} from './frame.js';
import { parseMapHash } from './map.js';
import { stableKeys } from './keys.js';

const IDS = ['entry:api:http:GET:/orders', 'method:api:OrdersService.list', 'table:orders', 'channel:orders.created'];
const packed = stableKeys(IDS);
const keys = createKeys(packed, IDS.length);
const key = (i: number): string => keys.keyOf(i);

describe('keys, as the page reads them', () => {
  it('finds a node by its key and gives each node its key back', () => {
    for (let i = 0; i < IDS.length; i += 1) expect(keys.find(key(i))).toBe(i);
    expect(keys.find('zzzzzz')).toBe(-1);
  });

  it('answers nodes whose short key is shared to their longer keys, and names both by the short one', () => {
    const shared = createKeys({ width: 3, all: 'abcabcxyz', longer: { 0: 'abc4', 1: 'abc7' } }, 3);
    expect(shared.keyOf(1)).toBe('abc7');
    expect(shared.find('abc')).toBe(-1);
    expect(shared.find('abc4')).toBe(0);
    expect(shared.find('abc7')).toBe(1);
    expect(shared.find('xyz')).toBe(2);
    expect(shared.shared('abc')).toEqual([0, 1]);
    expect(shared.shared('xyz')).toEqual([]);
  });

  it('offers both nodes for a link made before a second node took its key', () => {
    const before = createKeys(stableKeys(['old'], { digest: () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6]) }), 1);
    const link = formatHash(before, 0, 2);
    const digest = (id: string): Uint8Array => Uint8Array.from([0, 1, 2, 3, 4, 5, id === 'old' ? 6 : 8]);
    const after = createKeys(stableKeys(['new', 'old'], { digest }), 2);
    expect(parseHash(link, after)).toMatchObject({ focus: null, among: [0, 1], hops: 2 });
  });

  it('names nodes by position on a page packed before keys', () => {
    const old = createKeys(undefined, 5);
    expect(old.keyOf(3)).toBe('3');
    expect(old.find('3')).toBe(3);
    expect(old.find('5')).toBe(-1);
  });
});

describe('the view in the address', () => {
  it('writes the focus and the expanded nodes by key, so the link outlives a rebuild', () => {
    expect(formatHash(keys, 2, 2)).toBe(`#graph/${key(2)}/2`);
    expect(formatHash(keys, 0, 3, [1, 3])).toBe(`#graph/${key(0)}/3/${key(1)}.${key(3)}`);
  });

  it('reads back what it writes', () => {
    expect(parseHash(formatHash(keys, 0, 3, [1, 3]), keys)).toEqual({
      focus: 0,
      key: key(0),
      byPosition: false,
      among: [],
      hops: 3,
      expanded: [1, 3],
      ask: null,
      hidden: null,
      also: [],
    });
    expect(parseHash(`#graph/${key(1)}`, keys)).toMatchObject({ focus: 1, hops: null, expanded: [] });
  });

  it('opens the same node after a rebuild that moved every position', () => {
    const rebuilt = ['aaa:new', 'aab:new', ...IDS.slice().reverse()];
    const later = createKeys(stableKeys(rebuilt), rebuilt.length);
    const link = formatHash(keys, 1, 2);
    const opened = parseHash(link, later)!;
    expect(rebuilt[opened.focus!]).toBe(IDS[1]);
  });

  it('still opens an old link that names a position, and says it did', () => {
    expect(parseHash('#graph/2/2', keys)).toEqual({
      focus: 2,
      key: '2',
      byPosition: true,
      among: [],
      hops: 2,
      expanded: [],
      ask: null,
      hidden: null,
      also: [],
    });
    expect(parseHash('#graph/3', keys)).toMatchObject({ focus: 3, hops: null, byPosition: true });
  });

  it('refuses a position past the end rather than reading it as some other node', () => {
    expect(parseHash('#graph/4/2', keys)).toMatchObject({ focus: null, byPosition: true });
  });

  it('gives back a key the page does not hold, so the page can say so', () => {
    expect(parseHash('#graph/qqqqqq/2', keys)).toMatchObject({ focus: null, key: 'qqqqqq', hops: 2 });
  });

  it('drops hops it does not offer and expanded nodes it does not have', () => {
    expect(parseHash(`#graph/${key(0)}/9`, keys)).toMatchObject({ focus: 0, hops: null });
    const hash = `#graph/${key(0)}/2/${key(1)}.nothere.${key(0)}.${key(1)}`;
    expect(parseHash(hash, keys)!.expanded).toEqual([1]);
  });

  it('carries a question on the view: impact, a path by its far end, or problems only', () => {
    const impact = formatHash(keys, 2, 2, [], { ask: { kind: 'impact' } });
    expect(impact).toBe(`#graph/${key(2)}/2//impact`);
    expect(parseHash(impact, keys)).toMatchObject({ focus: 2, expanded: [], ask: { kind: 'impact' } });

    const path = formatHash(keys, 0, 2, [], { ask: { kind: 'path', to: 2, depth: 12, directed: false } });
    expect(path).toBe(`#graph/${key(0)}/2//path.${key(2)}.12.either`);
    expect(parseHash(path, keys)!.ask).toEqual({ kind: 'path', to: 2, key: key(2), depth: 12, directed: false });
    expect(parseHash(`#graph/${key(0)}/2//path.${key(2)}.6`, keys)!.ask).toMatchObject({ to: 2, directed: true });

    expect(parseHash(formatHash(keys, 1, 1, [3], { ask: { kind: 'only' } }), keys)).toMatchObject({
      focus: 1,
      expanded: [3],
      ask: { kind: 'only' },
    });
  });

  it('says a path end the page does not hold, and drops a question it cannot read', () => {
    expect(parseHash(`#graph/${key(0)}/2//path.qqqqqq.12`, keys)!.ask).toMatchObject({ to: null, key: 'qqqqqq' });
    expect(parseHash(`#graph/${key(0)}/2//path.${key(1)}`, keys)!.ask).toBeNull();
    expect(parseHash(`#graph/${key(0)}/2//nonsense`, keys)!.ask).toBeNull();
  });

  it('carries what the filters hide by name, and nothing when nothing is hidden', () => {
    const hidden = { services: ['web app', 'api'], edgeTypes: ['calls'], confidences: ['heuristic'] };
    const link = formatHash(keys, 0, 2, [], { hidden });
    expect(link).toBe(`#graph/${key(0)}/2///s:api,s:web%20app,e:calls,t:heuristic`);
    expect(parseHash(link, keys)!.hidden).toEqual({
      services: ['api', 'web app'],
      edgeTypes: ['calls'],
      confidences: ['heuristic'],
    });
    expect(formatHash(keys, 0, 2, [], { hidden: { services: [], edgeTypes: [], confidences: [] } })).toBe(
      `#graph/${key(0)}/2`,
    );
    // A link that does not say leaves the filters as they are; one that hides
    // a name with a slash or a comma in it still reads back.
    expect(parseHash(`#graph/${key(0)}/2`, keys)!.hidden).toBeNull();
    const odd = formatHash(keys, 0, 2, [], { hidden: { services: ['a/b,c'] } });
    expect(parseHash(odd, keys)!.hidden!.services).toEqual(['a/b,c']);
  });

  it('carries whose "who else" is drawn, after everything else, and reads it back', () => {
    const link = formatHash(keys, 0, 2, [1], { also: [1, 3] });
    expect(link).toBe(`#graph/${key(0)}/2/${key(1)}///${key(1)}.${key(3)}`);
    expect(parseHash(link, keys)).toMatchObject({ focus: 0, expanded: [1], ask: null, also: [1, 3] });
    const hidden = { services: ['api'], edgeTypes: [], confidences: [] };
    const both = formatHash(keys, 0, 2, [], { ask: { kind: 'only' }, hidden, also: [2] });
    expect(both).toBe(`#graph/${key(0)}/2//only/s:api/${key(2)}`);
    expect(parseHash(both, keys)).toMatchObject({ ask: { kind: 'only' }, hidden: { services: ['api'] }, also: [2] });
    // Nothing asked for is nothing written; a key the page lacks, or the focus, is dropped.
    expect(formatHash(keys, 0, 2, [1], { also: [] })).toBe(`#graph/${key(0)}/2/${key(1)}`);
    expect(parseHash(`#graph/${key(0)}/2////qqqqqq.${key(0)}.${key(2)}`, keys)!.also).toEqual([2]);
  });

  it('opens a link made before "who else": its expanded nodes are expanded in the flow', () => {
    // The owner's link, as written by the page before expansion kept to the flow.
    const old = `#graph/${key(0)}/2/${key(1)}.${key(2)}.${key(3)}`;
    expect(parseHash(old, keys)).toMatchObject({ focus: 0, hops: 2, expanded: [1, 2, 3], hidden: null, also: [] });
    expect(parseHash(`#graph/${key(0)}/2/${key(1)}/impact/s:api`, keys)).toMatchObject({
      expanded: [1],
      ask: { kind: 'impact' },
      also: [],
    });
  });

  it('is not a graph link at all for any other address', () => {
    expect(parseHash('#walk', keys)).toBeNull();
    expect(parseHash('#graph/', keys)).toBeNull();
    expect(parseHash('#graph/Abc/2', keys)).toBeNull();
    expect(parseHash('', keys)).toBeNull();
  });
});

describe('every tab in the address (P98)', () => {
  it('round-trips every tab, with and without a way in', () => {
    for (const view of VIEWS.filter((name) => name !== 'map' && name !== 'graph')) {
      expect(formatViewHash(view)).toBe(`#${view}`);
      expect(parseViewHash(formatViewHash(view), keys)).toEqual({ view, name: view, entry: null, key: '', rest: {} });
      const link = formatViewHash(view, key(1));
      expect(link).toBe(`#${view}/${key(1)}`);
      expect(parseViewHash(link, keys)).toEqual({ view, name: view, entry: 1, key: key(1), rest: {} });
    }
  });

  it('carries where in a tab to go, after the way in or in its place', () => {
    const link = formatViewHash('missing', key(0), { reason: 'target-route-not-found' });
    expect(link).toBe(`#missing/${key(0)}/reason=target-route-not-found`);
    expect(parseViewHash(link, keys)).toMatchObject({ view: 'missing', entry: 0, rest: { reason: 'target-route-not-found' } });
    const bare = formatViewHash('missing', null, { reason: 'a reason/with odd & signs' });
    expect(bare).toBe('#missing/reason=a%20reason%2Fwith%20odd%20%26%20signs');
    expect(parseViewHash(bare, keys)).toMatchObject({ entry: null, key: '', rest: { reason: 'a reason/with odd & signs' } });
    expect(formatViewHash('steps', null, { reason: '' })).toBe('#steps');
  });

  it('names a tab the page does not have, and a way in it does not hold, rather than guessing', () => {
    expect(parseViewHash('#nowhere', keys)).toMatchObject({ view: null, name: 'nowhere' });
    expect(parseViewHash('#steps/qqqqqq', keys)).toMatchObject({ view: 'steps', entry: null, key: 'qqqqqq' });
    expect(parseViewHash('#steps/NOT-A-KEY', keys)).toMatchObject({ view: 'steps', entry: null, key: 'NOT-A-KEY' });
  });

  it('opens the Graph tab from #graph alone, and leaves #graph/… and #map… to their own grammars', () => {
    expect(parseViewHash('#graph', keys)).toMatchObject({ view: 'graph', entry: null });
    const graphLink = formatHash(keys, 0, 2);
    expect(parseViewHash(graphLink, keys)).toBeNull();
    expect(parseHash(graphLink, keys)).toMatchObject({ focus: 0 });
    for (const map of ['#map', '#map/s=service%3Aorders&m=dead']) {
      expect(parseViewHash(map, keys)).toBeNull();
      expect(parseMapHash(map)).not.toBeNull();
    }
    expect(parseViewHash('', keys)).toBeNull();
    expect(parseViewHash('#', keys)).toBeNull();
  });

  it('opens a tab that went on the tab that took it over, the way in and all (P99)', () => {
    expect(VIEWS).not.toContain('walk');
    expect(parseViewHash(`#walk/${key(1)}`, keys)).toEqual({ view: 'steps', name: 'walk', entry: 1, key: key(1), rest: {} });
    expect(parseViewHash('#walk', keys)).toMatchObject({ view: 'steps', entry: null });
    for (const moved of Object.values(VIEWS_MOVED)) expect(VIEWS).toContain(moved);
    expect(parseViewHash('#constructor', keys)).toMatchObject({ view: null, name: 'constructor' });
  });

  it('lists each tab once, map first and graph last', () => {
    expect(new Set(VIEWS).size).toBe(VIEWS.length);
    expect(VIEWS[0]).toBe('map');
    expect(VIEWS.at(-1)).toBe('graph');
  });
});

describe('two fingers', () => {
  it('pans by how far the point between them moved', () => {
    const move = pinch(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
      [
        { x: 15, y: 25 },
        { x: 35, y: 25 },
      ],
    );
    expect(move).toEqual({ dx: 5, dy: 15, at: { x: 25, y: 25 }, factor: 1 });
  });

  it('zooms by how much the spread between them grew, about where they now are', () => {
    const move = pinch(
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      [
        { x: 30, y: 50 },
        { x: 70, y: 50 },
      ],
    );
    expect(move.factor).toBe(2);
    expect(move.at).toEqual({ x: 50, y: 50 });
    expect(move.dx).toBe(0);
  });

  it('zooms nothing when both fingers started on one spot', () => {
    const spot = { x: 5, y: 5 };
    expect(pinch([spot, spot], [spot, { x: 9, y: 5 }]).factor).toBe(1);
  });
});

describe('the drawer', () => {
  it('holds a dragged width between the narrowest useful and what leaves room to draw', () => {
    expect(drawerWidth(100, 1400)).toBe(DRAWER.min);
    expect(drawerWidth(500, 1400)).toBe(500);
    expect(drawerWidth(2000, 2000)).toBe(DRAWER.max);
    expect(drawerWidth(700, 900)).toBe(900 - DRAWER.leave);
    expect(drawerWidth(700, 400)).toBe(DRAWER.min);
  });
});

describe('pictures', () => {
  it('draws twice over, and less when a canvas could not hold that', () => {
    expect(pictureScale(1000, 600)).toBe(2);
    expect(pictureScale(6000, 600)).toBeCloseTo(8192 / 6000);
    expect(pictureScale(5000, 5000)).toBeCloseTo(Math.sqrt(40e6 / 25e6));
  });

  it('names the file after the project and the focus, in characters every system keeps', () => {
    expect(pictureName('Shop map', 'GET /orders/:id', 'svg')).toBe('shop-map-get-orders-id.svg');
    expect(pictureName('', '¿?', 'png')).toBe('graph.png');
  });
});

describe('the words the page says for codes (P101)', () => {
  it('has a word for every reason the doctor knows, and none for a reason it does not', () => {
    const missing = KNOWN_REASONS.filter((reason) => !(reason in PAGE_WORDS.reason));
    // A reason added to the doctor's hints gets a word here, or is listed as a gap.
    expect(missing).toEqual([]);
    expect(Object.keys(PAGE_WORDS.reason).filter((reason) => !KNOWN_REASONS.includes(reason))).toEqual([]);
  });

  it('has a verb for every edge type and a word for every trust, each told apart from the others', () => {
    expect(Object.keys(PAGE_WORDS.edge).sort()).toEqual([...EDGE_TYPES].sort());
    expect(Object.keys(PAGE_WORDS.trust).sort()).toEqual([...CONFIDENCE_LEVELS].sort());
    for (const table of Object.values(PAGE_WORDS)) {
      const words = Object.values(table);
      expect(new Set(words).size, words.join(', ')).toBe(words.length);
      // Words, never a code: no dashes, no underscores.
      expect(words.filter((word) => /[-_]/.test(word))).toEqual([]);
    }
  });

  it('falls back to the code with its dashes as spaces', () => {
    expect(wordFor('reason', 'route-unguarded')).toBe('no guard in front');
    expect(wordFor('edge', 'http_calls')).toBe('requests');
    expect(wordFor('trust', 'heuristic')).toBe('best guess');
    expect(wordFor('reason', 'some-new_reason')).toBe('some new reason');
    expect(wordFor('reason', 'constructor')).toBe('constructor');
  });
});

describe('the keys (P101)', () => {
  it('answers a shortcut by its keys, Ctrl or ⌘ only where asked, never with Alt', () => {
    expect(pressed('find', { key: '/' })).toBe(true);
    expect(pressed('find', { key: '/', ctrlKey: true })).toBe(false);
    expect(pressed('palette', { key: 'k', metaKey: true })).toBe(true);
    expect(pressed('palette', { key: 'k', ctrlKey: true })).toBe(true);
    expect(pressed('palette', { key: 'k' })).toBe(false);
    expect(pressed('graph.full', { key: 'F' })).toBe(true);
    expect(pressed('graph.full', { key: 'f', altKey: true })).toBe(false);
    expect(() => pressed('nothing.here', { key: 'x' })).toThrow('no shortcut nothing.here');
  });

  it('lists each shortcut once, under a place the overlay has a heading for', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORTCUTS.filter((shortcut) => !(shortcut.where in SHORTCUT_PLACES))).toEqual([]);
  });

  it('is the table the handlers read: every key one answers is listed, and every key listed is answered', () => {
    const dir = new URL('./panels/', import.meta.url);
    const code = readdirSync(dir).filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(new URL(file, dir), 'utf8')).join('\n');
    const asked = new Set([...code.matchAll(/pressed\('([^']+)'/g)].map(([, id]) => id));
    expect([...asked].filter((id) => !SHORTCUTS.some((shortcut) => shortcut.id === id))).toEqual([]);
    expect(SHORTCUTS.filter((shortcut) => shortcut.keys.length > 0 && !asked.has(shortcut.id)).map((s) => s.id)).toEqual([]);
    // No handler asks a key by its name any more; every key goes through the table.
    expect(code.match(/event\.key === '(?:[a-zA-Z+?/*]|Escape|Enter)'/g)).toBeNull();
  });
});
