import type {
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
import type { TypeRef } from './type-ref.js';

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
