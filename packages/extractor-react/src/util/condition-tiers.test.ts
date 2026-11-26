import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { analyzeApiUrl } from './url.js';

/** The address argument of the first call to `fetch` in a source. */
const addressIn = (source: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('page.ts', `declare const isProd: boolean;\n${source}`);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch');
  return analyzeApiUrl(call?.getArguments()[0] as never);
};

// P325: a browser's request carries a condition later in a chain as one tier.
describe("a browser's request on a chain with a condition after its first setting", () => {
  it('writes the condition as one tier after the first setting', () => {
    expect(addressIn('fetch(`${import.meta.env.VITE_API_URL || (isProd ? import.meta.env.VITE_EAST_URL : import.meta.env.VITE_WEST_URL)}/regions`);')).toMatchObject({
      baseUrlEnv: 'VITE_API_URL',
      baseUrlAlso: ['VITE_EAST_URL', 'VITE_WEST_URL'],
      baseUrlAlsoTiers: [['VITE_EAST_URL', 'VITE_WEST_URL']],
      path: '/regions',
    });
  });

  it('writes no tiers for a plain chain', () => {
    expect(addressIn('fetch(`${import.meta.env.VITE_API_URL || import.meta.env.VITE_WEST_URL}/regions`);').baseUrlAlsoTiers).toBeUndefined();
  });
});
