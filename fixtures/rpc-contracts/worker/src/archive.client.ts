import { Injectable } from '@nestjs/common';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

/**
 * A client of a service this project does not configure: ARCHIVE_URL is
 * claimed by nobody, and the example environment gives it a host of the
 * shop's own domain, which is evidence of a repository that is not here.
 */
@Injectable()
export class ArchiveClient {
  private readonly archive = createORPCClient<any>(new RPCLink({ url: `${process.env.ARCHIVE_URL}/rpc` }));

  store(orderId: string) {
    return this.archive.orders.store({ orderId });
  }
}
