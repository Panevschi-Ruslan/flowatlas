import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readZip } from './archive.js';

/**
 * Where a team's graph comes from (P236), fetched with nothing but `fetch`.
 *
 * - `gh:owner/repo/artifact-name`: the newest artifact of that name from a
 *   successful run on the repository's default branch, through the GitHub
 *   API, with `GITHUB_TOKEN`, `GH_TOKEN` or the `gh` command's own token. The
 *   way the maintainer chose to keep a team's graph: private with the code.
 * - `https://…`: any address, with `Authorization: Bearer <token>` when one is
 *   given. A redirect to another host is followed without it (D3), as a
 *   release asset's redirect to storage is.
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

/** Follows redirects by hand, so the token goes only to the host it was given for (D3). */
const get = async (fetchImpl: typeof fetch, url: string, headers: Record<string, string>, token: string | undefined): Promise<Response> => {
  const origin = new URL(url).host;
  let at = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const sameHost = new URL(at).host === origin;
    const response = await fetchImpl(at, {
      redirect: 'manual',
      headers: { ...headers, ...(token !== undefined && sameHost ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const next = response.headers.get('location');
      if (next === null) return response;
      at = new URL(next, at).toString();
      continue;
    }
    return response;
  }
  throw new Error(`${url}: too many redirects`);
};

const failed = (url: string, response: Response): Error =>
  new Error(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? ': the token is missing or cannot read it' : response.status === 404 ? ': nothing there' : ''}`);

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
  const { artifacts } = await api<{
    artifacts: Array<{ id: number; expired: boolean; created_at: string; archive_download_url: string; workflow_run?: { head_branch?: string } }>;
  }>(`/repos/${owner}/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
  const newest = artifacts
    .filter((artifact) => !artifact.expired && artifact.workflow_run?.head_branch === branch)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (newest === undefined) throw new Error(`${owner}/${repo} has no artifact named ${name} from ${branch} that has not expired`);
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
    if (source.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(source)) {
      throw new Error(`${source}: only https, or http on this machine`);
    }
    const response = await get(fetchImpl, source, options.etag === undefined ? {} : { 'If-None-Match': options.etag }, options.token);
    if (response.status === 304) return { ...(options.etag === undefined ? {} : { etag: options.etag }), from: source };
    if (!response.ok) throw failed(source, response);
    const etag = response.headers.get('etag') ?? undefined;
    return { archive: Buffer.from(await response.arrayBuffer()), ...(etag === undefined ? {} : { etag }), from: source };
  }
  const path = source.startsWith('file:') ? new URL(source).pathname : isAbsolute(source) ? source : resolve(cwd, source);
  return { archive: readFileSync(path), from: path };
};
