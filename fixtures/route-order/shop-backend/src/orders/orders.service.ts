import { Injectable } from '@nestjs/common';

export interface Order {
  id: string;
  total: number;
}

export interface OrdersSummary {
  count: number;
  revenue: number;
}

@Injectable()
export class OrdersService {
  summary(): OrdersSummary {
    return { count: 0, revenue: 0 };
  }

  byId(id: string): Order {
    return { id, total: 0 };
  }

  latest(): Order {
    return { id: 'latest', total: 0 };
  }

  exportCsv(): string {
    return 'id,total';
  }
}
