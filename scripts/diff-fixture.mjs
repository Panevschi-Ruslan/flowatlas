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
  // The head side breaks it: billing starts consuming order.gift-wrapped (P114).
  rules: [
    {
      name: 'billing-stays-out-of-gift-wrapping',
      note: 'gift wrapping is fulfilment, which orders does',
      forbid: { from: { service: 'billing' }, to: { channel: 'order.gift-*' } },
    },
  ],
};

const quiet = { out() {}, err() {}, tty: false };

/**
 * `fixtures/api-change-verdicts` (P390): a catalog whose head revision changes
 * its API and its messages, a storefront that calls it and a notifier that
 * consumes what it publishes; only the catalog is edited.
 */
const VERDICTS = {
  fixture: 'api-change-verdicts',
  repos: ['catalog', 'storefront', 'notifier', 'dashboard'],
  edited: ['catalog'],
  config: {
    services: [
      { name: 'catalog', repo: './catalog', type: 'nestjs', baseUrlEnv: ['CATALOG_URL'] },
      { name: 'storefront', repo: './storefront', type: 'nestjs' },
      { name: 'notifier', repo: './notifier', type: 'nestjs' },
      // P393: a browser client whose reads of the answers the verdicts weigh.
      { name: 'dashboard', repo: './dashboard', type: 'react', apiBaseEnv: ['VITE_CATALOG_URL'], apiTarget: { VITE_CATALOG_URL: 'catalog' } },
    ],
    adapters: {
      broker: {
        custom: [
          {
            name: 'event-bus',
            channelKind: 'channel',
            producers: [{ receiverType: ['EventBus'], method: 'publish', channelArg: 0, payloadArg: 1, kind: 'event' }],
          },
        ],
      },
    },
    output: '.flowatlas',
  },
};

/**
 * `fixtures/client-checks-verdicts` (P402): a catalog whose head revision
 * makes a query key and a header required and widens a status and a message
 * kind, a dashboard that sends one and not the other and switches over the
 * status with a default, and a notifier that switches over the kind with
 * none left over; only the catalog is edited.
 */
const CLIENT_CHECKS = {
  fixture: 'client-checks-verdicts',
  repos: ['catalog', 'notifier', 'dashboard'],
  edited: ['catalog'],
  config: {
    services: [
      { name: 'catalog', repo: './catalog', type: 'nestjs' },
      { name: 'notifier', repo: './notifier', type: 'nestjs' },
      { name: 'dashboard', repo: './dashboard', type: 'react', apiBaseEnv: ['VITE_CATALOG_URL'], apiTarget: { VITE_CATALOG_URL: 'catalog' } },
    ],
    adapters: VERDICTS.config.adapters,
    output: '.flowatlas',
  },
};

const MULTI_REPO_DIFF = { fixture: 'multi-repo-diff', repos: REPOS, edited: EDITED, config: CONFIG };

/**
 * Makes, builds and diffs a two-revision fixture under `fixtures/.scratch-diff-*`,
 * and says where its configuration and that directory are.
 */
const makeDiffProject = async (root, spec) => {
  const fixtures = join(root, 'fixtures');
  const fixture = join(fixtures, spec.fixture);
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
  writeFileSync(config, `${JSON.stringify(spec.config, null, 2)}\n`);
  for (const repo of spec.repos) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  cpSync(join(fixture, 'head'), project, { recursive: true });
  for (const repo of spec.edited) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'head');
  }
  await buildProject({ config });
  await runDiff('HEAD~1', undefined, { config, generatedAt: FIXED, ...(spec.fixture === 'multi-repo-diff' ? {} : { spec: true }) }, quiet);
  return { scratch, config };
};

/** `fixtures/multi-repo-diff`, made, built and diffed. */
export const diffFixtureProject = (root) => makeDiffProject(root, MULTI_REPO_DIFF);

/** `fixtures/api-change-verdicts`, made, built and diffed with its API documents (P390). */
export const verdictsFixtureProject = (root) => makeDiffProject(root, VERDICTS);

/** `fixtures/client-checks-verdicts`, made, built and diffed with its API documents (P402). */
export const clientChecksFixtureProject = (root) => makeDiffProject(root, CLIENT_CHECKS);
