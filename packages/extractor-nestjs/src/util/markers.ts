import type { Decorator } from 'ts-morph';
import { decoratorArgs, decoratorName, findDecorators } from '@flowatlas/core';

/** The annotations this project understands, and where they come from. */
export const MARKER_NAMES = [
  'Emits',
  'Consumes',
  'CallsService',
  'FlowEntry',
  'ContractIgnore',
] as const;

export const MARKER_MODULES = ['@flowatlas/markers'] as const;

export interface RecordedMarker {
  name: string;
  args: unknown[];
}

/**
 * Records the annotations present on a symbol.
 *
 * Reading them here, once, means every later phase takes markers from the graph
 * instead of re-parsing the source to find them.
 */
export const readMarkers = (node: { getDecorators(): Decorator[] }): RecordedMarker[] =>
  findDecorators(node, { names: [...MARKER_NAMES], fromModules: MARKER_MODULES }).map(
    (decorator) => ({
      name: decoratorName(decorator),
      args: decoratorArgs(decorator).map((value) =>
        value.resolved ? value.value : { unresolved: value.text },
      ),
    }),
  );

/** Non-framework decorators on a handler, kept for reporting. */
export const otherDecorators = (
  node: { getDecorators(): Decorator[] },
  ignore: ReadonlySet<string>,
): RecordedMarker[] =>
  node
    .getDecorators()
    .filter((decorator) => !ignore.has(decoratorName(decorator)))
    .map((decorator) => ({
      name: decoratorName(decorator),
      args: decoratorArgs(decorator).map((value) =>
        value.resolved ? value.value : { unresolved: value.text },
      ),
    }));
