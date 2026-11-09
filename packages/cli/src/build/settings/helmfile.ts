import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { readYaml, type PositionedDocument } from '@flowatlas/core';
import type { ChartInstall, ManifestRow } from './cluster.js';
import { mergedValues, renderingsOver, setValue, UNKNOWN_VALUE } from './helm.js';

/**
 * What a `helmfile` installs (P263): each release, in each environment the
 * project installs it in, as a chart install P260 reads - its chart, its
 * values files and inline values in order, its `set`s, release name and
 * namespace - so a chart a helmfile installs is rendered with the values that
 * environment gives, and chosen among by the environment as a values file is.
 *
 * A helmfile is itself a template: each of its parts (`---`) is rendered with
 * the template reader charts are rendered with (`helm.ts`), over the
 * environment's name and values (`.Environment.Name`, `.Values`,
 * `.StateValues`), the values the parts before it gave. What the files do not
 * give (`requiredEnv`, `env`, `exec`, `readFile`) is unknown and never
 * guessed: written into a value it is unread, and a part whose undecided
 * conditions write different releases is not read, said as a row.
 *
 * A helmfile's `bases` are layered under it as helmfile layers them (P273):
 * each base read before the part that names it, its environments, values and
 * releases first; and a release's `needs` is kept as what it is installed
 * after.
 */

/** Where a helmfile is kept beside the commands that run it. */
export const HELMFILE_NAMES = ['helmfile.yaml', 'helmfile.yaml.gotmpl', 'helmfile.yml'];

/** The folder a helmfile's parts may be split into, each file read in order. */
export const HELMFILE_FOLDER = 'helmfile.d';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Every helmfile of a folder, in the order helmfile reads them: `helmfile.d/`, or a folder `helmfile -f` names (P273). */
export const helmfilesIn = (folder: string): string[] => {
  try {
    if (!statSync(folder).isDirectory()) return [];
    return readdirSync(folder)
      .filter((name) => /\.ya?ml(?:\.gotmpl)?$/.test(name))
      .sort()
      .map((name) => join(folder, name));
  } catch {
    return [];
  }
};

/** The helmfiles of a directory: its `helmfile.yaml` (or `.gotmpl`), or every file of its `helmfile.d/`. */
export const helmfilesAt = (dir: string): string[] => {
  const own = HELMFILE_NAMES.map((name) => join(dir, name)).find((path) => existsSync(path));
  if (own !== undefined) return [own];
  return helmfilesIn(join(dir, HELMFILE_FOLDER));
};

/** What one reading of a helmfile is given: the environments to install, the state values a command sets, the releases it keeps. */
export interface HelmfileReading {
  /** The environments its commands name; every one it declares where none does. */
  readonly environments?: readonly string[];
  readonly stateSets?: readonly string[];
  /** State values files, absolute. */
  readonly stateFiles?: readonly string[];
  /** The releases the commands keep by name; every release where empty. */
  readonly releases?: readonly string[];
  /** What else a command keeping releases by name keeps (P273): what they need (`--include-needs`), and what that needs (`--include-transitive-needs`). */
  readonly needs?: 'none' | 'direct' | 'transitive';
}

/** A part of a helmfile, as text, and the line of the file it starts on. */
interface Part {
  readonly text: string;
  readonly first: number;
}

const partsOf = (source: string): Part[] => {
  const lines = source.split('\n');
  const out: Part[] = [];
  let start = 0;
  const flush = (end: number): void => {
    const text = lines.slice(start, end).join('\n');
    if (text.trim() !== '') out.push({ text, first: start });
  };
  lines.forEach((line, index) => {
    if (!/^---\s*$/.test(line)) return;
    flush(index);
    start = index + 1;
  });
  flush(lines.length);
  return out;
};

/** A part rendered over a root and read, its lines mapped to the file's; or why it is not. */
type ReadPart = { readonly kind: 'read'; readonly document: PositionedDocument; readonly lineOf: (line: number) => number } | { readonly kind: 'unread'; readonly why: string };

