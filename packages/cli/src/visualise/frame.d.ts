/**
 * Types for `frame.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the test reads these.
 */
import type { PackedKeys } from './keys.js';

export interface Keys {
  size: number;
  keyOf(node: number): string;
  find(key: string): number;
  shared(key: string): number[];
}

/** A question a link asks: impact on the focus, a path from it, or the drawing cut to its problems. */
export type Ask =
  | { kind: 'impact' }
  | { kind: 'only' }
  | { kind: 'path'; to: number | null; key?: string; depth: number; directed: boolean };

/** What the filters hide, by name. */
export interface HiddenNames {
  services: string[];
  edgeTypes: string[];
  confidences: string[];
}

export interface AskedView {
  focus: number | null;
  key: string;
  byPosition: boolean;
  among: number[];
  hops: number | null;
  expanded: number[];
  ask: Ask | null;
  hidden: HiddenNames | null;
  /** Nodes whose "who else uses this" is drawn, as context. */
  also: number[];
}

/** A tab the address opens, as `parseViewHash` reads it. */
export interface AskedTab {
  /** The tab, or null when the address names one the page does not have. */
  view: string | null;
  /** The name as the address wrote it. */
  name: string;
  /** The way in, by node position, or null when none is named or the key is not held. */
  entry: number | null;
  /** The way in's key as written, '' when none. */
  key: string;
  /** Where in the tab to go, by name: `reason` on Not joined. */
  rest: Record<string, string>;
}

export interface Point {
  x: number;
  y: number;
}

export declare const HOPS: readonly number[];
export declare const createKeys: (packed: PackedKeys | undefined, size: number) => Keys;
export declare const parseHash: (hash: string, keys: Keys) => AskedView | null;
export declare const formatHash: (
  keys: Keys,
  focus: number,
  hops: number,
  expanded?: readonly number[],
  more?: { ask?: Ask | null; hidden?: Partial<HiddenNames> | null; also?: readonly number[] },
) => string;
export declare const VIEWS: readonly string[];
export declare const VIEWS_MOVED: Readonly<Record<string, string>>;
export declare const parseViewHash: (hash: string, keys: Keys) => AskedTab | null;
export declare const formatViewHash: (view: string, key?: string | null, rest?: Record<string, string | null | undefined>) => string;
export declare const pinch: (
  before: readonly [Point, Point],
  after: readonly [Point, Point],
) => { dx: number; dy: number; at: Point; factor: number };
export declare const DRAWER: Readonly<{ min: number; max: number; leave: number }>;
export declare const drawerWidth: (wanted: number, room: number) => number;
export declare const pictureScale: (width: number, height: number, wanted?: number) => number;
export declare const pictureName: (project: string, label: string, ext: string) => string;

/** The words the page says for codes, by kind of code. */
export declare const PAGE_WORDS: Readonly<{
  reason: Readonly<Record<string, string>>;
  edge: Readonly<Record<string, string>>;
  trust: Readonly<Record<string, string>>;
}>;
export declare const wordFor: (kind: 'reason' | 'edge' | 'trust', code: string) => string;

/** A key the page answers, where, and what it does; `keys` empty for a gesture. */
export interface Shortcut {
  id: string;
  where: 'anywhere' | 'find' | 'graph' | 'map' | 'menu';
  keys: readonly string[];
  mod?: boolean;
  say: string;
  what: string;
}
export declare const SHORTCUTS: readonly Shortcut[];
export declare const SHORTCUT_PLACES: Readonly<Record<Shortcut['where'], string>>;
export declare const pressed: (
  id: string,
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
) => boolean;
