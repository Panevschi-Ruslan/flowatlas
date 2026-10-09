#!/usr/bin/env node
/**
 * The gate over what was not read (R111, strength 2).
 *
 * **A file the counting rule found sites of a family in must yield, for that
 * family, a node - or a row naming the file.** Nothing else. Not a count, not a
 * mapping from probe to adapter: a reader that saw the file and could say
 * nothing about it is allowed to say so, and a reader that said nothing at all
 * is the defect.
 *
 * That is the whole of the assertion, and it is worth being clear about which
 * failures it does and does not catch, because a gate whose reach nobody wrote
 * down gets trusted for things it never checked.
 *
 * It catches the class R84 fixed three instances of: a reader giving up in
 * silence. A file-system router with no reader at all - seven hundred and
 * sixty-nine files of sites and nothing out - fails here on the first file. Two
 * controllers lost inside a repository whose other four hundred were read fail
 * here too, which is the case a per-family or per-repository assertion cannot
 * see, because four hundred and twenty-nine of four hundred and fifty-six
 * passing is a family that yielded nodes.
 *
 * What it does **not** catch is not prose here any more. It is `BLIND` below,
 * one entry per blindness, with the ticket that established each and the thing
 * that was measured; the report prints the list from the same array, because a
 * reader who is told `read gate ok` and never told what that sentence excludes
 * is the person this gate misleads. R119 is the proof that this is not a
 * theoretical worry: a deliberately broken graph came back `read gate ok`.
 *
 * ## Known red, and new red
 *
 * `BASELINE` is the second half. Two targets have failed this gate since it
 * existed, for reasons that are real, ticketed and not this week's work - and a
 * gate that is already red cannot report a new failure, because non-zero means
 * "the thing I already know about" to everybody who runs it (R124). So the red
 * that is known is enumerated: a target, a state, a family, a subtree and a
 * count. A run then fails on the *difference* - one more file unread, a file
 * unread somewhere the baseline does not reach, or a count that has dropped
 * because somebody fixed something and left the excuse behind.
 *
 * ## Where the judgement that *is* here lives
 *
 * `YIELDS` maps a family to the node types that answer it. That is judgement,
 * and it is judgement about this tool's own graph model rather than about any
 * target, so it lives here rather than beside the probes: the counting rule
 * stays readable without knowing what a node is. One entry per family, as a
 * lookup, so a new family is a row.
 *
 * ## Running it
 *
 *   node scripts/coverage/read-gate.mjs            # over every fixture
 *   node scripts/coverage/read-gate.mjs --fixture nest-basic
 *
 * Over the fixtures it reads every expected graph each one commits -
 * `expected.graph.json`, `expected.project-graph.json`, or both - which is
 * ground truth this repository already maintains, so the gate costs a second
 * and needs nothing cloned. The harness applies the same function to the
 * coverage targets, where the tree is somebody else's repository and the graph
 * is the one just built.
 *
 * A project graph places each service at the directory its own `services`
 * names, as the harness does; a repository graph is one service at the root.
 * The translation, the table of what speaks for which family and the rule for
 * a service declared only by a document are tested on their own, with graphs
 * built by hand (`read-gate.test.mjs`, run by `pnpm fixtures:check`):
 *
 *   node --test scripts/coverage/read-gate.test.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSourceFile, measureSites } from './counting-rule.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'fixtures');

/**
 * What counts as a family having yielded something, and at which strength.
 *
 * `data` takes a cache operation as well as a query because both are the code
 * reaching a store, and a probe cannot tell which of the two it is looking at.
 * `clicks` takes any `ui_action`: the probe counts a click bound in a template
 * and the tool records the binding, and which binding it decided this one is is
 * not this gate's business.
 *
 * `perFile` is false for exactly one family, and the reason is a property of the
 * graph model rather than a concession. A table node's identity is
 * `table:<repo>#<Name>` and it carries no file at all: the model asks where a
 * table is *used* and never where it was declared. There is therefore no
 * file-level answer to give about `models`, and a gate that demanded one would
 * fail on every entity in the repository - it did, on five fixtures, the first
 * time this was run. So that family is held to strength 1 instead: sites
 * anywhere and no node anywhere is a failure, one file's worth of silence is not
 * visible and is not claimed to be. Recording which family is gated at which
 * strength beats a gate whose reach nobody can look up.
 *
 * ## What speaks for a family, and nothing else (R160)
 *
 * A node answers the family its `type` belongs to. An **edge** answers the
 * family its kind belongs to, and only through a node of that family at one of
 * its ends: `handles` is the routes family's kind when it runs from an entry and
 * the clicks family's when it runs from a button, and a message consumer's
 * `handles` answers neither. A **row** answers the family its `reason` belongs
 * to: the reader of that family was in the file and said why it could not
 * finish. Anything else said about a file - a call, an injection, a config read,
 * a row about a receiver's type - says a reader was there and nothing about
 * whether the reader of *this* family was. Before R160 it spoke for every family
 * of the file, and about 174 of a scheduling app's data files passed on calls alone.
 *
 * `edges` and `reasons` are the whole of that judgement, one row per family, and
 * a kind or a reason written under no family speaks for nothing. A reason is an
 * open word, so one this table has never heard of speaks for nothing too, which
 * fails loudly rather than passing a file on a sentence nobody classified.
 * `models` owns no edge and no reason because nothing is asked of it per file.
 */
