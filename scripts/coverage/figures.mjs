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

/** Node and edge indexes one pass over the graph, shared by every figure. */
const indexOf = (graph) => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const out = new Map();
  for (const edge of graph.edges) {
    const byType = out.get(edge.from) ?? new Map();
    byType.set(edge.type, (byType.get(edge.type) ?? 0) + 1);
    out.set(edge.from, byType);
  }
  return { nodes, out };
};

const outCount = (index, id, type) => index.out.get(id)?.get(type) ?? 0;

/** Edge kinds that mean the handler body was read and does something. */
const DOES_SOMETHING = ['calls', 'queries', 'http_calls', 'emits', 'caches', 'reads_config'];

/**
 * A route at the four numbers it is at, which are not one number.
 *
 * `addresses` is how many distinct addresses the tool placed an entry point at.
 * The other three count **handlers**, because that is what the counting rule
 * counts: a decorator, a registration call or an exported verb is a thing
 * somebody wrote, and two of them may land on one address. immich declares
 * eleven of its routes twice, once in the application and once in a maintenance
 * worker, so its three hundred and three declarations sit at two hundred and
 * ninety-two addresses and both figures are true. Comparing addresses against a
 * count of declarations would report eleven routes as missed that were read in
 * full.
 *
 * `withBody` is a declaration whose handler the tool actually found; `reaching`
 * is one whose handler goes on to call, query, request, publish, cache or read
 * a setting. A report that printed only `addresses` would say cal.com is
 * covered, when the tool has placed eighty-four addresses and read the code
 * behind about half of them. That is the defect this harness exists to show.
 */
const routes = (graph, index) => {
  const entries = graph.nodes.filter((node) => node.type === 'entry');
  const http = new Set(entries.filter((node) => node.kind === 'http').map((node) => node.id));
  const handled = graph.edges.filter((edge) => edge.type === 'handles' && http.has(edge.from));
  const reaching = handled.filter((edge) =>
    DOES_SOMETHING.some((type) => outCount(index, edge.to, type) > 0),
  );
  // Two spellings of the same fact, and both count. A NestJS guard is a node
  // the route points at; middleware in front of a Koa or Express route is a
  // list on the route itself, because it is usually an inline function with no
  // declaration to point at. Reading only the edge reported outline as having
  // nothing in front of any of its two hundred and fifty-seven routes, when it
  // has something in front of two hundred and fifty-five of them.
  const stands = (id) =>
    outCount(index, id, 'guarded_by') > 0 ||
    (index.nodes.get(id)?.meta?.middleware ?? []).length > 0;
  const guarded = handled.filter((edge) => stands(edge.from));
  const byKind = {};
  for (const node of entries) {
    byKind[node.kind ?? 'unknown'] = (byKind[node.kind ?? 'unknown'] ?? 0) + 1;
  }
  return {
    byKind,
    addresses: http.size,
    withBody: handled.length,
    reaching: reaching.length,
    guarded: guarded.length,
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
