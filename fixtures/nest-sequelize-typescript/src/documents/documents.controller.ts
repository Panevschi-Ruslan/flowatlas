import { Controller, Delete, Get, Post } from '@nestjs/common';

import { DocumentsService } from './documents.service.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  findAll(): Promise<unknown[]> {
    return this.documents.withOwner();
  }

  @Post()
  create(): Promise<unknown> {
    return this.documents.create('a title');
  }

  @Delete()
  remove(): Promise<number> {
    return this.documents.remove('1');
  }
}
