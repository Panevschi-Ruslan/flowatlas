import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { describeAcceptedProblem, describeObservedProblem, loadConfig, readAccepted, type AcceptedRead } from '@flowatlas/core';
import { acceptedSplitOf, confirmedJoins, neverSeen, type GraphDb } from '@flowatlas/linker';
import { docsNow } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import { dbPathFor, openDbFromOptions, sourceRootsFor, type DbOptions } from '../db.js';
import { readObservedBeside } from '../observe/store.js';
import { EDITOR_NAMES } from '../visualise/graph.js';
import { packGraph, type PackedGraph, type PackInput } from '../visualise/pack.js';
import type { PackDiffInput, PackTraffic } from '../visualise/observed.js';
import { diffNamesOf, minCountOf, readDiffPair } from './observe.js';
import { packChanges, type PackedChanges } from '../visualise/changes.js';
import { runDiff } from './diff.js';
import { shipped } from '../own-path.js';

/** A file the page is made of, beside the code whether that is source or build output. */
const part = (name: string): string => {
  const path = shipped(
    import.meta.url,
    `visualise/${name}`,
    `../visualise/${name}`,
    `../../src/visualise/${name}`,
  );
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw cannotRun(`the page's ${name} is missing; rebuild the command`);
  }
};

/**
 * Core's prompt renderer (P97), the one the MCP server writes with: copied
 * beside the page when the command is built, and read from core itself when it
 * runs from source.
 */
const promptPart = (): string => {
  const name = 'prompt-text.js';
  const beside = shipped(import.meta.url, `visualise/${name}`, `../visualise/${name}`, `../../../core/src/${name}`);
  try {
    return readFileSync(beside, 'utf8');
  } catch {
    try {
      return readFileSync(createRequire(import.meta.url).resolve(`@flowatlas/core/${name}`), 'utf8');
    } catch {
      throw cannotRun(`the page's ${name} is missing; rebuild the command`);
    }
  }
};

/**
 * What `page.html` is made of besides its markup (P103), in the order the page
 * holds them: each placeholder and the file written in its place. The styles;
 * the logic - what to draw, the frame around it, the map of the whole project,
 * core's renderer for a copied prompt, the steps of a way in; then the page's
 * context, one factory per panel, and the boot that calls them in order.
 */
export const PAGE_PARTS: readonly (readonly [placeholder: string, file: string])[] = [
  ['__PAGE_CSS__', 'page.css'],
  ['__GRAPH_LOGIC__', 'graph.js'],
  ['__FRAME_LOGIC__', 'frame.js'],
  ['__MAP_LOGIC__', 'map.js'],
  ['__PROMPT_LOGIC__', 'prompt-text.js'],
  ['__STEPS_LOGIC__', 'steps.js'],
  ['__CONTEXT_LOGIC__', 'panels/context.js'],
  ['__BAND_LOGIC__', 'panels/band.js'],
  ['__VIRTUAL_LIST_LOGIC__', 'panels/virtual-list.js'],
  ['__WAYS_LOGIC__', 'panels/ways.js'],
  ['__SHEET_LOGIC__', 'panels/sheet.js'],
  ['__TABLES_LOGIC__', 'panels/tables.js'],
  ['__FIND_LOGIC__', 'panels/find.js'],
  ['__MENU_LOGIC__', 'panels/menu.js'],
  ['__MISSING_LOGIC__', 'panels/missing.js'],
  ['__GRAPH_DRAW_LOGIC__', 'panels/graph-draw.js'],
  ['__DETAILS_LOGIC__', 'panels/details.js'],
  ['__CHECKING_LOGIC__', 'panels/checking.js'],
  ['__GRAPH_UI_LOGIC__', 'panels/graph-ui.js'],
  ['__FRAME_UI_LOGIC__', 'panels/frame-ui.js'],
  ['__MAP_UI_LOGIC__', 'panels/map-ui.js'],
  ['__STEPS_UI_LOGIC__', 'panels/steps-ui.js'],
  ['__TRACES_LOGIC__', 'panels/traces.js'],
  ['__PALETTE_LOGIC__', 'panels/palette.js'],
  ['__WIRING_LOGIC__', 'panels/wiring.js'],
  ['__BOOT_LOGIC__', 'panels/boot.js'],
];

