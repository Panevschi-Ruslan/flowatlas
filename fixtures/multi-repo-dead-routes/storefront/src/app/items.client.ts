import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface Item {
  id: string;
  title: string;
  price: number;
}

/** The verbs the client sends, as a screen names them. */
export enum HttpVerb {
  Patch = 'PATCH',
  Delete = 'DELETE',
}

/**
 * The storefront's one client of the catalogue.
 *
 * `req` is handed the verb by whoever calls it, so the verb is only read at
 * each caller; `url` builds every address and its suffix defaults to nothing,
 * so `url()` is the collection itself.
 */
@Injectable({ providedIn: 'root' })
export class ItemsClient {
  constructor(private readonly http: HttpClient) {}

  private url(suffix = ''): string {
    return `${environment.apiUrl}/items${suffix}`;
  }

  private req<T>(method: string, path: string, body?: unknown): Observable<T> {
    return this.http.request<T>(method, this.url(path), { body });
  }

  list(): Observable<Item[]> {
    return this.http.get<Item[]>(this.url());
  }

  one(id: string): Observable<Item> {
    return this.http.get<Item>(this.url(`/${id}`));
  }

  rename(id: string, title: string): Observable<Item> {
    return this.req<Item>('PATCH', `/${id}`, { title });
  }

  remove(id: string): Observable<void> {
    return this.req<void>(HttpVerb.Delete, `/${id}`);
  }

  /**
   * A page for one variant of an item, whose last segment is assembled from
   * two pieces nobody here can read. It could be `/items/:id/price`; nothing
   * says it is.
   */
  variant(slug: string, kind: string, extra: string): Observable<unknown> {
    return this.http.get(`${environment.apiUrl}/items/${slug}/${kind}${extra}`);
  }
}
