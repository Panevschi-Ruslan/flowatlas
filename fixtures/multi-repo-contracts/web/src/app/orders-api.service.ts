import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { CreateOrderDto, OrderDto } from './order.dto';
import { environment } from '../environments/environment';

/**
 * The browser's half of the boundary, which fails the same way a service's does.
 *
 * The generic on the call is what says what the browser expects back, and the
 * argument is what it sends; a request from a browser is checked exactly like a
 * call between two services, because it is one.
 */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  /** Both halves at once: a body that is short of a field and an answer that is not. */
  create(body: CreateOrderDto): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${environment.apiUrl}/orders`, body);
  }
}