const readPart = (part: Part, root: Record<string, unknown>): ReadPart => {
  const parsed = (text: string): PositionedDocument | undefined => {
    try {
      return readYaml(text);
    } catch {
      return undefined;
    }
  };
  if (!part.text.includes('{{')) {
    const document = parsed(part.text);
    return document === undefined ? { kind: 'unread', why: 'it is not YAML' } : { kind: 'read', document, lineOf: (line) => line + part.first };
  }
  const rendered = renderingsOver(part.text, root);
  if (rendered.kind === 'unread') return { kind: 'unread', why: rendered.why };
  const documents = rendered.ways.map((way) => ({ way, document: parsed(way.text) }));
  const said = new Set(documents.map(({ document }) => JSON.stringify(document?.value ?? null)));
  const first = documents[0];
  if (first?.document === undefined) return { kind: 'unread', why: 'it does not render as YAML' };
  if (said.size > 1) return { kind: 'unread', why: `its conditions nothing in the environment's values decides write different releases (line ${(rendered.undecided[0] ?? 1) + part.first})` };
  const lines = first.way.lines;
  return { kind: 'read', document: first.document, lineOf: (line) => (lines[line - 1] ?? lines[lines.length - 1] ?? line) + part.first };
};

/** A values file of a helmfile: YAML, or a template rendered over the environment. */
const valuesFile = (path: string, root: Record<string, unknown>): Record<string, unknown> | undefined => {
  const source = readText(path);
  if (source === undefined) return undefined;
  const text = path.endsWith('.gotmpl') || source.includes('{{') ? (() => {
    const rendered = renderingsOver(source, root);
    return rendered.kind === 'rendered' && rendered.ways.length === 1 ? rendered.ways[0]?.text : undefined;
  })() : source;
  if (text === undefined) return undefined;
  try {
    const value = readYaml(text).value;
    return isRecord(value) ? value : {};
  } catch {
    return undefined;
  }
};

/** How many files a helmfile's `bases` are followed through; deeper is not read. */
const MOST_BASES = 8;

/** A part of a helmfile or of a base it layers, read, and the file it is written in. */
interface Layer {
  readonly document: PositionedDocument;
  readonly lineOf: (line: number) => number;
  readonly file: string;
}

/**
 * The parts of a helmfile in the order helmfile layers them (P273): each
 * part's `bases` first - each base a helmfile of its own, its paths written
 * from the helmfile's folder, as helmfile loads them - then the part itself,
 * every part rendered over what the parts before it gave (`values` the
 * caller's, changed as each part is handed). A part or a base not read is a
 * row.
 */
const layersOf = (
  path: string,
  dir: string,
  label: (path: string) => string,
  root: () => Record<string, unknown>,
  each: (layer: Layer) => void,
  unread: (file: string, line: number, why: string) => void,
  depth = 0,
): void => {
  const source = readText(path);
  if (source === undefined) return;
  const file = label(path);
  for (const part of partsOf(source)) {
    const read = readPart(part, root());
    if (read.kind === 'unread') {
      unread(file, part.first + 1, read.why);
      continue;
    }
    const value = read.document.value;
    const bases = isRecord(value) && Array.isArray(value['bases']) ? value['bases'] : [];
    bases.forEach((base, index) => {
      const line = read.lineOf(read.document.at(['bases', index])?.line ?? 1);
      if (typeof base !== 'string' || /^[a-z][\w+.-]*::|^(?:git|https?):/i.test(base)) {
        unread(file, line, `the base ${String(base)} is not a file of the project`);
        return;
      }
      const at = pathFrom(dir, base);
      if (depth >= MOST_BASES || !existsSync(at)) {
        unread(file, line, `the base ${base} is ${depth >= MOST_BASES ? 'layered deeper than is followed' : 'not in the project'}`);
        return;
      }
      layersOf(at, dir, label, root, each, unread, depth + 1);
    });
    each({ document: read.document, lineOf: read.lineOf, file });
  }
};

/** The names a helmfile declares its environments by, its bases' included, read without rendering what decides them. */
const declaredEnvironments = (path: string, dir: string, label: (path: string) => string): string[] => {
  const names = new Set<string>();
  const unknown = { Environment: { Name: UNKNOWN_VALUE, Values: UNKNOWN_VALUE }, Values: UNKNOWN_VALUE, StateValues: UNKNOWN_VALUE };
  layersOf(
    path,
    dir,
    label,
    () => unknown,
    ({ document }) => {
      const environments = isRecord(document.value) ? document.value['environments'] : undefined;
      if (isRecord(environments)) for (const name of Object.keys(environments)) names.add(name);
    },
    () => undefined,
  );
  return [...names].sort();
};

