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
export declare const pinch: (
  before: readonly [Point, Point],
  after: readonly [Point, Point],
) => { dx: number; dy: number; at: Point; factor: number };
export declare const DRAWER: Readonly<{ min: number; max: number; leave: number }>;
export declare const drawerWidth: (wanted: number, room: number) => number;
export declare const pictureScale: (width: number, height: number, wanted?: number) => number;
export declare const pictureName: (project: string, label: string, ext: string) => string;
