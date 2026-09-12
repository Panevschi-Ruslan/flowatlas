import { Injectable } from '@nestjs/common';

export interface Invoice {
  id: string;
  amount: number;
}

/**
 * The other common shape: no client object, one private method that takes the
 * verb and the path and is the only place a request is written.
 */
@Injectable()
export class BillingService {
  private base(): string {
    return process.env.BILLING_URL ?? '';
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.base()}${path}`, init);
    return JSON.parse(await res.text()) as T;
  }

  getInvoice(id: string): Promise<Invoice> {
    return this.req<Invoice>('GET', `/invoices/${id}`);
  }

  issue(invoice: Invoice): Promise<Invoice> {
    return this.req<Invoice>('POST', '/invoices', invoice);
  }
}
