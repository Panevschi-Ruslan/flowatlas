import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** The web's idea of an item: a `promo`, a `badge` and a `legacyCode` the API never sends. */
export interface Item {
  id: string;
  name: string;
  price: number;
  status: 'draft' | 'live' | 'sold';
  promo?: { text: string };
  badge?: { label: string };
  legacyCode?: string;
}

export interface ItemStats {
  views: number;
  saves: number;
  shares?: number;
}

@Injectable({ providedIn: 'root' })
export class ItemsService {
  constructor(private readonly http: HttpClient) {}

  one(id: string): Observable<Item> {
    return this.http.get<Item>(`${environment.apiUrl}/api/items/${id}`);
  }

  stats(id: string): Observable<ItemStats> {
    return this.http.get<ItemStats>(`${environment.apiUrl}/api/items/${id}/stats`);
  }
}
