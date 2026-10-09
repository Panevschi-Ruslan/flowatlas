import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { forwardNoWorse } from '@flowatlas/core';
import {
  forwardedFrom,
  isReadable,
  rootConfigKey,
  settingReader,
  splitAtParameterIn,
} from './trace.js';
import { analyzeUrl, composeAddress, surenessOf } from './url.js';

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

/**
 * A helper written as a function of a module hands its caller's value on as a
 * method does (R175): called by its name, by a name it was imported as, or
 * through the namespace of its module.
 */
describe('following a parameter out of a function of a module', () => {
  const callersIn = (client: string, callers: string) => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('client.ts', `${HEADER}${client}`);
    project.createSourceFile('callers.ts', callers);
    const split = splitAtParameter(address(file));
    const found = forwardedFrom(split!.parameter);
    return { calls: found.calls.map((caller) => caller.argument.getText()).sort(), undecided: found.undecided };
  };
  const callers = `
    import { get } from './client';
    import { get as fetchOne } from './client';
    import * as client from './client';
    export const byName = () => get('orders');
    export const byAlias = () => fetchOne('items');
    export const byNamespace = () => client.get('holds');
    export const handedOn = (path: string) => get(path);
    export const outer = () => handedOn('loans');
    export const passed = [get];
  `;

  it('follows a const arrow out to every call of it, and a caller handing its own parameter on further', () => {
    expect(callersIn('export const get = (path: string) => fetch(`/api/${path}`);', callers)).toEqual({
      calls: ["'holds'", "'items'", "'loans'", "'orders'"],
      undecided: false,
    });
  });

  it('follows a function declaration the same way', () => {
    expect(
      callersIn('export function get(path: string) { return fetch(`/api/${path}`); }', callers).calls,
    ).toEqual(["'holds'", "'items'", "'loans'", "'orders'"]);
  });

  it('follows no `let`, which may hold another function by the time it is called', () => {
    expect(callersIn('export let get = (path: string) => fetch(`/api/${path}`);', callers)).toEqual({
      calls: [],
      undecided: false,
    });
  });
});

/**
 * A caller whose value is not read still fills the segment the request leaves
 * it, so following a request out to its caller never costs the address the
 * request itself states (R175).
 */
describe('putting an address back together around a value nobody read', () => {
  const unread = { url: null, path: null, baseUrlEnv: null, host: null };
  const around = (before: string, after: string) =>
    composeAddress(unread, { parameter: undefined as never, baseUrlEnv: null, before, after });

  it('keeps a hole that fills one segment a route parameter', () => {
    expect(around('https://api.example.com/repos/', '/tarball')).toEqual({
      url: 'https://api.example.com/repos/:param/tarball',
      path: '/repos/:param/tarball',
      baseUrlEnv: null,
      host: 'api.example.com',
    });
  });

  it('leaves an address whose hole may span segments unread', () => {
    expect(around('/repos', '/tarball').path).toBeNull();
    expect(around('', '').path).toBeNull();
  });
});

describe('putting an address back together around a value a caller wrote', () => {
  const split = (before: string, after: string) => ({ parameter: undefined as never, baseUrlEnv: null, before, after });
  const written = (value: string) => ({ url: value, path: `/${value}`, baseUrlEnv: null, host: null });

  it('fills part of a segment with the text the caller wrote, not a path of its own', () => {
    expect(composeAddress(written('desk-bot'), split('https://api.example.test/bot', '/sendMessage')).path).toBe(
      '/botdesk-bot/sendMessage',
    );
  });

  it('fills a whole segment as it always has', () => {
    expect(composeAddress(written('42'), split('/loans/', '/renew')).path).toBe('/loans/42/renew');
    expect(composeAddress(written('loans'), split('', '/42')).path).toBe('/loans/42');
  });
});

/**
 * Following a request out to its callers must never be worse than drawing it
 * where it is written: a caller whose argument leaves the address less read
 * than the helper's own reading is answered by the helper's request.
 */
describe('drawing a forwarded request no less surely than the helper does', () => {
  const callersIn = (client: string, callers: string) => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('client.ts', `${HEADER}${client}`);
    project.createSourceFile('callers.ts', `${HEADER}${callers}`);
    const urlArg = address(file);
    const split = splitAtParameter(urlArg)!;
    const forwarding = forwardNoWorse(forwardedFrom(split.parameter), {
      here: analyzeUrl(urlArg),
      at: (hop) => composeAddress(analyzeUrl(hop.argument), split),
      sureness: surenessOf,
    });
    return { callers: forwarding.callers.map((caller) => caller.reading.path), here: forwarding.here };
  };
  const helper = (written: string) => `
    export function send(token: string, edit: boolean) {
      let method = 'sendMessage';
      if (edit) method = 'editMessageText';
      return fetch(\`https://api.example.test/bot\${token}/\${method}\`);
    }
    ${written}
  `;

  it('keeps the request in the helper for a caller whose value fills part of a segment unread', () => {
    const callers = `
      import { send } from './client';
      declare const env: { BOT_TOKEN?: string };
      export const remind = () => send(env.BOT_TOKEN!, false);
    `;
    expect(callersIn(helper(''), callers)).toEqual({ callers: [], here: true });
  });

  it('draws on a caller that writes the value, and keeps the helper for the one that does not', () => {
    const callers = `
      import { send } from './client';
      declare const env: { BOT_TOKEN?: string };
      export const remind = () => send(env.BOT_TOKEN!, false);
      export const desk = () => send('desk-bot', false);
    `;
    expect(callersIn(helper(''), callers)).toEqual({ callers: ['/botdesk-bot/:param'], here: true });
  });

  it('follows a method by the same rule', () => {
    const client = `export class Courier { send(token: string) { return fetch(\`https://api.example.test/bot\${token}/sendMessage\`); } }`;
    const callers = `
      import { Courier } from './client';
      declare const env: { BOT_TOKEN?: string };
      export const remind = (courier: Courier) => courier.send(env.BOT_TOKEN!);
    `;
    expect(callersIn(client, callers)).toEqual({ callers: [], here: true });
  });

  it('draws on an unread caller where the helper states no route text either', () => {
    const client = `export class Api { constructor(private readonly baseUrl: string) {} get(path: string) { return fetch(\`\${this.baseUrl}\${path}\`); } }`;
    const callers = `
      import { Api } from './client';
      export const nearby = (api: Api, lat: number) => {
        let path = \`/restaurants/nearby?lat=\${lat}\`;
        if (lat > 0) path += '&north=1';
        return api.get(path);
      };
    `;
    expect(callersIn(client, callers)).toEqual({ callers: [null], here: false });
  });

  it('leaves the helper only when every caller is drawn on', () => {
    const callers = `
      import { send } from './client';
      export const desk = () => send('desk-bot', false);
    `;
    expect(callersIn(helper(''), callers)).toEqual({ callers: ['/botdesk-bot/:param'], here: false });
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
