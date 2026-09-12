import type { Unresolved } from '@flowatlas/core';

/** How one service fared during a build. */
export interface ServiceReport {
  name: string;
  repo: string;
  type: string;
  extractor: string | null;
  skipped?: 'no-extractor' | 'extract-failed';
  /** Why it was skipped, in words, when it failed. */
  error?: string;
  nodes: number;
  edges: number;
  types: number;
  unresolved: number;
  durationMs: number;
}

/**
 * What happened when the repositories were joined.
 *
 * The counts are meant to reconcile: every outgoing call is in exactly one of
 * the buckets below, so a number that does not add up is a bug rather than a
 * judgement call.
 */
export interface LinkReport {
  schemaVersion: number;
  /** ISO-8601. Ignored when comparing against a snapshot. */
  builtAt: string;
  /** Fingerprint of the configuration this was built from. */
  configHash: string;
  services: ServiceReport[];
  httpOut: {
    total: number;
    /** Joined to a route, whether by settings key or by annotation. */
    linked: number;
    /** How many of the joined ones an annotation was needed for. */
    byMarker: number;
    /** Rooted at a settings key no service claims. */
    unknownEnv: number;
    /** Service found, route not. */
    noRoute: number;
    /** More than one route could answer. */
    ambiguous: number;
    /** Addressed to a third party. */
    external: number;
    /** Address built at run time. */
    dynamic: number;
  };
  /**
   * Requests made in a browser, counted apart from the ones made between
   * services: the denominator is different and so is the fix, which is a line of
   * configuration rather than a route that was renamed.
   */
  ui: {
    total: number;
    /** Joined to the route that serves it. */
    resolved: number;
    /** Everything else; equal to `total - resolved`. */
    unresolved: number;
    /** Why, one entry per reason, summing to `unresolved`. */
    byReason: Record<string, number>;
  };
  channels: {
    total: number;
    /** Channels with at least one publisher and one handler. */
    linked: number;
    noConsumers: string[];
    noProducers: string[];
  };
  routes: {
    total: number;
    called: number;
    uncalled: string[];
    /** Routes more than one handler claims; the framework answers with one. */
    duplicated: string[];
  };
  types: {
    total: number;
    /** Types merged because they come from a package the services share. */
    sharedPackage: number;
  };
  /** Raised while joining, as opposed to while reading one repository. */
  unresolved: Unresolved[];
  totals: { nodes: number; edges: number; types: number; unresolved: number };
}
