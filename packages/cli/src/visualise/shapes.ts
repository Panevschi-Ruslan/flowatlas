import {
  CLAIMED_META,
  FAILURES_META,
  formatTypeRef,
  parseTypeRef,
  REQUEST_PARTS,
  SIGNATURE_META,
  STATUS_UNKNOWN_META,
  type GraphEdge,
  type GraphNode,
  type Signature,
  type TypeEntry,
  type TypeRefAst,
} from '@flowatlas/core';

/**
 * What a node takes and gives back, packed for the page.
 *
 * The graph keeps types as references into a registry, written in a grammar
 * the page has no reason to parse. So the pack writes each reference once the
 * way a person reads it - `Page<Order> | null`, `{ id: string; qty?: number }` -
 * and says where in that text each named type sits, so the page can make the
 * name a link without knowing the grammar. Only the types the shown references
 * reach are shipped, through their fields, not the whole registry.
 */
export interface PackedShapes {
  /**
   * Every reference shown, as `[text, spans]`; `spans` is flat, three numbers
   * per named type in the text: start, end, and its position in `types` or -1
   * when the registry does not hold it.
   */
  refs: Array<[text: string, spans: number[]]>;
  /**
   * `[name, kind, declaredIn, fields, members, typeParams]`. `fields` is
   * `[name, ref, flag]` per field (flag 1 optional) or 0; `members` is the
   * values of an enum as words, the members of a union as refs, or 0.
   */
  types: unknown[][];
  /**
   * `[node, face, params, returns]` per node that has one: `face` is a
   * position in `FACES`, `params` three numbers per parameter - its label in
   * `labels`, its ref, and a flag (1 optional, 2 rest) - and `returns` a ref
   * or -1. Thousands of parameters share a few hundred names, hence `labels`.
   */
  faces: Array<[node: number, face: number, params: number[], returns: number]>;
  labels: string[];
  /** `FACES`, so the page reads a face by name. */
  faceNames: readonly string[];
  /**
   * `[node, kind, status, ref]` per answer a route gives besides its own (P32):
   * `kind` a position in `ANSWER_KINDS`, `status` the status it is sent with,
   * '' when the code works it out, and `ref` a position in `refs`.
   */
  answers: Array<[node: number, kind: number, status: string, ref: number]>;
  /** `ANSWER_KINDS`, so the page reads an answer's kind by name. */
  answerKinds: readonly string[];
}

/**
 * How a node meets what reaches it, as a key the page words.
 *
 *   method  a function, with its parameters by name
 *   route   a way in, by the parts of a request it reads
 *   call    a call out, by what it sends and what it expects back
 *   channel a channel, by what its producers put on it
 *   bare    a function whose parameters were recorded without names
 *   handler a way in that is not a request - an event, a command, a
 *           template binding - by what it hands the function that answers
 */
export const FACES = ['method', 'route', 'call', 'channel', 'bare', 'handler'] as const;
type Face = (typeof FACES)[number];

/**
 * The answers a route gives besides the one its face shows:
 *
 *   failure  sent with a literal status of 400 or more
 *   unknown  sent with a status the code works out, so success or failure
 */
export const ANSWER_KINDS = ['failure', 'unknown'] as const;
type AnswerKind = (typeof ANSWER_KINDS)[number];

interface Answer {
  kind: AnswerKind;
  status: string;
  ref: string;
}

/** What a `handles` edge says its route answers besides its response, failures by status first. */
export const answersOf = (edge: GraphEdge): Answer[] => {
  const failures = edge.meta?.[FAILURES_META];
  const unknown = edge.meta?.[STATUS_UNKNOWN_META];
  const listed: Answer[] =
    typeof failures === 'object' && failures !== null
      ? Object.entries(failures as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([status, ref]) => ({ kind: 'failure', status, ref }))
      : [];
  return typeof unknown === 'string' ? [...listed, { kind: 'unknown', status: '', ref: unknown }] : listed;
};

/** Edges out of a call whose types are what the call sends and expects back. */
const SENDING = new Set(['http_calls', 'hits', 'emits']);

/** Distinct payloads a channel shows, before the rest are left to its producers. */
const PAYLOADS = 4;

/** How a parameter is marked: optional, a rest, or a part of a request only a cast types (P29). */
const FLAG = { none: 0, optional: 1, rest: 2, claimed: 3 } as const;

/** The last part of a registry id: `type:orders#Cart@src/a.ts` is `Cart`. */
const nameOfId = (id: string): string => {
  const hash = id.lastIndexOf('#');
  const name = hash < 0 ? id : id.slice(hash + 1);
  const at = name.indexOf('@');
  return at < 0 ? name : name.slice(0, at);
};

const grouped = (ast: TypeRefAst): boolean => ast.kind === 'union' || ast.kind === 'intersection';

