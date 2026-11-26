import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { settingKeyIn } from './static-string.js';
import { rootSettingAddress } from './trace.js';

const HEADER = `
declare const environment: { apiUrl: string; stageUrl: string; devUrl: string; legacyUrl: string; edgeUrl: string };
interface Http { get(url: string): unknown }
declare const http: Http;
declare const isProd: boolean;
declare const isStage: boolean;
`;

const parse = (source: string): SourceFile => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `${HEADER}${source}`);

const readSetting = (node: Parameters<typeof settingKeyIn>[0]) => settingKeyIn(node, ['environment']);

/** The address the one `http.get` is made to, read from the chain or condition it opens with. */
const rooted = (source: string) => {
  const file = parse(source);
  const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'http.get');
  const opening = call?.getArguments()[0]?.getDescendantsOfKind(SyntaxKind.TemplateSpan)[0]?.getExpression();
  if (opening === undefined) throw new Error('no address in the source');
  return rootSettingAddress(opening, { readSetting });
};

// P325: a condition later in a chain is one tier of its branches.
describe('the tiers of a chain with a condition after its first setting', () => {
  it('reads a condition after the first setting as one tier of both branches', () => {
    const address = rooted('http.get(`${environment.apiUrl || (isProd ? environment.stageUrl : environment.devUrl)}/orders`);');
    expect(address).toMatchObject({ key: 'apiUrl', also: ['stageUrl', 'devUrl'], alsoTiers: [['stageUrl', 'devUrl']] });
    expect(address?.either).toBeUndefined();
  });

  it('keeps the tiers after it in order, a plain later setting a tier of its own', () => {
    const address = rooted('http.get(`${environment.apiUrl ?? (isProd ? environment.stageUrl : environment.devUrl) ?? environment.legacyUrl}/orders`);');
    expect(address).toMatchObject({ key: 'apiUrl', also: ['stageUrl', 'devUrl', 'legacyUrl'], alsoTiers: [['stageUrl', 'devUrl'], ['legacyUrl']] });
  });

  it('writes no tiers where each is one setting, as a plain chain and a condition first are read', () => {
    expect(rooted('http.get(`${environment.apiUrl || environment.devUrl || environment.legacyUrl}/orders`);')?.alsoTiers).toBeUndefined();
    const first = rooted('http.get(`${(isProd ? environment.apiUrl : environment.devUrl) || environment.legacyUrl}/orders`);');
    expect(first).toMatchObject({ key: 'apiUrl', either: ['apiUrl', 'devUrl'], also: ['devUrl', 'legacyUrl'] });
    expect(first?.alsoTiers).toBeUndefined();
  });

  it('reads two conditions in a row as two tiers, and a nested condition as one tier of every branch', () => {
    const twice = rooted('http.get(`${(isProd ? environment.apiUrl : environment.devUrl) || (isStage ? environment.stageUrl : environment.legacyUrl)}/orders`);');
    expect(twice).toMatchObject({ either: ['apiUrl', 'devUrl'], alsoTiers: [['stageUrl', 'legacyUrl']] });
    const nested = rooted('http.get(`${environment.apiUrl || (isProd ? environment.stageUrl : isStage ? environment.devUrl : environment.legacyUrl)}/orders`);');
    expect(nested).toMatchObject({ key: 'apiUrl', alsoTiers: [['stageUrl', 'devUrl', 'legacyUrl']] });
  });

  it("reads each branch's own chain side by side after the branches", () => {
    const address = rooted('http.get(`${isProd ? environment.apiUrl || environment.stageUrl : environment.devUrl || environment.legacyUrl}/orders`);');
    expect(address).toMatchObject({ key: 'apiUrl', either: ['apiUrl', 'devUrl'], alsoTiers: [['stageUrl', 'legacyUrl']] });
  });

  it('carries the tiers through a constant and a helper', () => {
    const constant = rooted(`
      const BASE = environment.apiUrl || (isProd ? environment.stageUrl : environment.devUrl);
      http.get(\`\${BASE}/orders\`);
    `);
    expect(constant).toMatchObject({ key: 'apiUrl', alsoTiers: [['stageUrl', 'devUrl']] });
    const helper = rooted(`
      const base = () => environment.apiUrl || (isProd ? environment.stageUrl : environment.devUrl);
      http.get(\`\${base()}/orders\`);
    `);
    expect(helper).toMatchObject({ key: 'apiUrl', alsoTiers: [['stageUrl', 'devUrl']] });
  });
});
