import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { LedgerEntry } from './entry.entity';

@Injectable()
export class EntriesService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly entries: Repository<LedgerEntry>,
  ) {}

  all(): Promise<LedgerEntry[]> {
    return this.entries.find();
  }

  record(entry: LedgerEntry): Promise<LedgerEntry> {
    return this.entries.save(entry);
  }
}
