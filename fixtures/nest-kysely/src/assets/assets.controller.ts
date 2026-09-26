import { Controller, Delete, Get, Post } from '@nestjs/common';

import { AssetsService } from './assets.service.js';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  findAll(): Promise<unknown[]> {
    return this.assets.findAll();
  }

  @Post()
  create(): Promise<unknown[]> {
    return this.assets.create('1');
  }

  @Delete()
  remove(): Promise<unknown[]> {
    return this.assets.remove('1');
  }
}
