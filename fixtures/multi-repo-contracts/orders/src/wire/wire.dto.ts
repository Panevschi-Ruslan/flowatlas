import { Exclude, Expose, Transform } from '../validation';

/**
 * One field per rule about what JSON does to a shape, as the receiver reads it.
 *
 * The caller's copy in `gateway` declares each of these the other way round —
 * text where this has a date, a set where this has an array — and the whole
 * point of the pair is that not one of them is an error. A rule that stops
 * firing shows up here as a new error, which is the only way to notice.
 */
export class WireDto {
  /** Read back as text; the caller declares a date. */
  placedAt!: string;
  /** JSON has one number type and it cannot hold the caller's. */
  reference!: string;
  /** Binary arrives as text. */
  signature!: string;
  /** The caller types it `string | undefined`, which is optionality, not absence. */
  note?: string;
  /** The caller drops it on the way out and this does not require it. */
  secret?: string;
  /** The caller renames it on the way out; this is the name it arrives under. */
  customer_id!: string;
  /** A function on the caller decides the value, so no declaration describes it. */
  coupon!: number;
  /** Neither side claims anything about it. */
  extras!: unknown;
  /** Spelled out here and an enum on the caller: the same set of values. */
  channel!: 'web' | 'phone';
  /** JSON carries neither of these two, whatever both sides declare. */
  tags!: string[];
  counts!: Record<string, number>;
  /** Renamed on the way in, so both ends agree about the name on the wire. */
  @Expose({ name: 'shipping_city' })
  shippingCity!: string;
  /** Dropped on the way in: what the caller sends under this name lands nowhere. */
  @Exclude()
  internalNote?: string;
  /** Its value is a function's business on this side too. */
  @Transform(({ value }: { value: unknown }) => Number(value))
  score!: number;
}

/**
 * The pair the rules must not silence.
 *
 * A date becomes text on the wire and never a number; a field that can only
 * ever hold nothing is never written at all; and a set of values the caller
 * widened is still wider than this. All three are errors, and they are here so
 * that "no errors on the wire fixture" cannot be met by a rule, or by a
 * database column, that simply stopped comparing.
 */
export interface WireBrokenDto {
  placedAt: number;
  reference: string;
  delivery: 'post';
}
