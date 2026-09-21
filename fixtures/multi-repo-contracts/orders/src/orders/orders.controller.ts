import { Body, Controller, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { MoneyDto } from '@fx/wire';

import { AddressDto, CreateDraftDto, CreateOrderDto, LockedDraftDto, OrderDto } from './dto';
import { OrdersService } from './orders.service';

/** The far end of every call the gateway makes. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The four kinds of finding at once, all on one body. */
  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  /** `total` is a number here and text on the caller: `type_mismatch`. */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    return this.orders.findOne(id);
  }

  /**
   * Both ends import `MoneyDto` from the shared package, so neither owns the
   * declaration and drift is impossible: `shared`, and no field is walked.
   */
  @Post('prices')
  price(@Body() body: MoneyDto): Promise<MoneyDto> {
    return this.orders.price(body);
  }

  /**
   * Two declarations, one shape. The hashes agree, so `identical`, and again no
   * field is walked — which is what keeps a project with honest copies cheap.
   */
  @Post('addresses')
  address(@Body() body: AddressDto): Promise<AddressDto> {
    return this.orders.address(body);
  }

  /**
   * One route, three callers, three different bodies (R34).
   *
   * Declares `title` and nothing else, so what each caller is reported as
   * sending is decided by what that caller writes rather than by the type it
   * declares.
   */
  @Post('drafts')
  draft(@Body() body: CreateDraftDto): Promise<CreateDraftDto> {
    return this.orders.draft(body);
  }

  /**
   * One handler, two shapes, and a caller that requires a field on only one of
   * them (R34's neighbour, R32).
   *
   * The ordinary path answers with the draft; the locked path answers with a
   * wrapper. `title` is on the first and not on the second, so the finding is
   * real and the sentence has to say which shape it is about.
   */
  @Get('drafts/:id')
  readDraft(@Param('id') id: string): Promise<CreateDraftDto | LockedDraftDto> {
    return this.orders.readDraft(id);
  }

  /** The caller annotates its side with `@ContractIgnore`, so this drift is excused. */
  @Post('legacy')
  legacy(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  /**
   * Three strips, three things they can cost (R30).
   *
   * All three whitelist, all three declare `title` and nothing else, and what
   * separates them is what the handler behind each one does. `store` writes a
   * document whose schema declares `note`, so a `note` thrown away is data the
   * sender believes it saved. `tag` writes the same document, which declares
   * no `colour`, so that strip loses nothing anybody can name. `preview`
   * writes nothing at all and cannot lose anything by construction.
   */
  @Post('drafts/store')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  storeDraft(@Body() body: CreateDraftDto): Promise<CreateDraftDto> {
    return this.orders.storeDraft(body);
  }

  @Post('drafts/tag')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  tagDraft(@Body() body: CreateDraftDto): Promise<CreateDraftDto> {
    return this.orders.storeDraft(body);
  }

  @Post('drafts/preview')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  previewDraft(@Body() body: CreateDraftDto): Promise<CreateDraftDto> {
    return this.orders.previewDraft(body);
  }
}
