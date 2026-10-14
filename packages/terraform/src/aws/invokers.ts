import { makeFunctionUrlEntryKey, type DeliveryTarget, type DeployedKind, type RouteTarget } from '@flowatlas/core';
import type { Because, Instance, Value } from '../eval/values.js';
import { argument, blockOrArgument, blocksNamed, entryOf, listed, siteOf, textOf, unreadRow, whyNot } from './arguments.js';
import { deployedAt, deployedOfValue, isBecause, targetOf, type Deployed } from './deployed.js';
import { functionAt } from './queues.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * The other ways a function is run (P53).
 *
 * A function URL and a load balancer put a function behind an address of its
 * own, with no API in front, so each is a route. A user pool runs a function at
 * a step of signing a person up or in, and an IoT rule runs one for each
 * message on the topics it selects: neither is published to by any code, so
 * each is an `event` entry of its own, the way a socket route is. Anything else
 * that is allowed to invoke a function - a principal on `aws_lambda_permission`
 * none of the readers follows - is said, so the map never reads as though
 * nothing runs it.
 */

/** The block a value refers to, by reference or through a value that came from one. */
const referenced = (value: Value | undefined): Instance | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'ref') return value.target;
  if (value.kind === 'instance') return value.instance;
  return 'via' in value ? value.via?.target : undefined;
};

/** Every text of a list, or of a single value. */
const textsOf = (value: Value | undefined): string[] => {
  if (value === undefined) return [];
  const items = value.kind === 'list' ? value.items : [value];
  return items.flatMap((item) => {
    const text = textOf(item);
    return text === undefined ? [] : [text];
  });
};

/** A function found, as what answers a route. */
const routeTargetOf = (found: Deployed | Because | undefined): RouteTarget | Because | undefined => {
  if (found === undefined || isBecause(found)) return found;
  if (found.kind !== 'function') return { reason: 'unplaced', text: `it is a ${found.kind} (${found.name}), not a function` };
  return found.function === undefined ? { name: found.name } : { function: found.function };
};

// ---------------------------------------------------------- function URLs

/** A function URL: every verb and every path, straight to the function. */
const readFunctionUrl: ResourceReader[1] = (url, reading) => {
  const qualifier = textOf(argument(url, 'qualifier'));
  const authorization = textOf(argument(url, 'authorization_type'));
  const found = functionAt(url, 'function_name', reading);
  // Every function URL is `ALL /*`: the function is what keeps two apart.
  const owner = found === undefined || isBecause(found) ? url.address : found.name;
  reading.route({
    ...siteOf(url),
    address: url.address,
    symbol: url.address,
    method: 'ALL',
    path: { kind: 'path', path: '/*' },
    rawPath: '/*',
    target: routeTargetOf(found),
    guards: authorization === 'AWS_IAM' ? [{ label: authorization, ...siteOf(url) }] : [],
    meta: { by: 'function-url', key: makeFunctionUrlEntryKey(owner, qualifier), ...(qualifier === undefined ? {} : { qualifier }) },
  });
};

// ------------------------------------------------------------ user pools

/** Arguments of `lambda_config` that are not a step a function runs at. */
const NOT_TRIGGERS = new Set(['kms_key_id']);

/**
 * Each step of a user pool that runs a function. A step is an ARN, or - for
 * the senders and the versioned token step - a block holding one as
 * `lambda_arn`.
 */
const readUserPool: ResourceReader[1] = (pool, reading) => {
  const config = blockOrArgument(pool, 'lambda_config');
  const entries = config?.kind === 'object' ? config.entries : config?.kind === 'list' && config.items[0]?.kind === 'object' ? config.items[0].entries : undefined;
  if (entries === undefined) return;
  const name = textOf(argument(pool, 'name')) ?? pool.address;
  for (const [trigger, written] of entries) {
    if (NOT_TRIGGERS.has(trigger) || written.kind === 'null') continue;
    const arn = written.kind === 'object' || written.kind === 'list' ? entryOf(written, 'lambda_arn') : written;
    if (arn === undefined) continue;
    const what = `the function ${pool.address} runs at ${trigger}`;
    const to = targetOf(deployedOfValue(arn, what, reading), pool, what, reading);
    reading.deliveries.push({
      ...siteOf(pool),
      address: `${pool.address}.lambda_config.${trigger}`,
      by: 'trigger',
      name: trigger,
      from: { kind: 'trigger', service: 'cognito', key: `cognito/${name}/${trigger}` },
      ...(to === undefined ? {} : { to }),
      meta: { pool: name, trigger },
    });
  }
};

