import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cloudFormationReader } from './index.js';
import { lookupIn, renderJinja } from './jinja.js';

const read = (files: Record<string, string>, infra?: { vars?: string[]; options?: Record<string, string> }): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cfn-sceptre-'));
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
const jobs = (deployment: Deployment): unknown => deployment.functions[0]?.environment?.['JOBS'];

/** A sceptre project around the template, with the configuration files given under `config/`. */
const sceptre = (config: Record<string, string>, extra: Record<string, string> = {}): Record<string, string> => ({
  'templates/stack.yaml': TEMPLATE,
  'config/config.yaml': 'project_code: shop\nregion: eu-west-1\n',
  ...Object.fromEntries(Object.entries(config).map(([path, text]) => [`config/${path}`, text])),
  ...extra,
});

/** A Makefile recipe launching the `prod` group with the arguments given. */
const launched = (args: string): Record<string, string> => ({ Makefile: `deploy:\n\tsceptre ${args} launch -y prod\n` });

describe('Jinja statements and filters, run where the files decide them (P264)', () => {
  const render = (text: string, roots: Record<string, unknown> = {}) => renderJinja(text, lookupIn(roots));

  it('runs the common filters on what the files give', () => {
    const roots = { var: { stage: ' Prod ', parts: ['a', 'b'], count: '3', missing: undefined, data: { b: 1, a: 'x' } } };
    expect(render("{{ var.stage | trim | lower }}-{{ var.stage | upper | trim }}-{{ var.stage | replace('Prod', 'live') | trim }}", roots).text).toBe('prod-PROD-live');
    expect(render("{{ var.parts | join('-') }} {{ var.count | int + 1 }} {{ 5 | string }} {{ var.data | tojson }} {{ var.missing | default('dev') }} {{ var.gone | d('x') }}", roots).text).toBe('a-b 4 5 {"a":"x","b":1} dev x');
  });

  it('runs if, elif, else, for and set, with the space a dash trims', () => {
    const text = "{% set stage = var.stage %}{% if stage == 'test' %}t{% elif stage == 'prod' %}p{% else %}d{% endif %}\n{%- for name in var.queues %} {{ loop.index }}:{{ name }}{% endfor %}{% for k, v in var.tags.items() %} {{ k }}={{ v }}{% endfor %}";
    expect(render(text, { var: { stage: 'prod', queues: ['jobs', 'audit'], tags: { team: 'shop' } } }).text).toBe('p 1:jobs 2:audit team=shop');
  });

  it('renders every way a condition the files do not decide can go, and says which', () => {
    const rendering = render("name: {% if environment_variable.BLUE %}blue{% else %}green{% endif %}", { environment_variable: {} });
    expect(rendering.ways).toEqual(['name: blue', 'name: green']);
    expect(rendering.undecided).toEqual(['{% if environment_variable.BLUE %}']);
    expect(render('{% if var.x is defined %}a{% else %}b{% endif %}', { var: {} }).text).toBe('b');
  });

  it('keeps every statement of a text it cannot run, as before', () => {
    const rendering = render("{% for q in environment_variable.QUEUES %}{{ q }}{% endfor %}{{ var.stage }}", { var: { stage: 'prod' }, environment_variable: {} });
    expect([...rendering.unrendered.values()]).toEqual(['{% for q in environment_variable.QUEUES %}', '{% endfor %}', '{{ q }}']);
    expect(rendering.text).toContain('prod');
  });
});