/** A panel's imports, one statement each: `import { a, b } from '../graph.js';`. */
const PANEL_IMPORT = /^import \{([^}]*)\} from '[^']+';\n/gm;

/**
 * A part as the page holds it. A panel imports what it uses so that a test can
 * load it alone; in the page every part shares one script, where those names
 * are already declared, so its imports are dropped. An import the page could
 * not drop - a default, a namespace, a name taken under another - is refused
 * rather than written in broken.
 */
export const inlined = (file: string, text: string): string => {
  if (!file.startsWith('panels/')) return text;
  const bare = text.replace(PANEL_IMPORT, (_statement, names: string) => {
    if (/\bas\b/.test(names)) throw cannotRun(`the page's ${file} imports a name under another; rebuild the command`);
    return '';
  });
  if (/^import\b/m.test(bare)) throw cannotRun(`the page's ${file} has an import the page cannot drop; rebuild the command`);
  return bare;
};

/** Placeholders the command fills itself, after the parts: the title and the graph. */
const FILLED_LATER = new Set(['__TITLE__', '__DATA__']);

/**
 * `html` with every part written into it, each read by `read`, so the result
 * is still one file with nothing to fetch. A part with no placeholder, or a
 * placeholder left without its part, refuses to write a page with a panel
 * missing.
 */
export const writeParts = (html: string, read: (file: string) => string): string => {
  let page = html;
  for (const [placeholder, file] of PAGE_PARTS) {
    if (!page.includes(placeholder)) throw cannotRun(`the page has no place for its ${file}; rebuild the command`);
    const text = inlined(file, read(file));
    // Replaced through a function: a part is free to contain `$&` or `$1`.
    page = page.replace(placeholder, () => text);
  }
  const left = [...page.matchAll(/__[A-Z][A-Z_]*__/g)].map(([found]) => found).filter((found) => !FILLED_LATER.has(found));
  if (left.length > 0) throw cannotRun(`the page's ${left[0]} has no part; rebuild the command`);
  return page;
};

/** The page as the command ships it, every part read from beside the code. */
export const template = (): string =>
  writeParts(part('page.html'), (file) => (file === 'prompt-text.js' ? promptPart() : part(file)));

/**
 * A name for the project, since the configuration does not carry one.
 *
 * The directory holding the configuration is what people call it in
 * conversation, which is a better answer than anything invented here.
 */
