import { hasSiteOrder, loopOfEdge, runsBeside, runsOnFailure, siteOrderOf, TAKEN_BY_META, type GraphEdge } from '@flowatlas/core';

/**
 * What the Steps view needs of each edge beyond its two ends: where it sits
 * among its siblings, whether it runs only on a failure, and whether it runs
 * beside its siblings rather than after them (P64).
 *
 * `order` is one number per packed edge: the place a workflow gives the step
 * (`meta.order`), or else the line of the call, or 0 when neither is known.
 * `failure` and `concurrent` list packed edge positions.
 *
 * The rest is what the prompt walk reads to take the steps `get_flow` takes
 * and say what each carries (P97); each is present only when some edge has it.
 */
export interface PackedSites {
  order: number[];
  failure: number[];
  concurrent: number[];
  /**
   * Edges run once per item of a loop (P69), as `[edge, kind, line]`: the
   * loop's kind as the code writes it (`for-of`, `map`) and the line it opens on.
   */
  loop: Array<[number, string, number]>;
  /**
   * Edges whose `order` is a workflow's place rather than a line, `[edge, line]`
   * with the line of the call, 0 for none: a walk takes them after the rest.
   */
  ordered?: Array<[edge: number, line: number]>;
  /**
   * What an edge carries, `[edge, params, returns]`: the type ids it passes and
   * gets back, as positions in `carried`, `returns` -1 for none.
   */
  carries?: Array<[edge: number, params: number[], returns: number]>;
  carried?: string[];
  /** Why a join less than proven was drawn (`meta.because`), `[edge, reasons]`. */
  because?: Array<[edge: number, reasons: string[]]>;
  /** The consumers a write onto a channel goes on to (P52), `[edge, nodes]` by node position. */
  takenBy?: Array<[edge: number, nodes: number[]]>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Sites of the edges the pack keeps, in the pack's order. Running beside the
 * siblings is what the graph declares (`runsBeside`), and failing what it
 * says runs on a failure (`runsOnFailure`); both are core's, read the same way
 * by the server's prompt.
 */
export const packSites = (edges: readonly GraphEdge[], position: ReadonlyMap<string, number> = new Map()): PackedSites => {
  const order = edges.map(siteOrderOf);
  const failure: number[] = [];
  const concurrent: number[] = [];
  const loop: PackedSites['loop'] = [];
  const ordered: NonNullable<PackedSites['ordered']> = [];
  const carries: NonNullable<PackedSites['carries']> = [];
  const because: NonNullable<PackedSites['because']> = [];
  const takenBy: NonNullable<PackedSites['takenBy']> = [];
  const carried = new Map<string, number>();
  const word = (text: string): number => {
    let at = carried.get(text);
    if (at === undefined) {
      at = carried.size;
      carried.set(text, at);
    }
    return at;
  };
  edges.forEach((edge, k) => {
    if (runsOnFailure(edge)) failure.push(k);
    if (runsBeside(edge)) concurrent.push(k);
    const inLoop = loopOfEdge(edge);
    if (inLoop !== undefined) loop.push([k, inLoop.kind, inLoop.line]);
    if (hasSiteOrder(edge)) ordered.push([k, edge.line ?? 0]);
    const params = edge.params ?? [];
    if (params.length > 0 || edge.returns !== undefined) {
      carries.push([k, params.map(word), edge.returns === undefined ? -1 : word(edge.returns)]);
    }
    const reasons = strings(edge.meta?.['because']);
    if (edge.confidence !== 'static' && reasons.length > 0) because.push([k, reasons]);
    const taken = edge.meta?.[TAKEN_BY_META];
    if (Array.isArray(taken)) {
      takenBy.push([k, taken.flatMap((id) => (typeof id === 'string' && position.has(id) ? [position.get(id) as number] : []))]);
    }
  });
  return {
    order,
    failure,
    concurrent,
    loop,
    ...(ordered.length === 0 ? {} : { ordered }),
    ...(carries.length === 0 ? {} : { carries, carried: [...carried.keys()] }),
    ...(because.length === 0 ? {} : { because }),
    ...(takenBy.length === 0 ? {} : { takenBy }),
  };
};
