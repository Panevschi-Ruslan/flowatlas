import { Controller, Get, Param } from '@nestjs/common';

import type { ShipmentDto } from './shipments.service';
import { ShipmentsService } from './shipments.service';

/**
 * The route the gateway asks where an order's parcel is.
 *
 * Renamed in this revision, from `GET /shipments/:id` to
 * `GET /shipments/:id/status`. The gateway was not told: its request still
 * asks for the old path and now joins nothing.
 */
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get(':id/status')
  track(@Param('id') id: string): Promise<ShipmentDto> {
    return this.shipments.track(id, 'post');
  }
}