const nameFrom = (where: string): string => {
  const path = resolve(where);
  // A configuration is named by the directory holding it; a directory names
  // itself. Taking the parent of either would name the folder they live in,
  // which is somebody's Desktop.
  const folder = basename(path.endsWith('.json') ? dirname(path) : path);
  const spaced = folder.replace(/[-_]+/g, ' ').trim();
  if (spaced === '') return 'Project map';
  const named = `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
  return /map/i.test(named) ? named : `${named} map`;
};

/**
 * A JSON payload is raw text inside its script block, so only an escape JSON
 * itself understands can survive being read back out.
 */
const embeddable = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * Where the page goes when nobody says: next to the configuration it was built
 * from, which is the project's own folder, found the same way the database was.
 * Given only a database there is no configuration to stand beside, so the
 * working directory.
 */
const defaultFolder = (options: DbOptions): string => {
  if (options.config === undefined && options.db !== undefined) return process.cwd();
  try {
    return dirname(loadConfig(options.config ?? process.cwd()).configPath);
  } catch {
    return process.cwd();
  }
};

export interface VisualiseOptions extends DbOptions {
  out?: string;
  title?: string;
  /** `vscode`, `cursor`, `idea` or `file`: make every `file:line` a link that opens it. */
  editorLinks?: string;
  /** What `flowatlas diff <ref>` found, already packed; fills the Changes tab. */
  changes?: PackedChanges;
  /** `--observed-diff <a> <b>`: two observed files to compare on a Run time changes tab (P111), read and never written. */
  observedDiff?: string[];
  /** `--min-count <n>`: with `--observed-diff`, the fewest requests on both sides before a time or failure share is compared. */
  minCount?: string;
  print?: (message: string) => void;
}

/**
 * The editor links asked for, with where each service's sources are, or none.
 *
 * Off unless asked: a link to a file is the file's absolute path on this
 * machine, written into a page that is made to be sent to other people. Asked
 * for without a configuration there is no telling where a repository is, and a
 * page of links that open nothing is refused rather than written.
 */
const editorFor = (options: VisualiseOptions): PackInput['editor'] => {
  const name = options.editorLinks;
  if (name === undefined) return undefined;
  if (!EDITOR_NAMES.includes(name)) {
    throw cannotRun(`--editor-links takes one of ${EDITOR_NAMES.join(', ')}; got ${JSON.stringify(name)}`);
  }
  if (options.config === undefined && options.db !== undefined) {
    throw cannotRun('--editor-links needs the configuration, to know where each repository is; pass --config');
  }
  const roots = sourceRootsFor(options);
  return { name, rootOf: (service) => roots.repoDir(service) };
};

/**
 * What the configuration says about routes nobody calls, for the Map's counts
 * (P91); nothing when the page is drawn from a database alone or the
 * configuration cannot be read, and the built-in rules then decide.
 */
const routeRulesFor = (options: VisualiseOptions): PackInput['routes'] => {
  if (options.config === undefined && options.db !== undefined) return undefined;
  try {
    const { config } = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
    return { publicRoutes: config.doctor.publicRoutes, infrastructure: config.dead.infrastructure };
  } catch {
    return undefined;
  }
};

const withRoutes = (routes: PackInput['routes']): Pick<PackInput, 'routes'> => (routes === undefined ? {} : { routes });

const withDocsOf = (docs: NonNullable<PackInput['docs']>): Pick<PackInput, 'docs'> => (docs.length === 0 ? {} : { docs });

/**
 * The graph in a database, packed for the page: every node and edge, and the
 * rows as every other surface counts them - demoted where an annotation
 * answered them, and split by what was accepted, once (P80). The prompt
 * parity test packs through here too, so it reads what the page reads (P97).
 */
export const packDatabase = (
  db: GraphDb,
  read: AcceptedRead,
  extra: Partial<Pick<PackInput, 'observed' | 'editor' | 'changes' | 'routes' | 'docs' | 'observedDiff'>> = {},
): PackedGraph => {
  const report = db.report();
  if (report === undefined) throw cannotRun('the database holds no report; run flowatlas build');
  const split = acceptedSplitOf(db, db.allUnresolved(), read);
  // What traffic says over the graph (P110): never seen, and best guesses it
  // went through, asked of the database here so the page and the server agree.
  const traffic: PackTraffic | undefined =
    extra.observed === undefined
      ? undefined
      : (() => {
          const never = neverSeen(db, extra.observed);
          return {
            never: { window: never.window.label, rows: never.rows },
            confirmed: confirmedJoins(db, extra.observed).map((join) => join.id),
          };
        })();
  return packGraph({
    builtAt: report.builtAt,
    nodes: db.allNodes(),
    edges: db.allEdges(),
    unresolved: split.rows,
    report,
    typeOf: (id) => db.type(id),
    accepted: split,
    ...extra,
    ...(traffic === undefined ? {} : { traffic }),
  });
};

/** The two files `--observed-diff` names, read, with their names and the floor (P111). */
const diffInputOf = (paths: readonly string[], minCount: string | undefined): PackDiffInput => {
  const [a, b] = readDiffPair(paths, '--observed-diff');
  return { a, b, names: diffNamesOf(paths), minCount: minCountOf(minCount) };
};

export interface VisualiseResult {
  path: string;
  bytes: number;
  nodes: number;
  edges: number;
}

/**
 * Writes the graph as one page anybody can open.
 *
 * Deliberately a file and not a server: it is generated from a build, it is
 * complete on its own, and it can be attached to a review or kept beside a
 * decision. A viewer that has to be running to answer anything is the thing the
 * plan warns against; a page that says what the build found is a report.
 */
export const runVisualise = (options: VisualiseOptions = {}): VisualiseResult => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const editor = editorFor(options);
  if (options.minCount !== undefined && options.observedDiff === undefined) throw cannotRun('--min-count applies to --observed-diff only');
  const compared = options.observedDiff === undefined ? undefined : diffInputOf(options.observedDiff, options.minCount);
  const db = openDbFromOptions(options);
  const seen = readObservedBeside(dbPathFor(options));
  const observed = seen.observed;
  const read = readAccepted(dbPathFor(options));
  let packed;
  let counts;
  try {
    packed = packDatabase(db, read, {
      ...(observed === undefined ? {} : { observed }),
      ...(editor === undefined ? {} : { editor }),
      ...(options.changes === undefined ? {} : { changes: options.changes }),
      ...(compared === undefined ? {} : { observedDiff: compared }),
      ...withRoutes(routeRulesFor(options)),
      // The pages that describe a node (P120), from `flowatlas docs`, checked against this graph.
      ...withDocsOf(docsNow(db, dbPathFor(options))),
    });
    const totals = db.counts();
    counts = { nodes: totals.nodes, edges: totals.edges };
  } finally {
    db.close();
  }

  const title = options.title ?? nameFrom(options.config ?? options.db ?? process.cwd());
  // Replaced through a function: a replacement string reads `$&` and `$'` as
  // patterns, and a label is free to contain either.
  const page = template()
    .replace(/__TITLE__/g, () => title)
    .replace('__DATA__', () => embeddable(packed));

  const path = resolve(options.out ?? resolve(defaultFolder(options), 'graph.html'));
  writeFileSync(path, page, 'utf8');

  const result = { path, bytes: Buffer.byteLength(page), ...counts };
  if (read.problem !== undefined) print(`warning: ${describeAcceptedProblem(read.problem)}`);
  if (seen.problem !== undefined) print(`warning: ${describeObservedProblem(seen.problem)}`);
  print(
    `${result.nodes.toLocaleString()} nodes, ${result.edges.toLocaleString()} edges, ` +
      `${Math.round(result.bytes / 1024)}KB`,
  );
  print(path);
  return result;
};

