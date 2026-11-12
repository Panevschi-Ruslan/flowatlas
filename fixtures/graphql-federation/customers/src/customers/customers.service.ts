import { Injectable, NotFoundException } from '@nestjs/common';

import type { Customer } from './customer.model';

@Injectable()
export class CustomersService {
  private readonly customers = new Map<string, Customer>();

  byId(id: string): Customer {
    const customer = this.customers.get(id);
    if (customer === undefined) throw new NotFoundException(`no customer ${id}`);
    return customer;
  }

  regions(): string[] {
    return ['eu'];
  }
}
