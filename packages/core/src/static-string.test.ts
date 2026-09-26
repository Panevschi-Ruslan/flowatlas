import { Node, Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveStaticString } from './static-string.js';

const SHARED = `export const SHARED_ROUTES = { orders: '/orders' } as const;`;

const SOURCE = `
import { SHARED_ROUTES } from '@project/shared';

export const environment = { apiUrl: 'https://api.test', api: { baseUrl: 'https://api.test' } };
export const ROUTES = { orders: '/orders' } as const;
export enum Channel { Created = 'order.created' }

const VERSION = 'v1';
const id = String(Math.random());
const build = () => '/x';
function query(filters?: Record<string, string>): string {
  if (!filters) return '';
  const text = new URLSearchParams(filters).toString();
  return text ? \`?\${text}\` : '';
}
const qs = query();
const anything = String(Math.random());

export const values = {
  literal: '/orders',
  noSubstitution: \`/orders\`,
  fromConst: ROUTES.orders,
  fromEnum: Channel.Created,
  fromShared: SHARED_ROUTES.orders,
  rooted: \`\${environment.apiUrl}/orders\`,
  rootedDotted: \`\${environment.api.baseUrl}/orders\`,
  withHole: \`\${environment.apiUrl}/orders/\${id}\`,
  holeOnly: \`/orders/\${id}\`,
  midEnv: \`/prefix\${environment.apiUrl}/orders\`,
  gluedHole: \`\${environment.apiUrl}/orders/\${id}-summary\`,
  openingHole: \`\${id}/orders\`,
  twoHoles: \`\${environment.apiUrl}/orders/\${id}\${id}\`,
  holeThenQuery: \`\${environment.apiUrl}/orders/\${id}?full=1\`,
  dynamic: build(),
  queryTail: \`\${environment.apiUrl}/reviews\${qs}\`,
  queryTailAfterHole: \`\${environment.apiUrl}/orders/\${id}\${query({ a: 'b' })}\`,
  unknownTail: \`\${environment.apiUrl}/reviews\${anything}\`,
  joinedConst: '/api/' + VERSION,
  joinedLiterals: '/api/' + 'v1',
  joinedTemplate: \`/api/\${VERSION}\`,
  bareConst: VERSION,
  joinedThrice: '/api/' + VERSION + '/orders',
  joinedNumber: '/api/v' + 1,
  joinedUnreadable: '/api/' + anything,
  joinedBoolean: '/api/' + true,
};
`;

let file: SourceFile;

const of = (property: string, envRoots: readonly string[] = ['environment']) => {
  const values = file.getVariableDeclarationOrThrow('values').getInitializerOrThrow();
  if (!Node.isObjectLiteralExpression(values)) throw new Error('fixture is not an object');
  const assignment = values.getPropertyOrThrow(property);
  if (!Node.isPropertyAssignment(assignment)) throw new Error(`no property ${property}`);
  return resolveStaticString(assignment.getInitializerOrThrow(), {
    envRoots,
    sharedPackages: ['@project/shared'],
  });
};

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@project/shared/index.d.ts', SHARED);
  project.createSourceFile('node_modules/@project/shared/package.json', '{"name":"@project/shared"}');
  file = project.createSourceFile('values.ts', SOURCE);
});

