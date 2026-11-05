/*
 * What the flowatlas action does, in parts a test can hold (P231).
 *
 * Plain JavaScript with no dependencies: an action runs on a runner that has
 * Node and nothing else installed for it, and the GitHub API is three calls.
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

/** The pull request's comment with this marker, or undefined; every page is read. */
export const findComment = async ({ fetchImpl = fetch, token, repo, pr, marker }) => {
  for (let page = 1; page <= 50; page += 1) {
    const comments = await call(fetchImpl, token, 'GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    const found = comments.find((comment) => typeof comment.body === 'string' && comment.body.startsWith(marker));
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
  const existing = mode === 'update' ? await findComment({ fetchImpl, token, repo, pr, marker }) : undefined;
  if (quiet && existing === undefined) return { action: 'none' };
  if (existing !== undefined) {
    const updated = await call(fetchImpl, token, 'PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
    return { action: 'updated', url: updated?.html_url ?? existing.html_url };
  }
  const created = await call(fetchImpl, token, 'POST', `/repos/${repo}/issues/${pr}/comments`, { body });
  return { action: 'created', url: created?.html_url };
};

/** The comment for a change with nothing to say: the marker, and one line. */
export const nothingChanged = (marker, base) => `${marker}\nNo flow, contract or rule changes since \`${String(base).slice(0, 12)}\`.\n`;

/** Whether the run may write to the pull request: not from a fork, which gets no write token. */
export const canComment = (event, repository) => {
  const head = event?.pull_request?.head?.repo?.full_name;
  return event?.pull_request !== undefined && (head === undefined || head === repository);
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
