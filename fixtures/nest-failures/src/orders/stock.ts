import { OutOfStockError } from './errors';

const stock = new Map<string, number>([['tea', 3]]);

/** A helper that holds nothing: only its throw puts it on the route. */
export function assertInStock(sku: string, quantity: number): void {
  if ((stock.get(sku) ?? 0) < quantity) throw new OutOfStockError(sku);
}
