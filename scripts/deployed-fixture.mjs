/**
 * `fixtures/multi-repo-deployed` made into three repositories with history,
 * for `flowatlas check --env` (P117).
 *
 * Every repository gets `v1/` committed on `main` and tagged `v1` (what prod
 * runs). Then `billing` gets one more commit on `main` (`billing-main/`,
 * what staging runs), `gateway` a branch `invoice-on-checkout`
 * (`gateway-branch/`) and `orders` a branch `drop-lookup` (`orders-branch/`),
 * each left checked out on `main`. One author and one date, so every sha an
 * answer names is the same on every machine. The pins file is the fixture's
 * own `flowatlas.deployed.json`.
 *
 * The copy goes beside the fixtures, so it still resolves the type stubs
 * hoisted there, under a `.scratch-` name the repository ignores; the caller
 * removes it.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXED = '2026-01-01T00:00:00.000Z';
const REPOS = ['gateway', 'orders', 'billing'];

/** The configuration the fixture is read with. */
export const DEPLOYED_CONFIG = {
  services: [
    { name: 'gateway', repo: './gateway', type: 'nestjs' },
    { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
    { name: 'billing', repo: './billing', type: 'nestjs', baseUrlEnv: ['BILLING_URL'] },
  ],
  output: '.flowatlas',
  // Broken by every version billing has: listed as already deployed, never failing a check.
  rules: [
    {
      name: 'billing-reads-no-order-events',
      note: 'billing hears about orders over HTTP only',
      forbid: { from: { service: 'billing' }, to: { channel: 'order.*' } },
    },
  ],
};

/** Makes the project under `fixtures/.scratch-deployed-*`; says where it, its configuration and the copy are. */
export const makeDeployedProject = (root) => {
  const fixtures = join(root, 'fixtures');
  const fixture = join(fixtures, 'multi-repo-deployed');
  const scratch = mkdtempSync(join(fixtures, '.scratch-deployed-'));
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
      ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
      { env, stdio: 'pipe' },
    );
  const commit = (repo, message) => {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', message);
  };

  cpSync(join(fixture, 'v1'), project, { recursive: true });
  cpSync(join(fixture, 'flowatlas.deployed.json'), join(project, 'flowatlas.deployed.json'));
  writeFileSync(config, `${JSON.stringify(DEPLOYED_CONFIG, null, 2)}\n`);
  for (const repo of REPOS) {
    git(repo, 'init', '-q', '-b', 'main');
    commit(repo, 'v1');
    git(repo, 'tag', 'v1');
  }
  cpSync(join(fixture, 'billing-main'), project, { recursive: true });
  commit('billing', 'require a currency, publish invoice.paid');
  for (const [repo, branch, from] of [
    ['gateway', 'invoice-on-checkout', 'gateway-branch'],
    ['orders', 'drop-lookup', 'orders-branch'],
  ]) {
    git(repo, 'checkout', '-q', '-b', branch);
    cpSync(join(fixture, from), project, { recursive: true });
    commit(repo, branch);
    git(repo, 'checkout', '-q', 'main');
  }
  return { scratch, project, config };
};

/** The ref the snapshots ship. */
export const SHIPPED = { service: ['orders'], head: 'drop-lookup' };

/**
 * The project made, its working tree built (the database the server reads)
 * and checked against prod, staging and canary for the `drop-lookup` branch
 * of orders, each `check.<env>.json` left beside the database. The tool is
 * imported here rather than at the top, so the tests that only need the
 * repositories load none of it.
 */
export const checkedDeployedProject = async (root) => {
  const made = makeDeployedProject(root);
  const { buildProject, runCheck } = await import('../packages/cli/dist/index.js');
  const quiet = { out() {}, err() {}, tty: false };
  await buildProject({ config: made.config });
  await runCheck({ config: made.config, env: ['prod', 'staging', 'canary'], generatedAt: FIXED, environ: {}, ...SHIPPED }, quiet);
  return made;
};
