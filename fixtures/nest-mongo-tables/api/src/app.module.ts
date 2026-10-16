import { Module } from '@nestjs/common';
import { AuditRepository } from './audit/audit.repository.js';
import { MongoConnection } from './db/connection.js';
import { ProductRepository } from './catalog/product.repository.js';
import { OrdersRepository } from './orders/orders.repository.js';
import { OrdersService } from './orders/orders.service.js';
import { Migrations } from './db/migrations.js';

@Module({
  providers: [MongoConnection, OrdersRepository, ProductRepository, AuditRepository, OrdersService, Migrations],
})
export class AppModule {}
