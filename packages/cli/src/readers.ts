/**
 * The readers this command ships, and the frameworks each one reads.
 *
 * ## One row per framework
 *
 * A framework this tool can read is four facts that always travel together: the
 * `type` a configuration writes, the dependency that gives it away in a
 * manifest, the reader package that opens such a repository, and which half of a
 * repository that reader is the reader of. Those four were written down in two
 * places - the third column of `TYPE_SIGNATURES` in `stacks.ts` and
 * `SERVER_TYPES` / `BROWSER_TYPES` / `isFrontend` in `build/extractor.ts` - and
 * two branches of one batch each edited both lists, which is the drift arriving
 * on schedule (R118). They are one row here now, and everything either file used
 * to state is a question asked of these rows.
 *
 * ## Why a module of its own
 *
 * The obvious merge is the wrong one. `stacks.ts` is imported by `init` and
 * `link`, two commands that read no source and must start fast;
 * `build/extractor.ts` imports the reader packages and ts-morph with them, so
 * deriving one from the other would put a TypeScript program in the import graph
 * of a command that writes a configuration file. This module imports nothing at
 * all - it is names and strings - so both sides can read it and `init` pays a
 * table of ten rows for it.
 *
 * It is in the command line rather than in the core because of what it is about.
 * The core describes a graph and may not name a framework anywhere, comments and
 * test data included; every row here is a framework name. What a reader reads is
 * a fact about this tool's readers, not about the graph they produce, so it
 * belongs beside the readers.
 *
 * ## Which column is the declaration
 *
 * The reader is declared per framework and the half is declared per reader, not
 * per framework. That ordering is the point: the half follows from which reader
 * opens the repository, so a framework that moves from one reader to the other -
 * which is what happened to the file-system router - takes its half with it in
 * the same edit, and no second column can be left behind. There is no pair of
 * statements left to hold to each other.
 */

/** The reader that opens a TypeScript project and walks whatever declares routes in it. */
export const NESTJS_EXTRACTOR = '@flowatlas/extractor-nestjs';
export const ANGULAR_EXTRACTOR = '@flowatlas/extractor-angular';
export const REACT_EXTRACTOR = '@flowatlas/extractor-react';

/** Which half of a repository a reader is the reader of. */
export type Half = 'server' | 'browser';

/**
 * The half each reader reads.
 *
 * A repository can honestly be both halves at once - a server and the browser
 * that talks to it, in one directory, sharing one manifest. The server reader
 * opens every kind of TypeScript source and hands the browser half to whichever
 * frontend adapter recognises it, so it can answer for both halves of one
 * directory; a browser reader can answer for one. That is why the half is worth
 * writing down: where both halves are declared, the reader that reads both wins.
 */
const HALF_OF_READER: Readonly<Record<string, Half>> = Object.freeze({
  [NESTJS_EXTRACTOR]: 'server',
  [ANGULAR_EXTRACTOR]: 'browser',
  [REACT_EXTRACTOR]: 'browser',
});

/** One framework: its type, the dependency that gives it away, and its reader. */
export type ReaderRow = readonly [type: string, dependency: string, reader: string];

/**
 * Every framework this tool reads, in the order a manifest is asked about them.
 *
 * Within one half, order is specificity and nothing else. Across the halves it
 * decides nothing, because `stacks.ts` asks the server rows before the browser
 * ones whatever order they are written in - see the rule there, and R88 for the
 * repository whose data layer turned on which of two rows somebody had typed
 * first.
 *
 * A repository whose way in is described in configuration rather than declared
 * as a dependency is not in this table at all, for the same reason as a
 * framework with no reader (`UNREAD_SIGNATURES` in `stacks.ts`): nothing here
 * would give it away.
 */
export const READERS: readonly ReaderRow[] = [
  // NestJS first because `@nestjs/platform-express` brings Express with it, and
  // a Nest application that declares `express` is a Nest application.
  ['nestjs', '@nestjs/core', NESTJS_EXTRACTOR],
  // Above Express for the same reason, and above React for a second one: this
  // framework brings Express with it and never registers a route on it - its
  // routes are the paths of its files - and its admin panel is React, so a
  // repository built on it declares two dependencies that both describe
  // something it is not. Read as Express it produced one route of four hundred
  // and eighty-eight; read as React it would lose every query site it has. A
  // dependency is not a stack, and this is the row that says so (R91).
  ['medusa', '@medusajs/framework', NESTJS_EXTRACTOR],
  ['medusa', '@medusajs/medusa', NESTJS_EXTRACTOR],
  // The file-system router is read by the server reader although it is also a
  // browser: it is both halves in one directory, and the reader that reads both
  // is the server one. What it gained by moving here is everything that lives on
  // the server side - dependency injection, the wrapping chain, the data-layer
  // and broker passes, the contract types and an incremental session - without
  // losing a component, an action or a route handler written in markup.
  ['nextjs', 'next', NESTJS_EXTRACTOR],
  ['express', 'express', NESTJS_EXTRACTOR],
  ['fastify', 'fastify', NESTJS_EXTRACTOR],
  ['koa', 'koa', NESTJS_EXTRACTOR],
  ['angular', '@angular/core', ANGULAR_EXTRACTOR],
  // A repository that is only a browser. It has no ways in for the server reader
  // to find, so reading it there would add passes with nothing to read and a
  // slower run to show for it.
  ['react', 'react', REACT_EXTRACTOR],
];

/** The reader that reads a type, or `undefined` for a type nothing here reads. */
const READER_OF: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(READERS.map(([type, , reader]) => [type, reader])),
);

/** The types this tool can read, each named once however many dependencies give it away. */
export const READABLE_TYPES: readonly string[] = [...new Set(READERS.map(([type]) => type))];

/** The reader for a repository of this type, or `undefined` when there is none. */
export const readerOf = (type: string): string | undefined => READER_OF[type];

/** The half a type's reader reads, or `undefined` for a type nothing here reads. */
export const halfOf = (type: string): Half | undefined => {
  const reader = READER_OF[type];
  return reader === undefined ? undefined : HALF_OF_READER[reader];
};

/** Rows whose reader reads the given half, in table order. */
export const rowsInHalf = (half: Half): readonly ReaderRow[] =>
  READERS.filter(([, , reader]) => HALF_OF_READER[reader] === half);

/** The types one reader handles, each named once. */
export const typesReadBy = (reader: string): readonly string[] => [
  ...new Set(READERS.filter(([, , each]) => each === reader).map(([type]) => type)),
];
