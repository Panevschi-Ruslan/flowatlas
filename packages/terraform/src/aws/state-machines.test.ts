import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig, type DeployedWorkflow, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-sfn-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const read = (repoDir: string): Deployment => terraformReader.read({ repoDir, config: parseConfig({}) });

const only = (deployment: Deployment): DeployedWorkflow => {
  expect(deployment.workflows).toHaveLength(1);
  return deployment.workflows[0] as DeployedWorkflow;
};

/** The definition as the reader of definitions would get it, as JSON. */
const valueOf = (workflow: DeployedWorkflow): unknown => {
  const definition = workflow.definition;
  if (definition === undefined) return undefined;
  return definition.kind === 'value' ? definition.value : JSON.parse(definition.text);
};

describe('the state machines of the stepfunctions-terraform fixture', () => {
  const configPath = join(FIXTURES, 'stepfunctions-terraform', 'flowatlas.config.json');
  const deployment = terraformReader.read({
    repoDir: join(FIXTURES, 'stepfunctions-terraform'),
    config: parseConfig(JSON.parse(readFileSync(configPath, 'utf8'))),
  });
  const byName = new Map(deployment.workflows.map((workflow) => [workflow.name, workflow]));

  it('names each workflow by the name it is deployed under, evaluated', () => {
    expect([...byName.keys()].sort()).toEqual([
      'lending-hold-expiry',
      'lending-loan-approval',
      'lending-loan-renewal',
      'lending-overdue-sweep',
    ]);
  });

  it('reads each definition the way it is written, through local and described modules', () => {
    const how = deployment.workflows
      .map((workflow) => [workflow.name, workflow.meta?.['definitionFrom'], workflow.definition?.file, workflow.address])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(how).toEqual([
      ['lending-hold-expiry', 'heredoc', 'infra/workflows.tf', 'aws_sfn_state_machine.hold_expiry'],
      ['lending-loan-approval', 'file', 'statemachine/loan-approval.asl.json', 'aws_sfn_state_machine.loan_approval'],
      ['lending-loan-renewal', 'templatefile', 'statemachine/loan-renewal.asl.json', 'module.loan_renewal.aws_sfn_state_machine.this[0]'],
      ['lending-overdue-sweep', 'jsonencode', 'infra/workflows.tf', 'module.overdue_sweep.aws_sfn_state_machine.this'],
    ]);
  });

  it('fills a template variable that holds a reference with what it addresses, and leaves an unsettled one unfilled', () => {
    const renewal = byName.get('lending-loan-renewal') as DeployedWorkflow;
    expect(renewal.fill('check_borrower_arn')).toBe('arn:aws:lambda:::function:lending-check-borrower');
    // Through the described lambda module's output.
    expect(renewal.fill('assess_late_fee_arn')).toBe('arn:aws:lambda:::function:lending-assess-late-fee');
    expect(renewal.fill('loan_approval_arn')).toBe('arn:aws:states:::stateMachine:lending-loan-approval');
    expect(renewal.fill('branch_policy_arn')).toBeUndefined();
    // A variable that is text is written into the definition, not left for later.
    expect(JSON.stringify(valueOf(renewal))).toContain('"TableName":"lending-loans"');
  });

  it('places a heredoc on the lines of the file it is written in', () => {
    const expiry = byName.get('lending-hold-expiry') as DeployedWorkflow;
    expect(expiry.definition).toMatchObject({ kind: 'text', firstLine: 82 });
    expect(expiry.fill('aws_lambda_function.release_hold.arn')).toBe('arn:aws:lambda:::function:lending-release-hold');
    expect(JSON.stringify(valueOf(expiry))).toContain('"TableName":"lending-holds"');
  });

  it('places each member of a value built with jsonencode where it is written', () => {
    const sweep = byName.get('lending-overdue-sweep') as DeployedWorkflow;
    const definition = sweep.definition;
    if (definition?.kind !== 'value') throw new Error('expected a value');
    expect(definition.at(['States', 'FindOverdueLoans'])).toEqual({ line: 42, column: 7 });
    // A member written as an expression is placed where its nearest written parent is.
    expect(definition.at(['States', 'RemindBorrowers', 'ItemProcessor', 'States', 'SendReminder', 'Resource'])?.line).toBe(64);
    expect(sweep.fill('aws_lambda_function.send_overdue_reminder.arn')).toBe('arn:aws:lambda:::function:lending-send-overdue-reminder');
  });

  it('raises no row of its own when every name and every definition is read', () => {
    expect(deployment.rows.filter((row) => row.reason.startsWith('workflow-'))).toEqual([]);
  });

  it('lists the definitions the configuration loads, so a build watches them', () => {
    const files = terraformReader.files(join(FIXTURES, 'stepfunctions-terraform'), { config: parseConfig({}) });
    expect(files.filter((file) => !/\.tf$/.test(file))).toEqual([
      'statemachine/loan-approval.asl.json',
      'statemachine/loan-renewal.asl.json',
    ]);
  });
});

