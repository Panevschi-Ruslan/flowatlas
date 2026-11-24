import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/**
 * The base every admin client extends: the address is the API's base, the
 * store, the subclass's resource and the caller's path, built in one place.
 */
@Injectable({ providedIn: 'root' })
export abstract class AdminApiService {
  protected readonly apiUrl = environment.apiUrl;

  constructor(protected readonly http: HttpClient) {}

  protected abstract resource(): string;

  protected url(path: string): string {
    const storeId = localStorage.getItem('store') ?? '';
    return `${this.apiUrl}/admin/${storeId}/${this.resource()}/${path}`;
  }

  protected get<T>(path: string): Observable<T> {
    return this.http.get<T>(this.url(path));
  }

  protected post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body);
  }
}
