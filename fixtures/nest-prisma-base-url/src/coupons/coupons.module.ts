import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApiTokenGuard } from 'src/guards/api-token.guard';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({ controllers: [CouponsController], providers: [CouponsService, PrismaService, ApiTokenGuard] })
export class CouponsModule {}
