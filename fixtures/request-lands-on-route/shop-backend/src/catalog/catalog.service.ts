import { Injectable } from '@nestjs/common';

export interface CatalogGroup {
  name: string;
  items: string[];
}

/** Named like the front end's client on purpose: one class name in two services. */
@Injectable()
export class CatalogService {
  grouped(storeId: string): CatalogGroup[] {
    return [{ name: storeId, items: [] }];
  }

  item(storeId: string, itemId: string): string {
    return `${storeId}:${itemId}`;
  }
}
