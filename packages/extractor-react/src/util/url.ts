import {
  constantPropertyValue,
  continuesHost,
  endsAtHost,
  normalizePath,
  numberAfterHost,
  resolveStaticString,
  returnedExpression,
  rootSettingAddress,
  settingKeyIn,
  takenMember,
  UNREAD_SPAN,
  valueAfterHost,
  valueAtPort,
  writtenNumber,
  writtenSpan,
  type NumberAfterHost,
  type SettingBehind,
  type SpanReader,
} from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * Identifiers that stand for a settings object written by hand.
 *
 * The two conventions a repository that does not use the bundler's own
 * mechanism falls back on, and Nuxt's runtime configuration (P233): its keys
 * under `public` and beside it, read through `useRuntimeConfig()` called in
 * place or held by a name. Anything else is a hole like any other.
 */
export const ENV_ROOTS = ['environment', 'env', 'config', 'useRuntimeConfig().public', 'useRuntimeConfig()'] as const;

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

/** What a page is served with: the global objects a runtime settings object hangs from. */
const PAGE_GLOBALS = new Set(['window', 'globalThis', 'self']);

/**
 * The names a settings object injected into the page at run time is given
 * (P275): `window._env_`, `window.__ENV__`, `window.env`, `globalThis.__RUNTIME_CONFIG__`,
 * written by an entrypoint script from the container's environment so one
 * build serves every deployment.
 */
const RUNTIME_SETTINGS = /^_*(env|runtime_?env|runtime_?config|app_?config|config)_*$/i;

/**
 * The key a runtime settings object is read at: `window._env_?.SERVER_URL`
 * answers `SERVER_URL`, the path after the object as a hand-written settings
 * object answers. A cast round the global (`(window as any)._env_`) is taken off.
 */
const runtimeSettingKey = (node: TsNode): string | null => {
  if (!Node.isPropertyAccessExpression(node)) return null;
  const parts: string[] = [];
  let current: TsNode = node;
  while (Node.isPropertyAccessExpression(current)) {
    parts.unshift(current.getName());
    current = current.getExpression();
    while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current)) current = current.getExpression();
  }
  if (!Node.isIdentifier(current) || !PAGE_GLOBALS.has(current.getText()) || parts.length < 2) return null;
  return RUNTIME_SETTINGS.test(parts[0] as string) ? parts.slice(1).join('.') : null;
};

/**
 * The settings key an expression reads, when it reads one.
 *
 * Three shapes, one answer. `process.env.API_URL` and
 * `import.meta.env.VITE_API_URL` both answer with the last name; a hand-written
 * settings object answers with the whole path after its root, which is what the
 * core's own reader does for the other front end.
 */
