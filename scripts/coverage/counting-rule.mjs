/**
 * Ground truth, by one rule, written down once.
 *
 * Twenty-five defects were found by measuring this tool against eight real
 * repositories by hand. Four agents did the measuring and four counting methods
 * came back, two of which said so in the margin. A denominator that depends on
 * who was holding the pen is not a denominator, so this file replaces all four
 * with one rule, and the rule is here rather than in the per-repository data on
 * purpose: a target may say which directory to read, and it may never say how
 * to count what is in it.
 *
 * ## The rule
 *
 * Ground truth for a repository is the number of **declaration sites** that a
 * fixed set of probes finds in that repository's own source.
 *
 * A **source file** is a file the repository tracks in git, inside the
 * directory being read, whose extension is one of `SOURCE_EXTENSIONS`, and none
 * of whose path segments is one of `SKIPPED_SEGMENTS`, and whose name does not
 * match `SKIPPED_FILES`. Nothing is read that git does not carry, so a build
 * directory somebody left behind and an installed dependency are both invisible
 * whatever state the clone is in, and the same file list is counted whether the
 * dependencies are installed or not.
 *
 * A **probe** is a named pattern with a scope. A `line` probe is a regular
 * expression matched against the whole file with the global flag, and every
 * match is one site, so two routes declared on one line count twice. A `file`
 * probe matches on the path, optionally requires a pattern in the contents, and
 * counts the whole file as one site, which is how a router that keeps the
 * address in the directory name is counted at all.
 *
 * **Every probe runs against every repository.** A probe that does not apply
 * returns zero there, and that zero is part of the answer rather than a gap in
 * it: it is how a report can say that a repository declares no NestJS routes
 * without anyone having decided in advance that it declares none. Nothing here
 * is switched on or off per target, no probe was added because one repository
 * needed a number to come out right, and a probe that is wrong is wrong
 * everywhere at once, which is the property the hand measurements did not have.
 *
 * ## What the rule is not
 *
 * It is not a parser and does not try to be. A probe counts what somebody
 * *wrote down* in a place a reader would recognise, which is the only thing a
 * denominator can honestly mean here: the question a coverage report asks is
 * "of the routes a person can see in this source, how many did the tool see",
 * and a person sees them by their shape on the page. Where the shape is
 * ambiguous the probe over-counts rather than under-counts, because a coverage
 * figure that flatters the tool is worth nothing, and the report prints the
 * probe's own name beside every figure so a suspicious number can be checked
 * against the pattern that produced it in one step.
 */

/** Extensions a probe may look at. */
export const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.prisma',
];

/**
 * Path segments that take a file out of the count.
 *
 * Matched as whole segments rather than as substrings, so `src/test-utils` is
 * source and `src/test` is not. Tests declare routes that are never served and
 * components that are never rendered; counting them would put things in the
 * denominator that the tool is right not to have found.
 */
export const SKIPPED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.yarn',
  'coverage',
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '__snapshots__',
  'e2e',
  'cypress',
  'playwright',
  'fixtures',
  '__fixtures__',
  'examples',
  'example',
  'storybook',
  '.storybook',
  'generated',
  'vendor',
]);

/** File names that are not somebody declaring something. */
export const SKIPPED_FILES = /(?:\.test\.|\.spec\.|\.stories\.|\.d\.ts$|\.min\.js$)/;

/**
 * The probes, in report order.
 *
 * `family` groups probes whose sites answer the same question, so the report
 * can print one expected figure per family beside the tool's own for that
 * family. `what` is the sentence printed beside the number.
 */
