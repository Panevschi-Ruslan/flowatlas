import type { GraphNode } from '@flowatlas/core';

/**
 * Every node's id, for the page's "Copy as prompt" (P97): a copied prompt
 * names each step by the id the MCP tools take, the same text the server
 * writes, so the page has to know them.
 *
 * Most of an id is already in the pack - the type, the service, the file - so
 * each is shipped as what is left once those are said, with a mark for which
 * of them it starts with (`stepIdOf` in `steps.js` reads them back):
 *
 *   `#rest`  `<service>#<file>:rest`          a method, a provider
 *   `:rest`  `<type>:<service>#<file>:rest`   a call, a query, a publish
 *   `!rest`  `<type>:<service>#rest`          a table, a setting
 *   `^rest`  `<type>:<service>:rest`          a way in
 *   `~rest`  `<type>:rest`                    a channel, a type
 *
 * Anything else is the id as it is, and an id that itself starts with one of
 * the marks, or with `=`, is shipped behind a `=`.
 */
export const ID_MARKS = '#:!^~=';

export const packIds = (nodes: readonly GraphNode[]): string[] =>
  nodes.map((node) => {
    const { id, type, repo } = node;
    const file = node.file ?? '';
    const forms: Array<[string, string]> = [
      ...(file === '' ? [] : ([[`${repo}#${file}:`, '#'], [`${type}:${repo}#${file}:`, ':']] as Array<[string, string]>)),
      [`${type}:${repo}#`, '!'],
      [`${type}:${repo}:`, '^'],
      [`${type}:`, '~'],
    ];
    for (const [prefix, mark] of forms) if (id.startsWith(prefix)) return mark + id.slice(prefix.length);
    return ID_MARKS.includes(id.charAt(0)) ? `=${id}` : id;
  });
