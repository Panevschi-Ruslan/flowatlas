import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Region } from './parcel.entity';

@Injectable()
export class RegionSeed {
  constructor(
    @InjectRepository(Region)
    private readonly regions: Repository<Region>,
  ) {}

  // A list written out in the code: bounded, a literal.
  async seed(): Promise<void> {
    for (const region of ['north', 'south']) {
      await this.regions.save({ name: region });
    }
  }
}
