import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { DeployedWorkflow } from '@flowatlas/core';
import { answerFor, isRecord, readStateMachineResource, textOf, workflowNameOf, workflowOf, type Resource } from '@flowatlas/serverless';
import { readEvents, workflowEventReaders } from './events.js';
import { apiLookup } from './apis.js';
import { withGlobals } from './functions.js';
import { localPath, type TemplateReading } from './reading.js';

/**
 * `AWS::Serverless::StateMachine` (P246): a workflow whose definition is
 * written in place, as YAML or JSON with intrinsic functions in it, or in a
 * file of its own (`DefinitionUri`), with `${...}` placeholders its
 * `DefinitionSubstitutions` fill. Either is handed over as P22's
 * `DeployedDefinition` - a value with a line per state, or the file's text -
 * and each placeholder is answered with the ARN of what it names, so the
 * reader of definitions joins a step to the function it invokes as it does for
 * Terraform's templates. Its events start it: a clock, the scheduler, a rule.
 */

const FORMATS: Readonly<Record<string, 'json' | 'yaml'>> = { '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml' };

/** A definition in a file of the repository, the template's directory its base: its text, or why it is not read. */
const definitionFile = (reading: TemplateReading, uri: string | undefined): { readonly file: string; readonly text: string; readonly format: 'json' | 'yaml' } | { readonly why: string } => {
  const file = uri === undefined ? undefined : localPath(reading.dir, uri);
  if (uri === undefined || file === undefined) return { why: `${uri ?? 'it'} is not a file of the repository` };
  const format = FORMATS[extname(file)];
  let text: string;
  try {
    text = readFileSync(join(reading.repoDir, file), 'utf8');
  } catch {
    return { why: `${file} is not there` };
  }
  reading.loaded.add(join(reading.repoDir, file));
  return format === undefined ? { why: `${file} is neither JSON nor YAML` } : { file, text, format };
};

/**
 * `AWS::StepFunctions::StateMachine` (P248): its definition in place, as JSON
 * text, or in a file of the repository that `aws cloudformation package`
 * uploads from `DefinitionS3Location` - the way a plain template keeps one in
 * a file of its own, its `${...}` placeholders filled by
 * `DefinitionSubstitutions` as SAM's are. A definition in place or as text is
 * the Serverless reader's.
 */
export const readStepFunctionsStateMachine = (reading: TemplateReading, resource: Resource): void => {
  const { properties, path, address } = resource;
  const location = properties['DefinitionS3Location'];
  if (location === undefined || properties['Definition'] !== undefined || properties['DefinitionString'] !== undefined) {
    readStateMachineResource(reading.file, resource);
    return;
  }
  const { name, reference } = workflowNameOf(reading.file, properties['StateMachineName'], address, path);
  const substitutions = isRecord(properties['DefinitionSubstitutions']) ? properties['DefinitionSubstitutions'] : {};
  const found = definitionFile(reading, textOf(location));
  if (!('text' in found)) {
    reading.file.row(path, address, {
      reason: 'workflow-definition-not-loaded',
      message: `the definition of ${address} is not read: ${isRecord(location) ? 'it is uploaded to a bucket, which no file here holds' : found.why}`,
      hint: 'Nothing of this workflow is drawn. Write the definition under Definition, or point DefinitionS3Location at a .asl.json or .asl.yaml file of the repository, which aws cloudformation package uploads.',
    });
    return;
  }
  const type = textOf(properties['StateMachineType']);
  reading.file.parts.workflows.push({
    ...reading.file.siteOf(path),
    ...(name === undefined ? {} : { name }),
    address,
    definition: { kind: 'text', ...found, firstLine: 1 },
    fill: (key) => {
      const substitution = substitutions[key];
      return substitution === undefined ? undefined : (textOf(substitution) ?? answerFor(reading.file, substitution));
    },
    meta: {
      declaredAs: address,
      ...(name === undefined && reference !== undefined ? { nameGenerated: true } : {}),
      ...(type === undefined ? {} : { type }),
      ...reading.conditionOf(resource.logicalId),
    },
  });
};

export const readStateMachine = (reading: TemplateReading, resource: Resource): void => {
  const properties = withGlobals(reading.globals['StateMachine'], resource.properties);
  const { path, address } = resource;
  const { name, reference } = workflowNameOf(reading.file, properties['Name'], address, path);
  const substitutions = isRecord(properties['DefinitionSubstitutions']) ? properties['DefinitionSubstitutions'] : {};
  const type = textOf(properties['Type']);
  const meta = {
    ...(name === undefined && reference !== undefined ? { nameGenerated: true } : {}),
    ...(type === undefined ? {} : { type }),
    ...reading.conditionOf(resource.logicalId),
  };
  const fill = (key: string): string | undefined => {
    const substitution = substitutions[key];
    return substitution === undefined ? undefined : (textOf(substitution) ?? answerFor(reading.file, substitution));
  };
  let workflow: DeployedWorkflow | undefined;
  if (properties['Definition'] !== undefined) {
    workflow = workflowOf(reading.file, address, path, [...path, 'Properties', 'Definition'], properties['Definition'], name, substitutions, meta);
  } else {
    const uri = textOf(properties['DefinitionUri']);
    const found = definitionFile(reading, uri);
    if ('text' in found) {
      workflow = {
        ...reading.file.siteOf(path),
        ...(name === undefined ? {} : { name }),
        address,
        definition: { kind: 'text', ...found, firstLine: 1 },
        fill,
        meta: { declaredAs: address, ...meta },
      };
    } else {
      reading.file.row(path, address, {
        reason: 'workflow-definition-not-loaded',
        message: `the definition of ${address} is not read: ${uri === undefined ? 'it is neither a Definition written in place nor a DefinitionUri' : found.why}`,
        hint: 'Nothing of this workflow is drawn. Write the definition under Definition, or point DefinitionUri at a .asl.json or .asl.yaml file of the repository.',
      });
    }
  }
  if (workflow !== undefined) reading.file.parts.workflows.push(workflow);
  readEvents(reading, properties['Events'], workflowEventReaders(apiLookup(reading)), {
    ...(reference === undefined ? {} : { to: { kind: 'workflow' as const, name: reference } }),
    label: name ?? address,
    logicalId: resource.logicalId,
    path: [...path, 'Properties'],
    address,
  });
};
