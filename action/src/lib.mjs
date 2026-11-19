/*
 * What the flowatlas action does, in parts a test can hold (P231).
 *
 * Plain JavaScript with no dependencies: an action runs on a runner that has
 * Node and nothing else installed for it, and the GitHub API is four calls.
 * The comment's text is written by `flowatlas diff --format comment`; this
 * only fetches the other repositories, finds the comment and posts it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * `repositories`, one a line: `orders=acme/orders@main`, `billing=acme/billing`
 * (its default branch). Blank lines and `#` comments are skipped; anything
 * else that does not read is an error naming the line.
 */
export const parseRepositories = (text) => {
  const found = [];
  for (const [index, raw] of String(text ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([^=\s]+)\s*=\s*([\w.-]+\/[\w.-]+)(?:@(\S+))?$/.exec(line);
    if (match === null) throw new Error(`repositories, line ${index + 1}: ${JSON.stringify(line)} is not name=owner/repo or name=owner/repo@ref`);
    found.push({ name: match[1], repo: match[2], ...(match[3] === undefined ? {} : { ref: match[3] }) });
  }
  return found;
};

/** Each service of a configuration and where its repository should be, as the configuration says it. */
export const servicesOf = (configPath) => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const base = dirname(resolve(configPath));
  return (config.services ?? []).map((service) => ({
    name: service.name,
    dir: isAbsolute(service.repo) ? service.repo : resolve(base, service.repo),
  }));
};

/**
 * What to fetch: every service whose directory is not there and that
 * `repositories` names. A service in neither is reported, and the diff runs
 * without it - `diff` says what a missing repository costs.
 */
export const checkoutPlan = (services, repositories, exists = existsSync) => {
  const byName = new Map(repositories.map((item) => [item.name, item]));
  const fetch = [];
  const missing = [];
  for (const service of services) {
    if (exists(service.dir)) continue;
    const named = byName.get(service.name);
    if (named === undefined) missing.push(service.name);
    else fetch.push({ ...named, dir: service.dir });
  }
  const unknown = repositories.filter((item) => !services.some((service) => service.name === item.name)).map((item) => item.name);
  return { fetch, missing, unknown };
};

/**
 * How one of those repositories is cloned: its address without credentials,
 * and the token as the header `actions/checkout` sends, handed to git through
 * its environment (`GIT_CONFIG_COUNT`, git 2.31 or later). Not in the address,
 * where it would stay in the clone's `.git/config` on a runner that keeps its
 * workspace, and not as `git -c`, where any process on the runner could read
 * it. `secret` is what the log is told to mask.
 */
export const cloneOf = (item, token, env = process.env) => {
  const args = ['clone', '--quiet', '--depth=1', ...(item.ref === undefined ? [] : ['--branch', item.ref]), `https://github.com/${item.repo}.git`, item.dir];
  if (token === undefined || token === '') return { args, env: {} };
  const secret = Buffer.from(`x-access-token:${token}`).toString('base64');
  // After any configuration the runner already hands git this way, not over it.
  const at = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  return {
    args,
    secret,
    env: {
      GIT_CONFIG_COUNT: String(at + 1),
      [`GIT_CONFIG_KEY_${at}`]: 'http.https://github.com/.extraheader',
      [`GIT_CONFIG_VALUE_${at}`]: `AUTHORIZATION: basic ${secret}`,
    },
  };
};

/** The flowatlas version to install: the input, or the tag the action was used at, or the newest. */
export const versionOf = (input, actionRef) => {
  if (input !== undefined && input.trim() !== '') return input.trim();
  const tag = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(actionRef ?? '');
  return tag === null ? 'latest' : tag[1];
};

/** The marker a comment is found by: its first line. */
export const markerOf = (body) => /^<!-- flowatlas:diff config=[0-9a-f]+ -->/.exec(body)?.[0];

const API = 'https://api.github.com';

