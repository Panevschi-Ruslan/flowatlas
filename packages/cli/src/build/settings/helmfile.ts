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
 *
 * Its sub-helmfiles (`helmfiles:`) are read as helmfile reads them (P289):
 * each its own state, read in the environment of the helmfile naming it, with
 * the state values the entry gives and the releases its selectors keep. A
 * release takes what the release templates it inherits write (`templates:`
 * and `inherit:`, or a YAML merge key), and its fields written as templates of
 * the release (`{{ .Release.Name }}`) are rendered with it. `helmDefaults`
 * says how helm is run, not what is installed, and is not read.
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
  /** Label selectors (P289): `tier=api,name!=cache`; a release any of them matches is kept, with `releases` too. */
  readonly selectors?: readonly string[];
  /** State values written inline (P289): what a sub-helmfile entry's `values` gives, over the environment's. */
  readonly stateValues?: readonly Readonly<Record<string, unknown>>[];
  /** Whether helmfile runs with explicit selector inheritance (P295): a sub-helmfile writing no selectors then keeps every release, unless it writes `selectorsInherited`. */
  readonly explicitSelectors?: boolean;
}

/** How deep sub-helmfiles are followed; deeper is a row. */
const MOST_SUB_HELMFILES = 4;

/** The labels a release is selected by: its own, the helmfile's `commonLabels`, and its name, namespace and chart (P289). */
const labelsOf = (release: Record<string, unknown>, common: Readonly<Record<string, string>>): Record<string, string> => {
  const own = isRecord(release['labels']) ? textsOf(release['labels']) : {};
  return {
    ...common,
    ...own,
    ...(typeof release['name'] === 'string' ? { name: release['name'] } : {}),
    ...(typeof release['namespace'] === 'string' ? { namespace: release['namespace'] } : {}),
    ...(typeof release['chart'] === 'string' ? { chart: release['chart'] } : {}),
  };
};

/** The members of a mapping written as text, a number or a boolean, as text. */
const textsOf = (value: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? [[key, String(item)]] : [])));

/** Whether a release's labels pass one selector: each `k=v` and `k!=v` of it (P289). */
const selectorMatches = (selector: string, labels: Readonly<Record<string, string>>): boolean =>
  selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .every((part) => {
      const not = /^([^!=]+)!=(.*)$/.exec(part);
      if (not !== null) return labels[(not[1] as string).trim()] !== (not[2] as string).trim();
      const is = /^([^!=]+)==?(.*)$/.exec(part);
      return is !== null && labels[(is[1] as string).trim()] === (is[2] as string).trim();
    });

/** The keys of a release whose lists helmfile appends a template's to, the template's first (P289). */
const APPENDED = new Set(['values', 'set', 'secrets', 'needs']);

/** A key of a release written over what was there: a list of {@link APPENDED} after the one before it, anything else replacing it. */
const writtenOver = (into: Record<string, unknown>, key: string, value: unknown): void => {
  const before = into[key];
  into[key] = APPENDED.has(key) && Array.isArray(before) && Array.isArray(value) ? [...before, ...value] : value;
};

/**
 * A release with the release templates it inherits (P289): each `inherit`
 * entry's template, its `except` keys left out, under the release's own keys.
 * A template no part of the helmfile declares is said.
 */
const inherited = (release: Record<string, unknown>, templates: ReadonlyMap<string, Record<string, unknown>>): { release: Record<string, unknown>; missing: string[] } => {
  const written = release['inherit'];
  const entries = Array.isArray(written) ? written : written === undefined ? [] : [written];
  if (entries.length === 0) return { release, missing: [] };
  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : isRecord(entry) && typeof entry['template'] === 'string' ? entry['template'] : undefined;
    const template = name === undefined ? undefined : templates.get(name);
    if (template === undefined) {
      missing.push(name ?? JSON.stringify(entry));
      continue;
    }
    const except = new Set(isRecord(entry) && Array.isArray(entry['except']) ? entry['except'].map(String) : []);
    for (const [key, value] of Object.entries(template)) if (!except.has(key)) writtenOver(out, key, value);
  }
  for (const [key, value] of Object.entries(release)) if (key !== 'inherit') writtenOver(out, key, value);
  return { release: out, missing };
};

/**
 * A release's fields written as templates of the release (P289), each
 * rendered with the release - `.Release.Name`, `.Release.Namespace`,
 * `.Release.Labels`, the environment and its values - as helmfile renders a
 * release template's fields. A field that does not render one way is kept as
 * written, and said.
 */
