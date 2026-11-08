import axios from 'axios';

/** The catalog's answers, as the browser writes them for itself. */
export interface Product {
  id: string;
  name: string;
}

/** Drifted: the catalog answers a `name`, never a `title`. */
export interface ProductCard {
  id: string;
  title: string;
}

const CATALOG = import.meta.env.VITE_CATALOG_URL;

/** The id in the address is the procedure's input; the answer agrees. */
export function getProduct(id: string) {
  return axios.get<Product>(`${CATALOG}/api/products/${id}`);
}

/** Every key the procedure takes, written in the query option. */
export function listTea() {
  return axios.get<Product[]>(`${CATALOG}/api/products`, { params: { category: 'tea', limit: 10 } });
}

/** Written in the address: `sort` is a key the procedure does not take, and `limit` is missing. */
export function sortedBy(category: string) {
  return axios.get<Product[]>(`${CATALOG}/api/products?category=${category}&sort=price`);
}

/** The body lacks the `sku` the procedure requires. */
export function createProduct(name: string, price: number) {
  return axios.post<{ id: string }>(`${CATALOG}/api/products/create`, { name, price });
}

/** Reads a `title` the procedure never answers. */
export function productCard(id: string) {
  return axios.get<ProductCard>(`${CATALOG}/api/products/${id}`);
}

/** A detailed route: the id under `params`, the price under `body`, and the answer the output's `body`. */
export function reprice(id: string, price: number) {
  return axios.patch<Product>(`${CATALOG}/api/products/${id}/price`, { price });
}
