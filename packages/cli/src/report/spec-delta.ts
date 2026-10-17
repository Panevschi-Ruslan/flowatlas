/**
 * The API documents of two built sides, written in memory and compared
 * (P118): what `spec diff` reports and what `diff --spec` puts in `diff.json`.
 */
import { lookupOf } from '@flowatlas/contracts';
import type { LoadedConfig, ProjectGraph } from '@flowatlas/core';
import { diffSpecs, specOptionsOf, writeSpecs, type SpecDiffReport, type WrittenSpec } from '@flowatlas/linker';

/** Every document of the services named (all of them by default) on one side. */
export const specsOfGraph = (
  loaded: LoadedConfig,
  graph: ProjectGraph,
  options: { services?: readonly string[]; depth?: number } = {},
): WrittenSpec[] =>
  writeSpecs(
    lookupOf(graph),
    options.services ?? loaded.config.services.map((service) => service.name),
    specOptionsOf(loaded.config, options.depth === undefined ? {} : { depth: options.depth }),
  );

/** The change from the base side's documents to the head side's, callers read off the base side. */
export const specBetween = (
  loaded: LoadedConfig,
  base: ProjectGraph,
  head: ProjectGraph,
  options: { services?: readonly string[]; depth?: number } = {},
): SpecDiffReport =>
  diffSpecs(specsOfGraph(loaded, base, options), specsOfGraph(loaded, head, options), options.depth === undefined ? {} : { depth: options.depth });
