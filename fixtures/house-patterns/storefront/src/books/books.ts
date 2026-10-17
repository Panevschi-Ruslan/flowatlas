// The storefront's own client hook, from a package nobody here installed: the
// request is `send({ method, path })` on whatever the hook hands back.
import { useApi } from '@bookshop/api';

export interface Book {
  isbn: string;
  title: string;
  addedAt: string;
}

export interface NewBook {
  isbn: string;
  title: string;
}

const BASE = import.meta.env.VITE_CATALOG_URL;

export function listBooks(): Promise<Book[]> {
  const api = useApi();
  return api.send<Book[]>({ method: 'GET', path: `${BASE}/books` });
}

export function addBook(book: NewBook): Promise<Book> {
  return useApi().send<Book>({ method: 'POST', path: `${BASE}/books`, body: book });
}
