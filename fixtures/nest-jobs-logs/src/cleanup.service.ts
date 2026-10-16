import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DraftsStore } from './drafts.store';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly drafts: DraftsStore) {}

  @Cron('0 3 * * *', { name: 'nightly-cleanup', timeZone: 'Europe/Paris' })
  nightly(): void {
    this.logger.log('cleanup started');
    try {
      const count = this.drafts.removeOlderThan(30);
      this.logger.log(`removed ${count} drafts`);
    } catch (err) {
      this.logger.error(err);
    }
  }
}
