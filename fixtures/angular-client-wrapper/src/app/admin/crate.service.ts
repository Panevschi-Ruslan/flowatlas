import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type CrateEntityType = 'item' | 'category' | 'sticker';

/** A table written down whole: one lookup into it is one of three segments. */
const ENTITY_PATH: Record<CrateEntityType, string> = {
  item: 'parcels',
  category: 'categories',
  sticker: 'stickers',
};

@Injectable({ providedIn: 'root' })
export class CrateService {
  private readonly api = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  setCrates(
    tenantId: string,
    entityType: CrateEntityType,
    entityId: string,
    body: { locale: string; name?: string },
  ): Observable<unknown> {
    const path = ENTITY_PATH[entityType];
    return this.http.put(`${this.api}/admin/${tenantId}/${path}/${entityId}/crates`, body);
  }
}
