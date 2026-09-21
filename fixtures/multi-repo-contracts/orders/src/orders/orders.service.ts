import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import type { MoneyDto } from '@fx/wire';

import type { DraftSchema } from './draft.entity';
import type {
  AddressDto,
  CreateDraftDto,
  CreateOrderDto,
  LockedDraftDto,
  OrderCreatedEvent,
  OrderDto,
} from './dto';

/** Answers the routes and publishes the one event the fixture pairs up. */
@Injectable()
export class OrdersService {
  constructor(
    @Inject('EVENTS_CLIENT')
    private readonly events: ClientProxy,
    @InjectRepository(Object)
    private readonly drafts: Repository<DraftSchema>,
  ) {}

  /** Writes the document, so a field its schema declares is worth attention. */
  async storeDraft(body: CreateDraftDto): Promise<CreateDraftDto> {
    await this.drafts.save(body as unknown as DraftSchema);
    return body;
  }

  /** Reads, answers, and persists nothing: no strip here can lose data. */
  async previewDraft(body: CreateDraftDto): Promise<CreateDraftDto> {
    return body;
  }

  async findOne(id: string): Promise<OrderDto> {
    return { id, total: 0, placedAt: new Date() };
  }

  async price(body: MoneyDto): Promise<MoneyDto> {
    return body;
  }

  async address(body: AddressDto): Promise<AddressDto> {
    return body;
  }

  async draft(body: CreateDraftDto): Promise<CreateDraftDto> {
    return body;
  }

  async readDraft(id: string): Promise<CreateDraftDto | LockedDraftDto> {
    return id === '' ? { draft: { title: 'x' }, lockedBy: 'nobody' } : { title: id };
  }

  /**
   * The publisher of `order.created`.
   *
   * `billing` handles the same channel with a shape of its own, so the payload
   * direction of that pair is where a channel contract is checked.
   */
  async create(body: CreateOrderDto): Promise<OrderDto> {
    const event: OrderCreatedEvent = {
      orderId: body.customerId,
      total: body.total,
      placedAt: new Date(),
    };
    this.events.emit('order.created', event);
    return { id: body.customerId, total: body.total.amount, placedAt: event.placedAt };
  }
}
