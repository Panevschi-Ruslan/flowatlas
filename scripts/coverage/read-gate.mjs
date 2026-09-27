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
 * Over the fixtures it reads each one's committed `expected.graph.json`, which
 * is ground truth this repository already maintains, so the gate costs a second
 * and needs nothing cloned. The harness applies the same function to the
 * coverage targets, where the tree is somebody else's repository and the graph
 * is the one just built.
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
 */
const GATED = {
  routes: { types: new Set(['entry']), perFile: true },
  screens: { types: new Set(['ui_component']), perFile: true },
  clicks: { types: new Set(['ui_action']), perFile: true },
  data: { types: new Set(['db_query', 'cache_op']), perFile: true },
  models: { types: new Set(['table']), perFile: false },
};

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
    where: 'novu',
    path: 'packages/novu/src/commands/init/templates/**',
    family: 'routes',
    why:
      'Files the command-line tool copies into somebody else’s project when they ' +
      'scaffold one. They are route handlers, and the counting rule is right to see ' +
      'them - it counts what somebody wrote down, and over-counting is the direction ' +
      'it errs in on purpose - but they are not this service’s routes: nothing ' +
      'imports them, no tsconfig here compiles them, and a reader that produced ' +
      'entry points for them would be reporting addresses that this repository does ' +
      'not serve. They arrived in the denominator with the extent, because the ' +
      'package holding them is one the service declares.',
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
  // Medusa's four, all decided in R137 by reading the file rather than the count.
  {
    where: 'medusa',
    path: 'packages/medusa-test-utils/**',
    family: 'routes',
    why:
      'The package integration tests start a server with. Its one route is a ' +
      '`/health` on an application `bootstrapApp` builds for a test runner, which ' +
      'no deployment of this service starts: the service’s own `/health` is ' +
      'declared in `packages/medusa/src/commands/start.ts` (see `BASELINE`). It ' +
      'is in the extent because modules the service declares, `@medusajs/order` among ' +
      'them, name `@medusajs/test-utils` as a dev dependency, ' +
      'and a reader that placed its address would be reporting a second health ' +
      'check this service does not serve.',
  },
  {
    where: 'medusa',
    path: 'packages/medusa/src/migration-scripts/**',
    family: 'data',
    why:
      'Data migrations `medusa db:migrate:scripts` runs once per database and records ' +
      'in `script_migrations`, never on a request. The connection each step uses is ' +
      '`container.resolve(PG_CONNECTION)`, which the container types as `any`, so ' +
      'nothing in the source says which library `knex(table)` belongs to and a ' +
      'reader that named one would be guessing from a variable name.',
  },
  {
    where: 'medusa',
    path: 'packages/core/utils/src/modules-sdk/create-pg-connection.ts',
    family: 'data',
    why:
      'The one site is the words "a new knex (pg in the future) connection" in ' +
      'the doc comment above `createPgConnection`. The counting rule reads lines, ' +
      'not syntax, and over-counts in that direction on purpose; the function ' +
      'itself builds a connection and runs no query.',
  },
  {
    where: 'medusa',
    path: '(anywhere)',
    family: 'models',
    why:
      'The one site is `@Entity({ abstract: true })` on the MikroORM base class in ' +
      '`packages/core/utils/src/dal/mikro-orm/base-entity.ts`, which declares no ' +
      'table: an abstract entity is the columns every table shares. Medusa ' +
      'declares its tables with `model.define(…)`, which the counting rule has no ' +
      'probe for, so the family’s real denominator here is zero and this gate ' +
      'cannot see it (`BLIND`, R117). The day a probe counts `model.define`, this ' +
      'entry stops being the only thing the family says and should be re-read.',
  },
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
      'takes a `handles` edge to *each* controller’s method, an edge recorded at a ' +
      'site counts as the reader having read that line, so `spokenFor` contains the ' +
      'losing file and the gate skips it. Strength 2 asks whether anything was said ' +
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
 * with its dependencies installed: outline is 45 files on a fresh clone and 0
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
  {
    where: 'outline',
    state: 'fresh',
    family: 'routes',
    path: 'plugins/**',
    files: 11,
    ticket: 'R121',
    why:
      'Every plugin mounts a router of its own and hangs handlers off it, and that ' +
      'convention has no reader. Eleven files of it. The gate is right to say so; ' +
      'what it must not do is say so in the same breath as a regression somewhere ' +
      'else. This goes the day the convention gets a reader, and the gate will then ' +
      'insist on it.',
  },
  {
    where: 'outline',
    state: 'fresh',
    family: 'routes',
    path: 'server/routes/**',
    files: 34,
    ticket: 'R121',
    why:
      'The same convention in the service itself: thirty-four files declaring ' +
      'handlers on a router assembled by a helper, none of which yields an entry ' +
      'point. Together with the eleven above this is outline’s entire route surface, ' +
      'which is why the target has never once passed this gate - and why a second, ' +
      'unrelated loss here has had somewhere to hide for as long as the gate has ' +
      'existed.',
  },
  // Medusa's two kinds of known red (R137). Neither is a file that serves
  // nothing - those are in `EXEMPT` - and both are recorded here so that a third
  // file going unread beside them is new red rather than more of the same.
  {
    where: 'medusa',
    state: 'fresh',
    family: 'routes',
    path: 'packages/medusa/src/commands/start.ts',
    files: 1,
    ticket: 'R137',
    why:
      'The service’s own `GET /health`, declared on `const app = express()`. With ' +
      'dependencies installed it is read and the with-deps report holds its entry; ' +
      'on a fresh clone `express` has no types, so `app` is `any` and the Express ' +
      'reader, which knows an application by its type and by nothing else, cannot ' +
      'tell it from any other object with a `get`. The same cause leaves ' +
      'PeerTube’s fresh clone with no addresses at all.',
  },
  {
    where: 'medusa',
    state: 'fresh',
    family: 'routes',
    path: 'packages/admin/admin-bundler/src/commands/serve.ts',
    files: 1,
    ticket: 'R137',
    why:
      'The admin dashboard’s two catch-all `GET`s, declared on `Router()` from ' +
      '`express`. Read with dependencies installed, and unread fresh for the reason ' +
      'the entry above gives: the router’s type is in a package a fresh clone does ' +
      'not have.',
  },
  ...['fresh', 'with-deps'].map((state) => ({
    where: 'medusa',
    state,
    family: 'data',
    path: 'packages/modules/inventory/src/repositories/inventory-level.ts',
    files: 1,
    ticket: 'R137',
    why:
      'A gap, not an exemption: the queries a real repository of the inventory ' +
      'module runs on every stock lookup, and nothing reads them. The cause is ' +
      'not in any reader. The service that calls it imports it as ' +
      '`@repositories`, a path the inventory package’s own tsconfig maps and the ' +
      'medusa service’s does not, and the project is compiled with one set of ' +
      'paths, so the import resolves to nothing and the class is never reached; ' +
      'the call site in `services/inventory-level.ts` says so with ' +
      '`db-receiver-name-only`. Every module here writes `@models` and `@services` ' +
      'the same way. Reading a declared package with its own tsconfig’s paths is ' +
      'a change to how the core builds a project, and when it lands this count ' +
      'drops to zero and fails, which is the point.',
  })),
];

