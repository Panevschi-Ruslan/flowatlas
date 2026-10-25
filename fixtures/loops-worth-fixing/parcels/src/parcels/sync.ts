import { Injectable } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { InjectRepository, Repository } from 'typeorm';

import { Parcel } from './parcel.entity';

const PAGE_SIZE = 100;

@Injectable()
export class ParcelSync {
  private readonly db = new MongoClient('mongodb://localhost:27017').db('parcels');

  constructor(
    @InjectRepository(Parcel)
    private readonly parcels: Repository<Parcel>,
  ) {}

  // A page at a time until a short one: bounded by its pages.
  async syncAll(): Promise<number> {
    let seen = 0;
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await this.parcels.find({ skip, take: PAGE_SIZE });
      seen += page.length;
      skip += PAGE_SIZE;
      hasMore = page.length === PAGE_SIZE;
    }
    return seen;
  }

  // On from where the last page stopped: bounded by its cursor.
  async syncScans(): Promise<number> {
    let seen = 0;
    let token: string | undefined;
    do {
      const page = await this.db.collection('scans').find({ NextToken: token }).toArray();
      seen += page.length;
      token = page.length === 0 ? undefined : String(page[page.length - 1]['NextToken']);
    } while (token);
    return seen;
  }
}