/**
 * A reference as a person writes it, with a span per named type.
 *
 * `idFor` turns a named type into what the span points at; the text is built
 * left to right, so a span's start is wherever the text has got to.
 */
const pretty = (
  ast: TypeRefAst,
  idFor: (ast: Extract<TypeRefAst, { kind: 'id' }>) => number,
): [string, number[]] => {
  let text = '';
  const spans: number[] = [];
  const write = (part: string): void => {
    text += part;
  };
  const list = (items: readonly TypeRefAst[], gap: string): void => {
    items.forEach((item, index) => {
      if (index > 0) write(gap);
      walk(item);
    });
  };
  const walk = (node: TypeRefAst): void => {
    switch (node.kind) {
      case 'primitive':
        write(node.name);
        return;
      case 'literal':
        write(typeof node.value === 'string' ? `'${node.value}'` : String(node.value));
        return;
      case 'id': {
        const start = text.length;
        write(nameOfId(node.id));
        spans.push(start, text.length, idFor(node));
        if (node.args !== undefined && node.args.length > 0) {
          write('<');
          list(node.args, ', ');
          write('>');
        }
        return;
      }
      case 'array':
        if (grouped(node.element)) write('(');
        walk(node.element);
        if (grouped(node.element)) write(')');
        write('[]');
        return;
      case 'union':
        list(node.members, ' | ');
        return;
      case 'intersection':
        list(node.members, ' & ');
        return;
      case 'tuple':
        write('[');
        list(node.elements, ', ');
        write(']');
        return;
      case 'generic':
        write(node.name + '<');
        list(node.args, ', ');
        write('>');
        return;
      case 'object':
        if (node.fields.length === 0) {
          write('{}');
          return;
        }
        write('{ ');
        node.fields.forEach((field, index) => {
          if (index > 0) write('; ');
          write(field.name + (field.optional ? '?' : '') + ': ');
          walk(field.type);
        });
        write(' }');
    }
  };
  walk(ast);
  return [text, spans];
};

const parsed = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/**
 * Where the registry keeps a named type: an instantiation under its reference
 * as written, and failing that its template under the bare id.
 */
const keysOf = (ast: Extract<TypeRefAst, { kind: 'id' }>): string[] =>
  ast.args === undefined || ast.args.length === 0 ? [ast.id] : [formatTypeRef(ast), ast.id];

interface Param {
  label: string;
  ref: string;
  flag: number;
}

interface FaceOf {
  face: Face;
  params: Param[];
  returns: string | undefined;
}

const isSignature = (value: unknown): value is Signature =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Signature).params) &&
  typeof (value as Signature).returns === 'string';

/** The parts of a route only a cast in its handler types (P29). */
const claimedParts = (edge: GraphEdge): readonly string[] => {
  const claimed = edge.meta?.[CLAIMED_META];
  return Array.isArray(claimed) ? (claimed as string[]) : [];
};

/**
 * The face of every node that has one, from the graph alone.
 *
 * A function says it on its own node; a route by the request parts its handler
 * reads, on the edge to it; any other way in by what its handler takes; a call
 * and a channel by the types on the edges they send along. A function without a recorded signature whose callers
 * still carry types is shown with those, unnamed.
 */
const facesOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, FaceOf> => {
  const out = new Map<string, FaceOf>();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    const signature = node.meta?.[SIGNATURE_META];
    if (!isSignature(signature)) continue;
    out.set(node.id, {
      face: 'method',
      params: signature.params.map((param) => ({
        label: param.name,
        ref: param.type,
        flag: param.rest === true ? FLAG.rest : param.optional === true ? FLAG.optional : FLAG.none,
      })),
      returns: signature.returns,
    });
  }

  const payloads = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'handles') {
      const entry = byId.get(edge.from);
      if (entry === undefined || out.has(edge.from)) continue;
      const parts = REQUEST_PARTS.filter((part) => typeof edge.meta?.[part] === 'string');
      if (parts.length === 0 && entry.kind !== 'http') {
        // Not a request: what it hands over is what its handler takes.
        const handler = out.get(edge.to);
        if (handler?.face === 'method') out.set(edge.from, { ...handler, face: 'handler' });
        continue;
      }
      out.set(edge.from, {
        face: 'route',
        params: parts.map((part) => ({
          label: part,
          ref: edge.meta?.[part] as string,
          flag: claimedParts(edge).includes(part) ? FLAG.claimed : FLAG.none,
        })),
        returns: edge.returns,
      });
    }
    if (SENDING.has(edge.type) && (edge.params !== undefined || edge.returns !== undefined)) {
      if (!out.has(edge.from)) {
        const [sent] = edge.params ?? [];
        out.set(edge.from, {
          face: 'call',
          params: sent === undefined ? [] : [{ label: edge.type === 'emits' ? 'payload' : 'body', ref: sent, flag: FLAG.none }],
          returns: edge.returns,
        });
      }
      const [payload] = edge.params ?? [];
      if (edge.type === 'emits' && payload !== undefined) {
        const list = payloads.get(edge.to) ?? [];
        if (!list.includes(payload)) list.push(payload);
        payloads.set(edge.to, list);
      }
    }
  }
  for (const [channel, list] of payloads) {
    if (out.has(channel)) continue;
    out.set(channel, {
      face: 'channel',
      params: list.sort().slice(0, PAYLOADS).map((ref) => ({ label: 'payload', ref, flag: FLAG.none })),
      returns: undefined,
    });
  }

  // Last, so a name recorded anywhere wins over a bare list of types.
  for (const edge of edges) {
    if ((edge.type !== 'calls' && edge.type !== 'handles') || edge.params === undefined) continue;
    if (out.has(edge.to)) continue;
    out.set(edge.to, {
      face: 'bare',
      params: edge.params.map((ref) => ({ label: '', ref, flag: FLAG.none })),
      returns: edge.returns,
    });
  }
  return out;
};

