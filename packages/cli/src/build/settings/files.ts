/**
 * Which files of a repository may be read for the values of its settings, and
 * for which environment each one is (P77).
 *
 * An environment file is read for values only where it is written to be read
 * by everybody: an example, a sample, a template, or the file for running it
 * on a developer's machine. `.env`, `.env.local` and the files for any other
 * environment hold what a deployment is really given, which is where secrets
 * live; of those only the names of the settings are read, so a row can say a
 * setting is set there without ever holding what it is set to.
 */

/** What may be read of a file: its values, or only the names it sets. */
export type Reading = 'values' | 'names';

/** Words in an environment file's name that make it a file written to be shared. */
const SHARED = new Set(['example', 'sample', 'template', 'tmpl', 'tpl', 'dist', 'default', 'defaults']);

/** Words that name the environment of a developer's own machine. */
const DEVELOPMENT = new Set(['development', 'dev']);

/** The other spellings an environment's name is written in, by the one it is read as. */
const SPELLINGS: Readonly<Record<string, string>> = {
  dev: 'development',
  develop: 'development',
  prod: 'production',
  stage: 'staging',
  stg: 'staging',
  tst: 'test',
};

/** An environment's name as it is compared: lower case, one spelling. */
export const environmentName = (name: string): string => {
  const lower = name.toLowerCase();
  return SPELLINGS[lower] ?? lower;
};

/** `.env`, `.env.example`, `.env.development.local`; also `env.example`, `.env-sample` and `example.env`. */
const ENV_FILE = /^(?:\.env(?:[._-][\w.-]+)?|env\.(?:example|sample|template|dist|defaults?)|[\w-]+\.env)$/;

/** The words of an environment file's name, past the `.env` itself. */
const wordsOf = (name: string): string[] =>
  name
    .toLowerCase()
    .replace(/^\.?env(?=$|[._-])/, '')
    .replace(/\.env$/, '')
    .split(/[._-]/)
    .filter((word) => word !== '');

/** Whether a file is an environment file, and what may be read of it. */
export const envFileReading = (name: string): Reading | undefined => {
  if (!ENV_FILE.test(name)) return undefined;
  const words = wordsOf(name);
  if (words.some((word) => SHARED.has(word))) return 'values';
  if (words.includes('local')) return 'names';
  if (words.length > 0 && words.every((word) => DEVELOPMENT.has(word))) return 'values';
  return 'names';
};

/** The environment an environment file is for, when its name says: `development` for `.env.dev.example`. */
export const envFileEnvironment = (name: string): string | undefined => {
  const words = wordsOf(name).filter((word) => !SHARED.has(word) && word !== 'local');
  return words.length === 1 ? environmentName(words[0] as string) : undefined;
};

/** `docker-compose.yml`, `compose.yaml`, `docker-compose.dev.yml`, `compose.override.yml`. */
const COMPOSE_FILE = /^(?:docker-)?compose(?:\.([\w-]+))?\.ya?ml$/;

export const isComposeFile = (name: string): boolean => COMPOSE_FILE.test(name);

/** The environment a container file is for, when its name says; an override is for none in particular. */
export const composeEnvironment = (name: string): string | undefined => {
  const word = COMPOSE_FILE.exec(name)?.[1];
  return word === undefined || word === 'override' ? undefined : environmentName(word);
};
