import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

interface ReportRow {
  day: string;
  total: number;
}

/** The reports client: the reports screen reads the daily report and exports through it. */
@Injectable({ providedIn: 'root' })
export class ReportsClient {
  constructor(private readonly http: HttpClient) {}

  daily(): Observable<ReportRow[]> {
    return this.http.get<ReportRow[]>(`${environment.apiUrl}/api/reports/daily`);
  }

  exportAll(): Observable<{ rows: number }> {
    return this.http.post<{ rows: number }>(`${environment.apiUrl}/api/reports/export`, {});
  }
}
