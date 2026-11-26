/**
 * The edit index (P387): per file, the names written there that another
 * repository uses, as the edit hook reads them. Only the format and how a
 * name is counted in a text are here, so the hook loads nothing else; the
 * index is written by `build` (`edit-index.ts`).
 */
export const EDITS_FILE = 'edits.json';
export const EDITS_FORMAT_VERSION = 1;

/**
 * How a name is found in a file's text:
 * - `line`: a route's declaring line, whitespace aside (`@Patch(':id/cancel')`,
 *   `router.patch('/orders/:id/cancel', …)`); a verb, a path or the whole
 *   declaration changed takes it out;
 * - `word`: a literal not inside a longer name (a channel, a message type, a
 *   deployed function's name);
 * - `field`: a field as code sends or reads it - a key (`deskNumber:`,
 *   `{ deskNumber }`), a member (`.deskNumber`, `['deskNumber']`) - so a value
 *   kept under a new key (`deskNo: deskNumber`) counts as the field gone.
 */
export type EditMatch = 'line' | 'word' | 'field';

export interface EditName {
  kind: 'route' | 'function' | 'channel' | 'message type' | 'field';
  match: EditMatch;
  /** What is looked for in the text. */
  text: string;
  /** How many times the file held it when the graph was built. */
  count: number;
  line: number;
  said: string;
  role: string;
  /** The uses named, nearest first; `more` counts the rest. */
  users: string[];
  more?: number;
  /** The node the graph's tools take about it. */
  id: string;
}

export interface EditIndex {
  editsFormatVersion: number;
  builtAt: string;
  /** Each service's repository directory, so an edited file's path says its service. */
  services: Record<string, string>;
  /** `service` then a tab then the repository-relative POSIX path, to the names written in that file. */
  files: Record<string, EditName[]>;
  /**
   * Why the build could not write the index, when it could not (P396): `files`
   * is then empty, so the hook says nothing, and `doctor` says this.
   */
  unwritten?: string;
}

export const fileKey = (service: string, file: string): string => `${service}\t${file}`;

/** Runs of whitespace as one space, ends trimmed: a line compares whatever its indentation. */
export const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim();

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const occurrences = (text: string, pattern: RegExp): number => {
  let found = 0;
  for (const _match of text.matchAll(pattern)) found += 1;
  return found;
};

/** How many times a text holds a name, the way its `match` reads it. */
export const countIn = (text: string, name: Pick<EditName, 'match' | 'text'>): number => {
  if (name.text === '') return 0;
  if (name.match === 'line') {
    const haystack = squeezed(text);
    const needle = squeezed(name.text);
    if (needle === '') return 0;
    let found = 0;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) found += 1;
    return found;
  }
  const word = escaped(name.text);
  if (name.match === 'word') return occurrences(text, new RegExp(`(?<![\\w$])${word}(?![\\w$])`, 'g'));
  // A member read, a key or a parameter (`name:`, `name?:`), shorthand in an object literal, a bracketed key.
  const field = new RegExp(
    `(?:\\??\\.${word}(?![\\w$]))|(?:(?<![\\w$.])${word}\\s*\\??\\s*:(?!:))|(?:[{,]\\s*${word}\\s*(?=[,}]))|(?:\\[\\s*['"\`]${word}['"\`]\\s*\\])`,
    'g',
  );
  return occurrences(text, field);
};
