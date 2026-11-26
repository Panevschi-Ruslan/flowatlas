import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import axios from 'axios';

/** An instance whose interceptor sets the tenant on every request made through it (P265). */
const catalog = axios.create();
catalog.interceptors.request.use((config) => {
  config.headers['X-Tenant'] = 'north';
  return config;
});

/**
 * The server's requests carry the headers their client adds (P265): an
 * interceptor on an instance, and the framework's client configured in the
 * module (`HttpModule.register({ headers })`).
 */
@Injectable()
export class CatalogTenant {
  constructor(private readonly http: HttpService) {}

  /** The tenant the interceptor sets reaches `products.browse`: agrees. */
  browse(page: string) {
    return catalog.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/browse`, { params: { category: 'tea', page } });
  }

  /** Through the framework's client, the tenant written where the module configures it: agrees. */
  browseShared(page: string) {
    return this.http.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/browse`, { params: { category: 'tea', page } });
  }

  /** The count `products.page` answers in a header, read off the answer: agrees. */
  async total(category: string) {
    const res = await catalog.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/page`, { params: { category } });
    return Number(res.headers['x-total']);
  }
}
