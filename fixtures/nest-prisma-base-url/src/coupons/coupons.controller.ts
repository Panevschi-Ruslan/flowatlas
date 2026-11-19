import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from 'src/guards/api-token.guard';
import { CouponsService } from './coupons.service';

@Controller('coupons')
@UseGuards(ApiTokenGuard)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list(): Promise<unknown> {
    return this.coupons.list('u1')();
  }

  @Post()
  issue(): Promise<unknown> {
    return this.coupons.issue('u1');
  }

  @Delete(':code')
  revoke(@Param('code') code: string): Promise<unknown> {
    return this.coupons.revoke(code);
  }
}