describe('a sceptre stack configuration with Jinja statements, stack_group_config and --merge-vars (P264)', () => {
  it('reads a stack whose parameters a condition decided by --var chooses', () => {
    const stack = "template_path: stack.yaml\nparameters:\n  Prefix: shop\n{% if var.stage == 'prod' %}\n  Stage: prod\n  Jobs: {{ var.jobs | default('shop-jobs') | upper }}\n{% else %}\n  Stage: dev\n{% endif %}\n";
    const deployment = read(sceptre({ 'prod/stack.yaml': stack }, launched('--var stage=prod')));
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(jobs(deployment)).toMatchObject({ text: 'SHOP-JOBS' });
  });

  it('reads what every way of a condition the files do not decide agrees on, and not what they do not', () => {
    const stack = "template_path: stack.yaml\nparameters:\n  Prefix: shop\n  Stage: prod\n{% if environment_variable.AUDIT %}\n  Jobs: shop-audit\n{% else %}\n  Jobs: shop-jobs\n{% endif %}\n";
    const deployment = read(sceptre({ 'prod/stack.yaml': stack }));
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(jobs(deployment)).toMatchObject({ unread: { text: expect.stringContaining('{% if environment_variable.AUDIT %}') } });
  });

  it('renders stack_group_config with the configuration of the groups above', () => {
    const deployment = read(sceptre({ 'config.yaml': 'project_code: shop\nstage: prod\n', 'prod/stack.yaml': "template_path: stack.yaml\nparameters:\n  Prefix: '{{ stack_group_config.project_code }}'\n  Stage: '{{ stack_group_config.stage }}'\n" }));
    expect(names(deployment)).toEqual(['shop-prod-fn']);
  });

  it('merges var files key by key with --merge-vars, and replaces them without it', () => {
    const stack = "template_path: stack.yaml\nparameters:\n  Prefix: '{{ var.names.prefix }}'\n  Stage: '{{ var.names.stage }}'\n";
    const files = { 'vars/base.yaml': 'names:\n  prefix: shop\n  stage: dev\n', 'vars/prod.yaml': 'names:\n  stage: prod\n' };
    expect(names(read(sceptre({ 'prod/stack.yaml': stack }, { ...files, ...launched('--merge-vars --var-file vars/base.yaml --var-file vars/prod.yaml') })))).toEqual(['shop-prod-fn']);
    expect(names(read(sceptre({ 'prod/stack.yaml': stack }, { ...files, ...launched('--var-file vars/base.yaml --var-file vars/prod.yaml') })))).toEqual([undefined]);
  });
});

describe("sceptre's other resolvers (P264)", () => {
  it('reads a file, another field of the stack, and nothing for !no_value', () => {
    const deployment = read(
      sceptre(
        { 'prod/stack.yaml': 'template_path: stack.yaml\nsceptre_user_data:\n  stage: prod\nparameters:\n  Prefix: !file values/prefix.txt\n  Stage: !stack_attr sceptre_user_data.stage\n  Jobs: !no_value\n' },
        { 'values/prefix.txt': 'shop' },
      ),
    );
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(jobs(deployment)).toMatchObject({ text: 'none' });
  });

  it('joins, splits, picks and formats, an import kept in place', () => {
    const deployment = read(
      sceptre({
        'prod/stack.yaml':
          "template_path: stack.yaml\nparameters:\n  Prefix: !select [0, !split ['-', shop-orders]]\n  Stage: !sub ['{stage}', { stage: prod }]\n  Jobs: !join ['', ['arn:aws:sqs:eu-west-1:1:', !stack_output_external shop-platform::Prefix, '-jobs']]\n",
      }),
    );
    expect(names(deployment)).toEqual(['shop-prod-fn']);
    expect(jobs(deployment)).toMatchObject({ names: { kind: 'queue', name: `${importedName('stack:shop-platform#Prefix')}-jobs` } });
    expect(deployment.imports?.map((site) => [site.key, site.within])).toEqual([['stack:shop-platform#Prefix', `${importedName('stack:shop-platform#Prefix')}-jobs`]]);
  });

  it('says a command a resolver runs is not read', () => {
    const deployment = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml\nparameters:\n  Prefix: shop\n  Stage: !rcmd ./stage.sh\n' }));
    expect(names(deployment)).toEqual([undefined]);
    expect(deployment.rows.find((row) => row.reason === 'function-name-unread')?.message).toContain('a command sceptre runs when the stack is launched');
  });
});

describe('a Jinja template sceptre renders with statements (P264)', () => {
  it('renders a loop over sceptre_user_data into the template', () => {
    const template = TEMPLATE.replace('      Environment:\n        Variables:\n          JOBS: !Ref Jobs', '      Environment:\n        Variables:\n{% for name, url in sceptre_user_data.queues.items() %}          {{ name | upper }}: {{ url }}\n{% endfor %}').replace('FunctionName: !Sub ${Prefix}-${Stage}-fn', 'FunctionName: {{ sceptre_user_data.name }}');
    const deployment = read(sceptre({ 'prod/stack.yaml': 'template_path: stack.yaml.j2\nsceptre_user_data:\n  name: shop-render-fn\n  queues:\n    jobs: https://sqs.eu-west-1.amazonaws.com/1/shop-jobs\n' }, { 'templates/stack.yaml.j2': template, 'templates/stack.yaml': '' }));
    expect(names(deployment)).toEqual(['shop-render-fn']);
    expect(deployment.functions[0]?.environment?.['JOBS']).toMatchObject({ names: { kind: 'queue', name: 'shop-jobs' } });
  });
});
