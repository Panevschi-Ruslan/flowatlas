import type { MoneyDto } from '@fx/wire';
import { IsString } from '../validation';

/**
 * Copied verbatim into `gateway`.
 *
 * Two declarations, one shape, so the hashes agree and `flowatlas contracts`
 * answers `identical` without walking a field. Keep the two copies the same or
 * the expectation moves.
 */
export interface AddressDto {
  line1: string;
  city: string;
  postcode: string;
}

/**
 * The body of `POST /orders`, as the service that answers it declares it.
 *
 * Three deliberate differences from the caller's copy, one per kind of finding:
 * `channel` is required here and absent there (`missing_required`), `note` is
 * required here and optional there (`optionality_mismatch`), and the caller has
 * a `debugId` this does not (`extra_field`).
 */
export class CreateOrderDto {
  customerId!: string;
  channel!: string;
  note!: string;
  total!: MoneyDto;
  shipTo!: AddressDto;
}

/** The answer to `GET /orders/:id`. `total` is a number here and text there. */
export interface OrderDto {
  id: string;
  total: number;
  placedAt: Date;
}

/** What goes on `order.created`. `billing` declares its own, and differently. */
export interface OrderCreatedEvent {
  orderId: string;
  total: MoneyDto;
  placedAt: Date;
}

/** The question an rpc caller asks. `billing` asks it with a different shape. */
export interface GetOrderQuery {
  orderId: string;
  includeItems: boolean;
}

/**
 * What the handler for `POST /orders/drafts` declares, and all it declares.
 *
 * The caller's own shape for a draft has three fields; this has one. What the
 * caller *sends* decides which of the other two are findings, and that is the
 * whole of R34 in one boundary.
 */
export class CreateDraftDto {
  // Decorated, because a whitelisting pipe only strips from a class that has
  // some validation on it — a class with none is not a class it validates.
  @IsString()
  title!: string;
}

/** The second shape `GET /orders/drafts/:id` may answer with, on the locked path. */
export class LockedDraftDto {
  draft!: CreateDraftDto;
  lockedBy!: string;
}
