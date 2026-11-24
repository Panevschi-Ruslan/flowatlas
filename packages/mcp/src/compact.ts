/**
 * Compact answers (P365): what an agent is handed says each fact once.
 *
 * Every row naming a node carries an `id` that already says the node's kind
 * (`consumer:`, `entry:`, `channel:`), its service (`orders#`, `entry:orders:`)
 * and its file (`#src/orders/orders.service.ts:`), and most often its name
 * (the id's tail). A full answer says each of them again beside the id, on
 * every row, and the agent pays for every byte on every later turn. So every
 * answer passes through here on its way out, once, whatever tool wrote it -
 * the same boundary the `offered.ts` filter is applied at - and loses only
 * what is said twice. On a row with an `id` (or a gap's `gapId`, which names
 * the service and the file as well):
 *
 * - `type` when the id starts with it (`consumer:…`), and `method` when the id
 *   is a symbol's whose tail is `Class.member`;
 * - `service` when the id names it;
 * - the file of `loc` when the id holds it: `loc` becomes `line` (a number),
 *   or goes when the id holds the line too; a way in's `loc` becomes `line`
 *   too where its `by`, the code handling it, is written in that file (P374),
 *   and a screen's `loc`, a line of its routing table, goes beside the `by`
 *   naming the component it shows, whose file is the one to read (P379);
 * - `label` when it is the id's tail, as written or said aloud (`GET /orders`
 *   beside `entry:shop:http:GET:/orders`);
 * - `kind` when the way in's id says it (`entry:<service>:<kind>:…`);
 * - any other field that is the tail of the row's id or of an id its `meta`
 *   says in full (a gap's `reason` beside its `gapId`, `selectedIn` beside
 *   `meta.selectedBy`), and a `meta` key equal to the row's own field.
 *
 * Anywhere below the answer's own fields, a field whose value is the id of
 * the answer's `target` (a failure's `at` thrown in the very method impact
 * was asked about) or of a row it is inside goes, and a `file` an id beside it
 * holds (the row's own, another field's, the target's) goes too (P367).
 *
 * Where an answer (or one of the answers of a call asked several things)
 * says `left`, its `truncated`, `stoppedBy` and `frontier` go: `left` says
 * each cut, and `next` the call that walks on from the frontier (P370).
 *
 * A row of a tree (`{node, edge, children}`, as get_flow, who_calls and a
 * walk write it) is said as the node itself with `edge` and `children` beside
 * its fields, and an edge's `confidence` goes where it is `static`, which an
 * edge is unless it says otherwise; an edge's `params` and `returns` longer
 * than `EDGE_TYPE_LIMIT` say each object type written inline by its size
 * (`{…22 fields}`), the answer saying so once in `note` (P379); an edge with
 * nothing left but its type is
 * said as the type (`"edge": "calls"`). The tree's shape is how a page draws
 * it, not something an agent reads (P370).
 *
 * Below the answer's own fields, a field that is null, false, or an empty list
 * or object goes too. The answer's own fields stay as they are: an empty list
 * there (no consumer) or a `false` (`dead: false`) is the answer. `next` keeps
 * the paging call alone when the list was cut, and otherwise at most two calls.
 *
 * A row of a list (an element of a list below the answer's own fields, with
 * an `id`, and not a row of a tree, whose steps are one flow's) keeps from its
 * `meta` only its plain facts: strings, numbers, booleans and lists of them
 * (P375). Its structured facts (`fails`, `access`, `decorators`, `signature`:
 * records and lists of records) are one node's, for the call that answers
 * about that node; the answer says once, in `note`, which went and which call
 * gives them. A list asked at `detail: 2` was paying for every exception any
 * code under each route can throw, on every row.
 *
 * A field it does not know is kept, so a field a later tool adds is handed on
 * whole. `verbose: true` on any tool skips this and answers as before.
 * `get_source` is never compacted: what it returns is code, said once already.
 */