const GATED = {
  routes: {
    types: ['entry'],
    edges: ['handles', 'guarded_by'],
    reasons: [
      // A route read, and something about it that could not be.
      'route-path-dynamic',
      'route-handler-anonymous',
      'route-handler-unread',
      'route-verb-unread',
      'route-mount-unread',
      'route-registry-unread',
      'route-file-not-served',
      'route-module-not-found',
      'route-claimed-twice',
      'route-unguarded',
      'route-guard-skipped',
      'route-shadowed',
      'server-action-unread',
      // The application or module the routes hang from.
      'application-root-unread',
      'bootstrap-not-found',
      'module-controllers-unread',
      'global-wrapper-dynamic',
      'middleware-route-dynamic',
      'middleware-matcher-unread',
      // A description of the routes that was there and could not be matched.
      'entry-http-routes-unmatched',
      'entry-http-routes-unplaced',
      'entry-http-types-unmatched',
      'entry-http-description-inactive',
      // A procedure router, which is a way in over HTTP too.
      'procedure-router-unread',
      'procedure-branch-unread',
      'procedure-key-dynamic',
      'entry-procedures-description-inactive',
    ],
    perFile: true,
  },
  screens: {
    types: ['ui_component'],
    edges: [],
    reasons: ['route-config-unread', 'route-loader-unread'],
    perFile: true,
  },
  clicks: {
    types: ['ui_action'],
    edges: ['handles', 'triggers'],
    reasons: [
      'handler-not-found',
      'handler-not-a-method',
      'template-not-found',
      'template-not-parsed',
      'route-link-dynamic',
      'route-screen-unread',
      'route-target-unresolved',
    ],
    perFile: true,
  },
  data: {
    types: ['db_query', 'cache_op'],
    edges: ['queries', 'caches'],
    reasons: [
      'unknown-db-package',
      'unknown-db-operation',
      'db-package-unread',
      'db-layer-unread',
      'db-handover-unstated',
      'db-receiver-name-only',
      'db-call-at-module-level',
      'dynamic-table-name',
      'dynamic-cache-key',
      'sql-parse-failed',
    ],
    perFile: true,
  },
  models: { types: ['table'], edges: [], reasons: [], perFile: false },
};

/**
 * The two rows of the table that belong to no one family.
 *
 * `nothing` names every edge kind of the model no family owns, so that the table
 * names the model's whole list (`EDGE_TYPES`, `packages/core/src/model/edges.ts`)
 * and a kind added there fails the gate's tests until somebody decides where it
 * goes. `every` is the one reason that speaks for the whole file: the parser
 * could not read it, so no reader of any family got in, and the row saying so
 * is the honest answer for all of them.
 */
const UNOWNED = {
  nothing: {
    edges: ['imports', 'injects', 'calls', 'emits', 'consumes', 'http_calls', 'hits', 'reads_config'],
  },
  every: { reasons: ['file-not-parsed'] },
};

