/**
 * The front end, read by the Angular extractor.
 *
 * The request is the platform's `fetch`, not `HttpClient`: an Angular service is
 * free to use either, and this one is read through the same description of
 * `fetch` the React reader uses (R140). It is the one caller of the gateway's
 * `POST /orders`, and nothing in `web` uses this class.
 */
export class OrdersApiService {
  create(customerId: string): Promise<unknown> {
    return fetch('/orders', { method: 'POST', body: JSON.stringify({ customerId }) });
  }
}
