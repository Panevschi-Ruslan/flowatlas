import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type DeployedDelivery, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';
import { str } from '../eval/values.js';
import { readEventPattern } from './event-pattern.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

const readFixture = (path: string): Deployment => {
  const configPath = join(FIXTURES, path.split('/')[0] as string, 'flowatlas.config.json');
  return terraformReader.read({ repoDir: join(FIXTURES, path), config: parseConfig(JSON.parse(readFileSync(configPath, 'utf8'))) });
};

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A repository of one Terraform file, read with nothing configured. */
const readHcl = (text: string, files: Record<string, string> = {}): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-subscribers-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

/** A delivery as one line: what declares it, where from, where to. */
const line = (delivery: DeployedDelivery): string => {
  const from = delivery.from;
  const source =
    from.kind === 'bus'
      ? `bus ${from.name} ${JSON.stringify(Object.fromEntries(Object.entries(from.pattern.fields).sort(([a], [b]) => (a < b ? 1 : -1))))}`
      : from.kind === 'schedule'
        ? `schedule ${from.expression ?? '?'}`
        : from.kind === 'changes'
          ? `changes of ${from.of} ${from.name}`
          : from.kind === 'connection'
            ? `connection ${from.api} ${from.route}`
            : `${from.kind} ${from.name}`;
  const to = delivery.to;
  const target =
    to === undefined
      ? 'nothing read'
      : 'function' in to
        ? `function #${to.function}`
        : 'fields' in to && to.fields !== undefined
          ? `${to.kind} ${to.name} ${JSON.stringify(to.fields)}`
          : `${to.kind} ${to.name}`;
  return `${delivery.by} ${source} -> ${target}`;
};

describe('rules, targets and schedules (fixtures/eventbridge-terraform)', () => {
  const deployment = readFixture('eventbridge-terraform/circulation');

  it('reads each target as a delivery from its rule, exact patterns and a prefix alike', () => {
    expect(deployment.deliveries.map(line)).toEqual([
      'rule bus library {"source":[{"equals":"library.loans"}],"detail-type":[{"equals":"LoanCreated"}]} -> function #3',
      'rule bus library {"source":[{"equals":"library.holds"}],"detail-type":[{"equals":"HoldRequested"}]} -> function #3',
      'rule bus library {"source":[{"equals":"library.returns"}],"detail-type":[{"equals":"ItemReturned"}]} -> function #3',
      'rule bus library {"source":[{"prefix":"library."}],"detail-type":[{"equals":"LoanRenewed"}]} -> workflow loan-review',
      'schedule schedule cron(0 2 * * ? *) -> function #5',
      'rule bus default {"source":[{"equals":"aws.s3"}],"detail-type":[{"equals":"Object Created"}]} -> function #6',
    ]);
  });

  it('records a filter on the detail and does not match on it', () => {
    const review = deployment.deliveries[3];
    expect(review?.from.kind === 'bus' ? review.from.pattern.unmatched : undefined).toEqual({
      detail: { renewals: [{ numeric: ['>=', 3] }] },
    });
  });

  it('reads a route integrated with PutEvents as sending that event', () => {
    const hold = deployment.routes.find((route) => route.path === '/holds');
    expect(hold?.target).toEqual({
      sends: { kind: 'bus', name: 'library', fields: { source: 'library.holds', 'detail-type': 'HoldRequested' } },
    });
  });

  it('says nothing it could not read', () => {
    expect(deployment.rows).toEqual([]);
  });
});

describe('mappings, subscriptions and redrives (fixtures/sqs-sns-terraform)', () => {
  const deployment = readFixture('sqs-sns-terraform/returns');

  it('reads every subscriber, through the public queue module too', () => {
    expect(deployment.deliveries.map(line)).toEqual([
      'mapping queue library-returns -> function #2',
      'mapping queue library-restock -> function #3',
      'mapping queue library-reminders -> function #5',
      'mapping queue library-hold-requests -> function #6',
      'subscription topic library-item-returned -> queue library-restock',
      'subscription topic library-item-returned -> function #4',
      'subscription topic library-item-returned -> nothing read',
      'redrive queue library-returns -> queue library-returns-dlq',
      'redrive queue library-restock -> queue library-restock-dlq',
    ]);
  });

  it('keeps what a subscription filters on, and says which protocol it does not follow', () => {
    expect(deployment.deliveries[5]?.meta).toEqual({ protocol: 'lambda', unmatched: { filter_policy: '{"branchId":["central"]}' } });
    expect(deployment.deliveries[2]?.meta).toEqual({ unmatched: { filter: ['{"body":{"borrowerId":[{"exists":true}]}}'] } });
    expect(deployment.rows).toEqual([expect.objectContaining({ reason: 'subscription-target-unread', level: 'info' })]);
  });

  it('reads each function\'s environment three ways: as written, as text, as what it names', () => {
    const byName = new Map(deployment.functions.map((fn) => [fn.name, fn.environment]));
    expect(byName.get('library-record-return')).toEqual({
      RETURNS_QUEUE_URL: { written: 'aws_sqs_queue.returns.url', names: { kind: 'queue', name: 'library-returns' } },
    });
    expect(byName.get('library-bulk-return')).toEqual({ BATCH_SIZE: { written: '"25"', text: '25' } });
    expect(byName.get('library-restock')).toEqual({});
    const audit = byName.get('library-process-return')?.['AUDIT_QUEUE_URL'];
    expect(audit?.unread).toEqual(
      expect.objectContaining({ variable: 'audit_queue_url', files: expect.objectContaining({ 'infra/env/dev.tfvars': expect.any(String) }) }),
    );
  });

  it('reads a REST route sending straight to a queue, its account unread and its queue named', () => {
    expect(deployment.routes.find((route) => route.path === '/holds')?.target).toEqual({ sends: { kind: 'queue', name: 'library-hold-requests' } });
  });
});

