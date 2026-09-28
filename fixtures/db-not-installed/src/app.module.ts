import { Module } from '@nestjs/common';

import { AssetsService } from './assets/assets.service.js';
import { DocumentsService } from './documents/documents.service.js';

@Module({ providers: [AssetsService, DocumentsService] })
export class AppModule {}
