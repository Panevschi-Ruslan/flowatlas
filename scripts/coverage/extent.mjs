/**
 * How much of a repository one service is, read from the repository's manifests.
 *
 * ## Why this file exists at all
 *
 * The counting rule counts declaration sites in a service's source. Until a
 * service was a directory, "its source" needed no definition beyond the
 * directory, and the rule needed none. A service is now an application together
 * with the workspace packages it declares, so the numerator reaches into those
 * packages and a denominator counted over the directory alone is answering a
 * smaller question. Printed as a fraction the two questions came out as
 * `444 of 80` and `288 of 128`, and a ratio above one is not a rounding error:
 * it is two measurements of different things divided by each other.
 *
 * So the extent has to be counted over. The only question was who is allowed to
 * say what it is.
 *
 * ## Why it is not asked of the tool
 *
 * `@flowatlas/core` can answer this in one call. Importing that call would make
 * the denominator a function of the code being measured, and the failure that
 * follows is the exact failure this harness exists to catch: a reader that
 * stops walking a package early loses sites from the numerator **and** loses
 * the same package from the denominator, so coverage stays at a hundred per
 * cent while the tool reads less than it did yesterday. The regression that
 * hurt most would be the one the report could not show. A denominator is only
 * worth having if it can disagree with the tool.
 *
 * ## Why duplication is the lesser cost here, and what pays for it
 *
 * This is a second implementation of something the tool also implements, and
 * two implementations of one question drift (R115 is that lesson, learned
 * inside `packages/core`). Two things make it the right trade in this direction:
 *
 * - What is read here is not the tool's opinion but the repository's own
 *   writing: a `workspaces` field, a `pnpm-workspace.yaml`, and the dependency
 *   sections of manifests. Those are facts about npm workspaces that predate
 *   this tool and will outlive it, and both parties are entitled to read them.
 *   Independence from the tool's *code* is what matters; sharing the
 *   *ecosystem's definition* is not coupling.
 * - Drift is made visible instead of silent. The harness reports the extent it
 *   counted over, and the report names any directory the tool produced nodes in
 *   that this file did not count - the two lists disagreeing is a printed
 *   figure rather than an assumption nobody can see. That is the same discipline
 *   the harness already applies to a guessed service type: print both answers
 *   rather than let one quietly win.
 *
 * Nothing here takes an argument from `targets.json`. The rule is the same
 * for every target: a service is its own directory, plus every workspace
 * package its manifest names, plus the packages those name in turn for run
 * time, plus what the configuration of a framework its manifest declares says
 * the service is built from.
 *
 * ## Why one framework's configuration is read here at all (P251)
 *
 * A framework can build a directory into a service that no manifest names: a
 * Nuxt application extends a layer beside it by a path (`extends:
 * ['../ui-layer']`), and compiles that layer's pages and routes as its own.
 * The tool reads such a layer as part of the service, so a harness that saw
 * only manifests would count over a smaller service than the one read - the
 * same two-questions mistake this file exists to avoid, in the other
 * direction. The configuration is the repository's own writing, as a
 * workspace file is, and it is read the same way: as text, by a reader of its
 * own here, never the tool's. Which configuration and which keys is one table
 * (`BUILT_FROM`), keyed by the package a manifest declares, so the rule stays
 * one rule for every target.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Directories a workspace glob never means, however wide the glob. */
const NEVER_A_PACKAGE = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/**
 * Dependency sections that make a package part of what a service is built from,
 * by whose manifest they are in.
 *
 * The line an installer draws: a package's devDependencies are installed when
 * that package is the one being worked on, and never for a package that depends
 * on it. So the service's own manifest is read in all four sections and a
 * member's in the three that are there at run time. The tool draws the same
 * line in `serviceSourceDirs`, for the same reason, and I14 holds the two to it
 * (R143).
 */
const EXTENT_SECTIONS = {
  service: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  member: ['dependencies', 'peerDependencies', 'optionalDependencies'],
};

