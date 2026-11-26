import type { GraphBuilder } from './builder.js';
import { makeEntryId, normalizePath } from './ids.js';

/**
 * A screen a front end's router shows at an address, as a way in (P363).
 *
 * The router registers a component at an address and shows it there whoever
 * asks: a link the reading followed, an address typed in, a bookmark, a
 * redirect a server sends. Recorded only as a `route` on the component, a
 * screen nothing links to had nothing reaching it at all, and every question
 * that walks back from it - who calls it, is it dead, what reaches it -
 * answered that nothing does. So each address is an `entry` of kind
 * `screen`, `entry:<service>:screen:<path>`, and the component the router
 * shows there is the code behind it, a `handles` edge, as a route's handler
 * is. Two components at one address - a shell and the child its outlet shows
 * at the shell's own path - are both behind the one entry.
 */
export interface ScreenEntry {
  readonly repo: string;
  /** The address as the router mounts it, prefixes and all. */
  readonly path: string;
  /** The node of the component the router shows there. */
  readonly component: string;
  /** The component's name, so a screen is found by what it shows too. */
  readonly label: string;
  /** Where the route is written: the configuration's line, or the page's file. */
  readonly file: string;
  readonly line?: number;
  /** Reached through a branch of the configuration nothing decides. */
  readonly guessed?: boolean;
  /** What the router runs before it shows the screen, as written, in its order. */
  readonly guards?: readonly string[];
  /** Which reading placed it: a route table, a `<Route>`, a file under a pages directory. */
  readonly by: string;
}

/** The meta key a screen's entry names the components it shows under. */
export const SCREENS_META = 'screens';

/** Adds the screen's entry, or the component to the entry already at its address; answers the entry's id. */
export const addScreenEntry = (builder: GraphBuilder, screen: ScreenEntry): string => {
  const path = normalizePath(screen.path);
  const id = makeEntryId(screen.repo, 'screen', path);
  const stored = builder.addNode({
    id,
    type: 'entry',
    kind: 'screen',
    label: path,
    repo: screen.repo,
    file: screen.file,
    ...(screen.line === undefined ? {} : { line: screen.line }),
    meta: {
      path,
      by: screen.by,
      ...(screen.guards === undefined || screen.guards.length === 0 ? {} : { guards: [...screen.guards] }),
    },
  });
  const shown = Array.isArray(stored.meta?.[SCREENS_META]) ? (stored.meta[SCREENS_META] as string[]) : [];
  stored.meta = { ...stored.meta, [SCREENS_META]: [...new Set([...shown, screen.label])].sort() };
  builder.addEdge({
    from: id,
    to: screen.component,
    type: 'handles',
    confidence: screen.guessed === true ? 'heuristic' : 'static',
    file: screen.file,
    ...(screen.line === undefined ? {} : { line: screen.line }),
    meta: { route: path },
  });
  return id;
};

/** Whether a node is a screen's way in. */
export const isScreenEntry = (node: { readonly type: string; readonly kind?: string }): boolean => node.type === 'entry' && node.kind === 'screen';
