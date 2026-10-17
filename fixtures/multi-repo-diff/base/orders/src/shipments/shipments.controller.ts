import { Controller, Get, Param } from '@nestjs/common';

import type { ShipmentDto } from './shipments.service';
import { ShipmentsService } from './shipments.service';

/**
 * The route the gateway asks where an order's parcel is.
 *
 * The head revision renames it, and nobody tells the gateway: its request
 * still asks for the old path, joins nothing, and the diff has to say so.
 */
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get(':id')
  track(@Param('id') id: string): Promise<ShipmentDto> {
    return this.shipments.track(id);
  }
}
