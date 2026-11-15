// A client of the page's own, handed to the class that calls it through a field.
class ShopClient {
  get(path) {
    return fetch(`${API_ROOT}${path}`).then((res) => res.json());
  }
}

class ProductList {
  constructor(client) {
    this.client = client;
  }

  products() {
    return this.client.get('/products');
  }
}

const products = new ProductList(new ShopClient());
