import { wayInBodyRead } from '@flowatlas/core';
/**
 * What the tool saw, read back off the three files a run leaves behind.
 *
 * Every figure here is derived, never printed by a command and scraped: the
 * graph, the link report and the doctor report are the artefacts a build
 * promises, and reading those rather than the summary means a change to how the
 * tool words its output cannot silently change a coverage number.
 *
 * The figures are deliberately few, and each one was chosen because it moves
 * when something real moved and stays put otherwise. Node and edge totals are
 * not here: they change whenever any reader learns to record one more thing,
 * which makes every report in the directory a diff and none of them a signal.
 */

/** Outgoing edge counts by type, one pass over the graph, shared by every figure. */
const indexOf = (graph) => {
  const out = new Map();
  for (const edge of graph.edges) {
    const byType = out.get(edge.from) ?? new Map();
    byType.set(edge.type, (byType.get(edge.type) ?? 0) + 1);
    out.set(edge.from, byType);
  }
  return { out };
};

const outCount = (index, id, type) => index.out.get(id)?.get(type) ?? 0;

/** Edge kinds that mean the handler body was read and does something. */
const DOES_SOMETHING = ['calls', 'queries', 'http_calls', 'emits', 'caches', 'reads_config'];

/**
 * The address of an HTTP entry point, as the tool placed it.
 *
 * From the node's own metadata where it is there, and otherwise off the key half
 * of its id, which is `METHOD:/path` by construction. Two spellings of one fact
 * and both are read, because a figure that silently became zero when one reader
 * stopped setting the metadata would be the defect this file exists to avoid.
 */
const addressOf = (node) => {
  const declared = node.meta?.path;
  if (typeof declared === 'string' && declared !== '') return declared;
  const key = node.id.split(':').slice(4).join(':');
  return key === '' ? '/' : key;
};

/**
 * One entry id with the application taken out of it again.
 *
 * `entry:<service>@<application>:<kind>:<key>` becomes
 * `entry:<service>:<kind>:<key>`, which is the id the same route had before R119.
 * Counting the distinct ones answers the question acceptance asked and nothing
 * else could: how many addresses were being lost to a collision, silently, while
 * every total in every report stayed correct. Two applications serving `/health`
 * are two addresses here and one there, so the difference is the count of
 * addresses that used to be overwritten.
 */
const withoutApplication = (id) => id.replace(/^(entry:[^:@]+)@[^:]*:/, '$1:');

/**
 * Addresses counted by their first segment, with the small ones folded.
 *
 * This is the smallest thing that makes a lost prefix visible. All of a photo server's
 * two hundred and ninety-two paths gaining an `/api` moved no figure in any
 * report, because no report printed any part of an address; printing every path
 * would swamp the diff and make every new route a changed file. One row per
 * leading segment is bounded, and a prefix appearing or disappearing moves every
 * one of those rows at once, which is exactly the shape of that regression.
 *
 * Segments with fewer than `FOLD_BELOW` addresses are counted together rather
 * than listed, so a repository that serves two hundred addresses at the top
 * level does not write two hundred rows. The fold is by size, and the rows that
 * survive it are still ordered by name, so one segment growing does not reorder
 * anything.
 */
const FOLD_BELOW = 5;

const addressShapes = (nodes) => {
  const counted = new Map();
  for (const node of nodes) {
    const address = addressOf(node);
    const [, first = ''] = address.replace(/^[A-Z]+:/, '').split('/');
    const segment = first === '' ? '/' : `/${first}`;
    counted.set(segment, (counted.get(segment) ?? 0) + 1);
  }
  const listed = [...counted]
    .filter(([, count]) => count >= FOLD_BELOW)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([segment, count]) => ({ segment, addresses: count }));
  const rest = [...counted].filter(([, count]) => count < FOLD_BELOW);
  return {
    listed,
    folded: { segments: rest.length, addresses: rest.reduce((sum, [, count]) => sum + count, 0) },
  };
};

/**
 * A route at the four numbers it is at, which are not one number.
 *
 * `addresses` is how many distinct addresses the tool placed an entry point at.
 * The other three count **handlers**, because that is what the counting rule
 * counts: a decorator, a registration call or an exported verb is a thing
 * somebody wrote, and two of them may land on one address. A photo server declares
 * eleven of its routes twice, once in the application and once in a maintenance
 * worker, so its three hundred and three declarations sit at two hundred and
 * ninety-two addresses and both figures are true. Comparing addresses against a
 * count of declarations would report eleven routes as missed that were read in
 * full.
 *
 * `duplicated` and `shapes` are here for a class of regression the first version
 * of this file could not show at all: a route collapsing onto another one's
 * address, and a global prefix silently dropped. Fourteen of a notification service's routes were
 * claimed by two handlers each and every figure in its report stayed put.
 *
 * `withBody` is a declaration whose handler the tool actually found; `reaching`
 * is one whose handler goes on to call, query, request, publish, cache or read
 * a setting. A report that printed only `addresses` would say a scheduling app is
 * covered, when the tool has placed eighty-four addresses and read the code
 * behind about half of them. That is the defect this harness exists to show.
 */
