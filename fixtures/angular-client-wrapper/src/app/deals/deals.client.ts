import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient } from '../shared/api-client';

export interface Deal {
  id: string;
  title: string;
}

export interface ClaimDealDto {
  dealId: string;
  note?: string;
}

/** Each request is decided here, one call into the shared client apiece. */
@Injectable({ providedIn: 'root' })
export class DealsClient {
  constructor(private readonly api: ApiClient) {}

  mine(sessionToken: string): Observable<Deal[]> {
    return this.api.get<Deal[]>('/portal/me/deals', { sessionToken });
  }

  one(id: string, lang: string): Observable<Deal> {
    return this.api.get<Deal>(`/portal/deals/${id}`, { params: { lang } });
  }

  claim(body: ClaimDealDto): Observable<Deal> {
    return this.api.post<Deal>(`/portal/deals/${body.dealId}/claim`, body);
  }

  forget(id: string): Observable<void> {
    return this.api.delete<void>(`/portal/deals/${id}`);
  }
}
