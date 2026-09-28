import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  forwardedFrom,
  isReadable,
  rootConfigKey,
  settingReader,
  splitAtParameterIn,
} from './trace.js';

const splitAtParameter = (node: Parameters<typeof splitAtParameterIn>[0]) =>
  splitAtParameterIn(node, settingReader);

const HEADER = `
declare const process: { env: Record<string, string | undefined> };
interface RequestInit { method?: string; body?: string }
interface Response { text(): Promise<string> }
declare function fetch(input: string, init?: RequestInit): Promise<Response>;
declare class ConfigService {
  get<T = string>(key: string): T | undefined;
}
`;

const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', `${HEADER}${source}`);

/** The one `fetch(...)` in the source, which is what every case ends at. */
const fetchCall = (file: SourceFile): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith('fetch'));
  if (call === undefined) throw new Error('no fetch call in the source');
  return call;
};

const address = (file: SourceFile) => fetchCall(file).getArguments()[0]!;

describe('following a value back to a settings key', () => {
  it('reads one written where it is used', () => {
    const file = parse(`
      class C {
        config!: ConfigService;
        go() { return fetch(\`\${this.config.get('ORDERS_URL')}/orders\`); }
      }
    `);
    expect(rootConfigKey(address(file))).toBe('ORDERS_URL');
  });

  it('follows a property the constructor assigned', () => {
    const file = parse(`
      class C {
        private readonly base: string;
        constructor(private readonly config: ConfigService) {
          this.base = this.config.get('ORDERS_URL') ?? '';
        }
        go() { return fetch(\`\${this.base}/orders\`); }
      }
    `);
    expect(rootConfigKey(address(file))).toBe('ORDERS_URL');
  });

  it('is not put off by trimming and a ternary on the way', () => {
    const file = parse(`
      class C {
        private readonly base: string;
        constructor(private readonly config: ConfigService) {
          const raw = this.config.get('ORDERS_URL') ?? '';
          this.base = raw.replace(/\\/+$/, '').endsWith('/api')
            ? raw.replace(/\\/+$/, '')
            : \`\${raw.replace(/\\/+$/, '')}/api\`;
        }
        go() { return fetch(\`\${this.base}/orders\`); }
      }
    `);
    expect(rootConfigKey(address(file))).toBe('ORDERS_URL');
  });

  it('follows an accessor the class reads its own address through', () => {
    const file = parse(`
      class C {
        private base(): string { return process.env.BILLING_URL ?? ''; }
        go() { return fetch(\`\${this.base()}/invoices\`); }
      }
    `);
    expect(rootConfigKey(address(file))).toBe('BILLING_URL');
  });

  it('follows a constructor argument to where the client was built', () => {
    const file = parse(`
      class Client {
        constructor(private readonly baseUrl: string) {}
        go(path: string) { return fetch(\`\${this.baseUrl}\${path}\`); }
      }
      class Owner {
        private readonly api: Client;
        constructor(private readonly config: ConfigService) {
          this.api = new Client(this.config.get('ORDERS_URL') ?? '');
        }
      }
    `);
    const template = address(file).asKindOrThrow(SyntaxKind.TemplateExpression);
    expect(rootConfigKey(template.getTemplateSpans()[0]!.getExpression())).toBe('ORDERS_URL');
  });

  it('says nothing when the address comes from somewhere it cannot follow', () => {
    const file = parse(`
      class C {
        go(base: { pick(): string }) { return fetch(\`\${base.pick()}/orders\`); }
      }
    `);
    expect(rootConfigKey(address(file))).toBeNull();
  });
});

describe('splitting an address at the part a caller supplies', () => {
  const client = `
    class Client {
      constructor(private readonly baseUrl: string) {}
      get(path: string) { return this.request('GET', path); }
      private request(method: string, path: string) {
        const url = \`\${this.baseUrl}\${path}\`;
        return fetch(url, { method });
      }
    }
  `;

  it('keeps the base and marks the hole', () => {
    const file = parse(client);
    const split = splitAtParameter(address(file));
    expect(split?.parameter.getName()).toBe('path');
    expect(split?.before).toBe('');
    expect(split?.after).toBe('');
  });

  it('keeps the literal text on either side of the hole', () => {
    const file = parse(`
      class C {
        go(id: string) { return fetch(\`https://x/orders/\${id}/items\`); }
      }
    `);
    const split = splitAtParameter(address(file));
    expect(split?.before).toBe('https://x/orders/');
    expect(split?.after).toBe('/items');
  });

  it('refuses an address with two holes, since which caller argument is which is a guess', () => {
    const file = parse(`
      class C {
        go(a: string, b: string) { return fetch(\`/x/\${a}/y/\${b}\`); }
      }
    `);
    expect(splitAtParameter(address(file))).toBeUndefined();
  });

  it('finds who supplies the missing part, through the layer in between', () => {
    const file = parse(`
      ${client}
      class OrdersService {
        api!: Client;
        findOne(id: string) { return this.api.get(\`/orders/\${id}\`); }
        all() { return this.api.get('/orders'); }
      }
    `);
    const split = splitAtParameter(address(file));
    const callers = forwardedFrom(split!.parameter);
    expect(callers.calls.map((caller) => caller.argument.getText())).toEqual([
      '`/orders/${id}`',
      "'/orders'",
    ]);
    expect(callers.undecided).toBe(false);
  });

  it('reports no caller for a client nothing uses, rather than an imaginary one', () => {
    const file = parse(client);
    const split = splitAtParameter(address(file));
    expect(forwardedFrom(split!.parameter)).toEqual({ calls: [], undecided: false });
  });
});

