import { prisma } from '../db';

// A test's helper, named like any module, in a directory only tests live in.
// It is part of the test, and the test is not read.
export const seedOrders = async (count: number) =>
  prisma.order.createMany({ data: Array.from({ length: count }, () => ({ ownerId: 'u1', draft: true })) });