/** Whether a value a condition names is false in the values: `orders.enabled`. */
const conditionFalse = (values: Record<string, unknown>, condition: string): boolean => {
  let at: unknown = values;
  for (const key of condition.split('.')) {
    if (!isRecord(at)) return false;
    at = at[key];
  }
  return at === false;
};

/** A path of a helmfile's, absolute from the folder it is written in. */
const pathFrom = (dir: string, written: string): string => resolve(dir, written);

/** A release a helmfile declares, as read in one environment, with the values the parts before it gave. */
interface Declared {
  readonly name: string;
  readonly namespace?: string;
  readonly release: Record<string, unknown>;
  readonly file: string;
  readonly line: number;
  readonly values: Record<string, unknown>;
  /** What it needs, as written: `name`, `namespace/name` or `context/namespace/name`. */
  readonly needs: readonly string[];
}

/** The release a `needs` entry names among those declared: by its name, and its namespace where the entry writes one. */
const needed = (need: string, declared: readonly Declared[]): Declared | undefined => {
  const parts = need.split('/');
  const name = parts[parts.length - 1];
  const namespace = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  return declared.find((each) => each.name === name && (namespace === undefined || namespace === '' || each.namespace === undefined || each.namespace === namespace));
};

/**
 * Every chart install a helmfile writes, one per release per environment,
 * and a row for each part it does not read. The helmfile is read with the
 * bases it layers (P273), and each release's `needs` is kept as the releases
 * installed before it: a command keeping releases by name with
 * `--include-needs` keeps what they need too (`--include-transitive-needs`,
 * what that needs in turn), and a need no release of the helmfile is, is the
 * finding `release-need-undefined`, as helmfile refuses to apply it.
 */
