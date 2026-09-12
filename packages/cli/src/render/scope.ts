import type { CompactNode } from '@flowatlas/mcp';

/**
 * Node types that belong to the whole project rather than to one repository.
 *
 * Their ids carry no repository prefix (I6); the repository recorded on them is
 * only where they were first seen. Painting them as one service's would invent
 * a boundary the graph does not have.
 */
const PROJECT_WIDE = new Set(['channel', 'external_api']);

export const serviceOf = (node: CompactNode): string | undefined =>
  PROJECT_WIDE.has(node.type) ? undefined : node.service;