const releaseRendered = (release: Record<string, unknown>, root: Record<string, unknown>, unread: (why: string) => void): Record<string, unknown> => {
  const render = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.includes('{{')) return value;
      const rendered = renderingsOver(value, root);
      if (rendered.kind === 'rendered' && rendered.ways.length === 1) return rendered.ways[0]?.text;
      unread(`${value} does not render one way with the release`);
      return value;
    }
    if (Array.isArray(value)) return value.map(render);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]));
    return value;
  };
  return Object.fromEntries(Object.entries(release).map(([key, value]) => [key, key === 'name' ? value : render(value)]));
};

/** A segment of a path written with `*`, as a pattern of names. */
const segmentPattern = (segment: string): RegExp => new RegExp(`^${segment.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

/** The files a sub-helmfile's `path` names (P289): a path, or one with `*` in its segments, every match sorted. */
const pathsMatching = (dir: string, written: string): string[] => {
  if (!written.includes('*')) return existsSync(resolve(dir, written)) ? [resolve(dir, written)] : [];
  let found = [dir];
  for (const segment of written.split(/[\\/]/).filter((part) => part !== '' && part !== '.')) {
    if (!segment.includes('*')) {
      found = found.map((each) => join(each, segment));
      continue;
    }
    const pattern = segmentPattern(segment);
    found = found.flatMap((each) => {
      try {
        return readdirSync(each)
          .filter((name) => pattern.test(name))
          .sort()
          .map((name) => join(each, name));
      } catch {
        return [];
      }
    });
  }
  return found.filter((each) => existsSync(each));
};

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
  /** The labels it is selected by (P289). */
  readonly labels: Readonly<Record<string, string>>;
}

/** The release a `needs` entry names among those declared: by its name, and its namespace where the entry writes one. */
const needed = (need: string, declared: readonly Declared[]): Declared | undefined => {
  const parts = need.split('/');
  const name = parts[parts.length - 1];
  const namespace = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  return declared.find((each) => each.name === name && (namespace === undefined || namespace === '' || each.namespace === undefined || each.namespace === namespace));
};

/** A release's need, in the environment it is read in, that no release of its own helmfile is (P295). */
interface Pending {
  readonly environment: string;
  readonly release: Declared;
  readonly need: string;
}

/** What one helmfile and its sub-helmfiles install, with every release they declare and the needs their own helmfile does not answer. */
interface State {
  readonly installs: ChartInstall[];
  readonly rows: ManifestRow[];
  readonly declared: Array<{ readonly environment: string; readonly release: Declared }>;
  readonly pending: Pending[];
}

/**
 * Every chart install a helmfile writes, one per release per environment,
 * and a row for each part it does not read. The helmfile is read with the
 * bases it layers (P273), and each release's `needs` is kept as the releases
 * installed before it: a command keeping releases by name with
 * `--include-needs` keeps what they need too (`--include-transitive-needs`,
 * what that needs in turn). A need is a release of the whole state, the
 * helmfile's and its sub-helmfiles' (P295), and a need no release of it is,
 * is the finding `release-need-undefined`, as helmfile refuses to apply it.
 */
export const readHelmfile = (path: string, label: (path: string) => string, reading: HelmfileReading = {}): { installs: ChartInstall[]; rows: ManifestRow[] } => {
  const state = readState(path, label, reading, []);
  const installs = [...state.installs];
  const rows = [...state.rows];
  for (const { environment, release, need } of state.pending) {
    const found = needed(need, state.declared.filter((each) => each.environment === environment && each.release !== release).map((each) => each.release));
    if (found !== undefined) {
      // A need another helmfile of the state answers is installed before it, as one of its own is.
      installs.forEach((install, index) => {
        if (install.file !== release.file || install.line !== release.line || install.environment !== environment || install.needs?.includes(found.name) === true) return;
        installs[index] = { ...install, needs: [...(install.needs ?? []), found.name] };
      });
      continue;
    }
    if (rows.some((seen) => seen.reason === 'release-need-undefined' && seen.file === release.file && seen.line === release.line && seen.message.includes(`needs ${need},`))) continue;
    rows.push({
      reason: 'release-need-undefined',
      file: release.file,
      line: release.line,
      message: `The release ${release.name} (${release.file}:${release.line}) needs ${need}, which no release of the helmfile is; helmfile refuses to apply it`,
      hint: 'Name a release the helmfile or a base it layers declares, written namespace/name where its namespace is not the one assumed, or remove the need.',
      about: [release.name],
    });
  }
  return { installs, rows };
};

const readState = (
  path: string,
  label: (path: string) => string,
  reading: HelmfileReading,
  /** The helmfiles naming this one as a sub-helmfile, outermost first (P289). */
  within: readonly string[],
): State => {
  const declaredReleases: State['declared'] = [];
  const pending: Pending[] = [];
  if (readText(path) === undefined) return { installs: [], rows: [], declared: declaredReleases, pending };
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
  /** Hooks are programs helmfile runs around an install (P295): run, not read, so what they apply is said, never guessed. */
  const hooksRow = (file: string, line: number, hooks: unknown, whose: string, about: readonly string[]): void => {
    if (!Array.isArray(hooks) || hooks.length === 0) return;
    const events = [...new Set(hooks.filter(isRecord).flatMap((hook) => (Array.isArray(hook['events']) ? hook['events'].filter((event): event is string => typeof event === 'string') : [])))];
    const message = `${whose} runs ${hooks.length === 1 ? 'a hook' : `${hooks.length} hooks`}${events.length === 0 ? '' : ` (${events.join(', ')})`}, commands helmfile runs around the install; a hook is a program that is run, not read, so whatever it applies to the cluster is not drawn`;
    if (rows.some((seen) => seen.file === file && seen.line === line && seen.message === message)) return;
    rows.push({ reason: 'manifest-unread', file, line, message, hint: 'Write what the hook applies as a manifest or a release of the helmfile, or annotate the request with the service it reaches (/** @flowatlas-calls <service> METHOD /path */).', about: [...about] });
  };
  for (const environment of environments) {
    // An environment the file does not declare is one helmfile refuses, `default` aside.
    if (environment !== 'default' && !declared.includes(environment)) continue;
    let values: Record<string, unknown> = {};
    const root = (): Record<string, unknown> => ({ Environment: { Name: environment, Values: values, KubeContext: UNKNOWN_VALUE }, Values: values, StateValues: values, Namespace: UNKNOWN_VALUE });
    const stated = (): void => {
      for (const each of reading.stateFiles ?? []) values = mergedValues(values, valuesFile(each, root()) ?? {});
      for (const each of reading.stateValues ?? []) values = mergedValues(values, each as Record<string, unknown>);
      for (const each of reading.stateSets ?? []) values = setValue(values, each);
    };
    stated();
    const releases: Declared[] = [];
    // What the parts declare for the releases after them (P289): release templates, common labels, sub-helmfiles.
    const templates = new Map<string, Record<string, unknown>>();
    let common: Record<string, string> = {};
    const subs: Array<{ entry: unknown; file: string; line: number; values: Record<string, unknown> }> = [];
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
        if (isRecord(value['templates'])) for (const [name, template] of Object.entries(value['templates'])) if (isRecord(template)) templates.set(name, template);
        if (isRecord(value['commonLabels'])) common = { ...common, ...textsOf(value['commonLabels']) };
        hooksRow(file, lineOf(document.at(['hooks'])?.line ?? 1), value['hooks'], file, []);
        (Array.isArray(value['helmfiles']) ? value['helmfiles'] : []).forEach((entry, index) => {
          subs.push({ entry, file, line: lineOf(document.at(['helmfiles', index])?.line ?? 1), values });
        });
        (Array.isArray(value['releases']) ? value['releases'] : []).forEach((written, index) => {
          if (!isRecord(written) || typeof written['name'] !== 'string') return;
          const line = lineOf(document.at(['releases', index])?.line ?? 1);
          const { release: merged, missing } = inherited(written, templates);
          for (const name of missing) unreadRow(file, line, `the release ${written['name']} inherits the template ${name}, which no part of the helmfile declares`, [written['name']]);
          // A release template's fields are rendered with the release (P289).
          const name = written['name'];
          const namespace = typeof merged['namespace'] === 'string' && !merged['namespace'].includes('{{') ? merged['namespace'] : undefined;
          const labels = labelsOf(merged, common);
          const releaseRoot = { ...root(), Release: { Name: name, Namespace: namespace ?? UNKNOWN_VALUE, Labels: labels, Chart: typeof merged['chart'] === 'string' ? merged['chart'] : UNKNOWN_VALUE, KubeContext: UNKNOWN_VALUE } };
          const release = releaseRendered(merged, releaseRoot, (why) => unreadRow(file, line, why, [name]));
          const renderedNamespace = typeof release['namespace'] === 'string' ? release['namespace'] : undefined;
          const needs = (Array.isArray(release['needs']) ? release['needs'] : []).filter((each): each is string => typeof each === 'string');
          hooksRow(file, line, release['hooks'], `The release ${name} (${file}:${line})`, [name]);
          releases.push({ name, ...(renderedNamespace === undefined ? {} : { namespace: renderedNamespace }), release, file, line, values, needs, labels: labelsOf(release, common) });
        });
      },
      (file, line, why) => unreadRow(file, line, why, []),
    );
    // A need no release of the helmfile is, is asked of the whole state once it is read (P295).
    for (const each of releases) {
      declaredReleases.push({ environment, release: each });
      for (const need of each.needs) if (needed(need, releases) === undefined) pending.push({ environment, release: each, need });
    }
    // The releases a command keeps - by name, or by the labels its selectors ask (P289) - and with --include-needs what they need.
    const selectors = reading.selectors ?? [];
    const named = new Set(reading.releases ?? []);
    const selecting = selectors.length > 0 || named.size > 0;
    const kept = new Set(selecting ? releases.filter((each) => named.has(each.name) || selectors.some((selector) => selectorMatches(selector, each.labels))).map((each) => each.name) : []);
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
    // Sub-helmfiles first, as helmfile applies them (P289): each its own state, in this environment.
    for (const sub of subs) {
      const entry = isRecord(sub.entry) ? sub.entry : { path: sub.entry };
      const written = entry['path'];
      if (typeof written !== 'string' || /^[a-z][\w+.-]*::|^(?:git|https?):/i.test(written)) {
        unreadRow(sub.file, sub.line, typeof written === 'string' ? `the sub-helmfile ${written} is fetched from outside the project when helmfile runs, and nothing remote is fetched here` : `the sub-helmfile ${String(written)} names no path`, []);
        continue;
      }
      if (written.includes('{{')) {
        unreadRow(sub.file, sub.line, `the sub-helmfile ${written} is named by a template`, []);
        continue;
      }
      const found = pathsMatching(dir, written).flatMap((each) => (helmfilesIn(each).length > 0 ? helmfilesIn(each) : [each]));
      if (found.length === 0) {
        unreadRow(sub.file, sub.line, `the sub-helmfile ${written} is not in the project`, []);
        continue;
      }
      const given = (Array.isArray(entry['values']) ? entry['values'] : []).flatMap((each): Array<Record<string, unknown>> => {
        if (isRecord(each)) return [each];
        if (typeof each !== 'string') return [];
        const read = valuesFile(pathFrom(dir, each), root());
        return read === undefined ? [] : [read];
      });
      const own = Array.isArray(entry['selectors']) ? entry['selectors'].filter((each): each is string => typeof each === 'string') : undefined;
      const inherits = entry['selectorsInherited'] === true;
      if (own !== undefined && inherits) {
        unreadRow(sub.file, sub.line, `the sub-helmfile ${written} writes both selectors and selectorsInherited, which helmfile refuses`, []);
        continue;
      }
      // The selectors a sub-helmfile is read with (P295): its own; those this helmfile is read with, where it inherits them - by
      // `selectorsInherited`, or by writing none while helmfile runs without explicit selector inheritance; or none, every release.
      const parents: HelmfileReading = { ...(reading.releases === undefined ? {} : { releases: reading.releases }), ...(reading.selectors === undefined ? {} : { selectors: reading.selectors }) };
      const chosen: HelmfileReading = inherits || (own === undefined && reading.explicitSelectors !== true) ? parents : { selectors: own ?? [] };
      for (const each of found) {
        if (within.length >= MOST_SUB_HELMFILES || within.includes(each) || each === path) {
          unreadRow(sub.file, sub.line, `the sub-helmfile ${label(each)} is ${within.includes(each) || each === path ? 'one of the helmfiles naming it' : 'nested deeper than is followed'}`, []);
          continue;
        }
        const read = readState(
          each,
          label,
          { environments: [environment], stateValues: given, ...chosen, ...(reading.needs === undefined ? {} : { needs: reading.needs }), ...(reading.explicitSelectors === undefined ? {} : { explicitSelectors: reading.explicitSelectors }) },
          [...within, path],
        );
        for (const install of read.installs) installs.push(install);
        for (const row of read.rows) if (!rows.some((seen) => seen.file === row.file && seen.line === row.line && seen.message === row.message)) rows.push(row);
        declaredReleases.push(...read.declared);
        pending.push(...read.pending);
      }
    }
    for (const each of releases) {
      const { release, name, namespace, file, line } = each;
      const chart = typeof release['chart'] === 'string' ? release['chart'] : undefined;
      if (chart === undefined) continue;
      if (selecting && !kept.has(name)) continue;
      if (release['installed'] === false || (typeof release['condition'] === 'string' && conditionFalse(each.values, release['condition']))) continue;
      const chartDir = pathFrom(dir, chart);
      // A chart of a repository (`bitnami/redis`) is no directory of the project's.
      if (!existsSync(join(chartDir, 'Chart.yaml'))) continue;
      const releaseRoot = { Environment: { Name: environment, Values: each.values, KubeContext: UNKNOWN_VALUE }, Values: each.values, StateValues: each.values, Namespace: UNKNOWN_VALUE, Release: { Name: name, Namespace: namespace ?? UNKNOWN_VALUE, Labels: each.labels } };
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
  return { installs, rows, declared: declaredReleases, pending };
};
