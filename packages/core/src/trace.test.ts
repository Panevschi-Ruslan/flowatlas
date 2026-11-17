import { Project, SyntaxKind, type CallExpression, type SourceFile, type TemplateExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { UNREAD_SPAN } from './ids.js';
import { resolveStaticString, settingKeyIn } from './static-string.js';
import {
  callSitesOf,
  constantMethodResult,
  constantPropertyValue,
  forwardedFrom,
  forwardNoWorse,
  parameterBehind,
  argumentAlong,
  optionVerbAlong,
  optionVerbOf,
  verbAlong,
  verbParameterOf,
  verbsAtCallers,
  literalChoices,
  memberBehind,
  splitAtParameter,
  continuesHost,
  returnedExpression,
  rootSettingAddress,
  valueAfterHost,
  valueAtPort,
  atPortPlace,
  numberAfterHost,
  portWithoutColonRow,
  writtenNumber,
  writtenSpan,
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
const settingBehind = (node: Parameters<typeof rootSettingAddress>[0]) => {
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
  const key = rootSettingAddress(node, { readSetting })?.key;
  return key === undefined ? null : { key };
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

  // A constant that is a chain of `||` over settings (P292): the first
  // setting, read through the function that only puts a scheme in front of
  // it, is the root, and the text the chain ends in is its fallback.
  it('roots a chain of || at its first setting, through a function that only normalises it, with the text it ends in as the fallback', () => {
    const file = parse(`
      declare const other: { url: string };
      function withScheme(url: string | undefined): string {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        return \`https://\${url}\`;
      }
      const PREVIEW = other.url ? \`https://\${other.url}\` : '';
      const APP_URL = withScheme(environment.apiUrl) || PREVIEW || 'http://localhost:3000';
      http.get(\`\${APP_URL}/api/me\`);
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({ key: 'apiUrl', prefix: '', otherwise: 'http://localhost:3000', otherwiseFile: '/a.ts' });
  });

  // P296: a chain read as one step however long, later settings as further
  // fallbacks, and the fallback said where it is written.
  it('reads a long chain of || as one step, the settings after the first as where it goes next', () => {
    const file = parse(`
      function withScheme(url: string | undefined): string {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        return \`https://\${url}\`;
      }
      declare const other: { a: string; b: string; c: string };
      const A = other.a ? \`https://\${other.a}\` : '';
      const B = other.b ? \`https://\${other.b}.example.test\` : '';
      const C = other.c ? \`https://\${other.c}\` : '';
      const APP_URL = withScheme(environment.apiUrl) || A || B || C || environment.secondUrl || environment.thirdUrl || 'http://localhost:3000';
      http.get(\`\${APP_URL}/api/me\`);
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({
      key: 'apiUrl',
      prefix: '',
      also: ['secondUrl', 'thirdUrl'],
      otherwise: 'http://localhost:3000',
      otherwiseFile: '/a.ts',
    });
  });

  it('says a chain written in another module falls back in that module', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('constants.ts', `${HEADER}export const APP_URL = environment.apiUrl ?? environment.secondUrl ?? 'http://localhost:3000';`);
    const file = project.createSourceFile('a.ts', `${HEADER}import { APP_URL } from './constants';\nhttp.get(\`\${APP_URL}/api/me\`);`);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({
      key: 'apiUrl',
      prefix: '',
      also: ['secondUrl'],
      otherwise: 'http://localhost:3000',
      otherwiseFile: '/constants.ts',
    });
  });

  it('reads a function per branch where its arguments settle the branch, and both as a condition in place where nothing does', () => {
    const settled = parse(`
      function pick(url: string, flag: boolean): string {
        if (flag) return \`\${url}/admin\`;
        return url;
      }
      const BASE = pick(environment.apiUrl, true);
      http.get(\`\${BASE}/orders\`);
    `);
    const opening = address(settled).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({ key: 'apiUrl', prefix: '/admin' });
    const other = parse(`
      function pick(url: string, flag: boolean): string {
        if (!flag) { return url; }
        return \`\${url}/admin\`;
      }
      const BASE = pick(environment.apiUrl, false);
      http.get(\`\${BASE}/orders\`);
    `);
    expect(rootSettingAddress(address(other).getDescendantsOfKind(SyntaxKind.Identifier)[0]!, { readSetting })).toEqual({ key: 'apiUrl', prefix: '' });
    const open = parse(`
      declare const flag: boolean;
      function pick(url: string, admin: boolean): string {
        if (admin) return \`\${url}/admin\`;
        return url;
      }
      const BASE = pick(environment.apiUrl, flag);
      http.get(\`\${BASE}/orders\`);
    `);
    // P302: the two returns agree on the setting, and on the path as far as
    // they agree with the rest a hole, as the same condition written in place does.
    expect(rootSettingAddress(address(open).getDescendantsOfKind(SyntaxKind.Identifier)[0]!, { readSetting })).toEqual({ key: 'apiUrl', prefix: UNREAD_SPAN });
  });

  // P302: branches nobody settles that read different settings are one of the
  // two: the first is the key, the second where it may go instead, guessed.
  it('reads a condition nobody settles over two settings as the first with the second as also, in place and in a helper alike', () => {
    const expected = { key: 'apiUrl', prefix: '', guessed: true, also: ['devUrl'], either: ['apiUrl', 'devUrl'] };
    const inPlace = parse(`
      declare const isProd: boolean;
      http.get(\`\${isProd ? environment.apiUrl : environment.devUrl}/orders\`);
    `);
    const branch = address(inPlace).getDescendantsOfKind(SyntaxKind.ConditionalExpression)[0]!;
    expect(rootSettingAddress(branch, { readSetting })).toEqual(expected);
    const call = (file: SourceFile) => address(file).getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;
    const helper = parse(`
      declare const isProd: boolean;
      const base = () => isProd ? environment.apiUrl : environment.devUrl;
      http.get(\`\${base()}/orders\`);
    `);
    expect(rootSettingAddress(call(helper), { readSetting })).toEqual(expected);
    const returns = parse(`
      declare const isProd: boolean;
      function base(): string {
        if (isProd) return \`\${environment.apiUrl}/v1\`;
        return \`\${environment.devUrl}/v1\`;
      }
      http.get(\`\${base()}/orders\`);
    `);
    expect(rootSettingAddress(call(returns), { readSetting })).toEqual({ key: 'apiUrl', prefix: '/v1', guessed: true, also: ['devUrl'], either: ['apiUrl', 'devUrl'] });
    const fallback = parse(`
      declare const isProd: boolean;
      const base = () => isProd ? environment.apiUrl : environment.devUrl ?? 'http://localhost:4000';
      http.get(\`\${base()}/orders\`);
    `);
    expect(rootSettingAddress(call(fallback), { readSetting })).toEqual({ ...expected, otherwise: 'http://localhost:4000', otherwiseFile: '/a.ts' });
  });

  // P309: every branch's setting is an equal candidate, nested conditions too.
  it('keeps the settings of every branch nobody settles in either, the first branch first', () => {
    const nested = parse(`
      declare const isProd: boolean;
      declare const isStage: boolean;
      http.get(\`\${isProd ? environment.apiUrl : isStage ? environment.stageUrl : environment.devUrl}/orders\`);
    `);
    const branch = address(nested).getDescendantsOfKind(SyntaxKind.ConditionalExpression)[0]!;
    expect(rootSettingAddress(branch, { readSetting })).toMatchObject({ key: 'apiUrl', either: ['apiUrl', 'stageUrl', 'devUrl'] });
    // One setting on both sides is no choice between settings.
    const same = parse(`
      declare const isProd: boolean;
      http.get(\`\${isProd ? \`\${environment.apiUrl}/v1\` : \`\${environment.apiUrl}/v2\`}/orders\`);
    `);
    expect(rootSettingAddress(address(same).getDescendantsOfKind(SyntaxKind.ConditionalExpression)[0]!, { readSetting })?.either).toBeUndefined();
  });

  // P302: a function handed nothing that reads the setting inside is the setting.
  it('reads a function called with no arguments as what it returns', () => {
    const call = (file: SourceFile) => address(file).getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;
    const plain = parse(`
      function apiBase() { return environment.apiUrl ?? 'http://localhost:4000'; }
      http.get(\`\${apiBase()}/users\`);
    `);
    expect(rootSettingAddress(call(plain), { readSetting })).toEqual({ key: 'apiUrl', prefix: '', otherwise: 'http://localhost:4000', otherwiseFile: '/a.ts' });
    const member = parse(`
      const urls = { api: () => \`\${environment.apiUrl}/api\` };
      http.get(\`\${urls.api()}/users\`);
    `);
    expect(rootSettingAddress(call(member), { readSetting })).toEqual({ key: 'apiUrl', prefix: '/api' });
    // A parameter it is not handed holds its default, which settles the branch.
    const optional = parse(`
      function api(tail = '') { return tail ? \`\${environment.apiUrl}/\${tail}\` : environment.apiUrl; }
      http.get(\`\${api()}/users\`);
    `);
    expect(rootSettingAddress(call(optional), { readSetting })).toEqual({ key: 'apiUrl', prefix: '' });
  });

  it('reads a function an object holds as a plain one', () => {
    const file = parse(`
      const urls = {
        withScheme(url: string): string { return url.startsWith('http') ? url : \`https://\${url}\`; },
        under: (url: string) => \`\${url}/api\`,
      };
      const BASE = urls.under(urls.withScheme(environment.apiUrl));
      http.get(\`\${BASE}/orders\`);
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({ key: 'apiUrl', prefix: '/api' });
  });

  it('reads the path a function writes after the setting it is handed', () => {
    const file = parse(`
      const under = (base: string) => \`\${base}/api\`;
      const BASE = under(environment.apiUrl);
      http.get(\`\${BASE}/orders\`);
    `);
    const opening = address(file).getDescendantsOfKind(SyntaxKind.Identifier)[0]!;
    expect(rootSettingAddress(opening, { readSetting })).toEqual({ key: 'apiUrl', prefix: '/api' });
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

  it('reads a non-empty fallback, and not an empty one, which says there is no value', () => {
    const file = parse(`
      declare const auth: { accountId(): string | null; base(): string | null };
      class Service {
        private get rid(): string { return auth.accountId() ?? ''; }
        private get prefix(): string { return auth.base() || '/api'; }
        one() { return http.get(this.rid); }
        two() { return http.get(this.prefix); }
      }
    `);
    const calls = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => call.getExpression().getText().endsWith('.get'));
    // An id that may be missing is a hole in the path, never an empty segment
    // (R165, found on a real admin client whose request lost a segment).
    expect(calls.map((call) => constantPropertyValue(call.getArguments()[0]!))).toEqual([
      null,
      '/api',
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
    rootSettingAddress(address(file), {
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

/**
 * Where a value forwarded out of a helper is drawn: at each caller that reads
 * it at least as surely as the helper does, and in the helper as well whenever
 * one falls short or cannot be named.
 */
describe('forwarding no worse than the helper', () => {
  const hop = (text: string) => {
    const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `go(${text});`);
    const site = file.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression);
    return { site, argument: site.getArguments()[0]!, hops: [site] };
  };
  const sureness = (reading: string) => ({ unread: 0, partial: 1, read: 2 })[reading] ?? 0;
  const decide = (here: string, readings: string[], undecided = false) => {
    const calls = readings.map(hop);
    const forwarding = forwardNoWorse(
      { calls, undecided },
      { here, at: (call) => (call.argument.getText() === 'nobody' ? undefined : call.argument.getText()), sureness },
    );
    return { callers: forwarding.callers.map((caller) => caller.reading), here: forwarding.here };
  };

  it('draws on every caller at least as sure, and leaves the helper', () => {
    expect(decide('partial', ['read', 'partial'])).toEqual({ callers: ['read', 'partial'], here: false });
  });

  it('keeps the helper for a caller that reads less, and still draws on the others', () => {
    expect(decide('partial', ['read', 'unread'])).toEqual({ callers: ['read'], here: true });
  });

  it('keeps the helper when nobody can be drawn on, or a call may run another implementation', () => {
    expect(decide('unread', ['nobody'])).toEqual({ callers: [], here: true });
    expect(decide('unread', [])).toEqual({ callers: [], here: true });
    expect(decide('unread', ['read'], true)).toEqual({ callers: ['read'], here: true });
  });
});

/**
 * A verb a wrapper is handed, read at each caller (P91): through one wrapper
 * and two, as a literal, an enum member, a member of an `as const` object and
 * a parameter's default, and kept unread where a caller hands on something
 * nothing reads.
 */
describe('the verb a wrapper is handed', () => {
  const source = `
    enum HttpVerb { Delete = 'DELETE' }
    const VERBS = { patch: 'PATCH' } as const;
    declare function fetch(url: string, init?: { method?: string }): Promise<unknown>;
    class Client {
      req(method: string, path: string) { return fetch(path, { method }); }
      byDefault(path: string, method = 'put') { return this.req(method, path); }
      patch(path: string) { return this.req(VERBS.patch, path); }
    }
    class Screen {
      constructor(private readonly api: Client) {}
      create() { return this.api.req('POST', '/items'); }
      remove() { return this.api.req(HttpVerb.Delete, '/items/1'); }
      rename() { return this.api.patch('/items/1'); }
      replace() { return this.api.byDefault('/items/1'); }
      choose(verb: string) { return this.api.req(verb, '/items/2'); }
      pick(flag: boolean) { return this.choose(flag ? 'GET' : 'PUT'); }
    }
  `;
  const verbParameter = (file: SourceFile) => {
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch');
    const options = call!.getArguments()[1]!.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    return verbParameterOf(options.getProperty('method'))!;
  };

  it('finds the parameter a `{ method }` names', () => {
    expect(verbParameter(parse(source)).getName()).toBe('method');
  });

  it('reads the verb at every caller, out through a second wrapper', () => {
    const found = verbsAtCallers(verbParameter(parse(source)));
    const said = found.calls.map((each) => `${each.site.getText()} ${each.verb ?? 'unread'} ${each.hops.length}`).sort();
    expect(said).toEqual([
      "this.api.byDefault('/items/1') PUT 2",
      "this.api.req('POST', '/items') POST 1",
      "this.api.req(HttpVerb.Delete, '/items/1') DELETE 1",
      "this.choose(flag ? 'GET' : 'PUT') unread 2",
      'this.req(VERBS.patch, path) PATCH 1',
    ]);
    expect(found.undecided).toBe(false);
  });

  it('reads it along the calls an address was followed out through', () => {
    const file = parse(source);
    const parameter = verbParameter(file);
    const path = parameterBehind(file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch')!.getArguments()[0]!)!;
    const said = forwardedFrom(path)
      .calls.map((each) => `${each.site.getText()} ${verbAlong(parameter, each.hops) ?? 'unread'}`)
      .sort();
    expect(said).toEqual([
      "this.api.byDefault('/items/1') PUT",
      "this.api.patch('/items/1') PATCH",
      "this.api.req('POST', '/items') POST",
      "this.api.req(HttpVerb.Delete, '/items/1') DELETE",
      "this.api.req(verb, '/items/2') unread",
    ]);
  });
});

/**
 * A verb read out of a member of the options a wrapper is handed, with a
 * default it falls back to (R179): left out, handed `undefined`, handed an
 * object with no such member, one that writes it, one held by a `const`, and
 * one spreading another that may carry it.
 */
describe('the verb an options member gives, or its default', () => {
  const source = `
    declare function fetch(url: string, init?: { method?: string }): Promise<unknown>;
    declare const more: { method?: string };
    const READ = { method: 'GET' };
    const send = async (url: string, body?: unknown, options?: { method?: string }) => {
      const method = options?.method || 'POST';
      return fetch(url, { method, ...options });
    };
    const create = () => send('/api/orders', {});
    const me = () => send('/api/orders/me', {}, { method: 'GET' });
    const drop = () => send('/api/orders/1', undefined, { method: 'delete' });
    const quiet = () => send('/api/orders/2', {}, undefined);
    const tagged = () => send('/api/orders/3', {}, { cache: 'no-store' } as { method?: string });
    const held = () => send('/api/orders/4', {}, READ);
    const spread = () => send('/api/orders/5', {}, { ...more });
    const along = (options?: { method?: string }) => send('/api/orders/6', {}, options);
    const outer = () => along({ method: 'PUT' });
  `;
  const fetchCall = (file: SourceFile): CallExpression =>
    file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch')!;
  const optionVerb = (file: SourceFile) => {
    const options = fetchCall(file).getArguments()[1]!.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    return optionVerbOf(options.getProperty('method'))!;
  };

  it('finds the member and the default a `{ method }` names through its const', () => {
    const found = optionVerb(parse(source));
    expect([found.parameter.getName(), found.key, found.otherwise]).toEqual(['options', 'method', 'POST']);
    // A parameter of its own is the other reading's, and a default that is no verb is nothing.
    expect(optionVerbOf(parse(`const f = (method: string) => method;`).getDescendantsOfKind(SyntaxKind.Identifier).at(-1))).toBeUndefined();
    const notVerb = parse(`const f = (o?: { m?: string }) => { const m = o?.m ?? 'fast'; return m; };`);
    expect(optionVerbOf(notVerb.getDescendantsOfKind(SyntaxKind.Identifier).at(-1))).toBeUndefined();
  });

  it('reads each caller along the calls the address was followed out through', () => {
    const file = parse(source);
    const found = optionVerb(file);
    const path = parameterBehind(fetchCall(file).getArguments()[0]!)!;
    const said = forwardedFrom(path)
      .calls.map((each) => `${each.site.getText()} ${optionVerbAlong(found, each.hops) ?? 'unread'}`)
      .sort();
    // The address of the sixth is settled where it is written, so its options
    // are still a parameter there and the verb is not read further out.
    expect(said).toEqual([
      "send('/api/orders', {}) POST",
      "send('/api/orders/1', undefined, { method: 'delete' }) DELETE",
      "send('/api/orders/2', {}, undefined) POST",
      "send('/api/orders/3', {}, { cache: 'no-store' } as { method?: string }) POST",
      "send('/api/orders/4', {}, READ) GET",
      "send('/api/orders/5', {}, { ...more }) unread",
      "send('/api/orders/6', {}, options) unread",
      "send('/api/orders/me', {}, { method: 'GET' }) GET",
    ]);
  });
});

/**
 * Whatever else a wrapper is handed beside the address (P128): its body, read
 * along the same calls, out through a wrapper that hands it on and stopping at
 * the caller that writes it, or at the parameter of the caller the request is
 * credited to.
 */
describe('the value a wrapper is handed beside the address', () => {
  const source = `
    declare function fetch(url: string, init?: { method?: string; body?: string }): Promise<unknown>;
    class Client {
      req(method: string, path: string, body?: unknown) { return fetch(path, { method, body: JSON.stringify(body) }); }
      post(path: string, body: unknown) { return this.req('POST', path, body); }
    }
    class Screen {
      constructor(private readonly api: Client) {}
      create(item: { title: string }) { return this.api.post('/items', item); }
      rename() { return this.api.req('PATCH', '/items/1', { title: 'x' }); }
      empty() { return this.api.req('DELETE', '/items/2'); }
    }
  `;

  it('reads it at each caller the address was followed out to', () => {
    const file = parse(source);
    const fetchCall = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch')!;
    const path = parameterBehind(fetchCall.getArguments()[0]!)!;
    const body = file.getDescendantsOfKind(SyntaxKind.Parameter).find((each) => each.getName() === 'body' && each.getParent()?.getText().startsWith('req'))!;
    const said = forwardedFrom(path)
      .calls.map((each) => `${each.site.getText()} ${argumentAlong(body, each.hops)?.getText() ?? 'nothing'}`)
      .sort();
    expect(said).toEqual([
      "this.api.post('/items', item) item",
      "this.api.req('DELETE', '/items/2') nothing",
      "this.api.req('PATCH', '/items/1', { title: 'x' }) { title: 'x' }",
    ]);
  });
});

describe('an argument a caller leaves out', () => {
  it('is the parameter\'s default, read where the helper writes it', () => {
    const file = parse(`
      declare function fetch(url: string): Promise<unknown>;
      export function list(suffix = '') { return fetch(\`/items\${suffix}\`); }
      export function none(suffix?: string) { return fetch(\`/items\${suffix}\`); }
      export const all = () => list();
      export const one = () => list('/1');
      export const nothing = () => none();
    `);
    const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).filter((each) => each.getExpression().getText() === 'fetch');
    const of = (index: number) =>
      forwardedFrom(parameterBehind(calls[index]!.getArguments()[0]!.asKindOrThrow(SyntaxKind.TemplateExpression).getTemplateSpans()[0]!.getExpression())!)
        .calls.map((each) => each.argument.getText())
        .sort();
    expect(of(0)).toEqual(["''", "'/1'"]);
    // No default: a caller that hands nothing hands nothing worth following.
    expect(of(1)).toEqual([]);
  });
});

/**
 * A wrapper that takes its request as one object and its members out where the
 * parameter is written (P269): `({ url = '', method = 'GET' }) => fetch(url,
 * { method })`. The address and the verb are each a member of what a caller
 * hands it, and the default where the caller's object writes none.
 */
describe('a member a wrapper takes out of the object it is handed', () => {
  const source = `
    declare function fetch(url: string, init?: { method?: string }): Promise<unknown>;
    declare const elsewhere: { url: string };
    const request = ({ url = '', method = 'GET' }: { url?: string; method?: string }) => fetch(\`\${url}?x=1\`, { method });
    const list = () => request({ url: '/api/basket' });
    const add = () => request({ url: '/api/basket', method: 'POST' });
    const bare = () => request({});
    const passed = (options: { url: string; method?: string }) => request(options);
    const outer = () => passed({ url: '/api/outer', method: 'DELETE' });
    const unknown = () => request(elsewhere);
  `;
  const fetchCall = (file: SourceFile): CallExpression =>
    file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'fetch')!;

  it('splits the address at the member and finds each caller\'s, through a wrapper that hands the object on', () => {
    const file = parse(source);
    const split = splitAtParameter(fetchCall(file).getArguments()[0]!, { readSetting: () => null })!;
    expect([split.member?.key, split.before, split.after]).toEqual(['url', '', '?x=1']);
    const verb = optionVerbOf(fetchCall(file).getArguments()[1]!.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('method'))!;
    expect([verb.key, verb.otherwise]).toEqual(['method', 'GET']);
    const said = forwardedFrom(split.parameter, undefined, split.member)
      .calls.map((each) => `${each.argument.getText()} ${optionVerbAlong(verb, each.hops) ?? 'unread'}`)
      .sort();
    // `bare` hands an object with no `url`: the default. `unknown` hands one
    // nobody here wrote, and is not a caller this can draw on.
    expect(said).toEqual(["'' GET", "'/api/basket' GET", "'/api/basket' POST", "'/api/outer' DELETE"]);
  });

  it('is a member only of a parameter, not of a value destructured anywhere else', () => {
    const file = parse(`const { url } = { url: '/x' }; export const u = url;`);
    expect(memberBehind(file.getDescendantsOfKind(SyntaxKind.Identifier).at(-1)!)).toBeUndefined();
  });
});

describe('a function a library composes into another (P285)', () => {
  /** The calls `callSitesOf` finds of `run`, as the text of each. */
  const sitesOfRun = (files: Record<string, string>): string[] => {
    const project = new Project({ useInMemoryFileSystem: true });
    for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
    const run = project.getSourceFileOrThrow('run.ts').getVariableDeclarationOrThrow('run');
    return callSitesOf(run)
      .map((call) => call.getText())
      .sort();
  };

  it('is called by each call of what flow, a namespace pipe or flowRight makes of it', () => {
    const sites = sitesOfRun({
      'run.ts': `export const run = (args: { query: string }) => args.query;`,
      'quiet.ts': [
        `import { flow } from 'fp-ts/function';`,
        `import * as R from 'ramda';`,
        `import flowRight from 'lodash/flowRight';`,
        `import { run } from './run';`,
        `export const quiet = flow(run, (result) => result);`,
        `export const piped = R.pipe(run, String);`,
        `export const right = flowRight(String, run);`,
        `export const twice = flow(quiet, String);`,
      ].join('\n'),
      'use.ts': [
        `import { quiet, piped, right, twice } from './quiet';`,
        `import { run } from './run';`,
        `run({ query: 'a' }); quiet({ query: 'b' }); piped({ query: 'c' }); right({ query: 'd' }); twice({ query: 'e' });`,
      ].join('\n'),
    });
    expect(sites).toEqual([`piped({ query: 'c' })`, `quiet({ query: 'b' })`, `right({ query: 'd' })`, `run({ query: 'a' })`, `twice({ query: 'e' })`]);
  });

  it('is called where the composition is called in place, and through a let, a field, a member and a composition handed on (P293)', () => {
    const sites = sitesOfRun({
      'run.ts': `export const run = (args: { query: string }) => args.query;`,
      'held.ts': [
        `import { flow } from 'lodash';`,
        `import { run } from './run';`,
        `flow(run, String)({ query: 'a' });`,
        `let later = flow(run, String);`,
        `later({ query: 'b' });`,
        `export const helpers = { quiet: flow(run, String) };`,
        `helpers.quiet({ query: 'c' });`,
        `export class Store {`,
        `  load = flow(run, String);`,
        `  save: (args: { query: string }) => string;`,
        `  constructor() { this.save = flow(run, String); }`,
        `  go() { this.load({ query: 'd' }); this.save({ query: 'e' }); }`,
        `}`,
        `flow(flow(run, String), String)({ query: 'f' });`,
      ].join('\n'),
    });
    expect(sites).toEqual([
      `flow(flow(run, String), String)({ query: 'f' })`,
      `flow(run, String)({ query: 'a' })`,
      `helpers.quiet({ query: 'c' })`,
      `later({ query: 'b' })`,
      `this.load({ query: 'd' })`,
      `this.save({ query: 'e' })`,
    ]);
  });

  it("is called through Remeda's data-last pipe, and through a composition a module exports as its default (P297)", () => {
    const sites = sitesOfRun({
      'run.ts': `export const run = (args: { query: string }) => args.query;`,
      'remeda.ts': [
        `import { pipe, piped } from 'remeda';`,
        `import * as R from 'remeda';`,
        `import { run } from './run';`,
        `export const quiet = piped(run, String);`,
        `export const older = R.createPipe(run, String);`,
        // Remeda's own pipe hands a value first: no composition.
        `export const applied = pipe(run, (fn) => fn);`,
      ].join('\n'),
      'default.ts': [`import flow from 'lodash/flow';`, `import { run } from './run';`, `export default flow(run, String);`].join('\n'),
      'use.ts': [
        `import { applied, older, quiet } from './remeda';`,
        `import loadQuiet from './default';`,
        `quiet({ query: 'a' }); older({ query: 'b' }); applied({ query: 'c' }); loadQuiet({ query: 'd' });`,
      ].join('\n'),
    });
    expect(sites).toEqual([`loadQuiet({ query: 'd' })`, `older({ query: 'b' })`, `quiet({ query: 'a' })`]);
  });

  it('is not called through a value-first pipe, a function handed later, or a composer of no library', () => {
    const sites = sitesOfRun({
      'run.ts': `export const run = (args: { query: string }) => args.query;`,
      'other.ts': [
        `import { pipe, flow } from 'fp-ts/function';`,
        `import { run } from './run';`,
        `declare const compose: (...fns: unknown[]) => (args: unknown) => unknown;`,
        `export const applied = pipe(run, (fn) => fn);`,
        `export const later = flow(String, run);`,
        `export const own = compose(String, run);`,
        `applied({ query: 'a' }); later('b'); own('c');`,
      ].join('\n'),
    });
    expect(sites).toEqual([]);
  });
});

describe('a value written straight after a host (P312)', () => {
  const after = (source: string) => {
    const value = valueAfterHost(address(parse(source)));
    return value === undefined ? undefined : { text: value.getText(), own: continuesHost(value) };
  };

  it('is found after the host with a path after it, and is the host\'s own only where everything it is followed to is a port or the rest of its name', () => {
    expect(after("function go(t: string) { return http.get(`https://shop${t}/orders`); } go('.example'); go('-eu.example');")).toEqual({ text: 't', own: true });
    expect(after("function go(v: string) { return http.get(`https://shop.example${v}/orders`); } go('/v1'); go('/v2');")).toEqual({ text: 'v', own: false });
    expect(after("function go(p: string) { return http.get(`http://localhost${p}/orders`); } go(':3000'); go(':3001');")).toEqual({ text: 'p', own: true });
    expect(after("function go(p: string) { return http.get(`http://localhost${p}/orders`); } go(':3000'); go('/v1');")).toEqual({ text: 'p', own: false });
    expect(after('function go(p: number) { return http.get(`http://localhost${p}/orders`); }')).toEqual({ text: 'p', own: true });
    expect(after("declare const on: boolean; declare const n: number; function go() { return http.get('http://localhost' + (on ? `:${n}` : '') + '/orders'); }")).toEqual({ text: "on ? `:${n}` : ''", own: true });
    expect(after('declare const x: string; function go() { return http.get(`https://shop.example${x}/orders`); }')).toEqual({ text: 'x', own: false });
  });

  it('is none after a colon, a dot or a dash, after a slash, or with nothing after it', () => {
    expect(after('declare const x: string; function go() { return http.get(`http://localhost:${x}/orders`); }')).toBeUndefined();
    expect(after('declare const x: string; function go() { return http.get(`https://calendar.example.${x}/api/v1`); }')).toBeUndefined();
    expect(after('declare const x: string; function go() { return http.get(`https://shop-${x}/orders`); }')).toBeUndefined();
    expect(after('declare const x: string; function go() { return http.get(`https://shop.example/${x}/orders`); }')).toBeUndefined();
    expect(after('declare const x: string; function go() { return http.get(`https://shop.example${x}`); }')).toBeUndefined();
  });
});

describe('a host or a port the evaluator does not read, read as the address readers read it (P318)', () => {
  it('locates a value after a host a method answers, and reads a port a class keeps as one', () => {
    const behind = address(
      parse(`
        class Ports { static stock = ':4700'; }
        class Probe {
          origin() { return 'http://localhost'; }
          check(port: string) { return http.get(\`\${this.origin()}\${port}/health\`); }
        }
        new Probe().check(':4600');
        new Probe().check(Ports.stock);
      `),
    );
    const value = valueAfterHost(behind);
    expect(value?.getText()).toBe('port');
    expect(continuesHost(value!)).toBe(true);
    // A reader that reads nothing the evaluator does not: the host is not located.
    expect(valueAfterHost(behind, () => null)).toBeUndefined();
  });

  it("finds the value in a host's port place, and nothing where the text before it is no host and a colon", () => {
    const port = (source: string) => valueAtPort(address(parse(source)))?.getText();
    expect(port('function go(port: number) { return http.get(`http://localhost:${port}/health`); }')).toBe('port');
    expect(port("function go(port: number) { return http.get('http://localhost:' + port + '/health'); }")).toBe('port');
    expect(port('function go(port: number) { return http.get(`http://localhost${port}/health`); }')).toBeUndefined();
    expect(port('function go(id: number) { return http.get(`http://localhost:4600/orders/${id}`); }')).toBeUndefined();
  });

  it('reads a span a class writes down: a method answering one string, a field holding one, a host only at the opening', () => {
    const file = parse(`
      class Api {
        static origin = 'https://shop.example';
        static prefix = '/v1';
        version() { return '/v2'; }
        go() { return http.get(\`\${Api.origin}\${Api.prefix}\${this.version()}\`); }
      }
    `);
    const [origin, prefix, version] = (address(file) as TemplateExpression).getTemplateSpans().map((span) => span.getExpression());
    expect(writtenSpan(origin!, true)).toBe('https://shop.example');
    expect(writtenSpan(origin!, false)).toBeNull();
    expect(writtenSpan(prefix!, false)).toBe('/v1');
    expect(writtenSpan(version!, false)).toBe('/v2');
  });
});

describe('a number a port place holds, and one written straight after a host (P324)', () => {
  it('reads a number a class or a module keeps: a field, a getter, a field the constructor writes, a method answering one', () => {
    const file = parse(`
      const KEPT = 4900;
      class Ports {
        static stock = 4700;
        static get catalog() { return 4600; }
        static label = ':4700';
      }
      class Local {
        port: number;
        constructor() { this.port = 4800; }
        other() { return 5000; }
        go() { return http.get(\`\${Ports.stock}\${Ports.catalog}\${KEPT}\${this.port}\${this.other()}\${Ports.label}\`); }
      }
    `);
    const spans = (address(file) as TemplateExpression).getTemplateSpans().map((span) => writtenNumber(span.getExpression()));
    expect(spans).toEqual(['4700', '4600', '4900', '4800', '5000', null]);
  });

  it('finds a number glued to a whole host, through a template or a + chain, and nothing after a colon, a dot or before more of the name', () => {
    const glued = (source: string) => {
      const found = numberAfterHost(address(parse(source)));
      return found === undefined ? undefined : [found.host, found.number];
    };
    expect(glued('const PORT = 4600; http.get(`http://localhost${PORT}/health`);')).toEqual(['localhost', '4600']);
    expect(glued("class P { static port = 4700; } http.get('http://127.0.0.1' + P.port + '/health');")).toEqual(['127.0.0.1', '4700']);
    expect(glued('const PORT = 4600; http.get(`http://localhost:${PORT}/health`);')).toBeUndefined();
    expect(glued("const PORT = ':4600'; http.get(`http://localhost${PORT}/health`);")).toBeUndefined();
    expect(glued('const N = 3; http.get(`http://node${N}.cluster.example/jobs`);')).toBeUndefined();
    expect(glued('const N = 3; http.get(`http://shop.example/items/${N}`);')).toBeUndefined();
  });

  it('says a port place, and reads a number there when an address is split at a parameter, never one in the path', () => {
    expect(atPortPlace('http://localhost:')).toBe(true);
    expect(atPortPlace('http://localhost')).toBe(false);
    expect(atPortPlace('http://localhost:4600/items:')).toBe(false);
    const file = parse(`
      class Ports { static stock = 4700; static page = 20; }
      function go(path: string) { return http.get(\`http://localhost:\${Ports.stock}/\${Ports.page}\${path}\`); }
    `);
    const split = splitAtParameter(address(file), { readSetting: () => null })!;
    // The page size is the path's: a hole, never read as the number it holds.
    expect(split.before).toBe(`http://localhost:4700/${UNREAD_SPAN}`);
  });

  it('builds the row said of a number with no colon: action after localhost or numbers, info after a name', () => {
    const local = portWithoutColonRow({ number: '4600', host: 'localhost' }, 'a.ts', 3, 'fetch(x)');
    expect([local.reason, local.level, local.meta]).toEqual(['address-port-without-colon', undefined, { number: '4600', host: 'localhost' }]);
    expect(portWithoutColonRow({ number: '3', host: 'worker' }, 'a.ts', 3, 'fetch(x)').level).toBe('info');
  });
});