export const readHelmfile = (path: string, label: (path: string) => string, reading: HelmfileReading = {}): { installs: ChartInstall[]; rows: ManifestRow[] } => {
  if (readText(path) === undefined) return { installs: [], rows: [] };
  const dir = dirname(path);
  const declared = declaredEnvironments(path, dir, label);
  const environments = reading.environments ?? (declared.length === 0 ? ['default'] : declared);
  const installs: ChartInstall[] = [];
  const rows: ManifestRow[] = [];
  const unreadRow = (file: string, line: number, why: string, about: readonly string[]): void => {
    if (rows.some((seen) => seen.file === file && seen.line === line && seen.message.endsWith(why))) return;
    rows.push({
      reason: 'manifest-unread',
      file,
      line,
      message: `${file} is not read from line ${line}: ${why}`,
      hint: 'Write what the helmfile says as literals, or give the value it reads in the environment\'s values.',
      about: [...about],
    });
  };
  for (const environment of environments) {
    // An environment the file does not declare is one helmfile refuses, `default` aside.
    if (environment !== 'default' && !declared.includes(environment)) continue;
    let values: Record<string, unknown> = {};
    const root = (): Record<string, unknown> => ({ Environment: { Name: environment, Values: values, KubeContext: UNKNOWN_VALUE }, Values: values, StateValues: values, Namespace: UNKNOWN_VALUE });
    const stated = (): void => {
      for (const each of reading.stateFiles ?? []) values = mergedValues(values, valuesFile(each, root()) ?? {});
      for (const each of reading.stateSets ?? []) values = setValue(values, each);
    };
    stated();
    const releases: Declared[] = [];
    layersOf(
      path,
      dir,
      label,
      root,
      ({ document, lineOf, file }) => {
        const value = document.value;
        if (!isRecord(value)) return;
        const environmentsOf = value['environments'];
        const own = isRecord(environmentsOf) ? environmentsOf[environment] : undefined;
        for (const written of isRecord(own) && Array.isArray(own['values']) ? own['values'] : []) {
          const given = typeof written === 'string' ? valuesFile(pathFrom(dir, written), root()) : isRecord(written) ? written : undefined;
          if (given !== undefined) values = mergedValues(values, given);
        }
        // A command's state values are written over the environment's.
        if (own !== undefined) stated();
        (Array.isArray(value['releases']) ? value['releases'] : []).forEach((release, index) => {
          if (!isRecord(release) || typeof release['name'] !== 'string') return;
          const namespace = typeof release['namespace'] === 'string' ? release['namespace'] : undefined;
          const needs = (Array.isArray(release['needs']) ? release['needs'] : []).filter((each): each is string => typeof each === 'string');
          releases.push({ name: release['name'], ...(namespace === undefined ? {} : { namespace }), release, file, line: lineOf(document.at(['releases', index])?.line ?? 1), values, needs });
        });
      },
      (file, line, why) => unreadRow(file, line, why, []),
    );
    // A need no release of the helmfile is: helmfile refuses the whole of it.
    for (const each of releases) {
      for (const need of each.needs) {
        if (needed(need, releases) !== undefined) continue;
        if (rows.some((seen) => seen.reason === 'release-need-undefined' && seen.file === each.file && seen.line === each.line && seen.message.includes(`needs ${need},`))) continue;
        rows.push({
          reason: 'release-need-undefined',
          file: each.file,
          line: each.line,
          message: `The release ${each.name} (${each.file}:${each.line}) needs ${need}, which no release of the helmfile is; helmfile refuses to apply it`,
          hint: 'Name a release the helmfile or a base it layers declares, written namespace/name where its namespace is not the one assumed, or remove the need.',
          about: [each.name],
        });
      }
    }
    // The releases a command keeps, and with --include-needs what they need.
    const kept = new Set(reading.releases ?? []);
    if (kept.size > 0 && reading.needs !== undefined && reading.needs !== 'none') {
      const queue = releases.filter((each) => kept.has(each.name));
      while (queue.length > 0) {
        const each = queue.shift() as Declared;
        for (const need of each.needs) {
          const found = needed(need, releases);
          if (found === undefined || kept.has(found.name)) continue;
          kept.add(found.name);
          if (reading.needs === 'transitive') queue.push(found);
        }
      }
    }
    for (const each of releases) {
      const { release, name, namespace, file, line } = each;
      const chart = typeof release['chart'] === 'string' ? release['chart'] : undefined;
      if (chart === undefined) continue;
      if (kept.size > 0 && !kept.has(name)) continue;
      if (release['installed'] === false || (typeof release['condition'] === 'string' && conditionFalse(each.values, release['condition']))) continue;
      const chartDir = pathFrom(dir, chart);
      // A chart of a repository (`bitnami/redis`) is no directory of the project's.
      if (!existsSync(join(chartDir, 'Chart.yaml'))) continue;
      const releaseRoot = { Environment: { Name: environment, Values: each.values, KubeContext: UNKNOWN_VALUE }, Values: each.values, StateValues: each.values, Namespace: UNKNOWN_VALUE, Release: { Name: name, Namespace: namespace ?? UNKNOWN_VALUE } };
      const given = (Array.isArray(release['values']) ? release['values'] : []).flatMap((written): Array<string | Record<string, unknown>> => {
        if (isRecord(written)) return [written];
        if (typeof written !== 'string') return [];
        const at = pathFrom(dir, written);
        if (!at.endsWith('.gotmpl')) return existsSync(at) ? [at] : [];
        const rendered = valuesFile(at, releaseRoot);
        if (rendered === undefined) unreadRow(file, line, `${basename(at)} does not render with what the environment gives`, [name]);
        return rendered === undefined ? [] : [rendered];
      });
      const sets = (Array.isArray(release['set']) ? release['set'] : []).flatMap((set) => {
        if (!isRecord(set) || typeof set['name'] !== 'string') return [];
        const written = set['value'];
        return typeof written === 'string' || typeof written === 'number' || typeof written === 'boolean' ? [`${set['name']}=${String(written)}`] : [];
      });
      const needs = each.needs.flatMap((need) => {
        const found = needed(need, releases);
        return found === undefined ? [] : [found.name];
      });
      installs.push({
        chart: chartDir,
        release: name,
        ...(namespace === undefined ? {} : { namespace }),
        values: given,
        sets,
        file,
        line,
        environment,
        ...(needs.length === 0 ? {} : { needs }),
      });
    }
  }
  return { installs, rows };
};
