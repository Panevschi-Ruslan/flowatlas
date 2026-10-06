import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { infraModuleSchema } from '@flowatlas/core';
import { parseHclExpression } from '../hcl/parse.js';
import { evaluate } from '../eval/evaluate.js';
import { asText, describe as describeValue, type Value } from '../eval/values.js';
import { loadConfiguration, type LoadOptions } from './load.js';
import { SHIPPED_MODULES } from './shipped.js';
import { describedModule, normaliseSource } from './sources.js';

const dirs: string[] = [];

const repo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-tf-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const load = (files: Record<string, string>, options: Partial<LoadOptions> = {}) =>
  loadConfiguration({ repoDir: repo(files), descriptions: [], ...options });

/** Evaluates an expression in the first root module of a configuration. */
const valueIn = (files: Record<string, string>, text: string, options: Partial<LoadOptions> = {}): Value => {
  const configuration = load(files, options);
  const root = configuration.roots[0];
  if (root === undefined) throw new Error('no root module');
  return evaluate(parseHclExpression(text), { module: root });
};

const text = (value: Value): string | undefined => asText(value);

describe('evaluating what addresses things', () => {
  const main = {
    'main.tf': [
      'variable "stage" { default = "dev" }',
      'locals {',
      '  prefix = "library-${var.stage}"',
      '  names  = { loans = "loans", holds = "holds" }',
      '  list   = ["b", "a", "b"]',
      '}',
      'resource "aws_lambda_function" "loans" {',
      '  function_name = "${local.prefix}-loans"',
      '}',
    ].join('\n'),
    'definition.json': '{"Comment": "x"}',
    'policy.tftpl': '%{ for name in names ~}${name};%{ endfor ~}',
  };

  it('reads variables, locals and templates', () => {
    expect(text(valueIn(main, 'local.prefix'))).toBe('library-dev');
    expect(text(valueIn(main, 'format("%s-%d", local.prefix, 3)'))).toBe('library-dev-3');
    expect(text(valueIn(main, 'lookup(local.names, "holds", "x")'))).toBe('holds');
    expect(text(valueIn(main, 'merge(local.names, { a = "b" }).a'))).toBe('b');
    expect(text(valueIn(main, 'join(",", toset(local.list))'))).toBe('a,b');
    expect(text(valueIn(main, 'replace(upper("a-b"), "-", "_")'))).toBe('A_B');
  });

  it('reads files and templates beside the configuration', () => {
    expect(text(valueIn(main, 'jsondecode(file("${path.module}/definition.json")).Comment'))).toBe('x');
    expect(text(valueIn(main, 'templatefile("policy.tftpl", { names = ["a", "b"] })'))).toBe('a;b;');
    expect(text(valueIn(main, 'jsonencode({ b = 1, a = [true] })'))).toBe('{"a":[true],"b":1}');
  });

  it('reads an argument of a resource as the value it is, and anything else as the reference', () => {
    expect(text(valueIn(main, 'aws_lambda_function.loans.function_name'))).toBe('library-dev-loans');
    const arn = valueIn(main, 'aws_lambda_function.loans.invoke_arn');
    expect(arn).toMatchObject({ kind: 'ref', attribute: ['invoke_arn'] });
    expect(valueIn(main, '"${aws_lambda_function.loans.arn}"')).toMatchObject({ kind: 'ref' });
  });

  it('never assembles a string around something it does not know', () => {
    const value = valueIn(main, '"x-${aws_lambda_function.loans.arn}"');
    expect(value).toMatchObject({ kind: 'unknown', because: { reason: 'computed' } });
    expect(valueIn(main, 'timestamp()')).toMatchObject({ kind: 'unknown', because: { reason: 'function' } });
  });

  it('tells an error from an unknown, which is what try and can turn on', () => {
    expect(text(valueIn(main, 'try(local.names.missing, "fallback")'))).toBe('fallback');
    expect(valueIn(main, 'can(local.names.loans)')).toMatchObject({ kind: 'bool', value: true });
    expect(valueIn(main, 'can(local.names.nope)')).toMatchObject({ kind: 'bool', value: false });
    expect(valueIn(main, 'try(aws_lambda_function.loans.arn, "")')).toMatchObject({ kind: 'ref' });
  });

  it('evaluates for expressions, conditionals and operators', () => {
    expect(describeValue(valueIn(main, '[for k, v in local.names : "${k}=${v}" if k != "holds"]'))).toBe('a list of 1');
    expect(text(valueIn(main, 'var.stage == "dev" ? "yes" : "no"'))).toBe('yes');
    expect(valueIn(main, 'length(local.list) * 2')).toMatchObject({ kind: 'number', value: 6 });
  });
});

describe('variable files', () => {
  const files = {
    'infra/main.tf': 'variable "prefix" { default = "library" }\nvariable "region" {}\n',
    'infra/terraform.tfvars': 'region = "eu-west-1"\n',
    'infra/env/dev.tfvars': 'prefix = "library-dev"\n',
    'infra/env/prod.tfvars': 'prefix = "library-prod"\n',
  };

  it('reads a value the auto-loaded file sets', () => {
    expect(text(valueIn(files, 'var.region'))).toBe('eu-west-1');
  });

  it('does not pick one of two files that disagree, and names both', () => {
    const value = valueIn(files, 'var.prefix');
    expect(value).toMatchObject({
      kind: 'unknown',
      because: {
        reason: 'variable-disputed',
        variable: 'prefix',
        files: { 'infra/env/dev.tfvars': '"library-dev"', 'infra/env/prod.tfvars': '"library-prod"' },
      },
    });
  });

  it('reads the file the configuration chose', () => {
    expect(text(valueIn(files, 'var.prefix', { varFiles: ['infra/env/prod.tfvars'] }))).toBe('library-prod');
  });

  it('takes the default when the choice is no file at all', () => {
    expect(text(valueIn(files, 'var.prefix', { varFiles: [] }))).toBe('library');
  });

  it('says a variable nothing sets is unset', () => {
    const value = valueIn({ 'main.tf': 'variable "x" {}\n' }, 'var.x');
    expect(value).toMatchObject({ kind: 'unknown', because: { reason: 'variable-unset', variable: 'x' } });
  });
});