/**
 * The table turned round for lookup: which families a node type, an edge kind or
 * a row's reason speaks for. Maps, because every key is a word read out of a
 * graph, and `constructor` is a word too.
 */
const ownersOf = (field, seed) => {
  const owners = new Map(seed);
  for (const [family, entry] of Object.entries(GATED)) {
    for (const word of entry[field]) owners.set(word, [...(owners.get(word) ?? []), family]);
  }
  return owners;
};

export const SPOKEN_FOR_BY = {
  types: ownersOf('types', []),
  edges: ownersOf(
    'edges',
    UNOWNED.nothing.edges.map((kind) => [kind, []]),
  ),
  reasons: ownersOf(
    'reasons',
    UNOWNED.every.reasons.map((reason) => [reason, Object.keys(GATED)]),
  ),
};

/** The table's entries by family, a Map for the same reason. */
const FAMILY = new Map(Object.entries(GATED));

/**
 * Files that legitimately yield neither a node nor a row, with the reason.
 *
 * The shape I12 uses, and for its reasons: each entry is a debt with a name
 * rather than a decision, and an exemption that no longer applies is reported
 * too, because an exemption nobody has removed is an exemption nobody has
 * re-read.
 *
 * `where` is a target or fixture name, `path` is the file as the counting rule
 * names it - or a subtree, written `some/dir/**`, because one repository whose
 * routing convention has no reader would otherwise need seven hundred entries
 * saying the same sentence - `family` is the one family exempted, never all of
 * them, and `why` is a sentence somebody has to be willing to defend.
 */
export const EXEMPT = [
  {
    where: 'express-fs-router',
    path: 'src/api/**',
    family: 'routes',
    why:
      'The fixture exists to hold the tool to the row R84 added and to nothing more: ' +
      'a file-system router with Express underneath, whose convention has no reader ' +
      'here yet. The reading is honest - one informational row naming the two things ' +
      'the reader cannot tell apart - and it is deliberately not a node. Remove this ' +
      'the day the convention gets a reader, and the gate will then insist on it.',
  },
  {
    where: 'nest-unknown-orm',
    path: '(anywhere)',
    family: 'models',
    why:
      'A model declared against a package nobody has described. R83 removed the ' +
      'table nodes this used to mint - a name taken from a value the same call site ' +
      'reported as unreadable - and the fixture exists to keep them removed. Every ' +
      'call here carries an `unknown-db-package` row instead, which is the honest ' +
      'output; a table would be a guess wearing a node. One descriptor turns all of ' +
      'them into tables at once, and then this entry goes.',
  },
  // A measured target's exemptions are not here. They name files of a
  // repository this project does not own, so they live with the target itself,
  // under `exempt` in the local target list (`targets.local.json`), and reach
  // `readGate` from its record. The rule is the same: one file or subtree, one
  // family, and a `why`.
];

/**
 * What this gate cannot see at all, with what established each one.
 *
 * The second half of R124, and the half that is easy to skip. An enumerated red
 * turns a known failure into a signal; this turns a **pass** into one, because
 * `read gate ok` is a sentence about the assertion in this file and not about
 * the reading, and nothing anywhere said so where a reader would meet it. R119
 * fed this gate a graph it had broken on purpose and got `read gate ok`. R117
 * was asked whether this gate would have caught a query count falling from 77 to
 * 0 and answered no, twice over. Neither is a bug in the gate. Both are its
 * reach, and a reach nobody wrote down gets trusted past.
 *
 * Data rather than prose, because two audiences need the same list: whoever is
 * editing this file, and whoever is reading a report that says `None`. The
 * report renders this array, and the command prints its length beside `ok`.
 * Adding a blindness is a row; arguing one away is deleting a row, in a diff
 * somebody reviews.
 *
 * `what` is the failure that gets through, `ticket` is where it was established,
 * and `measured` is the evidence, because every one of these was found by
 * breaking something on purpose rather than by reasoning about the code.
 */
