import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { UnreadMember } from '@flowatlas/core';
import { isRecord, readServiceYaml, textOf, Unread } from '@flowatlas/serverless';

/**
 * The tools that deploy a plain template with its values written down beside
 * it (P259), read where what they are run with is written out.
 *
 * - **sceptre**: a project holds `templates/` and `config/`; each stack is a
 *   file `config/<group>/<stack>.yaml` naming its template (`template_path`,
 *   or `template: { path }`) and giving its `parameters`, and each group's
 *   `config.yaml` its `project_code` and `region`. The stack's name is its own
 *   `stack_name`, else the project's code and the stack's path, joined by `-`.
 * - **rain**: `rain deploy <template> [<stack>] --params K=V,K2=V2 --config
 *   <file>` written in a `package.json` script or a Makefile beside the
 *   template or above it; the stack is named after the template where the
 *   command names none, and the configuration file is a template
 *   configuration (`Parameters:`), read as any parameter file is.
 *
 * What either tool works out when it runs is not read: a sceptre resolver
 * (`!stack_output`, `!environment_variable`, `!file_contents`, any `!tag`) and
 * a Jinja expression are values not known from the files, said as such rather
 * than read as the parameter's default; so is a shell variable on a rain
 * command. A stack configuration that does not read as YAML (a Jinja block
 * around it) names nothing this can see, and is passed over. Several stacks or
 * commands deploying one template are several environments: the one the
 * configuration names is read (`services[].infra.vars` naming its file, or
 * `services[].infra.options.config_env` its sceptre group), and otherwise none.
 */

/** A value a deployer gives a parameter, or why it is not known from the files. */
export type DeployedValue = string | Unread;

/** One deployment of a template by a tool, as its files write it. */
export interface Deployer {
  /** Which tool, and the file that says so, repo-relative. */
  readonly tool: 'sceptre' | 'rain';
  readonly file: string;
  /** The line of the command or the stack, 1-based. */
  readonly line: number;
  /** What a person calls it: `prod/orders`, `deploy:prod`. */
  readonly label: string;
  /** The sceptre group the stack is in. */
  readonly group?: string;
  readonly values: Readonly<Record<string, DeployedValue>>;
  readonly stackName?: string;
  readonly region?: string;
  /** Parameter files it reads its values from (rain's `--config`), repo-relative. */
  readonly files: readonly string[];
  /** Every file read to know it, repo-relative, for the build cache. */
  readonly read: readonly string[];
}

