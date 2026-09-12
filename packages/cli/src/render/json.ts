import type { FlowNode } from '@flowatlas/mcp';
import type { RenderOptions, SourceBlock } from './types.js';

/** The tree again, with the code of each node it was asked to quote. */
const withSource = (flow: FlowNode, source: Record<string, SourceBlock>): FlowNode => {
  const block = source[flow.node.id];
  return {
    ...flow,
    node: block === undefined ? flow.node : { ...flow.node, code: block.code },
    children: flow.children.map((child) => withSource(child, source)),
  } as FlowNode;
};

/**
 * The answer as a program reads it.
 *
 * The same tree the terminal draws, so a script and a person are never looking
 * at different graphs. Whatever the command wanted said around the tree is
 * merged in as fields rather than printed as prose.
 */
export const renderJson = (tree: FlowNode, options: RenderOptions): string => {
  const source = options.source ?? {};
  const root = Object.keys(source).length === 0 ? tree : withSource(tree, source);
  const payload = {
    ...(options.extra ?? {}),
    root,
    ...(options.types === undefined || Object.keys(options.types).length === 0
      ? {}
      : { types: options.types }),
    ...(options.truncated === undefined ? {} : { truncated: options.truncated }),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
};
