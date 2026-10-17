import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ParcelDispatch } from './dispatch';
import { ParcelExport } from './export';
import { ParcelsService } from './parcels.service';
import { ParcelRetry } from './retry';
import { RegionSeed } from './seed';
import { ParcelSync } from './sync';

@Controller('parcels')
export class ParcelsController {
  constructor(
    private readonly parcels: ParcelsService,
    private readonly exports: ParcelExport,
    private readonly sync: ParcelSync,
    private readonly retry: ParcelRetry,
    private readonly seeds: RegionSeed,
    private readonly dispatch: ParcelDispatch,
  ) {}

  @Get('labels')
  labels(@Query('ids') ids: string[]): Promise<string[]> {
    return this.parcels.labelsFor(ids);
  }

  @Post('labels/print')
  print(@Body() ids: string[]): Promise<string[]> {
    return this.parcels.labelsFor(ids);
  }

  @Get('labels/preview')
  preview(@Query('ids') ids: string[]): Promise<string[]> {
    return this.parcels.labelsFor(ids);
  }

  @Get('statuses')
  statuses(@Query('ids') ids: string[]): Promise<string[]> {
    return this.parcels.statuses(ids);
  }

  @Post('export')
  exportAll(@Body() ids: string[]): Promise<void> {
    return this.exports.exportAll(ids);
  }

  @Post('export/groups')
  exportGroups(@Body() groups: string[][]): Promise<void> {
    return this.exports.exportGroups(groups);
  }

  @Post('sync')
  syncAll(): Promise<number> {
    return this.sync.syncAll();
  }

  @Post('sync/scans')
  syncScans(): Promise<number> {
    return this.sync.syncScans();
  }

  @Post(':id/delivered')
  delivered(@Param('id') id: string): Promise<void> {
    return this.retry.markDelivered(id);
  }

  @Post('regions/seed')
  seed(): Promise<void> {
    return this.seeds.seed();
  }

  @Post('claim')
  claim(@Body() ids: string[]): Promise<void> {
    return this.dispatch.claimAll(ids);
  }

  @Post('notify')
  notify(@Body() recipients: string[]): Promise<void> {
    return this.dispatch.notifyAll(recipients);
  }
}
