import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cloudFormationReader } from './index.js';

const read = (files: Record<string, string>, infra?: { vars?: string[]; options?: Record<string, string> }): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cfn-deployers-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return cloudFormationReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda', ...(infra === undefined ? {} : { infra: { vars: infra.vars ?? [], ...(infra.options === undefined ? {} : { options: infra.options }) } }) } });
};

/** A plain template whose function is named by `Prefix` and `Stage`, and handed `Jobs` as `JOBS`. */
const TEMPLATE = [
  "AWSTemplateFormatVersion: '2010-09-09'",
  'Parameters:',
  '  Stage: { Type: String, Default: dev }',
  '  Prefix: { Type: String, Default: acme }',
  '  Jobs: { Type: String, Default: none }',
  'Resources:',
  '  Fn:',
  '    Type: AWS::Lambda::Function',
  '    Properties:',
  '      FunctionName: !Sub ${Prefix}-${Stage}-fn',
  '      Runtime: nodejs20.x',
  '      Handler: fn.handler',
  '      Code: src',
  '      Environment:',
  '        Variables:',
  '          JOBS: !Ref Jobs',
].join('\n');

const names = (deployment: Deployment): (string | undefined)[] => deployment.functions.map((fn) => fn.name);
const reasons = (deployment: Deployment): string[] => deployment.rows.map((row) => row.reason);

/** A sceptre project around the template, with the configuration files given under `config/`. */
const sceptre = (config: Record<string, string>, extra: Record<string, string> = {}): Record<string, string> => ({
  'templates/stack.yaml': TEMPLATE,
  'config/config.yaml': 'project_code: shop\nregion: eu-west-1\n',
  ...Object.fromEntries(Object.entries(config).map(([path, text]) => [`config/${path}`, text])),
  ...extra,
});

describe('what a sceptre stack inherits and resolves (P261)', () => {
  it('merges the parameters of every group above a stack with its own, the nearer winning', () => {
    const deployment = read(
      sceptre({
        'config.yaml': 'project_code: shop\nparameters:\n  Prefix: shop\n  Stage: base\n',
        'prod/config.yaml': 'parameters:\n  Stage: prod\n',
        'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Jobs: jobs\n',
        'live/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Stage: live\n',
      }),
      { options: { config_env: 'prod' } },
    );
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(names(read(sceptre({ 'config.yaml': 'project_code: shop\nparameters:\n  Prefix: shop\n', 'live/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Stage: live\n' })))).toEqual(['shop-live-fn']);
  });

  it("joins a stack's output and an external stack's as values their publishers export", () => {
    const deployment = read(
      sceptre({
        'prod/network.yaml': 'template_path: network.yaml\n',
        'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Jobs: !stack_output prod/network.yaml::JobsUrl\n  Prefix: !stack_output_external shop-billing::Prefix my-profile\n  Stage: prod\n',
      }),
    );
    expect(deployment.functions[0]?.environment?.['JOBS']).toMatchObject({ imported: 'stack:shop-prod-network#JobsUrl' });
    expect(reasons(deployment)).toContain('function-name-unread');
    expect(deployment.imports?.map((site) => site.key)).toEqual(['stack:shop-prod-network#JobsUrl']);
  });
});

describe('Jinja in a stack configuration, rendered where the files give the values (P261)', () => {
  const stack = "template_path: stack.yaml\nparameters:\n  Stage: '{{ var.stage }}'\n  Prefix: {{ environment_variable.PREFIX }}\n  Jobs: \"{{ var.jobs | default('shop-jobs') }}\"\n";

  it('renders var from the command that launches the stack, and environment_variable from its environment', () => {
    const deployment = read(
      sceptre(
        { 'prod/stack.yaml': stack },
        {
          'vars/prod.yaml': 'stage: prod\n',
          '.github/workflows/deploy.yml': [
            'on: push',
            'jobs:',
            '  deploy:',
            '    runs-on: ubuntu-latest',
            '    env:',
            '      PREFIX: shop',
            '    steps:',
            '      - name: launch',
            '        run: |',
            '          pip install sceptre',
            '          sceptre --var-file vars/prod.yaml launch -y prod',
          ].join('\n'),
        },
      ),
    );
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(deployment.functions[0]?.environment?.['JOBS']).toMatchObject({ text: 'shop-jobs' });
  });

  it('reads what nothing gives as not known, and two commands with values of their own as a row, of which a var file named chooses', () => {
    expect(names(read(sceptre({ 'prod/stack.yaml': stack })))).toEqual([undefined]);
    const files = sceptre(
      { 'prod/stack.yaml': stack },
      { 'vars/prod.yaml': 'stage: prod\n', 'vars/test.yaml': 'stage: test\n', Makefile: 'prod:\n\tPREFIX=shop sceptre --var-file=vars/prod.yaml launch prod/stack.yaml\ntest:\n\tPREFIX=shop sceptre --var-file=vars/test.yaml launch prod\n' },
    );
    const two = read(files);
    expect(reasons(two)).toContain('parameter-file-ambiguous');
    expect(names(read(files, { vars: ['vars/test.yaml'] }))).toEqual(['shop-test-fn']);
    expect(names(read(sceptre({ 'prod/stack.yaml': "template_path: stack.yaml\nparameters:\n  Stage: '{{ var.stage | wordwrap }}'\n  Prefix: shop\n" }, { 'vars/prod.yaml': 'stage: prod\n' }), { vars: ['vars/prod.yaml'] }))).toEqual([undefined]);
  });

  it('gives a stack the environment variable the step launching it sets', () => {
    const deployment = read(
      sceptre(
        { 'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Stage: prod\n  Prefix: !environment_variable PREFIX\n' },
        { 'scripts/launch.sh': '#!/bin/sh\nset -e\nexport PREFIX=shop\nsceptre launch -y prod\n' },
      ),
    );
    expect(names(deployment)).toEqual(['shop-prod-fn']);
  });
});

