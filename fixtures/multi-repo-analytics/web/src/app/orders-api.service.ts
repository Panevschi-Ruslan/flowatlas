/**
 * The front end, which no extractor reads yet.
 *
 * It is in the configuration so that every analysis has to cope with a service
 * that contributes nothing: `config` reports no keys under `web`, and the
 * gateway route this posts to is reported as uncalled until P08 draws the
 * `hits` edge.
 */
export class OrdersApiService {
  create(customerId: string): Promise<unknown> {
    return fetch('/orders', { method: 'POST', body: JSON.stringify({ customerId }) });
  }
}
