import { Injectable } from '@nestjs/common';

export interface ShipmentDto {
  id: string;
  status: string;
}

/**
 * Where a parcel is, asked of a carrier picked by name.
 *
 * The method is chosen at run time, so the reading cannot see past it: a gap
 * this revision added, in a method this revision changed.
 */
@Injectable()
export class ShipmentsService {
  private readonly carriers: Record<string, (id: string) => Promise<ShipmentDto>> = {
    post: async (id) => ({ id, status: 'packed' }),
  };

  async track(id: string, carrier: string): Promise<ShipmentDto> {
    return this.carriers[carrier](id);
  }
}
