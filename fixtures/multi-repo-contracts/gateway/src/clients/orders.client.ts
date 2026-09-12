import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ContractIgnore } from '@flowatlas/markers';
import type { MoneyDto } from '@fx/wire';

import type { AddressDto, CreateOrderDto, OrderDto } from './dto';

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
}
