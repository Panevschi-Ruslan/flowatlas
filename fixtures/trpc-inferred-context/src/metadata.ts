/**
 * Merges new metadata into what an order already carries. The caller writes it:
 *
 *   const merged = mergeMetadata(order.metadata, patch);
 *   prisma.order.update({ where: { id }, data: { metadata: merged } });
 *
 * This function reads no database, and the words above are a comment.
 */
export const mergeMetadata = (
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> => ({ ...(current ?? {}), ...patch });

// A string that holds a comment's opening is still a string, and what follows
// it is still code.
export const PATTERN = 'http://example.com/*';
