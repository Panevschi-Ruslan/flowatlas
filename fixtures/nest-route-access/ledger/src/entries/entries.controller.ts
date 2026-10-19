import { Body, Controller, Get, Post } from '@nestjs/common';

import { SkipApiKey } from '../auth/skip-api-key.decorator';
import { LedgerEntry } from './entry.entity';
import { EntriesService } from './entries.service';

@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  /** Behind the global `ApiKeyGuard`: no row. */
  @Get()
  all(): Promise<LedgerEntry[]> {
    return this.entries.all();
  }

  /**
   * `@SkipApiKey()` sets a flag `ApiKeyGuard` reads: the guard is switched off
   * here by decision. Expected: `route-guard-skipped`, at `info`.
   */
  @Post('webhook')
  @SkipApiKey()
  webhook(@Body() entry: LedgerEntry): Promise<LedgerEntry> {
    return this.entries.record(entry);
  }
}