/** Tools whose answer is handed on as written, `verbose` or not. */
export const FULL_ANSWER_TOOLS: ReadonlySet<string> = new Set(['get_source']);

/** How many calls a compact `next` holds when the list was not cut. */
export const COMPACT_MAX_NEXT = 2;

/**
 * Fields never dropped, by any rule but their own: whether the answer is the
 * whole answer, and whether and from where a row is reached. A row's id stays
 * too, whatever else says it, and a row's `field`, the name of a field read or
 * sent, which may be spelled as the tail of the id of the method reading it
 * (`note` read in `Controller.note`) and says something else (P374).
 */
const KEPT: ReadonlySet<string> = new Set(['id', 'gapId', 'complete', 'left', 'reach', 'from', 'gap', 'behind', 'field']);

/** The fields `left` says, on an answer that says it (P370). */
const SAID_BY_LEFT: ReadonlySet<string> = new Set(['truncated', 'stoppedBy', 'frontier']);

/** The confidence an edge has unless it says otherwise. */
const DEFAULT_CONFIDENCE = 'static';

/** The fields that name the row, each dropped only by its own rule above. */
const IDENTITY: ReadonlySet<string> = new Set(['type', 'label', 'kind', 'service', 'loc']);

/** The fields that are a row's own id. */
const ID_KEYS = ['id', 'gapId'] as const;

/** The characters an id's parts are separated by, so a tail starts after one. */
const ID_SEPARATORS = '#:/.|@ ';

type Plain = Record<string, unknown>;

/** What one compaction left out of a list's rows, said once at the top (P375), and whether it shortened a type (P379). */
interface Pass {
  leftOut: Set<string>;
  typesCut: boolean;
}

/**
 * The longest type an edge says as written in a compact answer (P379): past
 * it, each object type written inline is said by its size, `{…22 fields}`.
 * Type names and short types stay; a body's every field, on every caller's
 * row, was hundreds of characters an agent re-read on every turn.
 */
export const EDGE_TYPE_LIMIT = 48;

/** The fields of an object type's body, `a: string; b?: number`, at its own depth. */
const fieldsIn = (body: string): number => {
  let depth = 0;
  let fields = 0;
  let open = false;
  let before = '';
  for (const char of body) {
    if ('{([<'.includes(char)) depth += 1;
    // The `>` of a function type's `=>` closes nothing.
    else if ('})]'.includes(char) || (char === '>' && before !== '=')) depth -= 1;
    before = char;
    if (depth === 0 && (char === ';' || char === ',')) {
      if (open) fields += 1;
      open = false;
    } else if (char.trim() !== '') open = true;
  }
  return fields + (open ? 1 : 0);
};

/**
 * A type as a compact edge says it (P379): as written up to
 * `EDGE_TYPE_LIMIT`, past it each outermost object type written inline said
 * by its size (`Observable<{…22 fields}>`); a long type with none stays.
 */
export const typeSaid = (type: string): string => {
  if (type.length <= EDGE_TYPE_LIMIT) return type;
  let out = '';
  let depth = 0;
  let start = -1;
  for (let at = 0; at < type.length; at += 1) {
    const char = type.charAt(at);
    if (char === '{') {
      if (depth === 0) start = at;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const fields = fieldsIn(type.slice(start + 1, at));
        out += `{\u2026${fields} field${fields === 1 ? '' : 's'}}`;
      }
    } else if (depth === 0) out += char;
  }
  // An unbalanced type is said as written, rather than cut wrong.
  return depth === 0 ? out : type;
};

/** The most `meta` keys the note names. */
const NOTE_KEYS = 5;

/** A plain fact: a string, a number, a boolean, or a list of them. */
const isPlainFact = (value: unknown): boolean => {
  const scalar = (item: unknown): boolean => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean';
  return scalar(value) || (Array.isArray(value) && value.every(scalar));
};

