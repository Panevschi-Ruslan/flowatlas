import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface Item {
  id: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class ItemsService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<Item[]> {
    return this.http.get<Item[]>('/items');
  }

  create(name: string): Observable<Item> {
    return this.http.post<Item>('/items', { name });
  }
}
