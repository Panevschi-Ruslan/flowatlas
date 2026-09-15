import {
  addressAt,
  constantMethodResult,
  constantPropertyValue,
  normalizePath,
  resolveStaticString,
  returnedExpression,
  rootSettingAddress,
  settingKeyIn,
  UNREAD_SPAN,
  type CallFrame,
  type SettingBehind,
} from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';

/**
 * Identifiers that stand for the settings a build swaps out.
 *
 * The framework's own convention is a module called `environment`, imported
 * under that name or shortened; anything else is a hole like any other.
 */
export const ENV_ROOTS = ['environment', 'env'] as const;

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
  /**
   * Whether part of the path came from a branch nobody settled.
   *
   * A helper taking an optional tail is settled by most of its callers, and the
   * one that passes a bare parameter settles nothing. The branch that argument
   * takes is the answer, and this is what stops the edge built from it claiming
   * to be `static` (R11).
   */
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

/**
 * A settings value kept in a property, followed back to the settings.
 *
 * `private apiUrl = environment.apiUrl` and then `${this.apiUrl}/orders` is how
 * nearly every service in a browser application is written. The property is not
 * the setting, so reading only where the address is used finds nothing at all.
 */
const readSetting = (node: TsNode): string | null => settingKeyIn(node, ENV_ROOTS);

/**
 * A piece of a path the evaluator cannot read but the class writes down.
 *
 * Both shapes are the same thing wearing different clothes: a fixed segment kept
 * beside the code that uses it, in a method a subclass overrides or in a field.
 */
const readSpan = (node: TsNode): string | null =>
  constantMethodResult(node) ?? constantPropertyValue(node);

const settingBehind = (node: TsNode): SettingBehind | null => {
  // A helper that assembles the address answers with both halves: the settings
  // it is rooted at, and the part of the path it has already written.
  const returned = returnedExpression(node);
  if (returned !== null) {
    const inner = resolveStaticString(returned, {
      envRoots: ENV_ROOTS,
      settingBehind,
      resolveSpan: readSpan,
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

  // Anything else the value passed through on its way from the settings: a
  // property holding a base and a suffix, a helper taking arguments, a
  // constructor. The path written along the way comes back with the key, since
  // dropping it reports the request against a shorter path than it asks for.
  return rootSettingAddress(node, { readSetting });
};

/**
 * Works out what address a request reaches.
 *
 * The case that matters is an address rooted at a settings key, because that is
 * what lets a call made in the browser be matched to a route a service serves.
 * Everything else is recorded as far as it can be read, and an address built at
 * run time is reported rather than guessed at. The single guess this makes — a
 * branch a caller's own argument decides — comes back saying so.
 */
export const analyzeApiUrl = (node: TsNode, sharedPackages: readonly string[]): ApiUrl => {
  const resolved = resolveStaticString(node, {
    sharedPackages,
    envRoots: ENV_ROOTS,
    settingBehind,
    resolveSpan: readSpan,
  });
  if (resolved === null) {
    // Not a string this reader can put together, but perhaps a helper that
    // assembles one: `this.http.delete(this.buildAdminUrl(id))` is an address
    // like any other, written one call further away.
    const behind = settingBehind(node);
    const prefix = behind?.prefix ?? '';
    // Only worth recording when the helper wrote something readable. A prefix
    // that is nothing but a hole says no more than no prefix at all, and saying
    // it as a path would turn an address built at run time into one that looks
    // half read.
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
 * Works out what address a request reaches, read at the call site a wrapper was
 * called from.
 *
 * `frames` lead from the request out to that call, innermost first. Every
 * parameter on the way is bound to what was passed, and a method the base leaves
 * abstract is answered by the class the caller is, so
 * `this.api.get('/me/deals')` and `this.delete(id)` in a subclass each read as
 * the one request they make rather than as the wrapper's single unreadable one.
 */
export const analyzeForwardedApiUrl = (
  node: TsNode,
  frames: readonly CallFrame[],
  choices?: ReadonlyMap<TsNode, string>,
): ApiUrl => {
  const found = addressAt(node, {
    readSetting,
    frames,
    ...(choices === undefined ? {} : { choices }),
  });
  if (found.text.replaceAll(UNREAD_SPAN, '') === '' && found.key === null) return EMPTY;
  const guessed = found.guessed === true;
  if (found.key === null) {
    const absolute = ABSOLUTE.exec(found.text);
    if (absolute !== null) {
      return {
        url: found.text,
        path: routePathOf(absolute[3] ?? ''),
        baseUrlEnv: null,
        host: (absolute[2] ?? '').toLowerCase(),
        via: 'literal',
        guessed,
      };
    }
  }
  return {
    url: found.key === null ? found.text : `\${${found.key}}${found.text}`,
    path: routePathOf(found.text),
    baseUrlEnv: found.key,
    host: null,
    via: found.key === null ? 'literal' : 'template-env',
    guessed,
  };
};