const readManifest = (dir) => {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Strips the quotes a workspace file is allowed to put around a pattern. */
const unquote = (value) => {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : (quoted[2] ?? '');
};

/**
 * The `packages:` list out of a workspace file, and nothing else out of it.
 *
 * One list of strings under one top-level key, in both spellings the format
 * allows. Reading it by hand rather than with a YAML parser keeps the harness
 * free of a dependency for four lines of data, and stopping at the next
 * top-level key is what keeps the rest of that file - overrides, patches,
 * install settings - out of the answer.
 */
const globsInWorkspaceFile = (text) => {
  const found = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const key = /^packages\s*:(.*)$/.exec(line);
    if (key !== null) {
      const inline = /^\s*\[(.*)\]\s*$/.exec(key[1] ?? '');
      if (inline !== null) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item !== null) {
      const value = unquote((item[1] ?? '').replace(/\s+#.*$/, ''));
      if (value !== '') found.push(value);
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break;
  }
  return found;
};

/**
 * Where a workspace root can declare its members.
 *
 * A table rather than a run of branches, and both entries are read when both
 * files exist: a repository moving between package managers keeps both for a
 * while, and saying it in one place does not make the other a lie.
 */
const GLOB_SOURCES = [
  (dir) => {
    const declared = readManifest(dir)?.workspaces;
    const asList = (value) =>
      Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    if (Array.isArray(declared)) return asList(declared);
    return typeof declared === 'object' && declared !== null ? asList(declared.packages) : [];
  },
  (dir) => {
    try {
      return globsInWorkspaceFile(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'));
    } catch {
      return [];
    }
  },
];

/** One member pattern as a test on a path relative to the root that declared it. */
const globTest = (glob) => {
  const source = glob
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) =>
      segment === '**'
        ? '.*'
        : segment
            .split('*')
            .map((literal) => literal.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
};

const patternsByRoot = new Map();

/**
 * A root's globs, compiled: what they include, what they take back out, and how
 * deep a walk has to go to find everything they can name.
 *
 * The patterns say how deep: `packages/*` cannot name anything three levels
 * down. A `**` has no depth of its own and is given two levels beyond the rest
 * of its pattern rather than licence to walk a whole checkout.
 */
const declaredMembers = (root) => {
  if (patternsByRoot.has(root)) return patternsByRoot.get(root);
  const globs = [
    ...new Set(
      GLOB_SOURCES.flatMap((read) => read(root)).map((glob) =>
        glob.replace(/\\/g, '/').replace(/^\.\//, ''),
      ),
    ),
  ];
  const include = globs.filter((glob) => !glob.startsWith('!'));
  const patterns =
    globs.length === 0
      ? undefined
      : {
          include: include.map(globTest),
          exclude: globs.filter((glob) => glob.startsWith('!')).map((glob) => globTest(glob.slice(1))),
          depth: include.reduce((deepest, glob) => {
            const segments = glob.split('/').length;
            return Math.max(deepest, glob.includes('**') ? segments + 2 : segments);
          }, 0),
        };
  patternsByRoot.set(root, patterns);
  return patterns;
};

/**
 * Whether a path relative to a root is one the root's globs name.
 *
 * The directories a glob never means are refused here rather than in the walk,
 * because a `**` names `dist/web` as readily as `apps/web` and an installed copy
 * of a package is not the package. A leading dot is the same case: tooling, not
 * a member.
 */
const declares = (patterns, path) => {
  if (path === '' || path.startsWith('..')) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.') || NEVER_A_PACKAGE.has(segment))) {
    return false;
  }
  return (
    patterns.include.some((test) => test.test(path)) &&
    !patterns.exclude.some((test) => test.test(path))
  );
};

const childDirectories = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('.') && !NEVER_A_PACKAGE.has(name));
  } catch {
    return [];
  }
};

const membersByRoot = new Map();

/**
 * Every directory under `root` that its globs name and that holds a manifest.
 *
 * Walked once per root and remembered. A directory the globs match but that
 * holds no manifest is not a member: the globs say where to look and the
 * manifest is what makes a package.
 */
const memberDirs = (root) => {
  const cached = membersByRoot.get(root);
  if (cached !== undefined) return cached;
  const patterns = declaredMembers(root);
  const found = [];
  if (patterns !== undefined) {
    const visit = (path, depth) => {
      for (const name of childDirectories(join(root, path))) {
        const child = path === '' ? name : `${path}/${name}`;
        if (declares(patterns, child) && readManifest(join(root, child)) !== undefined) {
          found.push(join(root, child));
        }
        if (depth < patterns.depth) visit(child, depth + 1);
      }
    };
    visit('', 1);
  }
  membersByRoot.set(root, found);
  return found;
};

/**
 * The workspace `dir` is a package of, when it is a package of one.
 *
 * The nearest root that lists it, so a workspace nested inside another - a
 * `client` directory that declares members of its own - answers for its own
 * members and the outer one answers for the rest. A directory that is itself the
 * root of a workspace is not a member of it, which is what keeps a monorepo read
 * as a whole from acquiring an extent: its globs already cover everything under
 * it. Bounded by `stopAt`, because the clone is the whole world here and a
 * checkout's parents are this machine's business.
 */
const workspaceRootOf = (dir, stopAt) => {
  const member = resolve(dir);
  const boundary = resolve(stopAt);
  let at = member;
  // The loop condition is what bounds the walk: the clone root is examined and
  // nothing above it is. A service that *is* the clone root has no ancestor to
  // examine at all, which is the monorepo-read-whole case and is answered by
  // this loop never running.
  while (at !== boundary) {
    const parent = resolve(at, '..');
    if (parent === at) return undefined;
    at = parent;
    const patterns = declaredMembers(at);
    const path = relative(at, member).split('\\').join('/');
    if (patterns !== undefined && declares(patterns, path) && memberDirs(at).includes(member)) {
      return at;
    }
  }
  return undefined;
};

/**
 * What a framework's configuration says a service is built from, by the
 * package a manifest declares (P251): the files that hold it, and the keys
 * whose entries are a directory or a package the service is built from.
 *
 * Nuxt: `extends` names its layers, each read the same way in turn, and
 * `modules` its modules; both at the top of the configuration and under
 * `$production`, which is the build the tool reads. A path entry is a
 * directory (or a file in one) from the configuration's own directory,
 * written as a string or built from that directory (P255); any
 * other entry is a workspace member by its name, or nothing here.
 */
export const BUILT_FROM = [
  {
    package: 'nuxt',
    files: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'],
    parts: 'extends',
    keys: ['extends', 'modules'],
    within: ['$production'],
  },
];

/**
 * The tokens of a configuration file that a literal is written in: strings,
 * names, numbers and the punctuation between them. Comments are dropped, and
 * a template with a substitution is a token no literal reading accepts.
 */
const tokensOf = (text) => {
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (/\s/.test(char)) {
      at += 1;
    } else if (text.startsWith('//', at)) {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
    } else if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
    } else if (char === "'" || char === '"' || char === '`') {
      let value = '';
      let end = at + 1;
      let plain = true;
      while (end < text.length && text[end] !== char) {
        if (text[end] === '\\') {
          value += text[end + 1] ?? '';
          end += 2;
          continue;
        }
        if (char === '`' && text.startsWith('${', end)) plain = false;
        value += text[end];
        end += 1;
      }
      tokens.push(plain ? { kind: 'string', value } : { kind: 'code', value });
      at = end + 1;
    } else if (/[\w$]/.test(char)) {
      const word = /^[\w$.]+/.exec(text.slice(at))[0];
      tokens.push({ kind: 'name', value: word });
      at += word.length;
    } else {
      tokens.push({ kind: 'punct', value: char });
      at += 1;
    }
  }
  return tokens;
};