/** What the answer says when a list's rows left out their structured facts (P375). */
export const listNote = (keys: readonly string[]): string => {
  const named = [...keys].sort();
  const shown = named.slice(0, NOTE_KEYS).join(', ') + (named.length > NOTE_KEYS ? ', ...' : '');
  return `rows of a list leave out their structured facts (${shown}): get_flow({entry: id}) or impact({symbol: id}) at detail 2 gives one node's, verbose: true every row's`;
};

/** What the answer says when an edge's long inline type was said by its size (P379). */
export const TYPES_NOTE = 'a long type written inline is said by its field count: verbose: true gives it whole';

/** A list row's `meta` with only its plain facts, the keys left out noted in `pass`. */
const plainMeta = (meta: Plain, pass: Pass): Plain => {
  const kept: Plain = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isPlainFact(value)) kept[key] = value;
    // Nothing is no structured fact: it goes as every blank field does, unsaid.
    else if (!isBlank(value)) pass.leftOut.add(key);
  }
  return kept;
};

const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Null, false, or an empty list or object: a field that says nothing. */
const isBlank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === false ||
  (Array.isArray(value) && value.length === 0) ||
  (isPlain(value) && Object.keys(value).length === 0);

/** Whether `text` is the whole id or its tail, starting after a separator. */
export const isIdTail = (id: string, text: string): boolean => {
  if (text === '' || text.length > id.length) return false;
  if (text === id) return true;
  return id.endsWith(text) && ID_SEPARATORS.includes(id.charAt(id.length - text.length - 1));
};

/** Whether a label is the id's tail as written, or said aloud: its first space a `:` (`GET /orders`, `event order.created`). */
export const isSaidTail = (id: string, label: string): boolean => isIdTail(id, label) || (label.includes(' ') && isIdTail(id, label.replace(' ', ':')));

