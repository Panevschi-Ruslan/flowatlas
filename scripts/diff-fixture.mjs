/**
 * `fixtures/multi-repo-diff` made into a project with history, built and
 * diffed, for the scripts that ask questions of a diff (P96).
 *
 * The fixture holds two revisions as files: `base/` is the whole project and
 * `head/` the files that differ. Each repository becomes a git repository with
 * `base` committed, `head` laid over it and committed again, under one author
 * and one date, so the commits - and every sha an answer names - are the same
 * on every machine. The head is then built (the database the server reads) and
 * compared with `HEAD~1` (the `diff.json` beside it).
 *
 * The copy goes beside the fixtures, so it still resolves the type stubs
 * hoisted there, under a `.scratch-` name the repository ignores; the caller
 * removes it.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProject, runDiff } from '../packages/cli/dist/index.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const REPOS = ['orders', 'gateway', 'billing', 'web', 'bot'];
const EDITED = ['orders', 'billing'];

/** The configuration the fixture is read with: the three services that hold code. */
const CONFIG = {
  services: [
    { name: 'gateway', repo: './gateway', type: 'nestjs' },
    { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'billing', repo: './billing', type: 'nestjs', baseUrlEnv: ['BILLING_URL'] },
  ],
  output: '.flowatlas',
};

const quiet = { out() {}, err() {}, tty: false };

/**
 * Makes, builds and diffs the project under `fixtures/.scratch-diff-*`, and
 * says where its configuration and that directory are.
 */
export const diffFixtureProject = async (root) => {
  const fixtures = join(root, 'fixtures');
  const fixture = join(fixtures, 'multi-repo-diff');
  const scratch = mkdtempSync(join(fixtures, '.scratch-diff-'));
  const project = join(scratch, 'project');
  const config = join(project, 'flowatlas.config.json');
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: FIXED,
    GIT_COMMITTER_DATE: FIXED,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (repo, ...args) =>
    execFileSync(
      'git',
      ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { env, stdio: 'pipe' },
    );

  cpSync(join(fixture, 'base'), project, { recursive: true });
  writeFileSync(config, `${JSON.stringify(CONFIG, null, 2)}\n`);
  for (const repo of REPOS) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  cpSync(join(fixture, 'head'), project, { recursive: true });
  for (const repo of EDITED) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'head');
  }
  await buildProject({ config });
  await runDiff('HEAD~1', undefined, { config, generatedAt: FIXED }, quiet);
  return { scratch, config };
};
