/*
 * The action's first step (P231): install flowatlas, fetch the base commit of
 * this repository, clone the other repositories the configuration names, and
 * say the key the base graphs are cached under.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkoutPlan, cloneOf, parseRepositories, servicesOf, versionOf } from './lib.mjs';

const input = (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? '';
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const output = (name, value) => appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `${name}=${value}\n`);

const configPath = resolve(input('config') || 'flowatlas.config.json');
const token = input('token');
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8') || '{}');
const publishing = input('publish') === 'true';
const base = input('base') || event.pull_request?.base?.sha || (publishing ? 'HEAD' : '');
if (base === '') {
  console.log('::error::no base: run on a pull request, or give the base input');
  process.exit(1);
}

// flowatlas itself, at the version the action was released with unless told otherwise.
const version = versionOf(input('version'), process.env.GITHUB_ACTION_REF);
// `installed`: the flowatlas already on the path, as the repository's own test of this action uses.
if (version !== 'installed') run('npm', ['install', '--global', '--no-fund', '--no-audit', `@flowatlas/cli@${version}`]);

// The base commit of this repository: a checkout fetches one commit unless told otherwise.
if (!publishing) {
  try {
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', base]);
  } catch {
    console.log(`::warning::could not fetch ${base}; diff reads what the checkout has`);
  }
}

// The other repositories, where the configuration expects them.
const plan = checkoutPlan(servicesOf(configPath), parseRepositories(input('repositories')));
for (const name of plan.unknown) console.log(`::warning::repositories names ${name}, which the configuration does not`);
for (const name of plan.missing) console.log(`::warning::${name} is not checked out and repositories does not name it; the diff runs without it`);
for (const item of plan.fetch) {
  mkdirSync(dirname(item.dir), { recursive: true });
  // The token rides in a header git reads from its environment, never in the clone's remote.
  const clone = cloneOf(item, token);
  if (clone.secret !== undefined) console.log(`::add-mask::${clone.secret}`);
  try {
    run('git', clone.args, { env: { ...process.env, ...clone.env } });
  } catch {
    console.log(`::warning::could not clone ${item.repo} for ${item.name} with the token given; the diff runs without it`);
    continue;
  }
  if (input('install') === 'ci') {
    // Never a repository's own scripts: what an install is for here is types (D4).
    try {
      run('npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit'], { cwd: item.dir });
    } catch {
      console.log(`::warning::npm ci failed in ${item.name}; it is read without its dependencies`);
    }
  }
}
if (input('install') === 'ci') {
  try {
    run('npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit'], { cwd: process.cwd() });
  } catch {
    console.log('::warning::npm ci failed in this repository; it is read without its dependencies');
  }
}

// The base as a commit, so the cache is keyed by what was read, not by how it was named.
let baseCommit = base;
try {
  baseCommit = execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { encoding: 'utf8' }).trim();
} catch {
  // Not a commit this checkout has: the key says what was asked.
}

// The base graphs, cached under the commit, the configuration and the version that read them (D3).
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const outputDir = resolve(dirname(configPath), config.output ?? '.flowatlas');
const configHash = createHash('sha256').update(readFileSync(configPath)).digest('hex').slice(0, 12);
output('cache-path', join(outputDir, 'cache'));
output('cache-key', `flowatlas-${configHash}-${baseCommit}-${version}`);
output('base', base);
output('config', configPath);
// Where run.mjs writes the SARIF log, relative to the workspace, as hashFiles and upload-sarif take it.
output('sarif-file', relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), join(outputDir, 'flowatlas.sarif')).split(sep).join('/'));
