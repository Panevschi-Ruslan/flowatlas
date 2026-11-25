import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

import type { CatalogMessage, PriceChangedEvent } from './catalog-events';

/** The back office's handlers of the catalog channel, each marked as a consumer of it; neither reads the type. */
@Injectable()
export class CatalogHandlers {
  @Consumes('catalog_events')
  onPriceChanged(event: PriceChangedEvent): string {
    return `${event.sku} now ${event.price}`;
  }

  /** Every other message: its parameter says no type; the relay's last else hands it the rest. */
  @Consumes('catalog_events')
  onCatalogEvent(event: CatalogMessage): string {
    return `${event.sku}: ${event.reason}`;
  }
}
