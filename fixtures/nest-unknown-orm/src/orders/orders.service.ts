import { Injectable } from '@nestjs/common';
import { Repo, SchemaDb } from 'fake-orm';
import type { Order } from './order.js';
import { JobBus } from './jobs.js';
import { OrdersRepository } from './orders.repository.js';
import type { DB } from './schema.js';
import { VideoModel } from './video.model.js';

@Injectable()
export class OrdersService {
  // Typed by a package with no descriptor. That the receiver is a data layer is
  // readable; which of its methods read and which write is not, and neither is
  // the table, because nothing here says what the package's type parameter is.
  // Expected: no table, op null, heuristic, unknown-db-package.
  private readonly orderRepo = new Repo<Order>();

  // A connection typed by the whole schema. The type argument is `DB`, which is
  // every table at once, and the table is the string argument of the call.
  // Expected: no table, one unknown-db-package row — and emphatically no
  // `table:…#DB` node for 400 queries to point at (R83).
  private readonly db = new SchemaDb<DB>();

  constructor(
    private readonly localRepo: OrdersRepository,
    private readonly videos: VideoModel,
    private readonly jobRepository: JobBus,
  ) {}

  listFromLibrary(): Promise<Order[]> {
    return this.orderRepo.find();
  }

  store(order: Order): Promise<Order> {
    return this.orderRepo.persist(order);
  }

  listWidgets(): Promise<unknown[]> {
    return this.db.selectFrom('widgets');
  }

  // The first type argument of the base class is the library's own generic
  // helper, declared in node_modules and standing for nothing stored.
  // Expected: no table named `AttributesOnly`, one unknown-db-package row.
  listVideos(): Promise<unknown[]> {
    return this.videos.findAll();
  }

  // Nothing but the name suggests data access here.
  // Expected: no query node at all, one db-receiver-name-only row.
  listLocally(): Order[] {
    return this.localRepo.find();
  }

  // A job queue behind a name that ends in `Repository`. The name is the only
  // evidence, and a name is not evidence.
  // Expected: no query node at all, one db-receiver-name-only row.
  schedule(): void {
    this.jobRepository.enqueue('rebuild');
  }
}
