import { parseConfig } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';

/**
 * The configuration example from the plan, verbatim.
 *
 * It lives in this package rather than in the core because it names concrete
 * frameworks, and the core is not allowed to contain such a name anywhere,
 * tests included.
 */
const PLAN_EXAMPLE = {
  services: [
    { name: 'gateway', repo: '../gateway', type: 'nestjs', baseUrlEnv: ['GATEWAY_URL'] },
    {
      name: 'orders',
      repo: '../orders-service',
      type: 'nestjs',
      baseUrlEnv: ['ORDERS_SERVICE_URL', 'ORDERS_URL'],
    },
    { name: 'bot', repo: '../bot-service', type: 'nestjs' },
    { name: 'web', repo: '../web-app', type: 'angular', apiBaseEnv: ['apiUrl'] },
  ],
  sharedPackages: ['@project/contracts', '@project/events'],
  adapters: { auto: true, force: {} },
  output: '.flowatlas',
};

describe('the configuration example from the plan', () => {
  it('validates unchanged', () => {
    expect(() => parseConfig(PLAN_EXAMPLE)).not.toThrow();
  });

  it('keeps every value it declares and fills in the rest', () => {
    const config = parseConfig(PLAN_EXAMPLE);
    expect(config.services.map((s) => s.name)).toEqual(['gateway', 'orders', 'bot', 'web']);
    expect(config.services[1]?.baseUrlEnv).toEqual(['ORDERS_SERVICE_URL', 'ORDERS_URL']);
    expect(config.services[3]?.apiBaseEnv).toEqual(['apiUrl']);
    expect(config.sharedPackages).toEqual(['@project/contracts', '@project/events']);
    expect(config.output).toBe('.flowatlas');
    expect(config.types).toEqual({ maxDepth: 3 });
    expect(config.adapters.db).toEqual({ localBaseClasses: [] });
  });
});
