import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, InjectRepository, Repository } from 'typeorm';

import { Parcel } from './parcel.entity';

@Injectable()
export class ParcelHandover {
  constructor(
    private readonly dataSource: DataSource,
    private readonly manager: EntityManager,
    @InjectRepository(Parcel)
    private readonly parcels: Repository<Parcel>,
  ) {}

  // A guarded raw update per parcel through a query runner: a note, per item on purpose.
  async releaseAll(ids: string[]): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    for (const id of ids) {
      await runner.query('UPDATE parcels SET status = $1 WHERE id = $2 AND status = $3', ['released', id, 'held']);
    }
  }

  // A guarded update per parcel through the manager, its criteria after the class: a note.
  async holdAll(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.manager.update(Parcel, { id, status: 'open' }, { status: 'held' });
    }
  }

  // One statement per group, each taking the whole group: set aside, a batch.
  async countGroups(groups: string[][]): Promise<number> {
    let total = 0;
    for (const group of groups) {
      const rows = await this.manager.query('SELECT count(*) AS n FROM parcels WHERE id = ANY($1)', [group]);
      total += rows.length;
    }
    return total;
  }

  // A raw read per id, joined to its carrier: likely N+1, naming both tables.
  async withCarriers(ids: string[]): Promise<unknown[]> {
    const found: unknown[] = [];
    for (const id of ids) {
      found.push(await this.parcels.query('SELECT p.id, c.name FROM parcels p JOIN carriers c ON c.id = p.carrier_id WHERE p.id = $1', [id]));
    }
    return found;
  }
}
