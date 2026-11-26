import { PrismaService } from 'src/prisma/prisma.service';

/**
 * One client kept for code that runs before the container exists, the way a
 * start-up step reads its settings. The function writes what it returns, and
 * that is what `prisma` below holds.
 */
let shared: PrismaService | undefined;

function sharedPrisma(): PrismaService {
  shared ??= new PrismaService();
  return shared;
}

export async function codesInUse(): Promise<string[]> {
  const prisma = sharedPrisma();
  const coupons = await prisma.coupon.findMany();
  return coupons.map((coupon) => coupon.code);
}
