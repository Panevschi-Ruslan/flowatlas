import { Injectable } from '@nestjs/common';
import prisma, { prisma as client } from '@acme/db';

/**
 * The client imported from the repository's own Prisma wrapper, both ways it is
 * exported. `@acme/db` is a workspace package and nothing links it, so the
 * import does not resolve: the reader follows the name into the package's own
 * entry file, where it is declared as a `PrismaClient` out of the directory the
 * schema generates.
 */
@Injectable()
export class UsersService {
  findAll(): Promise<unknown[]> {
    return prisma.user.findMany();
  }

  place(userId: string): Promise<unknown> {
    return client.order.create({ data: { userId } });
  }
}
