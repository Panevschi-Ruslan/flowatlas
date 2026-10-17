import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Parcel } from './parcel.entity';

const MAX_ATTEMPTS = 3;

@Injectable()
export class ParcelRetry {
  constructor(
    @InjectRepository(Parcel)
    private readonly parcels: Repository<Parcel>,
  ) {}

  // Tried at most three times, and left as soon as it works: bounded, a retry.
  async markDelivered(id: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await this.parcels.save({ id, status: 'delivered' });
        break;
      } catch {
        // tried again
      }
    }
  }
}