describe('modules', () => {
  it('reads a local module with its inputs bound, and is not a root of its own', () => {
    const configuration = load({
      'infra/main.tf': 'module "loans" {\n  source = "./modules/fn"\n  name = "loans"\n}\n',
      'infra/modules/fn/main.tf': 'variable "name" {}\nresource "aws_lambda_function" "this" { function_name = "library-${var.name}" }\noutput "name" { value = aws_lambda_function.this.function_name }\n',
    });
    expect(configuration.roots.map((root) => root.dir)).toEqual(['infra']);
    const root = configuration.roots[0]!;
    expect(text(evaluate(parseHclExpression('module.loans.name'), { module: root }))).toBe('library-loans');
    const instances = configuration.modules().flatMap((module) => module.instances());
    expect(instances.map((instance) => instance.address)).toEqual(['module.loans.aws_lambda_function.this']);
  });

  it('expands a repeated block over what the files settle, and keeps one unknown instance otherwise', () => {
    const configuration = load({
      'main.tf': [
        'variable "channels" {}',
        'resource "aws_lambda_function" "known" {',
        '  for_each = toset(["email", "sms"])',
        '  function_name = "remind-${each.key}"',
        '}',
        'resource "aws_lambda_function" "unknown" {',
        '  for_each = toset(var.channels)',
        '  function_name = "remind-${each.key}"',
        '}',
        'resource "aws_lambda_function" "counted" {',
        '  count = 2',
        '  function_name = "n-${count.index}"',
        '}',
      ].join('\n'),
    });
    const instances = configuration.modules().flatMap((module) => module.instances());
    expect(instances.map((instance) => instance.address)).toEqual([
      'aws_lambda_function.known["email"]',
      'aws_lambda_function.known["sms"]',
      'aws_lambda_function.unknown[?]',
      'aws_lambda_function.counted[0]',
      'aws_lambda_function.counted[1]',
    ]);
    const names = instances.map((instance) => instance.module.argument(instance, 'function_name'));
    expect(names.map((value) => (value === undefined ? undefined : text(value)))).toEqual([
      'remind-email',
      'remind-sms',
      undefined,
      'n-0',
      'n-1',
    ]);
  });

  it('reads a described module through the description, and rows one nothing describes', () => {
    const description = infraModuleSchema.parse({
      source: 'git::https://git.example.com/platform/fn.git',
      resources: { 'aws_lambda_function.this': { function_name: 'var.name' } },
      outputs: { arn: 'aws_lambda_function.this.arn' },
    });
    const configuration = load(
      {
        'main.tf': [
          'module "described" {',
          '  source = "git::https://git.example.com/platform/fn.git?ref=v1.2.0"',
          '  name   = "loans"',
          '}',
          'module "unknown" {',
          '  source  = "git::https://git.example.com/platform/other.git"',
          '  handler = "index.handler"',
          '}',
        ].join('\n'),
      },
      { descriptions: [description] },
    );
    const instances = configuration.modules().flatMap((module) => module.instances());
    expect(instances.map((instance) => [instance.address, text(instance.module.argument(instance, 'function_name')!)])).toEqual([
      ['module.described.aws_lambda_function.this', 'loans'],
    ]);
    expect(instances[0]?.module.site).toMatchObject({ file: 'main.tf', line: 1 });
    expect(configuration.rows).toEqual([
      expect.objectContaining({ reason: 'infra-module-undescribed', file: 'main.tf', line: 5, symbol: 'git::https://git.example.com/platform/other.git' }),
    ]);
    expect(configuration.rows[0]?.level).toBeUndefined();
  });

  it('rows a file that does not parse and reads the rest', () => {
    const configuration = load({ 'a.tf': 'resource "x" "y" {\n', 'b.tf': 'locals { a = 1 }\n' });
    expect(configuration.rows).toEqual([expect.objectContaining({ reason: 'infra-file-unparsed', file: 'a.tf' })]);
    expect(configuration.roots).toHaveLength(1);
  });
});

describe('sources', () => {
  it('matches a source whatever version it pins and however the registry is spelled', () => {
    expect(normaliseSource('git::https://h/x.git?ref=v1')).toBe('https://h/x.git');
    expect(describedModule('registry.terraform.io/terraform-aws-modules/lambda/aws', SHIPPED_MODULES)).toBeDefined();
    expect(describedModule('terraform-aws-modules/lambda/aws//modules/alias', SHIPPED_MODULES)).toBeUndefined();
  });

  it('ships the two public descriptions through the schema a person writes', () => {
    expect(SHIPPED_MODULES.map((description) => description.source)).toEqual([
      'terraform-aws-modules/lambda/aws',
      'terraform-aws-modules/apigateway-v2/aws',
    ]);
  });
});
