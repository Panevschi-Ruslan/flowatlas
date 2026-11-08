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
 * `SOURCE_EXTENSIONS` or whose name is one of `DECLARATION_FILES`, and none
 * of whose path segments is one of `SKIPPED_SEGMENTS`, whose name does not
 * match `SKIPPED_FILES`, and which is not a test. What a test is comes from
 * `isTestFile` in `@flowatlas/core`, the definition the tool reads by, and from
 * nowhere else: a rule that counted a test the tool never opens would expect
 * nodes from it, and that is how six of a scheduling app's `*.integration-test.ts` files
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
 * declaration, not making one: a scheduling app's `getMetadataHelpers.ts` shows its
 * caller's `prisma.team.update(…)` in a doc comment, and a commerce monorepo's
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
  // Components in files of their own format (P233).
  '.vue',
  '.svelte',
];

/**
 * Files that are not code and still declare ways in, by name: a template a
 * deployment of functions is written in (P246). A CloudFormation template may
 * be called anything (P248), so every YAML file and every `.template` is one
 * of these; a JSON file is only where its name says it is a template
 * (`template.json`, `*.template.json`, `*.cfn.json`), since most JSON is
 * something else. Only a probe that names the file by its `path` finds
 * anything in one, and its comments - outside JSON - are a `#` to the end of
 * the line.
 */
