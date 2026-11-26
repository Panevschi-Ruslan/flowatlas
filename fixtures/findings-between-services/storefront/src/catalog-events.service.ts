import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface CatalogEvent {
  type: string;
  productId?: string;
  productTitle?: string;
}

/**
 * What the storefront does with `catalog_events`. It reads `productTitle`,
 * which the catalog sends as `title`, and waits for `LISTING_CANCELED`,
 * which the catalog publishes as `LISTING_CANCELLED`.
 */
@Injectable()
export class CatalogEventsService {
  private readonly shelf = new Map<string, string>();

  @Consumes('catalog_events')
  onCatalogEvent(evt: CatalogEvent): void {
    switch (evt.type) {
      case 'PRODUCT_CREATED':
        this.shelf.set(evt.productId ?? '', evt.productTitle ?? '');
        return;
      case 'LISTING_CANCELED':
        this.shelf.delete(evt.productId ?? '');
        return;
      default:
        return;
    }
  }
}
