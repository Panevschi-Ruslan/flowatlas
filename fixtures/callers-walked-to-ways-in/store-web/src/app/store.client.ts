import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The store's client: the checkout screen places and cancels through it, the report screen reads the daily report. */
@Injectable({ providedIn: 'root' })
export class StoreClient {
  constructor(private readonly http: HttpClient) {}

  place(sku: string, qty: number): Observable<boolean> {
    return this.http.post<boolean>(`${environment.apiUrl}/checkout`, { sku, qty });
  }

  cancel(sku: string): Observable<number> {
    return this.http.delete<number>(`${environment.apiUrl}/checkout/${sku}`);
  }

  daily(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/reports/daily`);
  }
}
