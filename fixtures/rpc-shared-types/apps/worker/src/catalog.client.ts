import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * A plain request from a server to the catalog's REST route for
 * `products.list`: its query written in the options' `params`. `limit` is
 * missing.
 */
@Injectable()
export class CatalogClient {
  teas() {
    return axios.get<Array<{ id: string; name: string }>>(`${process.env.CATALOG_URL}/api/products`, { params: { category: 'tea' } });
  }
}