export const BLIND = [
  {
    what: 'A family this target writes in a style the counting rule has no probe for.',
    ticket: 'R117',
    measured:
      'A query count fell from 77 to 0 on one target and this gate could not have ' +
      'caught it: the rule has no probe for that repository’s query style, so the ' +
      'denominator was 0 and the per-file assertion had nothing to assert over. A ' +
      'vacuous check passes by saying nothing and reads exactly like a check that ' +
      'looked. The instrument for that is the report’s own wording - "no ' +
      'denominator: the rule has no probe for it" rather than "nothing of this kind ' +
      'here" - and not this gate.',
  },
  {
    what: 'Two applications colliding, where the file that loses is named by an edge.',
    ticket: 'R119',
    measured:
      'A graph was broken on purpose - two applications collided and one ' +
      'controller’s file contributed nothing - and the gate answered `read gate ok`. ' +
      'The mechanism is structural rather than a tuning problem: the surviving entry ' +
      'takes a `handles` edge to *each* controller’s method, a `handles` edge from ' +
      'an entry speaks for the routes of the file it is recorded in (R160 narrowed ' +
      'this to its own family and left it true), so the losing file is answered and ' +
      'the gate skips it. Strength 2 asks whether anything was said ' +
      'about a file; a collision is two files having the same thing said about them. ' +
      'R119 needed a snapshot fixture for exactly this reason.',
  },
  {
    what: 'A wrong value.',
    ticket: 'R110',
    measured:
      'A mount read at the wrong address produces a node, in the right file, for ' +
      'the right family, and every count matches. Only a reader that can read the ' +
      'mount can know the address is wrong, so this is a fix and not a gate.',
  },
  {
    what: 'A file where one of three verbs was dropped (strength 3, deliberately not done).',
    ticket: 'R111',
    measured:
      'Strength 3 would compare sites found against nodes plus rows per file. It ' +
      'needs a probe-to-adapter mapping, and the counting rule’s whole authority ' +
      'rests on having no per-target judgement in it; that mapping is new judgement ' +
      'in exactly that file, and somewhere a future change could be tuned to pass ' +
      'rather than fixed. Recorded as not done rather than left to be rediscovered.',
  },
];

/**
 * The red that is already known, enumerated so that a new red is visible (R124).
 *
 * Not an exemption. An exemption says "expect nothing here, and do not count
 * it"; a baseline says "expect exactly this much here, and say so the moment it
 * is not". The difference matters because these findings are the most valuable
 * thing this gate has produced, and exempting them would delete them - silencing
 * a true report to restore a signal is the trade this project refuses everywhere
 * else.
 *
 * `where` and `state` name the measurement, because a target reads differently
 * with its dependencies installed: a wiki app is 45 files on a fresh clone and 0
 * with them, so a baseline that ignored the state would be stale in one of the
 * two by construction. `family`, `path` and `files` are the claim - this many
 * files, under this subtree, in this one family. `path` takes the same
 * `some/dir/**` an exemption does, and that is what stops the count from being
 * the only thing checked: a file that goes unread *outside* every subtree named
 * here matches no entry and fails as a new red whatever the total comes to.
 *
 * `files` is an **exact** count and fails in both directions on purpose. Upwards
 * is the new loss this ticket exists for. Downwards is the rule that keeps
 * `EXEMPT` and `VALIDATE_ONLY` honest: an entry that is no longer needed must
 * fail, so a fix silently deletes its own excuse instead of sheltering under it.
 *
 * It counts the files the *counting rule* found, never the files the reader chose
 * to report, so it is not somewhere a future change can be tuned to pass: the
 * only way to make one of these numbers smaller is to read more of somebody
 * else's repository.
 *
 * A target with no entry here is not baselined and fails exactly as it did
 * before. That is deliberate rather than unfinished: both numbers below were
 * measured on this tree, after R121 and R122 moved them, and copying a figure
 * out of a committed report that predates either would be writing down something
 * nobody has seen.
 */
export const BASELINE = [
  // Empty. A measured target's known red lives with the target, under
  // `baseline` in the local target list, for the reason its exemptions do.
];

const exemptionKey = (entry) => `${entry.where} ${entry.path} ${entry.family}`;

/** An exemption's or a baseline's `path`: one file, or a subtree ending in `/**`. */
const covers = (entry, path) =>
  entry.path.endsWith('/**') ? path.startsWith(entry.path.slice(0, -2)) : entry.path === path;

