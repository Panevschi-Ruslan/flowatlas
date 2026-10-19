/**
 * The back office adds items to the catalogue. The address is whatever it is
 * handed, so the annotation says where it goes.
 *
 * @flowatlas-calls catalog-api POST /items
 */
export async function addItem(path: string, title: string): Promise<Response> {
  return fetch(path, { method: 'POST', body: JSON.stringify({ title }) });
}
