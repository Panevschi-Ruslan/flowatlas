import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Deployment, DeploymentReader, FlowatlasConfig } from '@flowatlas/core';
import { DeploymentReading } from './aws/read.js';
import { infrastructureFiles, loadedFiles } from './configuration/files.js';
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
 * Resource types a reading of functions, routes and workflows has a use for. A repository
 * whose configuration declares none of these, and calls no module described as
 * declaring them, is not one this reader reads anything from.
 */
const READ_TYPES = /"aws_(?:lambda_function|api_gateway_[a-z_]+|apigatewayv2_[a-z_]+|sfn_state_machine)"/;

const MODULE_SOURCE = /\bsource\s*=\s*"([^"]+)"/g;

/** What `declares` answered for a directory, for the life of the process. */
const declared = new Map<string, boolean>();

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
    const stamp = infrastructureFiles(repoDir).map((file) => {
      try {
        return `${file}@${statSync(join(repoDir, file)).mtimeMs}`;
      } catch {
        return file;
      }
    });
    const key = `${repoDir}\0${stamp.join('|')}\0${config === undefined ? '' : JSON.stringify(config.adapters.infra.modules)}`;
    const cached = declared.get(key);
    if (cached !== undefined) return cached;
    const answer = declaresIn(repoDir, config);
    declared.set(key, answer);
    return answer;
  },
  read: (options): Deployment => {
    const configuration = loadConfiguration({
      repoDir: options.repoDir,
      ...(options.service?.infra === undefined ? {} : { varFiles: options.service.infra.vars }),
      descriptions: [...options.config.adapters.infra.modules, ...SHIPPED_MODULES],
    });
    return new DeploymentReading(configuration).read();
  },
  files: (repoDir) => [...new Set([...infrastructureFiles(repoDir), ...loadedFiles(repoDir)])].sort(),
};
export { UNREAD_DEPLOYMENTS, unreadDeploymentOf } from './unread.js';
export { referencesIn } from './hcl/walk.js';
export { addressOf, deployedNameOf } from './aws/state-machines.js';
