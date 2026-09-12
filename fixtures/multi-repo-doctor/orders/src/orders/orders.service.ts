import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ContractIgnore, Emits, FlowEntry } from '@flowatlas/markers';
import { Repo } from 'fake-orm';

import { channelFor } from './events';
import type { CreateOrderDto, Order, OrderDto } from './dto';

/**
 * Every way an `@Emits` can be right and every way it can be wrong.
 *
 * The four cases are the whole of what marker validation is: an annotation that
 * repeats what the code already says, one that says something the code does
 * not, one whose argument nothing could read, and one that is the only reason
 * the channel is knowable at all.
 */
@Injectable()
export class OrdersService {
  /** A data layer with no descriptor, for a reason with several rows. */
  private readonly rows = new Repo<Order>();

  constructor(
    @Inject('EVENTS_CLIENT')
    private readonly events: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  /**
   * The annotation the code has made redundant.
   * Expected: `marker-emits-shadowed`, a warning.
   */
  @Emits('order.created')
  async create(body: CreateOrderDto): Promise<OrderDto> {
    const row = await this.rows.persist({ id: body.id, total: body.total });
    this.events.emit('order.created', { id: row.id, total: row.total });
    return { id: row.id, total: row.total };
  }

  /**
   * The annotation that lies: nothing here publishes anything.
   * Expected: `marker-emits-without-emit`, an error.
   */
  @Emits('order.audited')
  async audit(id: string): Promise<void> {
    await this.rows.find({ id });
  }

  /**
   * The annotation whose argument is not a literal.
   * Expected: `marker-unknown-arg`, an error.
   */
  @Emits(channelFor('archived'))
  async archive(id: string): Promise<void> {
    await this.rows.drop(id);
  }

  /**
   * The annotation earning its place: the channel is read from settings, so
   * nothing static can name it, and the annotation is the only thing that can.
   * Expected: no marker issue, and a `channel-from-config` row at this method.
   */
  @Emits('order.refunded')
  async refund(id: string): Promise<void> {
    this.events.emit(this.config.get('REFUND_CHANNEL'), { id });
  }

  /**
   * An annotation naming a flow, on a method nothing enters the service through.
   * Expected: `marker-flowentry-not-handler`, a warning.
   */
  @FlowEntry('checkout')
  async settle(id: string): Promise<void> {
    await this.rows.find({ id });
  }

  /**
   * Drift excused on a method that is not on either end of any boundary.
   * Expected: `marker-contractignore-unused`, a warning.
   */
  @ContractIgnore()
  async reconcile(): Promise<Order[]> {
    return this.rows.find();
  }

  async findOne(id: string): Promise<OrderDto> {
    const [row] = await this.rows.find({ id });
    return { id: row.id, total: row.total };
  }
}
