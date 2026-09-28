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
 * **extent** of the service being read, whose extension is one of
 * `SOURCE_EXTENSIONS`, and none
 * of whose path segments is one of `SKIPPED_SEGMENTS`, whose name does not
 * match `SKIPPED_FILES`, and which is not a test. What a test is comes from
 * `isTestFile` in `@flowatlas/core`, the definition the tool reads by, and from
 * nowhere else: a rule that counted a test the tool never opens would expect
 * nodes from it, and that is how six of cal.com's `*.integration-test.ts` files
 * came to fail the read gate (R157). Nothing is read that git does not carry, so a build
 * directory somebody left behind and an installed dependency are both invisible
 * whatever state the clone is in, and the same file list is counted whether the
 * dependencies are installed or not.
 *
 * The extent - a service's own directory plus the workspace packages it declares
 * - is worked out in `extent.mjs`, from the repository's own manifests and from
 * nothing else. It is a fact about the files, in the same way that the extension
 * and the path segments above are, which is why the rule may use it without
 * acquiring an opinion about the tool: see that file's header for why it reads
 * the manifests itself rather than asking the tool what a service is. What stays
 * out of here is unchanged - no probe is switched on per target, and no target
 * may say how to count.
 *
 * A **probe** is a named pattern with a scope. A `line` probe is a regular
 * expression matched against the whole file with the global flag, and every
 * match is one site, so two routes declared on one line count twice; it may also
 * name the `path` a file must be at. A `file`
 * probe matches on the path, optionally requires a pattern in the contents, and
 * counts the whole file as one site, which is how a router that keeps the
 * address in the directory name is counted at all.
 *
 * A probe reads **code, not comments**. A comment is somebody describing a
 * declaration, not making one: cal.com's `getMetadataHelpers.ts` shows its
 * caller's `prisma.team.update(…)` in a doc comment, and medusa's
 * `create-pg-connection.ts` says "a new knex (pg in the future) connection" above
 * a function that runs no query. Both were counted, and each needed somebody to
 * read the file and write an excuse for it (R157). So every file of code has its
 * comments blanked before a probe sees it (`withoutComments` below): each
 * character becomes a space and every line break stays, so no match moves.
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
import { isTestFile } from '@flowatlas/core';

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
 * Path segments that take a file out of the count, a test's apart.
 *
 * Matched as whole segments rather than as substrings, so `src/build-utils` is
 * source and `src/build` is not. What is here is output, somebody else's code,
 * and code nobody runs as the system: a build, a dependency, an example, a
 * story, a generated client. A test's directories - `test`, `__tests__`,
 * `playwright` and the rest - used to be listed here too, and the tool read
 * every one of them; they are part of what a test is now, which `isTestFile` in
 * `@flowatlas/core` says for the tool and for this rule at once (R157). Tests
 * declare routes that are never served and queries that only seed rows, and
 * counting them would put things in the denominator the tool is right not to
 * have found.
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
  'examples',
  'example',
  'storybook',
  '.storybook',
  'generated',
  'vendor',
]);

/**
 * File names that are not somebody declaring something, a test apart.
 *
 * A test is left out as well, by `isTestFile` rather than by a pattern here: the
 * tool does not read what this rule does not count, and the two used to keep a
 * list each and disagree about `*.integration-test.ts` (R157).
 */
export const SKIPPED_FILES = /(?:\.stories\.|\.d\.ts$|\.min\.js$)/;

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
    //
    // In a file a router serves, and in no other. Such a router knows its files
    // by name - `route.*` for the Next.js App Router and Medusa, `+server.*` for
    // SvelteKit - so a verb exported anywhere else is a function called `GET`
    // that a route file imports and wraps, and not a way in. cal.com's
    // `tasker/api/cron.ts` is served from `apps/web/app/api/tasks/cron/route.ts`;
    // payload's `routes/rest/index.ts` builds the handlers its route files
    // export. Counting those put one way in into the denominator twice, at the
    // file that is served and at the file its handler came from (R157).
    what: 'an exported handler named for an HTTP verb, in a file a router serves',
    path: /(?:^|\/)(?:route|\+server)\.[cm]?[jt]sx?$/,
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
  return !SKIPPED_FILES.test(segments[segments.length - 1]) && !isTestFile(path);
};

/**
 * Where a slash is a regular expression rather than a division: where an
 * operand is due. After an operator, an opening bracket, a comma or a
 * semicolon, after a keyword that takes an expression, and at the start of the
 * file. A regular expression matters here only because it may hold `//` or `/*`
 * and be read as a comment's opening; a division never does.
 */
