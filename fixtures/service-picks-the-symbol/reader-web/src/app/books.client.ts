import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * The reader's client of the back end. `renew` asks for
 * `POST /books/:id/renew`, which the back end serves as `extend`: one
 * segment off, so it joins no route.
 */
@Injectable({ providedIn: 'root' })
export class BooksClient {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/books`);
  }

  get(bookId: string): Observable<string> {
    return this.http.get<string>(`${environment.apiUrl}/books/${bookId}`);
  }

  hold(bookId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/books/${bookId}/hold`, {});
  }

  renew(bookId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/books/${bookId}/renew`, {});
  }
}
