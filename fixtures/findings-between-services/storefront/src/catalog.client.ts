import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallsService } from '@flowatlas/markers';
import { firstValueFrom } from 'rxjs';

/** The storefront's client of the catalog, through `CATALOG_API_URL`. */
@Injectable()
export class CatalogClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return this.config.get('CATALOG_API_URL');
  }

  async product(id: string): Promise<unknown> {
    return (await firstValueFrom(this.http.get(`${this.config.get('CATALOG_API_URL')}/products/${id}`))).data;
  }

  /** The catalog calls this `publish`: `POST /products/:id/release` is no route of it. */
  async release(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.config.get('CATALOG_API_URL')}/products/${id}/release`, {}));
  }

  /** Sends `productName`; the catalog's handler reads `name`. */
  async create(productName: string, priceCents: number): Promise<unknown> {
    return (await firstValueFrom(this.http.post(`${this.config.get('CATALOG_API_URL')}/products`, { productName, priceCents }))).data;
  }

  async stock(sku: string): Promise<number> {
    return (await firstValueFrom(this.http.get<number>(`${this.config.get('CATALOG_API_URL')}/stock/${sku}`))).data;
  }

  /** The address is built at run time; the annotation names a route the catalog does not serve. */
  @CallsService('catalog-api', 'GET /products/:id/reviews')
  async reviews(path: string): Promise<unknown> {
    return (await firstValueFrom(this.http.get(`${this.base()}${path}`))).data;
  }
}
