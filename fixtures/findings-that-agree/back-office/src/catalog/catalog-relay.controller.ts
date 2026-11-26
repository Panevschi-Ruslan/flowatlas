import { Body, Controller, Post } from '@nestjs/common';

import { CatalogHandlers } from './catalog-handlers';
import type { CatalogMessage, PriceChangedEvent } from './catalog-events';

/** What a worker posts: every message of the catalog channel, a price change to its handler, the rest to the other. */
@Controller('events')
export class CatalogRelayController {
  constructor(private readonly handlers: CatalogHandlers) {}

  @Post('catalog')
  relay(@Body() body: { message: CatalogMessage }): string {
    const event = body.message;
    if (event.type === 'PRICE_CHANGED') {
      return this.handlers.onPriceChanged(event as unknown as PriceChangedEvent);
    } else {
      return this.handlers.onCatalogEvent(event);
    }
  }
}
