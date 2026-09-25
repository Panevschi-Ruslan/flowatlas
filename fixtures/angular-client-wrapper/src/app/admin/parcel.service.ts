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

export type LabelTarget = 'item' | 'category' | 'sticker';

export type LabelOrder = 'newest' | 'oldest';

/** A table the address reads: one of these three segments per run. */
const LABEL_PATH: Record<LabelTarget, string> = {
  item: 'parcels',
  category: 'categories',
  sticker: 'stickers',
};

/**
 * A table the address never reads. It says how the server sorts, and it is
 * here so that the count of requests is measurably wrong the moment a finite
 * set the address does not use is allowed to multiply the ones it does.
 */
const LABEL_ORDER: Record<LabelOrder, string> = {
  newest: 'desc',
  oldest: 'asc',
};

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

  /**
   * Three addresses, whichever way the server is asked to sort them.
   *
   * The body's table is a closed set like the path's, and it is passed through
   * the same wrapper call, so both are offered to the reader together.
   */
  label(target: LabelTarget, order: LabelOrder): Observable<void> {
    return this.post<void>(`labels/${LABEL_PATH[target]}`, { order: LABEL_ORDER[order] });
  }

  search(term: string): Observable<Parcel[]> {
    return this.getWithParams<Parcel[]>('search', { term });
  }
}
