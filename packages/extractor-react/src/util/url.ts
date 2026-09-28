import {
  constantMethodResult,
  constantPropertyValue,
  normalizePath,
  resolveStaticString,
  returnedExpression,
  rootSettingAddress,
  settingKeyIn,
  UNREAD_SPAN,
  type SettingBehind,
} from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * Identifiers that stand for a settings object written by hand.
 *
 * The two conventions a repository that does not use the bundler's own
 * mechanism falls back on. Anything else is a hole like any other.
 */
export const ENV_ROOTS = ['environment', 'env', 'config'] as const;

/**
 * Where a bundler puts the settings a build swaps out.
 *
 * Both spellings are here because both are ordinary and neither is the
 * framework's: `process.env.X` is what a repository compiled for a server
 * writes, `import.meta.env.X` is what one compiled by a module bundler writes,
 * and a repository that ships both a browser and a server half writes both.
 * The key recorded is the name after the object, because that is how it is
 * written in a configuration too, and `services[].apiBaseEnv` is compared
 * against it verbatim.
 */
const BUNDLER_ROOTS = ['process', 'import.meta', 'globalThis.process'] as const;

/**
 * The settings key an expression reads, when it reads one.
 *
 * Three shapes, one answer. `process.env.API_URL` and
 * `import.meta.env.VITE_API_URL` both answer with the last name; a hand-written
 * settings object answers with the whole path after its root, which is what the
 * core's own reader does for the other front end.
 */
export const settingKeyOf = (node: TsNode): string | null => {
  if (!Node.isPropertyAccessExpression(node)) return null;
  const inner = node.getExpression();
  if (Node.isPropertyAccessExpression(inner) && inner.getName() === 'env') {
    // The root is written rather than resolved: `import.meta` is a meta
    // property and not an identifier at all, so asking the checker what it is
    // answers nothing, while the three spellings a repository actually uses are
    // exactly the text in front of `.env`.
    const root = inner.getExpression().getText();
    if ((BUNDLER_ROOTS as readonly string[]).includes(root)) return node.getName();
  }
  return settingKeyIn(node, ENV_ROOTS);
};

/**
 * What a caller passed for a parameter, and what that caller's own parameters
 * were bound to.
 *
 * A chain rather than one map, because a request is commonly two wrappers away
 * from the address: `getOrder(id)` calls `request(`/orders/${id}`)` calls
 * `fetch(`${base}${path}`)`. Reading the address at `fetch` needs `path` bound
 * to what `request` was passed, and that expression is written in terms of
 * `id`, which only the frame above `request` can settle.
 */
export interface Bindings {
  readonly values: ReadonlyMap<TsNode, TsNode>;
  /** The bindings the expressions in `values` are themselves written under. */
  readonly under?: Bindings;
}

/** The expression a name stands for, when a caller bound it. */
const boundTo = (
  node: TsNode,
  bindings: Bindings | undefined,
): { expr: TsNode; bindings?: Bindings } | undefined => {
  if (bindings === undefined || !Node.isIdentifier(node)) return undefined;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  const expr = bindings.values.get(declaration);
  if (expr === undefined) return undefined;
  return { expr, ...(bindings.under === undefined ? {} : { bindings: bindings.under }) };
};

export interface ApiUrl {
  /** The address as written, with settings shown as `${key}`. */
  url: string | null;
  /** Path only, with parameters normalised, or null when it could not be read. */
  path: string | null;
  /** Settings key the address is rooted at, when it is. */
  baseUrlEnv: string | null;
  /** Host, when the address names one outright. */
  host: string | null;
  /** How the address was arrived at, for the reader of the node. */
  via: 'literal' | 'template-env' | 'const' | null;
  /** Whether part of the path came from a branch nobody settled. */
  guessed: boolean;
}

const EMPTY: ApiUrl = {
  url: null,
  path: null,
  baseUrlEnv: null,
  host: null,
  via: null,
  guessed: false,
};

const ABSOLUTE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i;

/**
 * The route part of an address.
 *
 * A query string and a fragment are arguments to a route rather than part of
 * it, so they are dropped from the path a route is matched on.
 */
