import { Injectable } from '@nestjs/common';
import { ArchiveHelper } from './archive-helper';

/** Nothing injects or makes this class and nothing calls its method: `run` is dead, the end of a chain no unread call reaches. */
@Injectable()
export class LegacyExport {
  constructor(private readonly archive: ArchiveHelper) {}

  async run(): Promise<void> {
    await this.archive.copyStatus('1');
  }
}
