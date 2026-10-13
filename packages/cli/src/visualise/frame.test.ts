import { describe, expect, it } from 'vitest';
import {
  createKeys,
  DRAWER,
  drawerWidth,
  formatHash,
  parseHash,
  pictureName,
  pictureScale,
  pinch,
} from './frame.js';
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
