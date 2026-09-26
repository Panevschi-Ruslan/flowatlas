import { Injectable } from '@nestjs/common';
import { prisma, readonlyPrisma, type Order } from '@acme/db';

/**
 * Every query goes through a workspace package rather than the library, which is
 * how cal.com reaches its database and how a great many monorepos do.
 *
 * No file here imports `@prisma/client`, and nothing names the wrapper as a data
 * layer. What makes the queries readable is that the wrapper hands on the
 * library's own types: the receiver of each call is a delegate the library
 * declares, so the descriptor is found under the library's name without the
 * wrapper's name appearing anywhere in this tool.
 */
@Injectable()
export class OrdersService {
  findAll(): Promise<Order[]> {
    return prisma.order.findMany();
  }

  findOne(id: string): Promise<Order | null> {
    return prisma.order.findUnique({ where: { id } });
  }

  create(userId: string): Promise<Order> {
    return prisma.order.create({ data: { userId, total: 0, status: 'new' } });
  }

  remove(id: string): Promise<Order> {
    return prisma.order.delete({ where: { id } });
  }

  // A second client out of the same wrapper, pointed at a replica. It is the
  // same tables read through another connection.
  report(): Promise<Order[]> {
    return readonlyPrisma.order.findMany();
  }

  touchUser(id: string): Promise<unknown> {
    return prisma.user.update({ where: { id }, data: {} });
  }
}
