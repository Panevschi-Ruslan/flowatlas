import { Injectable } from '@nestjs/common';

import type { Customer } from './order.model';

@Injectable()
export class CustomersService {
  byId(id: string): Customer {
    return { id, name: `customer ${id}` };
  }
}
