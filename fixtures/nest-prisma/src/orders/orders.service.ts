import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // The model is the property the call was made on, not a type argument:
  // table "order", operation read.
  findAll(): Promise<Order[]> {
    return this.prisma.order.findMany();
  }

  findOne(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  create(userId: string): Promise<Order> {
    return this.prisma.order.create({ data: { userId, total: 0, status: 'new' } });
  }

  remove(id: string): Promise<Order> {
    return this.prisma.order.delete({ where: { id } });
  }

  // A different property means a different table: "user", operation write.
  touchUser(id: string): Promise<unknown> {
    return this.prisma.user.update({ where: { id }, data: {} });
  }

  // Everything inside runs against the same client; the transaction wrapper
  // itself is not a query.
  async settle(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'paid' } });
    });
  }
}
