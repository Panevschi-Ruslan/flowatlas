import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, type Observable, throwError } from 'rxjs';
import { environment } from '../environments/environment';

/** The shop's requests to the orders service, which allows any origin by `*`. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  /** Sends the session cookie: refused by a server answering `*`. */
  list(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.ordersUrl}/orders`, { withCredentials: true });
  }

  /** Sends a field `CreateOrderDto` does not declare, under a pipe that forbids it. */
  create(item: string, quantity: number): Observable<string> {
    return this.http.post<string>(`${environment.ordersUrl}/orders`, { item, quantity, giftNote: 'for you' });
  }

  /** `Authorization` is allowed, `X-Request-Id` is not. */
  cancel(id: string): Observable<void> {
    return this.http.post<void>(`${environment.ordersUrl}/orders/${id}/cancel`, {}, {
      headers: new HttpHeaders({ Authorization: 'Bearer t', 'X-Request-Id': id }),
    });
  }

  /** Branches on 422, from a route whose status is computed: not judged. */
  refund(id: string): Observable<void> {
    return this.http.post<void>(`${environment.ordersUrl}/orders/${id}/refund`, {}).pipe(
      catchError((err) => {
        if (err.status === 422) return throwError(() => new Error('cannot refund'));
        return throwError(() => err);
      }),
    );
  }

  /** `PATCH` is allowed. */
  rename(id: string, title: string): Observable<void> {
    return this.http.patch<void>(`${environment.ordersUrl}/orders/${id}`, { title });
  }

  /** `DELETE` is not. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.ordersUrl}/orders/${id}`);
  }
}
