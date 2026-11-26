import { Module } from '@nestjs/common';
import { CouponsModule } from 'src/coupons/coupons.module';

@Module({ imports: [CouponsModule] })
export class AppModule {}
