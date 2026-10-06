import type { InfraModuleDescription } from '@flowatlas/core';

/**
 * Descriptions of the public modules most projects declare buses, rules,
 * queues and topics through, shipped with the tool (P23).
 *
 * The same shape and the same schema as the function and route descriptions
 * beside them: each resource the module declares, by its address inside the
 * module, with the arguments this reading uses written over the module's
 * inputs. What the modules do with everything else - encryption, policies,
 * archives, retries - is left out.
 */

/**
 * `terraform-aws-modules/eventbridge/aws`: a bus, rules keyed by name in
 * `rules`, the targets of each rule in `targets` under the same key, and
 * schedules and pipes keyed by name. The module names each rule after its key
 * with `-rule` appended unless told not to.
 */
const EVENTBRIDGE: InfraModuleDescription = {
  source: 'terraform-aws-modules/eventbridge/aws',
  variables: {
    create: 'true',
    create_bus: 'true',
    bus_name: '"default"',
    create_rules: 'true',
    create_targets: 'true',
    create_schedules: 'true',
    create_pipes: 'true',
    append_rule_postfix: 'true',
    rules: '{}',
    targets: '{}',
    schedules: '{}',
    pipes: '{}',
  },
  resources: {
    'aws_cloudwatch_event_bus.this': {
      count: 'var.create && var.create_bus && var.bus_name != "default" ? 1 : 0',
      name: 'var.bus_name',
    },
    'aws_cloudwatch_event_rule.this': {
      for_each: 'var.create && var.create_rules ? var.rules : {}',
      name: 'var.append_rule_postfix ? "${replace(each.key, "_", "-")}-rule" : each.key',
      event_bus_name: 'var.bus_name',
      event_pattern: 'try(each.value.event_pattern, null)',
      schedule_expression: 'try(each.value.schedule_expression, null)',
      state: 'try(each.value.state, null)',
    },
    // One target per element of each rule's list, keyed "<rule>-<target name>".
    'aws_cloudwatch_event_target.this': {
      for_each:
        'var.create && var.create_targets ? { for pair in flatten([for rule, targets in var.targets : [for target in targets : { key = "${rule}-${target.name}", rule = rule, target = target }]]) : pair.key => pair } : {}',
      rule: 'aws_cloudwatch_event_rule.this[each.value.rule].name',
      event_bus_name: 'var.bus_name',
      arn: 'each.value.target.arn',
      input: 'try(each.value.target.input, null)',
      input_path: 'try(each.value.target.input_path, null)',
    },
    'aws_scheduler_schedule.this': {
      for_each: 'var.create && var.create_schedules ? var.schedules : {}',
      name: 'try(each.value.name, each.key)',
      schedule_expression: 'try(each.value.schedule_expression, null)',
      state: 'try(each.value.state, null)',
      target: '{ arn = try(each.value.arn, null) }',
    },
    'aws_pipes_pipe.this': {
      for_each: 'var.create && var.create_pipes ? var.pipes : {}',
      name: 'try(each.value.name, each.key)',
      source: 'try(each.value.source, null)',
      target: 'try(each.value.target, null)',
    },
  },
  outputs: {
    eventbridge_bus_name: 'try(aws_cloudwatch_event_bus.this[0].name, var.bus_name)',
    eventbridge_bus_arn: 'try(aws_cloudwatch_event_bus.this[0].arn, "")',
  },
};

/**
 * `terraform-aws-modules/sqs/aws`: a queue, and with `create_dlq` its
 * dead-letter queue, named after the queue with `-dlq` unless `dlq_name` says
 * otherwise, joined to it by a redrive policy.
 */
const SQS: InfraModuleDescription = {
  source: 'terraform-aws-modules/sqs/aws',
  variables: {
    create: 'true',
    use_name_prefix: 'false',
    fifo_queue: 'false',
    create_dlq: 'false',
    dlq_name: 'null',
    redrive_policy: '{}',
  },
  resources: {
    'aws_sqs_queue.this': {
      count: 'var.create ? 1 : 0',
      name: 'var.use_name_prefix ? null : var.fifo_queue ? "${trimsuffix(var.name, ".fifo")}.fifo" : var.name',
      redrive_policy: 'var.create_dlq || length(var.redrive_policy) == 0 ? null : jsonencode(var.redrive_policy)',
    },
    'aws_sqs_queue.dlq': {
      count: 'var.create && var.create_dlq ? 1 : 0',
      name: 'var.use_name_prefix ? null : var.fifo_queue ? "${trimsuffix(coalesce(var.dlq_name, "${var.name}-dlq"), ".fifo")}.fifo" : coalesce(var.dlq_name, "${var.name}-dlq")',
    },
    'aws_sqs_queue_redrive_policy.this': {
      count: 'var.create && var.create_dlq ? 1 : 0',
      queue_url: 'aws_sqs_queue.this[0].url',
      redrive_policy: 'jsonencode(merge({ deadLetterTargetArn = aws_sqs_queue.dlq[0].arn, maxReceiveCount = 5 }, var.redrive_policy))',
    },
  },
  outputs: {
    queue_id: 'try(aws_sqs_queue.this[0].url, null)',
    queue_url: 'try(aws_sqs_queue.this[0].url, null)',
    queue_arn: 'try(aws_sqs_queue.this[0].arn, null)',
    queue_name: 'try(aws_sqs_queue.this[0].name, null)',
    dead_letter_queue_id: 'try(aws_sqs_queue.dlq[0].url, null)',
    dead_letter_queue_url: 'try(aws_sqs_queue.dlq[0].url, null)',
    dead_letter_queue_arn: 'try(aws_sqs_queue.dlq[0].arn, null)',
    dead_letter_queue_name: 'try(aws_sqs_queue.dlq[0].name, null)',
  },
};

/** `terraform-aws-modules/sns/aws`: a topic, and its subscriptions keyed by name. */
const SNS: InfraModuleDescription = {
  source: 'terraform-aws-modules/sns/aws',
  variables: {
    create: 'true',
    use_name_prefix: 'false',
    fifo_topic: 'false',
    create_subscription: 'true',
    subscriptions: '{}',
  },
  resources: {
    'aws_sns_topic.this': {
      count: 'var.create ? 1 : 0',
      name: 'var.use_name_prefix ? null : var.fifo_topic ? "${trimsuffix(var.name, ".fifo")}.fifo" : var.name',
    },
    'aws_sns_topic_subscription.this': {
      for_each: 'var.create && var.create_subscription ? var.subscriptions : {}',
      topic_arn: 'aws_sns_topic.this[0].arn',
      protocol: 'each.value.protocol',
      endpoint: 'each.value.endpoint',
      filter_policy: 'try(each.value.filter_policy, null)',
      raw_message_delivery: 'try(each.value.raw_message_delivery, null)',
    },
  },
  outputs: {
    topic_arn: 'try(aws_sns_topic.this[0].arn, null)',
    topic_id: 'try(aws_sns_topic.this[0].id, null)',
    topic_name: 'try(aws_sns_topic.this[0].name, null)',
  },
};

export const MESSAGING_MODULES: readonly InfraModuleDescription[] = [EVENTBRIDGE, SQS, SNS];
