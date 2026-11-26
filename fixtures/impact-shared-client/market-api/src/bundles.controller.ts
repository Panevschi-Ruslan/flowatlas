import { Controller, Delete, Param } from '@nestjs/common';
import { EventsService } from './events.service';

/** An admin route that only tells the screens their items changed: it never calls `listByShop`. */
@Controller('api/admin/:shopId/bundles')
export class BundlesController {
  constructor(private readonly events: EventsService) {}

  @Delete(':bundleId')
  async remove(@Param('shopId') shopId: string, @Param('bundleId') bundleId: string): Promise<void> {
    void bundleId;
    await this.events.itemsChanged(shopId);
  }
}
