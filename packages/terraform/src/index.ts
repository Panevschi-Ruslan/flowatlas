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

/** When a repo-relative file last changed, or nothing when it is not there. */
const changedAt = (repoDir: string, file: string): number | undefined => {
  try {
    return statSync(join(repoDir, file)).mtimeMs;
  } catch {
    return undefined;
  }
};

/**
 * Files and when each last changed - the configuration files unless others are
 * named - so an answer kept for a directory is asked afresh once one of them
 * changes.
 */
const stampOf = (repoDir: string, files: readonly string[] = infrastructureFiles(repoDir)): string =>
  files
    .map((file) => {
      const at = changedAt(repoDir, file);
      return at === undefined ? file : `${file}@${at}`;
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

/** A reading of one configuration, and what it was read from. */
interface Reading {
  readonly deployment: Deployment;
  /** The configuration files and when each last changed, taken before the reading began. */
  readonly stamp: string;
  /**
   * The files its evaluation opened besides - a state machine's definition, a
   * template - which only the evaluator knows: a path built through a local or
   * a variable (`file("${local.dir}/x.json")`) is not written anywhere a reader
   * of the text could find it.
   */
  readonly loaded: readonly string[];
  /** Those files and when each last changed. */
  readonly loadedStamp: string;
}

/**
 * The last reading of each configuration, by what it is read with (R176).
 *
 * A build asks for one service's deployment more than once - for the directories
 * its functions are packaged from, before the reading opens them, for the files
 * it stamps, and for its entries - and each answer is the same reading. So a
 * reading is kept, and taken again only once a configuration file or a file it
 * loaded has changed: one evaluation per service per build, and a save during a
 * watch is still seen. One reading is kept per configuration, so a long watch
 * does not keep the old ones.
 */
const readings = new Map<string, Reading>();

const readingKey = (options: DeploymentReadOptions): string =>
  [
    options.repoDir,
    JSON.stringify(options.config.adapters.infra.modules),
    JSON.stringify(options.service?.infra?.vars ?? null),
  ].join('\0');

const isCurrent = (repoDir: string, reading: Reading, stamp: string): boolean =>
  reading.stamp === stamp && stampOf(repoDir, reading.loaded) === reading.loadedStamp;

const readingOf = (options: DeploymentReadOptions): Reading => {
  const { repoDir } = options;
  const key = readingKey(options);
  // Taken before the reading begins, so a save during it is seen next time.
  const stamp = stampOf(repoDir);
  const kept = readings.get(key);
  if (kept !== undefined && isCurrent(repoDir, kept, stamp)) return kept;
  const began = Date.now();
  const configuration = loadConfiguration({
    repoDir,
    ...(options.service?.infra === undefined ? {} : { varFiles: options.service.infra.vars }),
    descriptions: [...options.config.adapters.infra.modules, ...SHIPPED_MODULES],
  });
  const deployment = new DeploymentReading(configuration).read();
  const loaded = configuration.loadedFiles();
  const reading: Reading = { deployment, stamp, loaded, loadedStamp: stampOf(repoDir, loaded) };
  // A loaded file is only known once it is opened, so its stamp is taken after:
  // one saved while the reading ran may have been read either way, and a reading
  // that cannot say which is not kept.
  if (loaded.every((file) => (changedAt(repoDir, file) ?? 0) < began)) readings.set(key, reading);
  else readings.delete(key);
  return reading;
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
  read: (options) => readingOf(options).deployment,
  files: (repoDir, options) => {
    const infrastructure = infrastructureFiles(repoDir);
    if (infrastructure.length === 0) return [];
    const { loaded } = readingOf({
      repoDir,
      config: options?.config ?? parseConfig({}),
      ...(options?.service === undefined ? {} : { service: options.service }),
    });
    return [...new Set([...infrastructure, ...loaded])].sort();
  },
};
export { UNREAD_DEPLOYMENTS, unreadDeploymentOf } from './unread.js';
export { referencesIn } from './hcl/walk.js';
export { addressOf, deployedNameOf } from './aws/state-machines.js';
