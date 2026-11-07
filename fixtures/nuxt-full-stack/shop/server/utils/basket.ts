const basket = new Set<string>();

export const addToBasket = (id: string): string[] => {
  basket.add(id);
  return [...basket];
};

export const emptyBasket = (): number => {
  const had = basket.size;
  basket.clear();
  return had;
};
