import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

export interface User {
  id: string;
}

/** Written as the paths after the prefix the interceptor chooses for each. */
@Injectable({ providedIn: 'root' })
export class DirectoryService {
  constructor(private readonly http: HttpClient) {}

  users(): Observable<User[]> {
    return this.http.get<User[]>('/admin/users');
  }

  products(): Observable<unknown[]> {
    return this.http.get<unknown[]>('/products');
  }

  icons(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/assets/icons.json');
  }

  /** Which prefix this goes under depends on a part nobody wrote here. */
  section(name: string): Observable<unknown> {
    return this.http.get('/' + name);
  }
}