/** A symbol's id, `<repo>#<file>:<name>`: no kind before it. */
const SYMBOL_ID = /^([^#:|@\s]+)#[^:]*:(.+)$/;

/**
 * The service an id names, by the grammar of `ids.ts`: `<repo>#<file>:…` for
 * a symbol; `<kind>:<repo>#…` and `gap:<repo>|…` for a row of a repository;
 * `entry:<service>:…` and `entry:<service>@<application>:…` for a way in. A
 * channel's id names no service (`channel:<name>#<value>` is a message type).
 */
export const serviceOfId = (id: string): string | undefined => {
  const symbol = /^([^#:|@\s]+)#/.exec(id);
  if (symbol !== null) return symbol[1];
  const prefixed = /^([a-z_]+):([^#:|@\s]+)([#|:@])/.exec(id);
  if (prefixed === null) return undefined;
  const [, prefix, name, separator] = prefixed;
  if (prefix === 'channel') return undefined;
  if (separator === '#' || separator === '|') return name;
  return prefix === 'entry' ? name : undefined;
};

/** The kind a way in's id says: `entry:<service>:<kind>:<key>`. */
const kindOfId = (id: string): string | undefined => /^entry:[^:]+:([^:]+):/.exec(id)?.[1];

/** Whether the id holds `file` as a whole part: after `#` or `|`, before `:`, `|`, `#` or its end. */
const holdsFile = (id: string, file: string): boolean => {
  if (file === '') return false;
  for (const opener of ['#', '|']) {
    let at = id.indexOf(`${opener}${file}`);
    while (at >= 0) {
      const after = id.charAt(at + 1 + file.length);
      if (after === '' || after === ':' || after === '|' || after === '#') return true;
      at = id.indexOf(`${opener}${file}`, at + 1);
    }
  }
  return false;
};

/**
 * What is left of `loc` once the id said its file: `undefined` when nothing
 * is (the id holds the line too, or `loc` had none), a line number, or `loc`
 * itself when the id does not hold its file.
 */
export const locBeside = (id: string, loc: string): { line: number } | { loc: string } | undefined => {
  const parts = /^(.*?)((?::\d+)*)$/.exec(loc);
  const file = parts?.[1] ?? loc;
  const at = parts?.[2] ?? '';
  if (!holdsFile(id, file)) return { loc };
  if (at === '') return undefined;
  const whole = `${file}${at}`;
  const held = id.indexOf(whole);
  if (held >= 0 && [':', ''].includes(id.charAt(held + whole.length))) return undefined;
  const line = /^:(\d+)$/.exec(at);
  return line === null ? { loc } : { line: Number(line[1]) };
};

/** `loc` beside every id of the row: the least any of them leaves. */
const locBesideAll = (ids: readonly string[], loc: string): { line: number } | { loc: string } | undefined => {
  let least: { line: number } | { loc: string } | undefined = { loc };
  for (const id of ids) {
    const left = locBeside(id, loc);
    if (left === undefined) return undefined;
    if ('line' in left) least = left;
  }
  return least;
};

const sameValue = (left: unknown, right: unknown): boolean => left === right || JSON.stringify(left) === JSON.stringify(right);

/**
 * Whether a value is a part of one of the row's ids: its tail, or a whole
 * part between `:`, `#` and `|` (a way in's method, a symbol's file, a
 * service's name).
 */
export const isIdPart = (ids: readonly string[], value: string): boolean =>
  value.length >= 2 && ids.some((id) => id !== value && (isIdTail(id, value) || partsOf(id).includes(value)));

/** An id's parts past the kind it starts with: `channel` in `channel:…` names the node's kind, not a value it holds. */
const partsOf = (id: string): string[] => id.replace(/^[a-z_]+:/, '').split(/[:#|]/);

/**
 * A row's `meta` without the keys that say again one of the row's own fields,
 * a part of its id, or a word of its label (a request's `method` and `path`
 * beside `GET /orders/:param`).
 */
const metaBeside = (meta: Plain, row: Plain, ids: readonly string[]): Plain => {
  const words = typeof row.label === 'string' ? row.label.split(' ').filter((word) => word.length >= 2) : [];
  const kept: Plain = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key in row && key !== 'meta' && sameValue(row[key], value)) continue;
    if (typeof value === 'string' && (isIdPart(ids, value) || words.includes(value))) continue;
    kept[key] = value;
  }
  return kept;
};

/** The ids a row's `meta` says in full, which a short field beside them may only repeat. */
const metaIds = (meta: unknown): string[] =>
  isPlain(meta) ? Object.values(meta).filter((value): value is string => typeof value === 'string' && value.includes('#')) : [];

/** `next` as a compact answer holds it: the page's call alone when the list was cut, else the first two. */
export const compactNext = (next: readonly string[], nextOffset: unknown): string[] => {
  if (typeof nextOffset === 'number') {
    const paging = next.find((call) => call.includes(`offset: ${nextOffset}`));
    if (paging !== undefined) return [paging];
  }
  return next.slice(0, COMPACT_MAX_NEXT);
};

/** Whether a row's identity field says only what one of its ids says. */
const saidByIds = (key: string, value: string, ids: readonly string[]): boolean => {
  switch (key) {
    case 'type':
      return ids.some((id) => id.startsWith(`${value}:`) || (value === 'method' && SYMBOL_ID.exec(id)?.[2]?.includes('.') === true));
    case 'service':
      return ids.some((id) => serviceOfId(id) === value);
    case 'label':
      return ids.some((id) => isSaidTail(id, value));
    case 'kind':
      return ids.some((id) => kindOfId(id) === value);
    default:
      return false;
  }
};

/** A type an edge says, shortened as `typeSaid` says it, `pass` told when it was. */
const typeOf = (type: unknown, pass: Pass): unknown => {
  if (typeof type !== 'string') return type;
  const said = typeSaid(type);
  if (said !== type) pass.typesCut = true;
  return said;
};

/** The keys of a tree row's `meta` that hold a type: a signature's `type` and `returns`, a request's `bodyType`. */
const TYPE_KEY = /^(type|returns)$|Type$/;

/**
 * A tree row's `meta` with each type it holds, at any depth, said as an
 * edge's is (P379): a method's signature, a request's body, written inline.
 */
const typesIn = (value: unknown, pass: Pass): unknown => {
  if (Array.isArray(value)) return value.map((item) => typesIn(item, pass));
  if (!isPlain(value)) return value;
  const out: Plain = {};
  for (const [key, item] of Object.entries(value)) out[key] = TYPE_KEY.test(key) && typeof item === 'string' ? typeOf(item, pass) : typesIn(item, pass);
  return out;
};

/**
 * An edge as a compact tree says it: without `confidence: static`, its long
 * inline types said by their size (P379), and as its type alone when that is
 * all it says.
 */
const edgeSaid = (edge: unknown, pass: Pass): unknown => {
  if (!isPlain(edge)) return edge;
  const { confidence, ...given } = edge;
  const rest: Plain = { ...given };
  if (Array.isArray(rest.params)) rest.params = rest.params.map((param) => typeOf(param, pass));
  if (rest.returns !== undefined) rest.returns = typeOf(rest.returns, pass);
  const kept = confidence === DEFAULT_CONFIDENCE || confidence === undefined ? rest : { ...rest, confidence };
  const keys = Object.keys(kept);
  return keys.length === 1 && typeof kept.type === 'string' ? kept.type : kept;
};

/**
 * A row of a tree, `{node, edge, children, …}`, as the node with the rest
 * beside its fields (P370); any other object as it is, and a row whose
 * fields would meet the node's as it is too.
 */
const flattened = (row: Plain, pass: Pass): Plain => {
  const node = row.node;
  if (!isPlain(node) || typeof node.id !== 'string' || !('children' in row || 'edge' in row)) return row;
  const { node: _node, edge, children, ...rest } = row;
  if (Object.keys(rest).some((key) => key in node)) return row;
  return { ...node, ...(edge === undefined ? {} : { edge: edgeSaid(edge, pass) }), ...rest, ...(children === undefined ? {} : { children }) };
};

/**
 * `under` holds the ids of the rows a value is inside, which a field below may
 * only name again; `inList` whether the value is an element of a list.
 */
const compactValue = (value: unknown, depth: number, under: readonly string[], pass: Pass, inList = false): unknown => {
  if (Array.isArray(value)) return value.map((item) => compactValue(item, depth, under, pass, true));
  if (!isPlain(value)) return value;
  return compactObject(value, depth, under, pass, inList);
};

const compactObject = (given: Plain, depth: number, under: readonly string[], pass: Pass, inList: boolean): Plain => {
  const row = flattened(given, pass);
  // A row of a list to choose among, not a step of a tree (P375).
  const listRow = inList && depth > 0 && !isPlain(given.node) && !('children' in given) && typeof row.id === 'string';
  // A step of a tree (get_flow, who_calls), whose types are said as its edge's are (P379).
  const treeRow = isPlain(given.node) && ('children' in given || 'edge' in given);
  const leftSays = Array.isArray(row.left) && row.left.length > 0;
  const ids = ID_KEYS.map((key) => row[key]).filter((value): value is string => typeof value === 'string');
  const fullIds = [...ids, ...metaIds(row.meta)];
  // The ids that may hold a `file` beside them: the row's, its fields' and meta's in full, and those it is inside.
  const holders = [...fullIds, ...metaIds(row), ...under];
  const inside = ids.length === 0 ? under : [...under, ...ids];
  const out: Plain = {};
  for (const [key, value] of Object.entries(row)) {
    if (KEPT.has(key)) {
      out[key] = compactValue(value, depth + 1, inside, pass);
      continue;
    }
    const blankable = depth > 0;
    if (blankable && isBlank(value)) continue;
    if (leftSays && SAID_BY_LEFT.has(key)) continue;
    // How a tree's row was reached: never a part of an id, whatever its type's name.
    if (key === 'edge' && depth > 0) {
      out[key] = compactValue(value, depth + 1, inside, pass);
      continue;
    }
    // A field naming the row it is inside (`meta.selects[].consumer` on that consumer's row), or the answer's target.
    if (typeof value === 'string' && under.includes(value)) continue;
    // A file an id beside it says already (`file` beside a failure's `at`, or beside the target that `at` was).
    if (key === 'file' && typeof value === 'string' && holders.some((id) => holdsFile(id, value))) continue;
    if (ids.length > 0 && typeof value === 'string' && IDENTITY.has(key)) {
      if (key === 'loc') {
        // A screen's `loc` is a line of its routing table; `by` names the component it shows, the file to read (P379).
        if (typeof row.by === 'string' && ids.some((id) => kindOfId(id) === 'screen')) continue;
        // A way in's file is said by the code handling it, where that is written in the same file (P374).
        const left = locBesideAll(typeof row.by === 'string' ? [...ids, row.by] : ids, value);
        if (left !== undefined) Object.assign(out, left);
        continue;
      }
      if (saidByIds(key, value, ids)) continue;
    }
    if (typeof value === 'string' && !IDENTITY.has(key) && (isIdPart(ids, value) || (value.length >= 3 && fullIds.some((full) => full !== value && isIdTail(full, value))))) continue;
    let said: unknown = value;
    if (key === 'meta' && isPlain(value)) {
      said = metaBeside(value, row, ids);
      if (listRow) said = plainMeta(said as Plain, pass);
      if (treeRow) said = typesIn(said, pass);
      if (isBlank(said)) continue;
    } else if (key === 'next' && Array.isArray(value) && value.every((call) => typeof call === 'string')) {
      said = compactNext(value as string[], row.nextOffset);
    }
    const compacted = compactValue(said, depth + 1, inside, pass);
    if (blankable && isBlank(compacted)) continue;
    out[key] = compacted;
  }
  return out;
};

/** The id of the answer's `target`, which a field below may only name again. */
const targetIdOf = (answer: unknown): string[] =>
  isPlain(answer) && isPlain(answer.target) && typeof answer.target.id === 'string' ? [answer.target.id] : [];

/** The answer with every fact its ids already say left out (see above); anything else as it was. */
export const compactAnswer = <T>(answer: T): T => {
  const pass: Pass = { leftOut: new Set(), typesCut: false };
  const out = compactValue(answer, 0, targetIdOf(answer), pass);
  if (!isPlain(out)) return out as T;
  const notes = [
    ...(pass.leftOut.size === 0 ? [] : [listNote([...pass.leftOut])]),
    ...(pass.typesCut ? [TYPES_NOTE] : []),
  ];
  if (notes.length === 0) return out as T;
  const said = notes.join('; ');
  return { ...out, note: typeof out.note === 'string' ? `${out.note}; ${said}` : said } as T;
};

/**
 * An output schema as the server lists it (P365): no field is required,
 * since a compact answer leaves out what its ids say and any field with
 * nothing in it, and a row that may say `loc` may say `line` instead. The
 * fields and their types are the same, so a full answer fits it too.
 */
export const compactOutputSchema = <T>(schema: T): T => {
  const relax = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(relax);
    if (!isPlain(node)) return node;
    const out: Plain = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'required' && Array.isArray(value)) continue;
      out[key] = key === 'properties' && isPlain(value) ? relaxProperties(value) : relax(value);
    }
    return out;
  };
  const relaxProperties = (properties: Plain): Plain => {
    const out: Plain = {};
    for (const [name, value] of Object.entries(properties)) {
      out[name] = relax(value);
      if (name === 'loc' && !('line' in properties)) out.line = { type: 'integer' };
    }
    return out;
  };
  return relax(schema) as T;
};
