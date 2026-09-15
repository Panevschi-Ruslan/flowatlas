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

  mine(sessionData: string): Observable<Deal[]> {
    return this.api.get<Deal[]>('/chat/me/deals', { sessionData });
  }

  one(id: string, lang: string): Observable<Deal> {
    return this.api.get<Deal>(`/chat/deals/${id}`, { params: { lang } });
  }

  claim(body: ClaimDealDto): Observable<Deal> {
    return this.api.post<Deal>(`/chat/deals/${body.dealId}/claim`, body);
  }

  forget(id: string): Observable<void> {
    return this.api.delete<void>(`/chat/deals/${id}`);
  }
}
