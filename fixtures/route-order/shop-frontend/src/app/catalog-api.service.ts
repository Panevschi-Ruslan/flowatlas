import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly base = environment.catalogUrl;

  constructor(private readonly http: HttpClient) {}

  /** Lands on `/:itemId`, registered first on the same router. */
  featured(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/items/featured`);
  }

  /** Joined to the newest route as a guess: the two routers' order is not read. */
  newest(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/items/new`);
  }

  item(id: string): Observable<unknown> {
    return this.http.get(`${this.base}/items/${id}`);
  }
}
