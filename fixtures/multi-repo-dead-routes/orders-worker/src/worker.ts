/** What the platform hands the worker: the catalogue, bound by name. */
export interface Env {
  CATALOG: Fetcher;
}

/**
 * One item of an order, asked of the catalogue through its binding. The host
 * is whatever the code writes; the binding decides which worker answers.
 */
export async function itemFor(env: Env, id: string): Promise<unknown> {
  const response = await env.CATALOG.fetch('https://catalog/items/' + id);
  return response.json();
}

/**
 * Every item, from an address the worker is handed at run time. Nothing can
 * read it here, so the annotation says where it goes, naming the catalogue by
 * the short name everybody uses for it.
 *
 * @flowatlas-calls catalog GET /items
 */
export async function allItems(address: string): Promise<unknown> {
  const response = await fetch(address);
  return response.json();
}

/**
 * The catalogue's stock, changed through the binding by a client that is
 * handed the verb: the verb is only real where `restock` hands it in.
 */
export class CatalogClient {
  constructor(private readonly env: Env) {}

  private req(method: string, path: string): Promise<Response> {
    return this.env.CATALOG.fetch(`https://catalog${path}`, { method });
  }

  restock(id: string): Promise<Response> {
    return this.req('PATCH', `/items/${id}`);
  }
}
