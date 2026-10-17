import { Injectable } from '@nestjs/common';

export interface ShipmentDto {
  id: string;
  status: string;
}

/** Where a parcel is. The head revision picks a carrier by name here. */
@Injectable()
export class ShipmentsService {
  async track(id: string): Promise<ShipmentDto> {
    return { id, status: 'packed' };
  }
}
