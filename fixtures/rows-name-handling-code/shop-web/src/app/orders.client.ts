import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The orders client: the order screen cancels through it. */
@Injectable({ providedIn: 'root' })
export class OrdersClient {
  constructor(private readonly http: HttpClient) {}

  cancel(orderId: string, userRef: string): Observable<void> {
    return this.http.patch<void>(`${environment.apiUrl}/api/orders/${orderId}/cancel`, { userRef });
  }
}