const CODE = Symbol('code');

/** The calls that join a path, by the names a configuration imports them under. */
const PATH_CALLS = new Set(['resolve', 'join', 'path.resolve', 'path.join', 'pathe.resolve', 'pathe.join']);

/** The names a path built from the configuration's own directory starts from. */
const FROM_HERE = new Set(['__dirname', 'import.meta.dirname']);

/**
 * The default export of a configuration as plain values, as far as it is
 * written in literals: objects, lists and strings. Anything else is `CODE`.
 * The object handed to `define...Config(...)` is the configuration, as the
 * framework reads it.
 */
const configValueOf = (text) => {
  const tokens = tokensOf(text);
  let at = tokens.findIndex((token, index) => token.value === 'export' && tokens[index + 1]?.value === 'default');
  if (at === -1) return undefined;
  at += 2;
  // `defineNuxtConfig(` and the like, up to the value it is handed.
  while (at < tokens.length && (tokens[at].kind === 'name' || tokens[at].value === '(')) at += 1;
  const skip = () => {
    let depth = 0;
    while (at < tokens.length) {
      const { value } = tokens[at];
      if (depth === 0 && (value === ',' || value === '}' || value === ']' || value === ')')) return;
      if (value === '{' || value === '[' || value === '(') depth += 1;
      if (value === '}' || value === ']' || value === ')') depth -= 1;
      at += 1;
    }
  };
  const ends = (token) => token === undefined || [',', '}', ']', ')'].includes(token.value);
  /**
   * A path built from the configuration's own directory (P255), as a
   * relative string: `fileURLToPath(new URL('../ui', import.meta.url))`,
   * `resolve(__dirname, '../ui')`, `join(import.meta.dirname, 'ui')`, or
   * `resolve('../ui')`, which the framework runs from that directory. Any
   * other call is code.
   */
  const builtPath = () => {
    const start = at;
    const is = (value) => tokens[at]?.value === value && (at += 1) > 0;
    const read = () => {
      if (tokens[at]?.value === 'fileURLToPath' && tokens[at + 1]?.value === '(') {
        at += 2;
        if (!is('new') || !is('URL') || !is('(')) return undefined;
        const relativePath = tokens[at]?.kind === 'string' ? tokens[at].value : undefined;
        at += 1;
        if (relativePath === undefined || !is(',') || !is('import.meta.url') || !is(')') || !is(')')) return undefined;
        return relativePath;
      }
      if (!PATH_CALLS.has(tokens[at]?.value) || tokens[at + 1]?.value !== '(') return undefined;
      at += 2;
      if (FROM_HERE.has(tokens[at]?.value)) {
        at += 1;
        if (!is(',')) return undefined;
      }
      const parts = [];
      while (tokens[at]?.kind === 'string') {
        parts.push(tokens[at].value);
        at += 1;
        if (!is(',')) break;
      }
      if (parts.length === 0 || !is(')')) return undefined;
      return parts.join('/').replace(/\/+/g, '/');
    };
    const found = read();
    if (found === undefined || !ends(tokens[at])) {
      at = start;
      return undefined;
    }
    return found.startsWith('.') || found.startsWith('/') ? found : `./${found}`;
  };
  const value = () => {
    const token = tokens[at];
    const next = tokens[at + 1];
    if (token?.kind === 'string' && ends(next)) {
      at += 1;
      return token.value;
    }
    const built = token?.kind === 'name' ? builtPath() : undefined;
    if (built !== undefined) return built;
    if (token?.value === '[') {
      at += 1;
      const items = [];
      while (at < tokens.length && tokens[at].value !== ']') {
        items.push(value());
        if (tokens[at]?.value === ',') at += 1;
      }
      at += 1;
      return items;
    }
    if (token?.value === '{') {
      at += 1;
      const object = {};
      while (at < tokens.length && tokens[at].value !== '}') {
        const key = tokens[at];
        if ((key.kind === 'name' || key.kind === 'string') && tokens[at + 1]?.value === ':') {
          at += 2;
          object[key.value] = value();
        } else skip();
        if (tokens[at]?.value === ',') at += 1;
      }
      at += 1;
      return object;
    }
    skip();
    return CODE;
  };
  return value();
};

