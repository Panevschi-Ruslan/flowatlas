import { BaseEntity } from './base-entity';

/** `kind: enum`, `members: ['New', 'Paid', 'Shipped']`, `meta.declKind: 'enum'`. */
export enum Status {
  New = 'new',
  Paid = 'paid',
  Shipped = 'shipped',
}

/** String-literal union alias → `kind: union`, `members: ["'retail'", "'wholesale'"]`. */
export type Kind = 'retail' | 'wholesale';

export interface OrderLine {
  sku: string;
  quantity: number;
}

/** Interface extending `BaseEntity`: `id`/`createdAt` are flattened in (D3). */
export interface Order extends BaseEntity {
  customerId: string;
  status: Status;
  kind: Kind;
  lines: OrderLine[];
  note?: string;
}
