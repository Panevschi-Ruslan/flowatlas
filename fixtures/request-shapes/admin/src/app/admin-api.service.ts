import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** What the admin sends when it places an order. It has no customer. */
export interface NewOrder {
  total: number;
}

export interface OrderRow {
  id: string;
  total: number;
}

export interface ImportBatch {
  source: string;
}

export interface CatalogItem {
  id: string;
  sku: string;
  price: number;
}

/**
 * Four requests to two services written in two frameworks, each compared with
 * what the route reads and answers now that those are read.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  constructor(private readonly http: HttpClient) {}

  /** Missing a field the route's own type requires: an error. */
  place(order: NewOrder): Observable<OrderRow> {
    return this.http.post<OrderRow>(`${environment.ordersUrl}/orders`, order);
  }

  /** Missing a field the route only casts to: a warning, and it says why. */
  importBatch(batch: ImportBatch): Observable<unknown> {
    return this.http.post<unknown>(`${environment.ordersUrl}/orders/import`, batch);
  }

  /** The route states nothing it answers with, and the report says so. */
  orders(): Observable<OrderRow[]> {
    return this.http.get<OrderRow[]>(`${environment.ordersUrl}/orders`);
  }

  /** Agrees with what the route answers. */
  item(id: string): Observable<CatalogItem> {
    return this.http.get<CatalogItem>(`${environment.catalogUrl}/items/${id}`);
  }
}