// ------------------------------------------------------------- IoT rules

/** The topic filter of a rule's statement: `SELECT * FROM 'library/returns/+'`. */
const TOPIC_FILTER = /\bFROM\s+'([^']+)'/i;

/**
 * Each action of a rule that runs something or sends on, where it names that,
 * and what it names (P53, P56): a function, a queue, a topic; a stream put on
 * or a table written to, which is a publish onto the channel its stream's
 * readers take from; a state machine started, as `StartExecution` starts one.
 */
interface IotAction {
  readonly at: readonly string[];
  readonly kind: DeployedKind;
}

const IOT_ACTIONS: ReadonlyMap<string, IotAction> = new Map<string, IotAction>([
  ['lambda', { at: ['function_arn'], kind: 'function' }],
  ['sqs', { at: ['queue_url'], kind: 'queue' }],
  ['sns', { at: ['target_arn'], kind: 'topic' }],
  ['kinesis', { at: ['stream_name'], kind: 'stream' }],
  ['dynamodb', { at: ['table_name'], kind: 'table' }],
  ['dynamodbv2', { at: ['put_item', 'table_name'], kind: 'table' }],
  ['step_functions', { at: ['state_machine_name'], kind: 'workflow' }],
]);

/** Actions that hand a message to something this reading does not follow, said by name. */
const IOT_UNREAD_ACTIONS = [
  'cloudwatch_alarm',
  'cloudwatch_logs',
  'cloudwatch_metric',
  'elasticsearch',
  'firehose',
  'http',
  'iot_analytics',
  'iot_events',
  'kafka',
  'opensearch',
  'republish',
  's3',
  'timestream',
];

/** Kinds an action names by their bare name as well as by reference or ARN. */
const NAMED_BARE = new Set<DeployedKind>(['function', 'stream', 'table', 'workflow']);

/** What an action names, by reference, ARN, or - where the action takes one - bare name. */
const namedBy = (value: Value, action: IotAction, what: string, reading: ResourceReading): Deployed | Because => {
  const found = deployedOfValue(value, what, reading);
  const text = textOf(value);
  return isBecause(found) && found.reason === 'unplaced' && text !== undefined && NAMED_BARE.has(action.kind) ? { kind: action.kind, name: text } : found;
};

/** What an action hands each message to: a stream or a table as the channel of its changes. */
const actionTarget = (found: Deployed | Because | undefined, rule: Instance, what: string, reading: ResourceReading): DeliveryTarget | undefined => {
  if (found !== undefined && !isBecause(found) && (found.kind === 'table' || found.kind === 'stream')) {
    return { kind: 'changes', of: found.kind, name: found.name };
  }
  return targetOf(found, rule, what, reading);
};

/** The value at a path of keys inside a block. */
const valueAt = (block: Value, at: readonly string[]): Value | undefined =>
  at.reduce<Value | undefined>((value, key) => (value === undefined ? undefined : entryOf(value, key)), block);

