import { Module } from '@nestjs/common';
import { AssetsController } from './assets/assets.controller.js';
import { AssetsService } from './assets/assets.service.js';

@Module({ controllers: [AssetsController], providers: [AssetsService] })
export class AppModule {}
