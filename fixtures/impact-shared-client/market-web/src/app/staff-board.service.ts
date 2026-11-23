import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The staff screens' client: three components inject it, one of them for `ackCall`. */
@Injectable({ providedIn: 'root' })
export class StaffBoardService {
  constructor(private readonly http: HttpClient) {}

  ackCall(deskId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/staff/desks/${deskId}/ack-call`, {});
  }

  callStaff(deskId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/staff/desks/${deskId}/call`, {});
  }

  listDesks(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/api/staff/desks`);
  }

  close(deskId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/staff/desks/${deskId}/close`, {});
  }
}
