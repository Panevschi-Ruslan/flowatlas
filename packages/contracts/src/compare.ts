/**
 * Two shapes, field by field, with the wire between them.
 *
 * Everything downstream — the command, `doctor`, `diff`, the answer an agent
 * gets — is a rendering of what this file decides, so it is deliberately the
 * only place that knows what "the same" means. Three things make that harder
 * than comparing two strings: JSON is not TypeScript (which is the wire rules'
 * job), a shape can contain itself (the depth cap and the cycle guard), and a
 * type is a reference rather than a structure (the registry).
 */
import {
  DEFAULT_HASH_DEPTH,
  formatTypeRef,
  parseTypeRef,
  type TypeEntry,
  type TypeField,
  type TypeRefAst,
  type TypeRegistry,
} from '@flowatlas/core';
import { describeDiff } from './message.js';
import { DEFAULT_DEPTH, type FieldDiff, type Side } from './types.js';
import { applyWireRules, type FieldView } from './wire/index.js';

export interface CompareOptions {
  /** How far to walk into nested shapes before settling for a hash. Default 3. */
  depth?: number;
  /** Wire rules to switch off, by id. */
  disableRules?: readonly string[];
}

export interface CompareResult {
  diffs: FieldDiff[];
  /** Rules that changed what was compared, with the path they changed it at. */
  rulesApplied: string[];
}

