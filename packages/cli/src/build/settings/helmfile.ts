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

/** The helmfiles of a directory: its `helmfile.yaml` (or `.gotmpl`), or every file of its `helmfile.d/`. */
export const helmfilesAt = (dir: string): string[] => {
  const own = HELMFILE_NAMES.map((name) => join(dir, name)).find((path) => existsSync(path));
  if (own !== undefined) return [own];
  const folder = join(dir, HELMFILE_FOLDER);
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

/** What one reading of a helmfile is given: the environments to install, the state values a command sets, the releases it keeps. */
export interface HelmfileReading {
  /** The environments its commands name; every one it declares where none does. */
  readonly environments?: readonly string[];
  readonly stateSets?: readonly string[];
  /** State values files, absolute. */
  readonly stateFiles?: readonly string[];
  /** The releases the commands keep by name; every release where empty. */
  readonly releases?: readonly string[];
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

/** The names a helmfile declares its environments by, read without rendering what decides them. */
const declaredEnvironments = (source: string): string[] => {
  const names = new Set<string>();
  for (const part of partsOf(source)) {
    const read = readPart(part, { Environment: { Name: UNKNOWN_VALUE, Values: UNKNOWN_VALUE }, Values: UNKNOWN_VALUE, StateValues: UNKNOWN_VALUE });
    if (read.kind !== 'read' || !isRecord(read.document.value)) continue;
    const environments = read.document.value['environments'];
    if (isRecord(environments)) for (const name of Object.keys(environments)) names.add(name);
  }
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

/**
 * Every chart install a helmfile writes, one per release per environment,
 * and a row for each part it does not read.
 */
export const readHelmfile = (path: string, label: (path: string) => string, reading: HelmfileReading = {}): { installs: ChartInstall[]; rows: ManifestRow[] } => {
  const source = readText(path);
  if (source === undefined) return { installs: [], rows: [] };
  const dir = dirname(path);
  const file = label(path);
  const declared = declaredEnvironments(source);
  const environments = reading.environments ?? (declared.length === 0 ? ['default'] : declared);
  const installs: ChartInstall[] = [];
  const rows: ManifestRow[] = [];
  const unreadRow = (line: number, why: string, about: readonly string[]): void => {
    if (rows.some((seen) => seen.line === line && seen.message.endsWith(why))) return;
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
    for (const part of partsOf(source)) {
      const read = readPart(part, root());
      if (read.kind === 'unread') {
        unreadRow(part.first + 1, read.why, []);
        continue;
      }
      const value = read.document.value;
      if (!isRecord(value)) continue;
      const environmentsOf = value['environments'];
      const own = isRecord(environmentsOf) ? environmentsOf[environment] : undefined;
      for (const written of isRecord(own) && Array.isArray(own['values']) ? own['values'] : []) {
        const given = typeof written === 'string' ? valuesFile(pathFrom(dir, written), root()) : isRecord(written) ? written : undefined;
        if (given !== undefined) values = mergedValues(values, given);
      }
      // A command's state values are written over the environment's.
      if (own !== undefined) stated();
      const releases = Array.isArray(value['releases']) ? value['releases'] : [];
      releases.forEach((release, index) => {
        if (!isRecord(release)) return;
        const name = typeof release['name'] === 'string' ? release['name'] : undefined;
        const chart = typeof release['chart'] === 'string' ? release['chart'] : undefined;
        if (name === undefined || chart === undefined) return;
        if ((reading.releases ?? []).length > 0 && !(reading.releases as readonly string[]).includes(name)) return;
        if (release['installed'] === false || (typeof release['condition'] === 'string' && conditionFalse(values, release['condition']))) return;
        const line = read.lineOf(read.document.at(['releases', index])?.line ?? 1);
        const chartDir = pathFrom(dir, chart);
        // A chart of a repository (`bitnami/redis`) is no directory of the project's.
        if (!existsSync(join(chartDir, 'Chart.yaml'))) return;
        const namespace = typeof release['namespace'] === 'string' ? release['namespace'] : undefined;
        const releaseRoot = { ...root(), Release: { Name: name, Namespace: namespace ?? UNKNOWN_VALUE } };
        const given = (Array.isArray(release['values']) ? release['values'] : []).flatMap((written): Array<string | Record<string, unknown>> => {
          if (isRecord(written)) return [written];
          if (typeof written !== 'string') return [];
          const at = pathFrom(dir, written);
          if (!at.endsWith('.gotmpl')) return existsSync(at) ? [at] : [];
          const rendered = valuesFile(at, releaseRoot);
          if (rendered === undefined) unreadRow(line, `${basename(at)} does not render with what the environment gives`, [name]);
          return rendered === undefined ? [] : [rendered];
        });
        const sets = (Array.isArray(release['set']) ? release['set'] : []).flatMap((each) => {
          if (!isRecord(each) || typeof each['name'] !== 'string') return [];
          const set = each['value'];
          return typeof set === 'string' || typeof set === 'number' || typeof set === 'boolean' ? [`${each['name']}=${String(set)}`] : [];
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
        });
      });
    }
  }
  return { installs, rows };
};
