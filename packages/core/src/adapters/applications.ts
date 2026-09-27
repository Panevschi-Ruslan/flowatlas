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
  return { names: names as string[], of: of as ApplicationMap['of'] };
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
