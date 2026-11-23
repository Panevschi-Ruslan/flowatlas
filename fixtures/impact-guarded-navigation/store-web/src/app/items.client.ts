import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The items client: two screens call `getItems`. */
@Injectable({ providedIn: 'root' })
export class ItemsClient {
  constructor(private readonly http: HttpClient) {}

  getItems(shopId: string): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/api/shops/items`, { params: { shopId } });
  }
}