const exemptionKey = (entry) => `${entry.where} ${entry.path} ${entry.family}`;

/** An exemption's or a baseline's `path`: one file, or a subtree ending in `/**`. */
const covers = (entry, path) =>
  entry.path.endsWith('/**') ? path.startsWith(entry.path.slice(0, -2)) : entry.path === path;

const exemptionFor = (where, path, family) =>
  EXEMPT.find((entry) => entry.where === where && entry.family === family && covers(entry, path));

/**
 * The baseline entries that belong to one measurement.
 *
 * `state` is `null` over the fixtures, where there is only one state and the
 * question does not arise. An entry written without a state therefore matches
 * the fixtures and nothing else, which is the safer default of the two: a
 * baseline that silently applied to both states of a target would be an excuse
 * doing twice the work it was reviewed for.
 */
const baselineFor = (where, state) =>
  BASELINE.filter((entry) => entry.where === where && (entry.state ?? null) === state);

/**
 * What one graph says about each file: which families it yielded, and whether
 * anything at all was said about it.
 *
 * `toPath` turns a path as the graph spells it into a path as the counting rule
 * spells it. They differ whenever a service is not the root of the tree being
 * counted - a node of a declared package is reported relative to the service
 * that read it, as `../../packages/lib/…` - and comparing the two spellings
 * without that translation would report every file of every declared package as
 * unread.
 */
