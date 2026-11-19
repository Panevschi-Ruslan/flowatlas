import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { analyzeApiUrl } from './url.js';

/** The address argument of the first call to `$fetch` in a source. */
const addressIn = (source: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('page.ts', source);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === '$fetch');
  return analyzeApiUrl(call?.getArguments()[0] as never);
};

describe("Nuxt's runtime configuration as a base address (P233)", () => {
  it('reads the key under public, called in place or held by a name', () => {
    expect(addressIn('$fetch(`${useRuntimeConfig().public.apiBase}/orders`);')).toMatchObject({ baseUrlEnv: 'apiBase', path: '/orders' });
    expect(addressIn('const config = useRuntimeConfig();\n$fetch(`${config.public.apiBase}/orders`);')).toMatchObject({ baseUrlEnv: 'apiBase', path: '/orders' });
    expect(addressIn('const settings = useRuntimeConfig();\n$fetch(`${settings.public.ordersUrl}/orders/1`);')).toMatchObject({ baseUrlEnv: 'ordersUrl' });
  });

  it('reads a server-side key, which has no public in front', () => {
    expect(addressIn('const config = useRuntimeConfig();\n$fetch(`${config.billingUrl}/invoices`);')).toMatchObject({ baseUrlEnv: 'billingUrl', path: '/invoices' });
  });
});
