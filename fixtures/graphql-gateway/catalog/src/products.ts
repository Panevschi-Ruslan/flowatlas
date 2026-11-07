export interface Product {
  id: string;
  name: string;
  price: number;
}

const products: Product[] = [{ id: 'p1', name: 'Kettle', price: 30 }];

export const listProducts = (): Product[] => products;

export const findProduct = (id: string): Product | undefined => products.find((product) => product.id === id);

export const reviewsOf = (id: string): Array<{ id: string; stars: number }> => [{ id: `${id}-r1`, stars: 5 }];
