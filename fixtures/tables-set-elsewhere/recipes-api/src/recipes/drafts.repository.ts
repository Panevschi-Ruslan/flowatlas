import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';
import { MongoConnection } from '../db/connection.js';
import { SettingsService } from '../settings/settings.service.js';

export interface Draft { _id: string; title: string }

/** The table chosen at run time, from settings: a gap that names this class. */
@Injectable()
export class DraftsRepository extends BaseRepository<Draft> {
  protected readonly collectionName = this.settings.valueOf('drafts.collection');

  constructor(mongo: MongoConnection, private readonly settings: SettingsService) {
    super(mongo);
  }
}