describe('reading a string out of the source', () => {
  it('reads a literal', () => {
    expect(of('literal')).toEqual({ value: '/orders', via: 'literal', envRefs: [] });
  });

  it('reads a template with nothing in it', () => {
    expect(of('noSubstitution')).toEqual({ value: '/orders', via: 'literal', envRefs: [] });
  });

  it('follows a constant', () => {
    expect(of('fromConst')).toEqual({ value: '/orders', via: 'const', envRefs: [] });
  });

  it('follows an enum member', () => {
    expect(of('fromEnum')).toEqual({ value: 'order.created', via: 'enum', envRefs: [] });
  });

  it('follows a constant read from a package the services share', () => {
    expect(of('fromShared')).toEqual({ value: '/orders', via: 'shared-package', envRefs: [] });
  });

  it('records the settings key a string is rooted at and drops it from the value', () => {
    expect(of('rooted')).toEqual({ value: '/orders', via: 'template', envRefs: ['apiUrl'] });
  });

  it('keeps the whole path of a dotted settings key', () => {
    expect(of('rootedDotted')).toEqual({
      value: '/orders',
      via: 'template',
      envRefs: ['api.baseUrl'],
    });
  });

  it('reads a hole between two separators as the route parameter it fills', () => {
    expect(of('withHole')).toEqual({
      value: '/orders/:param',
      via: 'template',
      envRefs: ['apiUrl'],
    });
  });

  it('reads a template with no settings key at all', () => {
    expect(of('holeOnly')).toEqual({ value: '/orders/:param', via: 'template', envRefs: [] });
  });

  it('keeps a hole before a query string as a parameter, since the path ends there', () => {
    expect(of('holeThenQuery')?.value).toBe('/orders/:param?full=1');
  });

  // The three below are why the two meanings had to be told apart. Each used to
  // read as `:param`, which is a hole a route declares and any single segment
  // fills, so an address nobody could read matched a route it may never reach
  // and the edge said `static` about it.

  it('will not call a hole a parameter when text runs into it', () => {
    // `12-summary` fills the segment, but so does `latest-summary`, and nothing
    // here says which.
    expect(of('gluedHole')?.value).toBe('/orders/${…}-summary');
  });

  it('will not call a hole a parameter when it opens the address', () => {
    // `${id}` could be a host, a path, or both: there is no separator in front
    // of it to say the address even starts here.
    expect(of('openingHole')?.value).toBe('${…}/orders');
  });

  it('will not call a hole a parameter when another hole follows it', () => {
    expect(of('twoHoles')?.value).toBe('/orders/${…}${…}');
  });

  it('only treats a settings key as the root when the string starts with it', () => {
    expect(of('midEnv')).toEqual({
      value: '/prefixhttps://api.test/orders',
      via: 'template',
      envRefs: [],
    });
  });

  it('reads a settings value as an ordinary constant when nothing named it a root', () => {
    expect(of('rooted', [])).toEqual({
      value: 'https://api.test/orders',
      via: 'template',
      envRefs: [],
    });
  });

  it('refuses to guess a string that is not constant', () => {
    expect(of('dynamic')).toBeNull();
  });
});

describe('a query string at the end of a string', () => {
  it('is dropped when every value it can take is empty or opens with ?', () => {
    expect(of('queryTail')).toMatchObject({ value: '/reviews', envRefs: ['apiUrl'] });
  });

  it('leaves the hole before it filling a segment of its own', () => {
    expect(of('queryTailAfterHole')?.value).toBe('/orders/:param');
  });

  it('stays a hole when it could be anything', () => {
    expect(of('unknownTail')?.value).toBe('/reviews${…}');
  });
});

/**
 * Two strings added together are one string, and the checker will not say so:
 * the type of a `+` is the widened `string` even where both operands are
 * literals. Refusing it cost PeerTube 290 of its 344 routes, from the single
 * mount written `app.use('/api/' + API_VERSION, apiRouter)` (R102).
 */
describe('a string written in two pieces with a plus', () => {
  it('folds a literal and a constant, as the same address written as a template does', () => {
    expect(of('joinedConst')).toEqual({ value: '/api/v1', via: 'const', envRefs: [] });
    expect(of('joinedTemplate')?.value).toBe('/api/v1');
  });

  it('folds two literals, which is the part that made this a bug rather than a limit', () => {
    expect(of('joinedLiterals')?.value).toBe('/api/v1');
  });

  it('leaves a bare constant reading as it always did', () => {
    expect(of('bareConst')?.value).toBe('v1');
  });

  it('folds a chain of them, since a plus nests to the left', () => {
    expect(of('joinedThrice')?.value).toBe('/api/v1/orders');
  });

  it('folds a number, because that is what the language does with one', () => {
    expect(of('joinedNumber')?.value).toBe('/api/v1');
  });

  // The discipline the template-literal path keeps: a piece that cannot be read
  // leaves the whole string unread rather than half-read, because an address
  // invented here becomes a confident edge that is simply wrong.
  it('reads nothing at all when either half cannot be read', () => {
    expect(of('joinedUnreadable')).toBeNull();
  });

  it('reads nothing when a plus is doing something other than joining text', () => {
    expect(of('joinedBoolean')).toBeNull();
  });
});
