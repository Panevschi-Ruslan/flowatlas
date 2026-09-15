import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type QueryParams = Record<string, string | number | undefined>;

export interface RequestOpts {
  initData?: string;
  params?: QueryParams;
}

/**
 * A pass-through client: every method takes the path and hands it to one URL
 * helper, so no request here has an address until somebody calls it.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  readonly base = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  get<T>(path: string, opts?: RequestOpts): Observable<T> {
    return this.http.get<T>(this.url(path, opts), this.httpOpts(opts));
  }

  post<T>(path: string, body?: unknown, opts?: RequestOpts): Observable<T> {
    return this.http.post<T>(this.url(path, opts), body ?? {}, this.httpOpts(opts));
  }

  delete<T>(path: string, opts?: RequestOpts): Observable<T> {
    return this.http.delete<T>(this.url(path, opts), this.httpOpts(opts));
  }

  private url(path: string, opts?: RequestOpts): string {
    return `${this.base}${path}${opts?.params ? this.query(opts.params) : ''}`;
  }

  private query(params: QueryParams): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  private httpOpts(opts?: RequestOpts): { headers?: Record<string, string> } {
    return opts?.initData ? { headers: { 'X-Init-Data': opts.initData } } : {};
  }
}
