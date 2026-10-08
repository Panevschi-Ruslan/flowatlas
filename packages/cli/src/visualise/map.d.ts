/**
 * Types for `map.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the tests read these.
 */
import type { PackedGraph } from './pack.js';
import type { MapBox, MapLink, PackedMap } from './map-pack.js';

export declare const MAP_BOX_KINDS: readonly string[];
export declare const MAP_COLUMNS: readonly string[];
export declare const MAP_LINK_KINDS: readonly string[];
export declare const MAP_MARKS: readonly string[];
export declare const MAP_BOX: Readonly<{
  w: number;
  h: number;
  gap: number;
  column: number;
  head: number;
  pad: number;
  wrap: number;
  side: number;
}>;
export declare const MAP_OPEN_UNDER: Readonly<{ boxes: number; packages: number }>;

export interface MapCluster {
  id: string;
  column: number;
  key: string;
  kind: number;
  members: number[];
}

export interface MapModel {
  packed: PackedMap;
  boxes: MapBox[];
  links: MapLink[];
  clusters: Map<string, MapCluster>;
  byId: Map<string, number>;
  sizes: { runtime: number; packages: number };
}

export interface MapState {
  toggled?: Set<string>;
  hidden?: Set<string>;
  packages?: boolean;
  dev?: boolean;
  focus?: string | null;
}

export interface MapUnit {
  id: string;
  column: number;
  cluster: string | null;
  closed: boolean;
  box: number;
  members: number[];
  inside: number;
}

export interface MapViewLink {
  id: string;
  from: string;
  to: string;
  kind: string;
  count: number;
  links: number[];
  best: number;
  worst: number;
  dev: boolean;
}

export interface MapView {
  units: Map<string, MapUnit>;
  links: MapViewLink[];
  focus: string | null;
}

export interface MapPlaced {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  placed: Map<string, MapPlaced>;
  frames: Array<{ cluster: string } & MapPlaced>;
  columns: Array<{ name: string; x: number }>;
  width: number;
  height: number;
}

export interface MapHash {
  selected: string | null;
  link: string | null;
  focus: string | null;
  toggled: string[];
  hidden: string[];
  mark: string | null;
  packages: boolean;
  dev: boolean;
}

export declare const boxId: (box: MapBox) => string;
export declare const clusterId: (box: MapBox) => string;
export declare const createMap: (packed: PackedMap) => MapModel;
export declare const openByDefault: (map: MapModel, id: string) => boolean;
export declare const isOpen: (map: MapModel, id: string, toggled: Set<string>) => boolean;
export declare const mapView: (map: MapModel, state: MapState, confidences?: readonly string[]) => MapView;
export declare const mapLayout: (map: MapModel, view: MapView, sweeps?: number) => MapLayout;
export declare const mapCycles: (view: MapView) => { units: Set<string>; links: Set<string> };
export declare const mapMarks: (
  map: MapModel,
  view: MapView,
  mark: string,
  cycles?: { units: Set<string>; links: Set<string> } | null,
) => Map<string, number>;
export declare const serviceInside: (
  data: Pick<PackedGraph, 'nodes' | 'edges' | 'dicts'>,
  repo: string,
  limits?: { ways: number; classes: number },
) => { ways: number[]; waysLeft: number; classes: Array<{ name: string; edges: number }> };
export declare const parseMapHash: (hash: string) => MapHash | null;
export interface MapHashState {
  selected?: string | null;
  link?: string | null;
  focus?: string | null;
  toggled?: Iterable<string>;
  hidden?: Iterable<string>;
  mark?: string | null;
  packages?: boolean;
  dev?: boolean;
}

export declare const formatMapHash: (state: MapHashState) => string;
