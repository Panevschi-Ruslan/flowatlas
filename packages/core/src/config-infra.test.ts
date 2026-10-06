import { describe, expect, it } from 'vitest';
import { infraModuleSchema, parseConfig } from './config.js';
import { ConfigInvalidError } from './errors.js';

describe('services[].infra', () => {
  it('takes the variable files a service is read with, in order', () => {
    const config = parseConfig({
      services: [{ name: 'loans', repo: '.', type: 'functions', infra: { vars: ['env/dev.tfvars', 'env/local.tfvars'] } }],
    });
    expect(config.services[0]?.infra).toEqual({ vars: ['env/dev.tfvars', 'env/local.tfvars'] });
  });

  it('reads an empty choice as a choice of no files, not as no choice', () => {
    const config = parseConfig({ services: [{ name: 'loans', repo: '.', type: 'functions', infra: {} }] });
    expect(config.services[0]?.infra).toEqual({ vars: [] });
  });

  it('leaves it out when nothing was said', () => {
    const config = parseConfig({ services: [{ name: 'loans', repo: '.', type: 'functions' }] });
    expect(config.services[0]?.infra).toBeUndefined();
  });
});

describe('adapters.infra.modules', () => {
  const description = {
    source: 'git::https://git.example.com/platform/route.git',
    resources: {
      'aws_api_gateway_method.this': { http_method: 'var.http_method', authorization: '"NONE"' },
      'data.aws_lambda_function.target': { function_name: 'var.function_name' },
    },
  };

  it('fills what a description leaves out', () => {
    expect(infraModuleSchema.parse(description)).toEqual({ ...description, variables: {}, outputs: {} });
  });

  it('accepts literals beside expressions', () => {
    const parsed = infraModuleSchema.parse({
      ...description,
      resources: { 'aws_lambda_function.this': { timeout: 30, publish: true, layers: null } },
    });
    expect(parsed.resources['aws_lambda_function.this']).toEqual({ timeout: 30, publish: true, layers: null });
  });

  it('refuses a resource that is not named type.name or data.type.name', () => {
    expect(() =>
      parseConfig({ adapters: { infra: { modules: [{ source: 'x', resources: { handler: {} } }] } } }),
    ).toThrow(ConfigInvalidError);
  });

  it('refuses a description that declares nothing', () => {
    expect(() => parseConfig({ adapters: { infra: { modules: [{ source: 'x', resources: {} }] } } })).toThrow(
      ConfigInvalidError,
    );
  });
});