/** What the comparison carries with it, so no function needs six parameters. */
interface Walk {
  resolve: (id: string) => TypeEntry | undefined;
  disable: readonly string[];
  diffs: FieldDiff[];
  rules: Set<string>;
  /** Pairs of types already being compared further up this path. */
  open: Set<string>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const joinPath = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`);

/** `depth-cap` at the top of a type has no path to name, so it names the root. */
const at = (prefix: string, path: string): string => `${prefix}:${path === '' ? '.' : path}`;

const record = (walk: Walk, diff: Omit<FieldDiff, 'message'>): void => {
  walk.diffs.push({ ...diff, message: describeDiff({ ...diff, message: '' }) });
};

/**
 * An enum member as a union would have written it.
 *
 * The registry stores an enum's values bare (`paid`) and a literal union stores
 * them quoted (`'paid'`), which is the only reason an enum and the union that
 * spells it out do not compare equal on sight.
 */
const enumMember = (member: string): string =>
  /^-?\d+(\.\d+)?$/.test(member) || member === 'true' || member === 'false'
    ? member
    : `'${member}'`;

/** The members of a union or an enum, written the one way. */
const membersOf = (entry: TypeEntry): string[] | undefined => {
  if (entry.kind === 'enum') return (entry.members ?? []).map(enumMember);
  if (entry.kind === 'union') return [...(entry.members ?? [])];
  return undefined;
};

/**
 * A type that makes no claim about what is in it.
 *
 * Comparing one of these against anything is comparing a shape with a shrug.
 * Whatever comes out of it, nobody wrote down that it would, so calling the
 * other side wrong would be inventing a claim neither made (I3).
 */
const NO_CLAIM = new Set(['any', 'unknown', 'object', 'never', 'Object', 'Function']);

const makesNoClaim = (ast: TypeRefAst): boolean =>
  (ast.kind === 'primitive' && NO_CLAIM.has(ast.name)) ||
  // `{}` is every value that is not null, which is not a claim about a shape.
  (ast.kind === 'object' && ast.fields.length === 0);

/** The primitive a literal belongs to, which is what may stand in for it. */
const literalBase = (ast: TypeRefAst): string | undefined =>
  ast.kind === 'literal' ? typeof ast.value : undefined;

/**
 * A union with the values its own members already cover taken out.
 *
 * `true | false` is `boolean` spelled out, and `string | 'paid'` is `string`.
 * One repository writes the union and the other writes the primitive, and they
 * mean the same thing; without this every one of those reads as drift.
 */
const widened = (members: readonly TypeRefAst[]): TypeRefAst[] => {
  const names = new Set(
    members.filter((member) => member.kind === 'primitive').map((member) => member.name),
  );
  const booleans = members.filter((member) => typeof member.kind === 'string' && literalBase(member) === 'boolean');
  const both = booleans.length === 2;
  if (both) names.add('boolean');

  const kept = members.filter((member) => {
    const base = literalBase(member);
    return base === undefined || !names.has(base);
  });
  return both && !members.some((member) => member.kind === 'primitive' && member.name === 'boolean')
    ? [...kept, { kind: 'primitive', name: 'boolean' } as TypeRefAst]
    : kept;
};

/**
 * The same reference written the one way.
 *
 * A union is flattened, deduplicated, widened and sorted, so `string | string`
 * is `string` and `a | b` is `b | a`. The wire rules produce both of those by
 * substitution — `Date | string` becomes `string | string` — and without this
 * every such field would be reported as differing from itself.
 */
const normalise = (ast: TypeRefAst): TypeRefAst => {
  switch (ast.kind) {
    case 'array':
      return { kind: 'array', element: normalise(ast.element) };
    case 'tuple':
      return { kind: 'tuple', elements: ast.elements.map(normalise) };
    case 'generic':
      return { kind: 'generic', name: ast.name, args: ast.args.map(normalise) };
    case 'object':
      return {
        kind: 'object',
        fields: [...ast.fields]
          .map((field) => ({ ...field, type: normalise(field.type) }))
          .sort((a, b) => cmp(a.name, b.name)),
      };
    case 'id':
      return ast.args === undefined ? ast : { kind: 'id', id: ast.id, args: ast.args.map(normalise) };
    case 'union':
    case 'intersection': {
      const flat: TypeRefAst[] = [];
      const seen = new Set<string>();
      const add = (member: TypeRefAst): void => {
        const value = normalise(member);
        if (value.kind === ast.kind) {
          for (const inner of value.members) add(inner);
          return;
        }
        const key = formatTypeRef(value);
        if (seen.has(key)) return;
        seen.add(key);
        flat.push(value);
      };
      for (const member of ast.members) add(member);
      const members = ast.kind === 'union' ? widened(flat) : flat;
      members.sort((a, b) => cmp(formatTypeRef(a), formatTypeRef(b)));
      return members.length === 1
        ? (members[0] as TypeRefAst)
        : { kind: ast.kind, members };
    }
    default:
      return ast;
  }
};

/** The registry entry a reference names, when it names one. */
const entryOfRef = (walk: Walk, ast: TypeRefAst): TypeEntry | undefined =>
  ast.kind === 'id' ? walk.resolve(ast.id) : undefined;

/**
 * Everything a reference may turn out to be, when it is a set of alternatives.
 *
 * A union spells them out, an enum and a named union hold them in the registry,
 * and a single value is a set of one. Undefined for anything that is not a
 * choice at all, which is how the caller tells a set apart from a shape.
 */
const alternativesOf = (walk: Walk, ast: TypeRefAst): TypeRefAst[] | undefined => {
  if (ast.kind === 'union') return ast.members;
  const entry = entryOfRef(walk, ast);
  const members = entry === undefined ? undefined : membersOf(entry);
  return members?.map((member) => {
    try {
      return normalise(parseTypeRef(member));
    } catch {
      return { kind: 'primitive', name: member } as TypeRefAst;
    }
  });
};

/** Fields of an entry, of a shape written out in place, or of an intersection. */
const fieldsOfRef = (walk: Walk, ast: TypeRefAst): TypeField[] | undefined => {
  if (ast.kind === 'object') {
    return ast.fields.map((field) => ({
      name: field.name,
      type: formatTypeRef(field.type),
      optional: field.optional,
    }));
  }
  if (ast.kind === 'intersection') {
    // Everything every part contributes. A name declared twice keeps the first,
    // which is what a reader sees when they open the declaration.
    const found: TypeField[] = [];
    const seen = new Set<string>();
    for (const member of ast.members) {
      const fields = fieldsOfRef(walk, member);
      if (fields === undefined) return undefined;
      for (const field of fields) {
        if (seen.has(field.name)) continue;
        seen.add(field.name);
        found.push(field);
      }
    }
    return found;
  }
  if (ast.kind !== 'id') return undefined;
  const entry = walk.resolve(ast.id);
  if (entry === undefined) return undefined;
  return entry.kind === 'object' || entry.kind === 'generic' ? entry.fields : undefined;
};

/**
 * A declaration nothing can be learned from.
 *
 * Two of them. A few entries resolve to nothing but themselves, where an alias
 * could not be read through and was recorded as a union of one member: its own
 * name. And a set of values with no values recorded says nothing about what it
 * allows — a graph written before the store kept them looks exactly like that,
 * and agreeing with everything would be worse than saying so (I3).
 */
const saysNothing = (ast: TypeRefAst, entry: TypeEntry | undefined): boolean => {
  if (entry === undefined) return false;
  if (entry.kind === 'enum' || entry.kind === 'union') {
    const members = entry.members ?? [];
    if (members.length === 0) return true;
    if (ast.kind === 'id' && members.every((member) => member === ast.id)) return true;
  }
  return false;
};

/** The name a reader knows a type by, for a message about the whole of it. */
const nameOf = (ast: TypeRefAst, entry: TypeEntry | undefined): string =>
  entry?.name ?? formatTypeRef(ast);

/** True when the reference, or what it is an array of, has fields. */
const isShapeRef = (walk: Walk, ast: TypeRefAst, side: Side): boolean => {
  const inner = ast.kind === 'array' ? ast.element : ast;
  return fieldsOfRef(walk, soleShape(normalise(inner), side)) !== undefined;
};

/** `null` and its spelling as a literal, which is not a shape either. */
const isNothing = (ast: TypeRefAst): boolean =>
  (ast.kind === 'primitive' && (ast.name === 'null' || ast.name === 'undefined')) ||
  (ast.kind === 'literal' && ast.value === null);

/**
 * A union with the parts that are not a shape removed, when one shape is left.
 *
 * `object | OrderDto` is a shape somebody widened rather than a real choice, and
 * comparing the shape says far more than reporting the whole union as wrong.
 *
 * A receiver that also accepts nothing at all — `OrderDto | null` — is only
 * being tolerant, so its `null` goes too. The sender's does not: a sender that
 * may send nothing where a shape is required is exactly the bug worth finding.
 */
const soleShape = (ast: TypeRefAst, side: Side): TypeRefAst => {
  if (ast.kind !== 'union') return ast;
  const real = ast.members.filter(
    (member) => !makesNoClaim(member) && !(side === 'receiver' && isNothing(member)),
  );
  return real.length === 1 ? (real[0] as TypeRefAst) : ast;
};

/**
 * How many times a choice may be unwrapped before compatibility gives up.
 *
 * A union of unions of enums is already unusual; four levels of it has never
 * been seen, and an unbounded walk here would be a way to hang on a type that
 * names itself.
 */
const ALTERNATIVE_DEPTH = 4;

/**
 * Whether what the sender may send is something the receiver can read.
 *
 * Compatibility runs one way. A receiver that declares `string` reads an enum
 * of strings without complaint, and one that declares `boolean` reads `true`;
 * a receiver that declares `'paid'` does not read any string at all. Comparing
 * the two declarations for equality instead would report every widening as
 * drift, which on a real project is most of what it would report.
 */
const acceptable = (walk: Walk, want: TypeRefAst, sent: TypeRefAst, depth: number): boolean => {
  if (formatTypeRef(want) === formatTypeRef(sent)) return true;
  if (makesNoClaim(want) || makesNoClaim(sent)) return true;
  if (depth <= 0) return false;

  const sentAlternatives = alternativesOf(walk, sent);
  if (sentAlternatives !== undefined) {
    return sentAlternatives.every((alternative) => acceptable(walk, want, alternative, depth - 1));
  }
  const wantAlternatives = alternativesOf(walk, want);
  if (wantAlternatives !== undefined) {
    return wantAlternatives.some((alternative) => acceptable(walk, alternative, sent, depth - 1));
  }

  if (want.kind === 'primitive' && literalBase(sent) === want.name) return true;
  if (want.kind === 'array' && sent.kind === 'array') {
    return acceptable(walk, want.element, sent.element, depth - 1);
  }

  const wantEntry = entryOfRef(walk, want);
  const sentEntry = entryOfRef(walk, sent);
  if (isOpaqueEntry(wantEntry) || isOpaqueEntry(sentEntry)) return true;
  if (wantEntry !== undefined && sentEntry !== undefined) {
    return wantEntry.structuralHash === sentEntry.structuralHash;
  }
  return false;
};

/** True when nothing was read from the entry, so nothing about it can be compared. */
const isOpaqueEntry = (entry: TypeEntry | undefined): boolean =>
  entry !== undefined && (entry.kind === 'external' || entry.kind === 'unknown');

/**
 * A shape whose wire form is not what it declares.
 *
 * Two of them. The structural hash deliberately ignores annotations (P02), so
 * two types can hash alike and still not agree on the wire when one of them
 * drops or renames a field on the way out. And a collection JSON cannot carry
 * is worth a word whatever both sides declare, including when they declare the
 * same thing, so a pair holding one is walked rather than waved through.
 *
 * Those are the only shapes worth walking once the hashes have already matched.
 */
export const hasWireAnnotation = (entry: TypeEntry | undefined): boolean =>
  (entry?.fields ?? []).some(
    (field) =>
      field.meta?.['exclude'] === true ||
      field.meta?.['transform'] === true ||
      typeof field.meta?.['exposeAs'] === 'string' ||
      /\b(?:Set|Map)</.test(field.type),
  );

/** The two ways a field the sender declares never reaches the wire at all. */
const DROPS = new Map<string, string>([
  ['class-transformer', 'the sender excludes it from serialisation'],
  ['undefined-vanishes', 'the sender declares it as holding nothing, and nothing is ever written'],
]);

/** Identity of a pair on the current path, so a shape containing itself stops. */
const pairKey = (sender: TypeEntry, receiver: TypeEntry): string =>
  `${sender.declaredIn}#${sender.name}|${receiver.declaredIn}#${receiver.name}`;

/** Values the sender may produce that the receiver does not accept. */
const notAccepted = (sent: readonly string[], accepted: readonly string[]): string[] => {
  const allowed = new Set(accepted);
  return sent.filter((member) => !allowed.has(member));
};

const compareRefs = (
  walk: Walk,
  senderRef: TypeRefAst,
  receiverRef: TypeRefAst,
  path: string,
  depth: number,
): void => {
  const senderAst = normalise(senderRef);
  const receiverAst = normalise(receiverRef);
  const sent = formatTypeRef(senderAst);
  const expected = formatTypeRef(receiverAst);
  if (sent === expected) return;

  // Neither declaration says what is in there, so there is nothing to compare
  // and nothing that could be wrong.
  if (makesNoClaim(senderAst) || makesNoClaim(receiverAst)) {
    walk.rules.add(at('any-unknown-skip', path));
    return;
  }

  // An array is its element repeated, so the two are compared once and the path
  // says so.
  if (senderAst.kind === 'array' && receiverAst.kind === 'array') {
    compareRefs(walk, senderAst.element, receiverAst.element, `${path}[]`, depth);
    return;
  }

  const senderShape = soleShape(senderAst, 'sender');
  const receiverShape = soleShape(receiverAst, 'receiver');
  const senderEntry = entryOfRef(walk, senderShape);
  const receiverEntry = entryOfRef(walk, receiverShape);

  if (
    isOpaqueEntry(senderEntry) ||
    isOpaqueEntry(receiverEntry) ||
    saysNothing(senderShape, senderEntry) ||
    saysNothing(receiverShape, receiverEntry)
  ) {
    walk.rules.add(at('unreadable-type', path));
    return;
  }

  // Two sets of allowed values, however each was written. Everything the sender
  // may produce has to be something the receiver accepts; the other way round
  // is a receiver being generous, which never breaks anything.
  //
  // A single value is a set of one, but two of those are an ordinary pair of
  // types and are compared as such; at least one side has to be a real choice
  // for this to be the question being asked.
  const sentChoice = alternativesOf(walk, senderShape);
  const wantChoice = alternativesOf(walk, receiverShape);
  const single = (ast: TypeRefAst): TypeRefAst[] | undefined =>
    ast.kind === 'literal' ? [ast] : undefined;
  const sentValues = sentChoice ?? single(senderShape);
  const wantValues = wantChoice ?? single(receiverShape);
  if (
    sentValues !== undefined &&
    wantValues !== undefined &&
    (sentChoice !== undefined || wantChoice !== undefined)
  ) {
    const extra = sentValues
      .filter((value) => !acceptable(walk, receiverShape, value, ALTERNATIVE_DEPTH))
      .map(formatTypeRef);
    if (extra.length > 0) {
      record(walk, {
        kind: 'type_mismatch',
        path,
        expected: nameOf(receiverShape, receiverEntry),
        actual: nameOf(senderShape, senderEntry),
        rule: null,
        note: `${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not among the values the receiver accepts`,
      });
    }
    return;
  }
  // A reference the registry does not hold. The edge-level report says so once;
  // repeating it per field would bury the fields that do differ.
  if (
    (senderShape.kind === 'id' && senderEntry === undefined) ||
    (receiverShape.kind === 'id' && receiverEntry === undefined)
  ) {
    walk.rules.add(at('type-missing', path));
    return;
  }

  if (senderEntry !== undefined && receiverEntry !== undefined) {
    compareEntries(walk, senderEntry, receiverEntry, path, depth);
    return;
  }

  // Two shapes, whether named, written out in place, or built by intersection.
  const senderFields = fieldsOfRef(walk, senderShape);
  const receiverFields = fieldsOfRef(walk, receiverShape);
  if (senderFields !== undefined && receiverFields !== undefined) {
    compareFields(walk, senderFields, receiverFields, path, depth);
    return;
  }

  // Nothing above could name a field, so the question is only whether what is
  // sent is something the receiver can read at all (D7).
  if (acceptable(walk, receiverAst, senderAst, ALTERNATIVE_DEPTH)) return;
  record(walk, { kind: 'type_mismatch', path, expected, actual: sent, rule: null });
};

/**
 * Two lists of fields, as the wire will carry them.
 *
 * The receiver's list is the contract: what it requires has to arrive, and what
 * it does not declare is at worst waste. The sender's list is only evidence of
 * what will actually be there.
 */
const compareFields = (
  walk: Walk,
  senderFields: readonly TypeField[],
  receiverFields: readonly TypeField[],
  path: string,
  depth: number,
): void => {
  const sent = new Map<string, FieldView>();
  for (const field of senderFields) {
    const view = applyWireRules(field, 'sender', { disable: walk.disable });
    for (const id of view.rules) walk.rules.add(`${id}:${joinPath(path, view.declaredName)}`);
    sent.set(view.name, view);
  }

  const declared = new Set<string>();
  const droppedByReceiver = new Set<string>();
  for (const field of receiverFields) {
    const want = applyWireRules(field, 'receiver', { disable: walk.disable });
    for (const id of want.rules) walk.rules.add(`${id}:${joinPath(path, want.declaredName)}`);
    // The receiver drops it on the way in, so nothing about its shape can be
    // wrong; anything sent under that name lands nowhere and is reported below.
    if (want.dropped) {
      droppedByReceiver.add(want.name);
      continue;
    }
    declared.add(want.name);

    const here = joinPath(path, want.name);
    const have = sent.get(want.name);
    if (have === undefined || have.dropped) {
      if (want.optional) continue;
      // A field the sender has and never sends is a different story from one it
      // does not have, and which rule took it off the wire is the story.
      const took = have?.rules.find((rule) => DROPS.has(rule));
      record(walk, {
        kind: 'missing_required',
        path: here,
        expected: formatTypeRef(want.type),
        actual: null,
        rule: took ?? null,
        ...(took === undefined ? {} : { note: DROPS.get(took) as string }),
      });
      continue;
    }

    // Neither declaration says what is in there, so only its presence is known,
    // and its presence was never in question.
    if (have.opaque || want.opaque) continue;

    if (have.optional !== want.optional) {
      record(walk, {
        kind: 'optionality_mismatch',
        path: here,
        expected: formatTypeRef(want.type),
        actual: formatTypeRef(have.type),
        rule: null,
        optionalOn: have.optional ? 'sender' : 'receiver',
        ...(have.optional && have.optionalBy !== undefined
          ? { note: `the sender marks it optional by ${have.optionalBy}` }
          : {}),
      });
    }

    // One side declares an identifier and the other declares the document that
    // identifier stands for. A store that can substitute one for the other
    // decides which actually crosses per query, and nothing in either
    // declaration says which query this is, so neither of them is wrong.
    if (
      (have.rules.includes('objectid-string') && isShapeRef(walk, want.type, 'receiver')) ||
      (want.rules.includes('objectid-string') && isShapeRef(walk, have.type, 'sender'))
    ) {
      walk.rules.add(`objectid-string:referenced:${here}`);
      continue;
    }

    if (have.rules.includes('set-map-json') || want.rules.includes('set-map-json')) {
      // Reported whatever the two declarations say, because what actually
      // arrives was decided by hand rather than by either of them.
      record(walk, {
        kind: 'type_mismatch',
        path: here,
        expected: formatTypeRef(want.type),
        actual: formatTypeRef(have.type),
        rule: 'set-map-json',
      });
      continue;
    }
    compareRefs(walk, have.type, want.type, here, depth);
  }

  for (const [name, view] of sent) {
    if (declared.has(name) || view.dropped) continue;
    record(walk, {
      kind: 'extra_field',
      path: joinPath(path, name),
      expected: null,
      actual: formatTypeRef(view.type),
      rule: droppedByReceiver.has(name) ? 'class-transformer' : null,
      ...(droppedByReceiver.has(name)
        ? { note: 'the receiver excludes it, so what arrives is thrown away' }
        : {}),
    });
  }
};

const compareEntries = (
  walk: Walk,
  senderEntry: TypeEntry,
  receiverEntry: TypeEntry,
  path: string,
  depth: number,
): void => {
  // Equal hashes prove equal shapes as far as the hash itself reaches, which is
  // three levels; below that it writes a placeholder, so two shapes that differ
  // only in their fifth level hash alike. A run asked to look deeper than the
  // hash can therefore not take the hash's word for it.
  //
  // They say nothing at all about annotations either, which is the other reason
  // a pair with equal hashes is sometimes still walked.
  const sameShape = senderEntry.structuralHash === receiverEntry.structuralHash;
  const annotated = hasWireAnnotation(senderEntry) || hasWireAnnotation(receiverEntry);
  if (sameShape && !annotated && depth <= DEFAULT_HASH_DEPTH) return;

  if (
    isOpaqueEntry(senderEntry) ||
    isOpaqueEntry(receiverEntry) ||
    saysNothing({ kind: 'primitive', name: senderEntry.name }, senderEntry) ||
    saysNothing({ kind: 'primitive', name: receiverEntry.name }, receiverEntry)
  ) {
    walk.rules.add(at('unreadable-type', path));
    return;
  }

  // Below the cut a hash is all there is, and the hashes have already been
  // compared. Naming the field needs a deeper walk, and saying so is more
  // useful than either guessing or going quiet (I5).
  if (depth <= 0) {
    walk.rules.add(at('depth-cap', path));
    if (sameShape) return;
    record(walk, {
      kind: 'type_mismatch',
      path,
      expected: receiverEntry.name,
      actual: senderEntry.name,
      rule: null,
      note: 'their shapes differ below the depth this run compared; raise --depth to see which field',
    });
    return;
  }

  const key = pairKey(senderEntry, receiverEntry);
  if (walk.open.has(key)) {
    // The same pair again on the same path: a shape that contains itself. The
    // hashes above already settled it, so stopping here loses nothing.
    walk.rules.add(at('cycle', path));
    return;
  }
  walk.open.add(key);

  const senderMembers = membersOf(senderEntry);
  const receiverMembers = membersOf(receiverEntry);
  if (senderMembers !== undefined && receiverMembers !== undefined) {
    const extra = notAccepted(senderMembers, receiverMembers);
    if (extra.length > 0) {
      record(walk, {
        kind: 'type_mismatch',
        path,
        expected: receiverEntry.name,
        actual: senderEntry.name,
        rule: null,
        note: `${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not among the values the receiver accepts`,
      });
    }
    walk.open.delete(key);
    return;
  }

  if (senderEntry.fields === undefined || receiverEntry.fields === undefined) {
    // One is a shape and the other a set of values: not a field-by-field
    // difference but a difference of the whole type (D7).
    record(walk, {
      kind: 'type_mismatch',
      path,
      expected: receiverEntry.name,
      actual: senderEntry.name,
      rule: null,
      note: `a ${senderEntry.kind} cannot stand in for a ${receiverEntry.kind}`,
    });
    walk.open.delete(key);
    return;
  }

  compareFields(walk, senderEntry.fields, receiverEntry.fields, path, depth - 1);
  walk.open.delete(key);
};

/** Sorted so two runs over one graph produce the same document, byte for byte. */
const order = (a: FieldDiff, b: FieldDiff): number => {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
};

/**
 * The full comparison, with what the wire did to it.
 *
 * `resolve` rather than a registry object, so a caller holding a database
 * answers the same question without loading a thousand types it will not look
 * at.
 */
export const diffTypes = (
  senderEntry: TypeEntry,
  receiverEntry: TypeEntry,
  resolve: (id: string) => TypeEntry | undefined,
  options: CompareOptions = {},
): CompareResult => {
  const walk: Walk = {
    resolve,
    disable: options.disableRules ?? [],
    diffs: [],
    rules: new Set(),
    open: new Set(),
  };
  compareEntries(walk, senderEntry, receiverEntry, '', Math.max(1, options.depth ?? DEFAULT_DEPTH));
  return { diffs: [...walk.diffs].sort(order), rulesApplied: [...walk.rules].sort() };
};

/**
 * The same comparison, starting from two references rather than two entries.
 *
 * What an edge carries is a reference, and a reference is not always a name: a
 * handler may answer with a shape written out in place, or with a plain string.
 * Insisting on a registry entry at the top would leave those unchecked for no
 * reason, since everything below the top is already compared as references.
 */
export const diffRefs = (
  senderRef: TypeRefAst,
  receiverRef: TypeRefAst,
  resolve: (id: string) => TypeEntry | undefined,
  options: CompareOptions = {},
): CompareResult => {
  const walk: Walk = {
    resolve,
    disable: options.disableRules ?? [],
    diffs: [],
    rules: new Set(),
    open: new Set(),
  };
  compareRefs(walk, senderRef, receiverRef, '', Math.max(1, options.depth ?? DEFAULT_DEPTH));
  return { diffs: [...walk.diffs].sort(order), rulesApplied: [...walk.rules].sort() };
};

/**
 * What one side sends against what the other declares, field by field.
 *
 * The published shape of the comparison: a list of disagreements and nothing
 * else. `diffTypes` is the same walk plus the rules it applied, which the
 * report needs and a caller comparing two types by hand does not.
 */
export const compareTypes = (
  senderEntry: TypeEntry,
  receiverEntry: TypeEntry,
  registry: TypeRegistry,
  options: CompareOptions = {},
): FieldDiff[] => diffTypes(senderEntry, receiverEntry, (id) => registry[id], options).diffs;
