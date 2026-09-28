import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { CreateInvoiceDto, CustomerRefDto, InvoiceDto } from './dto';

/**
 * Every call this fixture measures, aimed at a service nobody here can read.
 *
 * `BILLING_URL` is what ties them to `billing`, exactly as it would tie them to
 * a repository: `flowatlas.config.json` lists it in `services[billing]
 * .baseUrlEnv`, and the only difference is that billing's routes came out of a
 * document rather than out of source. Nothing in this file knows that.
 */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The three kinds of finding at once, against a shape that was declared.
   *
   * Expected: `missing_required currency`, `optionality_mismatch note`,
   * `extra_field traceId` on the request half, and `type_mismatch total` on the
   * answer — the same four sentences two repositories would have produced.
   */
  create(body: CreateInvoiceDto) {
    return this.http.post<InvoiceDto>(`${this.config.get('BILLING_URL')}/invoices`, body);
  }

  /** The answer half on its own: `total` is text here and a number there. */
  fetchOne(id: string) {
    return this.http.get<InvoiceDto>(`${this.config.get('BILLING_URL')}/invoices/${id}`);
  }

  /**
   * A shape copied out of the document without a single change.
   *
   * Expected: `identical`, and no field walked. A declared end is not
   * automatically drift — it is a declaration, and two declarations that agree
   * agree.
   */
  customer(id: string) {
    return this.http.get<CustomerRefDto>(`${this.config.get('BILLING_URL')}/customers/${id}`);
  }
}

// `DELETE /invoices/{invoiceId}` is in the document and is deliberately not
// called from anywhere here. It has to read as a route nothing reaches, which
// is a fact about this project, and never as an error about the document: a
// third party's service answers callers this repository has never heard of, and
// a route nobody here calls is the normal case rather than a fault.
