import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** The accounts service names the shop's origin and allows credentials: this one is answered. */
@Injectable({ providedIn: 'root' })
export class AccountsApiService {
  constructor(private readonly http: HttpClient) {}

  me(): Observable<{ name: string }> {
    return this.http.get<{ name: string }>(`${environment.accountsUrl}/accounts/me`, { withCredentials: true });
  }
}
