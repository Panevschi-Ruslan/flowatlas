import { choosesASegment, constantPropertyValue, holeIn, normalizePath, PARAM_PLACEHOLDER, UNREAD_SPAN } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { evaluateExpression } from '@flowatlas/extractor-nestjs';
import { readConfig } from './config.js';
import { deref, rootConfigAddress, type SplitAddress } from './trace.js';

export interface UrlInfo {
  /** The address as written, with interpolations shown as `${…}`. */
  url: string | null;
  /** Path only, with parameters normalised, or null when it could not be read. */
  path: string | null;
  /** Environment key the address is rooted at, when it is. */
  baseUrlEnv: string | null;
  /**
   * What the code falls back to where that key is not set, when it writes one:
   * `process.env.ORDERS_URL ?? 'http://orders:3000'` (P77).
   */
  baseUrlDefault?: string;
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
export const analyzeUrl = (node: TsNode, options: { readonly whole?: boolean } = {}): UrlInfo => {
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

  if (Node.isBinaryExpression(argument)) return fromConcatenation(argument);
  // The whole address is a setting: `fetch(process.env.REINDEX_URL)` asks for
  // whatever the setting holds, path and all, and nothing more (P91). The path
  // is empty rather than unread: it is the value's, which the linker reads.
  // Only for the address a request is made to (`whole`): a setting handed to a
  // helper as one piece of an address is that piece, not an address.
  // Read where it stands, not followed: a helper that builds an address on a
  // setting has written a path of its own, which following it would lose.
  if (!Node.isTemplateExpression(argument)) {
    const whole = options.whole === true ? readConfig(argument) : null;
    if (whole === null || whole.dynamic === true) return EMPTY;
    const otherwise = typeof whole.defaultValue === 'string' && whole.defaultValue !== '' ? whole.defaultValue : undefined;
    return {
      url: `\${${whole.key}}`,
      path: '',
      baseUrlEnv: whole.key,
      host: null,
      ...(otherwise === undefined ? {} : { baseUrlDefault: otherwise }),
    };
  }

  const head = argument.getHead().getLiteralText();
  const spans = argument.getTemplateSpans();

  let baseUrlEnv: string | null = null;
  let baseUrlDefault: string | undefined;
  let rest = head;
  let written = head;
  let start = 0;

  // An address that begins with a configuration value is rooted at it. The
  // value is rarely read where the request is made — it arrives as a
  // constructor argument and is kept in a property — so where it came from is
  // followed rather than only looked for in place.
  const [firstSpan] = spans;
  if (head === '' && firstSpan !== undefined) {
    const root = rootOf(firstSpan.getExpression());
    if (root !== null) {
      baseUrlEnv = root.key;
      baseUrlDefault = root.otherwise;
      const key = root.key;
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

  const fallback = baseUrlDefault === undefined ? {} : { baseUrlDefault };
  const absolute = fromAbsolute(rest);
  if (absolute !== null) return { ...absolute, url: written, baseUrlEnv, ...fallback };
  return { url: written, path: routePathOf(rest), baseUrlEnv, host: null, ...fallback };
};

/**
 * The settings key a value is rooted at, read where it stands first and then
 * followed back, with what the code falls back to where it writes one.
 */
const rootOf = (expression: TsNode): { key: string; otherwise?: string } | null => {
  const direct = readConfig(expression);
  if (direct !== null && direct.dynamic !== true) {
    return {
      key: direct.key,
      ...(typeof direct.defaultValue === 'string' && direct.defaultValue !== '' ? { otherwise: direct.defaultValue } : {}),
    };
  }
  const followed = rootConfigAddress(expression);
  return followed === null ? null : { key: followed.key, ...(followed.otherwise === undefined ? {} : { otherwise: followed.otherwise }) };
};

/**
 * `process.env.X + '/loans'`: an address rooted at a setting, joined with
 * `+` rather than written as a template (P54). Only a setting followed by text
 * that is read is an address; anything else is not read as one.
 */
const fromConcatenation = (argument: TsNode): UrlInfo => {
  if (!Node.isBinaryExpression(argument) || argument.getOperatorToken().getText() !== '+') return EMPTY;
  const root = rootOf(argument.getLeft());
  const rest = evaluateExpression(argument.getRight());
  if (root === null) return fromWrittenConcatenation(argument);
  if (!rest.resolved || typeof rest.value !== 'string') return EMPTY;
  return {
    url: `\${${root.key}}${rest.value}`,
    path: routePathOf(rest.value),
    baseUrlEnv: root.key,
    host: null,
    ...(root.otherwise === undefined ? {} : { baseUrlDefault: root.otherwise }),
  };
};

/** The pieces of `a + b + c`, left to right. */
const piecesOf = (node: TsNode): TsNode[] =>
  Node.isBinaryExpression(node) && node.getOperatorToken().getText() === '+'
    ? [...piecesOf(node.getLeft()), ...piecesOf(node.getRight())]
    : [node];

/**
 * `'https://catalog/items/' + id`: an address written out and joined with `+`
 * to a value read at run time (P91). Read as the same address written as a
 * template would be - text that is read, and a hole where it is not - so long
 * as it opens with text that is read.
 */
const fromWrittenConcatenation = (argument: TsNode): UrlInfo => {
  const [first, ...more] = piecesOf(argument);
  const opening = first === undefined ? undefined : evaluateExpression(first);
  if (opening?.resolved !== true || typeof opening.value !== 'string' || opening.value === '') return EMPTY;
  let rest = opening.value;
  let written = opening.value;
  more.forEach((piece, index) => {
    const value = evaluateExpression(piece);
    if (value.resolved && (typeof value.value === 'string' || typeof value.value === 'number')) {
      rest += String(value.value);
      written += String(value.value);
      return;
    }
    const next = more[index + 1];
    const after = next === undefined ? undefined : evaluateExpression(next);
    const text = after?.resolved === true && typeof after.value === 'string' ? after.value : '';
    rest += holeIn(rest, text, index === more.length - 1);
    written += HOLE;
  });
  const absolute = fromAbsolute(rest);
  if (absolute !== null) return { ...absolute, url: written };
  return { url: written, path: routePathOf(rest), baseUrlEnv: null, host: null };
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
  const otherwise = split.baseUrlEnv === null ? info.baseUrlDefault : split.otherwise;
  return {
    url: path === null ? info.url : `${env === null ? '' : `\${${env}}`}${path}`,
    path,
    baseUrlEnv: env,
    host: null,
    ...(otherwise === undefined ? {} : { baseUrlDefault: otherwise }),
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
