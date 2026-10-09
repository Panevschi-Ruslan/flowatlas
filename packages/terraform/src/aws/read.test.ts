import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

const read = (path: string, service?: { infra?: { vars: string[] } }): Deployment => {
  const configPath = join(FIXTURES, path.split('/')[0] as string, 'flowatlas.config.json');
  let config = parseConfig({});
  try {
    config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  } catch {
    // A fixture of one repository has no configuration of its own.
  }
  return terraformReader.read({
    repoDir: join(FIXTURES, path),
    config,
    ...(service === undefined ? {} : { service: { name: 'x', repo: '.', type: 'lambda', ...service } }),
  });
};

const routes = (deployment: Deployment): string[] =>
  deployment.routes.map((route) => `${route.method} ${route.path}`).sort();

describe('a REST API declared resource by resource', () => {
  const deployment = read('lambda-terraform-rest');

  it('reads every function under its deployed name, and the packaged directory', () => {
    expect(deployment.functions.map((fn) => [fn.name ?? fn.address, fn.handler?.written, fn.handler?.directory])).toEqual([
      ['library-dev-create-loan', 'create-loan.handler', 'src/loans'],
      ['library-dev-get-loan', 'get-loan.handler', 'src/loans'],
      ['library-dev-renew-loan', 'renew-loan.handler', 'src/loans'],
      ['library-dev-record-return', 'record-return.handler', 'dist/returns'],
      ['aws_lambda_function.send_reminder[?]', 'send-reminder.handler', 'src/reminders'],
    ]);
  });

  it('builds each path from the resource tree, the parameter included', () => {
    expect(routes(deployment)).toEqual(['GET /loans/:param', 'POST /loans', 'POST /loans/:param/renewal', 'POST /returns']);
  });

  it('finds the function through an invoke ARN and through an address written around one', () => {
    const renewal = deployment.routes.find((route) => route.path === '/loans/:param/renewal');
    expect(renewal?.target).toEqual({ function: 2 });
    expect(renewal?.guards?.map((guard) => guard.label)).toEqual(['AWS_IAM']);
    const create = deployment.routes.find((route) => route.path === '/loans');
    expect(create?.guards?.map((guard) => guard.label)).toEqual(['librarians']);
  });

  it('names what to set for a function repeated over something unknown, and gives it no name', () => {
    expect(deployment.functions[4]?.name).toBeUndefined();
    expect(deployment.rows).toEqual([
      expect.objectContaining({ reason: 'function-repeated-unread', meta: expect.objectContaining({ variable: 'reminder_channels' }) }),
    ]);
  });
});

describe('modules', () => {
  const deployment = read('lambda-terraform-modules');

  it('reads functions through a local module and the public module', () => {
    expect(deployment.functions.map((fn) => fn.name).sort()).toEqual([
      'catalogue-get-borrower',
      'catalogue-get-title',
      'catalogue-register-borrower',
      'catalogue-search-titles',
    ]);
    expect(deployment.functions.every((fn) => fn.handler?.directory === 'src/handlers')).toBe(true);
  });

  it('reads routes through the public HTTP API module and a described one', () => {
    expect(routes(deployment)).toEqual(['GET /borrowers/:param', 'GET /titles', 'GET /titles/:param', 'POST /borrowers']);
    expect(deployment.routes.every((route) => route.target !== undefined && 'function' in route.target)).toBe(true);
  });

  it('says once which module nothing describes, and what it was handed', () => {
    expect(deployment.rows).toEqual([
      expect.objectContaining({
        reason: 'infra-module-undescribed',
        meta: expect.objectContaining({ module: 'module.newsletter', inputs: ['function_name', 'handler', 'source_dir', 'schedule'] }),
      }),
    ]);
  });
});

describe('a shared API across repositories', () => {
  it('publishes the points other repositories hang routes from', () => {
    const platform = read('multi-repo-lambda/platform');
    // The API's own id is published too, and is not a point of the tree: only
    // a resource's id, or the root resource's, places a route.
    expect(platform.roots.map((root) => [root.key, root.path])).toEqual([
      ['parameter:/lending-library/api/v1-resource-id', '/v1'],
      ['state:s3:bucket=lending-library-terraform-state,key=platform/terraform.tfstate#v1_resource_id', '/v1'],
    ]);
    expect(platform.routes[0]?.target).toEqual({ name: 'library-dev-list-borrower-loans' });
  });

  it('hangs routes from a remote state output and from a parameter', () => {
    const loans = read('multi-repo-lambda/loans', { infra: { vars: ['infra/env/dev.tfvars'] } });
    expect(loans.routes.map((route) => [route.path, route.root])).toEqual([
      ['/${…}/loans', { key: 'state:s3:bucket=lending-library-terraform-state,key=platform/terraform.tfstate#v1_resource_id', below: '/loans' }],
      ['/${…}/loans/:param', { key: 'state:s3:bucket=lending-library-terraform-state,key=platform/terraform.tfstate#v1_resource_id', below: '/loans/:param' }],
    ]);
    const holds = read('multi-repo-lambda/holds');
    expect(holds.routes.map((route) => route.root?.key)).toEqual([
      'parameter:/lending-library/api/v1-resource-id',
      'parameter:/lending-library/api/v1-resource-id',
    ]);
  });

  it('reads the chosen environment, and names the disputed variable without one', () => {
    const loans = read('multi-repo-lambda/loans', { infra: { vars: ['infra/env/dev.tfvars'] } });
    expect(loans.functions.map((fn) => fn.name)).toEqual([
      'library-dev-create-loan',
      'library-dev-get-loan',
      'library-dev-list-borrower-loans',
    ]);
    const undecided = read('multi-repo-lambda/loans');
    expect(undecided.functions.map((fn) => fn.name)).toEqual([undefined, undefined, undefined]);
    expect(undecided.rows.map((row) => row.reason)).toEqual(['function-name-disputed', 'function-name-disputed', 'function-name-disputed']);
    expect(undecided.rows[0]?.hint).toContain('services[].infra.vars');
  });

  it('says a repository of nothing but a shared API declares a deployment', () => {
    expect(terraformReader.declares(join(FIXTURES, 'multi-repo-lambda/platform'))).toBe(true);
    expect(terraformReader.declares(join(FIXTURES, 'nest-basic'))).toBe(false);
  });
});
