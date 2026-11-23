import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The board's client: `acknowledge` requests the route serving `TicketsService.acknowledge`. */
@Injectable({ providedIn: 'root' })
export class TicketBoardService {
  constructor(private readonly http: HttpClient) {}

  acknowledge(ticketId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/tickets/${ticketId}/ack`, {});
  }
}
