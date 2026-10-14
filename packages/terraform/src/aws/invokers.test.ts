import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/lambda-terraform-other-ways-in');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A repository of one Terraform file, read with nothing configured. */
const readHcl = (text: string): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-invokers-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

const FUNCTION = `
resource "aws_lambda_function" "f" {
  function_name = "library-f"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
}
`;

describe('other ways a function is run (fixtures/lambda-terraform-other-ways-in)', () => {
  const deployment = terraformReader.read({
    repoDir: join(FIXTURE, 'members'),
    config: parseConfig(JSON.parse(readFileSync(join(FIXTURE, 'flowatlas.config.json'), 'utf8'))),
  });
  const nameOf = (index: number): string | undefined => deployment.functions[index]?.name;

  it('reads a function URL and a load balancer rule as routes onto their functions', () => {
    expect(
      deployment.routes.map(
        (route) => `${route.method} ${route.path} ${route.target !== undefined && 'function' in route.target ? nameOf(route.target.function) : '-'}`,
      ),
    ).toEqual(['ALL /* library-members-card-lookup', 'POST /kiosk/checkout library-members-kiosk']);
    expect(deployment.routes[1]?.meta).toMatchObject({ by: 'load-balancer', hosts: ['kiosk.library.example'] });
    expect(deployment.routes[1]?.api).toBe('library-kiosk');
  });

  it('reads each step of a user pool and each action of an IoT rule as a delivery from a trigger', () => {
    expect(
      deployment.deliveries.map((delivery) => {
        const to = delivery.to;
        const target = to === undefined ? '-' : 'function' in to ? nameOf(to.function) : `${to.kind} ${to.name}`;
        return `${delivery.by} ${delivery.from.kind === 'trigger' ? delivery.from.key : delivery.from.kind} -> ${target}`;
      }),
    ).toEqual([
      'trigger cognito/library-members/pre_sign_up -> library-members-pre-sign-up',
      'trigger cognito/library-members/post_confirmation -> library-members-post-confirmation',
      'rule iot/library/shelves/+/weight -> library-members-shelf-sensor',
      'rule iot/library/shelves/+/weight -> queue library-shelf-readings',
    ]);
  });

  it('says which principal runs a function nothing reads, and nothing for one that is read', () => {
    const rows = deployment.rows.filter((row) => row.reason === 'invoker-not-read');
    expect(rows.map((row) => [row.level, row.meta?.['principal'], row.meta?.['function']])).toEqual([
      ['info', 'logs.amazonaws.com', 'library-members-log-digest'],
    ]);
  });
});

describe('other ways in, written differently', () => {
  it('reads a function URL on a function deployed elsewhere by its name, with IAM as a guard', () => {
    const deployment = readHcl(`
resource "aws_lambda_function_url" "u" {
  function_name      = "library-elsewhere"
  authorization_type = "AWS_IAM"
}
`);
    expect(deployment.routes.map((route) => [route.method, route.path, route.target, route.guards?.map((guard) => guard.label)])).toEqual([
      ['ALL', '/*', { name: 'library-elsewhere' }, ['AWS_IAM']],
    ]);
  });

  it('reads a listener forwarding by default, and leaves a target group of instances alone', () => {
    const deployment = readHcl(`${FUNCTION}
resource "aws_lb" "b" {
  name = "library-b"
}
resource "aws_lb_target_group" "fns" {
  target_type = "lambda"
}
resource "aws_lb_target_group" "hosts" {
  target_type = "instance"
}
resource "aws_lb_target_group_attachment" "f" {
  target_group_arn = aws_lb_target_group.fns.arn
  target_id        = aws_lambda_function.f.arn
}
resource "aws_lb_listener" "l" {
  load_balancer_arn = aws_lb.b.arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.fns.arn
  }
}
resource "aws_lb_listener_rule" "r" {
  listener_arn = aws_lb_listener.l.arn
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hosts.arn
  }
  condition {
    path_pattern {
      values = ["/shelves/*"]
    }
  }
}
`);
    expect(deployment.routes.map((route) => [route.method, route.path, route.api, route.target])).toEqual([['ALL', '/*', 'library-b', { function: 0 }]]);
  });

  it('reads a sender block of a user pool, and a rule whose statement names no topic is a row', () => {
    const deployment = readHcl(`${FUNCTION}
resource "aws_cognito_user_pool" "p" {
  name = "library-p"
  lambda_config {
    kms_key_id = "alias/library"
    custom_email_sender {
      lambda_arn     = aws_lambda_function.f.arn
      lambda_version = "V1_0"
    }
  }
}
resource "aws_iot_topic_rule" "r" {
  name = "r"
  sql  = "SELECT 1"
  lambda {
    function_arn = aws_lambda_function.f.arn
  }
}
`);
    expect(deployment.deliveries.map((delivery) => [delivery.from, delivery.to])).toEqual([
      [{ kind: 'trigger', service: 'cognito', key: 'cognito/library-p/custom_email_sender' }, { kind: 'function', function: 0 }],
    ]);
    expect(deployment.rows.map((row) => row.reason)).toContain('subscription-source-unread');
  });

  it('says nothing for a permission whose principal is read elsewhere', () => {
    const deployment = readHcl(`${FUNCTION}
resource "aws_lambda_permission" "s3" {
  function_name = aws_lambda_function.f.function_name
  principal     = "s3.amazonaws.com"
}
resource "aws_lambda_permission" "other" {
  function_name = aws_lambda_function.f.function_name
  principal     = "123456789012"
}
`);
    expect(deployment.rows.filter((row) => row.reason === 'invoker-not-read').map((row) => row.meta?.['principal'])).toEqual(['123456789012']);
  });
});
