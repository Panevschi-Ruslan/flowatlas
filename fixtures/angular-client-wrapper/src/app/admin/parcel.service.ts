import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { BaseService } from './base.service';

export interface Parcel {
  id: string;
  name: string;
}

export interface UpdateParcelDto {
  name?: string;
}

@Injectable({ providedIn: 'root' })
export class ParcelService extends BaseService {
  protected getResourcePath(): string {
    return 'parcels';
  }

  list(): Observable<Parcel[]> {
    return this.get<Parcel[]>();
  }

  one(id: string): Observable<Parcel> {
    return this.get<Parcel>(id);
  }

  update(id: string, body: UpdateParcelDto): Observable<Parcel> {
    return this.post<Parcel>(`${id}/update`, body);
  }

  /** Reaches `POST …/parcels/:id/delete` through the base. */
  remove(id: string): Observable<void> {
    return this.delete(id);
  }

  stop(id: string): Observable<Parcel> {
    return this.postAction<Parcel>(`${id}/stop`, {});
  }

  search(term: string): Observable<Parcel[]> {
    return this.getWithParams<Parcel[]>('search', { term });
  }
}
