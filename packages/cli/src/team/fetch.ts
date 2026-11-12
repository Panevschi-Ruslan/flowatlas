import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readZip } from './archive.js';

/**
 * Where a team's graph comes from (P236), fetched with nothing but `fetch`.
 *
 * - `gh:owner/repo/artifact-name`: the newest artifact of that name from a
 *   successful run of a push to the repository's default branch - its own
 *   code, never a fork's pull request - through the GitHub API, with
 *   `GITHUB_TOKEN`, `GH_TOKEN` or the `gh` command's own token. The way the
 *   maintainer chose to keep a team's graph: private with the code.
 * - `https://…`: any address, with `Authorization: Bearer <token>` when one is
 *   given. A redirect to another origin is followed without it (D3), as a
 *   release asset's redirect to storage is; one to plain http off this
 *   machine is refused.
 * - anything else: a file.
 *
 * A source that has not changed since the last pull is a conditional request
 * and nothing more: an ETag for an address, the artifact's id for `gh:`.
 */
export interface Fetched {
  /** Absent when nothing changed since `etag`. */
  archive?: Buffer;
  etag?: string;
  /** In words, for what `pull` says. */
  from: string;
}

export interface FetchOptions {
  token?: string;
  etag?: string;
  fetchImpl?: typeof fetch;
  /** The `gh` command's token, when no variable holds one; injectable for tests. */
  ghToken?: () => string | undefined;
}

const API = 'https://api.github.com';

const ghTokenOf = (): string | undefined => {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
};

/** Whether an address is plain http to this machine: the one place a graph may come from without https. */
const isLocalHttp = (url: URL): boolean => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/**
 * Follows redirects by hand, so the token goes only to the origin it was
 * given for - scheme, host and port (D3) - and never down to plain http: a
 * redirect to http off this machine is refused, as an http source is.
 */
const get = async (fetchImpl: typeof fetch, url: string, headers: Record<string, string>, token: string | undefined): Promise<Response> => {
  const origin = new URL(url).origin;
  let at = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const sameOrigin = new URL(at).origin === origin;
    const response = await fetchImpl(at, {
      redirect: 'manual',
      headers: { ...headers, ...(token !== undefined && sameOrigin ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const next = response.headers.get('location');
      if (next === null) return response;
      const to = new URL(next, at);
      // Named by its origin only: a signed address carries its signature in the query.
      if (to.protocol !== 'https:' && !isLocalHttp(to)) throw new Error(`${url}: redirected to ${to.origin}, which is not https`);
      at = to.toString();
      continue;
    }
    return response;
  }
  throw new Error(`${url}: too many redirects`);
};

const failed = (url: string, response: Response): Error =>
  new Error(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? ': the token is missing or cannot read it' : response.status === 404 ? ': nothing there' : ''}`);

/** An Actions artifact as the listing gives it. */
interface Artifact {
  id: number;
  expired: boolean;
  created_at: string;
  archive_download_url: string;
  workflow_run?: { id?: number; head_branch?: string; repository_id?: number; head_repository_id?: number };
}

/** The run an artifact came from, as `actions/runs/{id}` gives it. */
interface WorkflowRun {
  event?: string;
  conclusion?: string | null;
  head_branch?: string;
  repository?: { id?: number };
  head_repository?: { id?: number };
}

/** Whether a run built this repository's own code, not a fork's. */
const isOwnRun = (run: Artifact['workflow_run']): boolean =>
  typeof run?.id === 'number' && typeof run.repository_id === 'number' && run.head_repository_id === run.repository_id;

/** Whether a run is a push to `branch` of this repository's own code that succeeded. */
const isPushThatPassed = (run: WorkflowRun, branch: string): boolean =>
  run.event === 'push' &&
  run.conclusion === 'success' &&
  run.head_branch === branch &&
  typeof run.repository?.id === 'number' &&
  run.head_repository?.id === run.repository.id;

const viaGitHub = async (spec: string, options: FetchOptions, fetchImpl: typeof fetch): Promise<Fetched> => {
  const match = /^gh:([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(spec);
  if (match === null) throw new Error(`${spec}: a gh: source is gh:owner/repo/artifact-name`);
  const [, owner, repo, name] = match as unknown as [string, string, string, string];
  const token = options.token ?? process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? (options.ghToken ?? ghTokenOf)();
  if (token === undefined) throw new Error('a gh: source needs a token: set GITHUB_TOKEN, or log in with gh auth login');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async <T>(path: string): Promise<T> => {
    const response = await get(fetchImpl, `${API}${path}`, headers, token);
    if (!response.ok) throw failed(`${API}${path}`, response);
    return (await response.json()) as T;
  };
  const { default_branch: branch } = await api<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  const { artifacts } = await api<{ artifacts: Artifact[] }>(`/repos/${owner}/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
  // A pull request from a fork runs on its own head branch, which may be
  // named as the default branch is: only a run of this repository's own code
  // counts, so a stranger's pull request cannot hand the team its graph.
  const candidates = artifacts
    .filter((artifact) => !artifact.expired && artifact.workflow_run?.head_branch === branch && isOwnRun(artifact.workflow_run))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  let newest: Artifact | undefined;
  for (const artifact of candidates) {
    // The listing says neither how the run started nor how it ended: its run does.
    const run = await api<WorkflowRun>(`/repos/${owner}/${repo}/actions/runs/${artifact.workflow_run?.id}`);
    if (isPushThatPassed(run, branch)) {
      newest = artifact;
      break;
    }
  }
  if (newest === undefined) throw new Error(`${owner}/${repo} has no artifact named ${name} from a successful push to ${branch} that has not expired`);
  const from = `${owner}/${repo} artifact ${name} #${newest.id} (${newest.created_at})`;
  if (options.etag === String(newest.id)) return { etag: String(newest.id), from };
  const response = await get(fetchImpl, newest.archive_download_url, headers, token);
  if (!response.ok) throw failed(newest.archive_download_url, response);
  const zip = Buffer.from(await response.arrayBuffer());
  const inside = readZip(zip).find((file) => file.name.endsWith('.tgz'));
  if (inside === undefined) throw new Error(`${from} holds no .tgz: was it uploaded from flowatlas publish?`);
  return { archive: inside.data, etag: String(newest.id), from };
};

/** The bundle at `source`, or word that it has not changed since `etag`. */
export const fetchBundle = async (source: string, options: FetchOptions = {}, cwd = process.cwd()): Promise<Fetched> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (source.startsWith('gh:')) return viaGitHub(source, options, fetchImpl);
  if (/^https?:\/\//.test(source)) {
    // The host as parsed, not the text: `http://localhost:1@elsewhere.test/` goes elsewhere.
    const url = new URL(source);
    if (url.protocol === 'http:' && !isLocalHttp(url)) throw new Error(`${source}: only https, or http on this machine`);
    const response = await get(fetchImpl, source, options.etag === undefined ? {} : { 'If-None-Match': options.etag }, options.token);
    if (response.status === 304) return { ...(options.etag === undefined ? {} : { etag: options.etag }), from: source };
    if (!response.ok) throw failed(source, response);
    const etag = response.headers.get('etag') ?? undefined;
    return { archive: Buffer.from(await response.arrayBuffer()), ...(etag === undefined ? {} : { etag }), from: source };
  }
  const path = source.startsWith('file:') ? new URL(source).pathname : isAbsolute(source) ? source : resolve(cwd, source);
  return { archive: readFileSync(path), from: path };
};