export const settingKeyOf = (node: TsNode): string | null => {
  // `const { VITE_API_URL } = import.meta.env`: the member read where it is declared (P269).
  const taken = takenMember(node);
  if (taken !== undefined && Node.isPropertyAccessExpression(taken.from) && taken.from.getName() === 'env') {
    const root = taken.from.getExpression().getText();
    if ((BUNDLER_ROOTS as readonly string[]).includes(root)) return taken.key;
  }
  if (!Node.isPropertyAccessExpression(node)) return settingKeyIn(node, ENV_ROOTS);
  const runtime = runtimeSettingKey(node);
  if (runtime !== null) return runtime;
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

/**
 * Whether the value an address writes straight after its host, a path after
 * it, is the host's own - its port, the rest of its name (P312): read under
 * what the callers on the way out handed, where they handed it.
 */
const hostWrittenAfterHost = (node: TsNode, bindings: Bindings | undefined, read: SpanReader): boolean => {
  // Located under the reading the address is read with: a host a method
  // answers, `${this.origin()}${port}/health`, is the host here too (P318).
  const value = valueAfterHost(node, read);
  if (value === undefined) return false;
  return continuesHost(boundTo(value, bindings)?.expr ?? value);
};

export interface ApiUrl {
  /** The address as written, with settings shown as `${key}`. */
  url: string | null;
  /** Path only, with parameters normalised, or null when it could not be read. */
  path: string | null;
  /** Settings key the address is rooted at, when it is. */
  baseUrlEnv: string | null;
  /** What the code falls back to where that key is not set, when it writes one (P292). */
  baseUrlDefault?: string;
  /** The module that fallback is written in, as the compiler names it (P296). */
  baseUrlDefaultFile?: string;
  /** The settings a chain of `||` reads after that key, in order (P296). */
  baseUrlAlso?: readonly string[];
  /** The settings of a condition's branches nobody settles, as equal candidates (P309). */
  baseUrlEither?: readonly string[];
  /** Host, when the address names one outright. */
  host: string | null;
  /** How the address was arrived at, for the reader of the node. */
  via: 'literal' | 'template-env' | 'const' | null;
  /** Whether part of the path came from a branch nobody settled. */
  guessed: boolean;
  /**
   * A number written straight after the host with no colon before it, read
   * as the address spells it - `localhost4600`, no port (P324).
   */
  portWithoutColon?: Pick<NumberAfterHost, 'number' | 'host'>;
}

/** What a setting found behind an address says beyond its key, as an address carries it (P292, P296). */
const fallbackOf = (behind: {
  readonly otherwise?: string | undefined;
  readonly otherwiseFile?: string | undefined;
  readonly also?: readonly string[] | undefined;
  readonly either?: readonly string[] | undefined;
}): Pick<ApiUrl, 'baseUrlDefault' | 'baseUrlDefaultFile' | 'baseUrlAlso' | 'baseUrlEither'> => ({
  ...(behind.otherwise === undefined ? {} : { baseUrlDefault: behind.otherwise }),
  ...(behind.otherwise === undefined || behind.otherwiseFile === undefined ? {} : { baseUrlDefaultFile: behind.otherwiseFile }),
  ...(behind.also === undefined || behind.also.length === 0 ? {} : { baseUrlAlso: behind.also }),
  ...(behind.either === undefined || behind.either.length === 0 ? {} : { baseUrlEither: behind.either }),
});

/** The same carried back to a setting behind a hole, from an address read further in. */
const behindOf = (address: {
  readonly baseUrlDefault?: string | undefined;
  readonly baseUrlDefaultFile?: string | undefined;
  readonly baseUrlAlso?: readonly string[] | undefined;
  readonly baseUrlEither?: readonly string[] | undefined;
}): Pick<SettingBehind, 'otherwise' | 'otherwiseFile' | 'also' | 'either'> => ({
  ...(address.baseUrlDefault === undefined ? {} : { otherwise: address.baseUrlDefault }),
  ...(address.baseUrlDefault === undefined || address.baseUrlDefaultFile === undefined ? {} : { otherwiseFile: address.baseUrlDefaultFile }),
  ...(address.baseUrlAlso === undefined || address.baseUrlAlso.length === 0 ? {} : { also: address.baseUrlAlso }),
  ...(address.baseUrlEither === undefined || address.baseUrlEither.length === 0 ? {} : { either: address.baseUrlEither }),
});

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
const readSpan = (node: TsNode): string | null => writtenSpan(node, false);

/**
 * The number a caller hands for a value, followed out through the callers
 * that hand it on (P318): `health(4600)` into `` `http://localhost:${port}/health` ``,
 * and a number a class keeps, handed or written in place (P324):
 * `health(Ports.stock)` where `static stock = 4700`.
 */
const numberHanded = (node: TsNode, bindings: Bindings | undefined): string | null => {
  const settled = boundTo(node, bindings);
  if (settled !== undefined) return numberHanded(settled.expr, settled.bindings);
  return writtenNumber(node);
};

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
  const spanRead = (span: TsNode): string | null => {
    const settled = boundTo(span, bindings);
    if (settled === undefined) return readSpan(span);
    const inner = analyzeApiUrl(settled.expr, {
      sharedPackages,
      ...(settled.bindings === undefined ? {} : { bindings: settled.bindings }),
    });
    // Only the address as written is usable here. A span that turned out to be
    // rooted at a settings key of its own would put the key in the middle of
    // the path, which is not a path.
    if (inner.url !== null) return inner.baseUrlEnv === null && !inner.url.includes(UNREAD_SPAN) ? inner.url : null;
    // What the caller hands is a constant a class keeps, `Ports.stock`: read
    // as a span written in place is (P318).
    return readSpan(settled.expr);
  };

  // The value in the host's port place, where a number a caller hands is the
  // port (P318): `localhost:3000`. Anywhere else a number is the path's, a
  // value a route parameter takes.
  let port: { readonly at: TsNode | undefined } | undefined;
  const atPort = (span: TsNode): boolean => {
    port ??= { at: valueAtPort(node, spanRead) };
    return port.at === span;
  };
  // A number straight after the whole host, no colon before it (P324): read
  // as the address spells it, `localhost4600`, and said, since it is no port.
  let glued: { readonly at: NumberAfterHost | undefined } | undefined;
  const gluedAt = (): NumberAfterHost | undefined => {
    glued ??= { at: numberAfterHost(node, (piece) => numberHanded(piece, bindings), spanRead) };
    return glued.at;
  };
  const resolveSpan = (span: TsNode): string | null =>
    spanRead(span) ?? (atPort(span) || gluedAt()?.piece === span ? numberHanded(span, bindings) : null);

  const settingBehind = (at: TsNode): SettingBehind | null => {
    const settled = boundTo(at, bindings);
    if (settled !== undefined) {
      const inner = analyzeApiUrl(settled.expr, {
        sharedPackages,
        ...(settled.bindings === undefined ? {} : { bindings: settled.bindings }),
      });
      return inner.baseUrlEnv === null
        ? null
        : {
            key: inner.baseUrlEnv,
            prefix: routePathOf(inner.path ?? ''),
            ...(inner.guessed ? { guessed: true } : {}),
            ...behindOf(inner),
          };
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
          ...(inner === null ? {} : behindOf({ baseUrlDefault: inner.fallback, baseUrlDefaultFile: inner.fallbackFile, baseUrlAlso: inner.also, baseUrlEither: inner.either })),
        };
      }
    }
    return rootSettingAddress(at, { readSetting: settingKeyOf });
  };

  const reading = { sharedPackages, envRoots: ENV_ROOTS, settingBehind, resolveSpan };
  const written = resolveStaticString(node, reading);
  // `'/orders?' + params.toString()`, `` `${base}/orders?status=` + s `` (P262):
  // what is added after a `?` is the query, and the address the text before it.
  const queried = written === null ? queryAdded(node, options) : undefined;
  if (queried !== undefined) return queried;
  // `'/sellers/' + name`: the address a template would spell (P280).
  const resolved = written ?? resolveStaticString(node, { ...reading, concatenation: true });

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
      ...fallbackOf(behind),
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
    const authority = absolute[2] ?? '';
    // `'https://shop.example' + path`, `` `https://shop.example${path}` ``
    // (P308): a value nobody read written straight after the host, with
    // nothing after it, is what follows the host - the path - and the path
    // is unread, never the host's root. A host itself built from values
    // (`https://${tenant}.shop.example/orders`) is read as it was.
    const rest = absolute[3] ?? '';
    const tail = authority.endsWith(UNREAD_SPAN) ? authority.slice(0, -UNREAD_SPAN.length) : undefined;
    // Not after a `:`, a `.` or a `-`: a port's place, or the middle of the
    // host's name (`https://calendar.example.${region}`), is the host's (P312).
    const before = tail !== undefined && endsAtHost(`${absolute[1] ?? ''}://${tail}`) ? tail : undefined;
    // `` `https://shop.example${x}/orders` `` (P312): the value is the
    // host's own only where everything it is followed to is a port or the
    // rest of its name; a path, or a value nothing reads, opens the path, and
    // the path is unread rather than the value folded into the host.
    const hostOnly = before !== undefined && (rest === '' || !hostWrittenAfterHost(node, bindings, resolveSpan)) ? before : undefined;
    const noColon = gluedAt();
    return {
      url: resolved.value,
      path: hostOnly === undefined ? routePathOf(rest) : rest === '' ? UNREAD_SPAN : routePathOf(`/${UNREAD_SPAN}${rest}`),
      baseUrlEnv: null,
      host: (hostOnly ?? authority).toLowerCase(),
      via,
      guessed,
      ...(noColon === undefined ? {} : { portWithoutColon: { number: noColon.number, host: noColon.host } }),
    };
  }

  return {
    url: baseUrlEnv === undefined ? resolved.value : `\${${baseUrlEnv}}${resolved.value}`,
    path: routePathOf(resolved.value),
    baseUrlEnv: baseUrlEnv ?? null,
    ...(baseUrlEnv === undefined ? {} : fallbackOf({ otherwise: resolved.fallback, otherwiseFile: resolved.fallbackFile, also: resolved.also, either: resolved.either })),
    host: null,
    via,
    guessed,
  };
};

/**
 * An address with a query added to it by `+` after its `?` (P262), read as
 * the address its left side is with the query the right side adds unread
 * (`${…}`); the query's keys are the request's to say, where it is built in
 * code. Nothing where the left side holds no `?`, which leaves the right side
 * part of the path.
 */
const queryAdded = (node: TsNode, options: ReadAddressOptions): ApiUrl | undefined => {
  let value = node;
  while (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value)) value = value.getExpression();
  if (!Node.isBinaryExpression(value) || value.getOperatorToken().getText() !== '+') return undefined;
  const left = analyzeApiUrl(value.getLeft(), options);
  if (left.url === null || left.path === null || !left.url.includes('?')) return undefined;
  return { ...left, url: `${left.url}${UNREAD_SPAN}` };
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
      ...fallbackOf(behind),
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
 * Whether an address is a base, and the address a request reaches under one.
 *
 * Both are the core's since P239: the Angular reader folds an interceptor's base
 * with the same function, and a second copy is how two readers come to disagree
 * about the same segment (R114).
 */
export { isSomewhere, underBase } from '@flowatlas/core';
