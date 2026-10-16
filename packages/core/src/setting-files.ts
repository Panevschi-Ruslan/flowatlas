/**
 * Values a repository's own files give its settings (P77).
 *
 * Code very often reads where it sends from a setting - `${ORDERS_URL}/orders` -
 * and a project that never listed `ORDERS_URL` under `services[].baseUrlEnv`
 * still says, somewhere it commits, what the setting is: an example environment
 * file, the environment a container is started with, the variables a deployment
 * declares. Only the host of such a value matters to the graph, so this is the
 * shape a value is kept in, and the rules that decide what may be kept at all.
 *
 * What is kept is an address and nothing else. A value is kept only when it is
 * shaped like one - a URL, or a resource name of the `arn:` form - and of a URL
 * only the scheme, the host and the path survive: credentials, a query and a
 * fragment are where secrets live, and they are dropped before anything is
 * stored. A setting whose name says it is a secret is never kept, whatever its
 * value looks like, and neither is a value with a token-like path segment. The
 * readers that find the files are the ones that know which files may be read
 * for values at all; this file names no format.
 */

/** One value a file gives a setting, cut down to an address. */
export interface SettingValue {
  /** The address: `scheme://host[:port][/path]`, or an `arn:` name. */
  readonly value: string;
  /**
   * Where it is written: repository-relative, or relative to the configuration
   * for a file kept beside it, POSIX.
   */
  readonly file: string;
  /** The environment the file is for, when its name says so: `development` for `.env.development`. */
  readonly environment?: string;
  /** What inside the file the value is given to, when the file configures several things. */
  readonly within?: string;
}

/** A host a service is reached at, as some file names it: a container's name, `localhost:3001`. */
export interface HostAlias {
  /** Lower case, with the port where one is part of it. */
  readonly host: string;
  readonly file: string;
}

/** Everything a service's own files say about its settings. */
export interface RepoSettings {
  /** Values, by setting name, in the order the files are read. */
  readonly values: Readonly<Record<string, readonly SettingValue[]>>;
  /**
   * Settings a file names and whose values are never read - `.env`,
   * `.env.local`, a production file - by setting name, the files that name it.
   */
  readonly namedOnly: Readonly<Record<string, readonly string[]>>;
  /** The hosts this service is reached at, as the files name them. */
  readonly hosts: readonly HostAlias[];
}

export const NO_SETTINGS: RepoSettings = { values: {}, namedOnly: {}, hosts: [] };

/**
 * Words a setting's name carries when its value is a secret.
 *
 * Matched as whole words of the name, split at `_`, `-`, `.` and case changes,
 * so `PASSPORT_URL` is not a password and `API_KEY` is a key. Only the words
 * whose setting *is* the secret: `AUTH_URL` names a service, and its value is
 * held to being an address like any other.
 */
const SECRET_WORDS = new Set([
  'secret',
  'secrets',
  'token',
  'tokens',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'private',
  'credential',
  'credentials',
  'key',
  'apikey',
  'signature',
  'salt',
  'dsn',
  'webhook',
  'cookie',
  'jwt',
  'otp',
  'cert',
  'certificate',
]);

/** The words of a setting's name, lower case. */
const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());

/** Whether a setting's name says its value is a secret. */
export const looksSecret = (name: string): boolean => wordsOf(name).some((word) => SECRET_WORDS.has(word));

/** The schemes a base address is written with; a database or cache address is never one. */
const ADDRESS_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** `arn:partition:service:region:account:resource`, a deployed resource's name. */
const RESOURCE_NAME = /^arn:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[A-Za-z0-9_./:+=@-]+$/;

/**
 * A path segment that reads like a token rather than a word: long, and mixing
 * letters with digits, or a long run of hex. A webhook's address carries its
 * secret in the path, and the address is then a credential, not a host.
 */
const tokenLike = (segment: string): boolean => {
  if (segment.length >= 16 && /^[A-Fa-f0-9]+$/.test(segment) && /[0-9]/.test(segment)) return true;
  if (segment.includes(':') && segment.length >= 12) return true;
  if (segment.length < 20) return false;
  const letters = /[A-Za-z]/.test(segment);
  const digits = /[0-9]/.test(segment);
  return letters && digits;
};

/**
 * The address a value holds, cut to what the graph may keep, or nothing.
 *
 * Nothing for a value that is not an address, that still has a placeholder in
 * it, that is written for a scheme a base address is never written in, or
 * whose path carries something that reads like a token.
 */
export const addressOnly = (raw: string): string | undefined => {
  const text = raw.trim();
  if (text === '' || text.includes('${') || /\s/.test(text)) return undefined;
  if (RESOURCE_NAME.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!ADDRESS_SCHEMES.has(url.protocol) || url.hostname === '') return undefined;
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => tokenLike(decodeURIComponentSafe(segment)))) return undefined;
  const path = segments.length === 0 ? '' : `/${segments.join('/')}`;
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
};

const decodeURIComponentSafe = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The value a setting may be kept with, or nothing: a secret's name, or a value that is not an address. */
export const keptValue = (name: string, raw: string): string | undefined =>
  looksSecret(name) ? undefined : addressOnly(raw);

/** A port, as a file writes one. */
export const portOf = (raw: string | number): number | undefined => {
  const text = String(raw).trim();
  if (!/^\d{2,5}$/.test(text)) return undefined;
  const port = Number(text);
  return port > 0 && port < 65536 ? port : undefined;
};

/** The hosts a port published on this machine is reached at. */
export const localHostsOf = (port: number): string[] => [`localhost:${port}`, `127.0.0.1:${port}`, `0.0.0.0:${port}`];

/** The host and port of an address, lower case, or nothing for an `arn:` name. */
export const hostOf = (address: string): { host: string; hostname: string } | undefined => {
  try {
    const url = new URL(address);
    return url.hostname === '' ? undefined : { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return undefined;
  }
};

/**
 * Suffixes of a name that only resolves inside the network the project runs
 * in: a cluster's service names, a container network's, a machine's own.
 */
const INNER_SUFFIXES = ['.svc.cluster.local', '.cluster.local', '.svc', '.internal', '.local', '.localhost', '.docker'];

/**
 * Whether a host names something inside the project's own network rather than
 * a third party: this machine, a private address, a name with no dot, or one
 * under a suffix that only resolves inside a network.
 */
export const isInnerHost = (hostname: string): boolean => {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name === '0.0.0.0' || name === '::1' || name === 'host.docker.internal') return true;
  if (!name.includes('.')) return true;
  if (/^127\./.test(name) || /^10\./.test(name) || /^192\.168\./.test(name)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(name)) return true;
  return INNER_SUFFIXES.some((suffix) => name.endsWith(suffix));
};

/**
 * The first label of a name under an inner suffix: `orders` for
 * `orders.default.svc.cluster.local`, which is how a cluster names a service.
 */
export const innerServiceName = (hostname: string): string | undefined => {
  const name = hostname.toLowerCase();
  if (!name.includes('.')) return undefined;
  return INNER_SUFFIXES.some((suffix) => name.endsWith(suffix)) ? name.split('.')[0] : undefined;
};
