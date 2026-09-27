/**
 * Which applications one service creates, and which of them serves what.
 *
 * A service is not always one application. A worker beside an API, a nested
 * application inside a monorepo, a maintenance process mounting a controller the
 * API also mounts: each is created separately, each has its own address space,
 * and until R119 the graph had no room for the distinction — the second claim on
 * `/health` landed on the first's id and the file that declared it contributed
 * nothing.
 *
 * Carried as plain data on {@link ExtractContext.meta} rather than as a type an
 * entry adapter would import from the reader that filled it. The reader knows
 * what creates an application in the framework it reads; an adapter minting ids
 * needs only the answer, and this is the whole of the answer.
 */

import type { ExtractContext } from './context.js';

/** Which applications a service creates, and which of them mount what. */
export interface ApplicationMap {
  /** Every application read, by name, ascending. Empty when none was read. */
  names: readonly string[];
  /**
   * What an application is looked up by, to the applications that mount it,
   * ascending — a declaration's symbol id, or an application's own name where
   * the reader's applications are directories rather than declarations.
   *
   * More than one is ordinary and is not a mistake: a controller mounted in the
   * API and again in a worker really does answer at both, and each of those is
   * an address of its own.
   */
  of: Readonly<Record<string, readonly string[]>>;
  /**
   * How an application here is looked up. See {@link ApplicationKeys}.
   *
   * Optional, and absent reads as `declaration`: the map a reader of modules
   * writes is the one this file was written for, and it says nothing new.
   */
  keyedBy?: ApplicationKeys;
}

/** The map an extractor left on the context, when it left one. */
export const applicationsIn = (
  meta: Record<string, unknown> | undefined,
): ApplicationMap | undefined => {
  const value = meta?.['applications'];
  if (typeof value !== 'object' || value === null) return undefined;
  const { names, of } = value as Record<string, unknown>;
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) return undefined;
  if (typeof of !== 'object' || of === null) return undefined;
  const keyedBy = (value as Record<string, unknown>)['keyedBy'];
  return {
    names: names as string[],
    of: of as ApplicationMap['of'],
    ...(keyedBy === 'directory' || keyedBy === 'declaration' ? { keyedBy } : {}),
  };
};

/**
 * The applications one thing is served by, as id qualifiers.
 *
 * One source of judgement for every adapter that mints an address, so that two
 * of them cannot disagree about when an id carries an application. `undefined`
 * stands for an unqualified id, and there are three ways to get one: no map, one
 * application, or a declaration no application mounts.
 *
 * The key is whatever the caller has that an application can be looked up by. A
 * reader that finds applications by following the calls that create them has a
 * declaration, and passes its symbol id. A reader whose applications *are*
 * directories — a router addressed by the file system holds one per tree — has
 * the application itself, and passes that. Both ask this, because the question
 * they are asking is the same one and the answer must not depend on which reader
 * asked it: two mechanisms for this rule is how one reader came to put the
 * application in the path while every other put it in the identity (R125).
 *
 * One application needs no name because within one address space the address is
 * the identity, and a word repeated in every id of every ordinary service buys
 * nothing. A declaration that no application mounts is not served at all — the
 * framework never sees it — and inventing an application for it would assert
 * something nothing read; it keeps the plain id it had before, which is the
 * reading this change does not claim to improve.
 *
 * Never empty, so a caller loops over it and gets the old behaviour for free.
 */
export const applicationsServing = (
  map: ApplicationMap | undefined,
  key: string,
): ReadonlyArray<string | undefined> => {
  if (map === undefined || map.names.length < 2) return [undefined];
  const mounted = map.of[key];
  return mounted === undefined || mounted.length === 0 ? [undefined] : mounted;
};

/**
 * How an application in one map is looked up.
 *
 * Written down rather than left to whoever reads the map, because the two
 * spellings answer different questions and only one of them can answer a
 * question about a *file*. A reader that finds applications by following the
 * calls that create them keys them by declaration, and nothing about a
 * declaration says which files sit under it. A reader whose applications are
 * directories keys them by directory, and there the question "which application
 * is this file in" is a prefix and nothing more.
 *
 * Absent means `declaration`, which is what the only map written before this
 * existed was.
 */
export type ApplicationKeys = 'declaration' | 'directory';

/**
 * The name of the application at the service's own root, where applications are
 * directories.
 *
 * `.` is the one spelling no directory can have, and it reads as what it is: the
 * application here. Defined beside the map rather than in the reader that mints
 * it, because a caller asking which application a file belongs to has to know
 * the same thing — and two spellings of the root would be two answers to one
 * question, which is the defect this whole file exists to prevent.
 */
export const ROOT_APPLICATION = '.';

/**
 * The application a file belongs to, as an id qualifier.
 *
 * The same question {@link applicationsServing} already answers for a route, and
 * the same answer, asked of a file rather than of a declaration. A call site is
 * a file; that is the whole of what it has. So a component under
 * `examples/blog/` belongs to `examples/blog`, one under no application's
 * directory belongs to the root application, and — because the judgement goes
 * through `applicationsServing` — a service with a single address space still
 * qualifies nothing, exactly as its entries do not.
 *
 * Asked of the record the extractor hands round, the way every other reader of
 * it asks, so that a caller needs nothing but the context it already has.
 *
 * The longest name wins, since an application nested inside another's directory
 * is the one its own files belong to. A map keyed by declaration answers
 * nothing: a symbol id is not a path, and prefix-matching one would be an
 * invention dressed as a reading.
 */
export const applicationOfFile = (
  meta: Record<string, unknown> | undefined,
  file: string,
): string | undefined => {
  const map = applicationsIn(meta);
  if (map === undefined || map.keyedBy !== 'directory') return undefined;
  let found: string | undefined;
  for (const name of map.names) {
    const under = name === ROOT_APPLICATION || file.startsWith(`${name}/`);
    if (!under) continue;
    if (found === undefined || name.length > found.length) found = name;
  }
  if (found === undefined) return undefined;
  const [application] = applicationsServing(map, found);
  return application;
};

/**
 * Asks the entry adapters which applications the service holds, and leaves the
 * answer where every reader of this context looks for it.
 *
 * The extractor does the asking and the adapter does the reading, so that a
 * browser reader can record which application a call site is in without knowing
 * what creates an application in any framework — which is the same division the
 * server reader already has, where a pass of its own fills this key before the
 * adapters that mint ids read it.
 *
 * The first adapter to answer is the answer. Two frameworks' address spaces in
 * one service is not a reading anything here could combine, and combining two
 * maps keyed differently would produce a map that answers neither question.
 */
export const recordApplications = (ctx: ExtractContext): void => {
  const meta = ctx.meta;
  if (meta === undefined) return;
  for (const adapter of ctx.adapters.entry) {
    const map = adapter.applications?.(ctx);
    if (map === undefined) continue;
    meta['applications'] = map;
    return;
  }
};
