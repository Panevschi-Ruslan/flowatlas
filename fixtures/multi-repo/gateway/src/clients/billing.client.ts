import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CallsService } from '@flowatlas/markers';

import type { OrderDto } from '@fx/contracts';

import type { InvoiceDto } from './invoice.dto';
import { ServiceRegistry } from './service-registry';

/** The one call whose target only a marker can name. */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly registry: ServiceRegistry,
  ) {}

  /**
   * The address is assembled from the routing table at run time, so P03 records
   * `meta.path: null`, `meta.baseUrlEnv: null` and reports `dynamic-http-url`:
   * nothing static can see where this goes. The marker is the only thing that
   * names the target, and it resolves — `billing` is in the configuration and
   * has `POST /invoices`.
   *
   * Expected: exactly one `http_calls` edge from this `http_out`, to
   * `entry:billing:http:POST:/invoices`, `confidence: "marker"`,
   * `meta.via: "marker"`, and no second edge (D3, §12). Because the marker
   * resolves, this call is counted in `httpOut.byMarker`, not in
   * `httpOut.dynamic`.
   */
  @CallsService('billing', 'POST /invoices')
  requestInvoice(order: OrderDto) {
    return this.http.post<InvoiceDto>(this.registry.invoicesUrl(), {
      orderId: order.id,
      amount: order.total.amount,
    });
  }
}

// The request methods above declare no return type on purpose. What a request
// answers with is the library's business — `HttpService.get<T>` gives back
// `Observable<AxiosResponse<T>>` — and letting that signature decide is what
// makes this fixture a test of the library's shape rather than of a shape
// somebody retyped. They used to say `{ data: unknown }`, which no real Nest
// client can say and which hid the delivery wrapper the graph reads through.
//
// Do not put an annotation back. It would need two imports, and every line
// below them would move; node ids carry line numbers, and the fixture section
// of the repository README lists what that breaks.
