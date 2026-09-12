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
  requestInvoice(order: OrderDto): { data: unknown } {
    return this.http.post<InvoiceDto>(this.registry.invoicesUrl(), {
      orderId: order.id,
      amount: order.total.amount,
    });
  }
}
