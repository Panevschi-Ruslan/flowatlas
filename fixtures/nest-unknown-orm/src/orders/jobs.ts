import { Injectable } from '@nestjs/common';

/**
 * A job queue, injected under a name that ends in `Repository`.
 *
 * Nothing here touches a database. The name is the whole of what suggested it
 * did, which is what a project that calls every adapter a repository does to a
 * reader that trusts names.
 */
@Injectable()
export class JobBus {
  enqueue(name: string): void {
    void name;
  }
}
