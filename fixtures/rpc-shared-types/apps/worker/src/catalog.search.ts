import { Injectable } from '@nestjs/common';
import axios from 'axios';

const Q = 'q';
const LIMIT = 'limit';

/**
 * A wrapper that writes a key of its own beside the ones its caller hands
 * it (P258): the request is its caller's, and carries both.
 */
@Injectable()
export class CatalogSearch {
  tea() {
    return this.search('/api/search', { q: 'tea' });
  }

  /** The address built with `+` after its `?`, the query's keys held in constants (P262). */
  green() {
    const query = new URLSearchParams({ [Q]: 'green' });
    query.set(LIMIT, '5');
    return axios.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/search?` + query.toString());
  }

  /** Headers handed in by a name: the tenant they may carry is not compared (P262). */
  browse(headers: Record<string, string>) {
    return axios.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/browse`, { params: { category: 'tea', page: '1' }, headers });
  }

  private search(path: string, params: Record<string, string>) {
    return axios.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}${path}`, { params: { ...params, limit: '50' } });
  }
}
