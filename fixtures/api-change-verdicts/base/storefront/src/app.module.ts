import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogClient } from './catalog.client';
import { ShopController } from './shop.controller';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  controllers: [ShopController],
  providers: [CatalogClient],
})
export class AppModule {}