const textAt = (repoDir: string, file: string): string | undefined => {
  try {
    return readFileSync(join(repoDir, file), 'utf8');
  } catch {
    return undefined;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A path joined under a directory, `.` being the repository. */
const under = (dir: string, path: string): string => posix.normalize(dir === '.' ? path : `${dir}/${path}`);

/** A value of a stack configuration a tag of sceptre's is put on: run when the stack is launched. */
const RESOLVED = (tag: string, value: unknown): UnreadMember => new UnreadMember(`${tag} ${typeof value === 'string' ? value : ''}`.trim(), `sceptre's ${tag} resolver runs when the stack is launched`);

/** A sceptre configuration file, its resolvers kept apart; `undefined` where it does not read. */
const readSceptreFile = (repoDir: string, file: string): Record<string, unknown> | undefined => {
  const text = textAt(repoDir, file);
  if (text === undefined) return undefined;
  try {
    const value = readServiceYaml(text, { otherTag: RESOLVED }).value;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** What a stack configuration gives a parameter: its text, or why it is not known from the files. */
const sceptreValue = (value: unknown): DeployedValue | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof UnreadMember) return new Unread(`it is given by ${value.text}, and ${value.reason}`);
  if (Array.isArray(value)) {
    const parts = value.map(sceptreValue);
    const unread = parts.find((part): part is Unread => part instanceof Unread);
    return unread ?? parts.map((part) => part ?? '').join(',');
  }
  const text = typeof value === 'boolean' ? String(value) : textOf(value);
  if (text === undefined) return new Unread('it is not text');
  return /\{\{|\{%/.test(text) ? new Unread(`it is a Jinja expression (${text.trim()}), rendered when sceptre runs`) : text;
};

/** The sceptre project a template is in: the directory holding both its `templates/` and a `config/`. */
const sceptreRoot = (repoDir: string, template: string): string | undefined => {
  const parts = template.split('/');
  for (let at = parts.lastIndexOf('templates'); at >= 0; at = parts.lastIndexOf('templates', at - 1)) {
    const root = at === 0 ? '.' : parts.slice(0, at).join('/');
    if (isDirectory(join(repoDir, root, 'config'))) return root;
    if (at === 0) break;
  }
  return undefined;
};

/** How deep below `config/` a stack's file is looked for. */
const MOST_GROUP_DEPTH = 4;

/** Every YAML file below a directory, repo-relative. */
const yamlFilesUnder = (repoDir: string, dir: string, depth = 0): string[] => {
  let entries;
  try {
    entries = readdirSync(join(repoDir, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return depth >= MOST_GROUP_DEPTH ? [] : yamlFilesUnder(repoDir, path, depth + 1);
      return /\.ya?ml$/.test(entry.name) ? [path] : [];
    });
};

/** The template a stack's configuration names, repo-relative, or `undefined`. */
const sceptreTemplate = (root: string, stack: Record<string, unknown>): string | undefined => {
  const handler = isRecord(stack['template']) ? stack['template'] : undefined;
  if (handler !== undefined && textOf(handler['type']) !== undefined && textOf(handler['type']) !== 'file') return undefined;
  const path = textOf(stack['template_path']) ?? (handler === undefined ? undefined : textOf(handler['path']));
  if (path === undefined || /\{\{/.test(path)) return undefined;
  // Older projects wrote the path from the project; newer ones from `templates/`.
  return under(root, path.startsWith('templates/') ? path : `templates/${path}`);
};

/** The deployments of a template by sceptre stacks of the project it is in. */
const sceptreDeployers = (repoDir: string, template: string): Deployer[] => {
  const root = sceptreRoot(repoDir, template);
  if (root === undefined) return [];
  const configDir = under(root, 'config');
  const files = yamlFilesUnder(repoDir, configDir);
  const groups = new Map(files.filter((file) => /(?:^|\/)config\.ya?ml$/.test(file)).map((file) => [posix.dirname(file), file]));
  const found: Deployer[] = [];
  for (const file of files) {
    if (/(?:^|\/)config\.ya?ml$/.test(file)) continue;
    const stack = readSceptreFile(repoDir, file);
    if (stack === undefined || sceptreTemplate(root, stack) !== template) continue;
    // The group configurations from the project's down to the stack's own group, the nearer one winning.
    const read = [file];
    let settings: Record<string, unknown> = {};
    const dirs: string[] = [];
    for (let dir = posix.dirname(file); dir.length >= configDir.length; dir = posix.dirname(dir)) {
      dirs.unshift(dir);
      if (dir === configDir) break;
    }
    for (const dir of dirs) {
      const group = groups.get(dir);
      const written = group === undefined ? undefined : readSceptreFile(repoDir, group);
      if (group !== undefined) read.push(group);
      if (written !== undefined) settings = { ...settings, ...written };
    }
    const path = file.slice(configDir.length + 1).replace(/\.ya?ml$/, '');
    const values: Record<string, DeployedValue> = {};
    for (const [name, value] of Object.entries(isRecord(stack['parameters']) ? stack['parameters'] : {})) {
      const given = sceptreValue(value);
      if (given !== undefined) values[name] = given;
    }
    const plain = (value: unknown): string | undefined => {
      const text = sceptreValue(value);
      return typeof text === 'string' ? text : undefined;
    };
    const code = plain(settings['project_code']);
    const stackName = plain(stack['stack_name']) ?? (code === undefined ? undefined : `${code}-${path.replace(/\//g, '-')}`);
    const region = plain(stack['region']) ?? plain(settings['region']);
    found.push({
      tool: 'sceptre',
      file,
      line: 1,
      label: path,
      group: posix.dirname(path) === '.' ? '' : posix.dirname(path),
      values,
      ...(stackName === undefined ? {} : { stackName }),
      ...(region === undefined ? {} : { region }),
      files: [],
      read,
    });
  }
  return found;
};

/** A command split into words as a shell splits it, quotes taken off. */
const wordsOf = (command: string): string[] => [...command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');

/** The options of `rain deploy` that take a value, by every spelling. */
const RAIN_VALUED = new Set(['--params', '--config', '-c', '--tags', '--region', '-r', '--profile', '-p', '--role-arn', '--s3-bucket', '--s3-prefix']);

/** A command of a script or a recipe, and where it is written. */
interface Command {
  readonly file: string;
  readonly line: number;
  readonly label: string;
  /** The directory the command runs in, repo-relative. */
  readonly dir: string;
  readonly text: string;
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** The commands of the `package.json` scripts and Makefile recipes of a directory. */
const commandsIn = (repoDir: string, dir: string): Command[] => {
  const found: Command[] = [];
  const manifest = under(dir, 'package.json');
  const json = textAt(repoDir, manifest);
  if (json !== undefined) {
    let scripts: unknown;
    try {
      scripts = (JSON.parse(json) as { scripts?: unknown }).scripts;
    } catch {
      scripts = undefined;
    }
    for (const [name, script] of Object.entries(isRecord(scripts) ? scripts : {})) {
      if (typeof script !== 'string') continue;
      const at = json.indexOf(JSON.stringify(name));
      for (const part of script.split(/&&|\|\||;|\|/)) found.push({ file: manifest, line: at < 0 ? 1 : lineAt(json, at), label: name, dir, text: part.trim() });
    }
  }
  const makefile = under(dir, 'Makefile');
  const make = textAt(repoDir, makefile);
  if (make !== undefined) {
    let target = '';
    make.split('\n').forEach((raw, index) => {
      const rule = /^([A-Za-z0-9_.\-/]+)\s*:(?!=)/.exec(raw);
      if (rule !== null) target = rule[1] as string;
      if (!raw.startsWith('\t')) return;
      for (const part of raw.trim().replace(/^[@-]+/, '').split(/&&|\|\||;|\|/)) found.push({ file: makefile, line: index + 1, label: target, dir, text: part.trim() });
    });
  }
  return found;
};

/** What a value written on a command is: text, or why it is not known from the files. */
const commandValue = (written: string): DeployedValue => (/[$`]/.test(written) ? new Unread(`it is ${written} on the command, which the shell fills in when it runs`) : written);

/** The deployments of a template by `rain deploy` commands written beside it or above it. */
const rainDeployers = (repoDir: string, template: string): Deployer[] => {
  const dirs: string[] = [];
  for (let dir = posix.dirname(template); ; dir = posix.dirname(dir)) {
    dirs.push(dir);
    if (dir === '.' || dir === '') break;
  }
  const found: Deployer[] = [];
  for (const command of dirs.flatMap((dir) => commandsIn(repoDir, dir))) {
    const words = wordsOf(command.text);
    const at = words.findIndex((word, index) => /(?:^|\/)rain$/.test(word) && words[index + 1] === 'deploy');
    if (at < 0) continue;
    const positional: string[] = [];
    const values: Record<string, DeployedValue> = {};
    const files: string[] = [];
    let region: string | undefined;
    const rest = words.slice(at + 2);
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] as string;
      const equals = word.indexOf('=');
      const flag = word.startsWith('-') ? (equals > 0 ? word.slice(0, equals) : word) : undefined;
      if (flag === undefined) {
        positional.push(word);
        continue;
      }
      if (!RAIN_VALUED.has(flag)) continue;
      const value = equals > 0 ? word.slice(equals + 1) : rest[(index += 1)];
      if (value === undefined) continue;
      if (flag === '--params') {
        for (const pair of value.split(',')) {
          const split = pair.indexOf('=');
          if (split > 0) values[pair.slice(0, split)] = commandValue(pair.slice(split + 1));
        }
      } else if (flag === '--config' || flag === '-c') {
        if (!/[$`]/.test(value)) files.push(under(command.dir, value));
      } else if (flag === '--region' || flag === '-r') {
        region = /[$`]/.test(value) ? undefined : value;
      }
    }
    const [written, stack] = positional;
    if (written === undefined || /[$`]/.test(written) || under(command.dir, written) !== template) continue;
    const stackName = stack === undefined ? posix.basename(template).replace(/\.[^.]+$/, '') : /[$`]/.test(stack) ? undefined : stack;
    found.push({
      tool: 'rain',
      file: command.file,
      line: command.line,
      label: command.label,
      values,
      ...(stackName === undefined ? {} : { stackName }),
      ...(region === undefined ? {} : { region }),
      files,
      read: [command.file],
    });
  }
  return found;
};

/** Two deployments that give a template the same values are one. */
const sameDeployment = (a: Deployer, b: Deployer): boolean =>
  a.tool === b.tool &&
  a.stackName === b.stackName &&
  a.region === b.region &&
  JSON.stringify(a.files) === JSON.stringify(b.files) &&
  JSON.stringify(Object.entries(a.values).map(([name, value]) => [name, typeof value === 'string' ? value : value.text])) ===
    JSON.stringify(Object.entries(b.values).map(([name, value]) => [name, typeof value === 'string' ? value : value.text]));

/** What reading a template's deployers settled: the one it is deployed by, several nothing chose between, or none. */
export type DeployerChoice = { readonly one: Deployer } | { readonly several: readonly Deployer[] } | undefined;

/**
 * The deployment of a template by sceptre or rain, as its files write it
 * (P259): the one the configuration names - a stack's file among
 * `services[].infra.vars`, a group as `services[].infra.options.config_env` -
 * else the only one there is.
 */
export const deployerOf = (repoDir: string, template: string, vars: readonly string[], options: Readonly<Record<string, string>>): DeployerChoice => {
  const all = [...sceptreDeployers(repoDir, template), ...rainDeployers(repoDir, template)].filter((deployer, index, list) => list.findIndex((other) => sameDeployment(other, deployer)) === index);
  if (all.length === 0) return undefined;
  const named = all.filter((deployer) => vars.includes(deployer.file));
  const env = options['config_env'];
  const grouped = env === undefined ? [] : all.filter((deployer) => deployer.group !== undefined && (deployer.group === env || deployer.group.startsWith(`${env}/`)));
  const chosen = named.length > 0 ? named : grouped.length > 0 ? grouped : all;
  const [one] = chosen;
  return chosen.length === 1 && one !== undefined ? { one } : { several: chosen };
};
