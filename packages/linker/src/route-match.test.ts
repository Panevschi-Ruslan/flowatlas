import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  answeredOnlyByWildcard,
  assumedMountOf,
  isMatch,
  matchRoute,
  pathAnswers,
  verbsAnswering,
} from './route-match.js';

const route = (method: string, path: string, controller = 'C'): GraphNode => ({
  id: `entry:orders:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo: 'orders',
  meta: { method, path, controller },
});

describe('pathAnswers', () => {
  it('accepts any single segment where the route has a hole', () => {
    expect(pathAnswers('/orders/:param/items', '/orders/123/items')).toBe(true);
  });

  it('refuses a literal the request does not spell the same way', () => {
    expect(pathAnswers('/orders/latest', '/orders/123')).toBe(false);
  });

  it('refuses a hole in the request where the route wants a literal', () => {
    expect(pathAnswers('/orders/latest', '/orders/:param')).toBe(false);
  });

  it('refuses a request with segments left over', () => {
    expect(pathAnswers('/orders/:param', '/orders/123/items')).toBe(false);
  });

  it('refuses a request that runs out of segments', () => {
    expect(pathAnswers('/orders/:param/items', '/orders/123')).toBe(false);
  });

  it('lets a wildcard take everything below it', () => {
    expect(pathAnswers('/files/*', '/files/a/b/c')).toBe(true);
  });

  it('ignores trailing and doubled slashes on either side', () => {
    expect(pathAnswers('/orders/', '//orders')).toBe(true);
  });

  it('refuses a request holding a span nobody could read', () => {
    // The route's own hole is one it declares and any single segment fills.
    // This is a hole in what was read, and it may not even be one segment.
    expect(pathAnswers('/orders/:param/items', '/orders/${…}/items')).toBe(false);
    expect(pathAnswers('/orders/:param', '/${…}')).toBe(false);
  });

  it('refuses a route whose own path could not be read', () => {
    expect(pathAnswers('/orders/${…}', '/orders/42')).toBe(false);
  });

  it('keeps reading a route after a wildcard that is not the last thing in it', () => {
    // The wildcard used to answer yes on sight, wherever it stood, and the rest
    // of the route was never looked at: this pair matched, and the edge claimed
    // one service reaches another through an address it does not serve.
    expect(pathAnswers('/files/*/download', '/files/a/anything')).toBe(false);
    expect(pathAnswers('/files/*/download', '/files/a/download')).toBe(true);
  });

  it('wants at least one segment under a trailing wildcard', () => {
    expect(pathAnswers('/api/*', '/api/orders/42')).toBe(true);
    expect(pathAnswers('/api/*', '/api')).toBe(false);
  });

  it('reads a literal without regard to case, as the routers it reads do', () => {
    // Express and Nest both answer `/Orders/42` from `/orders/:id`. Comparing
    // exactly reported that as a route the target does not serve — a finding
    // about a disagreement that was not there.
    expect(pathAnswers('/orders/:param', '/Orders/42')).toBe(true);
    expect(pathAnswers('/ORDERS/latest', '/orders/latest')).toBe(true);
    expect(pathAnswers('/orders/latest', '/orders/newest')).toBe(false);
  });

  it('answers nothing when either side has no path at all', () => {
    expect(pathAnswers('', '')).toBe(false);
    expect(pathAnswers('', '/orders')).toBe(false);
    expect(pathAnswers('/orders', '')).toBe(false);
  });
});

describe('matchRoute', () => {
  it('reads the verb declared by a route without regard to case', () => {
    // Only the asked-for verb was raised, so a route that recorded its own in
    // any other case answered nothing at all rather than saying why.
    expect(isMatch(matchRoute('GET', '/x', [route('get', '/x')]))).toBe(true);
  });

  const entries = [route('GET', '/orders/:param'), route('POST', '/orders')];

  it('finds the route that answers', () => {
    const found = matchRoute('GET', '/orders/42', entries);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/orders/:param');
  });

  it('does not care how the verb is spelled', () => {
    expect(isMatch(matchRoute('get', '/orders/42', entries))).toBe(true);
  });

  it('prefers the literal route over the one with a hole', () => {
    const withLiteral = [...entries, route('GET', '/orders/latest')];
    const found = matchRoute('GET', '/orders/latest', withLiteral);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/orders/latest');
  });

  it('answers any verb from a route registered for all of them', () => {
    const all = [route('ALL', '/webhook')];
    expect(isMatch(matchRoute('PATCH', '/webhook', all))).toBe(true);
  });

  it('reports nothing found when only the verb is wrong', () => {
    const found = matchRoute('DELETE', '/orders/42', entries);
    expect(isMatch(found)).toBe(false);
    expect(!isMatch(found) && found.reason).toBe('not-found');
  });

  it('refuses to choose when two differently spelled routes both answer', () => {
    const overlapping = [route('GET', '/a/:param/x'), route('GET', '/a/x/:param')];
    const found = matchRoute('GET', '/a/x/x', overlapping);
    expect(!isMatch(found) && found.reason).toBe('ambiguous');
    expect(!isMatch(found) && found.candidates).toEqual([
      'entry:orders:http:GET:/a/:param/x',
      'entry:orders:http:GET:/a/x/:param',
    ]);
  });

  /**
   * Two applications answering, and two routes of one application answering, are
   * not the same fact (R119).
   *
   * The first is a defect in nothing — a worker and an API each answer `/health`
   * on their own port — and the only unknown is which of them a caller from
   * outside reaches, which is decided by deployment and written in no source. The
   * second is a defect in one application: whichever handler was registered first
   * answers and the other is dead code. Both arrive here as a tie, so the result
   * has to be able to tell them apart.
   */
  describe('two applications serving one address', () => {
    const inApplication = (path: string, application: string): GraphNode => ({
      id: `entry:orders@${application}:http:GET:${path}`,
      type: 'entry',
      kind: 'http',
      label: `GET ${path} (${application})`,
      repo: 'orders',
      meta: { method: 'GET', path, application },
    });

    it('names the applications when the tie is between them', () => {
      const both = [inApplication('/health', 'ApiModule'), inApplication('/health', 'WorkerModule')];
      const found = matchRoute('GET', '/health', both);
      expect(!isMatch(found) && found.reason).toBe('ambiguous');
      expect(!isMatch(found) && found.applications).toEqual(['ApiModule', 'WorkerModule']);
    });

    it('names none when the tie is inside one application', () => {
      const one = [
        { ...route('GET', '/a/:param/x'), meta: { method: 'GET', path: '/a/:param/x', application: 'ApiModule' } },
        { ...route('GET', '/a/x/:param'), meta: { method: 'GET', path: '/a/x/:param', application: 'ApiModule' } },
      ];
      const found = matchRoute('GET', '/a/x/x', one);
      expect(!isMatch(found) && found.reason).toBe('ambiguous');
      expect(!isMatch(found) && found.applications).toBeUndefined();
    });

    it('names none where no application was read at all', () => {
      const overlapping = [route('GET', '/a/:param/x'), route('GET', '/a/x/:param')];
      const found = matchRoute('GET', '/a/x/x', overlapping);
      expect(!isMatch(found) && found.applications).toBeUndefined();
    });

    /**
     * The caller's own application, which is the input R119 did without and
     * R132 supplied.
     *
     * A relative address asks the origin the page came from, and that origin is
     * the application the file is written in. So a request from inside one of
     * them is not the deployment question the paragraph above refuses to guess
     * at — it is answered by the caller's own application and by nothing else.
     */
    describe('a caller inside one of them', () => {
      it('answers with the caller own application, and reports nothing', () => {
        const both = [
          inApplication('/api/orders', '.'),
          inApplication('/api/orders', 'examples/blog'),
        ];
        const found = matchRoute('GET', '/api/orders', both, 'examples/blog');
        expect(isMatch(found) && found.entry.id).toBe(
          'entry:orders@examples/blog:http:GET:/api/orders',
        );
      });

      // Before specificity and not after it. The other application spelling the
      // address out more fully says nothing about where this request goes, and
      // preferring it is how 35 of 36 joins on a CMS monorepo named the wrong program.
      it('prefers its own catch-all to another application spelled-out route', () => {
        const mixed = [
          inApplication('/api/posts', '.'),
          { ...inApplication('/api/*', 'examples/blog'), meta: { method: 'GET', path: '/api/*', application: 'examples/blog' } },
        ];
        const found = matchRoute('GET', '/api/posts', mixed, 'examples/blog');
        expect(isMatch(found) && found.entry.id).toBe('entry:orders@examples/blog:http:GET:/api/*');
      });

      // Specificity still decides inside the application it chose: preferring an
      // application is not preferring any route in it.
      it('still lets specificity decide within that application', () => {
        const inside = [
          { ...inApplication('/api/*', 'examples/blog'), meta: { method: 'GET', path: '/api/*', application: 'examples/blog' } },
          inApplication('/api/orders', 'examples/blog'),
        ];
        const found = matchRoute('GET', '/api/orders', inside, 'examples/blog');
        expect(isMatch(found) && found.entry.id).toBe(
          'entry:orders@examples/blog:http:GET:/api/orders',
        );
      });

      // A caller in an application that answers nothing is outside this address
      // as surely as a caller in another service, so the refusal stands.
      it('leaves the refusal alone where the caller application answers nothing', () => {
        const both = [inApplication('/health', 'ApiModule'), inApplication('/health', 'WorkerModule')];
        const found = matchRoute('GET', '/health', both, 'examples/blog');
        expect(!isMatch(found) && found.applications).toEqual(['ApiModule', 'WorkerModule']);
      });

      it('leaves the refusal alone where the caller is outside every application', () => {
        const both = [inApplication('/health', 'ApiModule'), inApplication('/health', 'WorkerModule')];
        expect(!isMatch(matchRoute('GET', '/health', both))).toBe(true);
      });
    });

    // One application's route is still beaten by the other's more specific one:
    // the applications differ, but only one of them can answer, so there is no
    // ambiguity of any kind to report.
    it('still lets specificity decide across applications', () => {
      const mixed = [inApplication('/orders/:param', 'ApiModule'), inApplication('/orders/latest', 'WorkerModule')];
      const found = matchRoute('GET', '/orders/latest', mixed);
      expect(isMatch(found) && found.entry.id).toBe('entry:orders@WorkerModule:http:GET:/orders/latest');
    });
  });

  it('prefers a route with a hole in it to a catch-all with as many', () => {
    // R15. A worker hands everything under `/api` to the application behind it,
    // so `ALL /api/*` answers every address that application serves. Counting
    // holes made those a tie and every request to the service ambiguous.
    const bridged = [route('ALL', '/api/*'), route('GET', '/api/orders/:param')];
    const found = matchRoute('GET', '/api/orders/42', bridged);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/api/orders/:param');
    // And the catch-all is not named as a runner-up: no router hesitates
    // between a route and a wildcard, so there is nothing to warn about.
    expect(isMatch(found) && found.runnersUp).toEqual([]);
  });

  it('prefers the catch-all that spells out more of the address', () => {
    const nested = [route('ALL', '/api/*'), route('ALL', '/api/admin/*')];
    const found = matchRoute('GET', '/api/admin/reports', nested);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:ALL:/api/admin/*');
  });

  it('still answers with the catch-all when nothing spells the address out', () => {
    const bridged = [route('ALL', '/api/*'), route('GET', '/api/orders/:param')];
    const found = matchRoute('GET', '/api/nothing/serves/this', bridged);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:ALL:/api/*');
  });

  it('ignores nodes that are not http routes', () => {
    const consumer: GraphNode = {
      id: 'entry:orders:message:order.created',
      type: 'entry',
      kind: 'message',
      label: 'order.created',
      repo: 'orders',
      meta: { method: 'GET', path: '/orders/42' },
    };
    expect(isMatch(matchRoute('GET', '/orders/42', [consumer]))).toBe(false);
  });
});

/**
 * Whether the catch-all that answered is all there is, asked of one address
 * space.
 *
 * The row this decides says a renamed route may be hiding behind the catch-all,
 * and that is a statement about the program behind it. A service with several
 * applications has several, and routes another one spells out are no evidence
 * about this one (R132).
 */
describe('answeredOnlyByWildcard', () => {
  const at = (path: string, application?: string): GraphNode => ({
    id: `entry:orders${application === undefined ? '' : `@${application}`}:http:GET:${path}`,
    type: 'entry',
    kind: 'http',
    label: `GET ${path}`,
    repo: 'orders',
    meta: { method: 'GET', path, ...(application === undefined ? {} : { application }) },
  });

  it('says so where the same application spells other routes out', () => {
    const routes = [at('/api/*', 'blog'), at('/api/orders', 'blog')];
    expect(answeredOnlyByWildcard(at('/api/*', 'blog'), routes)).toBe(true);
  });

  it('says nothing where only another application spells them out', () => {
    const routes = [at('/api/*', 'template'), at('/api/orders', '.')];
    expect(answeredOnlyByWildcard(at('/api/*', 'template'), routes)).toBe(false);
  });

  it('compares against every route where the service has one application', () => {
    expect(answeredOnlyByWildcard(at('/api/*'), [at('/api/*'), at('/api/orders')])).toBe(true);
  });

  it('says nothing about a route that is not a catch-all', () => {
    expect(answeredOnlyByWildcard(at('/api/orders'), [at('/api/orders')])).toBe(false);
  });
});

/**
 * A mount taken as empty (R144): the one exception to R89's rule, and how narrow
 * it is.
 */
describe('a route whose address opens with a mount read from settings', () => {
  const EMPTY = { settings: ['API_CONTEXT_PATH'], setIn: [], envFiles: 2 };
  const mounted = (path: string, mount: Record<string, unknown> = EMPTY): GraphNode => {
    const entry = route('GET', path);
    entry.meta = { ...entry.meta, mount };
    return entry;
  };

  it('answers once the mount is taken as empty, and says it was', () => {
    const found = matchRoute('GET', '/v1/orders/42', [mounted('/${…}v1/orders/:param')]);
    expect(isMatch(found) && found.mountAssumed).toEqual(['API_CONTEXT_PATH']);
    expect(assumedMountOf(mounted('/${…}v1/orders/:param'))).toEqual({
      path: '/v1/orders/:param',
      settings: ['API_CONTEXT_PATH'],
    });
  });

  it('says nothing of a mount where the address was read in full', () => {
    const found = matchRoute('GET', '/v1/orders', [route('GET', '/v1/orders')]);
    expect(isMatch(found) && found.mountAssumed).toBeUndefined();
  });

  it.each([
    ['a committed environment file sets it', { ...EMPTY, setIn: ['src/.env.production'] }],
    ['the service has no environment file to ask', { ...EMPTY, envFiles: 0 }],
    ['no setting was named', { ...EMPTY, settings: [] }],
  ])('keeps R89 where %s', (_, mount) => {
    const found = matchRoute('GET', '/v1/orders', [mounted('/${…}v1/orders', mount)]);
    expect(found).toEqual({ reason: 'not-found', candidates: [] });
  });

  it.each([
    ['in the middle of the address', '/api/${…}v1/orders', '/api/v1/orders'],
    ['a second one behind the mount', '/${…}v1/${…}/orders', '/v1/x/orders'],
  ])('keeps R89 for a hole %s', (_, path, asked) => {
    expect(isMatch(matchRoute('GET', asked, [mounted(path)]))).toBe(false);
  });

  it('names the verbs a path answers behind the mount', () => {
    expect(verbsAnswering('/v1/orders', [mounted('/${…}v1/orders')])).toEqual(['GET']);
  });
});

describe('a route with an optional segment', () => {
  const at = (path: string, rawPath: string, meta: Record<string, unknown> = {}): GraphNode => ({
    ...route('GET', path),
    id: `entry:web:http:GET:${path}${String(meta['contributes'] ?? '')}`,
    meta: { method: 'GET', path, rawPath, ...meta },
  });

  it('answers a request that leaves the optional segment out, and one that fills it', () => {
    const files = at('/:param/files/*', '/:lang?/files/:path');
    for (const asked of ['/files/a.txt', '/en/files/a.txt']) {
      const result = matchRoute('GET', asked, [files]);
      expect(isMatch(result) ? result.entry.id : result).toBe(files.id);
    }
    const about = at('/en/about', '/en?/about');
    expect(isMatch(matchRoute('GET', '/about', [about]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/de/about', [about]))).toBe(false);
  });

  it('is not answered by what only contributes to a page', () => {
    const layout = at('/', '/', { contributes: 'layout' });
    const page = at('/', '/', { contributes: 'page' });
    expect(matchRoute('GET', '/', [layout, page])).toEqual({ reason: 'not-found', candidates: [] });
  });
});

describe('a route whose segment holds a param among literal text', () => {
  const at = (path: string, rawPath: string): GraphNode => ({
    ...route('GET', path),
    meta: { method: 'GET', path, rawPath },
  });

  it('answers only a segment with the same text around a value', () => {
    const foo = at('/:param', '/foo-:id');
    expect(isMatch(matchRoute('GET', '/foo-42', [foo]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/FOO-x', [foo]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/bar', [foo]))).toBe(false);
    expect(isMatch(matchRoute('GET', '/foo-', [foo]))).toBe(false);
    const pair = at('/v/:param', '/v/:a-:b.json');
    expect(isMatch(matchRoute('GET', '/v/1-2.json', [pair]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/v/12.json', [pair]))).toBe(false);
  });

  it('keeps a hole open where the path as written is a name alone or a spelling it does not know', () => {
    expect(isMatch(matchRoute('GET', '/anything', [at('/:param', '/:id')]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/anything', [at('/:param', '/:id(\\d+)')]))).toBe(true);
  });

  it('keeps the shape where an optional segment is left out', () => {
    const shaped = at('/:param/:param', '/:lang?/foo-:id');
    expect(isMatch(matchRoute('GET', '/foo-1', [shaped]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/en/foo-1', [shaped]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/en/bar', [shaped]))).toBe(false);
  });
});

describe('sibling routes with literal text around a param', () => {
  const at = (path: string, rawPath?: string): GraphNode => ({
    ...route('GET', path),
    meta: { method: 'GET', path, ...(rawPath === undefined ? {} : { rawPath }) },
  });
  const foo = at('/foo-:param', '/foo-:id');
  const bar = at('/bar-:param', '/bar-:id');
  const bare = at('/:param', '/:id');
  const picked = (path: string): string | undefined => {
    const result = matchRoute('GET', path, [foo, bar, bare]);
    return isMatch(result) ? String(result.entry.meta?.['path']) : undefined;
  };

  it('picks the route whose text the segment spells, before a bare param', () => {
    expect(picked('/foo-1')).toBe('/foo-:param');
    expect(picked('/bar-1')).toBe('/bar-:param');
    expect(picked('/baz')).toBe('/:param');
  });

  it('reads the shape off the key where no path as written was kept', () => {
    expect(pathAnswers('/foo-:param', '/foo-7')).toBe(true);
    expect(pathAnswers('/foo-:param', '/bar-7')).toBe(false);
  });

  it('compares an encoded character as the text it is', () => {
    expect(pathAnswers('/what%3F', '/what%3f')).toBe(true);
    expect(pathAnswers('/a%2Fb', '/a/b')).toBe(false);
    expect(isMatch(matchRoute('GET', '/x%3Ay', [at('/:param%3Ay', '/:id%3Ay')]))).toBe(true);
    expect(isMatch(matchRoute('GET', '/x', [at('/what%3F', '/what%3F')]))).toBe(false);
  });
});
