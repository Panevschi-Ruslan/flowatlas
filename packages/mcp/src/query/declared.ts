import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { isResolved, resolveSymbol } from './entry-ref.js';

/**
 * The ways in a class, a method or a file declares (P375): what answers "which
 * routes of this controller does no code call" in one small call, where
 * listing every route under a path and reading them was the only way.
 *
 * A way in is declared by the code it hands work to: a route by its handler
 * method (and so by that method's class), a screen by the component it shows,
 * a consumer's way in by its handler. A file declares the ways in written in
 * it and those whose handler is written in it.
 */
export interface Declared {
  /** The class, method or component asked about, when the input named one. */
  node?: GraphNode;
  /** The file asked about, when the input named one. */
  file?: string;
  /** Its ways in, by id. */
  entries: GraphNode[];
}

export type DeclaredRef = Declared | { candidates: GraphNode[] };

export const isDeclared = (ref: DeclaredRef): ref is Declared => 'entries' in ref;

const byId = (a: GraphNode, b: GraphNode): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Whether a node is the asked node or a member of it (`Class.method` under `Class`). */
const isOrUnder = (id: string, owner: string): boolean => id === owner || id.startsWith(`${owner}.`);

/** Whether a file is the one asked for: the same path, or one ending in it after a `/`. */
const sameFile = (file: string | undefined, asked: string): boolean =>
  file !== undefined && (file === asked || file.endsWith(`/${asked}`));

/** What a way in hands work to: the targets of its `handles` edges. */
const handlersOf = (db: GraphDb, entry: GraphNode): GraphNode[] =>
  db.edgesFrom(entry.id, ['handles']).flatMap((edge) => db.node(edge.to) ?? []);

/** Whether the input reads as a file: a path or a name with an extension, and some node is written in it. */
const fileAsked = (db: GraphDb, ref: string): boolean => {
  if (!ref.includes('/') && !/\.[a-z]{1,5}$/i.test(ref)) return false;
  return db.nodesByType('entry').some((entry) => sameFile(entry.file, ref) || handlersOf(db, entry).some((handler) => sameFile(handler.file, ref)));
};

/** The ways in the class, method, component or file `ref` names declares; the candidates when it names several. */
export const declaredBy = (db: GraphDb, ref: string, service?: string): DeclaredRef => {
  const asked = ref.trim();
  const entries = db.nodesByType('entry').filter((entry) => service === undefined || entry.repo === service);
  if (db.node(asked) === undefined && fileAsked(db, asked)) {
    const found = entries.filter((entry) => sameFile(entry.file, asked) || handlersOf(db, entry).some((handler) => sameFile(handler.file, asked)));
    return { file: asked, entries: found.sort(byId) };
  }
  const resolved = resolveSymbol(db, asked, service);
  if (!isResolved(resolved)) return { candidates: resolved.candidates };
  const owner = resolved.node;
  if (owner.type === 'entry') return { node: owner, entries: [owner] };
  const found = entries.filter((entry) => handlersOf(db, entry).some((handler) => isOrUnder(handler.id, owner.id)));
  return { node: owner, entries: found.sort(byId) };
};