const routePathOf = (address: string): string => normalizePath(address.split(/[?#]/)[0] ?? '');

export interface ReadAddressOptions {
  sharedPackages?: readonly string[];
  /** What the callers on the way out passed, when the address is read from one. */
  bindings?: Bindings;
}

/**
 * A piece of a path the evaluator cannot read but a module writes down.
 *
 * A fixed segment kept beside the code that uses it, in a constant or in a
 * function that only ever answers with one string.
 */
const readSpan = (node: TsNode): string | null =>
  constantMethodResult(node) ?? constantPropertyValue(node);

/**
 * Works out what address a request reaches.
 *
 * The case that matters is an address rooted at a settings key, because that is
 * what lets a call made in the browser be matched to a route a service serves.
 * Everything else is recorded as far as it can be read, and an address built at
 * run time is reported rather than guessed at.
 *
 * `bindings` is the whole of what makes this different from reading a class
 * method: what a wrapper was called with. The core's own forwarding binds the
 * parameters of a *class method*, and a module of plain functions has none, so
 * the binding is done here and handed to the same string reader through the
 * hook it already offers for a span it cannot read itself.
 */
export const analyzeApiUrl = (node: TsNode, options: ReadAddressOptions = {}): ApiUrl => {
  const { sharedPackages = [], bindings } = options;

  // A bare name the caller settled is that caller's expression, read under
  // whatever the caller's own callers settled. `request(path)` where the caller
  // wrote `request('/orders')` is the address `/orders`, written one call away.
  const bound = boundTo(node, bindings);
  if (bound !== undefined) {
    return analyzeApiUrl(bound.expr, {
      sharedPackages,
      ...(bound.bindings === undefined ? {} : { bindings: bound.bindings }),
    });
  }

  /** A span of the template the caller settled, read as the string it is. */
  const resolveSpan = (span: TsNode): string | null => {
    const settled = boundTo(span, bindings);
    if (settled === undefined) return readSpan(span);
    const inner = analyzeApiUrl(settled.expr, {
      sharedPackages,
      ...(settled.bindings === undefined ? {} : { bindings: settled.bindings }),
    });
    // Only the address as written is usable here. A span that turned out to be
    // rooted at a settings key of its own would put the key in the middle of
    // the path, which is not a path.
    return inner.url !== null && inner.baseUrlEnv === null && inner.url.includes(UNREAD_SPAN) === false
      ? inner.url
      : null;
  };

  const settingBehind = (at: TsNode): SettingBehind | null => {
    const settled = boundTo(at, bindings);
    if (settled !== undefined) {
      const inner = analyzeApiUrl(settled.expr, {
        sharedPackages,
        ...(settled.bindings === undefined ? {} : { bindings: settled.bindings }),
      });
      return inner.baseUrlEnv === null
        ? null
        : { key: inner.baseUrlEnv, prefix: routePathOf(inner.path ?? ''), ...(inner.guessed ? { guessed: true } : {}) };
    }
    // A helper that assembles the address answers with both halves: the
    // settings it is rooted at, and the part of the path it has written.
    const returned = returnedExpression(at);
    if (returned !== null) {
      const inner = resolveStaticString(returned, {
        envRoots: ENV_ROOTS,
        settingBehind,
        resolveSpan,
      });
      const [key] = inner?.envRefs ?? [];
      if (key !== undefined) {
        return {
          key,
          prefix: inner?.value ?? '',
          ...(inner?.guessed === true ? { guessed: true } : {}),
        };
      }
    }
    return rootSettingAddress(at, { readSetting: settingKeyOf });
  };

  const resolved = resolveStaticString(node, {
    sharedPackages,
    envRoots: ENV_ROOTS,
    settingBehind,
    resolveSpan,
  });

  if (resolved === null) {
    // Not a string this reader can put together, but perhaps a name that
    // stands for one: `fetch(ordersUrl(id))` is an address like any other,
    // written one call further away.
    const behind = settingBehind(node);
    const prefix = behind?.prefix ?? '';
    if (behind === null || prefix.replaceAll(UNREAD_SPAN, '') === '') return EMPTY;
    return {
      url: `\${${behind.key}}${prefix}`,
      path: routePathOf(prefix),
      baseUrlEnv: behind.key,
      host: null,
      via: 'template-env',
      guessed: behind.guessed === true,
    };
  }

  const [baseUrlEnv] = resolved.envRefs;
  const via =
    resolved.via === 'template'
      ? baseUrlEnv === undefined
        ? 'literal'
        : 'template-env'
      : resolved.via === 'literal'
        ? 'literal'
        : 'const';

  const guessed = resolved.guessed === true;
  const absolute = ABSOLUTE.exec(resolved.value);
  if (absolute !== null) {
    return {
      url: resolved.value,
      path: routePathOf(absolute[3] ?? ''),
      baseUrlEnv: null,
      host: (absolute[2] ?? '').toLowerCase(),
      via,
      guessed,
    };
  }

  return {
    url: baseUrlEnv === undefined ? resolved.value : `\${${baseUrlEnv}}${resolved.value}`,
    path: routePathOf(resolved.value),
    baseUrlEnv: baseUrlEnv ?? null,
    host: null,
    via,
    guessed,
  };
};

/**
 * The address a client of this repository's own puts in front of every path.
 *
 * `this.baseUrl = options.baseUrl || '/api'` and `private base = env.API_URL` are
 * the same fact written two ways: the opening of every address the client writes,
 * kept in a field because it is written once and read everywhere. It is read here
 * with the readers that settle any other address — the settings trace first,
 * because a base rooted at a settings key is an address and has to keep its key,
 * and the constant behind the field second, because a base that is only a path is
 * rooted at nothing and the settings trace has nothing to say about it.
 *
 * A host is allowed, unlike everywhere else a field is read as a piece of a path:
 * a client's base is the one place a host legitimately lives. So is a settings key
 * with nothing after it: {@link analyzeApiUrl} answers with nothing for that,
 * because a *request* whose whole address is a settings key has no path and is not
 * an address, while a base that is exactly the key is the ordinary way a client is
 * pointed at another deployment.
 */
export const analyzeClientBase = (node: TsNode, options: ReadAddressOptions = {}): ApiUrl => {
  const rooted = analyzeApiUrl(node, options);
  if (rooted.path !== null || rooted.baseUrlEnv !== null || rooted.host !== null) return rooted;
  const behind = rootSettingAddress(node, { readSetting: settingKeyOf });
  if (behind !== null) {
    const prefix = behind.prefix ?? '';
    return {
      url: `\${${behind.key}}${prefix}`,
      path: routePathOf(prefix),
      baseUrlEnv: behind.key,
      host: null,
      via: 'template-env',
      guessed: behind.guessed === true,
    };
  }
  const literal = constantPropertyValue(node, { allowHost: true });
  if (literal === null) return EMPTY;
  const absolute = ABSOLUTE.exec(literal);
  return {
    url: literal,
    path: routePathOf(absolute === null ? literal : (absolute[3] ?? '')),
    baseUrlEnv: null,
    host: absolute === null ? null : (absolute[2] ?? '').toLowerCase(),
    via: 'const',
    guessed: false,
  };
};

/**
 * Whether an address says anything a path written under it would not.
 *
 * The test for "is this actually a base": a field or an option holding nothing,
 * or holding `/`, adds no segment to any address written under it, and treating
 * it as a base would make `underBase` a rewrite that changes nothing while
 * looking like a reading that succeeded. Asked in both places a base is written
 * — the class's own field and a call's own option — because a base is one fact
 * and two answers to what counts as one is how the two ends of a join come to
 * disagree (R114, R128).
 */
export const isSomewhere = (address: ApiUrl): boolean =>
  address.baseUrlEnv !== null ||
  address.host !== null ||
  (address.path !== null && address.path !== '/');

/**
 * The whole address a request reaches, once the base in front of it is known.
 *
 * An address and a base are one fact read at two ends, and this is the one place
 * the two ends are put together — so what the graph records is the address the
 * request actually reaches, and everything that reads it afterwards, the linker
 * included, is looking at the same string the route side is (R114).
 *
 * The base does not apply to an address the call site rooted itself. A path
 * written with a host of its own, or rooted at a settings key of its own, is not
 * relative to anything the client holds, and putting the two together would
 * invent an address nobody writes.
 *
 * *Which* base stands in front is settled before this: the call's own option
 * where the call spells one, and the class's field where it does not (R128).
 */
export const underBase = (base: ApiUrl | undefined, address: ApiUrl): ApiUrl => {
  if (base === undefined || address.path === null) return address;
  if (address.host !== null || address.baseUrlEnv !== null) return address;
  const opening = base.path === null ? '' : base.path.replace(/\/+$/, '');
  if (opening === '' && base.baseUrlEnv === null && base.host === null) return address;
  return {
    url: `${(base.url ?? '').replace(/\/+$/, '')}${address.url ?? address.path}`,
    path: routePathOf(`${opening}${address.path}`),
    baseUrlEnv: base.baseUrlEnv,
    host: base.host,
    // How the *address* was arrived at, and an address rooted at a settings key
    // is that whichever end of it the key came from.
    via: base.baseUrlEnv === null ? address.via : 'template-env',
    guessed: address.guessed || base.guessed,
  };
};