/** A GitHub REST call, through `fetch` (injectable for tests). */
const call = async (fetchImpl, token, method, path, body) => {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = new Error(`${method} ${path}: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? undefined : response.json();
};

/**
 * Who the token comments as. A person's token says its login; the job's own
 * `github.token` and an app's token cannot be asked (`GET /user` answers 403)
 * and comment as a bot, `github-actions[bot]` or `<app>[bot]`.
 */
export const authorOf = async ({ fetchImpl = fetch, token }) => {
  try {
    const user = await call(fetchImpl, token, 'GET', '/user');
    if (typeof user?.login === 'string') return { login: user.login };
  } catch {
    // An installation token: what it posts is a bot's.
  }
  return { bot: true };
};

/**
 * Whether a comment is the action's own: anyone can paste the marker, which
 * is computable from the configuration, into a comment of theirs, and the
 * action would then overwrite it, or leave a forged "nothing changed" standing.
 */
export const isOwn = (comment, author) =>
  author.login !== undefined ? comment.user?.login === author.login : comment.user?.type === 'Bot';

/** The pull request's comment with this marker that the token's author wrote, or undefined; every page is read. */
export const findComment = async ({ fetchImpl = fetch, token, repo, pr, marker, author }) => {
  for (let page = 1; page <= 50; page += 1) {
    const comments = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    const found = comments.find((comment) => typeof comment.body === 'string' && comment.body.startsWith(marker) && isOwn(comment, author));
    if (found !== undefined) return found;
    if (comments.length < 100) return undefined;
  }
  return undefined;
};

/**
 * Posts the comment, or updates the one already there (`comment: update`,
 * the default), or always posts a new one (`new`). With nothing to say
 * (`comment-when: changes` and no change), an existing comment is updated to
 * say so and none is posted. Returns what was done and the comment's address.
 */
export const upsertComment = async ({ fetchImpl = fetch, token, repo, pr, body, mode = 'update', quiet = false }) => {
  const marker = markerOf(body);
  if (marker === undefined) throw new Error('the comment has no flowatlas marker; was it written by flowatlas diff --format comment?');
  const existing = mode === 'update' ? await findComment({ fetchImpl, token, repo, pr, marker, author: await authorOf({ fetchImpl, token }) }) : undefined;
  if (quiet && existing === undefined) return { action: 'none' };
  if (existing !== undefined) {
    const updated = await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
    return { action: 'updated', url: updated?.html_url ?? existing.html_url };
  }
  const created = await call(fetchImpl, token, 'POST', `/repos/${repo}/issues/${pr}/comments`, { body });
  return { action: 'created', url: created?.html_url };
};

/**
 * `flowatlas docs --check`, against the head graph `diff --head-db` kept: a
 * pull request's run never builds `<output>/graph.db`. Its stale blocks are
 * annotations and never fail the pull request by themselves, since a block
 * stale before the branch is not the branch's doing; `fail-on: stale-docs`
 * fails on the ones the branch made stale, which the diff counts. A check that
 * cannot run, with no graph or a marker it cannot read, is said in the comment
 * as `skipped`. `run` takes the arguments and answers the exit code.
 */
export const docsCheck = ({ wanted, configPath, headDb, run, exists = existsSync }) => {
  if (!wanted) return {};
  if (!exists(headDb)) return { skipped: 'diff left no head graph to check the doc blocks against' };
  const exit = run(['docs', '--check', '--config', configPath, '--db', headDb, '--format', 'github']);
  return exit === 2 ? { skipped: '`flowatlas docs --check` could not run; the job log says why' } : {};
};

/** The exit code of the step: diff's, else 1 when asked to fail on doc blocks the branch made stale. */
export const exitOf = (diffExit, facts, failOn) => (diffExit !== 0 ? diffExit : failOn.has('stale-docs') && facts.staleDocs > 0 ? 1 : 0);

/** What the comment says under the report when the docs check did not run. */
export const docsNote = (skipped) => `\n> **The docs check did not run:** ${skipped}.\n`;

/** The comment for a change with nothing to say: the marker, and one line. */
export const nothingChanged = (marker, base) => `${marker}\nNo flow, contract or rule changes since \`${String(base).slice(0, 12)}\`.\n`;

/**
 * Whether the run may write to the pull request: not from a fork, which gets
 * no write token, nor from one deleted since, whose head repository is null.
 */
export const canComment = (event, repository) => {
  const repo = event?.pull_request?.head?.repo;
  if (event?.pull_request === undefined || repo === null) return false;
  return repo?.full_name === undefined || repo.full_name === repository;
};

/** Whether a diff said anything: a reach, a break, a stale doc. */
export const saysSomething = (facts) =>
  facts.reaches.entries > 0 || facts.contractBreaks > 0 || facts.ruleBreaks > 0 || facts.staleDocs > 0 || facts.verdict !== 'safe';

/** `name=value` lines for `$GITHUB_OUTPUT`. */
export const outputLines = (facts, url) =>
  [
    `verdict=${facts.verdict}`,
    `reaches=${facts.reaches.entries}`,
    `contract-breaks=${facts.contractBreaks}`,
    `rule-breaks=${facts.ruleBreaks}`,
    `stale-docs=${facts.staleDocs}`,
    `comment-url=${url ?? ''}`,
  ].join('\n');