const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const SCRIPT_ENDINGS = ['.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'];

/**
 * The directories a service's framework configuration says it is built
 * from, beyond its own: each part `extends` names, read in turn, and each
 * module directory `modules` names that is not inside one of them. Absolute,
 * inside `clone`, and nothing for a service whose manifest declares none of
 * the frameworks in `BUILT_FROM`.
 */
const builtFromDirs = (own, clone, manifest, byName) => {
  const declared = Object.assign({}, ...EXTENT_SECTIONS.service.map((key) => manifest[key] ?? {}));
  const found = { parts: [], others: [] };
  for (const framework of BUILT_FROM) {
    if (declared[framework.package] === undefined) continue;
    const seen = new Set([own]);
    const read = (dir) => {
      const file = framework.files.map((name) => join(dir, name)).find((path) => existsSync(path));
      if (file === undefined) return;
      let config;
      try {
        config = configValueOf(readFileSync(file, 'utf8'));
      } catch {
        return;
      }
      if (!isPlain(config)) return;
      const blocks = [config, ...framework.within.map((key) => config[key]).filter(isPlain)];
      for (const key of framework.keys) {
        for (const block of blocks) {
          const entries = Array.isArray(block[key]) ? block[key] : block[key] === undefined ? [] : [block[key]];
          for (const listed of entries) {
            const entry = Array.isArray(listed) ? listed[0] : listed;
            if (typeof entry !== 'string') continue;
            let target;
            if (entry.startsWith('.') || entry.startsWith('/')) {
              const path = resolve(dir, entry);
              if (isDirectory(path)) target = path;
              else if (existsSync(path) || SCRIPT_ENDINGS.some((ending) => existsSync(`${path}${ending}`))) target = dirname(path);
            } else {
              target = byName.get(entry.startsWith('@') ? entry.split('/').slice(0, 2).join('/') : entry.split('/')[0]);
            }
            if (target === undefined || seen.has(target)) continue;
            if (target !== clone && !target.startsWith(`${clone}/`)) continue;
            seen.add(target);
            if (key === framework.parts) {
              found.parts.push(target);
              read(target);
            } else found.others.push(target);
          }
        }
      }
    };
    read(own);
  }
  const outside = (dir) => dir !== own && !dir.startsWith(`${own}/`);
  const parts = found.parts.filter(outside);
  return [
    ...parts,
    ...found.others.filter(outside).filter((dir) => !parts.some((part) => dir === part || dir.startsWith(`${part}/`))),
  ];
};

