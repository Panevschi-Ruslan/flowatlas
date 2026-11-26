import { grantedIn } from '@flowatlas/aws';
import type { DeployedGrant, DeployedKind, PathStep } from '@flowatlas/core';
import { documentGrants, intrinsicOf, isRecord, managedGrants, ParameterValue, roleGrants, roleOf, textOf, Unread, type FileReading } from '@flowatlas/serverless';
import type { TemplateReading } from './reading.js';

/**
 * What a SAM function's `Policies` and `Role` let it send to, write to,
 * invoke or start (P272).
 *
 * `Policies` is a list of three kinds of item: the name or ARN of a managed
 * policy, a policy document written in place, and one of the transform's
 * policy templates, which expands to statements on the one thing its
 * parameter names. A function given a `Role` takes its permissions from that
 * role instead, which the template may declare.
 */

/**
 * The policy templates that write, each with the kind of thing it grants and
 * the parameter that names it. A template that only reads - polling a queue,
 * reading a table or a stream - is no send and is left out.
 */
export const SAM_POLICY_TEMPLATES: Readonly<Record<string, { readonly kind: DeployedKind; readonly parameter: string }>> = {
  SQSSendMessagePolicy: { kind: 'queue', parameter: 'QueueName' },
  SNSPublishMessagePolicy: { kind: 'topic', parameter: 'TopicName' },
  SNSCrudPolicy: { kind: 'topic', parameter: 'TopicName' },
  EventBridgePutEventsPolicy: { kind: 'bus', parameter: 'EventBusName' },
  KinesisCrudPolicy: { kind: 'stream', parameter: 'StreamName' },
  DynamoDBCrudPolicy: { kind: 'table', parameter: 'TableName' },
  DynamoDBWritePolicy: { kind: 'table', parameter: 'TableName' },
  S3WritePolicy: { kind: 'bucket', parameter: 'BucketName' },
  S3CrudPolicy: { kind: 'bucket', parameter: 'BucketName' },
  S3FullAccessPolicy: { kind: 'bucket', parameter: 'BucketName' },
  LambdaInvokePolicy: { kind: 'function', parameter: 'FunctionName' },
  StepFunctionsExecutionPolicy: { kind: 'workflow', parameter: 'StateMachineName' },
};

/**
 * The one thing a policy template's parameter names: a name written out, a
 * reference to what the template declares (the transform takes a name, and
 * `!Ref` or `!GetAtt ...Name` hands it one), a parameter with no value that
 * names one thing (P268), `*`, or a value not read.
 */
const templateGrant = (file: FileReading, kind: DeployedKind, value: unknown): Omit<DeployedGrant, 'by' | 'file' | 'line'> => {
  const text = textOf(value);
  if (text !== undefined) {
    if (text.includes('*')) return { kind, any: text };
    // Some templates take an ARN as readily as a name.
    const inside = text.startsWith('arn:') ? grantedIn(kind, text) : undefined;
    return inside === undefined ? { kind, name: text } : { kind, ...inside };
  }
  if (value instanceof ParameterValue) {
    const named = file.template.namedByParameter(value);
    return named !== undefined && named.kind === kind ? { kind, name: named.name } : { kind, unread: value.text };
  }
  const found = file.template.deployedOf(value);
  if (found !== undefined && !(found instanceof Unread) && found.kind === kind) return { kind, name: found.name };
  // `!Select [1, !Split ['/', !GetAtt Queue.Arn]]` and the like: the one thing of the kind referred to inside it.
  const inner = intrinsicOf(value) === undefined ? undefined : innerReference(file, kind, value);
  if (inner !== undefined) return { kind, name: inner };
  const because = found instanceof Unread ? found : value instanceof Unread ? value : new Unread('it is not a name the template settles');
  return { kind, unread: because.text };
};

/** The one thing of a kind a value refers to somewhere inside it, by its name. */
const innerReference = (file: FileReading, kind: DeployedKind, value: unknown, depth = 0): string | undefined => {
  if (depth > 8) return undefined;
  const found = intrinsicOf(value) === undefined ? undefined : file.template.deployedOf(value);
  if (found !== undefined && !(found instanceof Unread) && found.kind === kind && found.changes !== true) return found.name;
  const children = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  const names = new Set(children.map((child) => innerReference(file, kind, child, depth + 1)).filter((name): name is string => name !== undefined));
  return names.size === 1 ? [...names][0] : undefined;
};

/** Every grant of one SAM or CloudFormation function, by its properties as the transform merges them. */
export const functionGrants = (reading: TemplateReading, path: readonly PathStep[], properties: Record<string, unknown>, serverless: boolean): DeployedGrant[] => {
  const file = reading.file;
  const role = roleOf(file, properties['Role']);
  if (role !== undefined) return roleGrants(file, role);
  if (!serverless) return [];
  const out: DeployedGrant[] = [];
  const policies = properties['Policies'];
  const items = Array.isArray(policies) ? policies : policies === undefined ? [] : [policies];
  items.forEach((item, index) => {
    const at: PathStep[] = [...path, 'Properties', 'Policies', ...(Array.isArray(policies) ? [index] : [])];
    const by = `Policies${Array.isArray(policies) ? `[${index}]` : ''}`;
    if (!isRecord(item) || intrinsicOf(item) !== undefined) {
      out.push(...managedGrants(file, item, at, by));
      return;
    }
    if (item['Statement'] !== undefined) {
      out.push(...documentGrants(file, item, at, by));
      return;
    }
    for (const [name, parameters] of Object.entries(item)) {
      const template = SAM_POLICY_TEMPLATES[name];
      if (template === undefined) continue;
      const value = isRecord(parameters) ? parameters[template.parameter] : undefined;
      out.push({ ...templateGrant(file, template.kind, value), by: name, ...file.siteOf([...at, name]) });
    }
  });
  return out;
};
