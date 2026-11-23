import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/**
 * A second client the item card injects. `byKey` is written nowhere else
 * either, but `openArchive` navigates to an address no configured route
 * answers, a step the reading records as one it could not follow, in the
 * same file: so `byKey` stays a maybe, with that step as its gap.
 */
@Injectable({ providedIn: 'root' })
export class ItemsLookupService {
  constructor(
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}

  byKey(key: string): Observable<{ id: string; title: string }> {
    return this.http.get<{ id: string; title: string }>(`${environment.apiUrl}/items/${key}`);
  }

  openArchive(): void {
    this.router.navigate(['/archive']);
  }
}