const readTopicRule: ResourceReader[1] = (rule, reading) => {
  const sql = argument(rule, 'sql');
  const text = textOf(sql);
  const filter = text === undefined ? undefined : TOPIC_FILTER.exec(text)?.[1];
  if (filter === undefined) {
    const because = text === undefined ? whyNot(sql, 'sql') : { reason: 'unplaced', text: `its statement ${JSON.stringify(text)} names no topic filter` };
    reading.rows.push(unreadRow(rule, 'subscription-source-unread', `the topics ${rule.address} takes messages from`, because));
    return;
  }
  const name = textOf(argument(rule, 'name'));
  const enabled = argument(rule, 'enabled');
  const deliver = (action: string, spec: IotAction, block: Value, address: string, failure: boolean): void => {
    const what = `the ${action} action of ${rule.address}${failure ? ', on failure' : ''}`;
    const value = valueAt(block, spec.at);
    const to = actionTarget(value === undefined ? undefined : namedBy(value, spec, what, reading), rule, what, reading);
    reading.deliveries.push({
      ...siteOf(rule),
      address,
      by: 'rule',
      ...(name === undefined ? {} : { name }),
      from: { kind: 'trigger', service: 'iot', key: `iot/${filter}` },
      ...(to === undefined ? {} : { to }),
      meta: {
        rule: rule.address,
        ...(enabled?.kind === 'bool' && !enabled.value ? { disabled: true } : {}),
        ...(failure ? { when: 'failure' } : {}),
      },
    });
  };
  const unread = (action: string, failure: boolean): void => {
    reading.rows.push({
      ...siteOf(rule),
      reason: 'iot-action-not-read',
      level: 'info',
      message: `${rule.address} hands each message on to its ${action} action${failure ? ' when another fails' : ''}, which is not read, so nothing past it is drawn`,
      hint: 'The rule is still drawn with every action it has that runs a function, sends on, writes a table or a stream, or starts a state machine.',
      symbol: rule.address,
      meta: { action, ...(failure ? { when: 'failure' } : {}) },
    });
  };
  for (const [action, spec] of IOT_ACTIONS) {
    blocksNamed(rule, action).forEach((block, index) => deliver(action, spec, block, `${rule.address}.${action}[${index}]`, false));
  }
  for (const action of IOT_UNREAD_ACTIONS) {
    if (blocksNamed(rule, action).length > 0) unread(action, false);
  }
  // The error action runs on a failure of any other: after them, so the entry
  // the rule is takes its function, if any, from what runs on every message.
  blocksNamed(rule, 'error_action').forEach((errors, at) => {
    for (const [action, spec] of IOT_ACTIONS) {
      listed(entryOf(errors, action)).forEach((block, index) =>
        deliver(action, spec, block, `${rule.address}.error_action[${at}].${action}[${index}]`, true),
      );
    }
    for (const action of IOT_UNREAD_ACTIONS) {
      if (listed(entryOf(errors, action)).length > 0) unread(action, true);
    }
  });
};

// -------------------------------------------------------- load balancers

const LISTENERS = new Set(['aws_lb_listener', 'aws_alb_listener']);
const TARGET_GROUPS = new Set(['aws_lb_target_group', 'aws_alb_target_group']);
const ATTACHMENTS = ['aws_lb_target_group_attachment', 'aws_alb_target_group_attachment'];

/** The functions registered with a target group of functions. */
const functionsBehind = (group: Instance, reading: ResourceReading): (RouteTarget | Because)[] => {
  if (textOf(argument(group, 'target_type')) !== 'lambda') return [];
  return ATTACHMENTS.flatMap((type) => reading.ofType('managed', type))
    .filter((attachment) => referenced(argument(attachment, 'target_group_arn')) === group)
    .flatMap((attachment) => {
      const target = routeTargetOf(deployedAt(attachment, 'target_id', reading));
      return target === undefined ? [] : [target];
    });
};

/** The target groups an action forwards to: `target_group_arn`, or each `forward.target_group`. */
const groupsOf = (action: Value): Instance[] => {
  if (textOf(entryOf(action, 'type')) !== 'forward') return [];
  const direct = referenced(entryOf(action, 'target_group_arn'));
  const weighted = entryOf(action, 'forward');
  const groups = weighted === undefined ? undefined : entryOf(weighted, 'target_group');
  const listed = groups?.kind === 'list' ? groups.items : groups === undefined ? [] : [groups];
  return [direct, ...listed.map((group) => referenced(entryOf(group, 'arn')))].filter(
    (group): group is Instance => group !== undefined && TARGET_GROUPS.has(group.type),
  );
};