describe('subscribers in other repositories (fixtures/multi-repo-events)', () => {
  it('reads a rule of the public EventBridge module, the rule named with its postfix', () => {
    const deployment = readFixture('multi-repo-events/platform-events');
    expect(deployment.deliveries.map(line)).toEqual([
      'rule bus library {"source":[{"prefix":"library."}]} -> queue library-audit',
    ]);
    expect(deployment.deliveries[0]?.name).toBe('audit-rule');
  });

  it('names a target by the ARN written out, region and account unread', () => {
    const deployment = readFixture('multi-repo-events/routing');
    expect(deployment.deliveries.map(line)).toEqual([
      'rule bus library {"source":[{"equals":"library.loans"}],"detail-type":[{"equals":"LoanCreated"}]} -> function library-welcome-borrower',
      'rule bus library {"source":[{"equals":"library.loans"}],"detail-type":[{"anythingBut":[{"equals":"LoanCreated"}]}]} -> queue library-loan-digest',
      'rule bus library {"source":[{"prefix":"partner."}]} -> queue library-loan-digest',
    ]);
  });
});

describe('what the fixtures do not cover', () => {
  it('reads a pipe from a table\'s stream to a bus, with the event it puts', () => {
    const deployment = readHcl(`
resource "aws_dynamodb_table" "loans" {
  name             = "library-loans"
  stream_enabled   = true
}
resource "aws_cloudwatch_event_bus" "library" { name = "library" }
resource "aws_pipes_pipe" "loan_changes" {
  name   = "library-loan-changes"
  source = aws_dynamodb_table.loans.stream_arn
  target = aws_cloudwatch_event_bus.library.arn
  target_parameters {
    eventbridge_event_bus_parameters {
      source      = "library.loans"
      detail_type = "LoanChanged"
    }
  }
}`);
    expect(deployment.deliveries.map(line)).toEqual([
      'pipe changes of table library-loans -> bus library {"source":"library.loans","detail-type":"LoanChanged"}',
    ]);
  });

  it('reads a mapping from a stream, and a scheduler schedule with its target block', () => {
    const deployment = readHcl(`
resource "aws_kinesis_stream" "scans" { name = "library-scans" }
resource "aws_lambda_function" "count" {
  function_name = "library-count-scans"
  handler       = "index.handler"
}
resource "aws_lambda_event_source_mapping" "scans" {
  event_source_arn  = aws_kinesis_stream.scans.arn
  function_name     = aws_lambda_function.count.arn
  starting_position = "LATEST"
}
resource "aws_scheduler_schedule" "weekly" {
  name                = "library-weekly-digest"
  schedule_expression = "rate(7 days)"
  state               = "DISABLED"
  target {
    arn      = "arn:aws:lambda:eu-west-1:111122223333:function:library-digest"
    role_arn = "arn:aws:iam::111122223333:role/scheduler"
  }
}`);
    expect(deployment.deliveries.map(line)).toEqual([
      'schedule schedule rate(7 days) -> function library-digest',
      'mapping changes of stream library-scans -> function #0',
    ]);
    expect(deployment.deliveries[0]?.meta).toEqual({ disabled: true });
  });

  it('reads the integrations that send: an action with the queue in a parameter, a template putting an event, an HTTP API queue', () => {
    const deployment = readHcl(`
resource "aws_sqs_queue" "requests" { name = "library-requests" }
resource "aws_api_gateway_rest_api" "api" { name = "library" }
resource "aws_api_gateway_resource" "requests" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "requests"
}
resource "aws_api_gateway_method" "post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.requests.id
  http_method   = "POST"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "post" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.requests.id
  http_method = "POST"
  type        = "AWS"
  uri         = "arn:aws:apigateway:eu-west-1:sqs:action/SendMessage"
  request_parameters = {
    "integration.request.querystring.QueueUrl" = "'https://sqs.eu-west-1.amazonaws.com/111122223333/library-requests'"
  }
}
resource "aws_api_gateway_resource" "events" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "events"
}
resource "aws_api_gateway_method" "put" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.events.id
  http_method   = "PUT"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "put" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.events.id
  http_method = "PUT"
  type        = "AWS"
  uri         = "arn:aws:apigateway:eu-west-1:events:action/PutEvents"
  request_templates = {
    "application/json" = <<-VTL
      { "Entries": [{ "Source": "library.kiosk", "DetailType": "KioskCheckout", "Detail": "$util.escapeJavaScript($input.body)" }] }
    VTL
  }
}
resource "aws_apigatewayv2_api" "http" {
  name          = "library-http"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "queue" {
  api_id              = aws_apigatewayv2_api.http.id
  integration_type    = "AWS_PROXY"
  integration_subtype = "SQS-SendMessage"
  request_parameters = {
    QueueUrl    = aws_sqs_queue.requests.url
    MessageBody = "$request.body"
  }
}
resource "aws_apigatewayv2_route" "queue" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /queue"
  target    = "integrations/\${aws_apigatewayv2_integration.queue.id}"
}
resource "aws_apigatewayv2_integration" "dynamic" {
  api_id              = aws_apigatewayv2_api.http.id
  integration_type    = "AWS_PROXY"
  integration_subtype = "EventBridge-PutEvents"
  request_parameters = {
    Source     = "library.kiosk"
    DetailType = "$request.body.type"
    Detail     = "$request.body"
  }
}
resource "aws_apigatewayv2_route" "dynamic" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /dynamic"
  target    = "integrations/\${aws_apigatewayv2_integration.dynamic.id}"
}`);
    const targets = Object.fromEntries(deployment.routes.map((route) => [`${route.method} ${route.path}`, route.target]));
    expect(targets).toEqual({
      'POST /requests': { sends: { kind: 'queue', name: 'library-requests' } },
      'PUT /events': { sends: { kind: 'bus', name: 'default', fields: { source: 'library.kiosk', 'detail-type': 'KioskCheckout' } } },
      'POST /queue': { sends: { kind: 'queue', name: 'library-requests' } },
      'POST /dynamic': undefined,
    });
    expect(deployment.rows).toEqual([
      expect.objectContaining({ reason: 'route-target-unread', message: expect.stringContaining('DetailType is "$request.body.type", filled from the request') }),
    ]);
  });

  it('reads a bus whose name two variable files dispute as a row naming both, and draws nothing', () => {
    const deployment = readHcl(
      `
variable "bus" { type = string }
resource "aws_cloudwatch_event_rule" "r" {
  name           = "r"
  event_bus_name = var.bus
  event_pattern  = jsonencode({ source = ["library.loans"], "detail-type" = ["LoanCreated"] })
}
resource "aws_cloudwatch_event_target" "t" {
  rule           = aws_cloudwatch_event_rule.r.name
  event_bus_name = var.bus
  arn            = "arn:aws:sqs:eu-west-1:111122223333:library-x"
}`,
      { 'dev.tfvars': 'bus = "library-dev"\n', 'prod.tfvars': 'bus = "library"\n' },
    );
    expect(deployment.deliveries).toEqual([]);
    expect(deployment.rows).toEqual([
      expect.objectContaining({ reason: 'subscription-source-unread', meta: expect.objectContaining({ because: 'variable-disputed', variable: 'bus' }) }),
    ]);
  });
});

