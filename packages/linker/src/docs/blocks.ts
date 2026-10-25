/**
 * Blocks of a Markdown file that name a flow, a channel or a symbol by its
 * graph id (P120), read without touching anything else in the file.
 *
 * A block is two HTML comments - invisible wherever Markdown is rendered, and
 * they survive a copy and paste (D3) - with the generated content between
 * them:
 *
 *     <!-- flowatlas:flow id="POST /orders" view="sequence" depth="6" -->
 *     …generated…
 *     <!-- /flowatlas:flow fingerprint="f3a9c1d0"
 *     ["enters","caller","orders","POST /orders"]
 *     -->
 *
 * The closing marker carries the fingerprint of what the content showed and,
 * one per line, the steps that fingerprint covered, so a later check can say
 * which steps were added or removed rather than only that something moved. A
 * `ref` is one comment and holds no content: it says the prose after it
 * mentions a node, which is checked to exist.
 *
 * Markers inside a fenced code block or a code span are text about markers,
 * not markers: a page that documents the syntax is not a page that uses it.
 * Everything here is pure; reading files and the graph is the caller's.
 */
import type { Confidence } from '@flowatlas/core';
import type { SequenceStep } from '../diff/sequence.js';

/** What a block names. `ref` is a mention in prose, with nothing generated. */
export const DOC_KINDS = ['flow', 'channel', 'symbol', 'ref'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** How a block's content is drawn. */
export const DOC_VIEWS = ['steps', 'mermaid', 'sequence', 'prompt', 'contract', 'tour'] as const;
export type DocView = (typeof DOC_VIEWS)[number];

/**
 * What a check says about a block: its content still says what the graph
 * says (`ok`), the flow under it moved (`changed`), its id names nothing
 * (`gone`) or more than one thing (`ambiguous`) - never a guess (I3).
 */
export const DOC_STATES = ['ok', 'changed', 'gone', 'ambiguous'] as const;
export type DocState = (typeof DOC_STATES)[number];

/** The view a block is drawn in when it names none. */
export const DEFAULT_DOC_VIEW: DocView = 'steps';

/** The options a block may set, as its attributes spell them. */
export interface DocOptions {
  depth?: number;
  maxNodes?: number;
  detail?: 0 | 1 | 2;
  service?: string;
}

/** A step the closing marker recorded: what `diffSequences` compares, without where it is written. */
export type RecordedStep = Pick<SequenceStep, 'kind' | 'from' | 'to' | 'label' | 'confidence' | 'params' | 'returns' | 'takes'>;

export interface DocBlock {
  kind: DocKind;
  /** The id as written: anything P94's resolver takes (an entry said aloud, a node id, a channel name). */
  id: string;
  /** Absent on a `ref`. */
  view?: DocView;
  options: DocOptions;
  /** 1-based line of the opening marker (the whole marker, for a `ref`). */
  line: number;
  /** 1-based line of the closing marker. Absent on a `ref`. */
  endLine?: number;
  /** Offset of `<!--` of the opening marker, and just past its `-->`. */
  start: number;
  openEnd: number;
  /** Offset of `<!--` of the closing marker, and just past its `-->`. Equal to `openEnd` on a `ref`. */
  closeStart: number;
  end: number;
  /** What lies between the two markers, as written. */
  content: string;
  /** Absent on a block written by hand, which is `changed` until written once. */
  fingerprint?: string;
  /** The steps the fingerprint covered; absent when the marker holds none or they could not be read. */
  recorded?: RecordedStep[];
}

/** A marker that could not be read, and why; the block it belongs to is skipped. */
export interface DocProblem {
  line: number;
  message: string;
}

export interface ParsedDocs {
  blocks: DocBlock[];
  problems: DocProblem[];
}

const OPEN_ATTRIBUTES: Readonly<Record<string, true>> = { id: true, view: true, depth: true, 'max-nodes': true, detail: true, service: true };

/** Every flowatlas comment, opening or closing; the body runs to the first `-->`. */
const MARKER = /<!--\s*(\/?)flowatlas:([A-Za-z-]*)([\s\S]*?)-->/g;

const ATTRIBUTE = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g;

const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** `"` and `&` as entities, so an id can always be written back inside an attribute. */
export const encodeAttribute = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Offset → 1-based line, by the line starts of the text. */
const lineIndex = (text: string): ((offset: number) => number) => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
};