/**
 * One service's extent: its own directory first, then what it declares.
 *
 * Clone-relative POSIX paths, because that is what `git ls-files` takes and what
 * a report prints. The first entry is always the service's own directory.
 *
 * Three things are left out on purpose, and each of them is left out by the tool
 * too. A package that is not a member of the workspace belongs to the module
 * resolver and is an installed dependency. A member that contains the service is
 * left out, because taking it in would quietly turn one service into the whole
 * repository. And a directory that is not a workspace member gets nothing but
 * itself, so a bare directory or a monorepo root is counted exactly as it was
 * before this file existed.
 */
export const extentOf = (cloneDir, readRoot) => {
  const clone = resolve(cloneDir);
  const own = resolve(clone, readRoot);
  const root = workspaceRootOf(own, clone);
  const dirs = [own];
  const byName = new Map();
  if (root !== undefined) {
    for (const dir of memberDirs(root)) {
      const name = readManifest(dir)?.name;
      if (typeof name === 'string' && name !== '') byName.set(name, dir);
    }
    const seen = new Set([own]);
    const queue = [own];
    while (queue.length > 0) {
      const at = queue.shift();
      const manifest = readManifest(at) ?? {};
      const sections = EXTENT_SECTIONS[at === own ? 'service' : 'member'];
      const declared = Object.assign({}, ...sections.map((key) => manifest[key] ?? {}));
      for (const name of Object.keys(declared)) {
        const dir = byName.get(name);
        if (dir === undefined || seen.has(dir)) continue;
        if (own === dir || own.startsWith(`${dir}/`)) continue;
        seen.add(dir);
        // Nested inside the service already: nothing to add to the extent, but
        // its own dependencies still belong to the service.
        if (!dir.startsWith(`${own}/`)) dirs.push(dir);
        queue.push(dir);
      }
    }
  }
  // What a framework builds into the service from beside it (P251). Read as
  // a member that declares nothing: its own manifest adds no further package.
  for (const dir of builtFromDirs(own, clone, readManifest(own) ?? {}, byName)) {
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  const asPath = (dir) => relative(clone, dir).split('\\').join('/') || '.';
  return {
    root: root === undefined ? null : asPath(root),
    dirs: [asPath(dirs[0]), ...dirs.slice(1).map(asPath).sort()],
  };
};

/**
 * The extent of every read root of one target, as one deduplicated list.
 *
 * Two services of one repository may declare the same package - one repository
 * measured here has a server and a browser that share a types package - and a
 * denominator that counted its files twice would be counting a declaration site
 * that exists once.
 */
export const extentOfTarget = (cloneDir, readRoots) => {
  const perRoot = readRoots.map((readRoot) => ({ readRoot, ...extentOf(cloneDir, readRoot) }));
  const dirs = [...new Set(perRoot.flatMap((entry) => entry.dirs))];
  // A parent in the list makes a child of it redundant as a pathspec, and `git
  // ls-files .` beside `git ls-files apps/web` would list the second twice.
  const outermost = dirs.filter(
    (dir) => !dirs.some((other) => other !== dir && (other === '.' || dir.startsWith(`${other}/`))),
  );
  return { perRoot, dirs: outermost.sort() };
};