const readingOf = (graph, toPath) => {
  const families = new Map();
  for (const node of graph.nodes ?? []) {
    if (node.file === undefined) continue;
    const path = toPath(node.file, node.repo);
    if (path === undefined) continue;
    const found = families.get(path) ?? new Set();
    found.add(node.type);
    families.set(path, found);
  }
  const spokenFor = new Set();
  for (const row of graph.unresolved ?? []) {
    if (typeof row.file !== 'string') continue;
    const path = toPath(row.file, row.service);
    if (path !== undefined) spokenFor.add(path);
  }
  // An edge recorded at a site is the reader saying it read that line, even
  // where the node it drew from lives in another file. A file whose only output
  // is an edge is read, not skipped.
  for (const edge of graph.edges ?? []) {
    if (typeof edge.file !== 'string') continue;
    const path = toPath(edge.file, undefined);
    if (path !== undefined) spokenFor.add(path);
  }
  return { families, spokenFor };
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
const againstBaseline = (where, state, missing) => {
  const entries = baselineFor(where, state);
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
export const readGate = ({ where, state = null, perFile, graph, toPath }) => {
  const { families, spokenFor } = readingOf(graph, toPath);
  const missing = [];
  const used = new Set();
  const total = {};
  for (const [path, sites] of perFile) {
    for (const [family, count] of Object.entries(sites)) {
      total[family] = (total[family] ?? 0) + count;
    }
    if (spokenFor.has(path)) continue;
    const types = families.get(path) ?? new Set();
    for (const [family, count] of Object.entries(sites)) {
      const gated = GATED[family];
      if (gated === undefined || !gated.perFile) continue;
      if ([...types].some((type) => gated.types.has(type))) continue;
      const exemption = exemptionFor(where, path, family);
      if (exemption !== undefined) {
        used.add(exemptionKey(exemption));
        continue;
      }
      missing.push({ path, family, sites: count });
    }
  }
  // The families no file-level question can be asked about, at strength 1.
  const present = new Set((graph.nodes ?? []).map((node) => node.type));
  for (const [family, gated] of Object.entries(GATED)) {
    if (gated.perFile || (total[family] ?? 0) === 0) continue;
    if ([...gated.types].some((type) => present.has(type))) continue;
    const exemption = exemptionFor(where, '(anywhere)', family);
    if (exemption !== undefined) {
      used.add(exemptionKey(exemption));
      continue;
    }
    missing.push({ path: '(anywhere)', family, sites: total[family] });
  }
  missing.sort((a, b) =>
    a.path === b.path ? (a.family < b.family ? -1 : 1) : a.path < b.path ? -1 : 1,
  );
  const stale = EXEMPT.filter(
    (entry) => entry.where === where && !used.has(exemptionKey(entry)),
  );
  const split = againstBaseline(where, state, missing);
  return {
    where,
    state,
    files: perFile.size,
    missing: split.missing,
    known: split.known,
    drift: split.drift,
    stale,
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

/** The gate over one fixture, read from its committed expected graph. */
const overFixture = (name, fixtures = FIXTURES) => {
  const dir = join(fixtures, name);
  const expected = join(dir, 'expected.graph.json');
  if (!existsSync(expected)) return undefined;
  const graph = JSON.parse(readFileSync(expected, 'utf8'));
  const { perFile } = measureSites(sourceUnder(dir));
  return readGate({ where: name, perFile, graph, toPath: (file) => file });
};

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
  for (const name of names) {
    const result = overFixture(name, fixtures);
    if (result === undefined) continue;
    checked += 1;
    for (const row of result.missing) {
      console.error(
        `    ${name}: ${row.path} has ${row.sites} ${row.family} site(s) and yielded no ${row.family} node and no row`,
      );
      failed += 1;
    }
    for (const row of result.drift) {
      console.error(
        `    ${name}: the baseline for ${row.path} (${row.family}) says ${row.files} file(s) and the run found ${row.found}` +
          `${row.found === 0 ? ' - it is no longer needed, delete it' : ''}`,
      );
      failed += 1;
    }
    for (const row of result.stale) {
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
    `read gate ok over ${checked} fixture(s); ${BLIND.length} kind(s) of failure it cannot see (BLIND in ${relative(ROOT, fileURLToPath(import.meta.url))})`,
  );
};

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) main();

export { overFixture, sourceUnder };