/** The lines inside fenced code blocks (``` or ~~~, closed by a fence of the same character at least as long). */
const fencedLines = (text: string): Set<number> => {
  const fenced = new Set<number>();
  let fence: { char: string; length: number } | undefined;
  text.split('\n').forEach((row, index) => {
    const line = index + 1;
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(row);
    if (fence === undefined) {
      if (opener !== null) {
        fence = { char: (opener[1] as string)[0] as string, length: (opener[1] as string).length };
        fenced.add(line);
      }
      return;
    }
    fenced.add(line);
    if (opener !== null && (opener[1] as string)[0] === fence.char && (opener[1] as string).length >= fence.length && /^\s*$/.test(row.slice(opener[0].length))) {
      fence = undefined;
    }
  });
  return fenced;
};

/** Whether an offset sits inside a code span of its line: an odd number of backticks before it. */
const inCodeSpan = (text: string, offset: number): boolean => {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  return ((before.match(/`/g) ?? []).length & 1) === 1;
};

/** The attributes of a marker's body, and what of the body is not an attribute. */
const attributesOf = (body: string): { values: Map<string, string>; rest: string; repeated: string[] } => {
  const values = new Map<string, string>();
  const repeated: string[] = [];
  const rest = body.replace(ATTRIBUTE, (_whole, name: string, value: string) => {
    if (values.has(name)) repeated.push(name);
    values.set(name, decode(value));
    return '';
  });
  return { values, rest, repeated };
};

const whole = (value: string | undefined, least: number, most: number): number | undefined | null => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= least && parsed <= most ? parsed : null;
};

/** One line of the closing marker as a step, or nothing when it is not one. */
export const readRecordedStep = (line: string): RecordedStep | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length < 4 || value.slice(0, 4).some((item) => typeof item !== 'string')) return undefined;
  const [kind, from, to, label, confidence, params, returns, takes] = value as [string, string, string, string, unknown, unknown, unknown, unknown];
  const strings = (item: unknown): string[] | undefined =>
    Array.isArray(item) && item.length > 0 && item.every((one) => typeof one === 'string') ? (item as string[]) : undefined;
  return {
    kind: kind as RecordedStep['kind'],
    from,
    to,
    label,
    confidence: (typeof confidence === 'string' && confidence !== '' ? confidence : 'static') as Confidence,
    ...(strings(params) === undefined ? {} : { params: strings(params) as string[] }),
    ...(typeof returns === 'string' && returns !== '' ? { returns } : {}),
    ...(strings(takes) === undefined ? {} : { takes: strings(takes) as string[] }),
  };
};

/**
 * A step as one line of the closing marker: a JSON array, with `<` and `>`
 * escaped so no label can end the comment early. Trailing fields at their
 * default are left off.
 */
export const recordStep = (step: RecordedStep): string => {
  const fields: unknown[] = [
    step.kind,
    step.from,
    step.to,
    step.label,
    step.confidence === 'static' ? '' : step.confidence,
    step.params ?? [],
    step.returns ?? '',
    step.takes ?? [],
  ];
  while (fields.length > 4) {
    const last = fields[fields.length - 1];
    if (last === '' || (Array.isArray(last) && last.length === 0)) fields.pop();
    else break;
  }
  return JSON.stringify(fields).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
};

/** The closing marker of a block of `kind`, with its fingerprint and the steps it covered. */
export const closingMarker = (kind: Exclude<DocKind, 'ref'>, fingerprint: string, steps: readonly RecordedStep[]): string =>
  steps.length === 0
    ? `<!-- /flowatlas:${kind} fingerprint="${fingerprint}" -->`
    : `<!-- /flowatlas:${kind} fingerprint="${fingerprint}"\n${steps.map(recordStep).join('\n')}\n-->`;

interface Opened {
  kind: Exclude<DocKind, 'ref'>;
  id: string;
  view: DocView;
  options: DocOptions;
  line: number;
  start: number;
  openEnd: number;
}

/**
 * Every block and every reference of a Markdown file, in file order, and the
 * markers that could not be read.
 *
 * A block opened inside another, closed by the wrong kind, or never closed is
 * a problem and is skipped, as is a marker with an unknown kind, attribute or
 * value: a typo in a marker must never quietly generate the wrong thing (I3).
 * Nothing between markers is read beyond the closing marker's steps.
 */
export const parseDocs = (markdown: string): ParsedDocs => {
  const lineOf = lineIndex(markdown);
  const fenced = fencedLines(markdown);
  const blocks: DocBlock[] = [];
  const problems: DocProblem[] = [];
  let open: Opened | undefined;

  for (const match of markdown.matchAll(MARKER)) {
    const start = match.index;
    const end = start + match[0].length;
    const line = lineOf(start);
    if (fenced.has(line) || inCodeSpan(markdown, start)) continue;
    const closing = match[1] === '/';
    const kind = match[2] as string;
    const { values, rest, repeated } = attributesOf(match[3] as string);
    const problem = (message: string, at = line): void => void problems.push({ line: at, message });

    if (!(DOC_KINDS as readonly string[]).includes(kind)) {
      problem(`unknown block kind ${JSON.stringify(kind)}; one of ${DOC_KINDS.join(', ')}`);
      continue;
    }

    if (closing) {
      if (kind === 'ref') {
        problem('a ref has no closing marker');
        continue;
      }
      if (open === undefined) {
        problem(`a closing ${kind} marker with no block open`);
        continue;
      }
      const opened = open;
      open = undefined;
      if (opened.kind !== kind) {
        problem(`the ${opened.kind} block opened at line ${opened.line} is closed by a ${kind} marker`, opened.line);
        continue;
      }
      const fingerprint = values.get('fingerprint');
      const unknown = [...values.keys()].filter((name) => name !== 'fingerprint');
      if (unknown.length > 0) {
        problem(`unknown attribute ${unknown.map((name) => JSON.stringify(name)).join(', ')} on a closing marker`, opened.line);
        continue;
      }
      const lines = rest
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const recorded = lines.map(readRecordedStep);
      blocks.push({
        kind: opened.kind,
        id: opened.id,
        view: opened.view,
        options: opened.options,
        line: opened.line,
        endLine: line,
        start: opened.start,
        openEnd: opened.openEnd,
        closeStart: start,
        end,
        content: markdown.slice(opened.openEnd, start),
        ...(fingerprint === undefined || fingerprint === '' ? {} : { fingerprint }),
        // Steps that cannot all be read are none: a partial list would name
        // changes that are not there.
        ...(lines.length > 0 && recorded.every((step) => step !== undefined) ? { recorded: recorded as RecordedStep[] } : {}),
      });
      continue;
    }

    if (open !== undefined && kind !== 'ref') {
      problem(`the ${open.kind} block opened at line ${open.line} is not closed before the block at line ${line} opens`, open.line);
      open = undefined;
    }
    // A mention inside generated content is the content's, and is rewritten with it.
    if (open !== undefined) continue;

    const unknown = [...values.keys()].filter((name) => OPEN_ATTRIBUTES[name] !== true || (kind === 'ref' && name !== 'id'));
    if (unknown.length > 0) {
      problem(`unknown attribute ${unknown.map((name) => JSON.stringify(name)).join(', ')} on a ${kind} marker`);
      continue;
    }
    if (repeated.length > 0) {
      problem(`attribute ${repeated.map((name) => JSON.stringify(name)).join(', ')} written twice`);
      continue;
    }
    const id = values.get('id')?.trim() ?? '';
    if (id === '') {
      problem(`a ${kind} marker without an id`);
      continue;
    }
    if (kind === 'ref') {
      blocks.push({ kind, id, options: {}, line, start, openEnd: end, closeStart: end, end, content: '' });
      continue;
    }
    if (markdown.slice(markdown.lastIndexOf('\n', start - 1) + 1, start).trim() !== '') {
      problem(`a ${kind} block's opening marker must start its line`);
      continue;
    }
    const view = values.get('view') ?? DEFAULT_DOC_VIEW;
    if (!(DOC_VIEWS as readonly string[]).includes(view)) {
      problem(`unknown view ${JSON.stringify(view)}; one of ${DOC_VIEWS.join(', ')}`);
      continue;
    }
    const depth = whole(values.get('depth'), 1, 32);
    const maxNodes = whole(values.get('max-nodes'), 1, 2000);
    const detail = whole(values.get('detail'), 0, 2);
    const bad = [
      ...(depth === null ? ['depth must be a whole number from 1 to 32'] : []),
      ...(maxNodes === null ? ['max-nodes must be a whole number from 1 to 2000'] : []),
      ...(detail === null ? ['detail must be 0, 1 or 2 (a block never quotes code)'] : []),
    ];
    if (bad.length > 0) {
      problem(bad.join('; '));
      continue;
    }
    const service = values.get('service')?.trim();
    open = {
      kind: kind as Opened['kind'],
      id,
      view: view as DocView,
      options: {
        ...(depth === undefined || depth === null ? {} : { depth }),
        ...(maxNodes === undefined || maxNodes === null ? {} : { maxNodes }),
        ...(detail === undefined || detail === null ? {} : { detail: detail as 0 | 1 | 2 }),
        ...(service === undefined || service === '' ? {} : { service }),
      },
      line,
      start,
      openEnd: end,
    };
  }

  if (open !== undefined) problems.push({ line: open.line, message: `the ${open.kind} block opened here is never closed` });
  return { blocks, problems };
};

/** The blocks and references of a Markdown file, without the problems. */
export const parseDocBlocks = (markdown: string): DocBlock[] => parseDocs(markdown).blocks;

/** What a block regenerates to: the content and the closing marker's fingerprint and steps. */
export interface DocRewrite {
  content: string;
  fingerprint: string;
  steps: readonly RecordedStep[];
}

/**
 * The file with each block's content and closing marker replaced (D1).
 *
 * Only what lies after an opening marker up to the end of its closing marker
 * is written; the opening marker and every byte outside a block stay as they
 * were. The content always starts on the line after the opening marker and
 * ends with a newline, so the closing marker starts its own line.
 */
export const rewriteDocBlocks = (markdown: string, rewrites: ReadonlyMap<DocBlock, DocRewrite>): string => {
  const ordered = [...rewrites.entries()].filter(([block]) => block.kind !== 'ref').sort(([a], [b]) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const [block, rewrite] of ordered) {
    out += markdown.slice(at, block.openEnd) + blockRegion(markdown, block, rewrite);
    at = block.end;
  }
  return out + markdown.slice(at);
};

/**
 * What replaces a block's region - everything after its opening marker up to
 * the end of its closing marker. A file written with CRLF keeps it inside the
 * block too. Equal to `markdown.slice(block.openEnd, block.end)` exactly when
 * the block already says what the rewrite says.
 */
export const blockRegion = (markdown: string, block: DocBlock, rewrite: DocRewrite): string => {
  const body = rewrite.content.endsWith('\n') || rewrite.content === '' ? rewrite.content : `${rewrite.content}\n`;
  const region = `\n${body}${closingMarker(block.kind as Exclude<DocKind, 'ref'>, rewrite.fingerprint, rewrite.steps)}`;
  return markdown.includes('\r\n') ? region.replace(/\r?\n/g, '\r\n') : region;
};