const exemptionFor = (entries, where, path, family) =>
  entries.find((entry) => entry.where === where && entry.family === family && covers(entry, path));

/**
 * The baseline entries that belong to one measurement.
 *
 * `state` is `null` over the fixtures, where there is only one state and the
 * question does not arise. An entry written without a state therefore matches
 * the fixtures and nothing else, which is the safer default of the two: a
 * baseline that silently applied to both states of a target would be an excuse
 * doing twice the work it was reviewed for.
 */
const baselineFor = (entries, where, state) =>
  entries.filter((entry) => entry.where === where && (entry.state ?? null) === state);

/**
 * The translation from a path as the graph spells it to a path as the counting
 * rule spells it, for one set of services.
 *
 * The counting rule names a file relative to the clone. The graph names it
 * relative to the service that read it, which for a declared package is
 * `../../packages/lib/…`. `services` is `{ name, repo }` with `repo` relative to
 * the clone, `.` for a service at its root.
 *
 * A service that is not in the list is placed nowhere, and the answer is
 * `undefined` rather than the root. It used to be the root, and a path joined to
 * the wrong directory is not a smaller error than no path: it can name a file
 * that does not exist, or worse one that does and was not read (R154). The
 * caller says how many it could not place.
 *
 * A `Map`, because a service name is a word from somebody's configuration and
 * `constructor` is as good a name for a service as any.
 */
export const clonePaths = (services) => {
  const roots = new Map(services.map((service) => [service.name, service.repo]));
  return (file, service) => {
    const root = roots.get(service);
    if (root === undefined) return undefined;
    // Only the graph's own separator and `..` need normalising; `join` does both.
    return join(root === '.' ? '' : root, file).split('\\').join('/');
  };
};

/**
 * Node types that belong to the project rather than to one service.
 *
 * The linker's own list (`isShared` in `packages/linker/src/merge.ts`): a channel
 * and a third party are one node for every service that reaches them, and the
 * `repo` such a node carries is whichever service the merge met first. It is
 * therefore not evidence about who drew an edge. A consumer's `consumes` edge
 * runs *from* the channel, and its site is in the consumer's service.
 */
const SHARED_NODES = new Set(['channel', 'external_api']);

/**
 * The service that drew an edge, from what the graph records, or nothing.
 *
 * An edge carries no service of its own. What it carries is its two ends, and an
 * edge is recorded by the service that read its site, which is the service of
 * the end that belongs to one: the source, unless the source is a node the whole
 * project shares, and then the target. No guess from the path, and no default:
 * an edge whose ends are both shared, or missing from the graph, is reported as
 * unplaced by the caller.
 */
const serviceOfEdge = (edge, nodes) => {
  for (const id of [edge.from, edge.to]) {
    const node = nodes.get(id);
    if (node !== undefined && !SHARED_NODES.has(node.type)) return node.repo;
  }
  return undefined;
};

/**
 * The service type a build gives a service it knows only from a document.
 *
 * `DECLARED_SERVICE_TYPE` in `packages/core/src/config.ts`: a service written
 * with an `openapi` or `document` field and no repository is summarised in the
 * graph's `services` with this type, and it is the only thing the graph states
 * about it that says there is no source behind it.
 */
const DOCUMENT_ONLY = 'declared';

/**
 * The services of a graph that have no source to read (R160).
 *
 * **A service declared only by a document has no file the counting rule can
 * count, so nothing it contributes can speak for one, and nothing it contributes
 * is unplaced either.** Its nodes, its rows and the edges it drew are filed at
 * the document - `contracts/billing.json` - which is not source, under a
 * directory that is wherever the document happens to live and that two such
 * services may share. Placing them would either land on no file or, worse, on a
 * real one that shares the path; calling them unplaced would fail a project for
 * reading a document it was asked to read. So they are set aside, and counted,
 * because a gate that drops something should say how much.
 *
 * The rule is stated from what the graph records - a service's `type` in the
 * build's own summary - and never from a fixture's or a target's name. A repository
 * graph has no `services`, and nothing in it is set aside.
 */
const documentOnlyServices = (graph) =>
  new Set(
    (graph.services ?? [])
      .filter((service) => service.type === DOCUMENT_ONLY)
      .map((service) => service.name),
  );

