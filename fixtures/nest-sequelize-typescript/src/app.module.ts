import { Module } from '@nestjs/common';
import { DocumentsController } from './documents/documents.controller.js';
import { DocumentsService } from './documents/documents.service.js';

@Module({ controllers: [DocumentsController], providers: [DocumentsService] })
export class AppModule {}
