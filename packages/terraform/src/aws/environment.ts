import type { DeployedSetting } from '@flowatlas/core';
import { asText, describe, type Instance, type Value } from '../eval/values.js';
import { blockOrArgument, entryOf } from './arguments.js';
import { deployedInText, deployedOf, isBecause } from './deployed.js';
import type { ResourceReading } from './reading.js';

/**
 * The values a function is deployed with.
 *
 * Code that sends to a queue very often says which queue by reading a variable:
 * `QueueUrl: process.env.RETURNS_QUEUE_URL`. The value is set here, in the
 * function's `environment` block, and is usually a reference to the queue the
 * same configuration declares - `aws_sqs_queue.returns.url` - whose name is
 * known even though the URL is not until the queue exists. So each value is
 * kept three ways: as written, as text where the files settle it, and as the
 * deployed thing it names where it names one. Which of those the code needed
 * is decided where the code's address is completed, not here.
 */

/** A value as a person would recognise it in the file. */
const writtenAs = (value: Value): string => {
  if ('via' in value && value.via !== undefined && value.kind !== 'object' && value.kind !== 'list') {
    return `${value.via.target.address}.${value.via.attribute}`;
  }
  if (value.kind === 'string') return JSON.stringify(value.value);
  if (value.kind === 'unknown') return value.because.variable === undefined ? 'a value not known from the files' : `a value depending on var.${value.because.variable}`;
  return describe(value);
};

/** One value, read every way it can be. */
const settingOf = (value: Value, reading: Pick<ResourceReading, 'functionIndex'>): DeployedSetting => {
  const written = writtenAs(value);
  const text = asText(value);
  const found = deployedOf(value, reading) ?? (text === undefined ? undefined : deployedInText(text));
  if (found !== undefined && !isBecause(found)) {
    return { written, ...(text === undefined ? {} : { text }), names: { kind: found.kind, name: found.name } };
  }
  if (text !== undefined) return { written, text };
  const because = found !== undefined ? found : value.kind === 'unknown' ? value.because : { reason: 'not-a-string', text: `it is ${describe(value)}` };
  return {
    written,
    unread: {
      text: because.text,
      ...(because.variable === undefined ? {} : { variable: because.variable }),
      ...(because.files === undefined ? {} : { files: because.files }),
    },
  };
};

/**
 * Every variable a function's `environment` block sets, by name: nothing where
 * it has no such block, which is a statement that it sets none, and
 * `undefined` where the map is something the files do not settle - a variable
 * nobody set, a merge of one - which says nothing about any one variable.
 */
export const environmentOf = (
  fn: Instance,
  reading: Pick<ResourceReading, 'functionIndex'>,
): Readonly<Record<string, DeployedSetting>> | undefined => {
  const block = blockOrArgument(fn, 'environment');
  if (block === undefined || block.kind === 'null') return {};
  const variables = entryOf(block, 'variables');
  if (variables === undefined || variables.kind === 'null') return {};
  if (variables.kind !== 'object') return undefined;
  const out: Record<string, DeployedSetting> = {};
  for (const name of [...variables.entries.keys()].sort()) out[name] = settingOf(variables.entries.get(name) as Value, reading);
  return out;
};
