import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/**
 * The storefront's client. Every method sends a path it is handed, so no
 * address is read, and the annotations say what each one asks for.
 */
@Injectable({ providedIn: 'root' })
export class ShopClient {
  constructor(private readonly http: HttpClient) {}

  /** @flowatlas-calls catalog GET /items */
  items(path: string): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}${path}`);
  }

  /** @flowatlas-calls GET /orders */
  orders(path: string): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}${path}`);
  }

  /** @flowatlas-calls catalogue GET /items */
  misspelt(path: string): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}${path}`);
  }
}