describe('a definition written in the less common ways', () => {
  const FUNCTION = `
resource "aws_lambda_function" "renew" {
  function_name = "renew-loan"
  handler       = "index.handler"
}
`;

  it('lists a definition loaded through a local, by the path the evaluator was handed', () => {
    const dir = repo({
      'infra/main.tf': `
locals {
  definitions = "\${path.module}/../statemachine"
}

resource "aws_sfn_state_machine" "renew" {
  name       = "renew"
  role_arn   = "arn:aws:iam::000000000000:role/workflows"
  definition = file("\${local.definitions}/renew.asl.json")
}
`,
      'statemachine/renew.asl.json': JSON.stringify({ StartAt: 'Done', States: { Done: { Type: 'Succeed' } } }),
    });
    expect(terraformReader.files(dir, { config: parseConfig({}) })).toEqual(['infra/main.tf', 'statemachine/renew.asl.json']);
  });

  it('reads a template whose directives the files settle', () => {
    const workflow = only(
      read(
        repo({
          'main.tf': `${FUNCTION}
resource "aws_sfn_state_machine" "renewals" {
  name       = "renewals"
  definition = templatefile("renewals.json.tftpl", { states = ["A", "B"], fn = aws_lambda_function.renew.arn })
}
`,
          'renewals.json.tftpl': `{"StartAt": "A", "States": {%{ for s in states ~}
"\${s}": {"Type": "Task", "Resource": "\${fn}", "End": true},
%{ endfor ~}
"Z": {"Type": "Succeed"}}}
`,
        }),
      ),
    );
    expect(Object.keys((valueOf(workflow) as { States: object }).States)).toEqual(['A', 'B', 'Z']);
    expect(workflow.fill('fn')).toBe('arn:aws:lambda:::function:renew-loan');
  });

  it('does not read a template whose directive depends on what the files do not settle, and says why', () => {
    const deployment = read(
      repo({
        'main.tf': `
variable "steps" {}
resource "aws_sfn_state_machine" "renewals" {
  name       = "renewals"
  definition = templatefile("renewals.json.tftpl", { steps = var.steps })
}
`,
        'renewals.json.tftpl': `{"StartAt": "A", "States": {%{ for s in steps }"\${s}": {"Type": "Pass", "End": true}%{ endfor }}}`,
      }),
    );
    expect(only(deployment).definition).toBeUndefined();
    expect(deployment.rows).toEqual([
      expect.objectContaining({ reason: 'workflow-definition-not-loaded', symbol: 'aws_sfn_state_machine.renewals' }),
    ]);
  });

  it('reads a YAML file decoded and encoded again as that file', () => {
    const workflow = only(
      read(
        repo({
          'main.tf': `
resource "aws_sfn_state_machine" "returns" {
  name       = "returns"
  definition = jsonencode(yamldecode(file("\${path.module}/returns.asl.yaml")))
}
`,
          'returns.asl.yaml': 'StartAt: Done\nStates:\n  Done:\n    Type: Succeed\n',
        }),
      ),
    );
    expect(workflow.definition).toMatchObject({ kind: 'text', file: 'returns.asl.yaml', format: 'yaml' });
    expect(workflow.meta?.['definitionFrom']).toBe('file through yamldecode');
  });

  it('keeps a reference written as JSON inside a heredoc as a quoted placeholder', () => {
    const workflow = only(
      read(
        repo({
          'main.tf': `${FUNCTION}
resource "aws_sfn_state_machine" "renewals" {
  name       = "renewals"
  definition = <<-EOT
    {"StartAt": "Renew", "States": {"Renew": {"Type": "Task", "Resource": \${jsonencode(aws_lambda_function.renew.arn)}, "End": true}}}
  EOT
}
`,
        }),
      ),
    );
    expect(valueOf(workflow)).toMatchObject({ States: { Renew: { Resource: '${aws_lambda_function.renew.arn}' } } });
    expect(workflow.fill('aws_lambda_function.renew.arn')).toBe('arn:aws:lambda:::function:renew-loan');
  });

  it('fills an alias with the function it qualifies', () => {
    const workflow = only(
      read(
        repo({
          'main.tf': `${FUNCTION}
resource "aws_lambda_alias" "live" {
  name          = "live"
  function_name = aws_lambda_function.renew.arn
}
resource "aws_sfn_state_machine" "renewals" {
  name       = "renewals"
  definition = jsonencode({ StartAt = "Renew", States = { Renew = { Type = "Task", Resource = aws_lambda_alias.live.arn, End = true } } })
}
`,
        }),
      ),
    );
    expect(workflow.fill('aws_lambda_alias.live.arn')).toBe('arn:aws:lambda:::function:renew-loan:live');
  });

  it('draws a workflow whose name is not read with no name, and says what to set', () => {
    const deployment = read(
      repo({
        'main.tf': `
variable "stage" {}
resource "aws_sfn_state_machine" "renewals" {
  name       = "renewals-\${var.stage}"
  definition = jsonencode({ StartAt = "Done", States = { Done = { Type = "Succeed" } } })
}
`,
      }),
    );
    const workflow = only(deployment);
    expect(workflow.name).toBeUndefined();
    expect(workflow.definition).toBeDefined();
    expect(deployment.rows).toEqual([
      expect.objectContaining({ reason: 'workflow-name-unread', meta: expect.objectContaining({ variable: 'stage' }) }),
    ]);
  });
});
