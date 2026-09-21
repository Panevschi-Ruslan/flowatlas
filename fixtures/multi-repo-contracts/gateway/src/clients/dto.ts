import type { MoneyDto } from '@fx/wire';

/**
 * The caller's copy of `orders/src/orders/dto.ts:AddressDto`, byte for byte.
 *
 * Two declarations with one shape: the hashes agree and the check answers
 * `identical` without walking a field.
 */
export interface AddressDto {
  line1: string;
  city: string;
  postcode: string;
}

/**
 * What the caller actually sends to `POST /orders`.
 *
 * Three deliberate differences from the receiver's copy, one per kind of
 * finding: no `channel` at all, `note` optional where it is required, and a
 * `debugId` nobody reads.
 */
export interface CreateOrderDto {
  customerId: string;
  note?: string;
  debugId: string;
  total: MoneyDto;
  shipTo: AddressDto;
}

/** What the caller expects back. `total` is text here and a number there. */
export interface OrderDto {
  id: string;
  total: string;
  placedAt: string;
}

/**
 * The caller's shape for a draft: three fields where the receiver declares one.
 *
 * Which of the other two turn up as findings depends on what each call writes,
 * not on this declaration. That is the point of it (R34).
 */
export interface DraftDto {
  title: string;
  owner: string;
  archived: boolean;
}

/** What the draft route answers with, matching the receiver so only the request half is measured. */
export interface DraftResultDto {
  title: string;
}
