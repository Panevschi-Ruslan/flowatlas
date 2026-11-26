import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * A client every items screen injects. Only `getHistory` requests
 * `GET /api/items`; a screen that injects the client for its other methods
 * does not break when that route changes.
 */
@Injectable({ providedIn: 'root' })
export class ItemsClient {
  constructor(private readonly http: HttpClient) {}

  getHistory(shopId: string): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/api/items`, { params: { shopId } });
  }

  create(shopId: string, name: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/items`, { shopId, name });
  }

  /** No specific route answers it: the back end's catch-all does. */
  archive(itemId: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/api/items/${itemId}`);
  }
}
