import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * The publisher. One channel per workspace carries every kind of message about
 * it, told apart by `type`; a second channel per warehouse carries the parcels
 * it has to pack.
 */
@Injectable()
export class ParcelsService {
  private readonly bus: RedisClientType = createClient();

  async markPacked(workspaceId: string, parcelId: string): Promise<void> {
    await this.bus.publish(`workspace:${workspaceId}:events`, JSON.stringify({ type: 'PARCEL_PACKED', parcelId }));
  }

  async assignCourier(workspaceId: string, parcelId: string, courierId: string): Promise<void> {
    await this.bus.publish(`workspace:${workspaceId}:events`, JSON.stringify({ type: 'COURIER_ASSIGNED', parcelId, courierId }));
  }

  async queueForPacking(warehouseId: string, parcelId: string): Promise<void> {
    await this.bus.publish(`warehouse:${warehouseId}:parcels`, JSON.stringify({ parcelId }));
  }
}