export const PROBES = [
  {
    name: 'nest-route-decorator',
    family: 'routes',
    scope: 'line',
    what: 'an HTTP method decorator on a controller method',
    // The eight verbs NestJS spells as decorators. `@All` is rare and real.
    pattern: /@(?:Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(/g,
  },
  {
    name: 'registered-route-call',
    family: 'routes',
    scope: 'line',
    what: 'a verb called on a router or an application',
    // Express, Koa, Fastify and Hono all register a route by calling the verb
    // on something. The receiver is only counted when its name ends in `app` or
    // `router`, which is what keeps `map.get(key)` and `this.http.post(url)`
    // out of a figure that would otherwise be nonsense. The run before the
    // suffix may be empty, because the receiver is very often called exactly
    // `router`; requiring at least one character in front of it scored outline
    // at zero when it registers two hundred and twenty-eight routes that way.
    //
    // A registration is told from a lookup by its arguments. `app.get(Token)`
    // is how a NestJS application asks its own container for a provider, and
    // counting it gave immich seven routes it does not have. Two shapes are a
    // registration and nothing else is: an address written down as text - a
    // string, a bare path, or a list of them in one call, which is one
    // declaration and is counted once - or any first argument followed by a
    // comma, because a route always has a handler after its address and a
    // lookup never has a second argument at all. The second shape is not
    // decoration: four of outline's routes are registered at `config.id`, and a
    // rule that demanded a literal would have called them something else.
    // The whitespace is permissive because the address is very often on the
    // line after the call.
    pattern:
      /\b[\w$]*(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|options|head|all)\s*\(\s*(?:['"`/[]|[A-Za-z_$][\w$.]*\s*,)/gi,
  },
  {
    name: 'exported-verb-handler',
    family: 'routes',
    scope: 'line',
    // A file-system router keeps the address in the directory name and the verb
    // in the name of an export. Next.js, Medusa and Payload all spell it this
    // way, which is why one probe covers three of the eight targets.
    what: 'an exported handler named for an HTTP verb',
    pattern:
      /^\s*export\s+(?:const|(?:async\s+)?function)\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/gm,
  },
  {
    name: 'pages-api-module',
    family: 'routes',
    scope: 'file',
    what: 'a file under `pages/api` that default-exports a handler',
    path: /(^|\/)pages\/api\/.+/,
    contains: /export\s+default\b/,
  },
  {
    name: 'component-declaration',
    family: 'screens',
    scope: 'line',
    what: 'an Angular component declaration',
    pattern: /@Component\s*\(/g,
  },
  {
    name: 'template-click-binding',
    family: 'clicks',
    scope: 'line',
    what: 'a click bound in a template',
    pattern: /\(click\)\s*=/g,
  },
  {
    name: 'prisma-call-site',
    family: 'data',
    scope: 'line',
    what: 'a model method called through a Prisma client',
    pattern:
      /\bprisma\s*\.\s*[A-Za-z_$][\w$]*\s*\.\s*(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*\(/g,
  },
  {
    name: 'query-builder-site',
    family: 'data',
    scope: 'line',
    what: 'a table named in a query builder',
    // Kysely and Knex both name the table in the call that starts the query,
    // which is the one place a table appears in source that has no entity class.
    pattern: /\.\s*(?:selectFrom|insertInto|updateTable|deleteFrom)\s*\(|\bknex\s*\(/g,
  },
  {
    name: 'model-declaration',
    family: 'models',
    scope: 'line',
    what: 'a table or model declared as a class or a schema',
    // An upper bound rather than a count, and the report says so: a Sequelize
    // model is usually written with `@Table` *and* `extends Model`, which is
    // one declaration spelled twice and is counted twice here. Splitting it
    // into two probes and taking the larger would be a rule about one ORM, and
    // a rule about one ORM is the thing this file exists not to have.
    pattern: /@Entity\s*\(|@Table\s*\(|\bextends\s+Model\b|^\s*model\s+[A-Za-z_]\w*\s*\{/gm,
  },
];

/**
 * Families in report order, with the sentence each one heads.
 *
 * `data` and `models` are apart because they are not the same question. A call
 * site is a place the code reaches storage and is what a query figure compares
 * against; a model declaration is a table somebody declared, and comparing the
 * first against the second would divide one kind of thing by another.
 */
export const FAMILIES = [
  ['routes', 'ways in over HTTP'],
  ['screens', 'screens'],
  ['clicks', 'things a person can click'],
  ['data', 'places the code reaches storage'],
  ['models', 'tables or models declared (an upper bound)'],
];

const extensionOf = (path) => {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
};

/** True when the path is source under the rule above. */
export const isSourceFile = (path) => {
  if (!SOURCE_EXTENSIONS.includes(extensionOf(path))) return false;
  const segments = path.split('/');
  if (segments.some((segment) => SKIPPED_SEGMENTS.has(segment))) return false;
  return !SKIPPED_FILES.test(segments[segments.length - 1]);
};

const countLine = (probe, text) => {
  probe.pattern.lastIndex = 0;
  let sites = 0;
  while (probe.pattern.exec(text) !== null) sites += 1;
  return sites;
};

const countFile = (probe, path, text) =>
  probe.path.test(path) && (probe.contains === undefined || probe.contains.test(text)) ? 1 : 0;

/** Strategy by scope, so adding a third kind of probe adds a row and no branch. */
const COUNTERS = {
  line: (probe, _path, text) => countLine(probe, text),
  file: (probe, path, text) => countFile(probe, path, text),
};

/**
 * Every probe's site count over a list of already-read files.
 *
 * `files` is `[path, text]` pairs so that each file is read from disk exactly
 * once however many probes want to look at it; on a repository of forty
 * thousand files that is the difference between seconds and minutes.
 */
export const countSites = (files) => {
  const byProbe = Object.fromEntries(PROBES.map((probe) => [probe.name, 0]));
  for (const [path, text] of files) {
    for (const probe of PROBES) {
      byProbe[probe.name] += COUNTERS[probe.scope](probe, path, text);
    }
  }
  return byProbe;
};

/** Site counts folded to one figure per family. */
export const byFamily = (byProbe) =>
  Object.fromEntries(
    FAMILIES.map(([family]) => [
      family,
      PROBES.filter((probe) => probe.family === family).reduce(
        (sum, probe) => sum + byProbe[probe.name],
        0,
      ),
    ]),
  );
