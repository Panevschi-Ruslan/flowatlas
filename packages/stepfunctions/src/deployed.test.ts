import { describe, expect, it } from 'vitest';
import { REACHES_META, type DeployedWorkflow } from '@flowatlas/core';
import { drawDeployedWorkflow } from './deployed.js';

const TEMPLATE = `{
  "StartAt": "CheckBorrower",
  "States": {
    "CheckBorrower": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "\${check_arn}" },
      "Next": "ApplyPolicy"
    },
    "ApplyPolicy": {
      "Type": "Task",
      "Resource": "\${policy_arn}",
      "End": true
    }
  }
}`;

const FILLED: Readonly<Record<string, string>> = { check_arn: 'arn:aws:lambda:::function:lending-check-borrower' };

const workflow = (over: Partial<DeployedWorkflow> = {}): DeployedWorkflow => ({
  file: 'infra/workflows.tf',
  line: 12,
  name: 'lending-renewals',
  address: 'aws_sfn_state_machine.renewals',
  // A heredoc whose marker is on line 14 of the file: its text starts on 15.
  definition: { kind: 'text', file: 'infra/workflows.tf', text: TEMPLATE, format: 'json', firstLine: 15 },
  fill: (placeholder) => FILLED[placeholder],
  meta: { declaredAs: 'aws_sfn_state_machine.renewals' },
  ...over,
});

describe('a workflow a deployment hands over', () => {
  it('is drawn under its deployed name, on the lines of the file the definition is written in', () => {
    const fragment = drawDeployedWorkflow(workflow(), 'lending');
    const entry = fragment.nodes.find((node) => node.type === 'entry');
    expect(entry).toMatchObject({
      id: 'entry:lending:workflow:lending-renewals',
      file: 'infra/workflows.tf',
      line: 15,
      meta: expect.objectContaining({ nameFrom: 'deployment', declaredAs: 'aws_sfn_state_machine.renewals', declaredIn: 'infra/workflows.tf:12' }),
    });
    expect(entry?.meta?.['nameConfidence']).toBeUndefined();
    const check = fragment.nodes.find((node) => node.id.endsWith('/CheckBorrower'));
    expect(check?.line).toBe(18);
  });

  it('reaches what a filled placeholder names, and rows the step whose placeholder the deployment leaves empty', () => {
    const fragment = drawDeployedWorkflow(workflow(), 'lending');
    const check = fragment.nodes.find((node) => node.id.endsWith('/CheckBorrower'));
    expect(check?.meta?.[REACHES_META]).toEqual(['invoke:lending-check-borrower']);
    expect(fragment.rows).toEqual([
      expect.objectContaining({
        reason: 'workflow-template-unbound',
        line: 24,
        symbol: 'lending#infra/workflows.tf:lending-renewals/ApplyPolicy',
      }),
    ]);
  });

  it('is keyed by its declaration when its name was not read, so nothing joins to it', () => {
    const fragment = drawDeployedWorkflow(workflow({ name: undefined }), 'lending');
    const entry = fragment.nodes.find((node) => node.type === 'entry');
    expect(entry?.id).toBe('entry:lending:workflow:${…}@aws_sfn_state_machine.renewals');
    expect(entry?.meta).toMatchObject({ nameRead: false });
  });

  it('is one row at the line the text stops making sense, in the file it is written in', () => {
    const broken = workflow({
      definition: { kind: 'text', file: 'infra/workflows.tf', text: '{\n  "StartAt": "A",,\n}', format: 'json', firstLine: 15 },
    });
    expect(drawDeployedWorkflow(broken, 'lending')).toEqual({
      nodes: [],
      edges: [],
      rows: [expect.objectContaining({ reason: 'workflow-definition-unreadable', file: 'infra/workflows.tf', line: 16 })],
    });
  });

  it('is nothing of its own when the deployment could not read the definition, whose row is the deployment’s', () => {
    expect(drawDeployedWorkflow(workflow({ definition: undefined }), 'lending')).toEqual({ nodes: [], edges: [], rows: [] });
  });
});
