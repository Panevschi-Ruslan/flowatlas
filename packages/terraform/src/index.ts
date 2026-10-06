import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, type Deployment, type DeploymentReadOptions, type DeploymentReader, type FlowatlasConfig } from '@flowatlas/core';
import { DeploymentReading } from './aws/read.js';
import { infrastructureFiles } from './configuration/files.js';
import { loadConfiguration } from './configuration/load.js';
import { SHIPPED_MODULES } from './configuration/shipped.js';
import { describedModule } from './configuration/sources.js';

export type { Attribute, Block, Body, Expression, HclFile, Position, Step, TemplatePart } from './hcl/ast.js';
export { attributeOf, blocksOf } from './hcl/ast.js';
export { HclSyntaxError, parseHcl, parseHclExpression, parseHclTemplate, templateText } from './hcl/parse.js';
export { evaluate } from './eval/evaluate.js';
export type { Scope } from './eval/evaluate.js';
export type { Because, Instance, ModuleInstance, Value } from './eval/values.js';
export { loadConfiguration } from './configuration/load.js';
export type { Configuration, LoadOptions } from './configuration/load.js';
export { infrastructureFiles } from './configuration/files.js';
export { SHIPPED_MODULES } from './configuration/shipped.js';
export { describedModule, normaliseSource } from './configuration/sources.js';

/**
 * Resource types a reading of functions, routes, workflows and their subscribers
 * has a use for. A repository whose configuration declares none of these, and calls no
 * module described as declaring them, is not one this reader reads anything
 * from. A bus, a queue or a topic counts on its own: a repository of nothing
 * but shared messaging infrastructure is where other repositories' channels
 * meet (P23).
 */
const READ_TYPES = new RegExp(
  `"aws_(?:${[
    'lambda_function',
    'api_gateway_[a-z_]+',
    'apigatewayv2_[a-z_]+',
    'cloudwatch_event_(?:rule|target|bus)',
    'scheduler_schedule',
    'lambda_event_source_mapping',
    'sns_topic(?:_subscription)?',
    'sqs_queue(?:_redrive_policy)?',
    'pipes_pipe',
    'sfn_state_machine',
  ].join('|')})"`,
);

const MODULE_SOURCE = /\bsource\s*=\s*"([^"]+)"/g;

/** What `declares` answered for a directory, for the life of the process. */
const declared = new Map<string, boolean>();

/**
 * The configuration files and when each last changed, so an answer kept for a
 * directory is asked afresh once one of them changes.
 */
const stampOf = (repoDir: string): string =>
  infrastructureFiles(repoDir)
    .map((file) => {
      try {
        return `${file}@${statSync(join(repoDir, file)).mtimeMs}`;
      } catch {
        return file;
      }
    })
    .join('|');

const declaresIn = (repoDir: string, config?: FlowatlasConfig): boolean => {
  const descriptions = [...(config?.adapters.infra.modules ?? []), ...SHIPPED_MODULES];
  for (const file of infrastructureFiles(repoDir)) {
    if (!file.endsWith('.tf')) continue;
    let text: string;
    try {
      text = readFileSync(join(repoDir, file), 'utf8');
    } catch {
      continue;
    }
    if (READ_TYPES.test(text)) return true;
    for (const match of text.matchAll(MODULE_SOURCE)) {
      const source = match[1];
      if (source !== undefined && describedModule(source, descriptions) !== undefined) return true;
    }
  }
  return false;
};

/**
 * The files each reading's evaluation opened, by what it was read with.
 *
 * Which files a configuration loads - a state machine's definition, a template -
 * is what `file()` and `templatefile()` were handed once evaluated, and a path
 * built through a local or a variable (`file("${local.dir}/x.json")`) is not
 * written anywhere a reader of the text could find it. So the answer is the
 * evaluator's, kept from the last reading of the same configuration: the paths
 * can change only when a configuration file or what it is read with does, and a
 * loaded file changing is what watching it is for, not a reason to look again.
 */
const loaded = new Map<string, readonly string[]>();

const loadedKey = (options: DeploymentReadOptions): string =>
  [
    options.repoDir,
    stampOf(options.repoDir),
    JSON.stringify(options.config.adapters.infra.modules),
    JSON.stringify(options.service?.infra?.vars ?? null),
  ].join('\0');

/** A reading, its loaded files kept under the stamp taken before it began: a save during it is then seen next time. */
const readWith = (options: DeploymentReadOptions, key = loadedKey(options)): Deployment => {
  const configuration = loadConfiguration({
    repoDir: options.repoDir,
    ...(options.service?.infra === undefined ? {} : { varFiles: options.service.infra.vars }),
    descriptions: [...options.config.adapters.infra.modules, ...SHIPPED_MODULES],
  });
  const deployment = new DeploymentReading(configuration).read();
  loaded.set(key, configuration.loadedFiles());
  return deployment;
};

/**
 * Terraform, read from the checked-out files alone.
 *
 * Nothing here runs `terraform`, needs `terraform init`, or reads state. What a
 * plan would know and the files do not - a computed id, a variable set on the
 * command line, the keys of a collection read from elsewhere - is unknown, and
 * the rows say which.
 */
export const terraformReader: DeploymentReader = {
  name: 'terraform',
  declares: (repoDir, config) => {
    // Keyed on the files and when each last changed as well as on the
    // descriptions, so a watch that adds a function is answered afresh.
    const key = `${repoDir}\0${stampOf(repoDir)}\0${config === undefined ? '' : JSON.stringify(config.adapters.infra.modules)}`;
    const cached = declared.get(key);
    if (cached !== undefined) return cached;
    const answer = declaresIn(repoDir, config);
    declared.set(key, answer);
    return answer;
  },
  read: (options) => readWith(options),
  files: (repoDir, options) => {
    const infrastructure = infrastructureFiles(repoDir);
    if (infrastructure.length === 0) return [];
    const reading = { repoDir, config: options?.config ?? parseConfig({}), ...(options?.service === undefined ? {} : { service: options.service }) };
    const key = loadedKey(reading);
    if (!loaded.has(key)) readWith(reading, key);
    return [...new Set([...infrastructure, ...(loaded.get(key) ?? [])])].sort();
  },
};
export { UNREAD_DEPLOYMENTS, unreadDeploymentOf } from './unread.js';
export { referencesIn } from './hcl/walk.js';
export { addressOf, deployedNameOf } from './aws/state-machines.js';