/** Which families one edge speaks for: its kind's, through a node of that family. */
const familiesOfEdge = (edge, nodes) => {
  const owners = SPOKEN_FOR_BY.edges.get(edge.type) ?? [];
  if (owners.length === 0) return owners;
  const touched = new Set(
    [edge.from, edge.to].flatMap((id) => SPOKEN_FOR_BY.types.get(nodes.get(id)?.type) ?? []),
  );
  return owners.filter((family) => touched.has(family));
};

/**
 * What one graph says about each file: which families something in it answers.
 *
 * `toPath` turns a path as the graph spells it into a path as the counting rule
 * spells it. They differ whenever a service is not the root of the tree being
 * counted - a node of a declared package is reported relative to the service
 * that read it, as `../../packages/lib/…` - and comparing the two spellings
 * without that translation would report every file of every declared package as
 * unread.
 *
 * Each of the three is translated with the service that produced it: a node
 * with its `repo`, a row with its `service`, and an edge with the service of
 * the end that belongs to one (`serviceOfEdge`). Whatever cannot be placed is
 * listed in `unplaced` and counts for no file, because the one place it could
 * have defaulted to - the clone's root - is a place it was not read from. An
 * edge or a row that speaks for no family is still placed, so that one nobody
 * can place is still reported. What a document-only service contributed is
 * neither: it is counted in `documentOnly` and read no further.
 *
 * What each one answers is `SPOKEN_FOR_BY`, which is the table beside `GATED`
 * and nothing else (R160).
 */
const readingOf = (graph, toPath) => {
  const nodes = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const declared = documentOnlyServices(graph);
  const documentOnly = { services: [...declared].sort(), nodes: 0, edges: 0, rows: 0 };
  const answered = new Map();
  const unplaced = [];
  const place = (what, file, service, families) => {
    if (declared.has(service)) {
      documentOnly[`${what}s`] += 1;
      return;
    }
    const path = toPath(file, service);
    if (path === undefined) {
      unplaced.push({ what, file, service });
      return;
    }
    const found = answered.get(path) ?? new Set();
    for (const family of families) found.add(family);
    answered.set(path, found);
  };
  for (const node of nodes.values()) {
    if (node.file === undefined) continue;
    place('node', node.file, node.repo, SPOKEN_FOR_BY.types.get(node.type) ?? []);
  }
  for (const row of graph.unresolved ?? []) {
    if (typeof row.file !== 'string') continue;
    place('row', row.file, row.service, SPOKEN_FOR_BY.reasons.get(row.reason) ?? []);
  }
  // An edge recorded at a site is the reader saying it read that line, even
  // where the node it drew from lives in another file - in the service that
  // drew it (R154), and for the family its kind belongs to (R160).
  for (const edge of graph.edges ?? []) {
    if (typeof edge.file !== 'string') continue;
    const service = serviceOfEdge(edge, nodes);
    // No default for an edge whose service cannot be named: not even the root.
    if (service === undefined) unplaced.push({ what: 'edge', file: edge.file, service });
    else place('edge', edge.file, service, familiesOfEdge(edge, nodes));
  }
  return { answered, unplaced, documentOnly };
};

/**
 * Split what went unread into the red that is baselined and the red that is new.
 *
 * Three outcomes, and each is a different sentence to a reader. A row a baseline
 * entry covers is `known`. A row no entry covers is `missing` and fails the run,
 * which is what the gate did with every row before R124. An entry whose count no
 * longer matches what was found is `drift`, and fails too - upwards because a
 * file went unread that had not before, downwards because the excuse has outlived
 * the debt.
 *
 * `found` is reported beside `files` on a drift row rather than only the
 * difference, so the fix is to read the diff and change one number rather than to
 * work out which number was meant.
 */
const againstBaseline = (baseline, where, state, missing) => {
  const entries = baselineFor(baseline, where, state);
  if (entries.length === 0) return { missing, known: [], drift: [] };
  const counted = new Map(entries.map((entry) => [entry, 0]));
  const unexplained = [];
  const known = [];
  for (const row of missing) {
    const entry = entries.find((candidate) => candidate.family === row.family && covers(candidate, row.path));
    if (entry === undefined) {
      unexplained.push(row);
      continue;
    }
    counted.set(entry, counted.get(entry) + 1);
    known.push({ ...row, ticket: entry.ticket });
  }
  const drift = [...counted.entries()]
    .filter(([entry, found]) => found !== entry.files)
    .map(([entry, found]) => ({ ...entry, found }));
  return { missing: unexplained, known, drift };
};