const OPERAND_DUE = /(?:^|[=(,:;!&|?{}[+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))$/;

/**
 * The same text with every comment blanked: each character a space and each
 * line break kept, so a probe's match stays on the line it was on.
 *
 * Not a parser, and deliberately small. It knows where a comment, a string, a
 * template and a regular expression begin and end, which is what it takes to
 * tell `// prisma.user.findMany()` from `prisma.user.findMany()` and to leave
 * `'http://x/*'` a string. A template's `${…}` is read as part of the template,
 * so a comment written inside an interpolation stays; that is the rarer case,
 * and keeping it errs towards counting, which is this rule's side.
 */
export const withoutComments = (text) => {
  let out = '';
  let kept = 0;
  let before = '';
  const blankFrom = (start, stop) => {
    out += text.slice(kept, start) + text.slice(start, stop).replace(/[^\n]/g, ' ');
    kept = stop;
  };
  const endOfQuoted = (quote, start) => {
    let index = start + 1;
    while (index < text.length && text[index] !== quote) {
      if (text[index] === '\\') index += 1;
      else if (text[index] === '\n' && quote !== '`') return index;
      index += 1;
    }
    return Math.min(index + 1, text.length);
  };
  const endOfRegex = (start) => {
    let index = start + 1;
    let inClass = false;
    while (index < text.length && text[index] !== '\n') {
      const char = text[index];
      if (char === '\\') index += 1;
      else if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) return index + 1;
      index += 1;
    }
    return index;
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const next = text[at + 1];
    if (char === '/' && (next === '/' || next === '*')) {
      const close = next === '/' ? text.indexOf('\n', at) : text.indexOf('*/', at + 2);
      const stop = close === -1 ? text.length : next === '/' ? close : close + 2;
      blankFrom(at, stop);
      at = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      at = endOfQuoted(char, at);
      before = char;
      continue;
    }
    if (char === '/' && OPERAND_DUE.test(before)) {
      at = endOfRegex(at);
      before = '/';
      continue;
    }
    if (!/\s/.test(char)) before = /[\w$]/.test(char) ? (/[\w$]$/.test(before) ? before : '') + char : char;
    at += 1;
  }
  return out + text.slice(kept);
};

/**
 * Files whose comments a probe must not read: every kind of code, and a Prisma
 * schema, whose `//` and `///` are line comments too. A template is markup,
 * where `//` is part of an address and nothing is a comment of this kind.
 */
const COMMENTED = new Set(SOURCE_EXTENSIONS.filter((extension) => extension !== '.html'));

/** What a probe reads: the file, with its comments blanked where it has any. */
const codeOf = (path, text) => (COMMENTED.has(extensionOf(path)) ? withoutComments(text) : text);

const countLine = (probe, path, text) => {
  if (probe.path !== undefined && !probe.path.test(path)) return 0;
  probe.pattern.lastIndex = 0;
  let sites = 0;
  while (probe.pattern.exec(text) !== null) sites += 1;
  return sites;
};

const countFile = (probe, path, text) =>
  probe.path.test(path) && (probe.contains === undefined || probe.contains.test(text)) ? 1 : 0;

/** Strategy by scope, so adding a third kind of probe adds a row and no branch. */
const COUNTERS = {
  line: (probe, path, text) => countLine(probe, path, text),
  file: (probe, path, text) => countFile(probe, path, text),
};

/** Which family each probe belongs to, so a per-file fold costs no search. */
const FAMILY_OF = Object.fromEntries(PROBES.map((probe) => [probe.name, probe.family]));

/**
 * Every probe's site count over a list of already-read files, twice folded.
 *
 * `files` is `[path, text]` pairs so that each file is read from disk exactly
 * once however many probes want to look at it; on a repository of forty
 * thousand files that is the difference between seconds and minutes. The two
 * folds are computed in the one pass for the same reason: the regular
 * expressions are the expensive part of a measurement and running them twice to
 * answer two questions about the same match would double it.
 *
 * `byProbe` totals the repository. `perFile` is the same counts kept per file
 * and per family, and only for files where something was found, which is what
 * lets a gate ask the one question a total cannot answer: did *this* file, where
 * the rule can see something, produce anything at all.
 */
export const measureSites = (files) => {
  const byProbe = Object.fromEntries(PROBES.map((probe) => [probe.name, 0]));
  const perFile = new Map();
  for (const [path, source] of files) {
    const text = codeOf(path, source);
    let found;
    for (const probe of PROBES) {
      const sites = COUNTERS[probe.scope](probe, path, text);
      if (sites === 0) continue;
      byProbe[probe.name] += sites;
      found ??= {};
      const family = FAMILY_OF[probe.name];
      found[family] = (found[family] ?? 0) + sites;
    }
    if (found !== undefined) perFile.set(path, found);
  }
  return { byProbe, perFile };
};

/** Every probe's site count, for callers that want only the totals. */
export const countSites = (files) => measureSites(files).byProbe;

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