const routes = (graph, index) => {
  const entries = graph.nodes.filter((node) => node.type === 'entry');
  const httpNodes = entries.filter((node) => node.kind === 'http');
  const http = new Set(httpNodes.map((node) => node.id));
  const handles = graph.edges.filter((edge) => edge.type === 'handles' && http.has(edge.from));
  // A body counts as read by the core's one definition, the same `doctor` decides
  // on: a `handles` edge onto code the adapter did not say it failed to follow.
  // Counting the edge alone reported a service whose every route was built by a
  // helper as having every body attached, while `doctor` refused the same graph.
  const handledIds = new Set(handles.map((edge) => edge.from));
  const readIds = new Set(
    httpNodes.filter((node) => wayInBodyRead(node, (id) => handledIds.has(id))).map((node) => node.id),
  );
  const handled = handles.filter((edge) => readIds.has(edge.from));
  const reaching = handled.filter((edge) =>
    DOES_SOMETHING.some((type) => outCount(index, edge.to, type) > 0),
  );
  // One spelling, and this reads that one. A guard declared by a decorator and
  // a middleware chain installed by a call are both `guarded_by` edges, so the
  // obvious question gets the true answer — which it did not before R109, when
  // middleware was a list on the route and this figure reported a wiki app as
  // having nothing in front of any of its two hundred and fifty-seven routes
  // while it has something in front of two hundred and fifty-five of them.
  const guarded = handled.filter((edge) => outCount(index, edge.from, 'guarded_by') > 0);
  const byKind = {};
  for (const node of entries) {
    byKind[node.kind ?? 'unknown'] = (byKind[node.kind ?? 'unknown'] ?? 0) + 1;
  }
  // Addresses two or more declarations both claim, **inside one application**.
  //
  // That qualifier is new and it is the whole of what R119 changed here. Two
  // things used to land in this figure and the graph could not tell them apart:
  // a route wrongly collapsed onto another one's address, which is what fourteen
  // of a notification service's were, and two applications of one service each serving the same
  // address, which is what eleven of a photo server's are - a controller mounted in the
  // application and again in a maintenance worker. Now an entry id carries the
  // application that serves it, so the second kind is two addresses and is not
  // counted here at all.
  //
  // What is left is the reading that can honestly be asserted to zero: one
  // address, one application, two handlers, which means the framework answers
  // with whichever it registered first and the other is dead code that still
  // type-checks. It is still printed rather than asserted, because a service
  // whose applications could not be read - a factory call handed something
  // computed, which writes a row of its own - would fail an assertion for the
  // old reason wearing the new name.
  const claims = new Map();
  for (const edge of handles) claims.set(edge.from, (claims.get(edge.from) ?? 0) + 1);
  return {
    byKind,
    addresses: http.size,
    duplicated: [...claims.values()].filter((count) => count > 1).length,
    collided: http.size - new Set([...http].map(withoutApplication)).size,
    withBody: handled.length,
    reaching: reaching.length,
    guarded: guarded.length,
    shapes: addressShapes(httpNodes),
  };
};

/**
 * Query sites, and how many of them ended up at a table anybody named.
 *
 * A `db_query` node with no `queries` edge is the tool saying "something here
 * touched storage and I could not say what". Fifteen hundred of those and no
 * tables is not fifteen hundred units of coverage.
 */
const data = (graph, index) => {
  const queries = graph.nodes.filter((node) => node.type === 'db_query');
  const named = queries.filter((node) => outCount(index, node.id, 'queries') > 0);
  return {
    queries: queries.length,
    named: named.length,
    tables: graph.nodes.filter((node) => node.type === 'table').length,
  };
};

/**
 * Screens, and the things on them a person can set off.
 *
 * Clicks are counted apart from everything else a template binds, because a
 * click is what the counting rule can see in a template and a lifecycle hook is
 * not. Putting all thirteen hundred bindings against three hundred and seven
 * clicks would say the tool found four times what exists, which is the opposite
 * of the truth: it found every click and a great deal besides.
 */
const screens = (graph) => {
  const actions = graph.nodes.filter((node) => node.type === 'ui_action');
  return {
    components: graph.nodes.filter((node) => node.type === 'ui_component').length,
    clicks: actions.filter((node) => node.kind === 'click').length,
    actions: actions.length,
  };
};

/**
 * Unresolved rows, grouped by reason and kept in a stable order.
 *
 * Sorted by reason rather than by size, because a list sorted by size reorders
 * itself whenever any one row moves and the diff then shows every line as
 * changed. Levels are carried through: an `action` row is a hole somebody can
 * close and an `info` row is the tool describing a limit, and adding them
 * together would make the total mean nothing.
 */
const unresolved = (doctor) => {
  if (doctor === undefined) return undefined;
  const section = doctor.unresolved;
  return {
    total: section.total,
    rows: section.rows,
    sites: section.sites,
    info: section.info,
    nothing: section.nothing,
    byReason: [...section.byReason]
      .map((group) => ({
        reason: group.reason,
        level: group.level,
        sites: group.sites,
        known: group.known,
      }))
      .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)),
  };
};

/** Everything the report prints about one measured state of one target. */
export const figuresFrom = ({ graph, report, doctor }) => {
  const index = indexOf(graph);
  return {
    routes: routes(graph, index),
    requests: {
      browser: { found: report.ui.total, joined: report.ui.resolved },
      service: { found: report.httpOut.total, joined: report.httpOut.linked },
    },
    channels: { found: report.channels.total, bothEnds: report.channels.linked },
    data: data(graph, index),
    screens: screens(graph),
    unresolved: unresolved(doctor),
  };
};