/**
 * Every file that had sites of a family and produced nothing for it.
 *
 * `perFile` is the counting rule's own per-file fold, so the gate and the
 * denominators cannot disagree about where a site is.
 *
 * `state` names which measurement this is - `fresh`, `with-deps`, or `null` over
 * the fixtures - and exists only so the baseline can be keyed on it. Nothing else
 * in the assertion looks at it: what a file is allowed to yield does not depend
 * on whether anybody ran an install.
 */
export const readGate = ({
  where,
  state = null,
  perFile,
  graph,
  toPath,
  exempt = [],
  baseline = [],
}) => {
  // A target brings its own entries, from its record; a fixture's are above.
  const exemptions = [...EXEMPT, ...exempt.map((entry) => ({ ...entry, where }))];
  const baselined = [...BASELINE, ...baseline.map((entry) => ({ ...entry, where }))];
  const { answered, unplaced, documentOnly } = readingOf(graph, toPath);
  const missing = [];
  const used = new Set();
  const total = new Map();
  for (const [path, sites] of perFile) {
    for (const [family, count] of Object.entries(sites)) {
      total.set(family, (total.get(family) ?? 0) + count);
    }
    const spoken = answered.get(path) ?? new Set();
    for (const [family, count] of Object.entries(sites)) {
      const gated = FAMILY.get(family);
      if (gated === undefined || !gated.perFile) continue;
      if (spoken.has(family)) continue;
      const exemption = exemptionFor(exemptions, where, path, family);
      if (exemption !== undefined) {
        used.add(exemptionKey(exemption));
        continue;
      }
      missing.push({ path, family, sites: count });
    }
  }
  // The families no file-level question can be asked about, at strength 1.
  const present = new Set((graph.nodes ?? []).map((node) => node.type));
  for (const [family, gated] of FAMILY) {
    if (gated.perFile || (total.get(family) ?? 0) === 0) continue;
    if (gated.types.some((type) => present.has(type))) continue;
    const exemption = exemptionFor(exemptions, where, '(anywhere)', family);
    if (exemption !== undefined) {
      used.add(exemptionKey(exemption));
      continue;
    }
    missing.push({ path: '(anywhere)', family, sites: total.get(family) });
  }
  missing.sort((a, b) =>
    a.path === b.path ? (a.family < b.family ? -1 : 1) : a.path < b.path ? -1 : 1,
  );
  const stale = exemptions.filter(
    (entry) => entry.where === where && !used.has(exemptionKey(entry)),
  );
  const split = againstBaseline(baselined, where, state, missing);
  return {
    where,
    state,
    files: perFile.size,
    missing: split.missing,
    known: split.known,
    drift: split.drift,
    stale,
    unplaced,
    documentOnly,
    blind: BLIND.length,
  };
};

/** `[path, text]` pairs for every source file under a directory, by the rule. */
const sourceUnder = (dir) => {
  const files = [];
  const visit = (at) => {
    let entries;
    try {
      entries = readdirSync(join(dir, at), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = at === '' ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) visit(path);
        continue;
      }
      if (!isSourceFile(path)) continue;
      try {
        files.push([path, readFileSync(join(dir, path), 'utf8')]);
      } catch {
        /* a file the rule can see and the filesystem will not give up */
      }
    }
  };
  visit('');
  return files;
};

/**
 * The graphs a fixture keeps, and how each spells a path.
 *
 * A repository graph is one service at the root of the fixture, so a path in it
 * is already a path in the tree. A project graph links every service the
 * fixture's configuration names, each at its own directory, and says where in
 * its own `services`: that directory is relative to the configuration, which
 * sits at the fixture's root, so `clonePaths` places each path exactly as the
 * harness places a target's. Until R160 only the first kind was gated, and 36
 * fixtures that keep only the second were skipped in silence.
 */