export const DECLARATION_FILES = /\.(?:ya?ml|template)$|(?:^|[/.])(?:template|cfn)\.json$/;

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
    // `router`; requiring at least one character in front of it scored a wiki app
    // at zero when it registers two hundred and twenty-eight routes that way.
    //
    // A registration is told from a lookup by its arguments. `app.get(Token)`
    // is how a NestJS application asks its own container for a provider, and
    // counting it gave a photo server seven routes it does not have. Two shapes are a
    // registration and nothing else is: an address written down as text - a
    // string, a bare path, or a list of them in one call, which is one
    // declaration and is counted once - or any first argument followed by a
    // comma, because a route always has a handler after its address and a
    // lookup never has a second argument at all. The second shape is not
    // decoration: four of a wiki app's routes are registered at `config.id`, and a
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
    // in the name of an export. Next.js and Medusa both spell it this way,
    // which is why one probe covers both.
    //
    // In a file a router serves, and in no other. Such a router knows its files
    // by name - `route.*` for the Next.js App Router and Medusa, `+server.*` for
    // SvelteKit - so a verb exported anywhere else is a function called `GET`
    // that a route file imports and wraps, and not a way in. A scheduling app's
    // `tasker/api/cron.ts` is served from `apps/web/app/api/tasks/cron/route.ts`;
    // a CMS monorepo's `routes/rest/index.ts` builds the handlers its route files
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
    name: 'component-file',
    family: 'screens',
    scope: 'file',
    what: 'a Vue or Svelte component file',
    path: /\.(?:vue|svelte)$/,
  },
  {
    name: 'component-click-binding',
    family: 'clicks',
    scope: 'line',
    what: 'a click bound in a Vue or Svelte component',
    path: /\.(?:vue|svelte)$/,
    pattern: /(?:@click|v-on:click|on:click|\bonclick)(?=[\s.|=])|\{\s*onclick\s*\}/g,
  },
  {
    name: 'graphql-resolver-field',
    family: 'routes',
    scope: 'line',
    what: 'a GraphQL field a resolver method answers (`@Query`, `@Mutation`, `@Subscription`, `@ResolveField`), counted where it is written with a type, so a REST parameter decorator is not one',
    pattern: /@(?:Query|Mutation|Subscription|ResolveField|FieldResolver)\s*\(\s*(?:\(\s*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  },
  {
    name: 'procedure-handler',
    family: 'routes',
    scope: 'line',
    what: 'a procedure of a tRPC or oRPC tree, counted where the chain that declares it ends - `.query`, `.mutation`, `.subscription` or `.handler` - handed a function written in place; one handed a named function is not counted, because `pool.query(sql)` is spelled the same way',
    // A procedure is a way in over HTTP too (R95, P58). The function written in
    // place is what tells a procedure from a database call, which ends in the
    // same word with a string or a name after it.
    pattern: /\.\s*(?:query|mutation|subscription|handler)\s*\(\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
  },
  {
    name: 'graphql-reference-resolver',
    family: 'routes',
    scope: 'line',
    what: 'the reference resolver of a federated entity (`@ResolveReference()`, `__resolveReference` in a resolver map), the way in an entity call from another subgraph reaches',
    pattern: /@ResolveReference\s*\(|\b__resolveReference\s*[(:]/g,
  },
  {
    // A function a CDK app deploys is a way in, as a route is: the platform
    // runs it (P57). Counted where it is made with a scope and an id, so the
    // language's own `new Function('return 1')` is not one.
    name: 'cdk-function-construct',
    family: 'routes',
    scope: 'line',
    what: 'a Lambda function an AWS CDK app makes (`new NodejsFunction(this, ...)`, `new lambda.Function(scope, ...)`)',
    pattern: /\bnew\s+(?:[A-Za-z_$][\w$]*\.)*(?:NodejsFunction|Function|DockerImageFunction|SingletonFunction)\s*\(\s*(?:this|[A-Za-z_$][\w$]*)\s*,/g,
  },
  {
    // A function a SAM template declares is a way in, as a route is: the
    // platform runs it (P246). Counted by its `Type`, written as YAML or JSON,
    // in any file a template may be.
    name: 'sam-function-resource',
    family: 'routes',
    scope: 'line',
    what: 'a Lambda function a SAM template declares (`Type: AWS::Serverless::Function`)',
    path: DECLARATION_FILES,
    pattern: /^\s*Type:\s*['"]?AWS::Serverless::Function['"]?\s*$|"Type"\s*:\s*"AWS::Serverless::Function"/gm,
  },
  {
    // The plain CloudFormation function (P248), in a SAM template or a plain
    // one, wherever the repository keeps it.
    name: 'cloudformation-function-resource',
    family: 'routes',
    scope: 'line',
    what: 'a Lambda function a CloudFormation template declares (`Type: AWS::Lambda::Function`)',
    path: DECLARATION_FILES,
    pattern: /^\s*Type:\s*['"]?AWS::Lambda::Function['"]?\s*$|"Type"\s*:\s*"AWS::Lambda::Function"/gm,
  },
  {
    // A way in a Nuxt module adds when the application builds (P251): no file
    // of `server/` gives it, the call does. Counted where the call hands an
    // object with a `route`, so a handler that stands in front of every route
    // is not one.
    name: 'nuxt-module-server-handler',
    family: 'routes',
    scope: 'line',
    what: 'a route a Nuxt module adds (`addServerHandler({ route, handler })`)',
    pattern: /\baddServerHandler\s*\(\s*\{[^}]*?\broute\s*:/g,
  },
  {
    name: 'nitro-route-file',
    family: 'routes',
    scope: 'file',
    what: 'a file under `server/api` or `server/routes` that default-exports a handler',
    path: /(^|\/)server\/(?:api|routes)\/.+\.[cm]?[jt]s$/,
    contains: /export\s+default\b/,
  },
  {
    // A task Nitro runs by its name is a way in of its own (P258): the name
    // is its file's path, so the file is the site. Counted where the file
    // defines one, so a helper kept beside the tasks is not.
    name: 'nitro-task-file',
    family: 'routes',
    scope: 'file',
    what: 'a file under `server/tasks` that defines a task (`defineTask`)',
    path: /(^|\/)server\/tasks\/.+\.[cm]?[jt]s$/,
    contains: /\bdefineTask\s*\(/,
  },
  {
    // A SvelteKit server load answers the page's address before the page is
    // shown, and the tool draws it as a way in at its file (P42, P258): a
    // page's `+page.server` and a layout's `+layout.server` alike (P262).
    // Counted where the file exports a `load`, so one holding only `actions`
    // is not; a universal `+page.ts` / `+layout.ts` load runs in the browser
    // too and is no way in.
    name: 'sveltekit-server-load',
    family: 'routes',
    scope: 'file',
    what: 'a SvelteKit `+page.server` or `+layout.server` file that exports a `load`',
    path: /(?:^|\/)\+(?:page|layout)\.server\.[cm]?[jt]s$/,
    contains: /^\s*export\s+(?:const|(?:async\s+)?function)\s+load\b/m,
  },
  {
    // The request families (P244). A request is written at a call, and the
    // call is what a person sees: the platform's client by its own name, a verb
    // on a client with the address written out beside it, or a client handed
    // one options object holding the address. Over-counted where a receiver is
    // only named like a client (`cacheClient.get('/k')`), which is this rule's
    // side; under-counted where an instance has a name of its own and writes an
    // address without its opening slash, which a probe cannot tell from a key.
    name: 'fetch-call-site',
    family: 'requests',
    scope: 'line',
    what: "a request made by calling the platform's `fetch`, `$fetch` or `ofetch` by its own name",
    pattern: /(?<![\w$.])(?:fetch|\$fetch|ofetch)\s*\(/g,
  },
  {
    name: 'client-verb-call',
    family: 'requests',
    scope: 'line',
    what: 'a verb called with its address written out, on `axios` or `ky` themselves or on a receiver named like a client (`this.http.get(...)`, `api.post(...)`), the address rooted at a slash, a host or a setting',
    pattern:
      /(?:\b(?:axios|ky)\s*\.\s*(?:get|post|put|patch|delete|head|request)\s*(?:<[^>()]*>\s*)?\(\s*['"`]|\b[\w$]*(?:http|api|client)\s*\.\s*(?:get|post|put|patch|delete|head)\s*(?:<[^>()]*>\s*)?\(\s*['"`](?:\/|https?:|\$\{))/gi,
  },
  {
    name: 'client-config-call',
    family: 'requests',
    scope: 'line',
    what: 'a client handed one options object holding the address (`axios({ url })`, `api.request({ url })`)',
    pattern: /\b(?:axios|[\w$]*(?:http|api|client))\s*(?:\.\s*request\s*)?\(\s*\{[^}]*?\burl\s*:/gi,
  },
  {
    // What stands in front of every request through a client (P239, P244): the
    // instance a client is made as, and the interceptor or hook that rewrites
    // the address before each request. Neither is a node of its own, so the
    // family is a denominator for the reading of bases and nothing is gated on
    // it per file.
    name: 'client-instance-factory',
    family: 'bases',
    scope: 'line',
    what: 'a client instance made with options of its own (`axios.create(...)`, `ofetch.create(...)`, `$fetch.create(...)`, `ky.create(...)`, `ky.extend(...)`)',
    pattern: /(?<![\w$.])(?:axios|ofetch|\$fetch|ky)\s*\.\s*(?:create|extend)\s*\(/g,
  },
  {
    name: 'request-interceptor',
    family: 'bases',
    scope: 'line',
    what: 'a function run before every request (`interceptors.request.use(...)`, an `onRequest` hook, `hooks.beforeRequest`, an Angular `HttpInterceptor` class or `HttpInterceptorFn`)',
    pattern: /\binterceptors\s*\.\s*request\s*\.\s*use\s*\(|\bonRequest\s*[(:]|\bbeforeRequest\s*:|\bimplements\s+HttpInterceptor\b|:\s*HttpInterceptorFn\b/g,
  },
  {
    // Where a server is started on a port (P250): what a request to this
    // machine's port joins by. Kept on the repository node, never a node of
    // its own, so the family is a denominator and nothing is gated on it.
    name: 'server-listen',
    family: 'listens',
    scope: 'line',
    what: 'a server started on a port (`app.listen(port)`, `serve({ fetch, port })`, `Bun.serve(...)`, `Deno.serve(...)`)',
    pattern: /\.\s*listen\s*\(\s*[^)\s]|(?<![\w$.])serve\s*\(\s*\{|\b(?:Bun|Deno)\s*\.\s*serve\s*\(/g,
  },
  {
    // A front end's dev or preview server given a port in its bundler's or
    // framework's configuration (P254): `server: { port }`, `preview: { port }`,
    // `devServer: { port }`. Same family, same reason nothing is gated on it.
    name: 'dev-server-port',
    family: 'listens',
    scope: 'line',
    what: 'a dev server given a port in `vite.config.*`, `astro.config.*` or `nuxt.config.*`',
    path: /(?:^|\/)(?:vite|astro|nuxt)\.config\.[cm]?[jt]s$/,
    pattern: /\bport\s*:/g,
  },
  {
    // A server told to forward paths to another (P257): Vite's `proxy`,
    // Nitro's `devProxy` and a route rule's `proxy`, Next's `rewrites`. One
    // site per table or rule as the configuration writes it.
    name: 'dev-proxy',
    family: 'listens',
    scope: 'line',
    what: 'a proxy or a rewrite in `vite.config.*`, `nuxt.config.*`, `nitro.config.*` or `next.config.*`',
    path: /(?:^|\/)(?:vite|nuxt|nitro|next)\.config\.[cm]?[jt]s$/,
    pattern: /\b(?:proxy|devProxy)\s*:|\brewrites\s*(?:\(|:)/g,
  },
  {
    // A port a cluster's service object routes to its pods (P257): what a
    // request to its name joins by. Counted where the target is written.
    name: 'cluster-target-port',
    family: 'listens',
    scope: 'line',
    what: 'a port a cluster manifest routes to its containers (`targetPort:`)',
    path: /\.ya?ml$/,
    pattern: /^\s*(?:-\s+)?targetPort\s*:/gm,
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
  ['requests', 'places a request is written'],
  ['bases', 'client instances and functions run before every request'],
  ['listens', 'servers started on a port'],
  ['data', 'places the code reaches storage'],
  ['models', 'tables or models declared (an upper bound)'],
];

const extensionOf = (path) => {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
};

/** True when the path is source under the rule above. */
export const isSourceFile = (path) => {
  if (!SOURCE_EXTENSIONS.includes(extensionOf(path)) && !DECLARATION_FILES.test(path)) return false;
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
// Markup's comments are not a script's, and a template's `//` is an address.
const COMMENTED = new Set(SOURCE_EXTENSIONS.filter((extension) => !['.html', '.vue', '.svelte'].includes(extension)));

/** A template's comments, `#` to the end of the line where it starts a line or follows a space, blanked as the code's are. */
const withoutHashComments = (text) => text.replace(/(^|\s)#[^\n]*/g, (comment, before) => before + ' '.repeat(comment.length - before.length));

/** What a probe reads: the file, with its comments blanked where it has any. */
const codeOf = (path, text) =>
  COMMENTED.has(extensionOf(path)) ? withoutComments(text) : DECLARATION_FILES.test(path) && !path.endsWith('.json') ? withoutHashComments(text) : text;

const countLine = (probe, path, text) => {
  if (probe.path !== undefined && !probe.path.test(path)) return 0;
  // A declaration file is not code: a probe of code that names no path does not look in one.
  if (probe.path === undefined && !SOURCE_EXTENSIONS.includes(extensionOf(path))) return 0;
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
