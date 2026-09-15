import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { BaseService } from './base.service';

export interface Review {
  id: string;
  rating: number;
}

@Injectable({ providedIn: 'root' })
export class ReviewService extends BaseService {
  protected getResourcePath(): string {
    return 'reviews';
  }

  /** A query string that is either empty or opens with `?` is no part of the route. */
  list(filters?: Record<string, string>): Observable<Review[]> {
    const qs = this.buildQueryString(filters);
    return this.requestWithTenant((tenantId) =>
      this.http.get<Review[]>(`${this.baseUrl}/admin/${tenantId}/reviews${qs}`),
    );
  }

  remove(id: string): Observable<void> {
    return this.delete(id);
  }
}
