import { choosesASegment, constantPropertyValue, holeIn, normalizePath, UNREAD_SPAN } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { evaluateExpression } from '@flowatlas/extractor-nestjs';
import { readConfig } from './config.js';
import { deref, rootConfigKey } from './trace.js';

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
