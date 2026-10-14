/**
 * A consumer that takes only some of what is published on its channel (P52).
 *
 * Most consumers of a channel take everything on it. Some take what a publisher
 * does to it by kind - objects created, not removed - and only under some
 * names - keys starting `incoming/` and ending `.png`. Both halves are data on
 * the two nodes: the publisher records its kind and the values it wrote
 * (`RECORDED_META`), the consumer what it takes (`TAKES_META`), and the linker
 * asks of each publish whether anything on its channel takes it.
 *
 * A kind is written in segments separated by `:`; a last segment of `*` stands
 * for any, on either side. A publisher of any of a family meets a consumer of
 * one member as a guess, since which of them it is is not written.
 */

/** Where a consumer says what it takes. */
export const TAKES_META = 'takes';

/** Where a publisher keeps values of the call as written, by name, each a list of what was read. */
export const RECORDED_META = 'recorded';

/**
 * Where a publisher says why every edge out of it is a guess: a URL signed for
 * somebody else to write with is a publish only if they do.
 */
export const GUESSED_META = 'guessed';

/**
 * Where a publisher's edge onto a channel says which of the channel's
 * consumers take what it publishes, by id; a walk through the channel from that
 * publisher goes on to those alone.
 */
export const TAKEN_BY_META = 'takenBy';

/** What a consumer takes of its channel. */
export interface Takes {
  /** The kinds it takes; a last segment of `*` takes every kind sharing the rest. */
  readonly kinds: readonly string[];
  /** The recorded value it filters on, by the start and the end it must have. */
  readonly by?: { readonly field: string; readonly prefix?: string; readonly suffix?: string };
}

/** Whether a publish is taken: for certain, perhaps (and why), or not at all. */
export type Taken =
  | { readonly taken: 'static' }
  | { readonly taken: 'heuristic'; readonly because: string }
  | { readonly taken: 'no' };

const NO: Taken = { taken: 'no' };
const STATIC: Taken = { taken: 'static' };
const ANY = '*';

const split = (kind: string): { family: string; last: string } => {
  const at = kind.lastIndexOf(':');
  return at < 0 ? { family: '', last: kind } : { family: kind.slice(0, at), last: kind.slice(at + 1) };
};

const kindTaken = (published: string, taken: string): Taken => {
  const [written, wanted] = [split(published), split(taken)];
  if (written.family !== wanted.family) return NO;
  if (wanted.last === ANY || written.last === wanted.last) return STATIC;
  if (written.last === ANY) return { taken: 'heuristic', because: `the call is any of ${published}, and it takes ${taken} alone` };
  return NO;
};

/** The strongest of several answers. */
export const strongestTaken = (answers: readonly Taken[]): Taken =>
  answers.find((answer) => answer.taken === 'static') ?? answers.find((answer) => answer.taken === 'heuristic') ?? NO;

const weaker = (a: Taken, b: Taken): Taken => (a.taken === 'no' || b.taken === 'no' ? NO : a.taken === 'heuristic' ? a : b);

/**
 * Whether a value as written has the filter at one end. A value written as a
 * pattern (`incoming/*.png`, from a template) fixes its start up to its first
 * `*` and its end after its last; a filter longer than what is fixed may hold.
 */
const ENDS: Readonly<Record<'prefix' | 'suffix', { word: string; test: (value: string, filter: string) => Taken }>> = {
  prefix: {
    word: 'starting',
    test: (value, filter) => {
      const star = value.indexOf(ANY);
      const fixed = star < 0 ? value : value.slice(0, star);
      if (fixed.startsWith(filter)) return STATIC;
      return star >= 0 && filter.startsWith(fixed) ? { taken: 'heuristic', because: `is written as starting "${fixed}", and only one starting "${filter}" is taken` } : NO;
    },
  },
  suffix: {
    word: 'ending',
    test: (value, filter) => {
      const star = value.lastIndexOf(ANY);
      const fixed = star < 0 ? value : value.slice(star + 1);
      if (fixed.endsWith(filter)) return STATIC;
      return star >= 0 && filter.endsWith(fixed) ? { taken: 'heuristic', because: `is written as ending "${fixed}", and only one ending "${filter}" is taken` } : NO;
    },
  },
};

/**
 * Whether a consumer takes a publish of `kind`, given the values the publisher
 * recorded: by kind, then by the recorded value it filters on - as written
 * (`static` where both say so), or not read, which is a guess wherever the
 * consumer filters on it.
 */
export const isTaken = (kind: string, recorded: Readonly<Record<string, readonly string[]>> | undefined, takes: Takes): Taken => {
  const byKind = strongestTaken(takes.kinds.map((taken) => kindTaken(kind, taken)));
  const by = takes.by;
  const ends = (['prefix', 'suffix'] as const).filter((end) => (by?.[end] ?? '') !== '');
  if (byKind.taken === 'no' || by === undefined || ends.length === 0) return byKind;
  const values = recorded?.[by.field] ?? [];
  if (values.length === 0) {
    const filters = ends.map((end) => `${ENDS[end].word} "${by[end] as string}"`).join(' and ');
    return weaker(byKind, { taken: 'heuristic', because: `${by.field} is not read, and only one ${filters} is taken` });
  }
  const byValue = strongestTaken(values.map((value) => ends.reduce<Taken>((answer, end) => weaker(answer, ENDS[end].test(value, by[end] as string)), STATIC)));
  return weaker(byKind, byValue.taken === 'heuristic' ? { taken: 'heuristic', because: `${by.field} ${byValue.because}` } : byValue);
};
