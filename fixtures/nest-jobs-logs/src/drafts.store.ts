import { Injectable, Logger } from '@nestjs/common';

const logger = new Logger('DraftsStore');

@Injectable()
export class DraftsStore {
  private readonly drafts = new Map<string, number>();

  removeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    let count = 0;
    for (const [id, at] of this.drafts) {
      if (at >= cutoff) continue;
      this.drafts.delete(id);
      logger.debug({ id }, 'archived');
      count += 1;
    }
    if (count === 0) console.warn('no drafts older than ' + days + ' days');
    return count;
  }
}
