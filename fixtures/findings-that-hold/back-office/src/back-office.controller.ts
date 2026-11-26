import { Body, Controller, Post } from '@nestjs/common';
import { StoresClient, type StoreDraft } from './stores.client';

@Controller('admin')
export class BackOfficeController {
  constructor(private readonly stores: StoresClient) {}

  @Post('stores')
  create(@Body() draft: StoreDraft): Promise<unknown> {
    return this.stores.create(draft);
  }
}
