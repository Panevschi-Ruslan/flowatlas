import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Clients handed out by a method rather than held in a field (P277). Each
 * method writes what it returns, and that is what a call of it is read as:
 * where the call's value is kept in a name, and where the query is written on
 * the call itself.
 */
export class ClientFactory {
  private shared?: PrismaService;

  client(): PrismaService {
    this.shared ??= new PrismaService();
    return this.shared;
  }
}

export class Registry {
  private static one?: Registry;

  static get(): Registry {
    Registry.one ??= new Registry();
    return Registry.one;
  }

  async db(): Promise<PrismaService> {
    return new ClientFactory().client();
  }
}

export class CouponAudit {
  constructor(private readonly factory: ClientFactory) {}

  /** The query written on the call that hands the client out. */
  issuedTo(issuedTo: string) {
    return this.factory.client().coupon.findMany({ where: { issuedTo } });
  }

  /** The client kept from an awaited method of a registry. */
  async issued(): Promise<number> {
    const db = await Registry.get().db();
    return db.coupon.count();
  }
}
