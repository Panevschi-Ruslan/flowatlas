import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class PaymentsClient {
  constructor(private readonly http: HttpClient) {}

  pay(orderId: string, amount: number): Observable<number> {
    return this.http.post<number>(`${environment.apiUrl}/payments`, { orderId, amount });
  }
}
