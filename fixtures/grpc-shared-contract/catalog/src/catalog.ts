interface Product {
  id: string;
  name: string;
  price: number;
}

const products: Product[] = [{ id: 'p1', name: 'Kettle', price: 2500 }];

export class CatalogImpl {
  listProducts(_call: unknown, callback: (error: Error | null, reply?: { products: Product[] }) => void): void {
    callback(null, { products });
  }

  getProduct(call: { request: { id: string } }, callback: (error: Error | null, reply?: Product) => void): void {
    callback(null, products.find((product) => product.id === call.request.id));
  }

  watchPrices(call: { write(change: { id: string; price: number }): void; end(): void }): void {
    for (const product of products) call.write({ id: product.id, price: product.price });
    call.end();
  }

  private audit(): number {
    return products.length;
  }
}
