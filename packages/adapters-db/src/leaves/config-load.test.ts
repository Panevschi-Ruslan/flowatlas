import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { loadedSettings } from './config-load.js';

const HEADER = `
declare const process: { env: Record<string, string | undefined> };
declare function registerAs<T>(namespace: string, factory: () => T): () => T;
declare const ConfigModule: { forRoot(options: { load?: Array<() => unknown> }): unknown };
`;

const filesOf = (sources: Record<string, string>) => {
  const project = new Project({ useInMemoryFileSystem: true });
  return Object.entries(sources).map(([name, text]) => project.createSourceFile(name, `${HEADER}${text}`));
};

describe('where a dotted settings key comes from (P77)', () => {
  it('reads a namespaced factory, with the variable and what it falls back to', () => {
    const found = loadedSettings(
      filesOf({
        'orders.config.ts': `
          export default registerAs('orders', () => ({
            url: process.env.ORDERS_URL ?? 'http://orders:3000',
            timeout: 3000,
            retry: { url: process.env.RETRY_URL },
          }));
        `,
      }),
    );
    expect(found.get('orders.url')).toEqual({ variable: 'ORDERS_URL', otherwise: 'http://orders:3000', file: '/orders.config.ts' });
    expect(found.get('orders.retry.url')).toEqual({ variable: 'RETRY_URL', file: '/orders.config.ts' });
    expect(found.has('orders.timeout')).toBe(false);
  });

  it('reads a factory handed to the settings module by name, without a namespace', () => {
    const found = loadedSettings(
      filesOf({
        'configuration.ts': `
          export const configuration = () => {
            return { payments: { baseUrl: process.env.PAYMENTS_URL || 'http://payments:4000' }, region: 'eu' };
          };
        `,
        'app.module.ts': `
          import { configuration } from './configuration';
          export const imports = [ConfigModule.forRoot({ load: [configuration] })];
        `,
      }),
    );
    expect(found.get('payments.baseUrl')).toEqual({ variable: 'PAYMENTS_URL', otherwise: 'http://payments:4000', file: '/configuration.ts' });
    expect(found.get('region')).toEqual({ otherwise: 'eu', file: '/configuration.ts' });
  });

  it('reads nothing from a file that sets nothing up', () => {
    expect(loadedSettings(filesOf({ 'a.ts': `export const x = { url: process.env.A_URL };` })).size).toBe(0);
  });
});
