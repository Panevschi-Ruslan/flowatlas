import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/**
 * The ordinary request, answered by a controller.
 *
 * It is here to prove the other half: the worker's `ALL /api/*` bridge answers
 * this address too, and must lose to the route that spells it out.
 */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  list(depotId: string): Observable<unknown> {
    return this.http.get(`${environment.apiUrl}/depots/${depotId}/orders`);
  }
}
