import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface Product {
  id: string;
  name: string;
}

export interface Seller {
  name: string;
  following: boolean;
}

/** The catalog, written as the paths under the API's mount: the interceptor puts the host and `/api` in front. */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(private readonly http: HttpClient) {}

  list(featured: boolean): Observable<Product[]> {
    return this.http.get<Product[]>('/products' + (featured ? '/featured' : ''));
  }

  get(id: string): Observable<Product> {
    return this.http.get<Product>(`/products/${id}`);
  }

  seller(name: string): Observable<Seller> {
    return this.http.get<Seller>('/sellers/' + name);
  }

  follow(name: string): Observable<Seller> {
    return this.http.post<Seller>('/sellers/' + name + '/follow', {});
  }

  /** A file the page serves itself, which the interceptor sends on as it is. */
  labels(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/assets/labels.json');
  }
}
