import { Injectable } from '@nestjs/common';

/** The method `impact` is asked about first: one route serves it. */
@Injectable()
export class ItemsService {
  listByShop(shopId: string): string[] {
    return [`${shopId}:tea`, `${shopId}:cake`];
  }
}
