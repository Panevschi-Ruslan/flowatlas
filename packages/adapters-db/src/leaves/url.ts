import { choosesASegment, constantPropertyValue, holeIn, normalizePath, PARAM_PLACEHOLDER, UNREAD_SPAN } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { evaluateExpression } from '@flowatlas/extractor-nestjs';
import { readConfig } from './config.js';
import { deref, rootConfigKey, type SplitAddress } from './trace.js';

export interface UrlInfo {
  /** The address as written, with interpolations shown as `${…}`. */
  url: string | null;
  /** Path only, with parameters normalised, or null when it could not be read. */
  path: string | null;
  /** Environment key the address is rooted at, when it is. */
  baseUrlEnv: string | null;
  /** Host, when the address names one outright. */
  host: string | null;
}

const EMPTY: UrlInfo = { url: null, path: null, baseUrlEnv: null, host: null };

/**
 * The route part of an address.
 *
 * A query string and a fragment are arguments to a route rather than part of
 * it, so they are kept in the address as written and dropped from the path a
 * route is matched on.
 */
export const routePathOf = (address: string): string =>
  normalizePath(address.split(/[?#]/)[0] ?? '');

/** How a hole is shown in the address a person reads. */
const HOLE = '${…}';

const fromAbsolute = (text: string): UrlInfo | null => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i.exec(text);
  if (match === null) return null;
  const host = (match[2] ?? '').toLowerCase();
  const path = match[3] ?? '';
  return { url: text, path: routePathOf(path), baseUrlEnv: null, host };
};

/**
 * Works out what address a call reaches.
 *
 * The case that matters is an address rooted at a configuration key, because
 * that is what lets one service's outgoing call be matched to another service's
 * route later. Everything else is recorded as far as it can be read, and a fully
 * computed address is reported rather than guessed at.
 */
export const analyzeUrl = (node: TsNode): UrlInfo => {
  // An address is often given a name before it is used; the name is not the
  // address, so follow it to what it was given.
  const argument = deref(node);
  const literal = evaluateExpression(argument);
  if (literal.resolved && typeof literal.value === 'string') {
    return fromAbsolute(literal.value) ?? {
      url: literal.value,
      path: routePathOf(literal.value),
      baseUrlEnv: null,
      host: null,
    };
  }

  if (!Node.isTemplateExpression(argument)) return EMPTY;

  const head = argument.getHead().getLiteralText();
  const spans = argument.getTemplateSpans();

  let baseUrlEnv: string | null = null;
  let rest = head;
  let written = head;
  let start = 0;

  // An address that begins with a configuration value is rooted at it. The
  // value is rarely read where the request is made — it arrives as a
  // constructor argument and is kept in a property — so where it came from is
  // followed rather than only looked for in place.
  const [firstSpan] = spans;
  if (head === '' && firstSpan !== undefined) {
    const direct = readConfig(firstSpan.getExpression());
    const key = direct !== null && direct.dynamic !== true
      ? direct.key
      : rootConfigKey(firstSpan.getExpression());
    if (key !== null) {
      baseUrlEnv = key;
      rest = firstSpan.getLiteral().getLiteralText();
      written = `\${${key}}${rest}`;
      start = 1;
    }
  }

  for (let index = start; index < spans.length; index += 1) {
    const span = spans[index];
    if (span === undefined) continue;
    const value = evaluateExpression(span.getExpression());
    const text = span.getLiteral().getLiteralText();
    const read =
      value.resolved && typeof value.value === 'string'
        ? value.value
        : constantPropertyValue(span.getExpression(), { allowHost: index === 0 && rest === '' });
    // A hole that fills a segment is a route parameter; one that could run over
    // a separator is a hole in what was read, and the address it sits in matches
    // no route at all. Both used to become `:param`, which is how an address
    // nobody could read became an edge marked `static`.
    const hole = choosesASegment(span.getExpression())
      ? UNREAD_SPAN
      : holeIn(rest, text, index === spans.length - 1);
    rest += (read ?? hole) + text;
    // The address as written keeps every hole a hole, whichever it turned out
    // to be. It is what a person reads; the path is what a route is matched on.
    written += (read ?? HOLE) + text;
  }

  const absolute = fromAbsolute(rest);
  if (absolute !== null) return { ...absolute, url: written, baseUrlEnv };
  return { url: written, path: routePathOf(rest), baseUrlEnv, host: null };
};

/** `scheme://host` at the start of an address, and the host inside it. */
const ORIGIN = /^([a-z][a-z0-9+.-]*:\/\/([^/?#]+))/i;

/**
 * A caller's value as it fills the hole, which is the text it is and not a
 * path: reading `'desk-bot'` as a path starts it with a separator, and
 * `bot${token}` filled with it read `/bot/desk-bot`, a route the request never
 * reaches. Only a value with no root of its own; one rooted at a setting is
 * an address, and a separator follows the root.
 */
const asWritten = (info: UrlInfo, path: string): string =>
  info.baseUrlEnv === null && info.url !== null && !info.url.startsWith('/') && path.startsWith('/')
    ? path.slice(1)
    : path;

/**
 * Puts an address back together from its two halves.
 *
 * The request knew the fixed half and a caller knew the part it fills in;
 * neither knew the whole address, and the request is only useful once they are
 * joined. What the fixed half states - a settings key it is rooted at, or a
 * host written outright - belongs to the request, and the caller only fills the
 * hole (R161). Reading the host as the first segment of a path is how
 * `https://host/items/${id}` used to become `/https:/host/items/…`.
 *
 * A caller whose value is not read leaves a hole that fills one segment a route
 * parameter, as the request read where it is written would have: following the
 * request out to its caller says who made it, and must not cost the address the
 * request itself states (R175).
 */
export const composeAddress = (info: UrlInfo, split?: SplitAddress): UrlInfo => {
  if (split === undefined) return info;
  if (info.host !== null) return info;
  const origin = ORIGIN.exec(split.before);
  const stated = origin?.[1] ?? '';
  const before = split.before.slice(stated.length);
  const unread = info.url === null && holeIn(before, split.after, true) === PARAM_PLACEHOLDER;
  const filled = info.path === null ? (unread ? PARAM_PLACEHOLDER : null) : asWritten(info, info.path);
  const path = filled === null ? null : routePathOf(before + filled + split.after);
  if (origin !== null) {
    return {
      url: path === null ? info.url : `${stated}${path}`,
      path,
      baseUrlEnv: null,
      host: (origin[2] ?? '').toLowerCase(),
    };
  }
  const env = split.baseUrlEnv ?? info.baseUrlEnv;
  return {
    url: path === null ? info.url : `${env === null ? '' : `\${${env}}`}${path}`,
    path,
    baseUrlEnv: env,
    host: null,
  };
};

/**
 * The route text a path states: what is left once every hole, read as a
 * parameter or not read at all, is taken out. `/bot${…}/:param` states `bot`;
 * `/${…}` states nothing, however it is drawn.
 */
const statedRouteText = (path: string | null): number =>
  path === null
    ? 0
    : path
        .split(UNREAD_SPAN)
        .join('')
        .split('/')
        .filter((segment) => segment !== PARAM_PLACEHOLDER)
        .join('').length;

/**
 * How sure an address is, for weighing a caller's reading against the
 * request's own: first how much of the route it states, then whether it says
 * where it goes - a host, or the setting it is rooted at. Only the order means
 * anything.
 *
 * A caller whose value is not read reads no path, and so states less than
 * `https://host/bot${token}/…` does: that request stays the helper's, static.
 * Against `${this.baseUrl}${path}`, which states no route text at all, the
 * caller loses nothing, and it is where the address is decided and where an
 * annotation completes it.
 */
export const surenessOf = (info: UrlInfo): number =>
  statedRouteText(info.path) * 2 + (info.host === null && info.baseUrlEnv === null ? 0 : 1);
