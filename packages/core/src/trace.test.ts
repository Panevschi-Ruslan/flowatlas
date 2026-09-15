import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { resolveStaticString, settingKeyIn } from './static-string.js';
import { constantMethodResult, returnedExpression, rootSettingKey } from './trace.js';

const HEADER = `
declare const environment: { apiUrl: string; api: { baseUrl: string } };
interface Http { get(url: string): unknown }
declare const http: Http;
`;

const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `${HEADER}${source}`);

/** The one `http.get(...)`, which is where every case ends. */
const request = (file: SourceFile): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith('.get'));
  if (call === undefined) throw new Error('no request in the source');
  return call;
};

const address = (file: SourceFile) => request(file).getArguments()[0]!;

const ROOTS = ['environment'] as const;
const readSetting = (node: Parameters<typeof settingKeyIn>[0]) => settingKeyIn(node, ROOTS);

/** How a browser application is read, with both halves of an address followed. */
const settingBehind = (node: Parameters<typeof rootSettingKey>[0]) => {
  const returned = returnedExpression(node);
  if (returned !== null) {
    const inner = resolveStaticString(returned, {
      envRoots: ROOTS,
      placeholder: ':param',
      settingBehind,
      resolveSpan: constantMethodResult,
    });
    const [key] = inner?.envRefs ?? [];
    if (key !== undefined) return { key, prefix: inner?.value ?? '' };
  }
  const key = rootSettingKey(node, { readSetting });
  return key === null ? null : { key };
};

const read = (file: SourceFile) =>
  resolveStaticString(address(file), {
    envRoots: ROOTS,
    placeholder: ':param',
    settingBehind,
    resolveSpan: constantMethodResult,
  });

describe('a settings value kept in a property', () => {
  it('is followed back to the settings it came from', () => {
    const file = parse(`
      class Service {
        private apiUrl = environment.apiUrl;
        list() { return http.get(\`\${this.apiUrl}/orders\`); }
      }
    `);
    expect(read(file)).toMatchObject({ value: '/orders', envRefs: ['apiUrl'] });
  });

  it('is followed when the property is declared on a class this one extends', () => {
    const file = parse(`
      class Base {
        protected baseUrl = environment.apiUrl;
      }
      class Service extends Base {
        list() { return http.get(\`\${this.baseUrl}/orders\`); }
      }
    `);
    expect(read(file)).toMatchObject({ value: '/orders', envRefs: ['apiUrl'] });
  });

  it('names the whole key when the settings are nested', () => {
    const file = parse(`
      class Service {
        private base = environment.api.baseUrl;
        list() { return http.get(\`\${this.base}/orders\`); }
      }
    `);
    expect(read(file)).toMatchObject({ envRefs: ['api.baseUrl'] });
  });

  it('says nothing when the property came from somewhere it cannot follow', () => {
    const file = parse(`
      class Service {
        constructor(private readonly given: string) {}
        list() { return http.get(\`\${this.given}/orders\`); }
      }
    `);
    expect(read(file)?.envRefs).toEqual([]);
  });
});

describe('an address a helper assembles', () => {
  it('keeps the half the helper wrote as well as the settings it is rooted at', () => {
    const file = parse(`
      class Service {
        private api = environment.apiUrl;
        private url(): string { return \`\${this.api}/admin/size-scales\`; }
        one(id: string) { return http.get(\`\${this.url()}/\${id}\`); }
      }
    `);
    expect(read(file)).toMatchObject({
      value: '/admin/size-scales/:param',
      envRefs: ['apiUrl'],
    });
  });

  it('carries a hole the helper could not read through to the path', () => {
    const file = parse(`
      class Service {
        private api = environment.apiUrl;
        private url(rid: string): string { return \`\${this.api}/admin/\${rid}/scales\`; }
        one(rid: string, id: string) { return http.get(\`\${this.url(rid)}/\${id}\`); }
      }
    `);
    // The helper takes an argument, so it is not the same address every time and
    // is read as a hole rather than followed.
    expect(read(file)?.value).toBe('/:param');
  });

  it('reads a resource name a method always answers with', () => {
    const file = parse(`
      class Service {
        private api = environment.apiUrl;
        protected path(): string { return 'categories'; }
        list() { return http.get(\`\${this.api}/\${this.path()}\`); }
      }
    `);
    expect(read(file)).toMatchObject({ value: '/categories', envRefs: ['apiUrl'] });
  });

  it('refuses a method that answers differently depending on the run', () => {
    const file = parse(`
      class Service {
        private api = environment.apiUrl;
        private path(): string { return Math.random() > 0.5 ? 'a' : 'b'; }
        list() { return http.get(\`\${this.api}/\${this.path()}\`); }
      }
    `);
    expect(read(file)?.value).toBe('/:param');
  });
});

describe('what the settings reader is asked', () => {
  it('is asked by the tracer, so the core never decides what a setting looks like', () => {
    const file = parse(`
      class Service {
        private apiUrl = environment.apiUrl;
        list() { return http.get(\`\${this.apiUrl}/orders\`); }
      }
    `);
    const asked: string[] = [];
    rootSettingKey(address(file), {
      readSetting: (node) => {
        asked.push(node.getKindName());
        return null;
      },
    });
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe('a value a getter answers with', () => {
  it('is followed like the initializer of a field', () => {
    const file = parse(`
      class Service {
        private get base(): string { return environment.apiUrl; }
        list() { return http.get(\`\${this.base}/orders\`); }
      }
    `);
    expect(read(file)).toMatchObject({ value: '/orders', envRefs: ['apiUrl'] });
  });

  it('is not followed when the getter decides between several', () => {
    const file = parse(`
      class Service {
        private get base(): string { if (Math.random() > 0.5) return environment.apiUrl; return environment.api.baseUrl; }
        list() { return http.get(\`\${this.base}/orders\`); }
      }
    `);
    expect(read(file)?.envRefs).toEqual([]);
  });
});
