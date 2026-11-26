import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isRecord, readServiceYaml, textOf } from '@flowatlas/serverless';

/**
 * The files a template's parameters are given values from at deploy time
 * (P253), as `aws cloudformation deploy --parameter-overrides file://...`
 * and `create-stack --parameters file://...` take them, and as a pipeline's
 * template configuration holds them:
 *
 * - a list of `{ "ParameterKey": "Stage", "ParameterValue": "prod" }`;
 * - a list of `"Stage=prod"`;
 * - `{ "Parameters": { "Stage": "prod" }, "Tags": {...} }`.
 *
 * Each is read written as JSON or as YAML (P259): the same three documents,
 * and the YAML one is also what `rain deploy --config` takes.
 *
 * A file is read for a template where something says it is for that
 * template - the configuration's `services[].infra.vars`, the template's
 * `samconfig` (`parameter_overrides = "file://..."`) - or where it sits beside
 * the template under a name that says so (`orders.parameters.json` beside
 * `orders.yaml`). Two files beside one template that both could be its values
 * are two environments nothing chose between: neither is read, and a row says
 * so. Nothing is read from the account.
 */

/** What a parameter file holds, or why it is not read. */
export type ParameterFile = { readonly values: Readonly<Record<string, string>> } | { readonly unreadable: string };

/** A value as a parameter file writes it: text, a number, or a list joined as CloudFormation joins one. */
const valueText = (value: unknown): string | undefined =>
  Array.isArray(value) ? value.map((item) => textOf(item) ?? '').join(',') : typeof value === 'boolean' ? String(value) : textOf(value);

/** The values a parameter file's document gives, or `undefined` where it is not one. */
export const parameterValues = (document: unknown): Record<string, string> | undefined => {
  if (Array.isArray(document)) {
    const out: Record<string, string> = {};
    for (const item of document) {
      if (typeof item === 'string') {
        const at = item.indexOf('=');
        if (at <= 0) return undefined;
        out[item.slice(0, at)] = item.slice(at + 1);
        continue;
      }
      if (!isRecord(item)) return undefined;
      const key = textOf(item['ParameterKey']);
      if (key === undefined) return undefined;
      // A value kept from the stack as deployed is the account's, which no file holds.
      if (item['UsePreviousValue'] === true) continue;
      const value = valueText(item['ParameterValue']);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (isRecord(document) && isRecord(document['Parameters'])) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(document['Parameters'])) {
      // A template declares its parameters under the same key, each an object of its type and default: it is not a file of values.
      if (isRecord(value)) return undefined;
      const text = valueText(value);
      if (text !== undefined) out[key] = text;
    }
    return out;
  }
  return undefined;
};

/** A parameter file of the repository, read. */
export const readParameterFile = (repoDir: string, file: string): ParameterFile => {
  let text: string;
  try {
    text = readFileSync(join(repoDir, file), 'utf8');
  } catch (cause) {
    return { unreadable: (cause as { code?: string }).code === 'ENOENT' ? `${file} is not there` : `${file} could not be read` };
  }
  const yaml = YAML_FILE.test(file);
  let document: unknown;
  try {
    document = yaml ? readServiceYaml(text).value : JSON.parse(text);
  } catch (cause) {
    return { unreadable: `${file} is not ${yaml ? 'YAML' : 'JSON'}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const values = parameterValues(document);
  return values === undefined ? { unreadable: `${file} is not a list of ParameterKey and ParameterValue, of Key=Value, or a template configuration with Parameters` } : { values };
};

/** A parameter file written as YAML rather than JSON (P259). */
export const YAML_FILE = /\.ya?ml$/;

/** What a parameter file's name may end in. */
export const PARAMETER_FILE = /\.(?:json|ya?ml)$/;

/** The spellings of one name, each format a parameter file is written in. */
const spelled = (stem: string): string[] => ['json', 'yaml', 'yml'].map((extension) => `${stem}.${extension}`);

/** Names a parameter file of one template is kept under beside it, by the template's name without its extension. */
const OWN_NAMES = (base: string): string[] =>
  [`${base}.parameters`, `${base}-parameters`, `${base}.params`, `${base}-params`, `${base}.config`, `${base}-config`, `${base}-configuration`].flatMap(spelled);

/** Names a parameter file of the one template of a directory is kept under. */
const SHARED_NAMES = ['parameters', 'params', 'template-config', 'template-configuration'].flatMap(spelled);

/**
 * The files beside a template that say by their names they hold its values:
 * one named after the template, or - where the template is the only one in
 * its directory - one named for a template at all. Only those that are there
 * and are parameter files count.
 */
export const parameterFilesBeside = (repoDir: string, template: string, templates: readonly string[]): string[] => {
  const dir = posix.dirname(template);
  const base = posix.basename(template).replace(/\.[^.]+$/, '');
  const alone = templates.filter((other) => posix.dirname(other) === dir).length <= 1;
  const names = [...OWN_NAMES(base), ...(alone ? SHARED_NAMES : [])];
  return names
    .map((name) => (dir === '.' ? name : `${dir}/${name}`))
    .filter((file) => !templates.includes(file) && 'values' in readParameterFile(repoDir, file));
};

/** A `samconfig` override naming a file: `parameter_overrides = "file://params.json"`, relative to the file's directory. */
export const namedParameterFiles = (written: unknown, dir: string): string[] => {
  const texts = Array.isArray(written) ? written.filter((item): item is string => typeof item === 'string') : typeof written === 'string' ? [written] : [];
  return texts.flatMap((text) => [...text.matchAll(/file:\/\/(\S+)/g)].map((match) => posix.normalize(dir === '.' ? (match[1] as string) : `${dir}/${match[1] as string}`)));
};
