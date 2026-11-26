import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

/** Billing, through the dev server the admin is served by. */
@Injectable({ providedIn: 'root' })
export class InvoicesService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<unknown[]> {
    return this.http.get<unknown[]>('/billing/invoices');
  }
}
