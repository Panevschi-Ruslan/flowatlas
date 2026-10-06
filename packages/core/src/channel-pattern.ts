import type { ValueFilter } from './adapters/deployment.js';

/**
 * Three facts a reader of a deployment leaves on the graph for the linker to
 * finish, because finishing them needs every repository's graph at once.
 *
 * Each is a key of a node's `meta` and a shape, stated here so that whoever
 * writes one and the linker that reads it cannot come to spell it differently.
 * None of them names a platform: a value a function is deployed with, an address
 * waiting on such a value, and a channel named by a filter rather than by a name
 * are the same things wherever code is deployed.
 */

/**
 * On a node that runs code a deployment configures - a deployed function's
 * entry - the values it is deployed with, by variable: a record of
 * {@link EnvironmentValue}.
 */
export const ENVIRONMENT_META = 'environment';

/** One value a deployment sets, as the graph keeps it. */
export interface EnvironmentValue {
  /** What it is written as, for a reader: a reference or a literal. */
  readonly written: string;
  /**
   * The value, when it was read: the deployed name of what it refers to, or the
   * text the files settle. Absent when it was not read, and `unread` says why.
   */
  readonly value?: string;
  /** What the value refers to, when it refers to something deployed. */
  readonly kind?: string;
  readonly unread?: string;
  /** The input variable it depends on, when that is why it is not read. */
  readonly variable?: string;
  /** The variable files that disagree on it, and what each says. */
  readonly files?: Readonly<Record<string, string>>;
}

/**
 * On a producer, every address it sends to that is one value of the
 * environment away from being read: a list of {@link AwaitedAddress}.
 */
export const AWAITING_META = 'awaiting';

/**
 * One part of an address: written in the code, or the value of an environment
 * variable with the longer spellings the name may be written inside (`forms`,
 * each a regular expression whose first group is the name).
 */
export type AwaitedPart = string | { readonly environment: string; readonly forms?: readonly string[] };

/**
 * The name inside a longer spelling of it.
 *
 * Each form is a regular expression whose first group is the name; the first
 * that matches answers, and a value none matches is the name as written. Applied
 * to a pattern as readily as to a name, because the part a pattern leaves open
 * is often exactly the part the form drops - a region, an account.
 */
export const nameWithin = (value: string, forms: readonly string[] = []): string => nameInForms(value, forms) ?? value;

/** The name inside a longer spelling of it, or `undefined` when no form fits. */
export const nameInForms = (value: string, forms: readonly string[]): string | undefined => {
  for (const form of forms) {
    const found = new RegExp(form).exec(value)?.[1];
    if (found !== undefined && found !== '') return found;
  }
  return undefined;
};

/**
 * What joins the parts of an address into the name of its channel.
 *
 * Stated once for every side that spells a name in parts: a publisher read
 * from code joins what it read with it, a reader of a deployment joins the
 * names it settled with it, and a pattern is matched against a name split on it.
 */
export const ADDRESS_SEPARATOR = '/';

/** An address waiting on the environment, and the message sent to it. */
export interface AwaitedAddress {
  /** The channel's name in parts, joined by `ADDRESS_SEPARATOR` once every part is known. */
  readonly parts: readonly AwaitedPart[];
  /** The type id of the message, when it was read. */
  readonly payload?: string;
}

/**
 * On a consumer, the channels it takes from when they are selected by a filter
 * rather than named: a {@link ChannelPattern}. The linker joins it to every
 * channel in the project whose name the pattern matches.
 */
export const CHANNEL_PATTERN_META = 'channelPattern';

/**
 * A channel name as a filter: one entry per `ADDRESS_SEPARATOR`-separated part of the name, in
 * order. A part with no filters matches any value; several are any-of.
 */
export interface ChannelPattern {
  readonly parts: readonly { readonly name: string; readonly filters: readonly ValueFilter[] }[];
}

/** How a channel matched a pattern. */
export interface PatternMatch {
  /** Every part matched by an exact value, which is a join as good as a name. */
  readonly exact: boolean;
  /** Why the match is not exact, one phrase per part that is not. */
  readonly because: readonly string[];
}

const wildcardTest = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** Whether one value passes one filter. */
const passes = (value: string, filter: ValueFilter): boolean => {
  if ('equals' in filter) return value === filter.equals;
  if ('prefix' in filter) return value.startsWith(filter.prefix);
  if ('suffix' in filter) return value.endsWith(filter.suffix);
  if ('equalsIgnoreCase' in filter) return value.toLowerCase() === filter.equalsIgnoreCase.toLowerCase();
  if ('wildcard' in filter) return wildcardTest(filter.wildcard).test(value);
  if ('anythingBut' in filter) return !filter.anythingBut.some((inner) => passes(value, inner));
  if ('exists' in filter) return filter.exists;
  return false;
};

/** A filter as a phrase. */
const phrase = (filter: ValueFilter): string => {
  if ('equals' in filter) return JSON.stringify(filter.equals);
  if ('prefix' in filter) return `prefix ${JSON.stringify(filter.prefix)}`;
  if ('suffix' in filter) return `suffix ${JSON.stringify(filter.suffix)}`;
  if ('equalsIgnoreCase' in filter) return `${JSON.stringify(filter.equalsIgnoreCase)} in any case`;
  if ('wildcard' in filter) return `wildcard ${JSON.stringify(filter.wildcard)}`;
  if ('anythingBut' in filter) return `anything but ${filter.anythingBut.map(phrase).join(' or ')}`;
  if ('exists' in filter) return filter.exists ? 'present' : 'absent';
  return filter.unread;
};

/**
 * Whether a channel's name matches a pattern, and how.
 *
 * Every part is matched as written: an exact value is an exact match, and any
 * other filter - a prefix, a negation, a wildcard, a part not filtered at all -
 * is a match the tool worked out rather than a name both sides wrote, which the
 * answer says and the caller ranks below a name (I3). A part of the channel's
 * name that was not read on the publishing side (`*`) matches only a part that
 * is not filtered. A filter this reading does not evaluate matches nothing.
 */
export const matchChannelPattern = (name: string, pattern: ChannelPattern): PatternMatch | undefined => {
  const segments = name.split(ADDRESS_SEPARATOR);
  if (segments.length !== pattern.parts.length) return undefined;
  const because: string[] = [];
  for (const [index, part] of pattern.parts.entries()) {
    const segment = segments[index] as string;
    if (part.filters.length === 0) {
      because.push(`${part.name} is not filtered`);
      continue;
    }
    if (segment.includes('*')) return undefined;
    const matched = part.filters.find((filter) => passes(segment, filter));
    if (matched === undefined) return undefined;
    if (!('equals' in matched)) because.push(`${part.name} ${JSON.stringify(segment)} matches ${phrase(matched)}`);
  }
  return { exact: because.length === 0, because };
};
