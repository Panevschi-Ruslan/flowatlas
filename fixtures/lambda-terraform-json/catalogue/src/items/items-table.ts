export interface Item {
  itemId: string;
  title: string;
}

const items = new Map<string, Item>();

export const findItem = async (itemId: string): Promise<Item | undefined> => items.get(itemId);

export const saveItem = async (item: Item): Promise<void> => {
  items.set(item.itemId, item);
};