export interface ShapesInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Node position by id, as the pack numbers them. */
  position: ReadonlyMap<string, number>;
  /** The registry, one entry at a time. */
  typeOf: (id: string) => TypeEntry | undefined;
}

export const packShapes = (input: ShapesInput): PackedShapes => {
  const faces = facesOf(input.nodes, input.edges);
  const refs: PackedShapes['refs'] = [];
  const refIx = new Map<string, number>();
  const types: unknown[][] = [];
  const typeIx = new Map<string, number>();
  const pending: Array<[number, TypeEntry]> = [];
  /** The position of a named type in `types`, registering it on first sight. */
  const typeAt = (ast: Extract<TypeRefAst, { kind: 'id' }>): number => {
    for (const key of keysOf(ast)) {
      const known = typeIx.get(key);
      if (known !== undefined) return known;
      const entry = input.typeOf(key);
      if (entry === undefined) continue;
      const at = types.length;
      typeIx.set(key, at);
      types.push([]);
      pending.push([at, entry]);
      return at;
    }
    return -1;
  };

  const refAt = (ref: string): number => {
    const known = refIx.get(ref);
    if (known !== undefined) return known;
    const ast = parsed(ref);
    const at = refs.length;
    refIx.set(ref, at);
    refs.push(ast === undefined ? [ref, []] : pretty(ast, typeAt));
    return at;
  };

  const labels: string[] = [];
  const labelIx = new Map<string, number>();
  const labelAt = (label: string): number => {
    let at = labelIx.get(label);
    if (at === undefined) {
      at = labels.length;
      labels.push(label);
      labelIx.set(label, at);
    }
    return at;
  };

  const packedFaces: PackedShapes['faces'] = [];
  for (const [id, face] of faces) {
    const node = input.position.get(id);
    if (node === undefined) continue;
    packedFaces.push([
      node,
      FACES.indexOf(face.face),
      face.params.flatMap((param) => [labelAt(param.label), refAt(param.ref), param.flag]),
      face.returns === undefined ? -1 : refAt(face.returns),
    ]);
  }
  packedFaces.sort((a, b) => a[0] - b[0]);

  const answers: PackedShapes['answers'] = [];
  for (const edge of input.edges) {
    if (edge.type !== 'handles') continue;
    const node = input.position.get(edge.from);
    if (node === undefined) continue;
    for (const answer of answersOf(edge)) {
      answers.push([node, ANSWER_KINDS.indexOf(answer.kind), answer.status, refAt(answer.ref)]);
    }
  }
  answers.sort((a, b) => a[0] - b[0]);

  // Fields reach further types, which reach further still: a queue, so the
  // registry is walked once however deep it goes.
  while (pending.length > 0) {
    const [at, entry] = pending.shift() as [number, TypeEntry];
    const fields = entry.fields?.map((field) => [field.name, refAt(field.type), field.optional ? 1 : 0]);
    const members =
      entry.members === undefined
        ? 0
        : entry.kind === 'union'
          ? entry.members.map(refAt)
          : entry.members;
    types[at] = [
      entry.name,
      entry.kind,
      entry.declaredIn,
      fields === undefined || fields.length === 0 ? 0 : fields,
      members,
      entry.typeParams === undefined || entry.typeParams.length === 0 ? 0 : entry.typeParams,
    ];
  }

  return { refs, types, faces: packedFaces, labels, faceNames: FACES, answers, answerKinds: ANSWER_KINDS };
};

/** Exposed for the tests: a reference as the page shows it. */
export const prettyRef = (ref: string): string => {
  const ast = parsed(ref);
  return ast === undefined ? ref : pretty(ast, () => -1)[0];
};