describe('a template sceptre renders with what the stack hands it (P261)', () => {
  const jinja = TEMPLATE.replace('FunctionName: !Sub ${Prefix}-${Stage}-fn', 'FunctionName: {{ sceptre_user_data.name }}');

  it('renders sceptre_user_data where it is plain', () => {
    const deployment = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml.j2\nsceptre_user_data:\n  name: shop-render-fn\n' }, { 'templates/stack.yaml.j2': jinja, 'templates/stack.yaml': '' }));
    expect(names(deployment)).toEqual(['shop-render-fn']);
  });

  it('reads none of a template with Jinja it does not render, and says so', () => {
    const deployment = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml.j2\nsceptre_user_data:\n  name: !stack_output prod/other.yaml::Name\n' }, { 'templates/stack.yaml.j2': jinja, 'templates/stack.yaml': '' }));
    expect(names(deployment)).toEqual([]);
    expect(deployment.rows.find((row) => row.reason === 'infra-file-unparsed')?.message).toContain('{{ sceptre_user_data.name }} is not rendered');
  });
});

describe('rain deploy in pipelines and scripts, with every option read (P261)', () => {
  const values = (deployment: Deployment): [string | undefined, unknown][] => deployment.functions.map((fn) => [fn.name, fn.environment?.['JOBS']]);

  it('reads a command in a GitHub workflow, its switches and its options with values, and --params written twice', () => {
    const deployment = read({
      'infra/stack.yaml': TEMPLATE,
      '.github/workflows/deploy.yml': 'jobs:\n  deploy:\n    steps:\n      - run: rain deploy infra/stack.yaml --node-style original -y --params Stage=prod --params "Prefix=shop,Jobs=shop-jobs"\n',
    });
    expect(values(deployment)).toEqual([['shop-prod-fn', expect.objectContaining({ text: 'shop-jobs' })]]);
  });

  it('follows a cd in a shell script, and reads a GitLab job', () => {
    expect(names(read({ 'infra/stack.yaml': TEMPLATE, 'scripts/deploy.sh': '#!/bin/sh\ncd infra && rain deploy stack.yaml shop-stack \\\n  --params Stage=prod,Prefix=shop\n' }))).toEqual(['shop-prod-fn']);
    expect(names(read({ 'stack.yaml': TEMPLATE, '.gitlab-ci.yml': 'stages: [deploy]\ndeploy:\n  stage: deploy\n  script:\n    - rain deploy stack.yaml --params Stage=prod --config stack-config.yaml\n', 'stack-config.yaml': 'Parameters:\n  Prefix: shop\n' }))).toEqual(['shop-prod-fn']);
  });

  it('reads a pipeline expression as a value not known, and an option it does not know before a word as no stack name', () => {
    const filled = read({ 'stack.yaml': TEMPLATE, '.github/workflows/deploy.yml': 'jobs:\n  deploy:\n    steps:\n      - run: rain deploy stack.yaml --params Stage=${{ inputs.stage }},Prefix=shop\n' });
    expect(names(filled)).toEqual([undefined]);
    const unsure = read({
      'stack.yaml': `${TEMPLATE}\nOutputs:\n  Where:\n    Value: here\n    Export: { Name: !Sub "\${AWS::StackName}-where" }\n`,
      '.github/workflows/deploy.yml': 'jobs:\n  deploy:\n    steps:\n      - run: rain deploy stack.yaml --whatever thing --params Stage=prod\n',
    });
    expect((unsure.exports ?? []).flatMap((exported) => exported.keys)).toEqual([]);
  });
});
