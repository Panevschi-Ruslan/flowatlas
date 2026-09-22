import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ContractIgnore } from '@flowatlas/markers';
import type { MoneyDto } from '@fx/wire';

import type { AddressDto, CreateOrderDto, DraftDto, DraftResultDto, OrderDto } from './dto';

/**
 * Every call this fixture measures, aimed at `orders` through `ORDERS_URL`.
 *
 * The base URL is what ties them to a repository: `flowatlas.config.json` lists
 * it in `services[orders].baseUrlEnv`, so the linker knows whose routes to look
 * in, and only then is there a boundary to check.
 */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** The four kinds of finding at once, on the request half of one call. */
  create(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders`, body);
  }

  /** `total` is a number over there and text here: the response half fails. */
  fetchOne(id: string): { data: unknown } {
    return this.http.get<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/${id}`);
  }

  /** Both ends import the declaration, so nothing can drift: `shared`. */
  price(body: MoneyDto): { data: unknown } {
    return this.http.post<MoneyDto>(`${this.config.get('ORDERS_URL')}/orders/prices`, body);
  }

  /** Two declarations, one shape, so the hashes agree: `identical`. */
  address(body: AddressDto): { data: unknown } {
    return this.http.post<AddressDto>(`${this.config.get('ORDERS_URL')}/orders/addresses`, body);
  }

  /**
   * An object written at the call site: only what it writes is sent (R34).
   *
   * The parameter of `post` permits every field of `DraftDto` and this call
   * writes one of them. Expected: no finding at all — not one about `owner`,
   * and not one about `archived`.
   */
  draftWritten(): { data: unknown } {
    return this.http.post<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts`, {
      title: 'first',
    });
  }

  /**
   * The same call with the body handed in by name.
   *
   * Nothing written down says which keys are there, so the declared type is all
   * there is and the findings have to say so. Expected: `owner` and `archived`
   * as `extra_field`, worded as a permission rather than as an act.
   */
  draftDeclared(body: DraftDto): { data: unknown } {
    return this.http.post<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts`, body);
  }

  /**
   * A wider object spread into a literal, which really does send its keys.
   *
   * Expected: `owner`, `archived` and `extra` as `extra_field`, worded as an
   * act — a spread is not a permission, it is a copy.
   */
  draftSpread(base: DraftDto): { data: unknown } {
    return this.http.post<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts`, {
      ...base,
      extra: 1,
    });
  }

  /**
   * The caller requires `title`, and the handler puts it on one of two shapes.
   *
   * Expected: `missing_required title` on the response half, with a note saying
   * it is on one of the two shapes and naming the one it is not on (R32).
   */
  fetchDraft(id: string): { data: unknown } {
    return this.http.get<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts/${id}`);
  }

  /**
   * The same drift as `create`, deliberately.
   *
   * The annotation says so out loud, so every finding on this call is kept and
   * listed separately rather than counted as an error. Removing the annotation
   * is what turns them back into errors, which is the only honest way to run a
   * check nobody can fix today.
   */
  @ContractIgnore()
  legacy(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/legacy`, body);
  }

  /**
   * A field the receiver strips that the document behind it declares (R30).
   *
   * `note` is on `DraftSchema` and not on `CreateDraftDto`, and the handler
   * writes that document. Expected: `impact: stored`.
   */
  storeDraft(): { data: unknown } {
    return this.http.post<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts/store`, {
      title: 'first',
      note: 'keep me',
    });
  }

  /**
   * A field the receiver strips that nothing it writes declares.
   *
   * Expected: `impact: unknown` — a warning like the one above, below it.
   */
  tagDraft(): { data: unknown } {
    return this.http.post<DraftResultDto>(`${this.config.get('ORDERS_URL')}/orders/drafts/tag`, {
      title: 'first',
      colour: 'red',
    });
  }

  /**
   * The same strip on a handler that reaches no write at all.
   *
   * Expected: `impact: none`, at `info`, counted rather than listed.
   */
  previewDraft(): { data: unknown } {
    return this.http.post<DraftResultDto>(
      `${this.config.get('ORDERS_URL')}/orders/drafts/preview`,
      { title: 'first', note: 'keep me' },
    );
  }
}
