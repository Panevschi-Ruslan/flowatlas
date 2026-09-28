import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { UNREAD_SPAN } from './ids.js';
import { resolveStaticString, settingKeyIn } from './static-string.js';
import {
  constantMethodResult,
  constantPropertyValue,
  literalChoices,
  returnedExpression,
  rootSettingAddress,
  rootSettingKey,
} from './trace.js';

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

/**
 * A `static` field is a property access on the identifier naming the class, so
 * asking for a `this` receiver read every instance field and no static one.
 * A video platform declares 63 of these, and they were the sole reason none of its 252
 * browser requests joined a route (R103).
 */
describe('a settings value kept in a static property', () => {
  it('is followed back to the settings, as the same value on the instance is', () => {
    const file = parse(`
      class Service {
        private static BASE = environment.apiUrl;
        list() { return http.get(\`\${Service.BASE}/orders\`); }
      }
    `);
    expect(read(file)).toMatchObject({ value: '/orders', envRefs: ['apiUrl'] });
  });

  // Both halves of R103's shape at once: the field is reached through the class
  // that names it, and its value is the settings key joined to a path with `+`.
  // `rootSettingAddress` rather than the reader above, because the reader here
  // is configured to ask only for the key, and the path the field already wrote
  // is the half that was lost.
  it('answers with the path the field wrote as well as the key, joined with a plus', () => {
    const file = parse(`
      class Service {
        private static BASE = environment.apiUrl + '/orders';
        one(id: string) { return http.get(\`\${Service.BASE}/\${id}\`); }
      }
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({
      key: 'apiUrl',
      prefix: '/orders',
    });
  });

  it('holds a piece of the field nobody can read as a hole rather than dropping it', () => {
    const file = parse(`
      declare const anything: string;
      class Service {
        private static BASE = environment.apiUrl + anything;
        list() { return http.get(\`\${Service.BASE}/orders\`); }
      }
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0]!;
    // An address nothing can match, which is the point: dropping the hole would
    // report this request against `/orders`, a route it may never reach.
    expect(rootSettingAddress(opening, { readSetting })?.prefix).toBe(UNREAD_SPAN);
  });

  it('reads a piece of the path out of a static field as out of an instance one', () => {
    const file = parse(`
      class Service {
        private static SEGMENT = '/orders' + '/pay';
        private segment = '/orders/pay';
        pay() { return http.get(Service.SEGMENT); }
        payToo() { return http.get(this.segment); }
      }
    `);
    const calls = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => call.getExpression().getText().endsWith('.get'));
    expect(calls.map((call) => constantPropertyValue(call.getArguments()[0]!))).toEqual([
      '/orders/pay',
      '/orders/pay',
    ]);
  });

  it('says nothing when the receiver is an object rather than a class', () => {
    const file = parse(`
      declare const holder: { BASE: string };
      class Service {
        list() { return http.get(\`\${holder.BASE}/orders\`); }
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

/**
 * A segment written as a closed set of strings, which is a segment that was
 * written down — in the type system rather than in the expression (R31).
 */
describe('a segment whose type is a handful of strings', () => {
  const choicesIn = (source: string) => literalChoices(address(parse(source)));

  it('reads the values a union of string literals allows', () => {
    const [found] = choicesIn(
      "function f(id: string, action: 'ship' | 'refund') { http.get(`/x/${id}/${action}`); }",
    );
    expect(found?.values).toEqual(['refund', 'ship']);
  });

  it('says nothing about a segment typed as plain text', () => {
    // Which is nearly every segment, and the reason this costs nothing.
    expect(choicesIn('function f(id: string) { http.get(`/x/${id}`); }')).toEqual([]);
  });

  it('says nothing about a union with an arm that is not a literal', () => {
    expect(
      choicesIn("function f(a: 'one' | string) { http.get(`/x/${a}`); }"),
    ).toEqual([]);
  });

  it('says nothing about a union of one, which is not a choice', () => {
    expect(choicesIn("function f(a: 'only') { http.get(`/x/${a}`); }")).toEqual([]);
  });

  it('stops at the cap rather than standing for a domain', () => {
    // Past a dozen the union is a currency or a locale, not a choice, and the
    // segment is better read as the hole it is.
    const many = Array.from({ length: 13 }, (_, index) => `'v${index}'`).join(' | ');
    expect(choicesIn(`function f(a: ${many}) { http.get(\`/x/\${a}\`); }`)).toEqual([]);
    const few = Array.from({ length: 12 }, (_, index) => `'v${index}'`).join(' | ');
    expect(choicesIn(`function f(a: ${few}) { http.get(\`/x/\${a}\`); }`)[0]?.values).toHaveLength(12);
  });

  it('says nothing about a value that is not a parameter', () => {
    // A local holding one of two strings is settled where it is written, and
    // the reader that follows values is the one that should answer for it.
    expect(
      choicesIn("function f() { const a: 'one' | 'two' = 'one'; http.get(`/x/${a}`); }"),
    ).toEqual([]);
  });
});
