import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * The client the item card uses. `one` is called; `oneLegacy` requests the
 * same route and its name is written nowhere else in the repository, in a
 * file with no call the reading could not follow: no way in could break
 * through it.
 */
@Injectable({ providedIn: 'root' })
export class ItemsApiService {
  constructor(private readonly http: HttpClient) {}

  one(id: string): Observable<{ id: string; title: string }> {
    return this.http.get<{ id: string; title: string }>(`${environment.apiUrl}/items/${id}`);
  }

  oneLegacy(id: string): Observable<{ id: string; title: string }> {
    return this.http.get<{ id: string; title: string }>(`${environment.apiUrl}/items/${id}`);
  }
}
