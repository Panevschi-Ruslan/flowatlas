import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * A template-method base: the URL builder asks each subclass for its resource
 * path, and the verb helpers take the rest of the path from the caller.
 */
@Injectable({ providedIn: 'root' })
export abstract class BaseService {
  protected baseUrl = environment.apiUrl || 'http://localhost:3000';

  constructor(protected readonly http: HttpClient) {}

  protected abstract getResourcePath(): string;

  protected requestWithTenant<T>(fn: (tenantId: string) => Observable<T>): Observable<T> {
    return fn(localStorage.getItem('tenant') ?? '');
  }

  protected buildAdminUrl(tenantId: string, path: string = ''): string {
    const resourcePath = this.getResourcePath();
    const basePath = `${this.baseUrl}/admin/${tenantId}/${resourcePath}`;
    return path ? `${basePath}/${path}` : basePath;
  }

  protected get<T>(path: string = ''): Observable<T> {
    return this.requestWithTenant((tenantId) => this.http.get<T>(this.buildAdminUrl(tenantId, path)));
  }

  protected getWithParams<T>(path: string, params: Record<string, string>): Observable<T> {
    return this.requestWithTenant((tenantId) => {
      let url = this.buildAdminUrl(tenantId, path);
      const query = new URLSearchParams(params).toString();
      if (query) {
        url += `?${query}`;
      }
      return this.http.get<T>(url);
    });
  }

  protected post<T>(path: string, body: unknown): Observable<T> {
    return this.requestWithTenant((tenantId) =>
      this.http.post<T>(this.buildAdminUrl(tenantId, path), body),
    );
  }

  /** Deleting is a POST to `<path>/delete`, whatever the method is called. */
  protected delete(path: string): Observable<void> {
    return this.requestWithTenant((tenantId) =>
      this.http.post<void>(this.buildAdminUrl(tenantId, `${path}/delete`), {}),
    );
  }

  protected postAction<T>(path: string, body: unknown): Observable<T> {
    return this.post<T>(path, body);
  }

  protected buildQueryString(filters?: Record<string, string>): string {
    if (!filters) {
      return '';
    }
    const text = new URLSearchParams(filters).toString();
    return text ? `?${text}` : '';
  }
}
