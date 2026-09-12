import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** The ordinary request, so the fixture has both halves of the round trip. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  cancel(depotId: string, orderId: string): Observable<void> {
    return this.http.post<void>(
      `${environment.apiUrl}/depots/${depotId}/orders/${orderId}/cancel`,
      {},
    );
  }
}
