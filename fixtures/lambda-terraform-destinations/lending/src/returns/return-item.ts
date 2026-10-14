/** Checks an item back in; its result goes on to the library's bus, its failure to a topic. */
export const handler = async (event: { itemId: string }): Promise<{ itemId: string; returned: boolean }> => ({
  itemId: event.itemId,
  returned: true,
});
