import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly base = environment.billingUrl;

  constructor(private readonly http: HttpClient) {}

  /** Lands on the overdue route: the billing service runs on Fastify. */
  overdue(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/invoices/overdue`);
  }
}
