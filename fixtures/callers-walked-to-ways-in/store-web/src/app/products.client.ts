import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * The catalog's client: four of the products routes. A new product's fields
 * are written inline, the type the create route's body has.
 */
@Injectable({ providedIn: 'root' })
export class ProductsClient {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/products`);
  }

  one(sku: string): Observable<string> {
    return this.http.get<string>(`${environment.apiUrl}/products/${sku}`);
  }

  create(product: {
    sku: string;
    name: string;
    description?: string;
    image?: string;
    price: number;
    currency?: string;
    weight?: number;
    width?: number;
    height?: number;
    depth?: number;
    color?: string;
    brand?: string;
    category?: string;
    tags?: string[];
    barcode?: string;
    supplier?: string;
    origin?: string;
    taxClass?: string;
    visible?: boolean;
    featured?: boolean;
    minOrder?: number;
    maxOrder?: number;
  }): Observable<string> {
    return this.http.post<string>(`${environment.apiUrl}/products`, product);
  }

  update(sku: string, name: string): Observable<string> {
    return this.http.put<string>(`${environment.apiUrl}/products/${sku}`, { name });
  }
}
