import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { analyzeUrl } from './url.js';

/** A gateway whose clients build each address on a settings object another module exports. */
const project = (settings: string): SourceFile => {
  const files = new Project({ useInMemoryFileSystem: true });
  files.createSourceFile('src/env.d.ts', 'declare const process: { env: Record<string, string | undefined> };\ndeclare function fetch(input: string): Promise<unknown>;');
  files.createSourceFile('src/settings.ts', settings);
  return files.createSourceFile('src/clients/slots.client.ts', "import { settings } from '../settings';\nexport class SlotsClient { list() { return fetch(`${settings.shippingBase}/slots`); } }\n");
};

const addressIn = (file: SourceFile) =>
  analyzeUrl(file.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getText() === 'fetch')!.getArguments()[0]!, { whole: true });

describe('an address on a settings object another module exports (P406)', () => {
  it('is rooted at the setting the property reads, with what the code falls back to', () => {
    const info = addressIn(project("export const settings = {\n  shippingBase: process.env.SHIPPING_URL ?? 'http://shipping.internal',\n  timeoutMs: Number(process.env.TIMEOUT_MS ?? 5000),\n};\n"));
    expect(info).toMatchObject({ url: '${SHIPPING_URL}/slots', path: '/slots', baseUrlEnv: 'SHIPPING_URL', baseUrlDefault: 'http://shipping.internal' });
  });

  it('is not followed into a `let`, which another module may give a different object', () => {
    const info = addressIn(project("export let settings = { shippingBase: process.env.SHIPPING_URL ?? '' };\n"));
    expect(info.baseUrlEnv).toBeNull();
  });
});
