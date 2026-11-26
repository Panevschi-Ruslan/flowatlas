import type { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';
import type { Observable } from 'rxjs';

/**
 * One request on to a service. The verb is the caller's: each branch below is
 * taken only by the callers that hand its verb in.
 */
export const forward = <T>(http: HttpService, method: string, url: string, body?: unknown): Observable<AxiosResponse<T>> =>
  method === 'GET'
    ? http.get<T>(url)
    : method === 'DELETE'
      ? http.delete<T>(url)
      : method === 'PATCH'
        ? http.patch<T>(url, body)
        : http.post<T>(url, body);
