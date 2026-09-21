/**
 * What a marker was given, read the same way wherever it is read.
 *
 * An annotation exists for the places static reading is blind, so the one thing
 * it must never do is fail quietly: a reader who annotates a method and gets no
 * edge and no complaint has been told the tool agrees with them. Three readers
 * asked three narrow questions of the same recorded arguments — the first one
 * only, strings only, and anything else treated as no annotation at all — and
 * between them `@Emits('a', 'b')` kept `a`, `@Emits(['a', 'b'])` kept nothing,
 * and neither said a word (R38).
 *
 * This is the one answer. Every argument is a name or a list of names, what
 * cannot be read comes back as refused rather than missing, and whoever asked
 * decides what to say about it.
 */

/** A marker as the extractor recorded it: a name, and its arguments as values. */
export interface RecordedMarker {
  name: string;
  args: unknown[];
}

/**
 * An argument that names nothing, and why.
 *
 * `unreadable` — the resolver could not follow it, and `text` is as written.
 * `not-a-name` — it resolved to something that is not a name: a number, an
 * object, a list with a hole in it. Kept apart because the advice differs: the
 * first wants a literal or a shared const, the second wants a different value.
 */
export interface RefusedArg {
  text: string;
  why: 'unreadable' | 'not-a-name';
}

export interface MarkerNames {
  /** Every name given, in the order written, with repeats dropped. */
  names: string[];
  /** Arguments that named nothing. Never silently discarded. */
  refused: RefusedArg[];
}

/** True for `{ unresolved: '<text>' }`, which is how an unread argument is recorded. */
const unreadable = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('unresolved' in value)) return undefined;
  const text = (value as { unresolved: unknown }).unresolved;
  return typeof text === 'string' ? text : '?';
};

/** An argument as a reader would quote it back, for a message about it. */
const asWritten = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Which of a marker's arguments are names, and where they start.
 *
 * Written once, because every place that asked this question separately was a
 * place a new annotation could be added and quietly do nothing — which is the
 * failure R38 was raised about, reappearing in the fix for it. A marker absent
 * from this table takes no names at all.
 */
const NAME_ARGS: Readonly<Record<string, number>> = Object.freeze({
  Emits: 0,
  Consumes: 0,
  // The first argument names the service; every one after it is a route.
  CallsService: 1,
});

/** Whether this marker takes names at all, and so must end up naming one. */
export const takesNames = (marker: string): boolean => Object.hasOwn(NAME_ARGS, marker);

/**
 * The names a marker gives, from every argument it was given.
 *
 * The arguments that are not names are skipped by the table above rather than
 * by each caller counting them off, so one reader serves every marker.
 *
 * An empty list contributes no name and is not refused: `@Emits(...EMPTY)` has
 * named nothing, which is a fact about the catalogue rather than about the
 * argument. A marker left naming nothing at all is a finding wherever markers
 * are checked, and that is where it belongs.
 */
export const namesGivenTo = (marker: RecordedMarker): MarkerNames => {
  const from = NAME_ARGS[marker.name] ?? 0;
  const names: string[] = [];
  const refused: RefusedArg[] = [];
  const keep = (name: string): void => {
    if (!names.includes(name)) names.push(name);
  };

  for (const argument of marker.args.slice(from)) {
    const text = unreadable(argument);
    if (text !== undefined) {
      refused.push({ text, why: 'unreadable' });
      continue;
    }
    // An empty string is a string and not a name: kept, it becomes a channel
    // with no id, or a route with no path, and nothing says a word about it.
    if (typeof argument === 'string') {
      if (argument === '') refused.push({ text: "''", why: 'not-a-name' });
      else keep(argument);
      continue;
    }
    if (Array.isArray(argument) && argument.every((item) => typeof item === 'string')) {
      if (argument.some((item) => item === '')) {
        refused.push({ text: asWritten(argument), why: 'not-a-name' });
        continue;
      }
      for (const item of argument) keep(item);
      continue;
    }
    refused.push({ text: asWritten(argument), why: 'not-a-name' });
  }

  return { names, refused };
};
