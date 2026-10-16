/**
 * The framework's HTTP client, as the request reader asks the checker for it.
 *
 * The client is told apart by its type and the package it is declared in, so
 * an uninstalled clone without this reads no request at all; and every verb
 * answers with a stream of the type it is called with, which is how a request's
 * answer is read. Options are typed loosely: a request's parts are read off the
 * call, not the type.
 */
export const ANGULAR_HTTP_SHAPE = `
import type { Observable } from 'rxjs';
export declare class HttpHeaders {
  constructor(headers?: string | Record<string, string | string[]>);
  set(name: string, value: string | string[]): HttpHeaders;
  append(name: string, value: string | string[]): HttpHeaders;
  get(name: string): string | null;
}
export declare class HttpParams {
  constructor(options?: { fromString?: string; fromObject?: Record<string, unknown> });
  set(param: string, value: string | number | boolean): HttpParams;
  append(param: string, value: string | number | boolean): HttpParams;
}
export interface HttpOptions {
  headers?: HttpHeaders | Record<string, string | string[]>;
  params?: HttpParams | Record<string, unknown>;
  body?: unknown;
  observe?: string;
  responseType?: string;
  withCredentials?: boolean;
  [key: string]: unknown;
}
export declare class HttpErrorResponse {
  readonly status: number;
  readonly statusText: string;
  readonly error: unknown;
  readonly message: string;
  readonly url: string | null;
}
export declare class HttpClient {
  get<T>(url: string, options?: HttpOptions): Observable<T>;
  post<T>(url: string, body: unknown, options?: HttpOptions): Observable<T>;
  put<T>(url: string, body: unknown, options?: HttpOptions): Observable<T>;
  patch<T>(url: string, body: unknown, options?: HttpOptions): Observable<T>;
  delete<T>(url: string, options?: HttpOptions): Observable<T>;
  head<T>(url: string, options?: HttpOptions): Observable<T>;
  options<T>(url: string, options?: HttpOptions): Observable<T>;
  jsonp<T>(url: string, callbackParam: string): Observable<T>;
  request<T>(method: string, url: string, options?: HttpOptions): Observable<T>;
}
export declare class HttpClientModule {}
export declare function provideHttpClient(...features: unknown[]): unknown;
export declare function withInterceptors(interceptors: unknown[]): unknown;
`;
