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
  /**
   * What the service's manifest says it is built from: the name it is
   * published under, and the packages it depends on, at run time and for
   * development only. Absent for a service with no `package.json` - one
   * declared by a document, or a repository of nothing but Terraform.
   */
  packages?: ServicePackages;
}

/** A manifest's own name and the names of what it depends on, each list sorted. */
export interface ServicePackages {
  name?: string;
  /** `dependencies`, `peerDependencies` and `optionalDependencies`. */
  runtime: string[];
  /** `devDependencies` not already needed at run time. */
  dev: string[];
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
    /**
     * Uncalled routes a request could still reach, by route id, with the
     * requests (P91): each one's address was read in part and what was read
     * matches the route. Never an edge. Absent when there are none, and from
     * a report written before 0.6.0.
     */
    nearMissed?: Record<string, string[]>;
  };
  types: {
    total: number;
    /** Types merged because they come from a package the services share. */
    sharedPackage: number;
  };
  /**
   * Rows raised while joining, as opposed to while reading one repository: a
   * subset of the project's `unresolved`, every kind included.
   */
  unresolved: Unresolved[];
  totals: LinkTotals;
}

/**
 * The project in figures, counted by `countsOf` (core, P81).
 *
 * `missed`, `notes` and `findings` are rows of the whole project's list, by
 * kind; `sites` is the places the missed rows stand for. A report written
 * before 0.6.0 carries only `unresolved`, so a reader of a stored report asks
 * `missedOf(totals)` rather than reading `missed` itself.
 */
export interface LinkTotals {
  nodes: number;
  edges: number;
  types: number;
  /** Gap rows that say something was not read. */
  missed: number;
  /** Places the missed rows stand for, folding included. */
  sites: number;
  /** Rows saying how a join or a reading was made, with nothing missed. */
  notes: number;
  /** Rows saying something about the code itself. */
  findings: number;
  /**
   * Equal to `missed`.
   *
   * @deprecated since 0.6.0: read `missed`. Written for one more version so a
   * page or a script reading a stored report keeps working.
   */
  unresolved: number;
}

/**
 * What was missed, from a report however old.
 *
 * A database built by 0.5.x holds totals with `unresolved` alone, which then
 * meant every row not at level `nothing`; it is the nearest figure there is.
 */
export const missedOf = (totals: { missed?: number; unresolved?: number }): number =>
  totals.missed ?? totals.unresolved ?? 0;