/**
 * The Changes tab's content: `flowatlas diff` run as it is, its printed
 * document kept quiet, and its report packed. `diff.json` is still written,
 * so the page and the file never disagree.
 */
export const changesAgainst = async (ref: string, options: DbOptions): Promise<PackedChanges> => {
  const quiet = { out: () => undefined, err: () => undefined };
  const { report } = await runDiff(ref, undefined, options.config === undefined ? {} : { config: options.config }, quiet);
  return packChanges(report);
};

export const registerVisualise = (program: Command): void => {
  program
    .command('visualise')
    .alias('visualize')
    .description('write the graph as one page you can open in a browser')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--out <file>', 'where to write it (default: graph.html next to the configuration)')
    .option('--title <name>', 'what to call the project on the page')
    .option(
      '--editor-links <editor>',
      `make each file:line a link that opens it: ${EDITOR_NAMES.join(', ')}. Writes absolute local paths into the page`,
    )
    .option('--diff <ref>', 'add a Changes tab: what the working tree changes against this ref, as flowatlas diff reads it')
    .option('--observed-diff <files...>', 'add a Run time changes tab comparing two observed files, before then after a deploy')
    .option('--min-count <n>', 'with --observed-diff, the fewest requests on both sides before a time or failure share is compared (default 20)')
    .action(async (options: VisualiseOptions & { diff?: string }) => {
      const { diff, ...rest } = options;
      const changes = diff === undefined ? undefined : await changesAgainst(diff, rest);
      runVisualise({ ...rest, ...(changes === undefined ? {} : { changes }) });
    });
};
