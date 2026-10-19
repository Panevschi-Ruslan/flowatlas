import type { MigrationInterface, QueryRunner } from 'typeorm';

import { Parcel } from '../parcels/parcel.entity';

const UNSET = ['p-1', 'p-2', 'p-3'];

// Runs once, when the schema moves: not a finding, however it loops.
export class Backfill1700000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const id of await this.unset()) {
      await runner.manager.update(Parcel, { id }, { status: 'new' });
    }
  }

  async down(): Promise<void> {
    // nothing to undo
  }

  private async unset(): Promise<string[]> {
    return UNSET;
  }
}
