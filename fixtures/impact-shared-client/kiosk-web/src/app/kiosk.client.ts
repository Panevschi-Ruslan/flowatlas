import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * The kiosk's one client. `browse` requests `GET /api/items`; `order`
 * requests `POST /api/items`, whose handler publishes the change the history
 * screen reacts to; `forward` sends whatever path it is handed, which only
 * the back end's catch-all is sure to answer.
 */
@Injectable({ providedIn: 'root' })
export class KioskClient {
  constructor(private readonly http: HttpClient) {}

  browse(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/api/items`, { params: { shopId: 'kiosk' } });
  }

  order(name: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/items`, { shopId: 'kiosk', name });
  }

  forward(path: string): Observable<unknown> {
    return this.http.get<unknown>(`${environment.apiUrl}/api/${path}`);
  }
}
