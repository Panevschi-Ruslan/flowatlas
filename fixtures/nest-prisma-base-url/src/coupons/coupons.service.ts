import { Injectable } from '@nestjs/common';
import * as TE from 'fp-ts/TaskEither';
import { PrismaService } from 'src/prisma/prisma.service';
import { Coupon as DbCoupon } from 'src/generated/prisma/client';
import type { CouponKind } from '@db/enums';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A query handed to a library's wrapper as a function, which is still this method's query. */
  list(issuedTo: string): TE.TaskEither<string, DbCoupon[]> {
    return TE.tryCatch(
      () => this.prisma.coupon.findMany({ where: { issuedTo } }),
      () => 'coupons/list-failed',
    );
  }

  async issue(issuedTo: string, kind: CouponKind = 'PERCENT'): Promise<DbCoupon> {
    return this.prisma.coupon.create({ data: { id: issuedTo, code: issuedTo, kind, issuedTo } });
  }

  async revoke(code: string): Promise<number> {
    const { count } = await this.prisma.coupon.deleteMany({ where: { code } });
    return count;
  }
}
