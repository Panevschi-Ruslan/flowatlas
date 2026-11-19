import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface Seller {
  name: string;
  following: boolean;
}

/** The sellers, written as paths under the API address the interceptor puts in front. */
@Injectable({ providedIn: 'root' })
export class SellersService {
  constructor(private readonly http: HttpClient) {}

  seller(name: string): Observable<Seller> {
    return this.http.get<Seller>('/sellers/' + name);
  }
}
