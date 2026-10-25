import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Carrier, Parcel } from './parcel.entity';

@Injectable()
export class ParcelsService {
  constructor(
    @InjectRepository(Parcel)
    private readonly parcels: Repository<Parcel>,
    @InjectRepository(Carrier)
    private readonly carriers: Repository<Carrier>,
  ) {}

  // Two reads per id: one likely N+1 row naming both, reached from three routes.
  async labelsFor(ids: string[]): Promise<string[]> {
    const labels: string[] = [];
    for (const id of ids) {
      const parcel = await this.parcels.findOne({ where: { id } });
      const carrier = await this.carriers.findOne({ where: { id: parcel.carrierId } });
      labels.push(`${carrier.name}: ${parcel.id}`);
    }
    return labels;
  }

  // One read per id through a method: likely N+1, reached from one route.
  statuses(ids: string[]): Promise<string[]> {
    return Promise.all(ids.map((id) => this.statusOne(id)));
  }

  async statusOne(id: string): Promise<string> {
    const parcel = await this.parcels.findOne({ where: { id } });
    return parcel.status;
  }
}
