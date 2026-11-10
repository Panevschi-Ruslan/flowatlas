import axios from 'axios';

/**
 * The products gateway: a factory that makes its client before handing back
 * its object of functions, so it does more than hand the object back.
 */
const ProductsGateway = () => {
  const client = axios.create({ baseURL: 'http://products.internal' });
  return {
    async list() {
      const { data } = await client.get<string[]>('/products');
      return data;
    },
  };
};

export default ProductsGateway();
