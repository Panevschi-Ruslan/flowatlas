/*
 * The action with `publish: true` (P236): on the main branch, build the
 * project's graph and write the team's bundle, for the next step to upload as
 * an artifact that `flowatlas pull gh:owner/repo/flowatlas-graph` reads.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const configPath = process.env.FLOWATLAS_CONFIG ?? resolve('flowatlas.config.json');
const bundle = resolve(process.env.RUNNER_TEMP ?? '.', 'flowatlas-graph', 'flowatlas-graph.tgz');

const flowatlas = (args) => spawnSync('flowatlas', args, { stdio: ['ignore', 'inherit', 'inherit'] }).status ?? 2;

if (flowatlas(['build', '--config', configPath]) === 2) {
  console.log('::error::flowatlas build could not read a repository; nothing published');
  process.exit(2);
}
if (flowatlas(['publish', '--config', configPath, '--output', bundle]) !== 0) process.exit(2);
appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `bundle=${relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), bundle).split(sep).join('/')}\nbundle-path=${join(bundle)}\n`);
