import type {
  Type,
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node as TsNode,
} from 'ts-morph';
import { Node } from 'ts-morph';
import type { GraphBuilder } from '../builder.js';
import type { EdgeType } from '../model/edges.js';
import { SIGNATURE_META, type Signature } from '../model/types.js';
import type { TypeCollector } from './collector.js';
import { formatTypeRef, parseTypeRef, type TypeRef, type TypeRefField } from './type-ref.js';

/** Something with parameters and a return: what a signature is read from. */
export type FunctionLike = MethodDeclaration | FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * The function a declaration is, however it was written.
 *
 * A reader keeps whichever node it found a function by - `function send() {}`,
 * `const send = () => {}`, `send = () => {}` on a class, `send: () => {}` in an
 * object - and the parameters are on the function, one node further in for
 * every spelling but the first. Undefined for a declaration that holds
 * something other than a function written in place.
 */
export const functionLikeOf = (declaration: TsNode): FunctionLike | undefined => {
  if (
    Node.isMethodDeclaration(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isFunctionExpression(declaration)
  ) {
    return declaration;
  }
  if (
    !Node.isVariableDeclaration(declaration) &&
    !Node.isPropertyDeclaration(declaration) &&
    !Node.isPropertyAssignment(declaration)
  ) {
    return undefined;
  }
  const initializer = declaration.getInitializer();
  if (initializer === undefined) return undefined;
  return Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer) ? initializer : undefined;
};

/** What a function was recorded as: bare references for edges, names for its node. */
export interface RecordedSignature {
  params: TypeRef[];
  returns: TypeRef;
  signature: Signature;
}

/**
 * Records what each function takes and gives back, on its node and on the
 * edges that reach it.
 *
 * Every reader that draws functions calls this once, after its last edge into
 * them is drawn, with the declaration behind each node it drew: the names go
 * on the node once (`SIGNATURE_META`), and the bare references on every edge
 * of the `arriving` types into it - a call by default. A way in's `handles`
 * edge is a reader's to annotate: what a handler returns is what the request
 * is answered with only where the framework says so, and the contracts read
 * it as that. A declaration whose node was never drawn is skipped, so a reader
 * may hand over everything it indexed. The first recording of an id wins, here
 * and in the builder.
 */
export const recordSignatures = (
  builder: GraphBuilder,
  collector: TypeCollector,
  declarations: Iterable<readonly [id: string, declaration: TsNode]>,
  arriving: readonly EdgeType[] = ['calls'],
): Map<string, RecordedSignature> => {
  const recorded = new Map<string, RecordedSignature>();
  for (const [id, declaration] of declarations) {
    if (recorded.has(id)) continue;
    const node = builder.getNode(id);
    if (node === undefined) continue;
    const fn = functionLikeOf(declaration);
    if (fn === undefined) continue;
    const collected = collector.collectSignature(fn);
    recorded.set(id, collected);
    builder.addNode({ ...node, meta: { [SIGNATURE_META]: collected.signature } });
  }

  for (const edge of builder.edges) {
    if (!arriving.includes(edge.type)) continue;
    const found = recorded.get(edge.to);
    if (found === undefined) continue;
    builder.addEdge({ ...edge, params: found.params, returns: found.returns });
  }
  return recorded;
};

/** A type a reader found, and where, so it is collected as the code there sees it. */
export interface StatedType {
  type: Type;
  site: TsNode;
}

/** One named part of a signature a reader states: an input of a component, a procedure's input. */
export interface StatedPart extends StatedType {
  name: string;
  optional?: boolean;
}

/**
 * What a node takes and gives back that is not a function's parameters: a
 * component's inputs and the events it emits, a procedure's input and what its
 * resolver answers (P35).
 *
 * `returns` is one type, or an object of named parts - a component's outputs -
 * and absent when the reader found nothing it gives back.
 */
export interface StatedSignature {
  params: readonly StatedPart[];
  returns?: StatedType | { fields: readonly StatedPart[] };
}

/** The bare reference of what a stated signature gives back. */
const statedReturns = (collector: TypeCollector, returns: StatedSignature['returns']): TypeRef => {
  if (returns === undefined) return 'void';
  if (!('fields' in returns)) return collector.collectType(collector.unwrapAsync(returns.type), returns.site);
  if (returns.fields.length === 0) return 'void';
  const fields: TypeRefField[] = [...returns.fields]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((part) => ({
      name: part.name,
      optional: part.optional === true,
      type: parseTypeRef(collector.collectType(part.type, part.site)),
    }));
  return formatTypeRef({ kind: 'object', fields });
};

/**
 * Records the signatures readers state for nodes that are not functions, the
 * same `SIGNATURE_META` a function's node carries, so the types view reads
 * every node one way (P35). Like {@link recordSignatures}, a node never drawn is
 * skipped and the first recording of an id wins.
 */
export const recordStatedSignatures = (
  builder: GraphBuilder,
  collector: TypeCollector,
  stated: Iterable<readonly [id: string, signature: StatedSignature]>,
): void => {
  const seen = new Set<string>();
  for (const [id, found] of stated) {
    if (seen.has(id)) continue;
    const node = builder.getNode(id);
    if (node === undefined) continue;
    seen.add(id);
    const signature: Signature = {
      params: found.params.map((part) => ({
        name: part.name,
        type: collector.collectType(part.type, part.site),
        ...(part.optional === true ? { optional: true as const } : {}),
      })),
      returns: statedReturns(collector, found.returns),
    };
    builder.addNode({ ...node, meta: { [SIGNATURE_META]: signature } });
  }
};
