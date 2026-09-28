import { Module } from '@nestjs/common';
import { InventoryLevelRepository } from './inventory/inventory-level.repository.js';

@Module({ providers: [InventoryLevelRepository] })
export class AppModule {}
