import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { AdminApiService } from './admin-api.service';

export interface CatalogGroup {
  name: string;
  items: string[];
}

@Injectable({ providedIn: 'root' })
export class CatalogService extends AdminApiService {
  protected resource(): string {
    return 'catalog';
  }

  /** Lands on the back end's grouped catalog, under its global prefix. */
  getGrouped(): Observable<CatalogGroup[]> {
    return this.get<CatalogGroup[]>('grouped');
  }

  /** The back end serves no export to post to: joined to no route. */
  exportSheet(): Observable<string> {
    return this.post<string>('export', {});
  }
}
