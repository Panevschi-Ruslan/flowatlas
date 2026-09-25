import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** The browser half of the chain: two requests the Express service answers. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<unknown> {
    return this.http.get(`${environment.apiUrl}/orders`);
  }

  create(total: number): Observable<unknown> {
    return this.http.post(`${environment.apiUrl}/orders`, { total });
  }
}
