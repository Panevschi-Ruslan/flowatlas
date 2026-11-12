import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cloudFormationReader } from './index.js';
import { parameterValues } from './parameter-files.js';

const repository = (files: Record<string, string>): string => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cfn-shared-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return repoDir;
};

const read = (files: Record<string, string>, infra?: { vars?: string[]; options?: Record<string, string> }): Deployment => {
  const repoDir = repository(files);
  return cloudFormationReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda', ...(infra === undefined ? {} : { infra: { vars: infra.vars ?? [], ...(infra.options === undefined ? {} : { options: infra.options }) } }) } });
};

/** A plain template with the parameters `Stage` and `Prefix`, a function named by both, and the resources given. */
const template = (resources = ''): string =>
  [
    "AWSTemplateFormatVersion: '2010-09-09'",
    'Parameters:',
    '  Stage: { Type: String, Default: dev }',
    '  Prefix: { Type: String, Default: acme }',
    'Resources:',
    '  Fn:',
    '    Type: AWS::Lambda::Function',
    '    Properties:',
    '      FunctionName: !Sub ${Prefix}-${Stage}-fn',
    '      Runtime: nodejs20.x',
    '      Handler: fn.handler',
    '      Code: src',
    ...resources.split('\n').filter((line) => line !== '').map((line) => `  ${line}`),
  ].join('\n');

const names = (deployment: Deployment): (string | undefined)[] => deployment.functions.map((fn) => fn.name);
const reasons = (deployment: Deployment): string[] => deployment.rows.map((row) => row.reason);

describe('parameter files written as YAML (P259)', () => {
  it('reads the three documents written as YAML, beside the template under its name', () => {
    expect(names(read({ 'stack.yaml': template(), 'stack.parameters.yaml': '- ParameterKey: Stage\n  ParameterValue: prod\n' }))).toEqual(['acme-prod-fn']);
    expect(names(read({ 'stack.yaml': template(), 'stack-params.yml': '- Stage=prod\n- Prefix=shop\n' }))).toEqual(['shop-prod-fn']);
    expect(names(read({ 'stack.yaml': template(), 'stack.config.yaml': 'Parameters:\n  Stage: prod\nTags:\n  team: shop\n' }))).toEqual(['acme-prod-fn']);
  });

  it('does not take a template, whose parameters are objects of a type and a default, for a file of values', () => {
    expect(parameterValues({ Parameters: { Stage: { Type: 'String', Default: 'dev' } } })).toBeUndefined();
  });

  it('reads one the configuration names, and says a YAML file that does not read', () => {
    expect(names(read({ 'stack.yaml': template(), 'env/prod.yaml': 'Parameters: { Stage: prod }\n' }, { vars: ['env/prod.yaml'] }))).toEqual(['acme-prod-fn']);
    const broken = read({ 'stack.yaml': template(), 'samconfig.toml': 'version = 0.1\n[default.deploy.parameters]\ntemplate_file = "stack.yaml"\nparameter_overrides = "file://prod.yaml"\n', 'prod.yaml': 'Parameters: [unclosed\n' });
    expect(broken.rows.find((row) => row.reason === 'infra-file-unparsed')?.message).toMatch(/prod\.yaml is not YAML/);
  });
});

/** A sceptre project around the template, with a stack configuration per group. */
const sceptre = (stacks: Record<string, string>, extra: Record<string, string> = {}): Record<string, string> => ({
  'templates/stack.yaml': template(),
  'config/config.yaml': 'project_code: shop\nregion: eu-west-1\n',
  ...Object.fromEntries(Object.entries(stacks).map(([path, text]) => [`config/${path}`, text])),
  ...extra,
});

describe('a template sceptre deploys (P259)', () => {
  it('is read with the values and the stack name of the one stack that names it', () => {
    const deployment = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Stage: prod\n  Prefix: shop\n' }));
    expect(names(deployment)).toEqual(['shop-prod-fn']);
  });

  it('gives the stack its project code and path as its name, and its group region', () => {
    const deployment = read(
      sceptre(
        { 'prod/stack.yaml': 'template_path: stack.yaml\nparameters: { Stage: prod }\n', 'prod/config.yaml': 'region: us-west-2\n' },
        { 'templates/stack.yaml': `${template()}\nOutputs:\n  Where:\n    Value: here\n    Export: { Name: !Sub "\${AWS::StackName}-\${AWS::Region}" }\n` },
      ),
    );
    expect((deployment.exports ?? []).flatMap((exported) => exported.keys)).toEqual(['export:shop-prod-stack-us-west-2', 'stack:shop-prod-stack#Where']);
  });

  it('chooses the group config_env names, and says two stacks nothing chose between', () => {
    const stacks = { 'prod/stack.yaml': 'template_path: stack.yaml\nparameters: { Stage: prod }\n', 'dev/stack.yaml': 'template: { path: stack.yaml }\nparameters: { Stage: test }\n' };
    expect(names(read(sceptre(stacks), { options: { config_env: 'dev' } }))).toEqual(['acme-test-fn']);
    expect(names(read(sceptre(stacks), { vars: ['config/prod/stack.yaml'] }))).toEqual(['acme-prod-fn']);
    const neither = read(sceptre(stacks));
    expect(names(neither)).toEqual(['acme-dev-fn']);
    expect(neither.rows.find((row) => row.reason === 'parameter-file-ambiguous')?.message).toMatch(/sceptre dev\/stack .*sceptre prod\/stack/);
  });

  it('reads a resolver or a Jinja expression as a value not known, never as the default', () => {
    const resolved = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Stage: !stack_output network.yaml::Stage\n' }));
    expect(names(resolved)).toEqual([undefined]);
    expect(reasons(resolved)).toContain('function-name-unread');
    const jinja = read(sceptre({ 'prod/stack.yaml': "template_path: stack.yaml\nparameters:\n  Stage: '{{ var.stage }}'\n" }));
    expect(names(jinja)).toEqual([undefined]);
  });
});

