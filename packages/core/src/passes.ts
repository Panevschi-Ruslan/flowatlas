/**
 * One step of extraction.
 *
 * A pass reads the source and the indexes built before it, and writes nodes,
 * edges and unresolved rows into the shared builder. A later phase adds its own
 * passes rather than editing the pipeline, which is what keeps leaf, type and
 * broker work out of the extractor that hosts them. `Ctx` is the extractor's own
 * context, so the core never learns what any pass needs.
 */
export interface ExtractorPass<Ctx> {
  readonly name: string;
  run(ctx: Ctx): void;
}

export const definePass = <Ctx>(name: string, run: (ctx: Ctx) => void): ExtractorPass<Ctx> => ({
  name,
  run,
});
