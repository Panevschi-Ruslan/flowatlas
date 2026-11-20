import { Body, Controller, Param, Post } from '@nestjs/common';
import { ParcelsService } from './parcels.service';

@Controller('workspaces/:workspaceId/parcels')
export class ParcelsController {
  constructor(private readonly parcels: ParcelsService) {}

  @Post(':parcelId/packed')
  packed(@Param('workspaceId') workspaceId: string, @Param('parcelId') parcelId: string): Promise<void> {
    return this.parcels.markPacked(workspaceId, parcelId);
  }

  @Post(':parcelId/courier')
  courier(
    @Param('workspaceId') workspaceId: string,
    @Param('parcelId') parcelId: string,
    @Body() body: { courierId: string },
  ): Promise<void> {
    return this.parcels.assignCourier(workspaceId, parcelId, body.courierId);
  }

  @Post(':parcelId/queue/:warehouseId')
  queue(@Param('warehouseId') warehouseId: string, @Param('parcelId') parcelId: string): Promise<void> {
    return this.parcels.queueForPacking(warehouseId, parcelId);
  }
}