describe('event patterns', () => {
  it('reads each content filter, and keeps one it does not evaluate as written', () => {
    const pattern = readEventPattern(
      str(
        JSON.stringify({
          source: [{ prefix: 'library.' }, 'partner.catalogue'],
          'detail-type': [{ 'anything-but': ['LoanCreated', { prefix: 'Test' }] }, { suffix: 'Returned' }, { 'equals-ignore-case': 'holdplaced' }, { wildcard: 'Loan*Due' }, { exists: true }, { numeric: ['>', 1] }],
          account: ['111122223333'],
          detail: { loanId: [{ exists: true }] },
          $or: [{ source: ['a'] }],
        }),
      ),
    );
    expect(pattern).toEqual({
      fields: {
        source: [{ prefix: 'library.' }, { equals: 'partner.catalogue' }],
        'detail-type': [
          { anythingBut: [{ equals: 'LoanCreated' }, { prefix: 'Test' }] },
          { suffix: 'Returned' },
          { equalsIgnoreCase: 'holdplaced' },
          { wildcard: 'Loan*Due' },
          { exists: true },
          { unread: '{"numeric":[">",1]}' },
        ],
        account: [{ equals: '111122223333' }],
      },
      unmatched: { detail: { loanId: [{ exists: true }] }, $or: [{ source: ['a'] }] },
    });
  });

  it('says why a pattern is not read', () => {
    expect(readEventPattern(str('{ not json'))).toEqual({ reason: 'not-json', text: 'event_pattern is not JSON' });
    expect(readEventPattern(str('[1]'))).toEqual({ reason: 'not-an-object', text: 'event_pattern is not a JSON object' });
  });
});