const EXPECTED_GRAPHS = [
  ['expected.graph.json', () => (file) => file],
  ['expected.project-graph.json', (graph) => clonePaths(graph.services ?? [])],
];

/** The gate over one fixture: one result per expected graph it keeps. */
const overFixture = (name, fixtures = FIXTURES) => {
  const dir = join(fixtures, name);
  const kept = EXPECTED_GRAPHS.filter(([file]) => existsSync(join(dir, file)));
  if (kept.length === 0) return [];
  const { perFile } = measureSites(sourceUnder(dir));
  return kept.map(([file, pathsOf]) => {
    const graph = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    return { ...readGate({ where: name, perFile, graph, toPath: pathsOf(graph) }), graph: file };
  });
};

/**
 * An exemption is stale for a fixture only when none of its graphs used it: a
 * fixture that keeps both graphs reads the same tree twice, and an exemption one
 * of them needs is not an exemption the other has made stale.
 */
const staleInEvery = (results) =>
  results
    .map((result) => result.stale)
    .reduce((left, right) => left.filter((entry) => right.includes(entry)));

const main = () => {
  const argv = process.argv.slice(2);
  const chosen = [];
  // `--root` for the same reason `invariants.sh` has one: the only honest way to
  // watch a gate fail is to hand it a tree that breaks it, and doing that inside
  // this repository would mean committing the very thing being forbidden.
  let fixtures = FIXTURES;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fixture' && argv[index + 1] !== undefined) {
      chosen.push(argv[(index += 1)]);
      continue;
    }
    if (argv[index] === '--root' && argv[index + 1] !== undefined) {
      fixtures = resolve(argv[(index += 1)]);
      continue;
    }
    console.error(`unknown argument: ${argv[index]}`);
    console.error('usage: read-gate.mjs [--root DIR] [--fixture NAME]');
    process.exit(2);
  }
  const names =
    chosen.length > 0
      ? chosen
      : readdirSync(fixtures, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
  let failed = 0;
  let checked = 0;
  let fixturesChecked = 0;
  const setAside = { services: 0, outputs: 0 };
  for (const name of names) {
    const results = overFixture(name, fixtures);
    if (results.length === 0) continue;
    fixturesChecked += 1;
    for (const result of results) {
      checked += 1;
      const where = results.length === 1 ? name : `${name} (${result.graph})`;
      const aside = result.documentOnly;
      setAside.services += aside.services.length;
      setAside.outputs += aside.nodes + aside.edges + aside.rows;
      for (const row of result.missing) {
        console.error(
          `    ${where}: ${row.path} has ${row.sites} ${row.family} site(s) and yielded no ${row.family} node and no row`,
        );
        failed += 1;
      }
      for (const row of result.drift) {
        console.error(
          `    ${where}: the baseline for ${row.path} (${row.family}) says ${row.files} file(s) and the run found ${row.found}` +
            `${row.found === 0 ? ' - it is no longer needed, delete it' : ''}`,
        );
        failed += 1;
      }
      for (const row of result.unplaced) {
        console.error(`    ${where}: the ${row.what} at ${row.file} belongs to no service the gate can name`);
        failed += 1;
      }
    }
    for (const row of staleInEvery(results)) {
      console.error(`    ${name}: exemption for ${row.path} (${row.family}) is no longer needed`);
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(`    FAIL: ${failed} file(s) the counting rule can see produced nothing.`);
    console.error('    Either the reader is skipping them in silence, or the skip needs a row.');
    process.exit(1);
  }
  // The clause after the comma is the point of R124's second half. `read gate
  // ok` is a sentence about one assertion, and R119 got it out of a graph it had
  // broken on purpose; saying how many failures this gate is known not to see,
  // every time it passes, is what stops "ok" from being read as "read".
  console.log(
    `read gate ok over ${checked} graph(s) of ${fixturesChecked} fixture(s); ` +
      `${setAside.outputs} output(s) of ${setAside.services} document-only service(s) set aside; ` +
      `${BLIND.length} kind(s) of failure it cannot see (BLIND in ${relative(ROOT, fileURLToPath(import.meta.url))})`,
  );
};

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) main();

export { overFixture, serviceOfEdge, sourceUnder };
