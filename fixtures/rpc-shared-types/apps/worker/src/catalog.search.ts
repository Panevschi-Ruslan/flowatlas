import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * A wrapper that writes a key of its own beside the ones its caller hands
 * it (P258): the request is its caller's, and carries both.
 */
@Injectable()
export class CatalogSearch {
  tea() {
    return this.search('/api/search', { q: 'tea' });
  }

  private search(path: string, params: Record<string, string>) {
    return axios.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}${path}`, { params: { ...params, limit: '50' } });
  }
}