/** The values one kind of condition of a rule lists, across every condition block. */
const conditionValues = (rule: Instance, kind: string): string[] =>
  rule.module.nested(rule, 'condition').flatMap((condition) => {
    const block = entryOf(condition, kind);
    return block === undefined ? [] : textsOf(entryOf(block, 'values'));
  });

/** A route per path and verb a listener or a rule forwards to each function behind it. */
const routeFunctions = (
  owner: Instance,
  balancer: Instance | undefined,
  actions: readonly Value[],
  paths: readonly string[],
  methods: readonly string[],
  hosts: readonly string[],
  reading: ResourceReading,
): void => {
  const targets = actions.flatMap(groupsOf).flatMap((group) => functionsBehind(group, reading));
  for (const target of targets) {
    for (const path of paths) {
      for (const method of methods) {
        reading.route({
          ...siteOf(owner),
          address: owner.address,
          symbol: owner.address,
          method,
          path: { kind: 'path', path, ...(balancer === undefined ? {} : { api: balancer }) },
          rawPath: path,
          target,
          guards: [],
          meta: { by: 'load-balancer', ...(hosts.length === 0 ? {} : { hosts }) },
        });
      }
    }
  }
};

const readListener: ResourceReader[1] = (listener, reading) =>
  routeFunctions(listener, referenced(argument(listener, 'load_balancer_arn')), listener.module.nested(listener, 'default_action'), ['/*'], ['ALL'], [], reading);

const readListenerRule: ResourceReader[1] = (rule, reading) => {
  const listener = referenced(argument(rule, 'listener_arn'));
  const balancer = listener !== undefined && LISTENERS.has(listener.type) ? referenced(argument(listener, 'load_balancer_arn')) : undefined;
  const paths = conditionValues(rule, 'path_pattern');
  const methods = conditionValues(rule, 'http_request_method').map((method) => method.toUpperCase());
  routeFunctions(
    rule,
    balancer,
    rule.module.nested(rule, 'action'),
    paths.length === 0 ? ['/*'] : paths,
    methods.length === 0 ? ['ALL'] : methods,
    conditionValues(rule, 'host_header'),
    reading,
  );
};

// ----------------------------------------------------------- permissions

/**
 * Principals whose invocations are read from the resources that make them:
 * routes, rules, subscriptions, queues, workflows, pipes, schedules, bucket
 * notifications, user pools, IoT rules, load balancers.
 */
const READ_PRINCIPALS = new Set([
  'apigateway.amazonaws.com',
  'events.amazonaws.com',
  'scheduler.amazonaws.com',
  'sns.amazonaws.com',
  'sqs.amazonaws.com',
  'states.amazonaws.com',
  'pipes.amazonaws.com',
  's3.amazonaws.com',
  'cognito-idp.amazonaws.com',
  'iot.amazonaws.com',
  'elasticloadbalancing.amazonaws.com',
]);

/** A permission for something none of the readers follows to run a function. */
const readPermission: ResourceReader[1] = (permission, reading) => {
  const principal = textOf(argument(permission, 'principal'));
  if (principal === undefined || READ_PRINCIPALS.has(principal)) return;
  const found = functionAt(permission, 'function_name', reading);
  const fn = found === undefined || isBecause(found) ? permission.address : found.name;
  reading.rows.push({
    ...siteOf(permission),
    reason: 'invoker-not-read',
    level: 'info',
    message: `${fn} may be run by ${principal}, which is not read, so what runs it from there is not drawn`,
    hint: 'The function is still a way in of its own; nothing here says it is unused because nothing drawn reaches it.',
    symbol: permission.address,
    meta: { principal, ...(found === undefined || isBecause(found) ? {} : { function: found.name }) },
  });
};

export const INVOKER_READERS: readonly ResourceReader[] = [
  ['aws_lambda_function_url', readFunctionUrl],
  ['aws_cognito_user_pool', readUserPool],
  ['aws_iot_topic_rule', readTopicRule],
  ['aws_lb_listener', readListener],
  ['aws_alb_listener', readListener],
  ['aws_lb_listener_rule', readListenerRule],
  ['aws_alb_listener_rule', readListenerRule],
  ['aws_lambda_permission', readPermission],
];
