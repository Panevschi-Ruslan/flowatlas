import { listInvoices } from './invoices-store';

/**
 * A handler factory this repository declares, handed out under another name -
 * which is how payload writes every route it has: `export const GET =
 * REST_GET(config)`, where `REST_GET` is `export const GET = handlerBuilder`
 * re-exported, and `handlerBuilder` returns the handler.
 */
const handlerBuilder =
  (config: { collection: string }) =>
  async (): Promise<Response> =>
    Response.json({ collection: config.collection, rows: await listInvoices() });

export const productsHandler = handlerBuilder;
