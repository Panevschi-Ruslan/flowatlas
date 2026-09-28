import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

/** Would be Angular in an application that supplies it. The API does not. */
@Injectable({ providedIn: 'root' })
export class SdkClient {
  constructor(private readonly http: HttpClient) {}

  lookup(email: string) {
    return this.http.get<{ email: string }>(`/customers/${email}`);
  }
}
