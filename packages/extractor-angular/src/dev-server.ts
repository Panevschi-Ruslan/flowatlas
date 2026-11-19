import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { proxyConfigFile, scriptCommands } from '@flowatlas/adapters-entry';
import type { ExtractContext, ListenPort, ProxyReading } from '@flowatlas/core';

/**
 * Where an Angular application's dev server listens (P254), and what it
 * forwards (P257): the `port` and the `proxyConfig` of each project's `serve`
 * target in `angular.json` - its options and each of its configurations - or
 * of the `serve` target of a workspace tool's `project.json`, and
 * `ng serve --port` / `--proxy-config` in a script. Angular's own default,
 * 4200, is not assumed: the CLI offers another port where it is taken. Each
 * port is a dev server's (`devServer`), which forwards what it does not serve.
 */

const ADAPTER = 'angular';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const portOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;

/** The line a `"<key>": <value>` is first written on, from an offset of the text. */
const valueLine = (text: string, key: string, value: unknown, from: number): number => {
  const at = new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
  at.lastIndex = from;
  const found = at.exec(text);
  return found === null ? 1 : text.slice(0, found.index).split('\n').length;
};

/** One `serve` target, with every set of options it runs with and where it is written. */
interface ServeTarget {
  readonly file: string;
  readonly text: string;
  readonly from: number;
  readonly options: ReadonlyArray<Record<string, unknown>>;
}

const readJson = (repoDir: string, file: string): { text: string; value: unknown } | undefined => {
  try {
    const text = readFileSync(join(repoDir, file), 'utf8');
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
};

const serveOf = (file: string, text: string, from: number, targets: unknown): ServeTarget | undefined => {
  const serve = isRecord(targets) ? targets['serve'] : undefined;
  if (!isRecord(serve)) return undefined;
  const options = isRecord(serve['options']) ? [serve['options']] : [];
  const configurations = isRecord(serve['configurations']) ? Object.values(serve['configurations']).filter(isRecord) : [];
  return { file, text, from, options: [...options, ...configurations] };
};

/** Every project's `serve` target: `angular.json`'s, and a workspace tool's `project.json`'s. */
const serveTargets = (repoDir: string): ServeTarget[] => {
  const found: ServeTarget[] = [];
  const workspace = readJson(repoDir, 'angular.json');
  const projects = isRecord(workspace?.value) ? workspace.value['projects'] : undefined;
  if (workspace !== undefined && isRecord(projects)) {
    for (const [name, project] of Object.entries(projects)) {
      if (!isRecord(project)) continue;
      const target = serveOf('angular.json', workspace.text, Math.max(0, workspace.text.indexOf(JSON.stringify(name))), project['architect'] ?? project['targets']);
      if (target !== undefined) found.push(target);
    }
  }
  const project = readJson(repoDir, 'project.json');
  if (project !== undefined && isRecord(project.value)) {
    const target = serveOf('project.json', project.text, 0, project.value['targets']);
    if (target !== undefined) found.push(target);
  }
  return found;
};

/** The ports every `serve` target writes. */
const workspacePorts = (repoDir: string): ListenPort[] => {
  const found: ListenPort[] = [];
  for (const target of serveTargets(repoDir)) {
    for (const each of target.options) {
      const port = portOf(each['port']);
      if (port !== undefined && !found.some((seen) => seen.port === port)) {
        found.push({ port, file: target.file, line: valueLine(target.text, 'port', port, target.from), devServer: true });
      }
    }
  }
  return found;
};

/** Every port an Angular application's dev server is started on. */
export const angularListens = (ctx: ExtractContext): ListenPort[] => [
  ...workspacePorts(ctx.repoDir),
  ...scriptCommands(ctx.repoDir, /\bng\s+serve\b/).flatMap((each) =>
    each.port === undefined ? [] : [{ port: each.port, file: 'package.json', line: each.line, devServer: true as const }],
  ),
];

/** `--proxy-config <file>` on an `ng serve` script. */
const scriptProxyConfigs = (repoDir: string): Array<{ path: string; line: number }> =>
  scriptCommands(repoDir, /\bng\s+serve\b/).flatMap((each) => {
    const path = /(?:^|\s)--proxy-config(?:\s+|=)(\S+)/.exec(each.command)?.[1];
    return path === undefined ? [] : [{ path: path.replace(/^['"]|['"]$/g, ''), line: each.line }];
  });

/** Every rule an Angular application's dev server forwards by, from each proxy configuration it is started with. */
export const angularProxies = (ctx: ExtractContext): ProxyReading => {
  const named: Array<{ path: string; file: string; line: number }> = [];
  for (const target of serveTargets(ctx.repoDir)) {
    for (const each of target.options) {
      const path = each['proxyConfig'];
      if (typeof path === 'string' && !named.some((seen) => seen.path === path)) {
        named.push({ path, file: target.file, line: valueLine(target.text, 'proxyConfig', path, target.from) });
      }
    }
  }
  for (const each of scriptProxyConfigs(ctx.repoDir)) {
    if (!named.some((seen) => seen.path === each.path)) named.push({ ...each, file: 'package.json' });
  }
  const read = named.map((each) => proxyConfigFile(ctx.repoDir, each.path, ADAPTER, { file: each.file, line: each.line }));
  return { rules: read.flatMap((each) => each.rules), rows: read.flatMap((each) => each.rows) };
};
