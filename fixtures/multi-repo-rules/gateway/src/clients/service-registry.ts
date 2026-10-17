import { Injectable } from '@nestjs/common';

/**
 * Addresses discovered at run time.
 *
 * Nothing here can be read from the source, which is the point: it is what makes
 * `BillingClient.requestInvoice` blind and what earns the `@CallsService`
 * marker its place (I10 — markers only where static analysis cannot reach).
 */
@Injectable()
export class ServiceRegistry {
  private readonly table = new Map<string, string>();

  register(service: string, baseUrl: string): void {
    this.table.set(service, baseUrl);
  }

  /** The billing address, assembled from whatever discovery returned. */
  invoicesUrl(): string {
    return this.baseUrlOf('billing') + '/invoices';
  }

  private baseUrlOf(service: string): string {
    return this.table.get(service) ?? '';
  }
}