describe('a template rain deploys (P259)', () => {
  it('is read with the command\'s --params over its --config, under the stack it names', () => {
    const deployment = read({
      'stack.yaml': template(),
      'stack-config.yaml': 'Parameters:\n  Prefix: shop\n  Stage: dev\n',
      'package.json': JSON.stringify({ scripts: { deploy: 'rain deploy stack.yaml shop-stack --params Stage=prod --config stack-config.yaml -y' } }),
    });
    expect(names(deployment)).toEqual(['shop-prod-fn']);
  });

  it('reads a Makefile recipe, a shell variable as a value not known, and two commands as a row', () => {
    const make = read({ 'infra/stack.yaml': template(), Makefile: 'deploy:\n\train deploy infra/stack.yaml --params Stage=prod,Prefix=$(PREFIX)\n' });
    expect(names(make)).toEqual([undefined]);
    const two = read({ 'stack.yaml': template(), 'package.json': JSON.stringify({ scripts: { prod: 'rain deploy stack.yaml --params Stage=prod', dev: 'rain deploy stack.yaml --params Stage=dev' } }) });
    expect(names(two)).toEqual(['acme-dev-fn']);
    expect(reasons(two)).toContain('parameter-file-ambiguous');
  });
});

describe('rule targets and subscription endpoints of an import (P259)', () => {
  it('reads a rule target as each kind it may be, and an endpoint as what the protocol says', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'Rule:',
          '  Type: AWS::Events::Rule',
          '  Properties:',
          '    EventPattern: { source: [shop] }',
          '    Targets:',
          '      - { Id: a, Arn: !ImportValue shop-target }',
          'Topic:',
          '  Type: AWS::SNS::Topic',
          '  Properties: { TopicName: shop-events }',
          'Sub:',
          '  Type: AWS::SNS::Subscription',
          '  Properties: { TopicArn: !Ref Topic, Protocol: sqs, Endpoint: !ImportValue shop-jobs }',
        ].join('\n'),
      ),
    });
    const target = 'stack.Resources.Rule.Targets[0]';
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.to])).toEqual([
      ...['function', 'queue', 'topic', 'bus', 'workflow'].map((kind) => [alternativeAddress(target, kind), { kind, name: importedName('export:shop-target') }]),
      ['stack.Resources.Sub', { kind: 'queue', name: importedName('export:shop-jobs') }],
    ]);
    expect(deployment.imports?.map((site) => [site.key, site.kinds, site.alternatives?.length])).toEqual([
      ['export:shop-target', ['function', 'queue', 'topic', 'bus', 'workflow'], 5],
      ['export:shop-jobs', ['queue'], undefined],
    ]);
    expect(reasons(deployment)).not.toContain('subscription-target-unread');
  });
});

describe('two imports in one string (P259)', () => {
  it('reads a name built of an import and text, an import outside the name aside, as the name to finish', () => {
    const deployment = read(
      {
        'stack.yaml': template().replace(
          '      Code: src',
          [
            '      Code: src',
            '      Environment:',
            '        Variables:',
            '          AUDIT: !Sub',
            '            - https://sqs.${AWS::Region}.amazonaws.com/${Account}/${Prefix}-audit',
            '            - { Account: !ImportValue shop-account, Prefix: !ImportValue shop-prefix }',
            "          ALERTS: !Join ['', ['arn:aws:sns:eu-west-1:', !ImportValue shop-account, ':', !ImportValue shop-alerts]]",
          ].join('\n'),
        ),
      },
      { options: { region: 'eu-west-1' } },
    );
    const environment = deployment.functions[0]?.environment ?? {};
    const built = `${importedName('export:shop-prefix')}-audit`;
    expect(environment['AUDIT']?.names).toEqual({ kind: 'queue', name: built });
    expect(environment['ALERTS']?.names).toEqual({ kind: 'topic', name: importedName('export:shop-alerts') });
    expect(deployment.imports?.map((site) => [site.key, site.as, site.within])).toEqual([
      ['export:shop-alerts', 'name', undefined],
      ['export:shop-prefix', 'name', built],
    ]);
  });
});
