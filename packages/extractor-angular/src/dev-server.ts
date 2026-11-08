import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptCommands } from '@flowatlas/adapters-entry';
import type { ExtractContext, ListenPort } from '@flowatlas/core';

/**
 * Where an Angular application's dev server listens (P254): the `port` of
 * each project's `serve` target in `angular.json` - its options and each of
 * its configurations - and `ng serve --port` in a script. Angular's own
 * default, 4200, is not assumed: the CLI offers another port where it is
 * taken. Each is a dev server's (`devServer`), which forwards what it does not
 * serve (`proxyConfig`).
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const portOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;

/** The line a `"port": <port>` is first written on, from an offset of the text. */
const portLine = (text: string, port: number, from: number): number => {
  const at = new RegExp(`"port"\\s*:\\s*${port}\\b`, 'g');
  at.lastIndex = from;
  const found = at.exec(text);
  return found === null ? 1 : text.slice(0, found.index).split('\n').length;
};

/** The ports every project's `serve` target in a workspace file writes. */
const workspacePorts = (repoDir: string): ListenPort[] => {
  let text: string;
  let workspace: unknown;
  try {
    text = readFileSync(join(repoDir, 'angular.json'), 'utf8');
    workspace = JSON.parse(text);
  } catch {
    return [];
  }
  const projects = isRecord(workspace) ? workspace['projects'] : undefined;
  if (!isRecord(projects)) return [];
  const found: ListenPort[] = [];
  for (const [name, project] of Object.entries(projects)) {
    if (!isRecord(project)) continue;
    const targets = project['architect'] ?? project['targets'];
    const serve = isRecord(targets) ? targets['serve'] : undefined;
    if (!isRecord(serve)) continue;
    const from = Math.max(0, text.indexOf(JSON.stringify(name)));
    const options = isRecord(serve['options']) ? [serve['options']] : [];
    const configurations = isRecord(serve['configurations']) ? Object.values(serve['configurations']).filter(isRecord) : [];
    for (const each of [...options, ...configurations]) {
      const port = portOf(each['port']);
      if (port !== undefined && !found.some((seen) => seen.port === port)) found.push({ port, file: 'angular.json', line: portLine(text, port, from), devServer: true });
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