/**
 * A call belongs to the method it dispatches to (R158).
 *
 * The compiler's references of a method that implements an interface take in
 * every implementation's calls through the interface member. Only the calls
 * whose name resolves to this very method run it.
 */
describe('following a parameter out to the calls that run the method', () => {
  const calendars = `
    interface Calendar { remove(uid: string): Promise<Response> }
    class Basecamp implements Calendar {
      remove(uid: string) { return fetch(\`/trash/\${uid}\`); }
      tidy() { return this.remove('draft'); }
    }
    class Zoho implements Calendar {
      remove(uid: string) { return Promise.resolve({} as Response); }
      tidy() { return this.remove('stale'); }
    }
  `;
  const callersOf = (source: string) => {
    const split = splitAtParameter(address(parse(source)));
    const found = forwardedFrom(split!.parameter);
    return {
      calls: found.calls.map((caller) => caller.argument.getText()),
      undecided: found.undecided,
    };
  };

  it("leaves a sibling's call through `this` to the sibling", () => {
    expect(callersOf(calendars)).toEqual({ calls: ["'draft'"], undecided: false });
  });

  it('attributes nothing to a call through the interface, and says one is there', () => {
    expect(
      callersOf(`${calendars}
        class Manager { drop(calendar: Calendar) { return calendar.remove('gone'); } }
      `),
    ).toEqual({ calls: ["'draft'"], undecided: true });
  });

  it('follows a call through the concrete class, and one of a union holding a sibling not at all', () => {
    expect(
      callersOf(`${calendars}
        class Manager {
          archive(basecamp: Basecamp) { return basecamp.remove('archived'); }
          either(calendar: Basecamp | Zoho) { return calendar.remove('either'); }
        }
      `),
    ).toEqual({ calls: ["'draft'", "'archived'"], undecided: true });
  });

  it("reaches a subclass's override only through its `super` call", () => {
    // `this.remove('mine')` in Loud runs Loud's override, which hands the value
    // on to this one through `super`; Quiet overrides nothing, so its call runs
    // this one directly.
    const found = callersOf(`
      class Base {
        remove(uid: string) { return fetch(\`/trash/\${uid}\`); }
      }
      class Loud extends Base {
        remove(uid: string) { return super.remove(uid); }
        tidy() { return this.remove('mine'); }
      }
      class Quiet extends Base {
        tidy() { return this.remove('inherited'); }
      }
    `);
    expect({ ...found, calls: [...found.calls].sort() }).toEqual({
      calls: ["'inherited'", "'mine'"],
      undecided: false,
    });
  });

  it('calls a call through a base class the method overrides undecided', () => {
    expect(
      callersOf(`
        abstract class Store { abstract remove(uid: string): Promise<Response>; }
        class Disk extends Store {
          remove(uid: string) { return fetch(\`/trash/\${uid}\`); }
        }
        class Memory extends Store {
          remove(uid: string) { return Promise.resolve({} as Response); }
        }
        const clear = (store: Store) => store.remove('all');
      `),
    ).toEqual({ calls: [], undecided: true });
  });
});

describe('deciding whether an address can be read where it stands', () => {
  it('accepts a literal', () => {
    const file = parse(`class C { go() { return fetch('/orders'); } }`);
    expect(isReadable(address(file))).toBe(true);
  });

  it('accepts a name given a literal that cannot change', () => {
    const file = parse(`class C { go() { const u = '/orders'; return fetch(u); } }`);
    expect(isReadable(address(file))).toBe(true);
  });

  it('refuses a name that can be reassigned between the two', () => {
    const file = parse(`
      class C {
        go(extra: boolean) {
          let u = '/orders';
          if (extra) u += '/active';
          return fetch(u);
        }
      }
    `);
    expect(isReadable(address(file))).toBe(false);
  });

  it('refuses an address whose middle is a parameter', () => {
    const file = parse(`class C { go(id: string) { return fetch(\`/orders/\${id}\`); } }`);
    expect(isReadable(address(file))).toBe(false);
  });
});
