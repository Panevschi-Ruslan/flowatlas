/**
 * Where a SARIF log's paths come from (P115): the configuration says where
 * each repository is, and on which line each service and each rule is named,
 * for a finding about a whole service or a rule that has no file of its own.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { loadConfig, type GraphNode } from '@flowatlas/core';
import type { SarifPaths, SarifPlace } from './types.js';

/** A service's or a rule's own `name`, as one line of a configuration writes it. */
const NAMED = /"name"\s*:\s*("(?:[^"\\]|\\.)*")/;

/**
 * The first line, at or after `from`, naming each of `names`.
 *
 * Read from the text, because the parsed configuration keeps no lines; a name
 * not written as `"name": "…"` on one line has none, and what is placed by it
 * names the file alone.
 */
export const namedLines = (text: string, names: readonly string[], from = 0): Map<string, number> => {
  const wanted = new Set(names);
  const lines = new Map<string, number>();
  text.split('\n').forEach((line, index) => {
    if (index < from) return;
    const written = NAMED.exec(line)?.[1];
    const name = written === undefined ? undefined : (JSON.parse(written) as string);
    if (name !== undefined && wanted.has(name) && !lines.has(name)) lines.set(name, index + 1);
  });
  return lines;
};

/** The line `"rules"` opens on, so a rule is found among the rules and not among the services. */
const rulesFrom = (text: string): number => {
  const index = text.split('\n').findIndex((line) => /^\s*"rules"\s*:/.test(line));
  return index < 0 ? 0 : index;
};

/** Each repository's directory as the configuration writes it, `./` stripped; a declared service has none. */
export const repoDirsOf = (services: ReadonlyArray<{ name: string; repo: string; document?: unknown }>): Map<string, string> => {
  const dirs = new Map<string, string>();
  for (const service of services) {
    if (service.document !== undefined) continue;
    const dir = service.repo.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (dir !== '' && dir !== '.') dirs.set(service.name, dir);
  }
  return dirs;
};

/** `--sarif-root`, absolute, relative to where the command was typed. */
const rootOf = (sarifRoot: string | undefined): string | undefined =>
  sarifRoot === undefined ? undefined : isAbsolute(sarifRoot) ? sarifRoot : resolve(process.cwd(), sarifRoot);

/**
 * The paths of a log for the project a command reads. A bare database with
 * no configuration beside it has no repositories to place files under, and
 * its paths are the files as the rows name them.
 */
export const sarifPathsOf = (
  options: { config?: string; db?: string },
  sarifRoot?: string,
): SarifPaths => {
  const root = rootOf(sarifRoot);
  const from = options.config ?? (options.db === undefined ? process.cwd() : dirname(dirname(resolve(options.db))));
  try {
    const loaded = loadConfig(from, { checkRepos: false });
    const text = readFileSync(loaded.configPath, 'utf8');
    const services = namedLines(text, loaded.config.services.map((service) => service.name));
    const rules = namedLines(text, (loaded.config.rules ?? []).map((rule) => rule.name), rulesFrom(text));
    return {
      repoDirs: repoDirsOf(loaded.config.services),
      configFile: relative(loaded.rootDir, loaded.configPath).replace(/\\/g, '/'),
      serviceLine: (service) => services.get(service),
      ruleLine: (rule) => rules.get(rule),
      rootDir: loaded.rootDir,
      ...(root === undefined ? {} : { sarifRoot: root }),
    };
  } catch {
    return { repoDirs: new Map(), rootDir: process.cwd(), ...(root === undefined ? {} : { sarifRoot: root }) };
  }
};

/** Where a node is, as a finding is placed: its file in its repository, or its service alone. */
export const nodePlace = (node: Pick<GraphNode, 'repo' | 'file' | 'line'> | undefined): SarifPlace | undefined =>
  node === undefined
    ? undefined
    : { service: node.repo, file: node.file ?? '', ...(node.line === undefined ? {} : { line: node.line }) };

/** What a lookup of nodes by id needs to be: the database, or a graph read from a file. */
export interface NodeLookup {
  node(id: string): GraphNode | undefined;
}

/** A graph read into memory, looked up by id the way the database is. */
export const lookupOf = (graph: { nodes: readonly GraphNode[] }): NodeLookup => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return { node: (id) => byId.get(id) };
};
